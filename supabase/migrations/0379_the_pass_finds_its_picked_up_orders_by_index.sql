-- ── 0379 — THE PASS FINDS ITS PICKED-UP ORDERS BY INDEX ──────────────────────────────────────────────────────────
-- The Pass reads the orders picked up in the last 30 minutes (the Ready lane's recall tray, components/pass) every 15
-- seconds on every device that has it open, with status = 'done' and status_changed_at after a moment. No index covers
-- that, so each read walks the whole orders table, and the table only grows. A partial index on the done orders' change
-- time answers it from the newest end. Small table today; the point is that the read stays the same size as it grows.
-- changelog: none — a read gets cheaper; nothing a person sees changes.

create index if not exists orders_done_by_change on public.orders (status_changed_at desc) where status = 'done';

-- verify:
--   select indexdef from pg_indexes where schemaname = 'public' and indexname = 'orders_done_by_change';
select public.record_migration('0379_the_pass_finds_its_picked_up_orders_by_index');
