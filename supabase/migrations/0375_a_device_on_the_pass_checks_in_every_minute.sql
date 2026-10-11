-- ── 0375 — A DEVICE ON THE PASS CHECKS IN EVERY MINUTE ───────────────────────────────────────────────────────
-- 2026-10-11 (the KDS program, wave 2: devices).
--
-- WHY. Nothing anywhere said which phone or iPad had the Pass open, or whether it could hear an order. The Pass's
-- orders feed has no health check of its own, a sleeping iPad looks exactly like a working one, and the only sign the
-- Pass had gone deaf was a ticket ten minutes old (alert_stale_orders, 0369) — or a customer at the window asking.
-- The audit of the kitchen display put it in two lines: each device's last sync is "never recorded anywhere", and a
-- Pass device offline or on a stale feed raises "none".
--
-- WHAT. Each device that has the Pass open says so once a minute, and again the moment anything about it changes
-- (components/usePassHeartbeat, lib/heartbeat). The database keeps the latest word, one row per device and screen:
--
--   device_heartbeats     keyed (tenant_id, device_id, surface)
--     device_id           a random id the app keeps per install (localStorage). A page that cannot keep one sends a
--                         new id each visit; its rows age out like any other.
--     surface             which screen: 'pass' today ('live_ops' and 'driver' have room to come)
--     app, app_build      'web' or 'ios', and which build: the web's commit, the app's version (build)
--     feed                the Pass's own word on its orders feed — live, reconnecting, down, signed-out — or unknown:
--                         not said yet (a build whose Pass does not report it, or the first moment after it opens)
--     alerts_on           whether this device can be pushed a new order: the answer Live Ops' alerts-off line reads
--                         (components/DeviceAlerts, components/AppAlerts)
--     wake_lock           whether the screen is being kept on (lib/useWakeLock)
--     user_id, last_seen  who was signed in on it, and when it last said so, by the database's clock
--
--   crew_heartbeat(...)          the only write. It stamps the tenant (effective_tenant(), 0134) and the person
--                                (auth.uid()) itself, so a page names neither, and refuses anyone not on the crew:
--                                is_staff(), the test staff_set_order_status asks (0368). A device that changes hands
--                                is whoever is signed in on it now, as a push device is (0366).
--   crew_devices()               what Live Ops' Devices card reads (components/crew/DevicesCard): the devices heard
--                                from in the last ten minutes, each with the name of whoever is on it. For the leaders
--                                — event_manager, admin, owner, the people the card is drawn for (canManage). profiles
--                                shows an event manager nobody's row but their own (0001, 0003), so the names come
--                                through here, and only these.
--   prune_device_heartbeats(7)   daily, from pg_cron: a row not heard from in seven days goes.
--
-- WHO READS IT. The crew, of their own business: the select policy is is_staff(), under 0134's restrictive tenant
-- isolation, as job_runs' is (0356). Nobody writes it but the function. anon holds nothing and authenticated holds
-- select alone — Supabase grants every new table to both, so the rest is revoked by name (0371). Deleting an account
-- takes its devices' rows with it (on delete cascade): they say nothing but where that person's devices were.
--
-- NOT REALTIME, ON PURPOSE. The card asks every thirty seconds instead of joining supabase_realtime: a beat a minute
-- from every Pass device would be an update a minute to every open console, for a card that is read at a glance.
--
-- ORDER. Paste it any time. Before the deploy that sends the beats, nothing writes here. Pasted after, the beats that
-- failed until now (PGRST202, quietly — lib/heartbeat sendBeat) land with the next one, a minute later at most, and the
-- card appears. The watchdog that reads this table is 0376's, and its header says when to paste it.

