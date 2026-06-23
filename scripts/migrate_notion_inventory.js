const fs = require('fs');
// Rows from Notion "GT3 — Inventory" (collection://fb2e0c85-c524-40dc-ab93-7279316e96d3).
const rows = [
{name:"10 oz Clear Glass Stout Decanter Bottle 38-405 Neck Finish",qty:122,status:"On Hand",unit:"case",category:"Packaging",critical:false,vendor:"TricorBraun",sku:null,entity:"GT3 Brew",unit_cost:8.25,total_cost:1006.5,notes:"Order #000319542. Ships from St. Louis MO via LTL Economy Freight ($349.46 shipping). Total $1,426.42 incl tax."},
{name:"Yupik Organic Raw Cacao Nibs 2.2 lb",qty:1,status:"On Hand",unit:"each",category:"Ingredients",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"Plant-Based Straws — Agave / Cocktail / 1000 ct",qty:1000,status:"On Hand",unit:"each",category:"Packaging",critical:false,vendor:"Crew Supply Co",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:"Order #S174083"},
{name:"alawooder 25 Inch Mobile Folding Desk",qty:null,status:"On Hand",unit:null,category:"Tools/Hardware",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"Pasabahce Iconic Glass Mug 11.5 oz (Steelite, fully tempered)",qty:24,status:"Backorder",unit:"case",category:"Cooler/Display",critical:false,vendor:"WebstaurantStore",sku:"543P55753",entity:"GT3 Brew",unit_cost:3.28,total_cost:78.81,notes:"Custom quote, not yet ordered. $78.81/case = $3.28/each."},
{name:'3/16" Straight Barbed Tailpiece, Stainless Steel, for Draft Beer Lines',qty:4,status:"On Hand",unit:"each",category:"Brewing Equipment",critical:false,vendor:"Coldbreak USA",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:"Order #CB26-12817"},
{name:"Ostrich Soup Bones (Collagen Bones)",qty:5,status:"Consumed",unit:"lb",category:"Ingredients",critical:false,vendor:"American Ostrich Farms",sku:null,entity:"GT3 Brew",unit_cost:40.38,total_cost:null,notes:"Recurring 10% off subscription"},
{name:"SEEKONE Heat Gun 1800W",qty:null,status:"On Hand",unit:null,category:"Tools/Hardware",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"Slimline Torpedo Keg | Ball Lock Keg | 2.5 Gal | Lo2 / Lid O-Ring",qty:1,status:"On Hand",unit:"each",category:"Brewing Equipment",critical:false,vendor:"BeverageFactory.com",sku:null,entity:"GT3 Brew",unit_cost:129.99,total_cost:129.99,notes:null},
{name:"Coffee Brewing Kit with Coffee Refractometer",qty:null,status:"On Hand",unit:null,category:"Brewing Equipment",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"Vevor Mophorn Stainless Steel Work Table",qty:null,status:"On Hand",unit:null,category:"Tools/Hardware",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"Subminimal Subscale Digital Dosing Cup",qty:null,status:"On Hand",unit:null,category:"Brewing Equipment",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"PATIKIL 62x30mm Perforated Shrink Bands",qty:null,status:"On Hand",unit:null,category:"Packaging",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"AVINIA Digital Kitchen Timers (Visual)",qty:null,status:"On Hand",unit:null,category:"Tools/Hardware",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"EVEBOT Handheld Inkjet Printer",qty:null,status:"On Hand",unit:null,category:"Marketing",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"PATIKIL 69x35mm Perforated Shrink Bands",qty:null,status:"On Hand",unit:null,category:"Packaging",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"Summit Twin Nitro-Infused Coffee Dispenser/Kegerator (CANCELLED)",qty:0,status:"Returned",unit:"each",category:"Cooler/Display",critical:false,vendor:"BBQGuys",sku:"SBC682NCFTWIN",entity:"GT3 Brew",unit_cost:2372.99,total_cost:0,notes:"Order N219413486C cancelled and refunded $2,523.05. Originally $2,855, 17% off."},
{name:"Glassware Storage FlexGrid 24-96PC Adjustable Dish Storage Bag (Black)",qty:1,status:"On Hand",unit:"each",category:"Cooler/Display",critical:false,vendor:"Cover Store",sku:"O2L.BL2",entity:"GT3 Brew",unit_cost:99.99,total_cost:99.99,notes:"Includes 4 trays, up to 96 short compartments. Order WEB1-SP1859428."},
{name:"Bison Bones for Soups & Broth (3 lbs)",qty:1,status:"Consumed",unit:"set",category:"Ingredients",critical:false,vendor:"American Ostrich Farms",sku:null,entity:"GT3 Brew",unit_cost:319,total_cost:319,notes:null},
{name:"Yupik Organic Raw Cacao Beans 2.2 lb",qty:1,status:"On Hand",unit:"each",category:"Ingredients",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:'Hose Clamp 1/4" to 5/8" OD Tubing Stainless Steel',qty:2,status:"On Hand",unit:"each",category:"Brewing Equipment",critical:false,vendor:"MoreBeer",sku:null,entity:"GT3 Brew",unit_cost:3.38,total_cost:6.76,notes:null},
{name:"VIVOSUN P558 60x60x80 PRO Grow Tent",qty:null,status:"On Hand",unit:null,category:"Tools/Hardware",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"Melitta #4 Cone Coffee Filters Natural Brown",qty:null,status:"On Hand",unit:null,category:"Ingredients",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"Duromatic INOX Family Style Stockpot 12L/28cm side-handle",qty:2,status:"On Hand",unit:"each",category:"Brewing Equipment",critical:false,vendor:"Kuhn Rikon",sku:"Kuhn Rikon model 12",entity:"GT3 Brew",unit_cost:504.85,total_cost:1009.7,notes:"Net $807.76 after Summer26 discount"},
{name:"NukaTap Mini Beer Faucet Assembly Kit (Flow Control Ball Lock QD, Duotight, Self-Closing Spring)",qty:1,status:"On Hand",unit:"each",category:"Brewing Equipment",critical:false,vendor:"MoreBeer",sku:"D1598F",entity:"GT3 Brew",unit_cost:43.99,total_cost:43.99,notes:null},
{name:"Hex Beer Nut",qty:4,status:"On Hand",unit:"each",category:"Brewing Equipment",critical:false,vendor:"Coldbreak USA",sku:null,entity:"GT3 Brew",unit_cost:7.96,total_cost:31.84,notes:"Order #CB26-12817"},
{name:"TIMEMORE Sculptor 064S Flat Burr Coffee Grinder",qty:null,status:"On Hand",unit:null,category:"Brewing Equipment",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"Coconut Opener Tools Stainless Steel Set",qty:null,status:"On Hand",unit:null,category:"Tools/Hardware",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"INTASTING Electric Kettle Gooseneck",qty:null,status:"On Hand",unit:null,category:"Brewing Equipment",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"ULAB Glass Beakers Shot Glass 50 ml",qty:null,status:"On Hand",unit:null,category:"Cooler/Display",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"VIVOSUN Smart Air Filtration PRO T6 Kit",qty:null,status:"On Hand",unit:null,category:"Cleaning/Sanitation",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"BTF-LIGHTING FCOB COB FOB LED Strip",qty:2,status:"On Hand",unit:"each",category:"Tools/Hardware",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:"Two deliveries: 4/18 and 4/28"},
{name:'Torpedo Keg Hand Held Beer Faucet (Cobra Tap, 1/4" Flare, Stainless)',qty:1,status:"On Hand",unit:"each",category:"Brewing Equipment",critical:false,vendor:"MoreBeer",sku:null,entity:"GT3 Brew",unit_cost:21.99,total_cost:21.99,notes:null},
{name:"Ostrich Marrow Bones",qty:5,status:"Consumed",unit:"lb",category:"Ingredients",critical:false,vendor:"American Ostrich Farms",sku:null,entity:"GT3 Brew",unit_cost:26.92,total_cost:null,notes:"Recurring 10% off subscription"},
{name:"Hally Open Base Stainless Steel Table 24in",qty:null,status:"On Hand",unit:null,category:"Tools/Hardware",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"Slimline Torpedo Keg Sleeve (2.5 Gal)",qty:1,status:"On Hand",unit:"each",category:"Brewing Equipment",critical:false,vendor:"BeverageFactory.com",sku:null,entity:"GT3 Brew",unit_cost:24.99,total_cost:24.99,notes:null},
{name:"Moongiantgo Grain Mill Grinder Electric",qty:null,status:"On Hand",unit:null,category:"Brewing Equipment",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"Slimline Torpedo Keg | Ball Lock Keg | 5 Gal | Lo2 / Lid O-Ring",qty:1,status:"On Hand",unit:"each",category:"Brewing Equipment",critical:false,vendor:"BeverageFactory.com",sku:null,entity:"GT3 Brew",unit_cost:299.98,total_cost:299.98,notes:null},
{name:"Earth Circle Organics Pure Coconut Water",qty:null,status:"On Hand",unit:null,category:"Ingredients",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"NEWTRY Handheld Induction Sealer 20mm",qty:null,status:"On Hand",unit:null,category:"Packaging",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"The Spice Way Cardamom Pods 4 oz",qty:null,status:"On Hand",unit:null,category:"Ingredients",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"EISCO Premium Hand Crafted Beakers",qty:null,status:"On Hand",unit:null,category:"Cooler/Display",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"Torpedo Keg Ball Lock Quick Disconnect (Beverage Out) Stainless Steel Flared",qty:1,status:"On Hand",unit:"each",category:"Brewing Equipment",critical:false,vendor:"MoreBeer",sku:null,entity:"GT3 Brew",unit_cost:24.99,total_cost:24.99,notes:null},
{name:"BRIOTECH Extra Strength HOCl Cleaner",qty:null,status:"Backorder",unit:null,category:"Cleaning/Sanitation",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:"Delivery date currently unavailable"},
{name:"Espresso Shot Glass 3 oz Triple Pitcher",qty:null,status:"On Hand",unit:null,category:"Cooler/Display",critical:false,vendor:"Amazon",sku:null,entity:"GT3 Brew",unit_cost:null,total_cost:null,notes:null},
{name:"Site plans — Webflow Business Hosting Plan",qty:1,status:"On Hand",unit:"each",category:"Office/Software",critical:false,vendor:"Webflow",sku:null,entity:"GT3 Brew",unit_cost:52.43,total_cost:52.43,notes:"Recurring monthly subscription"}
];
const TENANT = '00000000-0000-0000-0000-000000000001';
const ascii = s => (s == null) ? s : String(s)
  .replace(/—/g, ' - ').replace(/–/g, '-').replace(/×/g, 'x').replace(/Ø/g, 'O').replace(/°/g, ' deg')
  .replace(/[‘’ʼ]/g, "'").replace(/[“”„]/g, '"').replace(/[^\x00-\x7F]/g, '');
