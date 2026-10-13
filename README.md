# 匿名聊天室

匿名公開聊天室。前端用 React、TypeScript、Vite，部署在 GitHub Pages；後端用 Supabase（資料庫、即時推送、在線人數、匿名登入）。
架構說明見 `docs/architecture.md`，畫面設計見 `docs/design.md`。

目前是**階段二**：正式模式連 Supabase。階段一的展示模式（假服務，訊息只存在你的瀏覽器）仍保留，方便測試。

## 本機啟動

```
npm install
npm run dev
```

模式由 `.env.local` 決定（範本見 `.env.example`）：

| `VITE_CHAT_MODE` | 說明 |
|---|---|
| `live` | 正式模式，連 Supabase。需要 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY` |
| `demo`（沒設定時的預設） | 展示模式，不需要任何金鑰。網址加 `?debug=1` 會出現測試面板，並讓每個分頁各自是一個身分 |

`.env.local` 不會被 commit。只放 Project URL 與 publishable key，絕不放 secret key 或資料庫密碼。

## 資料庫

不使用 Supabase CLI。依 `supabase/README.md` 的說明，把 `supabase/migrations/0001_init.sql` 貼到後台 SQL Editor 執行。

## 打包

```
npm run build     # 輸出到 dist/
npm run preview   # 預覽打包後的結果（會用 /anonymous-chat/ 這個子路徑）
```

## 部署

推到 `main` 分支後，GitHub Actions（`.github/workflows/deploy.yml`）會自動打包並上架到 GitHub Pages。
Project URL 與 publishable key 放在儲存庫的 Settings → Secrets and variables → Actions（`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`）。
