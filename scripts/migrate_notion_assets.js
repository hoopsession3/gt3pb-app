const fs = require('fs');
// Exact rows pulled from the Notion Assets data source (collection://1837a183-b1d9-81da-a01f-000b25949cc4).
const rows = [
{"Name":"Monday.com","make_model":null,"Brand":null,"category":"[\"Productivity\"]","use_case":null,"manual":null,"kb_status":null,"qty":10},
{"Name":"Adobe Express","make_model":null,"Brand":null,"category":"[\"Productivity\"]","use_case":null,"manual":null,"kb_status":null,"qty":null},
{"Name":"Google Workspace for Nonprofits","make_model":null,"Brand":null,"category":"[\"Productivity\"]","use_case":null,"manual":null,"kb_status":null,"qty":null},
{"Name":"Google Maps Platform credits","make_model":null,"Brand":null,"category":"[\"Productivity\"]","use_case":null,"manual":null,"kb_status":null,"qty":null},
{"Name":"YouTube Nonprofit Program","make_model":null,"Brand":null,"category":"[\"Productivity\"]","use_case":null,"manual":null,"kb_status":null,"qty":null},
{"Name":"Microsoft Office 365","make_model":null,"Brand":null,"category":"[\"Productivity\"]","use_case":null,"manual":null,"kb_status":null,"qty":null},
{"Name":"Google Analytics","make_model":null,"Brand":null,"category":"[\"Productivity\"]","use_case":null,"manual":null,"kb_status":null,"qty":null},
{"Name":"Google Ad Grants","make_model":null,"Brand":null,"category":"[\"Productivity\"]","use_case":null,"manual":null,"kb_status":null,"qty":null},
{"Name":"VEVOR Lab Stand Support Set","make_model":"VEVOR retort lab stand, 23.6in rod, cast-iron base, clamps","Brand":"GT3 Brew","category":"[\"Event Equipment\"]","use_case":"Holds glassware/filters for cold-brew and R&D filtration.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"HP 4.9 cu ft Chest Freezer","make_model":"HP HCM5QWWW 4.9 cu ft chest freezer (white)","Brand":"Shared","category":"[\"Event Equipment\"]","use_case":"Frozen storage — ice, whole coconut, bone-broth stock, and cold-chain ingredients staged for events.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"Coffee Brewing Kit — Refractometer + Scale","make_model":"Coffee refractometer + brewing scale, flow-rate/timer, 0.1g, app","Brand":"GT3 Brew","category":"[\"Event Equipment\"]","use_case":"QC every batch — measure TDS / extraction yield so cold brew and bottled drinks hit spec consistently.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"NEWTRY Handheld Induction Sealer","make_model":"NEWTRY 20-100mm handheld induction bottle-cap sealer, 110V","Brand":"GT3 Brew","category":"[\"Event Equipment\"]","use_case":"Tamper-seals bottle caps for the bottled-drink line (Tide / Nature Aid).","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"HTVRONT Auto Heat Press 2 (15x15)","make_model":"HTVRONT Auto Heat Press 2, 15x15in, adjustable pressure","Brand":"GT3 Performance Bar","category":"[\"Marketing\"]","use_case":"Presses merch — staff tees + branded apparel (HTV/sublimation).","manual":"https://www.htvront.com/pages/user-manuals","kb_status":"Reviewed","qty":1},
{"Name":"SEEKONE Heat Gun 1800W","make_model":"SEEKONE 1800W variable-temp heat gun, 4 nozzles","Brand":"GT3 Performance Bar","category":"[\"Event Equipment\"]","use_case":"Shrink-bands bottles + general heat tasks.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"FreekyFit Rolling Shop Stool","make_model":"FreekyFit DO02 adjustable swivel shop stool, casters, 330 lb","Brand":"Shared","category":"[\"Productivity\"]","use_case":"Seated workstation for prep and repairs in the shop.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"VIVOSUN Air Filtration PRO T6 Kit","make_model":"VIVOSUN AeroZesh T6 inline duct fan + GrowHub controller + carbon filter","Brand":"GT3 Brew","category":"[\"Event Equipment\"]","use_case":"Ventilation + odor/particulate control for the brew/production space.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"VEVOR 1500lb Poly Dump Cart","make_model":"VEVOR 1500lbs Poly Garden Dump Cart Wagon, 13in all-terrain","Brand":"GT3 Performance Bar","category":"[\"Event Equipment\"]","use_case":"Hauls heavy gear (generator, kegs, water) from the vehicle to the booth across uneven event ground.","manual":"https://www.vevor.com/garden-cart-c_10251/vevor-dump-cart-poly-garden-dump-cart-with-easy-to-assemble-steel-frame-dump-wagon-with-2-in-1-convertible-handle-utility-wheelbarrow-1500-lbs-capacity-13-inch-tires-p_010393284623","kb_status":"Reviewed","qty":1},
{"Name":"alawooder Folding Sit-Stand Mobile Desk","make_model":"alawooder 25in pneumatic sit-stand rolling desk, 0-90 tilt","Brand":"Shared","category":"[\"Productivity\"]","use_case":"Mobile sit-stand desk for back-office/admin work.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"GT3 Trailer","make_model":"Diamond Cargo 6×12 single-axle enclosed (model 6 X 12 SA-2990)","Brand":"GT3 Performance Bar","category":"[\"Event Equipment\"]","use_case":"The mobile bar — tows to events; the nitro + service rig with the serving window.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"ecozoi Stainless Ice Cube Trays","make_model":"ecozoi stainless steel ice cube trays (2-pack 12-slot + 4-pack 24-slot)","Brand":"GT3 Brew","category":"[\"Event Equipment\"]","use_case":"Makes clean ice for iced/nitro service and tasting samples.","manual":null,"kb_status":"Drafted","qty":6},
{"Name":"Zulay Handheld Milk Frother","make_model":"Zulay Kitchen Lux rechargeable handheld frother, 4 whisks","Brand":"GT3 Brew","category":"[\"Event Equipment\"]","use_case":"Quick mixing/frothing for milk-based builds and powder blends.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"Vevor Mophorn Stainless Work Table 36x24","make_model":"Vevor Mophorn 36x24in stainless prep table, 4 casters","Brand":"Shared","category":"[\"Event Equipment\"]","use_case":"Mobile stainless prep surface at events and in the shop.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"Dicunoy 1-Gallon Amber Glass Fermenting Jugs","make_model":"Dicunoy 1-gal amber glass jug w/ seal lid, handle (128oz)","Brand":"GT3 Brew","category":"[\"Event Equipment\"]","use_case":"Batch cold-brew / ferment vessels — amber glass blocks light to protect the brew.","manual":null,"kb_status":"Drafted","qty":4},
{"Name":"Lab & Barista Glassware/Tools (assorted)","make_model":"Beakers, pipettes, stirring rods, dosing cups, shot glasses, strainers, scoops (multi-order)","Brand":"GT3 Brew","category":"[\"Event Equipment\"]","use_case":"Reusable lab/barista glassware for R&D, dosing, and tastings.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"Generator Power Kit (adapter + 50A cord)","make_model":"30A/50A generator distribution adapter (GenAdptDB 12in) + 15ft 50A 125-250V 8-ga extension cord","Brand":"GT3 Performance Bar","category":"[\"Event Equipment\"]","use_case":"Powers the trailer/booth from the generator — 50A shore-style feed + adapter for event load-in.","manual":null,"kb_status":"Needs manual","qty":1},
{"Name":"Tiken Airpot Coffee Dispenser 4L","make_model":"Tiken 135oz/4L stainless insulated airpot w/ pump","Brand":"GT3 Performance Bar","category":"[\"Event Equipment\"]","use_case":"Holds + serves hot coffee at volume at the bar with no power draw.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"Kuhn Rikon Duromatic 12L Pressure Cooker","make_model":"Kuhn Rikon Duromatic INOX Family Style 12L Ø28cm stockpot/pressure cooker (SKU 30333)","Brand":"GT3 Brew","category":"[\"Event Equipment\"]","use_case":"Pressure-cooks the bone broth for the Fuel line — 12L batch stockpot.","manual":"https://kuhnrikon.com/us/footer/downloads/instructions-for-use","kb_status":"Reviewed","qty":1},
{"Name":"ArmDolly Moving Straps","make_model":"ShoulderDolly ArmDolly 2-person lifting & moving system","Brand":"GT3 Performance Bar","category":"[\"Event Equipment\"]","use_case":"Two-person lift for the kegerator/prep tables during load-in.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"INTASTING Gooseneck Electric Kettle","make_model":"INTASTING gooseneck kettle, +/-1F temp control, 0.9L","Brand":"GT3 Brew","category":"[\"Event Equipment\"]","use_case":"Temp-controlled pour-over for tastings/R&D and small-batch hot prep.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"Dalema Wire Rack Covers","make_model":"Dalema 600D dustproof/waterproof wire shelf covers (60in & 48in)","Brand":"Shared","category":"[\"Productivity\"]","use_case":"Keep stored shelving/inventory dust- and water-free.","manual":null,"kb_status":"Drafted","qty":2},
{"Name":"Infinity Jars UV Glass Jars 500ml","make_model":"Infinity Jars 500ml airtight UV-glass storage jars","Brand":"GT3 Brew","category":"[\"Event Equipment\"]","use_case":"Light-blocking storage for beans/cacao/spices to preserve freshness.","manual":null,"kb_status":"Drafted","qty":3},
{"Name":"Sakugi 3-Tier Metal Storage Shelves","make_model":"Sakugi 3-tier metal shelf 18x12x30in, adjustable feet","Brand":"Shared","category":"[\"Productivity\"]","use_case":"Shop storage for supplies and small equipment.","manual":null,"kb_status":"Drafted","qty":2},
{"Name":"Hally NSF Stainless Prep Table 24x48","make_model":"Hally Open Base 24x48in NSF stainless work table, galvanized legs","Brand":"Shared","category":"[\"Event Equipment\"]","use_case":"NSF prep table — the health-code-compliant food-prep surface.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"Subminimal Subscale Digital Dosing Scale","make_model":"Subminimal Subscale digital dosing cup w/ LED display","Brand":"GT3 Brew","category":"[\"Event Equipment\"]","use_case":"Precise dosing for recipe development and repeatable pours.","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"VIVOSUN P558 Grow Tent 60x60x80","make_model":"VIVOSUN P558 PRO grow tent 60x60x80in, hanging bars, CFM kit","Brand":"GT3 Brew","category":"[\"Event Equipment\"]","use_case":"Controlled R&D environment for ingredient/herb trials + curing.","manual":"https://vivosun.com/en-US/support/guide/growtent-pro","kb_status":"Reviewed","qty":1},
{"Name":"TIMEMORE Sculptor 064S Burr Grinder","make_model":"TIMEMORE Sculptor 064S flat-burr electric coffee grinder","Brand":"GT3 Brew","category":"[\"Event Equipment\"]","use_case":"Dials in the grind for cold brew + espresso R&D — stepless adjust, calibrate before each batch for consistent extraction.","manual":"https://www.timemore.com/products/timemore-electric-coffee-grinder-sculptor-series","kb_status":"Reviewed","qty":1},
{"Name":"Disinfectant Fogger Machine (ULV)","make_model":"The Original ULV Atomizer / Nano Steam Sanitizer Sprayer V2","Brand":"GT3 Performance Bar","category":"[\"Event Equipment\"]","use_case":"Sanitizes the booth + equipment between events (health compliance).","manual":null,"kb_status":"Drafted","qty":1},
{"Name":"Summit Commercial Nitro & Cold-Brew Kegerator/Dispenser","make_model":"Summit SBC682CMTWIN double-tap cold brew nitro & flat coffee dispenser/kegerator w/ shelves (outdoor-rated)","Brand":"Shared","category":"[\"Event Equipment\"]","use_case":"Core of the nitro program — dispenses nitro cold brew + flat coffee on two taps at the bar/events.","manual":"https://www.summitappliance.com/catalog/model/SBC682CMTWIN","kb_status":"Reviewed","qty":1},
{"Name":"Signage Easel","make_model":null,"Brand":null,"category":"[\"Signage\",\"Marketing\"]","use_case":null,"manual":null,"kb_status":null,"qty":null},
{"Name":"CSF CSS Sign","make_model":null,"Brand":null,"category":"[\"Signage\",\"Marketing\"]","use_case":null,"manual":null,"kb_status":null,"qty":null},
{"Name":"CSF Poster Sign","make_model":null,"Brand":null,"category":"[\"Signage\",\"Marketing\"]","use_case":null,"manual":null,"kb_status":null,"qty":null},
{"Name":"Tablecloth","make_model":null,"Brand":null,"category":"[\"Event Equipment\"]","use_case":null,"manual":null,"kb_status":null,"qty":null}
];
const TENANT = '00000000-0000-0000-0000-000000000001';
const q = s => (s === null || s === undefined) ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";
const arr = s => { let a = []; try { a = JSON.parse(s) || []; } catch {} return (Array.isArray(a) && a.length) ? 'array[' + a.map(x => "'" + String(x).replace(/'/g, "''") + "'").join(',') + ']::text[]' : "'{}'::text[]"; };
const num = n => (n === null || n === undefined) ? 'null' : Number(n);
// Sanitize to ASCII so the data is immune to clipboard/editor encoding quirks (em/en dashes, ×, Ø, °, smart quotes).
const ascii = s => (s == null) ? s : String(s)
  .replace(/—/g, ' - ').replace(/–/g, '-').replace(/×/g, 'x')
  .replace(/Ø/g, 'O').replace(/°/g, ' deg')
  .replace(/[‘’ʼ]/g, "'").replace(/[“”„]/g, '"')
  .replace(/[^\x00-\x7F]/g, '');
const valid = rows.filter(r => r.Name && String(r.Name).trim());
const values = valid.map(r => `  (${q(TENANT)}, ${q(ascii(r.Name))}, ${q(ascii(r.make_model))}, ${q(r.Brand)}, ${arr(r.category)}, ${q(ascii(r.use_case))}, ${q(r.manual)}, ${q(r.kb_status)}, ${num(r.qty)})`).join(',\n');
const sql = `-- 0043 — seed assets, migrated from the Notion Assets DB into Postgres (system-of-record).
-- Generated by /tmp/gen_assets.js from the Notion export. Idempotent upsert on (tenant_id, name).
create unique index if not exists assets_tenant_name_uniq on public.assets(tenant_id, name);
insert into public.assets (tenant_id, name, make_model, brand, category, use_case, manual_url, kb_status, qty) values
${values}
on conflict (tenant_id, name) do update set
  make_model = excluded.make_model, brand = excluded.brand, category = excluded.category,
  use_case = excluded.use_case, manual_url = excluded.manual_url, kb_status = excluded.kb_status, qty = excluded.qty;
`;
fs.writeFileSync(process.argv[2], sql);
console.log('wrote ' + valid.length + ' assets to ' + process.argv[2]);
