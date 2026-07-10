-- 0157 · THE ALERT SPINE — one fan-out, per-user read state, staff-wide access.
--
-- The audit found a split-brain delivery contract: the server helper inserted AND directly invoked
-- the push edge function, the client helper inserted and assumed a database webhook did the fan-out
-- (it didn't exist), and three pg_cron SQL producers (brew ladder 0084/0145, task-due 0104,
-- stale-order 0120) inserted with no fan-out at all — so critical brew-start windows never reached
-- a phone. This migration makes the INSERT itself the whole contract:
--
--   insert into alerts  ──►  alerts_push_fanout trigger  ──►  push edge function (web push + Teams)
--
-- Every producer — server route, client component, SQL cron — fans out identically. The app-side
-- direct invokes are deleted in the same release (lib/serverAlerts.ts), so nothing double-fires.
-- The Authorization bearer below is the PUBLIC anon key (it ships in every page load by design);
-- the push function does its own service-role work via injected env, the JWT just passes the
-- platform's verify_jwt gate.

drop trigger if exists alerts_push_fanout on public.alerts;
create trigger alerts_push_fanout
  after insert on public.alerts
  for each row
  execute function supabase_functions.http_request(
    'https://hmpxgomiiyjjxxxyzzbg.supabase.co/functions/v1/push',
    'POST',
    '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_aeYihzpWTJVH8CqULvkeww_7tCxi07p"}',
    '{}',
    '5000'
  );

-- ── Per-user read state for broadcasts ──
-- "Got it" used to set ack_at on the row — one leader's tap dismissed a broadcast for the whole
-- team. Targeted alerts keep row-level ack (they belong to one person; the escalation ladder reads
-- ack_at). Broadcasts (target_user_id is null) are now dismissed per-person here.
create table if not exists public.alert_reads (
  alert_id  uuid not null references public.alerts(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  read_at   timestamptz not null default now(),
  primary key (alert_id, user_id)
);
alter table public.alert_reads enable row level security;
drop policy if exists "own reads" on public.alert_reads;
create policy "own reads" on public.alert_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Staff-wide access ──
-- Old policies were leadership-only for SELECT/INSERT/UPDATE. Two consequences the audit hit:
-- DriverRun's alerts silently failed for non-leader drivers (INSERT denied), and crew roles had no
-- pings surface at all (SELECT denied). Now: any staff can raise an alert; leadership reads all;
-- crew reads broadcasts + their own pings; ack-update follows read visibility.
drop policy if exists "alerts leadership read" on public.alerts;
create policy "alerts staff read" on public.alerts for select
  using ((select exists (select 1 from public.profiles where id = auth.uid()
           and role in ('server','contractor','operator','event_manager','admin','owner')))
         and (target_user_id is null or target_user_id = auth.uid()
              or (select exists (select 1 from public.profiles where id = auth.uid()
                   and role in ('event_manager','admin','owner')))));
drop policy if exists "alerts leadership insert" on public.alerts;
create policy "alerts staff insert" on public.alerts for insert to authenticated
  with check ((select exists (select 1 from public.profiles where id = auth.uid()
           and role in ('server','contractor','operator','event_manager','admin','owner'))));
drop policy if exists "alerts leadership update" on public.alerts;
create policy "alerts staff update" on public.alerts for update
  using ((select exists (select 1 from public.profiles where id = auth.uid()
           and role in ('server','contractor','operator','event_manager','admin','owner'))))
  with check ((select exists (select 1 from public.profiles where id = auth.uid()
           and role in ('server','contractor','operator','event_manager','admin','owner'))));

-- verify footer:
--   select tgname from pg_trigger where tgrelid = 'public.alerts'::regclass and tgname='alerts_push_fanout';
--   select count(*) from pg_policies where tablename='alerts';
--   select count(*) from public.alert_reads;