create table if not exists public.device_heartbeats (
  tenant_id  uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  device_id  text not null check (device_id ~ '^[A-Za-z0-9-]{8,64}$'),
  surface    text not null check (surface ~ '^[a-z][a-z_]{1,23}$'),
  user_id    uuid not null references auth.users(id) on delete cascade,
  app        text not null check (app in ('web', 'ios')),
  app_build  text check (app_build is null or char_length(app_build) between 1 and 40),
  feed       text not null default 'unknown' check (feed in ('live', 'reconnecting', 'down', 'signed-out', 'unknown')),
  alerts_on  boolean not null default false,
  wake_lock  boolean not null default false,
  last_seen  timestamptz not null default now(),
  primary key (tenant_id, device_id, surface)
);
create index if not exists device_heartbeats_recent on public.device_heartbeats (tenant_id, surface, last_seen desc);

-- 0134's two, which its own loop gave only the tables that existed when it ran: the caller's tenant stamped on insert,
-- and rows of another business out of reach.
drop trigger if exists stamp_tenant_tg on public.device_heartbeats;
create trigger stamp_tenant_tg before insert on public.device_heartbeats for each row execute function public.stamp_tenant();

alter table public.device_heartbeats enable row level security;
drop policy if exists "device heartbeats staff read" on public.device_heartbeats;
create policy "device heartbeats staff read" on public.device_heartbeats for select using ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.device_heartbeats;
create policy "tenant isolation" on public.device_heartbeats as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
-- No insert, update or delete policy, on purpose: crew_heartbeat is the one write. The grants say the same.
revoke all on public.device_heartbeats from public, anon, authenticated;
grant select on public.device_heartbeats to authenticated;
grant select, insert, update, delete on public.device_heartbeats to service_role;

comment on table public.device_heartbeats is
  'The latest word from each crew device on each screen (0375): which device, who was signed in on it, the app and build, the Pass''s orders feed (live/reconnecting/down/signed-out/unknown), whether it can be pushed an order, whether its screen is kept on, and when it last said so. Written only by crew_heartbeat; read by Live Ops'' Devices card (crew_devices) and the Pass watchdog (0376). Pruned after seven days.';

-- ── THE ONE WRITE ────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.crew_heartbeat(
  p_device    text,
  p_surface   text,
  p_app       text,
  p_app_build text    default null,
  p_feed      text    default 'unknown',
  p_alerts_on boolean default false,
  p_wake_lock boolean default false)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_tenant uuid := public.effective_tenant();
  v_build  text := left(nullif(btrim(coalesce(p_app_build, '')), ''), 40);
  v_at     timestamptz := now();
