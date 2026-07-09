-- 0146 — PACK LIFECYCLE. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Reserved packs had only a terminal "picked up" flag — no way to move a pack through its real
-- fulfillment path or show the customer where it is. This adds a `stage` the crew advances from the
-- drop board (Now → the drop / Service), and that the customer sees live on their pack card:
--   reserved → preparing → ready → en_route → picked_up
-- `picked_up` (bool) stays the terminal source of truth for counts/history and is kept in sync with
-- the stage by a trigger, so all existing code (progress line, past-drops, MyPacks) keeps working.

alter table public.drop_orders add column if not exists stage text not null default 'reserved'
  check (stage in ('reserved', 'preparing', 'ready', 'en_route', 'picked_up'));

-- Backfill: anything already picked up starts at the terminal stage.
update public.drop_orders set stage = 'picked_up' where picked_up = true and stage <> 'picked_up';

-- Keep the boolean and the stage from ever disagreeing, whichever one a writer touches.
create or replace function public.sync_drop_stage()
returns trigger language plpgsql as $$
begin
  if new.stage is distinct from old.stage then
    new.picked_up := (new.stage = 'picked_up');            -- stage drove the change
  elsif new.picked_up is distinct from old.picked_up then
    new.stage := case when new.picked_up then 'picked_up'   -- the legacy bool drove it
                      when old.stage = 'picked_up' then 'ready'
                      else new.stage end;
  end if;
  return new;
end $$;

drop trigger if exists sync_drop_stage_tg on public.drop_orders;
create trigger sync_drop_stage_tg before update on public.drop_orders
  for each row execute function public.sync_drop_stage();

-- verify:
--   select stage, picked_up, count(*) from public.drop_orders group by 1, 2;
