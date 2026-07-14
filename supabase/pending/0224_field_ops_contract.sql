-- ⛔ 0224 — FIELD OPS CONTRACT (merge Phase 5). DO NOT APPLY until the soak gate is green:
--   GATE (amended 2026-07-14, Ryan's call — option C, since no real event lands inside the window):
--   7 consecutive green nights of the drift check below, plus at least one truck stop gone live and
--   one Monday office run operated on the spine. The event-day leg was DROPPED from the gate.
--   The nightly check is AUTOMATED: field_ops_drift() RPC (0227), called by a scheduled watcher
--   nightly at 23:30 ET; it pushes green/red. Manual runs any time via the query below.
--   Sits in supabase/pending/ so no tooling ever auto-applies it. Take a manual backup snapshot
--   (Supabase → Database → Backups) immediately before applying. This is the ONLY irreversible step.
--
-- ── the nightly / soak drift check (run any time; must return all zeros) ──────────────────────────
-- select 'field_ops missing' as chk, count(*) from (
--   select id from events union all select id from stops
--   except select id from field_ops) x
-- union all
-- select 'spine drift', count(*) from event_tasks
--   where coalesce(event_id, stop_id) is not null and field_op_id is distinct from coalesce(event_id, stop_id)
-- union all
-- select 'orders drift', count(*) from orders
--   where coalesce(event_id, stop_id) is not null and field_op_id is distinct from coalesce(event_id, stop_id)
-- union all
-- select 'stale spine (unlinked rows)', count(*) from event_tasks
--   where field_op_id is not null and event_id is null and stop_id is null;
--
-- ── writer-flip checklist (CODE, deploy before applying the SQL below) ────────────────────────────
-- The spine self-fills today, so these are mechanical renames (write field_ops + field_op_id
-- instead of events/stops + event_id/stop_id). Files measured: app/crew/page.tsx (CalEdit, builders,
-- prep hub), components/CompanyCalendar.tsx, EventPrepAI, TrailerLoadout, MenuRigChips, EventDayPlanner,
-- BrandCalendar (events read), app/truck/page.tsx, app/events/page.tsx, agents: dayplan, eventprep,
-- spaceplan, brew, troubleshoot, concierge; RPCs: active_event_id, set_live/set_live_where (0019/0124),
-- claim_reserve, stamp_order_event, report_events, generate_office_route readers; lib/ics, lib/eventbrief.
-- NOTE: stop liveness — field_ops.is_live is event-populated only; the flip must make set_live write
-- field_ops.is_live for stops too (today it's derived from live_status.current_stop_id).
-- NOTE: 0228 hygiene — re-point archive_stale_stops() + stop_recap_alerts() (cron jobs
-- 'archive-stale-stops' / 'stop-recap-asks') from stops to field_ops, and move stops.recap_asked_at
-- (plus the stop_ops.recap / legacy stops.recap reads) with the other stop columns in the drop step.
--
-- ── the contract SQL (finalize + apply only after the flip is deployed + soaked) ──────────────────
begin;
-- HARD GATE (machine-enforced, not a comment): applying without the signed-off soak row aborts.
-- Sign off with: insert into maintenance_log (kind, note) values ('field_ops_soak_pass', '7-day soak green');
do $$ begin
  if not exists (select 1 from public.maintenance_log where kind = 'field_ops_soak_pass') then
    raise exception '0224 gate: field_ops soak has not been signed off (maintenance_log kind=field_ops_soak_pass)';
  end if;
end $$;
-- 1. one-owner constraints move to the spine
alter table public.event_tasks drop constraint if exists event_tasks_one_owner;
alter table public.event_tasks add constraint event_tasks_one_owner
  check (((field_op_id is not null)::int + (meeting_note_id is not null)::int + (goal_id is not null)::int) = 1);
-- 2. live pointer moves to the spine
alter table public.live_status add column if not exists current_field_op_id uuid references public.field_ops(id);
update public.live_status set current_field_op_id = current_stop_id where current_stop_id is not null;
-- 3. drop the mirror + sync machinery
drop trigger if exists mirror_event_to_field_ops_tg on public.events;
drop trigger if exists mirror_stop_to_field_ops_tg on public.stops;
-- (sync_field_op_id_tg triggers stay until the old columns drop below)
-- 4. drop the old FK columns from all 21 dependents (loop, same list as 0223)
-- 5. drop the old tables
-- drop table public.stops; drop table public.events;
-- 6. tighten field_ops: kind-conditional NOT NULLs, final RLS (events world-readable stays; stop POC
--    fields MUST move behind staff-only access (MANDATORY — panel finding: venue-contact PII is
--    world-readable today on stops; the contract is where that legacy exposure ends), rename
--    name→title? NO — 'name' stays; it's the merged vocabulary.
commit;
