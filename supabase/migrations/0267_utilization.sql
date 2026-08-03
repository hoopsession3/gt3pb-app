-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0267 · UTILIZATION (2026-08-03 — Ryan: "setup user utilization metrics so you don't have to ask
-- me this no more — guest and user utilization. How many logins, last login, last user action
-- report, on the same database.")
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Two ledgers, same database, privacy-shaped:
--
--   user_activity — one row per signed-in user per day: logins, action count, last action, last
--                   seen. Written ONLY through the track_user() RPC (security definer), so the
--                   increment is atomic and no open insert/update policy exists to abuse.
--   guest_daily   — anonymous visitor counter, one row per day: page hits only. No device IDs,
--                   no fingerprints, no PII — a count is all the question needs. Written through
--                   track_guest() (security definer, granted to anon).
--
-- Reads are ADMIN-ONLY: utilization is management data — the owners' answer to "is the team in
-- the system," not a coworker-surveillance feed. Idempotent; apply after 0266.

create table if not exists public.user_activity (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  seen_on      date not null,
  logins       int  not null default 0,
  actions      int  not null default 0,
  last_action  text,
  last_seen_at timestamptz not null default now(),
  unique (user_id, seen_on)
);
create index if not exists user_activity_seen on public.user_activity(seen_on desc);
alter table public.user_activity enable row level security;
drop policy if exists "activity admin read" on public.user_activity;
create policy "activity admin read" on public.user_activity for select using ((select public.is_admin()));
-- no insert/update/delete policies: the definer RPC is the only writer.

create table if not exists public.guest_daily (
  day  date primary key,
  hits bigint not null default 0
);
alter table public.guest_daily enable row level security;
drop policy if exists "guest daily admin read" on public.guest_daily;
create policy "guest daily admin read" on public.guest_daily for select using ((select public.is_admin()));

-- ── the writers ─────────────────────────────────────────────────────────────────────────────────
-- track_user: bumps today's row for the CALLER (auth.uid() — a client cannot write anyone else's
-- activity). is_login increments the login counter; every call bumps actions + last_action.
create or replace function public.track_user(p_action text default null, p_is_login boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  insert into public.user_activity (user_id, seen_on, logins, actions, last_action, last_seen_at)
  values (uid, (now() at time zone 'America/New_York')::date, case when p_is_login then 1 else 0 end, 1, left(p_action, 120), now())
  on conflict (user_id, seen_on) do update set
    logins       = public.user_activity.logins + case when p_is_login then 1 else 0 end,
    actions      = public.user_activity.actions + 1,
    last_action  = coalesce(left(excluded.last_action, 120), public.user_activity.last_action),
    last_seen_at = now();
end $$;
grant execute on function public.track_user(text, boolean) to authenticated;

-- track_guest: bumps today's anonymous hit counter. Callable by anon; rate abuse only inflates a
-- count nobody bills on. ET business day, same clock as the rest of the app.
create or replace function public.track_guest() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.guest_daily (day, hits) values ((now() at time zone 'America/New_York')::date, 1)
  on conflict (day) do update set hits = public.guest_daily.hits + 1;
end $$;
grant execute on function public.track_guest() to anon, authenticated;

-- Verify (prod, after apply):
--   select count(*) from pg_policies where tablename in ('user_activity','guest_daily');  -- 2 (read-only)
--   select public.track_guest(); select hits from public.guest_daily order by day desc limit 1;  -- ≥ 1
