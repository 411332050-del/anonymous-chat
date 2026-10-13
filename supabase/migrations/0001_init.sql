-- 匿名聊天室：資料庫初始設定（docs/architecture.md 第 3.2、5、9 節）
--
-- 貼到 Supabase 後台 SQL Editor 執行即可。
-- 可以重複執行：已經存在的東西會被覆蓋或略過，不會報錯，也不會刪除既有訊息。
--
-- 設計原則：前端的檢查只是體貼使用者，真正的把關全部在這裡。
--   * 訊息的「發言者、暱稱、時間」一律由資料庫填，前端傳什麼都無效
--   * 前端只被允許寫入 id 與 content 兩個欄位
--   * 沒有任何人能修改或刪除訊息
--   * 沒登入（沒有匿名身分）的請求完全讀不到、寫不進


-- ============================================================
-- 1. 暱稱表 profiles：每個匿名身分一個暱稱
-- ============================================================

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  nickname   text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Supabase 預設會把新資料表的所有權限開給前端，這裡先全部收回，再只開需要的
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- 只能看到自己的暱稱；寫入一律透過下面的 get_or_create_me()
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (user_id = (select auth.uid()));


-- ============================================================
-- 2. 暱稱產生器（內部使用，前端不能直接呼叫）
--    格式跟展示模式一致：「匿名貓咪 482」
-- ============================================================

create or replace function public.generate_nickname()
returns text
language sql
volatile
set search_path = ''
as $$
  select '匿名'
      || (array['貓咪','水獺','企鵝','狐狸','柴犬','浣熊','無尾熊','刺蝟','海豚','兔子','松鼠','貓頭鷹'])
           [1 + floor(random() * 12)::int]
      || ' '
      || lpad(floor(random() * 1000)::int::text, 3, '0');
$$;

revoke all on function public.generate_nickname() from public, anon, authenticated;


-- ============================================================
-- 3. get_or_create_me()：進入聊天室時呼叫
--    第一次呼叫會替這個匿名身分產生暱稱，之後都回傳同一個
-- ============================================================

create or replace function public.get_or_create_me()
returns table (author_id uuid, nickname text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  insert into public.profiles (user_id, nickname)
  values (v_uid, public.generate_nickname())
  on conflict (user_id) do nothing;

  return query
    select p.user_id, p.nickname
    from public.profiles p
    where p.user_id = v_uid;
end;
$$;

revoke all on function public.get_or_create_me() from public, anon;
grant execute on function public.get_or_create_me() to authenticated;


-- ============================================================
-- 4. 訊息表 messages
-- ============================================================

create table if not exists public.messages (
  -- 由前端發送時先產生（UUID），用來避免同一則訊息顯示兩次
  id         uuid primary key,
  -- 以下三欄由下面的 trigger 強制填入，前端無法指定
  author_id  uuid not null,
  nickname   text not null,
  created_at timestamptz not null default now(),
  content    text not null,
  constraint messages_content_length check (char_length(content) between 1 and 500)
);

-- 「取最近 50 則」與「載入更早的」都靠這個索引
create index if not exists messages_created_at_id_idx
  on public.messages (created_at desc, id desc);

-- 頻率限制要查「這個人最近發了幾則」
create index if not exists messages_author_created_at_idx
  on public.messages (author_id, created_at desc);

alter table public.messages enable row level security;

-- 先全部收回，再只開「讀取」與「新增（只限 id、content 兩欄）」。
-- 沒有 update、delete 權限，所以訊息發出後沒有任何人能改或刪。
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;
grant insert (id, content) on public.messages to authenticated;

drop policy if exists "messages_select_all" on public.messages;
create policy "messages_select_all"
  on public.messages
  for select
  to authenticated
  using (true);

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own"
  on public.messages
  for insert
  to authenticated
  with check (author_id = (select auth.uid()));


-- ============================================================
-- 5. 寫入前的把關 trigger
--    錯誤訊息的文字就是錯誤代碼，前端依此顯示對應提示：
--    EMPTY / TOO_LONG / RATE_LIMITED / NOT_AUTHENTICATED / NO_PROFILE
-- ============================================================

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
    -- 還沒呼叫過 get_or_create_me()
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
  v_content := regexp_replace(v_content, '^[\s   -     　]+', '');
  v_content := regexp_replace(v_content, '[\s   -     　]+$', '');

  if char_length(v_content) = 0 then
    raise exception 'EMPTY' using errcode = 'P0001';
  end if;
  if char_length(v_content) > 500 then
    raise exception 'TOO_LONG' using errcode = 'P0001';
  end if;

  new.content := v_content;

  -- 頻率限制：每人 10 秒內最多 5 則，且兩則之間至少間隔 0.5 秒。
  -- 先對「這個人」上鎖，避免同時送出多則繞過計數。
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

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

drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert
  before insert on public.messages
  for each row
  execute function public.messages_before_insert();


-- ============================================================
-- 6. 即時推送：新訊息寫入後立刻通知所有正在連線的瀏覽器
--    （在線人數用的是 Presence，不需要資料表，不用在這裡設定）
-- ============================================================

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
