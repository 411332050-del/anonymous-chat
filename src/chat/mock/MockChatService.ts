import { Emitter } from '../emitter'
import type { ChatService, MockDebug } from '../ChatService'
import type { ChatEvents, Cursor, HistoryPage, Me, Message, Unsubscribe } from '../types'
import { PAGE_SIZE, RECONNECT_GIVE_UP_MS, RateLimiter, aliasProblem, parseMessage, sanitize, sanitizeAlias, validateContent } from '../../rules'
import { BOT_AUTHORS, BOT_LINES, createSeedMessages, newId, randomTag } from './seed'

// 階段一的假服務：所有資料都只存在這個瀏覽器（localStorage），
// 同一個瀏覽器的其他分頁透過 BroadcastChannel 互相傳話。

const IDENTITY_KEY = 'anonchat.identity'
const MESSAGES_KEY = 'anonchat.messages'
const BOT_LEASE_KEY = 'anonchat.botLease'
const CHANNEL_NAME = 'anonchat'
const MAX_STORED = 500
const FAKE_BASE_MIN = 6
const FAKE_BASE_MAX = 14

type Wire =
  | { type: 'message'; message: Message }
  | { type: 'hello'; tabId: string }
  | { type: 'here'; tabId: string }
  | { type: 'bye'; tabId: string }

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
  private otherTabs = new Set<string>()
  private fakeBase = 10
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
    if (!this.rateLimiter.tryConsume()) {
      this.emitter.emit('send:error', { id, code: 'RATE_LIMITED' })
      return
    }

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
    return {
      messages: older.slice(-PAGE_SIZE),
      reachedEnd: older.length <= PAGE_SIZE,
    }
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
    channel.postMessage({ type: 'hello', tabId: this.tabId } satisfies Wire)
    window.addEventListener('pagehide', this.onPageHide)
  }

  private onWire(wire: Wire): void {
    switch (wire.type) {
      case 'hello':
        this.otherTabs.add(wire.tabId)
        this.channel?.postMessage({ type: 'here', tabId: this.tabId } satisfies Wire)
        this.emitPresence()
        break
      case 'here':
        this.otherTabs.add(wire.tabId)
        this.emitPresence()
        break
      case 'bye':
        this.otherTabs.delete(wire.tabId)
        this.emitPresence()
        break
      case 'message': {
        const message = parseMessage(wire.message)
        if (message) this.deliver(message)
        break
      }
    }
  }

  private emitPresence(): void {
    if (this.offline) return
    this.emitter.emit('presence:count', 1 + this.otherTabs.size + this.fakeBase)
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
      const step = Math.random() < 0.5 ? -1 : 1
      this.fakeBase = Math.min(FAKE_BASE_MAX, Math.max(FAKE_BASE_MIN, this.fakeBase + step))
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
