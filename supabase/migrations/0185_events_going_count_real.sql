-- 0185 — make events.going_count REAL: maintained from the rsvps table, not hand-typed by an operator.
--
-- Before: going_count was a free-text number an operator typed on the crew event card (crew:4112),
-- completely disconnected from the RSVP button members tap (which writes rsvps.status='going') — a
-- vanity number on the same class as the removed streak_days. Now a trigger recomputes going_count =
-- (count of 'going' rsvps for that event) on every rsvps insert/update/delete, so the number members
-- see is the real headcount. The operator input becomes a read-only display.

create or replace function public.rsvps_recount_going()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  eid uuid := coalesce(new.event_id, old.event_id);
begin
  update public.events
     set going_count = (select count(*) from public.rsvps where event_id = eid and status = 'going')
   where id = eid;
  -- if an rsvp was moved between events, refresh the old event too
  if tg_op = 'UPDATE' and new.event_id is distinct from old.event_id then
    update public.events
       set going_count = (select count(*) from public.rsvps where event_id = old.event_id and status = 'going')
     where id = old.event_id;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists rsvps_recount_going on public.rsvps;
create trigger rsvps_recount_going
  after insert or update or delete on public.rsvps
  for each row execute function public.rsvps_recount_going();

-- backfill every event from the current rsvps so the count is truthful immediately
update public.events e
   set going_count = (select count(*) from public.rsvps r where r.event_id = e.id and r.status = 'going');

-- verify:
-- select e.id, e.going_count, (select count(*) from rsvps r where r.event_id=e.id and r.status='going') actual
--   from events e order by e.going_count desc;  -- going_count should equal actual for every row
