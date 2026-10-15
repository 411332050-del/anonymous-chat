-- 匿名聊天室：重複訊息偵測（docs/architecture.md 第 5.4、9 節）
--
-- 貼到 Supabase 後台 SQL Editor 執行即可（要先執行過 0001、0002、0003）。
-- 可以重複執行，不會刪除任何訊息。
--
-- 規則：同一個人在 30 秒內送出「內容完全相同」的訊息，第二則起被拒絕（錯誤代碼 DUPLICATE）。
--   * 比對的是清理之後的內容（去掉隱形字元、頭尾空白之後）
--   * 同一個 id 重送不算重複：前端失敗重試時，若上一次其實已經寫入成功，
--     要讓資料庫回報「id 已存在」（前端視為成功），不能在這裡誤判成重複
--
-- 這份檔案重新定義 messages_before_insert()（0001 建立的寫入把關），
-- 內容與 0001 相同，只多了「重複訊息」這一關。trigger 本身不用動。

create or replace function public.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_nickname text;
  v_content  text;
  v_count    int;
  v_last     timestamptz;
  v_now      timestamptz := clock_timestamp();
begin
  -- 身分：一律以登入身分為準，忽略前端帶來的任何值
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select p.nickname into v_nickname
  from public.profiles p
  where p.user_id = v_uid;

  if v_nickname is null then
    -- 還沒呼叫過 enter_with_alias()
    raise exception 'NO_PROFILE' using errcode = 'P0001';
  end if;

  new.author_id  := v_uid;
  new.nickname   := v_nickname;
  new.created_at := v_now;

  -- 內容清理（規則與前端 src/rules 一致）
  v_content := new.content;
  -- 統一換行
  v_content := regexp_replace(v_content, '\r\n?', E'\n', 'g');
  -- 移除隱形字元：控制字元（換行除外）、零寬字元、文字方向控制字元、BOM
  v_content := regexp_replace(
    v_content,
    '[\u0001-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]',
    '', 'g');
  -- 連續換行最多保留一個空行
  v_content := regexp_replace(v_content, '\n{3,}', E'\n\n', 'g');
  -- 去掉頭尾空白（含全形空白、不換行空白）
  v_content := regexp_replace(v_content, '^[\s  -   　]+', '');
  v_content := regexp_replace(v_content, '[\s  -   　]+$', '');

  if char_length(v_content) = 0 then
    raise exception 'EMPTY' using errcode = 'P0001';
  end if;
  if char_length(v_content) > 500 then
    raise exception 'TOO_LONG' using errcode = 'P0001';
  end if;

  new.content := v_content;

  -- 先對「這個人」上鎖，避免同時送出多則繞過下面的計數與重複檢查。
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  -- 重複訊息：30 秒內同一個人送過內容完全相同的訊息（同一個 id 的重送不算）
  if exists (
    select 1
    from public.messages m
    where m.author_id = v_uid
      and m.content = v_content
      and m.id <> new.id
      and m.created_at > v_now - interval '30 seconds'
  ) then
    raise exception 'DUPLICATE' using errcode = 'P0001';
  end if;

  -- 頻率限制：每人 10 秒內最多 5 則，且兩則之間至少間隔 0.5 秒。
  select count(*), max(m.created_at)
    into v_count, v_last
  from public.messages m
  where m.author_id = v_uid
    and m.created_at > v_now - interval '10 seconds';

  if v_count >= 5 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  if v_last is not null and v_now - v_last < interval '0.5 seconds' then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.messages_before_insert() from public, anon, authenticated;

-- trigger 已在 0001 建立並指向這個函式名稱；為保險起見重建一次（結果相同）
drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert
  before insert on public.messages
  for each row
  execute function public.messages_before_insert();
