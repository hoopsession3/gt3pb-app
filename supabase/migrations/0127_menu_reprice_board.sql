-- 0127 — reprice + reconcile the product catalog to the current truck board.
--   ACTIVATE:  RISE / FLOW / DUSK  $10 (glass) · KING ME (nitro) $14 · SALTED MAPLE LATTE $14
--   HYDRATE:   NATURE'S AIDE       $10
-- TIDE and the FUEL broths (FORGE / HUNT / WILD) aren't on the board → mark inactive (data kept for
-- order history + seasonal return). The bring-bottle-back + 3/6/12 pack model is unchanged and lives
-- in lib/orderAhead.ts (coffee-only); the $14 specialties are flat (no bring-back, no packs).
-- Idempotent: safe to re-run.

-- coffees → $10, active
update public.products set price_cents = 1000, active = true, line = 'Activation'
  where slug in ('rise','flow','dusk');

-- specialties + Nature's Aide: add if missing, keep price/line current on conflict
insert into public.products (slug, name, line, price_cents, sort, active, timing, accent) values
  ('kingme','KING ME','Activation',1400,13,true,'BEFORE','#6B4429'),
  ('maple','SALTED MAPLE LATTE','Activation',1400,14,true,'BEFORE','#B8902F'),
  ('aide','NATURE''S AIDE','Hydration',1000,20,true,'DURING','#A97C3F')
on conflict (slug) do update set
  price_cents = excluded.price_cents, name = excluded.name, line = excluded.line, active = true;

-- off-board items → inactive (kept for history)
update public.products set active = false where slug in ('tide','forge','hunt','wild');
