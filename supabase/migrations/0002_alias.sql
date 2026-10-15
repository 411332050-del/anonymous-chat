-- 匿名聊天室：進入時輸入代號（docs/architecture.md 第 6.1 節）
--
-- 貼到 Supabase 後台 SQL Editor 執行即可（要先執行過 0001_init.sql）。
-- 可以重複執行，不會刪除既有訊息或暱稱。
--
-- 名稱 ＝ 代號 ＋ 「#」＋ 3 碼編號，例如「小明#371」。
--   * 編號由資料庫產生，存在 profiles.tag；同一個匿名身分永遠是同一個編號
--   * 代號可以每次進入時改，編號不變
--   * 代號的檢查與清理在這裡做，前端傳什麼都不算數


-- ============================================================
-- 1. profiles 加一欄固定編號 tag
--    （舊資料沒有編號，第一次呼叫 enter_with_alias 時才補上）
-- ============================================================

alter table public.profiles add column if not exists tag text;


-- ============================================================
-- 2. enter_with_alias(p_alias)：按下「進入聊天室」時呼叫
--    錯誤訊息的文字就是錯誤代碼：NOT_AUTHENTICATED / INVALID_ALIAS
-- ============================================================

create or replace function public.enter_with_alias(p_alias text)
returns table (author_id uuid, nickname text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_alias text;
  v_tag   text;
  v_name  text;
  v_try   int := 0;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  v_alias := coalesce(p_alias, '');
  -- 移除控制字元（含換行）、零寬字元、文字方向控制字元、BOM（規則與前端 src/rules 一致）
  v_alias := regexp_replace(
    v_alias,
    '[\u0001-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]',
    '', 'g');
  -- 去掉頭尾空白（含全形空白、不換行空白）
  v_alias := regexp_replace(v_alias, '^[\s\u00A0\u2000-\u200A\u202F\u205F\u3000]+', '');
  v_alias := regexp_replace(v_alias, '[\s\u00A0\u2000-\u200A\u202F\u205F\u3000]+$', '');

  if char_length(v_alias) < 1 or char_length(v_alias) > 12 then
    raise exception 'INVALID_ALIAS' using errcode = 'P0001';
  end if;

  -- 同一個人同時進入時，避免兩邊各產生不同編號
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 1));

  select p.tag into v_tag
  from public.profiles p
  where p.user_id = v_uid;

  if v_tag is null then
    -- 第一次（或舊資料沒有編號）：產生 3 碼編號，盡量避開「同代號同編號」的人
    loop
      v_try := v_try + 1;
      v_tag := lpad(floor(random() * 1000)::int::text, 3, '0');
      exit when v_try >= 20
        or not exists (
          select 1 from public.profiles p
          where p.nickname = v_alias || '#' || v_tag and p.user_id <> v_uid
        );
    end loop;
  end if;

  v_name := v_alias || '#' || v_tag;

  insert into public.profiles (user_id, nickname, tag)
  values (v_uid, v_name, v_tag)
  on conflict (user_id) do update
    set nickname = excluded.nickname,
        tag      = excluded.tag;

  return query
    select p.user_id, p.nickname
    from public.profiles p
    where p.user_id = v_uid;
end;
$$;

revoke all on function public.enter_with_alias(text) from public, anon;
grant execute on function public.enter_with_alias(text) to authenticated;
