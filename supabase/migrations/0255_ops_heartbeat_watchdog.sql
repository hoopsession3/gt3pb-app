-- 0255 · OPS HEARTBEAT WATCHDOG (2026-07-30 — the "crash/error/outage email" round, part 3).
-- /api/health stamps ops_heartbeat on every healthy check (an external uptime monitor pings it
-- every few minutes, so a healthy stack = a fresh stamp). This watchdog runs in pg_cron every
-- 10 minutes and raises ONE critical alert — push + admin email via the existing alert spine —
-- when the stamps stop while Supabase itself is still up. Known blind spot, by design: if
-- Supabase is down this can't run — that outage belongs to the external monitor, which needs no
-- part of this stack to notice and email. One alert per outage: it fires once when the stamp
-- goes stale and re-arms only after a fresh stamp lands (see the created_at > seen_at guard).

create table if not exists public.ops_heartbeat (
  id int primary key,
  seen_at timestamptz not null default now(),
  source text
);
alter table public.ops_heartbeat enable row level security; -- service-role only; no policies on purpose

-- Seed at apply time: a 30-minute grace window, then — until a monitor (or anyone) actually hits
-- /api/health — the watchdog sends its one "heartbeat lost" email. That first email is a feature:
-- it proves the whole alert→email chain live AND points out the monitor isn't wired yet.
insert into public.ops_heartbeat (id, seen_at, source) values (1, now(), 'seed')
on conflict (id) do nothing;

create or replace function public.heartbeat_watchdog() returns void
language plpgsql security definer set search_path = public as $$
declare hb timestamptz;
begin
  select seen_at into hb from public.ops_heartbeat where id = 1;
  if hb is null or hb > now() - interval '30 minutes' then return; end if;

  -- One alert per outage: if we've alerted since this stamp went quiet, stay quiet too.
  if exists (select 1 from public.alerts where kind = 'heartbeat_stale' and created_at > hb) then return; end if;

  insert into public.alerts (severity, category, title, body, link, kind)
  values (
    'critical', 'system', 'App heartbeat lost',
    'No /api/health check-in since '||to_char(hb at time zone 'America/New_York', 'Dy Mon DD, HH12:MI AM')||' ET. '
      ||'The app or its uptime monitor stopped reaching the database — Supabase itself is up (this alert is proof).',
    '/crew', 'heartbeat_stale'
  );
end $$;

do $$ begin
  perform cron.schedule('heartbeat-watchdog', '*/10 * * * *', 'select public.heartbeat_watchdog()');
exception when others then null; end $$;
