-- ── A PRE-ORDER SAYS WHEN IT IS MADE ──────────────────────────────────────────────────────────
-- 2026-10-04. The last of Ryan's four ("All four, in order"): the customer side.
--
-- ── WHAT WAS TRUE ──────────────────────────────────────────────────────────────────────────────
-- Cup orders open four hours before a stop by default (live_status.preorder_lead_h, 0137; a stop
-- may set its own lead, 0191). An order placed at 7am for a stop that opens at 11 went in as an
-- ordinary order: the confirmation said "Ready in ~8 min", the email said "ready in ~8 min", and the
-- crew's pass aged it from 7am — so the truck opened to a red ticket three hours old and a banner
-- reading "1 guest past 8 min — step over and reassure", about a guest who had been told nothing
-- true and was not there yet. Nothing on the order said it had been placed ahead, so nothing could.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────────────────────────
-- orders.ready_from: when the truck said it would make this order. Null — the overwhelming case —
-- means as soon as it is in (the truck was pouring, or the stop was under way). A time means it was
-- placed ahead of a stop and is made from that stop's start; /api/checkout writes it from the same
-- rule the menu showed the customer (lib/ordering), and the app reads it in three places:
--   · the confirmation screen and email say "We make it when we open — Sat at 11:00am";
--   · the member's order bar says the same instead of "Order received";
--   · the pass shows the ticket as "for 11:00am" until then and ages it from 11, not from 7.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
-- No constraint ties it to created_at: the server's clock and the database's are not the same
-- clock, and an order the database refused over a few seconds of skew — after the card was charged
-- — would be the worst possible outcome of a column that only informs. It does not attribute an
-- order to the stop it was placed for: orders.stop_id is still stamped from the live stop only
-- (0219), so an order placed ahead counts toward no stop in the reports, exactly as before. That is
-- a reporting restatement of its own, not a side effect of this one.
--
-- Until this is applied the app writes orders without the column (lib/deploySkew.writeAcrossSkew,
-- the one column named) and every reader treats its absence as null — which is today.

alter table public.orders add column if not exists ready_from timestamptz;

comment on column public.orders.ready_from is
  'When the truck said it would make this order. Null = as soon as it is in. A time = placed ahead of a stop (lib/ordering, state ahead) and made from that stop''s start; the pass ages it from then and the customer was told so. Written by /api/checkout only.';


-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Ordering says when the truck is open, and when your order is made','improvement','Ordering',
   'The front page, the menu, the drink sheet, checkout and the server now answer "can I order a cup?" with one rule, so the screen can no longer offer what Pay then refuses. When the truck is closed they say when cup orders open instead of offering a pre-order. Checkout shows where to pick up, and an order placed before a stop opens says it will be made when the truck opens — on the confirmation, in the email, and on the crew''s pass, which no longer counts it late before the truck has opened. The scan-to-order code on the truck''s screen opens the menu, and the welcome screen is kept for people who come in through the front door.',
   '2026-10-04', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0343_a_pre_order_says_when_it_is_made',
  'orders.ready_from timestamptz (nullable, no default, no constraint): when the truck said it would make the order — null = as soon as it is in; a time = placed ahead of a stop and made from its start. Written only by /api/checkout from lib/ordering (the same rule and read the phone uses: market_live, the stop''s own lead, the hour-before-close rule). Read by the confirmation, the member order bar and the pass (ages a ticket from ready_from when later than created_at). Attribution untouched: orders.stop_id still comes from the live stop (0219).');

-- verify:
--   select column_name, data_type, is_nullable from information_schema.columns where table_name = 'orders' and column_name = 'ready_from';   -- ready_from | timestamp with time zone | YES
--   select count(*) filter (where ready_from is not null) from public.orders;   -- 0 until someone orders ahead of a stop
