-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0177 · NOTIFICATION MANAGEMENT — snooze an alert, mute a category, set quiet hours (per person)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The alert spine is one table + one fanout (0157). What it lacked is the human's control over it.
-- Two small own-row tables: notif_prefs (which categories you mute, your quiet hours) and
-- alert_snoozes (an alert you've pushed to later). The inbox reads these and filters accordingly —
-- criticals are never muted or snoozed away. Both are per-user with own-row RLS.

create table if not exists public.notif_prefs (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  muted_categories text[] not null default '{}',   -- categories whose non-critical pings you don't want
  quiet_start      int,                             -- hour 0-23, local; null = no quiet window
  quiet_end        int,                             -- hour 0-23, local
  updated_at       timestamptz not null default now()
);
alter table public.notif_prefs enable row level security;
drop policy if exists "notif_prefs own" on public.notif_prefs;
create policy "notif_prefs own" on public.notif_prefs for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists public.alert_snoozes (
  user_id  uuid not null references auth.users(id) on delete cascade,
  alert_id uuid not null references public.alerts(id) on delete cascade,
  until    timestamptz not null,
  primary key (user_id, alert_id)
);
alter table public.alert_snoozes enable row level security;
drop policy if exists "alert_snoozes own" on public.alert_snoozes;
create policy "alert_snoozes own" on public.alert_snoozes for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Both tables ride realtime so a snooze/mute reflects on every open device at once.
do $$ begin
  alter publication supabase_realtime add table public.notif_prefs;
  alter publication supabase_realtime add table public.alert_snoozes;
exception when duplicate_object then null; end $$;

-- verify:
--   select count(*) from information_schema.tables where table_name in ('notif_prefs','alert_snoozes'); -- 2
--   select count(*) from pg_policies where tablename in ('notif_prefs','alert_snoozes');                -- 2
