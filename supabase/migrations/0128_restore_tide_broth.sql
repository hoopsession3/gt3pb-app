-- 0128 — Tide and the Fuel broths (FORGE / HUNT / WILD) are still standard products, not on the
-- one photographed board. Restore them to the live catalog at current pricing: Tide $12, broths $10.
-- Reverses 0127's deactivation of these four. Idempotent.

update public.products set active = true, price_cents = 1200 where slug = 'tide';
update public.products set active = true, price_cents = 1000 where slug in ('forge','hunt','wild');
