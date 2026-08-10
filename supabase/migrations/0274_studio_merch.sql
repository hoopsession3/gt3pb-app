-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0274 · STUDIO MERCH CAPSULE (2026-08-10 — Ryan: "I need mocks in the store, dope mockups, LV CSS."
-- Apliiq has no GT3 designs yet, so we seed a premium in-house capsule now and wire real POD later.)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Six GT3 Performance Bar products rendered in-house from the LOCKED brand marks (self-contained SVGs
-- shipped in /public/shop). They go in PUBLISHED so /shop looks real today. They carry no Apliiq id,
-- so a purchase routes to the crew "needs fulfillment" queue (no money is ever lost) until each is
-- linked to a real Apliiq product from the crew Merch view.
--
-- Also: ARCHIVE the 500 blank catalog items the first Apliiq sync pulled in (they're generic apparel
-- blanks with no mockups — noise in the crew view). Archiving is a soft, reversible flag; a re-sync of
-- a real designed product is unaffected. Idempotent; apply after 0273 (code) is deployed so the SVGs
-- are served at /shop/<slug>.svg.  APPLIED TO PROD 2026-08-10 (verified: 6 live, 500 archived).

-- ── seed the capsule (born PUBLISHED; idempotent by title) ────────────────────────────────────────
insert into public.shop_products (kind, title, public_title, blurb, price_cents, cost_cents, image_url, images, variants, published_at, sort)
select v.kind, v.title, v.public_title, v.blurb, v.price_cents, v.cost_cents, v.image_url, v.images::jsonb, v.variants::jsonb, now(), v.sort
from (values
  ('merch','GT3 Performance Tee','Performance Tee',
   'Heavyweight cotton, cut for the work. The Performance Bar mark, clean on the chest. Only the best for you.',
   3400, 1500, '/shop/tee-charcoal.svg', '["/shop/tee-charcoal.svg"]',
   '[{"size":"S"},{"size":"M"},{"size":"L"},{"size":"XL"},{"size":"XXL"}]', 1),
  ('merch','GT3 Pullover Hoodie','Pullover Hoodie',
   'Brushed-fleece pullover, hood lined, kangaroo pocket. Cream on charcoal, quiet and heavy.',
   6800, 3200, '/shop/hoodie-cream.svg', '["/shop/hoodie-cream.svg"]',
   '[{"size":"S"},{"size":"M"},{"size":"L"},{"size":"XL"},{"size":"XXL"}]', 2),
  ('merch','GT3 Crewneck','Crewneck',
   'Ribbed-collar crewneck sweatshirt in GT3 red. The standard, worn.',
   5800, 2700, '/shop/crew-red.svg', '["/shop/crew-red.svg"]',
   '[{"size":"S"},{"size":"M"},{"size":"L"},{"size":"XL"},{"size":"XXL"}]', 3),
  ('merch','GT3 6-Panel Cap','6-Panel Cap',
   'Structured six-panel with the circle badge. One size, adjustable.',
   3200, 1400, '/shop/cap-charcoal.svg', '["/shop/cap-charcoal.svg"]',
   '[{"size":"One size"}]', 4),
  ('merch','GT3 Tumbler','Tumbler',
   'Insulated 20oz stainless tumbler, badge front and center. Keeps motion on tap.',
   3400, 1600, '/shop/tumbler-steel.svg', '["/shop/tumbler-steel.svg"]',
   '[{"size":"20oz"}]', 5),
  ('merch','GT3 Market Tote','Market Tote',
   'Natural heavy-canvas tote. The mark, and room for the haul.',
   2800, 1200, '/shop/tote-natural.svg', '["/shop/tote-natural.svg"]',
   '[{"size":"One size"}]', 6)
) as v(kind, title, public_title, blurb, price_cents, cost_cents, image_url, images, variants, sort)
where not exists (select 1 from public.shop_products p where p.title = v.title);

-- ── declutter: archive the blank Apliiq catalog items the first sync imported (soft + reversible) ──
update public.shop_products
   set archived_at = now(), updated_at = now()
 where apliiq_product_id is not null
   and published_at is null
   and archived_at is null;

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The Shop opens: the GT3 capsule is live','feature','Ordering',
   'The storefront has product: a six-piece GT3 Performance Bar capsule — tee, hoodie, crewneck, cap, tumbler, and tote — rendered from the brand''s own marks in a clean editorial studio treatment, and published to the shop. Print-on-demand fulfillment links in per product as the Apliiq designs come online.',
   '2026-08-10', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- Verify (prod, after apply):
--   select count(*) from shop_products where published_at is not null and archived_at is null;  -- 6
--   select count(*) from shop_products where archived_at is not null;  -- ~500 (blanks tucked away)
