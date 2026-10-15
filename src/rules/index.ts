// 共用規則（docs/architecture.md 第 5.5、9.1 節）。
// 假服務與日後的資料庫各依這份規格實作一次，行為必須一致。

import type { ErrorCode, Message, Reaction } from '../chat/types'

export const MAX_LENGTH = 500
export const PAGE_SIZE = 50
/** 每人 10 秒內最多 5 則 */
export const RATE_LIMIT_COUNT = 5
export const RATE_LIMIT_WINDOW_MS = 10_000
/** 兩則之間至少間隔 0.5 秒 */
export const MIN_INTERVAL_MS = 500
/** 斷線後重連超過這麼久仍失敗，就放棄並顯示「無法連線」 */
export const RECONNECT_GIVE_UP_MS = 60_000

/** 零寬字元、文字方向控制字元、其他控制字元（換行除外） */
const HIDDEN_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

export function charCount(text: string): number {
  return Array.from(text).length
}

/** 送出前的清理：去隱形字元、統一換行、折疊連續換行、去頭尾空白。 */
export function sanitize(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(HIDDEN_CHARS, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const ALIAS_MAX_LENGTH = 12

/** 代號的清理：去掉所有控制字元（含換行）與隱形字元，再去頭尾空白。 */
export function sanitizeAlias(raw: string): string {
  return raw.replace(HIDDEN_CHARS, '').trim()
}

/** 回傳不合格的原因（給使用者看）；通過則回傳 null。傳入的應是 sanitizeAlias 之後的文字。 */
export function aliasProblem(alias: string): string | null {
  const length = charCount(alias)
  if (length === 0) return '請輸入代號（去掉頭尾空白後 1～12 字）'
  if (length > ALIAS_MAX_LENGTH) return `代號最多 ${ALIAS_MAX_LENGTH} 字，目前 ${length} 字`
  return null
}

/** 「正在輸入」訊號最多每隔這麼久送一次（控制即時流量） */
export const TYPING_SEND_INTERVAL_MS = 3_000
/** 收到訊號後，這麼久沒再收到就當作停止輸入 */
export const TYPING_EXPIRE_MS = 5_000

/** 同一個人在這段時間內送出內容完全相同的訊息，視為重複 */
export const DUPLICATE_WINDOW_MS = 30_000

/** 回傳錯誤代碼；通過則回傳 null。傳入的應是 sanitize 之後的文字。 */
export function validateContent(content: string): ErrorCode | null {
  if (content.length === 0) return 'EMPTY'
  if (charCount(content) > MAX_LENGTH) return 'TOO_LONG'
  return null
}

/** 頻率限制：10 秒內最多 5 則，且兩則至少間隔 0.5 秒。 */
export class RateLimiter {
  private sentAt: number[] = []

  /** 可以送出就記錄並回傳 true；太快則回傳 false（不記錄）。 */
  tryConsume(now = Date.now()): boolean {
    this.sentAt = this.sentAt.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
    const last = this.sentAt[this.sentAt.length - 1]
    if (this.sentAt.length >= RATE_LIMIT_COUNT) return false
    if (last !== undefined && now - last < MIN_INTERVAL_MS) return false
    this.sentAt.push(now)
    return true
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const NICKNAME_MAX_LENGTH = 20

/** 在線名單裡的一個人：資料來自其他瀏覽器，同樣先檢查格式才使用。 */
export function isValidNickname(nickname: unknown): nickname is string {
  return typeof nickname === 'string' && charCount(nickname) >= 1 && charCount(nickname) <= NICKNAME_MAX_LENGTH
}

/**
 * 收到的訊息先檢查欄位格式，不合格回傳 null（呼叫端丟棄）。
 * 假服務與 Supabase 服務的所有入口（歷史、即時、載入更早）都必須經過這裡。
 */
export function parseMessage(raw: unknown): Message | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  const { id, authorId, nickname, content, createdAt } = m
  const ok =
    typeof id === 'string' &&
    UUID_PATTERN.test(id) &&
    typeof authorId === 'string' &&
    authorId.length > 0 &&
    typeof nickname === 'string' &&
    charCount(nickname) >= 1 &&
    charCount(nickname) <= NICKNAME_MAX_LENGTH &&
    typeof content === 'string' &&
    charCount(content) >= 1 &&
    charCount(content) <= MAX_LENGTH &&
    typeof createdAt === 'string' &&
    !Number.isNaN(Date.parse(createdAt))
  if (!ok) {
    console.warn('[chat] 丟棄格式不合的訊息', { id: typeof id === 'string' ? id : typeof id })
    return null
  }
  return { id, authorId, nickname, content, createdAt }
}

/** 可以按的表情（順序就是畫面上的順序）。資料庫 0003_reactions.sql 也只允許這 6 種。 */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'] as const

/** 收到的回應先檢查格式；不合格回傳 null（呼叫端丟棄）。 */
export function parseReaction(raw: unknown): Reaction | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { messageId, authorId, emoji } = raw as Record<string, unknown>
  const ok =
    typeof messageId === 'string' &&
    UUID_PATTERN.test(messageId) &&
    typeof authorId === 'string' &&
    authorId.length > 0 &&
    typeof emoji === 'string' &&
    (REACTION_EMOJIS as readonly string[]).includes(emoji)
  if (!ok) {
    console.warn('[chat] 丟棄格式不合的回應')
    return null
  }
  return { messageId, authorId, emoji }
}
