import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { Emitter } from '../emitter'
import type { ChatService } from '../ChatService'
import type { ChatEvents, Cursor, ErrorCode, HistoryPage, Me, Message, PresenceMember, Unsubscribe } from '../types'
import { PAGE_SIZE, RECONNECT_GIVE_UP_MS, TYPING_SEND_INTERVAL_MS, aliasProblem, isValidNickname, parseMessage, sanitize, sanitizeAlias, validateContent } from '../../rules'

// 階段二的真服務：Supabase 資料庫存訊息、Realtime 推送新訊息、Presence 算在線人數、
// 匿名登入辨認同一個瀏覽器。資料庫那一側的規則見 supabase/migrations/0001_init.sql 與 0002_alias.sql。

interface MessageRow {
  id: string
  author_id: string
  nickname: string
  content: string
  created_at: string
}

interface Config {
  url: string
  publishableKey: string
}

const JOIN_TIMEOUT_MS = 12_000
/** 送出成功後，這麼久還沒收到即時推送，就主動去資料庫拿那一則 */
const CONFIRM_FALLBACK_MS = 3_000
const SEEN_CAP = 200
const CHANNEL_NAME = 'lobby'

/** 資料庫來的資料先驗證格式；不合格回傳 null（丟棄）。 */
function toMessage(row: MessageRow): Message | null {
  return parseMessage({
    id: row?.id,
    authorId: row?.author_id,
    nickname: row?.nickname,
    content: row?.content,
    createdAt: row?.created_at,
  })
}

function toMessages(rows: MessageRow[]): Message[] {
  return rows.map(toMessage).filter((m): m is Message => m !== null)
}

function isNetworkFailure(message: string | undefined): boolean {
  return /failed to fetch|networkerror|network request failed|load failed/i.test(message ?? '')
}

/** 把資料庫回傳的錯誤對應成通訊約定的錯誤代碼。 */
function toErrorCode(error: { message?: string; code?: string }): ErrorCode {
  const text = error.message ?? ''
  if (text === 'RATE_LIMITED' || text === 'EMPTY' || text === 'TOO_LONG') return text
  if (isNetworkFailure(text) || !navigator.onLine) return 'OFFLINE'
  return 'UNKNOWN'
}

export class SupabaseChatService implements ChatService {
  private emitter = new Emitter()
  private client: SupabaseClient | null = null
  private channel: RealtimeChannel | null = null
  private me: Me | null = null

  private everOnline = false
  private historyReady = false
  private buffered: Message[] = []
  /** 目前看過的最新一則的時間，斷線重連時用來補抓錯過的訊息 */
  private lastSeen: string | null = null
  private seen = new Set<string>()
  /** 上一次的在線名單（authorId → 名稱），用來比對誰進來、誰離開 */
  private knownPresence: Map<string, string> | null = null
  private lastTypingSent = 0
  private timers = new Set<number>()
  private giveUpTimer: number | undefined
  private disposed = true

  constructor(private config: Config) {}

  on<E extends keyof ChatEvents>(event: E, handler: (payload: ChatEvents[E]) => void): Unsubscribe {
    return this.emitter.on(event, handler)
  }

