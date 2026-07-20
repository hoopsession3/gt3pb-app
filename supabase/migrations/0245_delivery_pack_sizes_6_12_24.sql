-- 0245 — delivery pack sizes: 12/24/36 → 6/12/24. Ryan's call (2026-07-20): drop 36, add a 6-pack as
-- the new entry tier. delivery_orders.pack_size is DB-enforced (0139's inline check), so the app-side
-- change in lib/delivery.ts (DELIVERY_PACKS / DeliveryPackSize) needs this migration to actually take
-- effect — without it, checkout would 500 on any 6-bottle attempt and 36 would stay orderable.
--
-- No pricing decision needed alongside this: delivery is flat-rate ($10/bottle, no bulk discount —
-- see lib/bottlePricing.ts's FRESH_PER_BOTTLE_CENTS), so a 6-pack is just 6 × $10 = $60, same math as
-- every other tier. The $10 delivery fee / free-at-24+ threshold (DELIVERY_PRICING.feeWaivedAt) is
-- unchanged — 6 and 12 still pay the flat fee, 24 is still free, exactly like 12/24 already worked
-- before 36 existed. Verified against production first: delivery_orders is currently empty (Phase 1,
-- pre-launch), so there's no existing 36-pack data this could orphan — a plain drop+add is safe with
-- no NOT VALID needed.
alter table public.delivery_orders drop constraint if exists delivery_orders_pack_size_check;
alter table public.delivery_orders add constraint delivery_orders_pack_size_check check (pack_size in (6, 12, 24));

-- verify:
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.delivery_orders'::regclass and conname = 'delivery_orders_pack_size_check';
--   -- expect: CHECK ((pack_size = ANY (ARRAY[6, 12, 24])))
