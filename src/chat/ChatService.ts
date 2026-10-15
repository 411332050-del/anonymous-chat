import type { ChatEvents, Cursor, HistoryPage, Me, Unsubscribe } from './types'

/**
 * 聊天服務介面（架構文件所說的「插座」）。
 * 畫面層只能透過它跟後端說話，絕對不可以直接碰 Supabase。
 */
export interface ChatService {
  /**
   * 以代號進入大廳（使用者按下「進入聊天室」之後才會呼叫）。
   * 成功回傳「我是誰」（暱稱＝代號＋3 碼編號，例如「小明#371」，編號由後端產生、同一個匿名身分固定不變），
   * 接著會觸發 history:loaded、presence:count、connection:status。代號不合規則時丟出錯誤。
   */
  join(alias: string): Promise<Me>
  /** 發送訊息。成功時會收到同一個 id 的 message:new；失敗時收到 send:error。 */
  sendMessage(id: string, content: string): Promise<void>
  /**
   * 對一則訊息按表情；已經按過同一種就收回。回傳按完之後這個回應是否存在（true＝已按）。
   * 失敗時丟出錯誤，訊息文字可能是 RATE_LIMITED 等代碼。
   */
  toggleReaction(messageId: string, emoji: string): Promise<boolean>
  /** 載入更早的訊息（最多 50 則）。 */
  loadOlder(before: Cursor): Promise<HistoryPage>
  /** 告訴大家「我正在輸入」。服務自己會節流並忽略離線狀態，畫面可以在每次輸入時直接呼叫。 */
  notifyTyping(): void
  /** 離開大廳，停止接收事件。 */
  leave(): void
  on<E extends keyof ChatEvents>(event: E, handler: (payload: ChatEvents[E]) => void): Unsubscribe
}

/** 只有展示模式的假服務才有的測試開關（用網址 ?debug=1 打開面板）。 */
export interface MockDebug {
  setOffline(offline: boolean): void
  setJoinFailure(fail: boolean): void
  failNextSend(): void
  failNextLoadOlder(): void
}

export type DebuggableChatService = ChatService & { debug?: MockDebug }
