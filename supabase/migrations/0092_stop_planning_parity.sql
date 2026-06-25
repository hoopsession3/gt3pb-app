-- 0092 — TRUCK-STOP PLANNING PARITY. Until now the run-of-show planner (event_schedule_items) and
-- brew scheduling (brew_batches) hung off events only, so an on-the-ground truck stop couldn't get a
-- "when to leave" schedule or a "start brewing by X" plan the way an event could. event_tasks already
-- supports both owners (event_id | stop_id); this brings the schedule + brew tables to the same shape,
-- and gives stops their own plan_days so the day planner works for a multi-day stop too.

-- ── Run of show: let a schedule item belong to an event OR a stop (exactly one) ──
alter table public.event_schedule_items alter column event_id drop not null;
alter table public.event_schedule_items add column if not exists stop_id uuid references public.stops(id) on delete cascade;
alter table public.event_schedule_items drop constraint if exists esi_one_owner;
alter table public.event_schedule_items add constraint esi_one_owner
  check ((event_id is not null) <> (stop_id is not null));
create index if not exists esi_stop on public.event_schedule_items(stop_id, day_index);
-- (RLS is unchanged: staff read / leadership write, neither keyed to the owner column, so stop rows
--  are governed exactly like event rows.)

-- ── Stops get plan_days, mirroring events, so the day planner can span a multi-day stop ──
alter table public.stops add column if not exists plan_days int not null default 1;

-- ── Brew: a batch can be back-scheduled to be ready for a stop, not just an event ──
alter table public.brew_batches add column if not exists stop_id uuid references public.stops(id) on delete set null;
create index if not exists brew_batches_stop on public.brew_batches(stop_id);