  async join(rawAlias: string): Promise<Me> {
    const alias = sanitizeAlias(rawAlias)
    if (aliasProblem(alias)) throw new Error('INVALID_ALIAS')
    this.teardown()
    this.disposed = false
    this.everOnline = false
    this.historyReady = false
    this.buffered = []
    this.knownPresence = null
    this.emitter.emit('connection:status', 'connecting')

    try {
      const client = this.getClient()

      // 1. 匿名登入：同一個瀏覽器會沿用之前的身分
      const { data: sessionData } = await client.auth.getSession()
      let session = sessionData.session
      if (!session) {
        const { data, error } = await client.auth.signInAnonymously()
        if (error || !data.session) throw error ?? new Error('匿名登入失敗')
        session = data.session
      }

      // 2. 以代號取得暱稱：資料庫把代號加上 3 碼編號（同一個匿名身分編號固定），前端無法指定編號
      const { data: meRows, error: meError } = await client.rpc('enter_with_alias', { p_alias: alias })
      const meRow = Array.isArray(meRows) ? meRows[0] : null
      if (meError || !meRow) throw meError ?? new Error('取不到暱稱')
      const me: Me = { authorId: meRow.author_id, nickname: meRow.nickname }
      this.me = me

      // 3. 連上即時推送，並載入最近的訊息
      await client.realtime.setAuth(session.access_token)
      const history = await this.connectAndLoadHistory(client, me)

      window.addEventListener('pagehide', this.onPageHide)
      window.addEventListener('offline', this.onBrowserOffline)
      window.addEventListener('online', this.onBrowserOnline)

      // 事件在 join() 回傳之後才送出，讓畫面先拿到「我是誰」
      this.later(() => {
        this.emitter.emit('history:loaded', history)
        this.historyReady = true
        this.buffered.splice(0).forEach((m) => this.emitter.emit('message:new', m))
        this.emitPresence()
        this.everOnline = true
        this.markOnline()
      })
      return me
    } catch (error) {
      console.error('[chat] 進入聊天室失敗', error)
      this.teardown()
      this.emitter.emit('connection:status', 'failed')
      throw error
    }
  }

  async sendMessage(id: string, rawContent: string): Promise<void> {
    const client = this.client
    if (!client || !this.me || this.disposed) {
      this.emitter.emit('send:error', { id, code: 'OFFLINE' })
      return
    }
    const content = sanitize(rawContent)
    const invalid = validateContent(content)
    if (invalid) {
      this.emitter.emit('send:error', { id, code: invalid })
      return
    }

    // 只送 id 與 content；發言者、暱稱、時間由資料庫填
    const { error } = await client.from('messages').insert({ id, content })

    if (error && error.code !== '23505') {
      this.emitter.emit('send:error', { id, code: toErrorCode(error) })
      return
    }
    // 23505：這個 id 已經存在，代表上一次其實送成功了（只是回應遺失），當作成功。
    // 成功時正常會由即時推送送回確認；萬一沒收到，過一下就主動去拿。
    this.later(() => void this.confirmFallback(id), CONFIRM_FALLBACK_MS)
    if (error) void this.confirmFallback(id)
  }

