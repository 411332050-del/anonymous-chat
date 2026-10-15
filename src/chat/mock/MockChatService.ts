import { Emitter } from '../emitter'
import type { ChatService, MockDebug } from '../ChatService'
import type { ChatEvents, Cursor, HistoryPage, Me, Message, PresenceMember, Reaction, Unsubscribe } from '../types'
import { DUPLICATE_WINDOW_MS, PAGE_SIZE, RECONNECT_GIVE_UP_MS, REACTION_EMOJIS, TYPING_SEND_INTERVAL_MS, RateLimiter, aliasProblem, isValidNickname, parseMessage, parseReaction, sanitize, sanitizeAlias, validateContent } from '../../rules'
import { BOT_AUTHORS, BOT_LINES, createSeedMessages, newId, randomTag } from './seed'

// 階段一的假服務：所有資料都只存在這個瀏覽器（localStorage），
// 同一個瀏覽器的其他分頁透過 BroadcastChannel 互相傳話。

const IDENTITY_KEY = 'anonchat.identity'
const MESSAGES_KEY = 'anonchat.messages'
const BOT_LEASE_KEY = 'anonchat.botLease'
const REACTIONS_KEY = 'anonchat.reactions'
const MAX_REACTIONS = 1000
const CHANNEL_NAME = 'anonchat'
const MAX_STORED = 500
const FAKE_ONLINE_MIN = 2

type Wire =
  | { type: 'message'; message: Message }
  | { type: 'hello'; tabId: string; member: PresenceMember }
  | { type: 'here'; tabId: string; member: PresenceMember }
  | { type: 'bye'; tabId: string }
  | { type: 'typing'; authorId: string; nickname: string }
  | { type: 'reaction'; reaction: Reaction; active: boolean }

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 儲存空間滿了或被禁用：展示模式下忽略即可
  }
}