begin
  if v_user is null or not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- The table's own checks, said first in words a person can read (22023, a 4xx — 0360).
  if coalesce(p_device, '') !~ '^[A-Za-z0-9-]{8,64}$' then
    raise exception 'That isn''t a device id.' using errcode = '22023';
  end if;
  if coalesce(p_surface, '') !~ '^[a-z][a-z_]{1,23}$' then
    raise exception 'That isn''t a screen.' using errcode = '22023';
  end if;
  if p_app is null or p_app not in ('web', 'ios') then
    raise exception 'That isn''t an app.' using errcode = '22023';
  end if;
  if p_feed is null or p_feed not in ('live', 'reconnecting', 'down', 'signed-out', 'unknown') then
    raise exception 'That isn''t a feed.' using errcode = '22023';
  end if;

  insert into public.device_heartbeats as h
         (tenant_id, device_id, surface, user_id, app, app_build, feed, alerts_on, wake_lock, last_seen)
  values (v_tenant, p_device, p_surface, v_user, p_app, v_build, p_feed, coalesce(p_alerts_on, false), coalesce(p_wake_lock, false), v_at)
  on conflict (tenant_id, device_id, surface) do update set
    user_id   = excluded.user_id,      -- whoever is signed in on it now (0366's rule for a device)
    app       = excluded.app,
    app_build = excluded.app_build,
    feed      = excluded.feed,
    alerts_on = excluded.alerts_on,
    wake_lock = excluded.wake_lock,
    last_seen = excluded.last_seen;
  return v_at;
end $$;
revoke all on function public.crew_heartbeat(text, text, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.crew_heartbeat(text, text, text, text, text, boolean, boolean) to authenticated;

comment on function public.crew_heartbeat(text, text, text, text, text, boolean, boolean) is
  'A crew device says it is on a screen (0375): the one write to device_heartbeats. Stamps the tenant (effective_tenant) and the person (auth.uid) itself; refuses anyone not on the crew (is_staff); answers the database''s time of the beat.';

-- ── WHAT THE DEVICES CARD READS ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.crew_devices()
returns table (device_id text, surface text, user_id uuid, display_name text, role text, app text, app_build text,
               feed text, alerts_on boolean, wake_lock boolean, last_seen timestamptz, seen_s integer)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.is_admin() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'event_manager')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- seen_s is counted here, by the clock that stamped last_seen, so a phone whose own clock is off still reads
  -- "seen 12 s ago" truly.
  return query
    select h.device_id, h.surface, h.user_id, p.display_name, p.role, h.app, h.app_build, h.feed, h.alerts_on, h.wake_lock,
           h.last_seen, greatest(0, floor(extract(epoch from (now() - h.last_seen))))::integer
      from public.device_heartbeats h
      left join public.profiles p on p.id = h.user_id
     where h.tenant_id = public.effective_tenant()
       and h.last_seen > now() - interval '10 minutes'
     order by (h.surface = 'pass') desc, h.last_seen desc;
end $$;
revoke all on function public.crew_devices() from public, anon;
grant execute on function public.crew_devices() to authenticated;

comment on function public.crew_devices() is
  'Live Ops'' Devices card (0375): every device of the caller''s business heard from in the last ten minutes, with the name and role of whoever is on it and seconds since it last checked in. Leaders only (event_manager, admin, owner).';

-- ── SEVEN DAYS, THEN GONE ────────────────────────────────────────────────────────────────────────────────────────
-- Every business's rows: the clock is the rule here, not the caller, as it is for 0258's sweep. greatest(…, 1) so a
-- mistaken 0 cannot empty the table of devices that are on the Pass right now.
create or replace function public.prune_device_heartbeats(p_days int default 7) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.device_heartbeats
   where last_seen < now() - make_interval(days => greatest(coalesce(p_days, 7), 1));
  get diagnostics n = row_count;
  return n;
end $$;
-- A cron job's: nothing in the app calls it.
revoke all on function public.prune_device_heartbeats(int) from public, anon, authenticated;

-- Daily, off the top of the hour. Unscheduled first so a second run leaves one job; guarded so this applies where
-- pg_cron is not enabled.
do $$ begin perform cron.unschedule('prune-device-heartbeats'); exception when others then null; end $$;
do $$ begin perform cron.schedule('prune-device-heartbeats', '29 4 * * *', 'select public.prune_device_heartbeats(7)'); exception when others then null; end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Live Ops shows which devices are on the Pass','feature','Ops',
   'Live Ops has a Devices card for managers: every phone or iPad that has had the Pass open in the last ten minutes, who is signed in on it, whether its orders feed is live, whether it can get order alerts, and when it last checked in. A device on the Pass checks in once a minute, and the moment any of that changes.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select relrowsecurity from pg_class where oid = 'public.device_heartbeats'::regclass;                       -- t
--   select has_table_privilege('anon', 'public.device_heartbeats', 'select'),
--          has_table_privilege('authenticated', 'public.device_heartbeats', 'insert');                          -- f, f
--   select has_function_privilege('anon', 'public.crew_heartbeat(text,text,text,text,text,boolean,boolean)', 'execute');  -- f
--   select jobname, schedule from cron.job where jobname = 'prune-device-heartbeats';                           -- one, daily
--   select surface, feed, count(*) from public.device_heartbeats where last_seen > now() - interval '10 minutes' group by 1, 2;
select public.record_migration('0375_a_device_on_the_pass_checks_in_every_minute');
