-- 0137 — ADJUSTABLE PRE-ORDER WINDOW. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- How long before a stop cup pre-orders open is now the OPERATOR'S dial, not a hardcoded rule —
-- set from the crew console (Now → Live truck), enforced everywhere the same
-- (lib/orderAhead.preorderWindow: menu sheet, checkout sheet, /api/checkout).
--   0  = strict: cups only while the truck is LIVE (pack reserves stay open anytime)
--   4  = default: opens 4h before the next stop's start
alter table public.live_status add column if not exists preorder_lead_h int not null default 4;
do $$ begin
  alter table public.live_status add constraint live_preorder_lead_range check (preorder_lead_h between 0 and 24);
exception when duplicate_object then null; end $$;

-- verify:
--   select preorder_lead_h from public.live_status;  -- 4