function byTime(a: Message, b: Message): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class MockChatService implements ChatService {
  private emitter = new Emitter()
  private tabId = newId()
  private me: Me | null = null
  private channel: BroadcastChannel | null = null
  /** 其他分頁（tabId → 那個分頁的身分） */
  private otherTabs = new Map<string, PresenceMember>()
  /** 假裝在線的機器人（BOT_AUTHORS 的索引） */
  private fakeOnline = new Set<number>()
  private knownPresence: Map<string, string> | null = null
  private lastTypingSent = 0
  private timers: number[] = []
  private joined = false

  private offline = false
  private joinFails = false
  private nextSendFails = false
  private nextLoadOlderFails = false
  private giveUpTimer: number | undefined
  /** 離線期間錯過的訊息，恢復連線後補發 */
  private missed: Message[] = []

  private rateLimiter = new RateLimiter()
  /** 最近送出的內容與時間，用來擋重複訊息（規則與資料庫一致） */
  private recentContents = new Map<string, number>()

  constructor(private options: { perTabIdentity?: boolean } = {}) {}

  private get perTabIdentity(): boolean {
    return this.options.perTabIdentity === true
  }

  readonly debug: MockDebug = {
    setOffline: (offline) => this.setOffline(offline),
    setJoinFailure: (fail) => {
      this.joinFails = fail
      if (fail) this.emitter.emit('connection:status', 'failed')
    },
    failNextSend: () => {
      this.nextSendFails = true
    },
    failNextLoadOlder: () => {
      this.nextLoadOlderFails = true
    },
  }

  on<E extends keyof ChatEvents>(event: E, handler: (payload: ChatEvents[E]) => void): Unsubscribe {
    return this.emitter.on(event, handler)
  }

  async join(rawAlias: string): Promise<Me> {
    const alias = sanitizeAlias(rawAlias)
    if (aliasProblem(alias)) throw new Error('INVALID_ALIAS')
    this.emitter.emit('connection:status', 'connecting')
    await delay(700)
    if (this.joinFails) {
      this.emitter.emit('connection:status', 'failed')
      throw new Error('mock join failure')
    }

    this.me = this.loadOrCreateIdentity(alias)
    this.fakeOnline = new Set([0, 1, 2, 3].slice(0, FAKE_ONLINE_MIN + Math.floor(Math.random() * 3)))
    this.knownPresence = null
    this.ensureSeeded()
    this.openChannel()
    this.joined = true
    this.offline = false

    // 事件在 join() 回傳之後才送出，讓畫面先拿到「我是誰」
    setTimeout(() => {
      const all = this.readMessages()
      const page = all.slice(-PAGE_SIZE)
      this.emitter.emit('history:loaded', { messages: page, reachedEnd: all.length <= PAGE_SIZE })
      this.emitPresence()
      this.emitReactions(page.map((m) => m.id))
      this.emitter.emit('connection:status', 'online')
    }, 0)

    this.startTimers()
    return this.me
  }

  async sendMessage(id: string, rawContent: string): Promise<void> {
    const me = this.me
    if (!me || !this.joined) {
      this.emitter.emit('send:error', { id, code: 'OFFLINE' })
      return
    }
    await delay(200 + Math.random() * 300)

    if (this.offline) {
      this.emitter.emit('send:error', { id, code: 'OFFLINE' })
      return
    }
    if (this.nextSendFails) {
      this.nextSendFails = false
      this.emitter.emit('send:error', { id, code: 'UNKNOWN' })
      return
    }
    // 後端會再檢查一次，不信任前端
    const content = sanitize(rawContent)
    const invalid = validateContent(content)
    if (invalid) {
      this.emitter.emit('send:error', { id, code: invalid })
      return
    }
    const now = Date.now()
    for (const [text, at] of this.recentContents) if (now - at >= DUPLICATE_WINDOW_MS) this.recentContents.delete(text)
    if (this.recentContents.has(content)) {
      this.emitter.emit('send:error', { id, code: 'DUPLICATE' })
      return
    }
    if (!this.rateLimiter.tryConsume()) {
      this.emitter.emit('send:error', { id, code: 'RATE_LIMITED' })
      return
    }

    this.recentContents.set(content, now)
    const message: Message = {
      id,
      authorId: me.authorId,
      nickname: me.nickname,
      content,
      createdAt: new Date().toISOString(),
    }
    this.store(message)
    this.channel?.postMessage({ type: 'message', message } satisfies Wire)
    this.emitter.emit('message:new', message)
  }

  async loadOlder(before: Cursor): Promise<HistoryPage> {
    await delay(400)
    if (this.nextLoadOlderFails || this.offline) {
      this.nextLoadOlderFails = false
      throw new Error('mock loadOlder failure')
    }
    const older = this.readMessages().filter(
      (m) => m.createdAt < before.createdAt || (m.createdAt === before.createdAt && m.id < before.id),
    )
    const olderPage = older.slice(-PAGE_SIZE)
    setTimeout(() => this.emitReactions(olderPage.map((m) => m.id)), 0)
    return {
      messages: olderPage,
      reachedEnd: older.length <= PAGE_SIZE,
    }
  }

  async toggleReaction(messageId: string, emoji: string): Promise<boolean> {
    const me = this.me
    if (!me || !this.joined || this.offline) throw new Error('OFFLINE')
    await delay(150)
    const reaction: Reaction = { messageId, authorId: me.authorId, emoji }
    if (!parseReaction(reaction)) throw new Error('INVALID_REACTION')
    const active = this.applyReaction(reaction)
    this.channel?.postMessage({ type: 'reaction', reaction, active } satisfies Wire)
    return active
  }

  notifyTyping(): void {
    if (!this.me || !this.joined || this.offline) return
    const now = Date.now()
    if (now - this.lastTypingSent < TYPING_SEND_INTERVAL_MS) return
    this.lastTypingSent = now
    this.channel?.postMessage({ type: 'typing', authorId: this.me.authorId, nickname: this.me.nickname } satisfies Wire)
  }

  leave(): void {
    if (this.channel) {
      this.channel.postMessage({ type: 'bye', tabId: this.tabId } satisfies Wire)
      this.channel.close()
      this.channel = null
    }
    this.timers.forEach((t) => window.clearTimeout(t))
    this.timers = []
    window.clearTimeout(this.giveUpTimer)
    this.giveUpTimer = undefined
    this.otherTabs.clear()
    this.joined = false
    window.removeEventListener('pagehide', this.onPageHide)
  }

  // ---- 身分與儲存 ----

  // 同一個瀏覽器的所有分頁預設共用一個身分（符合「同一個瀏覽器固定暱稱」的需求），
  // 所以兩個分頁其實是「同一個人」，彼此的訊息都會顯示成自己的。
  // 測試用：perTabIdentity 時每個分頁各自一個身分（存在 sessionStorage），才能扮演兩個人。
  // 身分（編號 authorId 與 3 碼 tag）固定不變，代號每次進入時由使用者輸入。
  private loadOrCreateIdentity(alias: string): Me {
    const store = this.perTabIdentity ? sessionStorage : localStorage
    let saved: { authorId?: string; tag?: string } | null = null
    try {
      saved = JSON.parse(store.getItem(IDENTITY_KEY) ?? 'null')
    } catch {
      // 讀不到就重新建立
    }
    const identity = {
      authorId: saved?.authorId || newId(),
      tag: saved?.tag && /^\d{3}$/.test(saved.tag) ? saved.tag : randomTag(),
    }
    try {
      store.setItem(IDENTITY_KEY, JSON.stringify(identity))
    } catch {
      // 儲存空間被禁用：這次先用暫時身分
    }
    return { authorId: identity.authorId, nickname: `${alias}#${identity.tag}` }
  }

  private readReactions(): Reaction[] {
    return (readJson<unknown[]>(REACTIONS_KEY) ?? []).map(parseReaction).filter((r): r is Reaction => r !== null)
  }

  private sameReaction(a: Reaction, b: Reaction): boolean {
    return a.messageId === b.messageId && a.authorId === b.authorId && a.emoji === b.emoji
  }

  /** 沒有就新增、有就收回；回傳之後是否存在。 */
  private applyReaction(reaction: Reaction): boolean {
    const all = this.readReactions()
    const exists = all.some((r) => this.sameReaction(r, reaction))
    const next = exists ? all.filter((r) => !this.sameReaction(r, reaction)) : [...all, reaction]
    writeJson(REACTIONS_KEY, next.slice(-MAX_REACTIONS))
    return !exists
  }

  private emitReactions(messageIds: string[]): void {
    const wanted = new Set(messageIds)
    this.emitter.emit('reactions:loaded', {
      messageIds,
      reactions: this.readReactions().filter((r) => wanted.has(r.messageId)),
    })
  }

  private readMessages(): Message[] {
    const raw = readJson<unknown[]>(MESSAGES_KEY) ?? []
    return raw
      .map(parseMessage)
      .filter((m): m is Message => m !== null)
      .sort(byTime)
  }

  private ensureSeeded(): void {
    if (!readJson<Message[]>(MESSAGES_KEY)?.length) {
      writeJson(MESSAGES_KEY, createSeedMessages())
    }
  }

  private store(message: Message): void {
    const all = readJson<Message[]>(MESSAGES_KEY) ?? []
    if (all.some((m) => m.id === message.id)) return
    all.push(message)
    writeJson(MESSAGES_KEY, all.sort(byTime).slice(-MAX_STORED))
  }

  // ---- 分頁之間傳話與在線人數 ----

  private onPageHide = () => {
    this.channel?.postMessage({ type: 'bye', tabId: this.tabId } satisfies Wire)
  }

  private openChannel(): void {
    this.channel?.close()
    const channel = new BroadcastChannel(CHANNEL_NAME)
    this.channel = channel
    channel.onmessage = (event: MessageEvent<Wire>) => this.onWire(event.data)
    channel.postMessage({ type: 'hello', tabId: this.tabId, member: this.selfMember() } satisfies Wire)
    window.addEventListener('pagehide', this.onPageHide)
  }

  private onWire(wire: Wire): void {
    switch (wire.type) {
      case 'hello':
        this.rememberTab(wire)
        this.channel?.postMessage({ type: 'here', tabId: this.tabId, member: this.selfMember() } satisfies Wire)
        this.emitPresence()
        break
      case 'here':
        this.rememberTab(wire)
        this.emitPresence()
        break
      case 'bye':
        this.otherTabs.delete(wire.tabId)
        this.emitPresence()
        break
      case 'typing':
        if (!this.offline && typeof wire.authorId === 'string' && isValidNickname(wire.nickname) && wire.authorId !== this.me?.authorId) {
          this.emitter.emit('typing', { authorId: wire.authorId, nickname: wire.nickname })
        }
        break
      case 'reaction': {
        const reaction = parseReaction(wire.reaction)
        if (reaction && !this.offline) this.emitter.emit('reaction:changed', { reaction, active: wire.active === true })
        break
      }
      case 'message': {
        const message = parseMessage(wire.message)
        if (message) this.deliver(message)
        break
      }
    }
  }

  private selfMember(): PresenceMember {
    return { authorId: this.me!.authorId, nickname: this.me!.nickname }
  }

  private rememberTab(wire: { tabId: string; member: PresenceMember }): void {
    const { authorId, nickname } = wire.member ?? {}
    if (typeof authorId === 'string' && isValidNickname(nickname)) {
      this.otherTabs.set(wire.tabId, { authorId, nickname })
    }
  }

  /** 在線名單：自己、其他分頁的身分、假裝在線的機器人；同一個身分只算一人。 */
  private emitPresence(): void {
    if (this.offline || !this.me) return
    const map = new Map<string, string>()
    map.set(this.me.authorId, this.me.nickname)
    this.otherTabs.forEach((m) => map.set(m.authorId, m.nickname))
    this.fakeOnline.forEach((i) => map.set(BOT_AUTHORS[i].authorId, BOT_AUTHORS[i].nickname))
    const members: PresenceMember[] = Array.from(map, ([authorId, nickname]) => ({ authorId, nickname }))
    this.emitter.emit('presence:list', members)
    this.emitter.emit('presence:count', members.length)

    if (this.knownPresence) {
      for (const [id, nickname] of map) {
        if (!this.knownPresence.has(id) && id !== this.me.authorId) this.emitter.emit('presence:notice', { kind: 'join', nickname })
      }
      for (const [id, nickname] of this.knownPresence) {
        if (!map.has(id) && id !== this.me.authorId) this.emitter.emit('presence:notice', { kind: 'leave', nickname })
      }
    }
    this.knownPresence = map
  }

  /** 收到別人的訊息：離線時先存著，恢復連線後補發。 */
  private deliver(message: Message): void {
    if (this.offline) {
      this.missed.push(message)
      return
    }
    this.emitter.emit('message:new', message)
  }

  // ---- 機器人與假人數 ----

  private startTimers(): void {
    this.timers.forEach((t) => window.clearTimeout(t))
    this.timers = []
    const botTick = () => {
      this.maybeBotSpeak()
      this.timers.push(window.setTimeout(botTick, 12_000 + Math.random() * 13_000))
    }
    this.timers.push(window.setTimeout(botTick, 8_000 + Math.random() * 6_000))

    const presenceTick = () => {
      // 隨機讓一個機器人進來或離開，至少保留 FAKE_ONLINE_MIN 個
      const idx = Math.floor(Math.random() * BOT_AUTHORS.length)
      if (this.fakeOnline.has(idx)) {
        if (this.fakeOnline.size > FAKE_ONLINE_MIN) this.fakeOnline.delete(idx)
      } else {
        this.fakeOnline.add(idx)
      }
      this.emitPresence()
      this.timers.push(window.setTimeout(presenceTick, 8_000))
    }
    this.timers.push(window.setTimeout(presenceTick, 8_000))
  }

  /** 多個分頁同時開著時，只讓其中一個分頁扮演機器人。 */
  private maybeBotSpeak(): void {
    if (this.offline || !this.joined) return
    const now = Date.now()
    const lease = readJson<{ tabId: string; until: number }>(BOT_LEASE_KEY)
    if (lease && lease.tabId !== this.tabId && lease.until > now) return
    writeJson(BOT_LEASE_KEY, { tabId: this.tabId, until: now + 40_000 })

    const author = BOT_AUTHORS[Math.floor(Math.random() * BOT_AUTHORS.length)]
    // 偶爾順便對最近的一則訊息按個表情
    if (Math.random() < 0.5) {
      const recent = this.readMessages().slice(-8)
      const target = recent[Math.floor(Math.random() * recent.length)]
      if (target && target.authorId !== author.authorId) {
        const emoji = REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)]
        const reaction: Reaction = { messageId: target.id, authorId: author.authorId, emoji }
        const active = this.applyReaction(reaction)
        this.channel?.postMessage({ type: 'reaction', reaction, active } satisfies Wire)
        this.emitter.emit('reaction:changed', { reaction, active })
      }
    }
    // 機器人先「正在輸入」一下，再把訊息送出
    this.emitter.emit('typing', { authorId: author.authorId, nickname: author.nickname })
    this.timers.push(
      window.setTimeout(() => {
        if (this.offline || !this.joined) return
        const message: Message = {
          id: newId(),
          authorId: author.authorId,
          nickname: author.nickname,
          content: BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)],
          createdAt: new Date().toISOString(),
        }
        this.store(message)
        this.channel?.postMessage({ type: 'message', message } satisfies Wire)
        this.emitter.emit('message:new', message)
      }, 2_000),
    )
  }

  // ---- 測試開關 ----

  private setOffline(offline: boolean): void {
    if (offline === this.offline) return
    if (offline) {
      this.offline = true
      this.emitter.emit('connection:status', 'reconnecting')
      // 重連太久就放棄，跟正式服務同一條規則
      this.giveUpTimer = window.setTimeout(() => {
        this.giveUpTimer = undefined
        this.leave()
        this.offline = false
        this.emitter.emit('connection:status', 'failed')
      }, RECONNECT_GIVE_UP_MS)
      return
    }
    // 模擬網路恢復：稍等一下再回到線上，並補發錯過的訊息
    window.clearTimeout(this.giveUpTimer)
    this.giveUpTimer = undefined
    window.setTimeout(() => {
      this.offline = false
      const missed = this.missed.splice(0)
      missed.sort(byTime).forEach((m) => this.emitter.emit('message:new', m))
      this.emitPresence()
      this.emitter.emit('connection:status', 'online')
    }, 1200)
  }
}
