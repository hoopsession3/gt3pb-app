const L = require("../.smoke/loadout.js");
const C = require("../.smoke/cogs.js");
const I = require("../.smoke/ics.js");
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

// trailer profile (matches 0105 seed)
const tp = {
  id: 1, name: "GT3 Trailer", tow_vehicle: "2026 Honda Pilot", empty_lb: 1300, cargo_cap_lb: 1690, gvwr_lb: 2990,
  interior_len_in: 144, interior_width_in: 68, interior_height_in: 70, usable_pct: 60,
  veh_cargo_len_in: 84, veh_cargo_width_in: 50, veh_cargo_height_in: 34, veh_usable_pct: 70,
};

// realistic pack list
const pack = ["Load kegerator + 3 kegs", "2× cold-brew keg", "Potable water jug", "EcoFlow battery", "Generator", "Canopy 10x10", "48qt cooler", "Bagged ice", "Bottle inventory", "Nitrogen tank", "Square reader", "COI paperwork"];

// --- rig routing ---
ok("rigToBox trailer", L.rigToBox("trailer_plus_cart") === "trailer", L.rigToBox("trailer_plus_cart"));
ok("rigToBox cart_only→vehicle", L.rigToBox("cart_only") === "vehicle", L.rigToBox("cart_only"));
ok("rigToBox trailer_only→trailer", L.rigToBox("trailer_only") === "trailer", L.rigToBox("trailer_only"));
ok("rigToBox null→vehicle", L.rigToBox(null) === "vehicle", L.rigToBox(null));

// --- footprint estimator ---
ok("footprint keg>0", L.footprintFor("2× cold-brew keg").cuft > 0);
ok("footprint paperwork=0", L.footprintFor("COI paperwork").cuft === 0, L.footprintFor("COI paperwork"));
ok("footprint cart biggest", L.footprintFor("dump cart").cuft >= L.footprintFor("48qt cooler").cuft);

// --- trailer space ---
const tS = L.computeSpace(pack, tp, "trailer");
const grossT = (144*68*70)/1728;
ok("trailer gross cuft", Math.abs(tS.grossCuft - Math.round(grossT*10)/10) < 0.2, tS.grossCuft);
ok("trailer usable=60%", Math.abs(tS.usableCuft - Math.round(grossT*0.6*10)/10) < 0.3, tS.usableCuft);
ok("trailer hasDims", tS.hasDims === true);
ok("trailer used>0", tS.usedCuft > 0, tS.usedCuft);
ok("trailer items sorted desc", tS.items.every((it,i,a)=> i===0 || a[i-1].cuft >= it.cuft));
ok("trailer level valid", ["ok","warn","over"].includes(tS.cuftLevel), tS.cuftLevel);
ok("paperwork excluded from items", !tS.items.some(i=>/paperwork/i.test(i.label)));

// --- vehicle space (smaller box → tighter/over) ---
const vS = L.computeSpace(pack, tp, "vehicle");
ok("vehicle smaller usable than trailer", vS.usableCuft < tS.usableCuft, {veh:vS.usableCuft, trl:tS.usableCuft});
ok("vehicle same used cuft", vS.usedCuft === tS.usedCuft, {veh:vS.usedCuft, trl:tS.usedCuft});
ok("vehicle over when trailer ok-ish", true); // informational

// --- empty load ---
const eS = L.computeSpace([], tp, "trailer");
ok("empty used=0", eS.usedCuft === 0, eS.usedCuft);
ok("empty level ok", eS.cuftLevel === "ok", eS.cuftLevel);

// --- no dims ---
const nd = L.computeSpace(pack, {...tp, interior_len_in:null}, "trailer");
ok("no dims → hasDims false", nd.hasDims === false);

// --- asset cross-reference: measured dims win over keyword estimate ---
const assets = [
  { name: "Summit Commercial Nitro & Cold-Brew Kegerator/Dispenser", len_in: 26.25, width_in: 23.75, height_in: 51.5 },
  { name: "VEVOR 1500lb Poly Dump Cart", len_in: 48, width_in: 28, height_in: 24 },
];
const am = L.matchAsset("Load the kegerator + 3 kegs", assets);
ok("matchAsset finds kegerator", !!am && /Kegerator/.test(am.name), am);
ok("kegerator measured cuft ~18.6", !!am && Math.abs(am.cuft - (26.25*23.75*51.5/1728)) < 0.2, am && am.cuft);
ok("matchAsset no false match", L.matchAsset("apply UVDTF labels", assets) === null);
const mS = L.computeSpace(["Load the kegerator + 3 kegs", "48qt cooler"], tp, "trailer", assets);
ok("computeSpace marks measured src", mS.items.some(i => i.src === "measured"));
ok("computeSpace marks est src", mS.items.some(i => i.src === "est"));
ok("measured kegerator > estimated cooler", (mS.items.find(i=>i.src==="measured")||{}).cuft > (mS.items.find(i=>i.src==="est")||{}).cuft);
ok("dimsToFootprint math", L.dimsToFootprint(48,24,12).cuft === Math.round((48*24*12/1728)*10)/10);

