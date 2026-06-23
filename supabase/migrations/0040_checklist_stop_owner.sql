-- 0040 — checklists can belong to a truck STOP as well as an event (polymorphic owner).
-- Gives each truck location its own independent pick list, reusing the entire prep engine
-- (assign, supply/gear picker, My Tasks). Apply in Supabase → SQL Editor. Idempotent.

alter table public.event_tasks add column if not exists stop_id uuid references public.stops(id) on delete cascade;
-- event_id was NOT NULL; relax it so a row can instead belong to a stop.
alter table public.event_tasks alter column event_id drop not null;

-- Exactly one owner: an event XOR a stop (never both, never neither). Existing rows have
-- event_id set + stop_id null, so they satisfy this.
alter table public.event_tasks drop constraint if exists event_tasks_one_owner;
alter table public.event_tasks add constraint event_tasks_one_owner
  check (((event_id is not null)::int + (stop_id is not null)::int) = 1);

create index if not exists event_tasks_stop on public.event_tasks(stop_id);

-- RLS is unchanged: the existing event_tasks policies gate on is_staff()/is_admin(), not on a
-- specific owner column, so they already cover stop-owned rows. The 0038 re-open-approval
-- trigger deletes by event_id; for stop rows event_id is null, so it's a harmless no-op
-- (stops don't use the event-only approval workflow).
