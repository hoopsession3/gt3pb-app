-- ── WHO IS WAITING HAD TWO ANSWERS ─────────────────────────────────────────────────────────────
-- 2026-09-29. d31f078 moved `submitted` from waiting-on-the-printer to waiting-on-US, because the
-- first flagship cap proved that an order Apliiq has ACCEPTED is not an order Apliiq is making —
-- it sits in their pending list until somebody presses fulfill.
--
-- That change landed in lib/shopOrder.ts. It did not land here, because "who is waiting on this
-- order" has TWO definitions and I only knew about one:
--
--   lib/shopOrder.ts   SHOP_STATUS_META[status].waiting     — drives the record sheet's chip
--   v_shop_orders      waiting_on_us / waiting_on_printer   — drives the queue counters, the
--                                                             headline, and the Needs-us filter
--
-- So production shipped with the record sheet saying "waiting on us" while the panel above it read
-- "Nothing waiting on us · 1 AT THE PRINTER" about the same order. One fact, two homes, and I put
-- the drift there myself on the same night I spent fixing that exact shape everywhere else.
--
-- This resynchronises the view. The part that stops it happening again is in the smoke suite: a
-- check that reads both definitions and fails if any status disagrees. A migration alone would just
-- line the two copies up until the next person moves one.

create or replace view public.v_shop_orders with (security_invoker = on) as
select
  o.id, o.created_at, o.updated_at, o.status,
  o.customer_id, o.user_id,
  coalesce(nullif(btrim(c.name), ''), nullif(btrim(o.ship_name), ''), o.email, 'Guest') as who,
  o.email, o.ship_name, o.ship_address,
  o.subtotal_cents, o.total_cents, o.refund_amount_cents,
  o.payment_id, o.apliiq_order_id, o.benefit_code, o.note,
  o.status_note, o.status_changed_at, o.status_changed_by,
  i.item_count, i.unit_count, i.items, i.cost_cents,
  case when i.cost_cents is null then null
       else coalesce(o.total_cents, 0) - i.cost_cents end                       as margin_cents,
  f.carrier, f.tracking_number, f.tracking_url, f.shipped_at,
  -- THE ONE LINE THAT CHANGED. `submitted` moves here: accepted by the printer is not in production,
  -- and it stays our job until they say otherwise. Everything else is 0313's, unaltered.
  (o.status in ('paid','needs_fulfillment','submitted'))                        as waiting_on_us,
  (o.status in ('in_production'))                                               as waiting_on_printer,
  (o.status = 'shipped')                                                        as waiting_on_carrier,
  (o.status in ('delivered','refunded','canceled'))                             as closed,
  floor(extract(epoch from (now() - o.created_at)) / 3600.0)::int                as age_hours
from public.shop_orders o
left join public.customers c on c.id = o.customer_id
left join lateral (
  select count(*)::int                                                     as item_count,
         coalesce(sum(si.qty), 0)::int                                     as unit_count,
         string_agg(si.qty::text || 'x ' || si.title, ', ' order by si.title) as items,
         nullif(sum(coalesce(si.cost_cents, 0) * si.qty), 0)::int          as cost_cents
    from public.shop_order_items si where si.order_id = o.id
) i on true
left join lateral (
  select mf.carrier, mf.tracking_number, mf.tracking_url, mf.shipped_at
    from public.merch_fulfillments mf where mf.order_id = o.id
   order by mf.shipped_at desc nulls last, mf.created_at desc limit 1
) f on true;

revoke all on public.v_shop_orders from anon;
grant select on public.v_shop_orders to authenticated;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('An order the printer has accepted now counts as ours','fix','Shop',
   'The shop queue counted an accepted order as the printer''s problem, so the first cap showed as "at the printer, nothing waiting on us" while it actually sat in Apliiq''s pending list waiting to be fulfilled. Accepted is not in production: those orders now appear under "needs us", where somebody will see them.',
   '2026-09-29', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0328_who_is_waiting_had_two_answers',
  'v_shop_orders.waiting_on_us gains submitted. d31f078 made that change in lib/shopOrder.ts and missed this copy, so the record sheet said "waiting on us" while the panel above it said "nothing waiting on us" about the same order. Two definitions of one fact; the smoke suite now fails if they disagree.');

-- verify:
--   select status, waiting_on_us, waiting_on_printer, waiting_on_carrier, closed
--     from public.v_shop_orders order by created_at desc limit 10;
--   -- the cap order must now read waiting_on_us = true
--   select on_us, on_printer from public.v_shop_queue;
