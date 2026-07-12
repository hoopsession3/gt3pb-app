-- 0191 — Truck stops: vendor binding + approval, and per-stop order-ahead / pickup
-- Interoperability fixes (audit P0·3 + P1·5). Two changes:
--  1) vendors.status — a vendor is now approved | pending | archived. A stop pointed at a place that
--     isn't a known vendor creates a PENDING vendor (+ an owner alert, raised in app), instead of a
--     silent orphan with the venue name as free text. Existing vendors backfill to 'approved'.
--  2) stops gains per-stop order-ahead / pickup overrides. Until now the pre-order window and
--     pay-at-pickup were ONE global switch on live_status (0137/0147). These let a single stop opt in
--     (or out) and set its own lead time — the customer surfaces read them dynamically. NULL lead =
--     "fall back to the global live_status.preorder_lead_h", so nothing changes for stops that don't set it.

-- 1) Vendor approval status ------------------------------------------------------------------------
alter table public.vendors add column if not exists status text not null default 'approved'
  check (status in ('approved', 'pending', 'archived'));
-- Anything already in the book is trusted; only newly auto-created (unknown-place) vendors go pending.
update public.vendors set status = 'approved' where status is null;
create index if not exists vendors_status_idx on public.vendors (status) where status = 'pending';

-- 2) Per-stop order-ahead / pickup ----------------------------------------------------------------
alter table public.stops add column if not exists order_ahead_enabled boolean not null default false;
alter table public.stops add column if not exists pickup_enabled       boolean not null default false;
alter table public.stops add column if not exists order_ahead_lead_min int;  -- null = use global window

-- verify: expect vendors.status present with a pending index, and 3 new stops columns.
-- select column_name from information_schema.columns where table_name='stops'
--   and column_name in ('order_ahead_enabled','pickup_enabled','order_ahead_lead_min');
-- select column_name from information_schema.columns where table_name='vendors' and column_name='status';
