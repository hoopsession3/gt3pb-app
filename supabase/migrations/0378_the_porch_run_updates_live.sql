-- ── 0378 — THE PORCH RUN UPDATES LIVE ──────────────────────────────────────────────────────────────────
-- 2026-10-11 (the dispatch round).
--
-- Supabase sends a screen a table's changes only when two switches are on: the page subscribes (useRealtimeTable),
-- and the table is in the supabase_realtime publication. delivery_orders — the Sunday porches — was never added. The
-- 34 tables migrations added before 0248 are exactly the 34 that 0248 counted in production's publication, and
-- delivery_orders is not one of them; no migration since has added it. Three screens subscribe to it and hear nothing:
--
--   the Sunday card on Live Ops (components/DeliveryOps), and Due next's one list, which is built from what that card
--     reads: a porch the driver logged — delivered, held, not home — read as still out for delivery, or late, until
--     the console read again;
--   the driver's run (components/DriverRun): a porch the console marked out for delivery, or moved onto today's run,
--     did not appear until the driver's phone read again;
--   the customer's own delivery card (components/MyDeliveries): "On the way" and "Delivered" did not move in front of
--     the customer, which is what its subscription was written for.
--
-- The office route got this in 0357 ("the driver's run and the crew's route hear each other"); this is the porch run's.
-- The table joins the publication the way 0357, 0359 and 0370 add theirs: only if it is not a member already, and only
-- if the publication exists, so this runs the same on a database without realtime and runs twice without error.
--
-- What a screen is sent follows the table's own read rules, which do not change: realtime checks every inserted or
-- updated row against the subscriber's policies, so the crew are sent every porch (delivery staff read, 0139) and a
-- customer only their own (delivery own read, 0139). A delete, which no policy can check, would be sent as the row's id
-- alone, as for every table already in the publication — and a porch is never deleted (0141's guard refuses it).

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'delivery_orders') then
    alter publication supabase_realtime add table public.delivery_orders;
  end if;
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The Sunday porch run updates on every screen','fix','Delivery',
   'A porch the driver logged — delivered, held, not home — still read as out for delivery on Live Ops until someone reloaded it, a porch the crew sent out or moved onto today''s run did not appear on the driver''s phone, and a customer''s delivery card did not move from "Received" to "On the way". The run, the driver''s screen and the customer''s card now change the moment a porch does.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'delivery_orders');   -- t
select public.record_migration('0378_the_porch_run_updates_live');
