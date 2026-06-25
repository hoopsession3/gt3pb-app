-- 0094 — STOP CREW + SIGN-OFF. Make a truck stop operate exactly like an event: staff it with crew,
-- tag managers, and run prep sign-off. event_staff + event_approvals already key off event_id; this
-- lets them belong to a stop instead (exactly one owner), mirroring event_tasks / event_schedule_items.

-- ── Crew roster: an event_staff row belongs to an event OR a stop ──
alter table public.event_staff alter column event_id drop not null;
alter table public.event_staff add column if not exists stop_id uuid references public.stops(id) on delete cascade;
alter table public.event_staff drop constraint if exists event_staff_one_owner;
alter table public.event_staff add constraint event_staff_one_owner
  check ((event_id is not null) <> (stop_id is not null));
-- the legacy unique(event_id,user_id) treats NULLs as distinct, so it won't dedupe stop crew — add a
-- partial unique for the stop side.
create unique index if not exists event_staff_stop_user on public.event_staff(stop_id, user_id) where stop_id is not null;
create index if not exists event_staff_stop on public.event_staff(stop_id);

-- ── Prep sign-off: an approval belongs to an event OR a stop ──
alter table public.event_approvals alter column event_id drop not null;
alter table public.event_approvals add column if not exists stop_id uuid references public.stops(id) on delete cascade;
alter table public.event_approvals drop constraint if exists event_approvals_one_owner;
alter table public.event_approvals add constraint event_approvals_one_owner
  check ((event_id is not null) <> (stop_id is not null));
create unique index if not exists event_approvals_stop_appr on public.event_approvals(stop_id, approver_id) where stop_id is not null;

-- (RLS on both tables is is_staff() read / is_admin() write — not keyed to the owner column — so stop
--  rows are governed exactly like event rows.)
