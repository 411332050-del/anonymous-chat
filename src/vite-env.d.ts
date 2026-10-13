/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAT_MODE?: 'demo' | 'live'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
