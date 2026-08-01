-- 0261 · BATCH → ORDER TRACEABILITY (2026-08-01 — blind-spot round #6, recall readiness).
-- Brew batches were tracked beautifully; the ORDERS they filled never recorded which batch.
-- One nullable FK on each fulfillment table turns "which customers got batch X?" from a shrug
-- into a query — the difference between a batch recall and a total recall for a perishable,
-- low-acid bottled product. Stamped at pack-out (DropOps picker); on delete the reference
-- clears rather than blocking a batch's cleanup.

alter table public.drop_orders     add column if not exists batch_id uuid references public.brew_batches(id) on delete set null;
alter table public.delivery_orders add column if not exists batch_id uuid references public.brew_batches(id) on delete set null;
create index if not exists drop_orders_batch_idx     on public.drop_orders (batch_id);
create index if not exists delivery_orders_batch_idx on public.delivery_orders (batch_id);

-- The recall query (keep close at hand):
--   select o.name, o.phone, o.drop_date from public.drop_orders o where o.batch_id = '<batch>';
--   select d.address_line1, d.phone, d.delivery_date from public.delivery_orders d where d.batch_id = '<batch>';
