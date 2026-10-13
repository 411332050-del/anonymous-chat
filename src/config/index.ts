export type ChatMode = 'demo' | 'live'

/** 展示模式（階段一）或正式模式（階段二，接 Supabase）。 */
export const CHAT_MODE: ChatMode = import.meta.env.VITE_CHAT_MODE === 'live' ? 'live' : 'demo'

/** 網址加上 ?debug=1 會出現測試面板（只有展示模式有效）。 */
export const DEBUG_PANEL: boolean =
  CHAT_MODE === 'demo' && new URLSearchParams(window.location.search).has('debug')
