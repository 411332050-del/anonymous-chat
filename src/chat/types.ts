// 通訊約定（docs/architecture.md 第 5 節）。假服務與日後的 Supabase 服務都必須遵守。

export interface Message {
  /** 由前端發送時先產生的 UUID，用來避免同一則訊息顯示兩次 */
  id: string
  /** 發言者的匿名編號 */
  authorId: string
  nickname: string
  content: string
  /** ISO 時間字串；階段二以伺服器時間為準 */
  createdAt: string
}

export interface Me {
  authorId: string
  nickname: string
}

/** 目前在線的一個人 */
export interface PresenceMember {
  authorId: string
  nickname: string
}

/** 有人進來／離開的提示（不含自己） */
export interface PresenceNotice {
  kind: 'join' | 'leave'
  nickname: string
}

/** 有人正在輸入（不含自己） */
export interface TypingSignal {
  authorId: string
  nickname: string
}

/** 一個人對一則訊息按的一種表情 */
export interface Reaction {
  messageId: string
  /** 按表情的人（匿名編號） */
  authorId: string
  emoji: string
}

export type ErrorCode = 'EMPTY' | 'TOO_LONG' | 'RATE_LIMITED' | 'OFFLINE' | 'UNKNOWN'

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'failed'

/** 載入更早訊息時的游標：目前最舊那則的時間與編號 */
export interface Cursor {
  createdAt: string
  id: string
}

export interface HistoryPage {
  /** 舊到新排序 */
  messages: Message[]
  /** true 代表沒有更早的訊息了 */
  reachedEnd: boolean
}

export interface ChatEvents {
  'history:loaded': HistoryPage
  'message:new': Message
  'presence:count': number
  /** 目前在線的名單（同一人開多個分頁只算一人） */
  'presence:list': PresenceMember[]
  'presence:notice': PresenceNotice
  typing: TypingSignal
  /** 載入（或重新載入）這幾則訊息的全部回應；這些訊息原本的回應以這次為準 */
  'reactions:loaded': { messageIds: string[]; reactions: Reaction[] }
  /** 有人新增（active=true）或收回（active=false）一個回應 */
  'reaction:changed': { reaction: Reaction; active: boolean }
  'connection:status': ConnectionStatus
  'send:error': { id: string; code: ErrorCode }
}

export type Unsubscribe = () => void
