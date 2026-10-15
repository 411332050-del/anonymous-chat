-- 匿名聊天室：表情回應（docs/architecture.md 第 5、7、9 節）
--
-- 貼到 Supabase 後台 SQL Editor 執行即可（要先執行過 0001_init.sql 與 0002_alias.sql）。
-- 可以重複執行，不會刪除既有訊息或回應。
--
-- 設計原則（跟訊息一樣，真正的把關在資料庫）：
--   * 前端不能直接寫 reactions 表，只能呼叫 toggle_reaction()
--   * 表情只允許固定的 6 種，其他一律拒絕
--   * 回應的人一律是登入身分，前端傳什麼都沒用
--   * 同一個人對同一則訊息、同一種表情只會有一個；再按一次就收回
--   * 新增回應有頻率限制：每人 10 秒最多 10 次（收回不限）


-- ============================================================
-- 1. 回應表 reactions
-- ============================================================

create table if not exists public.reactions (
  message_id uuid        not null references public.messages (id) on delete cascade,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  emoji      text        not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  constraint reactions_emoji_allowed check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🎉'))
);

-- 頻率限制要查「這個人最近新增了幾次」
create index if not exists reactions_user_created_at_idx
  on public.reactions (user_id, created_at desc);

alter table public.reactions enable row level security;

-- 先全部收回，再只開「讀取」。沒有 insert／update／delete 權限，
-- 寫入一律透過下面的 toggle_reaction()。
revoke all on public.reactions from anon, authenticated;
grant select on public.reactions to authenticated;

drop policy if exists "reactions_select_all" on public.reactions;
create policy "reactions_select_all"
  on public.reactions
  for select
  to authenticated
  using (true);


-- ============================================================
-- 2. toggle_reaction(p_message_id, p_emoji)
--    沒有這個回應就新增並回傳 true；已經有就收回並回傳 false。
--    錯誤訊息的文字就是錯誤代碼：
--    NOT_AUTHENTICATED / INVALID_REACTION / NO_MESSAGE / RATE_LIMITED
-- ============================================================

create or replace function public.toggle_reaction(p_message_id uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if p_emoji is null or p_emoji not in ('👍', '❤️', '😂', '😮', '😢', '🎉') then
    raise exception 'INVALID_REACTION' using errcode = 'P0001';
  end if;

  if p_message_id is null
     or not exists (select 1 from public.messages m where m.id = p_message_id) then
    raise exception 'NO_MESSAGE' using errcode = 'P0001';
  end if;

  -- 同一個人同時按多下時排隊處理，避免繞過計數
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 2));

  -- 已經有 → 收回（不受頻率限制）
  delete from public.reactions r
  where r.message_id = p_message_id
    and r.user_id = v_uid
    and r.emoji = p_emoji;
  if found then
    return false;
  end if;

  -- 新增前先檢查頻率：每人 10 秒最多 10 次
  select count(*) into v_count
  from public.reactions r
  where r.user_id = v_uid
    and r.created_at > clock_timestamp() - interval '10 seconds';
  if v_count >= 10 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  insert into public.reactions (message_id, user_id, emoji, created_at)
  values (p_message_id, v_uid, p_emoji, clock_timestamp());
  return true;
end;
$$;

revoke all on function public.toggle_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_reaction(uuid, text) to authenticated;


-- ============================================================
-- 3. 即時推送：回應新增或收回後立刻通知所有正在連線的瀏覽器
-- ============================================================

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reactions'
  ) then
    alter publication supabase_realtime add table public.reactions;
  end if;
end;
$$;