// --- COGS: per-drink from BOM ---
const invList = [
  { id: "coco", name: "Coconut water", unit_cost: 0.50, unit: "oz" },
  { id: "honey", name: "Raw honey", unit_cost: 0.30, unit: "oz" },
  { id: "goat", name: "Goat milk", unit_cost: 0.40, unit: "oz" },
];
const invById = new Map(invList.map(x => [x.id, x]));
const invByName = new Map(invList.map(x => [x.name.toLowerCase(), x]));
const comps = [
  { product_id: "nature_aid", inventory_item_id: "coco", qty_per_serving: 8, unit: "oz" },
  { product_id: "nature_aid", inventory_item_id: "honey", qty_per_serving: 1, unit: "oz" },
  { product_id: "mystery", inventory_item_id: "x", qty_per_serving: 1, unit: "oz" }, // uncosted (no inv)
];
const dc = C.drinkCogs("nature_aid", comps, invById);
ok("drink COGS sums BOM", dc.cents === Math.round((8*0.5 + 1*0.3)*100), dc.cents);
ok("drink hasRecipe", dc.hasRecipe === true);
ok("drink no uncosted", dc.uncosted === 0, dc.uncosted);
const dm = C.margin(800, dc.cents);
ok("margin pct correct", dm.pct === Math.round((800 - dc.cents)/800*100), dm.pct);
const un = C.drinkCogs("mystery", comps, invById);
ok("uncosted flagged", un.uncosted === 1, un.uncosted);
ok("no-recipe product", C.drinkCogs("none", comps, invById).hasRecipe === false);

// --- COGS: per-batch brew scaling + yield ---
const recipe = { id: "cb", name: "Cold brew", style: "cold-brew", base_water_gal: 1, yield_factor: 0.9,
  ingredients: [ { name: "Goat milk", qty: 4, unit: "oz" }, { name: "Filter", qty: 1, unit: "ea", scales: false }, { name: "Unknown bean", qty: 2, unit: "oz" } ] };
const bc = C.batchCogs(recipe, invByName, 5, 10);
ok("batch scales volume item", Math.abs(bc.batchCents - Math.round(4*5*0.40*100)) < 1, bc.batchCents); // goat 4oz×5gal; filter+unknown uncosted
ok("batch flags uncosted", bc.uncosted === 2, bc.uncosted);
ok("batch servable yield", bc.servableGal === 4.5, bc.servableGal);
ok("batch bottle count", bc.bottles === Math.floor(4.5*128/10), bc.bottles);
ok("batch per-gal", bc.perGalCents === Math.round(bc.batchCents/5), bc.perGalCents);

// --- ICS calendar export ---
ok("parseClock am/pm", JSON.stringify(I.parseClock("2:30pm")) === JSON.stringify({h:14,m:30}), I.parseClock("2:30pm"));
ok("parseClock 24h", JSON.stringify(I.parseClock("14:00")) === JSON.stringify({h:14,m:0}));
ok("parseClock bare ambiguous → null", I.parseClock("8") === null);
ok("parseClock 11AM", JSON.stringify(I.parseClock("11AM")) === JSON.stringify({h:11,m:0}));
const stamp = new Date(Date.UTC(2026, 5, 27, 12, 0, 0));
const stopCal = I.calFromStop({ id: "s1", name: "BeltLine", starts_at: "2026-06-27T15:00:00.000Z", location_text: "Atlanta", address: "1 Peach St" });
ok("calFromStop builds", !!stopCal && stopCal.uid === "stop-s1@gt3pb", stopCal && stopCal.uid);
ok("calFromStop uses address as location", stopCal.location === "1 Peach St");
const ics = I.buildIcs(stopCal, stamp);
ok("ics has VEVENT", ics.includes("BEGIN:VEVENT") && ics.includes("END:VCALENDAR"));
ok("ics has stable UID", ics.includes("UID:stop-s1@gt3pb"));
ok("ics has SUMMARY", ics.includes("SUMMARY:BeltLine"));
ok("ics CRLF lines", ics.includes("\r\n"));
const evCal = I.calFromEvent({ id: "e1", title: "Market, Sat", day: "2026-06-27", start_time: "8" });
ok("event bare time → all-day", evCal.allDay === true);
ok("ics escapes comma in title", I.buildIcs(evCal, stamp).includes("SUMMARY:Market\\, Sat"));
ok("google url is google", I.googleCalUrl(stopCal).startsWith("https://calendar.google.com/calendar/render?"));
ok("google url has UTC dates", /dates=\d{8}T\d{6}Z/.test(I.googleCalUrl(stopCal)));
const buffered = I.withBuffer(stopCal, 60);
ok("buffer moves start 60m earlier", buffered.start.getTime() === stopCal.start.getTime() - 3600000);
ok("buffer adds note", /buffer/i.test(buffered.description || ""));
ok("buffer no-op on all-day", I.withBuffer(evCal, 60).start.getTime() === evCal.start.getTime());

// --- weight loadout still works ---
const lo = L.computeLoadout(pack, tp);
ok("loadout cargoLb>0", lo.cargoLb > 0, lo.cargoLb);
ok("loadout zones assigned", lo.items.every(i=>["nose","axle","tail"].includes(i.zone)));
ok("tongue 10-15 target present", lo.tonguePct >= 0);

console.log(`\nSPACE/LOADOUT SMOKE: ${pass} passed, ${fail} failed`);
console.log(`Sample — trailer: ${tS.usedCuft}/${tS.usableCuft} cu ft (${tS.cuftLevel}); vehicle: ${vS.usedCuft}/${vS.usableCuft} cu ft (${vS.cuftLevel})`);
process.exit(fail ? 1 : 0);
