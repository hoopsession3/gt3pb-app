-- 0133 — CLIENT ERROR TELEMETRY. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- "Can you tell when it breaks?" — audit finding #6. The app had a calm error boundary but no
-- visibility: a customer's white-screen was invisible until a complaint. This table receives
-- deduplicated client-side error reports (via /api/errors/report, service-role writes only).
-- One row per unique error fingerprint; repeats bump `count`/`last_seen` instead of flooding.
-- The FIRST occurrence of a new fingerprint also raises a row in `alerts` (the existing crew
-- inbox + push ladder), so a new breakage during service is seen in minutes, not at churn time.

create table if not exists public.client_errors (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  fingerprint  text unique not null,          -- sha256 of message + top frame + path (server-computed)
  message      text not null,                 -- capped by the route
  stack        text,                          -- first frames only, capped by the route
  url          text,                          -- page path where it happened
  ua           text,                          -- user agent (family only is fine)
  fatal        boolean not null default false,-- true = error-boundary hit (white-screen class)
  count        integer not null default 1,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now()
);

create index if not exists client_errors_last_seen_idx on public.client_errors(last_seen desc);

alter table public.client_errors enable row level security;

-- Staff read the log; nobody writes through PostgREST (the report route uses the service role,
-- which bypasses RLS — so no insert/update policy exists on purpose; fails closed).
drop policy if exists "client errors staff read" on public.client_errors;
create policy "client errors staff read" on public.client_errors
  for select using ((select public.is_staff()));

-- Dedup bump: returns true if the fingerprint existed (and was counted), false if it's new.
-- Server-route only — not for browsers, so execute is revoked from API roles.
create or replace function public.bump_client_error(p_fingerprint text)
returns boolean language sql security definer set search_path = public as $$
  with u as (
    update public.client_errors set count = count + 1, last_seen = now()
    where fingerprint = p_fingerprint returning 1
  ) select exists(select 1 from u);
$$;
revoke execute on function public.bump_client_error(text) from anon, authenticated;

-- Housekeeping: errors older than 90 days with no recurrence roll off (called by the existing
-- daily cron alongside the other retention jobs; safe to run any time).
create or replace function public.prune_client_errors()
returns void language sql security definer set search_path = public as $$
  delete from public.client_errors where last_seen < now() - interval '90 days';
$$;

-- verify:
--   select count(*) from public.client_errors;                          -- 0 on first run
--   select relrowsecurity from pg_class where relname = 'client_errors'; -- t
