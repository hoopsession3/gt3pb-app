-- 0238 — Orders integrity + scale. Two problems on the cup/KDS `orders` table (and its delivery twin):
--   (1) DUPLICATE PAID ORDERS: the Square charge is idempotent (stable idempotency key) but the order
--       INSERT was not, so a retry after a lost response could record a second paid order → double
--       fulfillment. The app now checks payment_id before insert; this adds the DB hard-guarantee.
--   (2) SCALE: the member "my orders" homepage query (by user_id, enforced by RLS on every read) and
--       the KDS pass board (by status/created_at, reloaded every 15s + on every realtime change) both
--       full-table-scan `orders`, which grows unboundedly. Every sibling order table already has these.
--
-- The unique indexes are created inside a guard that SKIPS if pre-existing duplicates are present (so
-- this migration can never fail on live data); if it skips, the app-level idempotency guard still holds
-- and the duplicates are reported for a manual dedupe before the constraint is added.

-- (1) payment_id uniqueness — only when the column is set, only if the data is already clean.
do $$
begin
  if not exists (
    select 1 from public.orders where payment_id is not null
    group by payment_id having count(*) > 1
  ) then
    create unique index if not exists orders_payment_id_uniq
      on public.orders (payment_id) where payment_id is not null;
  else
    raise notice 'orders.payment_id has duplicates — unique index skipped; dedupe then re-run';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from public.delivery_orders where payment_id is not null
    group by payment_id having count(*) > 1
  ) then
    create unique index if not exists delivery_orders_payment_id_uniq
      on public.delivery_orders (payment_id) where payment_id is not null;
  else
    raise notice 'delivery_orders.payment_id has duplicates — unique index skipped; dedupe then re-run';
  end if;
end $$;

-- (2) hot-path indexes on `orders` (its siblings were indexed; this table was missed).
create index if not exists orders_user_created_idx on public.orders (user_id, created_at desc);
-- the KDS board / service pulse only ever look at NOT-yet-finished orders — a partial index keeps it
-- tiny and constant as finished-order history grows.
-- predicate uses <> (status is NOT NULL, 0005) to match the app's .neq('status',…) verbatim so the
-- planner reliably chooses this index for the KDS active-orders query.
create index if not exists orders_active_idx on public.orders (created_at desc)
  where status <> 'done' and status <> 'void';

-- verify:
--   select indexname from pg_indexes where tablename='orders';
--   -- expect orders_payment_id_uniq (if data clean), orders_user_created_idx, orders_active_idx
