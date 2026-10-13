# 匿名聊天室

匿名公開聊天室。目前是**階段一（展示模式）**：不接 Supabase，訊息只存在你的瀏覽器。
架構說明見 `docs/architecture.md`，畫面設計見 `docs/design.md`。

## 本機啟動

```
npm install
npm run dev
```

打開終端機顯示的網址。想測斷線、傳送失敗等情況，在網址後面加 `?debug=1`。

## 打包

```
npm run build     # 輸出到 dist/
npm run preview   # 預覽打包後的結果（會用 /anonymous-chat/ 這個子路徑）
```

## 部署

推到 `main` 分支後，GitHub Actions（`.github/workflows/deploy.yml`）會自動打包並上架到 GitHub Pages。
第一次使用要到儲存庫的 Settings → Pages，把來源選成「GitHub Actions」。
