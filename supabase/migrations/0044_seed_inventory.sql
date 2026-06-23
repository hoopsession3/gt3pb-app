-- 0044 — extend inventory_items + seed from Notion "GT3 — Inventory". Idempotent. Paste into SQL Editor.
-- Adds richer columns (vendor/sku/entity/cost/etc.) so no Notion data is lost, then upserts the rows.
alter table public.inventory_items add column if not exists vendor text;
alter table public.inventory_items add column if not exists sku text;
alter table public.inventory_items add column if not exists entity text;
alter table public.inventory_items add column if not exists storage_location text;
alter table public.inventory_items add column if not exists condition text;
alter table public.inventory_items add column if not exists asset_type text;
alter table public.inventory_items add column if not exists subcategory text;
alter table public.inventory_items add column if not exists source_link text;
alter table public.inventory_items add column if not exists unit_cost numeric;
alter table public.inventory_items add column if not exists total_cost numeric;
create unique index if not exists inventory_tenant_name_uniq on public.inventory_items(tenant_id, name);
insert into public.inventory_items (tenant_id, name, qty, status, unit, category, critical, vendor, sku, entity, unit_cost, total_cost, notes) values
  ('00000000-0000-0000-0000-000000000001', '10 oz Clear Glass Stout Decanter Bottle 38-405 Neck Finish', 122, 'On Hand', 'case', 'Packaging', false, 'TricorBraun', null, 'GT3 Brew', 8.25, 1006.5, 'Order #000319542. Ships from St. Louis MO via LTL Economy Freight ($349.46 shipping). Total $1,426.42 incl tax.'),
  ('00000000-0000-0000-0000-000000000001', 'Yupik Organic Raw Cacao Nibs 2.2 lb', 1, 'On Hand', 'each', 'Ingredients', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'Plant-Based Straws  -  Agave / Cocktail / 1000 ct', 1000, 'On Hand', 'each', 'Packaging', false, 'Crew Supply Co', null, 'GT3 Brew', null, null, 'Order #S174083'),
  ('00000000-0000-0000-0000-000000000001', 'alawooder 25 Inch Mobile Folding Desk', null, 'On Hand', null, 'Tools/Hardware', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'Pasabahce Iconic Glass Mug 11.5 oz (Steelite, fully tempered)', 24, 'Backorder', 'case', 'Cooler/Display', false, 'WebstaurantStore', '543P55753', 'GT3 Brew', 3.28, 78.81, 'Custom quote, not yet ordered. $78.81/case = $3.28/each.'),
  ('00000000-0000-0000-0000-000000000001', '3/16" Straight Barbed Tailpiece, Stainless Steel, for Draft Beer Lines', 4, 'On Hand', 'each', 'Brewing Equipment', false, 'Coldbreak USA', null, 'GT3 Brew', null, null, 'Order #CB26-12817'),
  ('00000000-0000-0000-0000-000000000001', 'Ostrich Soup Bones (Collagen Bones)', 5, 'Consumed', 'lb', 'Ingredients', false, 'American Ostrich Farms', null, 'GT3 Brew', 40.38, null, 'Recurring 10% off subscription'),
  ('00000000-0000-0000-0000-000000000001', 'SEEKONE Heat Gun 1800W', null, 'On Hand', null, 'Tools/Hardware', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'Slimline Torpedo Keg | Ball Lock Keg | 2.5 Gal | Lo2 / Lid O-Ring', 1, 'On Hand', 'each', 'Brewing Equipment', false, 'BeverageFactory.com', null, 'GT3 Brew', 129.99, 129.99, null),
  ('00000000-0000-0000-0000-000000000001', 'Coffee Brewing Kit with Coffee Refractometer', null, 'On Hand', null, 'Brewing Equipment', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'Vevor Mophorn Stainless Steel Work Table', null, 'On Hand', null, 'Tools/Hardware', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'Subminimal Subscale Digital Dosing Cup', null, 'On Hand', null, 'Brewing Equipment', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'PATIKIL 62x30mm Perforated Shrink Bands', null, 'On Hand', null, 'Packaging', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'AVINIA Digital Kitchen Timers (Visual)', null, 'On Hand', null, 'Tools/Hardware', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'EVEBOT Handheld Inkjet Printer', null, 'On Hand', null, 'Marketing', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'PATIKIL 69x35mm Perforated Shrink Bands', null, 'On Hand', null, 'Packaging', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'Summit Twin Nitro-Infused Coffee Dispenser/Kegerator (CANCELLED)', 0, 'Returned', 'each', 'Cooler/Display', false, 'BBQGuys', 'SBC682NCFTWIN', 'GT3 Brew', 2372.99, 0, 'Order N219413486C cancelled and refunded $2,523.05. Originally $2,855, 17% off.'),
  ('00000000-0000-0000-0000-000000000001', 'Glassware Storage FlexGrid 24-96PC Adjustable Dish Storage Bag (Black)', 1, 'On Hand', 'each', 'Cooler/Display', false, 'Cover Store', 'O2L.BL2', 'GT3 Brew', 99.99, 99.99, 'Includes 4 trays, up to 96 short compartments. Order WEB1-SP1859428.'),
  ('00000000-0000-0000-0000-000000000001', 'Bison Bones for Soups & Broth (3 lbs)', 1, 'Consumed', 'set', 'Ingredients', false, 'American Ostrich Farms', null, 'GT3 Brew', 319, 319, null),
  ('00000000-0000-0000-0000-000000000001', 'Yupik Organic Raw Cacao Beans 2.2 lb', 1, 'On Hand', 'each', 'Ingredients', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'Hose Clamp 1/4" to 5/8" OD Tubing Stainless Steel', 2, 'On Hand', 'each', 'Brewing Equipment', false, 'MoreBeer', null, 'GT3 Brew', 3.38, 6.76, null),
  ('00000000-0000-0000-0000-000000000001', 'VIVOSUN P558 60x60x80 PRO Grow Tent', null, 'On Hand', null, 'Tools/Hardware', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'Melitta #4 Cone Coffee Filters Natural Brown', null, 'On Hand', null, 'Ingredients', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'Duromatic INOX Family Style Stockpot 12L/28cm side-handle', 2, 'On Hand', 'each', 'Brewing Equipment', false, 'Kuhn Rikon', 'Kuhn Rikon model 12', 'GT3 Brew', 504.85, 1009.7, 'Net $807.76 after Summer26 discount'),
  ('00000000-0000-0000-0000-000000000001', 'NukaTap Mini Beer Faucet Assembly Kit (Flow Control Ball Lock QD, Duotight, Self-Closing Spring)', 1, 'On Hand', 'each', 'Brewing Equipment', false, 'MoreBeer', 'D1598F', 'GT3 Brew', 43.99, 43.99, null),
  ('00000000-0000-0000-0000-000000000001', 'Hex Beer Nut', 4, 'On Hand', 'each', 'Brewing Equipment', false, 'Coldbreak USA', null, 'GT3 Brew', 7.96, 31.84, 'Order #CB26-12817'),
  ('00000000-0000-0000-0000-000000000001', 'TIMEMORE Sculptor 064S Flat Burr Coffee Grinder', null, 'On Hand', null, 'Brewing Equipment', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'Coconut Opener Tools Stainless Steel Set', null, 'On Hand', null, 'Tools/Hardware', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'INTASTING Electric Kettle Gooseneck', null, 'On Hand', null, 'Brewing Equipment', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'ULAB Glass Beakers Shot Glass 50 ml', null, 'On Hand', null, 'Cooler/Display', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'VIVOSUN Smart Air Filtration PRO T6 Kit', null, 'On Hand', null, 'Cleaning/Sanitation', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'BTF-LIGHTING FCOB COB FOB LED Strip', 2, 'On Hand', 'each', 'Tools/Hardware', false, 'Amazon', null, 'GT3 Brew', null, null, 'Two deliveries: 4/18 and 4/28'),
  ('00000000-0000-0000-0000-000000000001', 'Torpedo Keg Hand Held Beer Faucet (Cobra Tap, 1/4" Flare, Stainless)', 1, 'On Hand', 'each', 'Brewing Equipment', false, 'MoreBeer', null, 'GT3 Brew', 21.99, 21.99, null),
  ('00000000-0000-0000-0000-000000000001', 'Ostrich Marrow Bones', 5, 'Consumed', 'lb', 'Ingredients', false, 'American Ostrich Farms', null, 'GT3 Brew', 26.92, null, 'Recurring 10% off subscription'),
  ('00000000-0000-0000-0000-000000000001', 'Hally Open Base Stainless Steel Table 24in', null, 'On Hand', null, 'Tools/Hardware', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'Slimline Torpedo Keg Sleeve (2.5 Gal)', 1, 'On Hand', 'each', 'Brewing Equipment', false, 'BeverageFactory.com', null, 'GT3 Brew', 24.99, 24.99, null),
  ('00000000-0000-0000-0000-000000000001', 'Moongiantgo Grain Mill Grinder Electric', null, 'On Hand', null, 'Brewing Equipment', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'Slimline Torpedo Keg | Ball Lock Keg | 5 Gal | Lo2 / Lid O-Ring', 1, 'On Hand', 'each', 'Brewing Equipment', false, 'BeverageFactory.com', null, 'GT3 Brew', 299.98, 299.98, null),
  ('00000000-0000-0000-0000-000000000001', 'Earth Circle Organics Pure Coconut Water', null, 'On Hand', null, 'Ingredients', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'NEWTRY Handheld Induction Sealer 20mm', null, 'On Hand', null, 'Packaging', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'The Spice Way Cardamom Pods 4 oz', null, 'On Hand', null, 'Ingredients', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'EISCO Premium Hand Crafted Beakers', null, 'On Hand', null, 'Cooler/Display', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'Torpedo Keg Ball Lock Quick Disconnect (Beverage Out) Stainless Steel Flared', 1, 'On Hand', 'each', 'Brewing Equipment', false, 'MoreBeer', null, 'GT3 Brew', 24.99, 24.99, null),
  ('00000000-0000-0000-0000-000000000001', 'BRIOTECH Extra Strength HOCl Cleaner', null, 'Backorder', null, 'Cleaning/Sanitation', false, 'Amazon', null, 'GT3 Brew', null, null, 'Delivery date currently unavailable'),
  ('00000000-0000-0000-0000-000000000001', 'Espresso Shot Glass 3 oz Triple Pitcher', null, 'On Hand', null, 'Cooler/Display', false, 'Amazon', null, 'GT3 Brew', null, null, null),
  ('00000000-0000-0000-0000-000000000001', 'Site plans  -  Webflow Business Hosting Plan', 1, 'On Hand', 'each', 'Office/Software', false, 'Webflow', null, 'GT3 Brew', 52.43, 52.43, 'Recurring monthly subscription')
on conflict (tenant_id, name) do update set
  qty = excluded.qty, status = excluded.status, unit = excluded.unit, category = excluded.category,
  critical = excluded.critical, vendor = excluded.vendor, sku = excluded.sku, entity = excluded.entity,
  unit_cost = excluded.unit_cost, total_cost = excluded.total_cost, notes = excluded.notes;
