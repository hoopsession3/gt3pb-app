-- 0108 — scrub the demo seed data that 0001 inserted "so live screens aren't empty". Now that the
-- truck runs real stops/events, the placeholders (Spartanburg Market, Duncan Town Square, etc.) show
-- up on the customer Truck/Events screens and must go. Precedent: 0100 removed the demo FLOW RESERVE.
-- Only deletes the exact seeded names; real stops/events the crew created are untouched.

-- the seed live_status points at "Duncan Town Square"; clear it before deleting the stop
update public.live_status
   set current_stop_id = null, is_live = false
 where current_stop_id in (select id from public.stops where name = 'Duncan Town Square');

delete from public.stops
 where name in ('Duncan Town Square', 'Greenville Run Club', 'Spartanburg Market', 'Founding First Pour');

delete from public.events
 where title in ('Duncan Town Square', 'Greenville Run Club', 'Founding First Pour')
   and coalesce(stage, 'lead') in ('lead');  -- guard: never touch an event the crew advanced past 'lead'
