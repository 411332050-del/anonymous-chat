# Supabase 資料庫設定

這個資料夾是「資料庫設定的文字紀錄」。不使用 Supabase CLI，所有設定都手動貼到網頁後台執行。

## 檔案

| 檔案 | 內容 |
|---|---|
| `migrations/0001_init.sql` | 建立暱稱表、訊息表、權限規則、寫入把關、即時推送 |
| `migrations/0002_alias.sql` | 進入時輸入代號：`profiles` 加固定編號欄位，新增 `enter_with_alias(p_alias)` |

## 怎麼套用

1. 開啟 Supabase 後台，選你的專案。
2. 左側點 **SQL Editor**，點 **New query**。
3. 把 `migrations/0001_init.sql` 的內容整份貼上，按右下角 **Run**。
4. 下方顯示 `Success` 就完成。出現紅字錯誤時，把整段文字貼給我。
5. 再點 **New query**，對 `migrations/0002_alias.sql` 重複第 3、4 步。

兩個檔案都可以重複執行，不會刪除既有訊息。

套用順序：先 0001，再 0002。0001 裡的 `generate_nickname()`（產生「匿名貓咪 482」）與 `get_or_create_me()` 已被 0002 的 `enter_with_alias()` 取代，前端不再呼叫；為了不改動 0001，這兩個函式保留但不使用。0002 套用前，新版網頁會無法進入聊天室。

### 確認 0002 有套用成功

在 SQL Editor 執行下面這段，應該看到兩列，分別是 `column | tag` 和 `function | enter_with_alias`：

```sql
select 'column' as kind, column_name as name
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'tag'
union all
select 'function', proname
from pg_proc
where proname = 'enter_with_alias';
```

最後打開網頁，輸入代號進入聊天室，畫面上自己的名稱應該是「代號#三碼數字」。換一個代號重新進入，編號不會變。

## 它做了什麼

- `profiles`：每個匿名身分一個暱稱，由資料庫產生。
- `messages`：存訊息。發言者、暱稱、時間由資料庫填，前端只能寫入 `id` 與 `content`。
- 沒有任何人能修改或刪除訊息。
- 寫入前自動檢查：1～500 字、清掉隱形字元、折疊連續換行、每人 10 秒最多 5 則且間隔至少 0.5 秒。
- 把 `messages` 加入 Realtime，新訊息會即時推送。

## 錯誤代碼

資料庫拒絕訊息時，錯誤訊息的文字就是代碼，前端依此顯示提示：

`EMPTY`、`TOO_LONG`、`RATE_LIMITED`、`NOT_AUTHENTICATED`、`NO_PROFILE`

`NO_PROFILE` 代表還沒呼叫過 `enter_with_alias()`；前端進入聊天室時一定會先呼叫它。`enter_with_alias()` 自己可能丟出 `NOT_AUTHENTICATED`、`INVALID_ALIAS`（代號去頭尾空白後不是 1～12 字）。

## 金鑰

這個專案只會用到 Project URL 與 publishable key（可公開金鑰）。**不要使用 secret key，也不要把資料庫密碼放進任何檔案。**
