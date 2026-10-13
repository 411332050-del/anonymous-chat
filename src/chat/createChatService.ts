import { CHAT_MODE, DEBUG_PANEL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config'
import type { DebuggableChatService } from './ChatService'
import { MockChatService } from './mock/MockChatService'
import { SupabaseChatService } from './supabase/SupabaseChatService'

/** 依設定決定用假服務或真服務。畫面層不需要知道差別。 */
export function createChatService(): DebuggableChatService {
  if (CHAT_MODE === 'live') {
    return new SupabaseChatService({ url: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY })
  }
  // ?debug=1 時每個分頁各自一個身分，方便用兩個分頁扮演兩個人
  return new MockChatService({ perTabIdentity: DEBUG_PANEL })
}
