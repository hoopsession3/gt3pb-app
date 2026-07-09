-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0156 · orders SERVER-WRITE-ONLY  (Layer 1, closes the last client-write door)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- `orders` was the only order table with a dual write path: a client RLS INSERT (0005 → 0016,
-- "place own order" — unpaid rows only) alongside the service-role API insert. The availability +
-- ordering-window checks that gate every paid order only ever lived on the API door, so the client
-- door could in principle insert an unpaid order for an 86'd item or outside the ordering window.
--
-- app/api/checkout/route.ts now handles BOTH paths (paid via Square, and pay-at-pickup unpaid) with
-- the same checks either way, and components/Checkout.tsx's recordPreOrder() calls that route
-- instead of inserting directly. This migration removes the client INSERT policy that's no longer
-- needed — `orders` becomes server-write-only, matching every other order table (drop_orders,
-- delivery_orders, reserve_claims, subscriptions all already were).
--
-- Deploy this AFTER the app code that stops using the direct client insert (Checkout.tsx). Applying
-- it before would break pay-at-pickup for anyone still on the old client bundle mid-deploy; applying
-- it after is safe immediately.

drop policy if exists "place own order" on public.orders;
drop policy if exists "anyone place order" on public.orders;  -- earlier name (0005), in case it lingered

-- verify:
--   select count(*) from pg_policy where polrelid = 'public.orders'::regclass and cmd = 'a';  -- 0 (no INSERT policy left)
--   -- confirm the app still works: place a pay-at-pickup order through the UI, then a paid one.
