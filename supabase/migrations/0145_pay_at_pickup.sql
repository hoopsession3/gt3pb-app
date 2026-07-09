-- 0145 — PAY-AT-PICKUP TOGGLE. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- An explicit operator control for offering a pay-later path (pay at the truck / cash on delivery),
-- independent of whether Square card checkout is switched on. Lives on `live_status` — the app's
-- single-row, public-read / staff-write config singleton (same home as the ordering dial
-- `preorder_lead_h`, 0137). The toggle UI is in the crew console Money section.
--
-- Default TRUE so the full order flow works end-to-end the moment the app is live — an owner can
-- place and taste a real order (pre-order / pay-on-arrival) before Square is even connected.
-- With Square connected, both paths can be offered together (card is primary; pay-later secondary).

alter table public.live_status add column if not exists pay_at_pickup boolean not null default true;

-- verify:
--   select is_live, preorder_lead_h, pay_at_pickup from public.live_status;  -- pay_at_pickup = t
