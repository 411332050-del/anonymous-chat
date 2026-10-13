# 匿名聊天室

一個網頁版匿名公開聊天室：前端部署在 GitHub Pages，後端使用 Supabase。

## 規則

- 開始任何工作前，先讀 `docs/architecture.md`（畫面設計見 `docs/design.md`）。
- 目前在「階段二」：前端已接上 Supabase（`src/chat/supabase/`）。階段一的假服務（`src/chat/mock/`）仍保留，把 `VITE_CHAT_MODE` 設為 `demo` 即可使用。
- 畫面層（`src/ui/`）只能透過 `ChatService` 介面說話，不可以直接碰 Supabase。
- 資料庫設定以 `supabase/migrations/` 裡的 SQL 檔為準，不使用 Supabase CLI，手動貼到後台 SQL Editor 執行。
- 不可以把金鑰檔案 commit 進 git（`.env`、`.env.local`、`.env.*.local`）。只有 `.env.example`（假值）可以 commit。
- 這個專案只會用到 Project URL 與 publishable key（可公開金鑰）。絕不取得、使用或寫入 Supabase 的 secret／service_role 金鑰與資料庫密碼。
- GitHub 部署用的 Project URL 與 publishable key 放在儲存庫的 Actions Secrets（`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`）。
