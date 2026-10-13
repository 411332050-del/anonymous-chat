import { CHAT_MODE, DEBUG_PANEL } from '../config'
import type { DebuggableChatService } from './ChatService'
import { MockChatService } from './mock/MockChatService'

/** 依設定決定用假服務或真服務。階段二只需要在這裡加上 Supabase 服務。 */
export function createChatService(): DebuggableChatService {
  if (CHAT_MODE === 'live') {
    throw new Error('正式模式（Supabase）要到階段二才會實作。')
  }
  // ?debug=1 時每個分頁各自一個身分，方便用兩個分頁扮演兩個人
  return new MockChatService({ perTabIdentity: DEBUG_PANEL })
}
