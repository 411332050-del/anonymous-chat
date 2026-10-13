export type ChatMode = 'demo' | 'live'

/** 展示模式（階段一）或正式模式（階段二，接 Supabase）。 */
export const CHAT_MODE: ChatMode = import.meta.env.VITE_CHAT_MODE === 'live' ? 'live' : 'demo'

/** Supabase 專案網址（可公開）。 */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? ''

/** Supabase 可公開金鑰 publishable key（可公開）。絕不是 secret key。 */
export const SUPABASE_PUBLISHABLE_KEY: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''

/** 網址加上 ?debug=1 會出現測試面板（只有展示模式有效）。 */
export const DEBUG_PANEL: boolean =
  CHAT_MODE === 'demo' && new URLSearchParams(window.location.search).has('debug')
