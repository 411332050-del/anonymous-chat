import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

declare const process: { env: Record<string, string | undefined> }

// GitHub Pages 的網址是 https://<帳號>.github.io/<儲存庫名稱>/，
// 所以打包時要告訴 Vite 這段「基底路徑」，否則網頁會找不到自己的檔案。
// 部署時由 GitHub Actions 以 VITE_BASE 傳入；沒傳就用預設的儲存庫名稱。
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE ?? (command === 'build' ? '/anonymous-chat/' : '/'),
  plugins: [react()],
}))
