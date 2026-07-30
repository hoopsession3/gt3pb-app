-- 0256 · PRODUCTS DRIVE EVENT ECONOMICS (2026-07-30 — audit P0.1/P0.2, the "two price tables"
-- fix). product_economics carried hand-typed price/cost per category key (nitro $7, salted_maple
-- $7.50…) while the live menu (products.price_cents — what checkout actually charges) moved to
-- $10–14. Every event ROI / break-even gauge silently projected on the stale numbers. 0062's
-- intended "products.slug = product_economics (cost + price sync)" was never built, and the key
-- spaces don't even align (per-drink slugs vs 5 category keys).
--
-- The fix keeps the category model (events toggle menu_nitro & co — right granularity for a
-- projection) and makes the numbers LIVE:
--   • products.econ_key maps each drink to its category (seeded from the line taxonomy below —
--     edit per-product in SQL/Table editor if a drink is miscategorized).
--   • product_economics_live (a security-invoker view) is what the app now reads: category price
--     = avg live menu price of its active products; category unit cost = avg recipe-derived cost
--     (product_components × inventory_items — the SAME math as the COGS calculator, so the two
--     margin displays can no longer disagree). Unmapped/uncosted categories fall back to the
--     stored product_economics values — which is why `bottles` (a pack format, not a drink) keeps
--     working untouched.
--   • product_economics itself remains the fallback + label/active/sort home. Nothing writes
--     price there anymore for mapped categories; Menu & products is the one place a price is set.

alter table public.products add column if not exists econ_key text;

-- Seed: the two salted lattes are the salted_maple line by name; otherwise the product line IS
-- the category (Activation = nitro cold brews, Hydration = Nature Aide, Recovery = broth-based).
-- 'bottles' is deliberately unmapped — it's a pack format priced on its own.
update public.products set econ_key = case
  when slug in ('maple', 'salted-latte') then 'salted_maple'
  when line = 'Activation' then 'nitro'
  when line = 'Hydration' then 'nature_aid'
  when line = 'Recovery' then 'broth'
  else null
end
where econ_key is null;

create or replace view public.product_economics_live as
select
  pe.product_key,
  pe.label,
  coalesce(agg.live_price, pe.price_cents) as price_cents,
  coalesce(agg.live_cost, pe.unit_cost_cents) as unit_cost_cents,
  pe.active,
  pe.sort,
  (agg.live_price is not null) as price_live,
  (agg.live_cost is not null) as cost_live
from public.product_economics pe
left join (
  select p.econ_key,
         round(avg(p.price_cents))::int as live_price,
         round(avg(rc.cost_cents))::int as live_cost   -- avg skips NULLs: recipe-less drinks don't drag it
  from public.products p
  left join (
    select pc.product_id,
           round(sum(pc.qty_per_serving * ii.unit_cost * 100))::int as cost_cents
    from public.product_components pc
    join public.inventory_items ii on ii.id = pc.inventory_item_id
    where pc.qty_per_serving is not null and ii.unit_cost is not null
    group by pc.product_id
  ) rc on rc.product_id = p.id
  where p.active and p.econ_key is not null
  group by p.econ_key
) agg on agg.econ_key = pe.product_key;

-- Invoker rights, NOT the default definer: the view must inherit the underlying RLS
-- (product_economics is admin-only — margins stay off-limits to servers and anon).
alter view public.product_economics_live set (security_invoker = on);
