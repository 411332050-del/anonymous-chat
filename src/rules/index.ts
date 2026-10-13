// 共用規則（docs/architecture.md 第 5.5、9.1 節）。
// 假服務與日後的資料庫各依這份規格實作一次，行為必須一致。

import type { ErrorCode } from '../chat/types'

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
