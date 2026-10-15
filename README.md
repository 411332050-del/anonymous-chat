# 匿名聊天室

匿名公開聊天室。前端用 React、TypeScript、Vite，部署在 GitHub Pages；後端用 Supabase（資料庫、即時推送、在線人數、匿名登入）。
架構說明見 `docs/architecture.md`，需求見 `docs/requirements.md`，畫面設計見 `docs/design.md`。

目前是**階段二**：正式模式連 Supabase。階段一的展示模式（假服務，訊息只存在你的瀏覽器）仍保留，方便測試。

## 進入方式

1. 打開網址，第一個看到的是進入畫面。
2. 在「代號」輸入框輸入代號（去頭尾空白後 1～12 字；不合格時按鈕停用並顯示原因）。
3. 按「進入聊天室」（或在輸入框按 Enter）。

進入後你的名稱是「代號＋3 碼編號」，例如「小明#371」，顯示在聊天室頂部的「你是：」。編號由資料庫產生，同一個匿名身分固定不變，無法自己指定。

## 新增功能

| 功能 | 在畫面上怎麼看到 |
|---|---|
| ① 資料庫強制發送頻率限制（10 秒 5 則、間隔 0.5 秒） | 連續快速送出訊息，超過限制時輸入框上方出現「發言太快了，請稍等幾秒」，幾秒後自動消失。 |
| ② 伺服器端內容清理（移除零寬與方向控制字元、連續換行折成 2 個、去頭尾空白） | 送出含零寬字元、很多空行或頭尾空白的訊息，顯示出來的是清理後的版本：隱形字元不見、最多只留一個空行、頭尾沒有空白。 |
| ③ 匿名登入＋代號後面由資料庫產生的 #編號，名稱無法偽造 | 進入後頂部顯示「你是：小明#371」；重新進入編號不變，換瀏覽器編號不同，自己無法指定編號。 |
| ④ 往上捲動載入更早的訊息 | 在訊息區往上捲到頂會載入更早 50 則；全部載完顯示「已經是最早的訊息」；載入失敗顯示「載入更早的訊息失敗」與「重試」按鈕。 |
| ⑤ 訊息傳送狀態 | 自己送出的訊息旁依序顯示「傳送中」→「已送出」；失敗時顯示「失敗」，點擊即可重試。 |
| ⑥ 收到的訊息先驗證格式才顯示 | 格式不合（id 非 UUID、暱稱不是 1–20 字、內容不是 1–500 字、時間無法解析等）的訊息不會出現在畫面上，只在瀏覽器開發者工具的 Console 留下一行警告；通過的訊息一律以純文字顯示，貼上 `<b>粗體</b>` 會原樣顯示而不變粗體。 |
| ⑦ 線上名單、進出提示與離開按鈕 | 點頂部「目前 N 人在線」展開名單（完整名稱，自己標「（你）」）；有人進來或離開時，頂部下方顯示（6 秒，可疊加）「某某 進來了／離開了」。 |

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

不使用 Supabase CLI。依 `supabase/README.md` 的說明，依序把 `supabase/migrations/0001_init.sql`、`supabase/migrations/0002_alias.sql`（代號功能）貼到後台 SQL Editor 執行。

## 打包

```
npm run build     # 輸出到 dist/
npm run preview   # 預覽打包後的結果（會用 /anonymous-chat/ 這個子路徑）
```

## 部署

推到 `main` 分支後，GitHub Actions（`.github/workflows/deploy.yml`）會自動打包並上架到 GitHub Pages。
Project URL 與 publishable key 放在儲存庫的 Settings → Secrets and variables → Actions（`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`）。