  async loadOlder(before: Cursor): Promise<HistoryPage> {
    const client = this.requireClient()
    const { createdAt, id } = before
    const { data, error } = await client
      .from('messages')
      .select('id, author_id, nickname, content, created_at')
      .or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE + 1)
    if (error) throw error
    const rows = (data ?? []) as MessageRow[]
    return {
      messages: toMessages(rows.slice(0, PAGE_SIZE).reverse()),
      reachedEnd: rows.length <= PAGE_SIZE,
    }
  }

  notifyTyping(): void {
    const channel = this.channel
    const me = this.me
    if (!channel || !me || this.disposed || channel.state !== 'joined') return
    const now = Date.now()
    if (now - this.lastTypingSent < TYPING_SEND_INTERVAL_MS) return
    this.lastTypingSent = now
    void channel.send({ type: 'broadcast', event: 'typing', payload: { authorId: me.authorId, nickname: me.nickname } })
  }

  leave(): void {
    this.teardown()
  }

  // ---- 連線 ----

  private getClient(): SupabaseClient {
    if (!this.config.url || !this.config.publishableKey) {
      throw new Error('缺少 Supabase 設定：請設定 VITE_SUPABASE_URL 與 VITE_SUPABASE_PUBLISHABLE_KEY')
    }
    this.client ??= createClient(this.config.url, this.config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
    return this.client
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new Error('尚未進入聊天室')
    return this.client
  }

  /** 訂閱即時推送與在線狀態，等第一次連上後載入最近 50 則。 */
  private connectAndLoadHistory(client: SupabaseClient, me: Me): Promise<HistoryPage> {
    return new Promise<HistoryPage>((resolve, reject) => {
      let settled = false
      const fail = (error: unknown) => {
        if (!settled) {
          settled = true
          reject(error)
        }
      }
      const timeout = window.setTimeout(() => fail(new Error('連線逾時')), JOIN_TIMEOUT_MS)
      this.timers.add(timeout)

      // 用登入身分當 presence 的 key：同一個人開好幾個分頁只算一人在線
      const channel = client.channel(CHANNEL_NAME, {
        config: { presence: { key: me.authorId }, broadcast: { self: false } },
      })
      this.channel = channel

      channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
          const message = toMessage(payload.new as MessageRow)
          if (message) this.onRealtimeMessage(message)
        })
        .on('presence', { event: 'sync' }, () => this.emitPresence())
        .on('broadcast', { event: 'typing' }, ({ payload }) => this.onTyping(payload))
        .subscribe((status) => {
          if (this.disposed || this.channel !== channel) return

          if (status === 'SUBSCRIBED') {
            void channel.track(this.presencePayload())
            if (!settled) {
              this.loadHistory(client).then((page) => {
                if (!settled) {
                  settled = true
                  window.clearTimeout(timeout)
                  resolve(page)
                }
              }, fail)
            } else {
              void this.recover()
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (!settled) fail(new Error(`即時連線失敗：${status}`))
            else if (this.everOnline) this.markReconnecting()
          }
        })
    })
  }

  private async loadHistory(client: SupabaseClient): Promise<HistoryPage> {
    const { data, error } = await client
      .from('messages')
      .select('id, author_id, nickname, content, created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE + 1)
    if (error) throw error
    const rows = (data ?? []) as MessageRow[]
    const messages = toMessages(rows.slice(0, PAGE_SIZE).reverse())
    messages.forEach((m) => this.remember(m))
    return { messages, reachedEnd: rows.length <= PAGE_SIZE }
  }

  // ---- 即時事件 ----

  private onRealtimeMessage(message: Message): void {
    this.remember(message)
    if (!this.historyReady) {
      this.buffered.push(message)
      return
    }
    this.emitter.emit('message:new', message)
  }

  private remember(message: Message): void {
    this.seen.add(message.id)
    if (this.seen.size > SEEN_CAP) this.seen.delete(this.seen.values().next().value as string)
    if (!this.lastSeen || message.createdAt > this.lastSeen) this.lastSeen = message.createdAt
  }

  /** 別人的「正在輸入」訊號：來自其他瀏覽器，先檢查格式才使用。 */
  private onTyping(payload: unknown): void {
    const { authorId, nickname } = (payload ?? {}) as { authorId?: unknown; nickname?: unknown }
    if (typeof authorId !== 'string' || authorId.length === 0 || authorId === this.me?.authorId) return
    if (!isValidNickname(nickname)) return
    this.emitter.emit('typing', { authorId, nickname })
  }

  /** 登記在線時附上自己的名稱（名稱以資料庫回傳的為準）。 */
  private presencePayload(): { nickname: string; at: number } {
    return { nickname: this.me?.nickname ?? '', at: Date.now() }
  }

  /** 整理在線名單、人數，並比對出誰進來、誰離開。 */
  private emitPresence(): void {
    if (!this.channel) return
    const state = this.channel.presenceState() as Record<string, Array<{ nickname?: unknown }>>
    const members: PresenceMember[] = []
    for (const [authorId, metas] of Object.entries(state)) {
      // 自己的名稱用資料庫給的；別人的名稱來自對方瀏覽器，要先檢查格式
      const nickname = authorId === this.me?.authorId ? this.me.nickname : metas[metas.length - 1]?.nickname
      if (isValidNickname(nickname)) members.push({ authorId, nickname })
    }
    this.emitter.emit('presence:list', members)
    this.emitter.emit('presence:count', members.length)

    // 基準名單：等到「自己」也出現在名單裡（代表伺服器已送來完整名單）才建立，
    // 之前已經在線的人不算「進來了」；建立之後的每一次變動都會提示，不靠時間窗。
    const next = new Map(members.map((m) => [m.authorId, m.nickname]))
    if (this.knownPresence === null) {
      if (this.me && next.has(this.me.authorId)) this.knownPresence = next
      return
    }
    for (const [id, nickname] of next) {
      if (!this.knownPresence.has(id) && id !== this.me?.authorId) {
        this.emitter.emit('presence:notice', { kind: 'join', nickname })
      }
    }
    for (const [id, nickname] of this.knownPresence) {
      if (!next.has(id) && id !== this.me?.authorId) {
        this.emitter.emit('presence:notice', { kind: 'leave', nickname })
      }
    }
    this.knownPresence = next
  }

  /** 送出成功後若沒有收到即時推送的確認，就自己去拿。 */
  private async confirmFallback(id: string): Promise<void> {
    if (this.disposed || !this.client) return
    if (this.seen.has(id)) return
    const { data } = await this.client
      .from('messages')
      .select('id, author_id, nickname, content, created_at')
      .eq('id', id)
      .maybeSingle()
    const message = data ? toMessage(data as MessageRow) : null
    if (message && !this.seen.has(id)) {
      this.remember(message)
      this.emitter.emit('message:new', message)
    }
  }

  // ---- 斷線重連 ----

  /** 關閉分頁時盡量先通知「我離開了」。 */
  private onPageHide = () => {
    void this.channel?.untrack()
  }

  private onBrowserOffline = () => {
    if (this.everOnline) this.markReconnecting()
  }

  /** 進入「重新連線中」，並開始計時；超過時間仍沒恢復就放棄。 */
  private markReconnecting(): void {
    this.emitter.emit('connection:status', 'reconnecting')
    if (this.giveUpTimer === undefined) {
      this.giveUpTimer = window.setTimeout(() => this.giveUp(), RECONNECT_GIVE_UP_MS)
    }
  }

  private markOnline(): void {
    window.clearTimeout(this.giveUpTimer)
    this.giveUpTimer = undefined
    this.emitter.emit('connection:status', 'online')
  }

  /** 重連太久：停止所有連線並回報失敗，畫面會顯示「無法連線」與重試。 */
  private giveUp(): void {
    this.giveUpTimer = undefined
    this.teardown()
    this.emitter.emit('connection:status', 'failed')
  }

  private onBrowserOnline = () => {
    if (this.channel?.state === 'joined') void this.recover()
    // 否則等即時連線自己重連成功，會再走 recover()
  }

  /** 重新連上後：補抓斷線期間錯過的訊息、重新登記在線、恢復為線上。 */
  private async recover(): Promise<void> {
    const client = this.client
    if (!client || this.disposed) return
    void this.channel?.track(this.presencePayload())
    try {
      let query = client
        .from('messages')
        .select('id, author_id, nickname, content, created_at')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(PAGE_SIZE + 1)
      if (this.lastSeen) query = query.gt('created_at', this.lastSeen)
      const { data, error } = await query
      if (error) throw error
      const rows = (data ?? []) as MessageRow[]
      if (rows.length > PAGE_SIZE) {
        // 錯過太多：改為重新載入最近一頁
        const page = await this.loadHistory(client)
        this.emitter.emit('history:loaded', page)
      } else {
        toMessages(rows).forEach((m) => {
          this.remember(m)
          this.emitter.emit('message:new', m)
        })
      }
      this.emitPresence()
      this.markOnline()
    } catch (error) {
      console.error('[chat] 重連後補抓訊息失敗', error)
      this.markReconnecting()
    }
  }

  // ---- 清理 ----

  private later(fn: () => void, ms = 0): void {
    const t = window.setTimeout(() => {
      this.timers.delete(t)
      if (!this.disposed) fn()
    }, ms)
    this.timers.add(t)
  }

  private teardown(): void {
    this.disposed = true
    this.timers.forEach((t) => window.clearTimeout(t))
    this.timers.clear()
    window.clearTimeout(this.giveUpTimer)
    this.giveUpTimer = undefined
    window.removeEventListener('offline', this.onBrowserOffline)
    window.removeEventListener('online', this.onBrowserOnline)
    window.removeEventListener('pagehide', this.onPageHide)
    const { channel, client } = this
    if (channel && client) {
      // 先取消在線登記，其他人的名單與人數才會馬上更新
      const remove = () => void client.removeChannel(channel)
      void channel.untrack().then(remove, remove)
    }
    this.channel = null
    this.knownPresence = null
    this.seen.clear()
    // 身分（登入狀態）保留在瀏覽器，下次進來還是同一個人
  }
}
