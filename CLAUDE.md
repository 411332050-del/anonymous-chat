# 匿名聊天室

一個網頁版匿名公開聊天室：前端部署在 GitHub Pages，後端使用 Supabase。

## 規則

- 開始任何工作前，先讀 `docs/architecture.md`。
- 目前在「階段一」：只用假的聊天服務（MockChatService），不接 Supabase，也不需要任何金鑰。
- 不可以把金鑰檔案 commit 進 git（`.env`、`.env.local`、`.env.*.local`）。只有 `.env.example`（假值）可以 commit。絕不取得或使用 Supabase 的 secret／service_role 金鑰。