const q = s => (s == null) ? 'null' : "'" + ascii(String(s)).replace(/'/g, "''") + "'";
const num = n => (n == null) ? 'null' : Number(n);
const bool = b => b ? 'true' : 'false';
const values = rows.filter(r => r.name && r.name.trim()).map(r =>
  `  (${q(TENANT)}, ${q(r.name)}, ${num(r.qty)}, ${q(r.status)}, ${q(r.unit)}, ${q(r.category)}, ${bool(r.critical)}, ${q(r.vendor)}, ${q(r.sku)}, ${q(r.entity)}, ${num(r.unit_cost)}, ${num(r.total_cost)}, ${q(r.notes)})`
).join(',\n');
const sql = `-- 0044 — extend inventory_items + seed from Notion "GT3 — Inventory". Idempotent. Paste into SQL Editor.
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
${values}
on conflict (tenant_id, name) do update set
  qty = excluded.qty, status = excluded.status, unit = excluded.unit, category = excluded.category,
  critical = excluded.critical, vendor = excluded.vendor, sku = excluded.sku, entity = excluded.entity,
  unit_cost = excluded.unit_cost, total_cost = excluded.total_cost, notes = excluded.notes;
`;
fs.writeFileSync(process.argv[2], sql);
console.log('wrote ' + rows.filter(r => r.name).length + ' inventory rows');
