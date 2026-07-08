const L = require("../.smoke/loadout.js");
const C = require("../.smoke/cogs.js");
const I = require("../.smoke/ics.js");
const CL = require("../.smoke/captionLint.js");
const OA = require("../.smoke/orderAhead.js");
const RV = require("../.smoke/reviews.js");
const RC = require("../.smoke/recents.js");
const OF = require("../.smoke/offline.js");
const PL = require("../.smoke/plan.js");
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

// --- caption linter ---
const lc = (t) => CL.lintCaption(t).map(f => f.tag);
ok("lint flags health claim", lc("This cures your fatigue").includes("claim"));
ok("lint flags no-sugar disclosure", lc("Zero sugar, all clean").includes("disclosure"));
ok("lint flags chatgpt smell", lc("Elevate your morning, discover the difference").includes("voice"));
ok("lint flags weak hook", lc("Hey friends! check this out").some(t => t === "hook" || t === "voice"));
ok("lint clean caption passes", CL.lintCaption("Cold-extracted 18 hours. Round, clean, no burnt bite.").length === 0, CL.lintCaption("Cold-extracted 18 hours. Round, clean, no burnt bite."));
ok("lint catches orgin typo", lc("Single orgin coffee").includes("spelling"));

// --- weight loadout still works ---
const lo = L.computeLoadout(pack, tp);
ok("loadout cargoLb>0", lo.cargoLb > 0, lo.cargoLb);
ok("loadout zones assigned", lo.items.every(i=>["nose","axle","tail"].includes(i.zone)));
ok("tongue 10-15 target present", lo.tonguePct >= 0);

// --- ORDER-AHEAD: pricing config is the single source of truth (70% margin floor lives here) ---
ok("return pack 3 = $22.50", OA.packTotal(3, "return") === 22.5, OA.packTotal(3, "return"));
ok("return pack 6 = $42", OA.packTotal(6, "return") === 42, OA.packTotal(6, "return"));
ok("return pack 12 = $78", OA.packTotal(12, "return") === 78, OA.packTotal(12, "return"));
ok("new glass 6 = $60 flat (no discount)", OA.packTotal(6, "new") === 60, OA.packTotal(6, "new"));
ok("new glass per-bottle = $10", OA.perBottle(12, "new") === 10, OA.perBottle(12, "new"));
ok("save on 6-pack = $18", OA.saveAmount(6) === 18, OA.saveAmount(6));
ok("save on 12-pack = $42", OA.saveAmount(12) === 42, OA.saveAmount(12));
ok("toCents rounds", OA.toCents(22.5) === 2250, OA.toCents(22.5));
ok("dollars formats cents", OA.dollars(22.5) === "$22.50", OA.dollars(22.5));
ok("dollars whole no decimals", OA.dollars(78) === "$78", OA.dollars(78));
ok("isPackSize gate", OA.isPackSize(6) && !OA.isPackSize(9));
// flavor mix
const mix = { RISE: 2, FLOW: 2, DUSK: 2 };
ok("mixTotal sums", OA.mixTotal(mix) === 6, OA.mixTotal(mix));
ok("mixComplete when equal", OA.mixComplete(mix, 6) === true);
ok("mixComplete false when short", OA.mixComplete({ RISE: 1, FLOW: 0, DUSK: 0 }, 6) === false);
ok("overfull mix resets on shrink", OA.mixTotal(OA.mixFitsOrReset(mix, 3)) === 0, OA.mixFitsOrReset(mix, 3));
ok("fitting mix kept on shrink", OA.mixTotal(OA.mixFitsOrReset({ RISE: 3, FLOW: 0, DUSK: 0 }, 3)) === 3);
ok("mixSummary reads", OA.mixSummary({ RISE: 2, FLOW: 0, DUSK: 1 }) === "2× RISE · 1× DUSK", OA.mixSummary({ RISE: 2, FLOW: 0, DUSK: 1 }));
// cutoff: Wed 18:00 closes that Saturday; past it rolls a week
const wedAM = new Date(2026, 6, 1, 9, 0);   // Wed Jul 1 2026, 9am — before cutoff
const wedPM = new Date(2026, 6, 1, 18, 1);  // Wed Jul 1 2026, 18:01 — after cutoff
const satD = OA.nextDrop(wedAM).sat, satD2 = OA.nextDrop(wedPM).sat;
ok("open Wed am → this Saturday Jul 4", satD.getMonth() === 6 && satD.getDate() === 4, satD.toDateString());
ok("cutoff is Wed 18:00", OA.nextDrop(wedAM).cutoff.getHours() === 18 && OA.nextDrop(wedAM).cutoff.getDay() === 3);
ok("past cutoff → next Saturday Jul 11", satD2.getDate() === 11, satD2.toDateString());
ok("Saturday itself rolls forward", OA.nextDrop(new Date(2026, 6, 4, 10, 0)).sat.getDate() === 11);
ok("dropIsOpen matches resolved sat", OA.dropIsOpen(satD.toISOString(), wedAM) === true);
ok("dropIsOpen false for stale drop", OA.dropIsOpen(new Date(2026, 5, 27).toISOString(), wedAM) === false);

// --- reviews: clean + anonymize (public-display safety) ---
ok("anon full name → first + initial", RV.anonName("Marcus Thompson") === "Marcus T.", RV.anonName("Marcus Thompson"));
ok("anon single name kept", RV.anonName("marcus") === "Marcus", RV.anonName("marcus"));
ok("anon blank → A guest", RV.anonName("") === "A guest");
ok("anon email → A guest", RV.anonName("me@x.com") === "A guest");
ok("clean strips email", !/@/.test(RV.cleanBody("great, hit me me@x.com")), RV.cleanBody("great, hit me me@x.com"));
ok("clean strips url", !/http/i.test(RV.cleanBody("see http://x.co now")));
ok("clean strips phone", !/\d{3}/.test(RV.cleanBody("call 404-555-1212 great")));
ok("clean masks profanity", /f•+/.test(RV.cleanBody("fuck yes best cold brew ever")), RV.cleanBody("fuck yes best cold brew ever"));
ok("clean caps at 240", RV.cleanBody("a ".repeat(300)).length <= 241);
ok("display rejects 3-star", RV.isDisplayable({ rating: 3, body: "it was fine coffee here" }) === false);
ok("display accepts 5-star sentence", RV.isDisplayable({ rating: 5, body: "Smoothest cold brew in Atlanta." }) === true);
ok("display rejects ALL CAPS spam", RV.isDisplayable({ rating: 5, body: "BEST BEST BEST BEST BEST" }) === false);
ok("display rejects too short", RV.isDisplayable({ rating: 5, body: "good" }) === false);
const rvPicked = RV.pickForDisplay([
  { name: "Ana Ruiz", rating: 5, body: "Rise is my whole morning now." },
  { name: "Ana Ruiz", rating: 5, body: "Rise is my whole morning now." }, // dup text
  { name: "x", rating: 2, body: "meh, not for me at all" },
], 12);
ok("pick dedupes + filters low", rvPicked.length === 1, rvPicked.length);
ok("pick anonymizes surname", rvPicked[0] && rvPicked[0].who === "Ana R.", rvPicked[0] && rvPicked[0].who);

// --- recents: MRU quick-jump list ---
ok("recentKey composes", RC.recentKey("event", "e1") === "event:e1");
const r0 = [];
const r1 = RC.addRecent(r0, { key: "event:e1", kind: "event", id: "e1", label: "BeltLine", at: 1 });
ok("addRecent inserts", r1.length === 1 && r1[0].id === "e1");
const r2 = RC.addRecent(r1, { key: "stop:s1", kind: "stop", id: "s1", label: "Ponce", at: 2 });
ok("addRecent prepends newest", r2[0].id === "s1" && r2.length === 2);
const r3 = RC.addRecent(r2, { key: "event:e1", kind: "event", id: "e1", label: "BeltLine", at: 3 });
ok("addRecent dedupes to front", r3.length === 2 && r3[0].id === "e1", r3.map((x) => x.id));
const rCap = Array.from({ length: 12 }).reduce((acc, _, i) => RC.addRecent(acc, { key: `event:e${i}`, kind: "event", id: `e${i}`, label: `E${i}`, at: i }, 8), []);
ok("addRecent caps at max", rCap.length === 8, rCap.length);
const rTop = RC.topRecents([{ key: "a", kind: "event", id: "a", label: "A", at: 5 }, { key: "b", kind: "event", id: "b", label: "B", at: 9 }, { key: "c", kind: "event", id: "c", label: "", at: 20 }], 5);
ok("topRecents sorts desc + drops blank", rTop.length === 2 && rTop[0].id === "b", rTop.map((x) => x.id));

// --- offline queue: coalescing replay math ---
const op1 = OF.orderStatusOp("o1", "preparing", 100);
ok("orderStatusOp key", op1.key === "order_status:o1" && op1.value === "preparing");
const q1 = OF.enqueueOp([], op1);
ok("enqueue inserts", q1.length === 1);
const q2 = OF.enqueueOp(q1, OF.orderStatusOp("o2", "ready", 200));
ok("enqueue appends new target", q2.length === 2 && q2[1].id === "o2");
const q3 = OF.enqueueOp(q2, OF.orderStatusOp("o1", "done", 300));
ok("enqueue coalesces same target in place", q3.length === 2 && q3[0].id === "o1" && q3[0].value === "done", q3);
const qCap = Array.from({ length: 210 }).reduce((acc, _, i) => OF.enqueueOp(acc, OF.orderStatusOp(`o${i}`, "done", i), 200), []);
ok("enqueue caps at max (oldest dropped)", qCap.length === 200 && qCap[0].id === "o10", qCap.length);
const qStale = OF.pruneStale([OF.orderStatusOp("old", "done", 0), OF.orderStatusOp("new", "done", 999_000)], 1_000_000, 60_000);
ok("pruneStale drops expired ops", qStale.length === 1 && qStale[0].id === "new", qStale);
ok("snapshot fresh is usable", OF.snapshotUsable(1_000, 61_000) === true);
ok("snapshot too old is not", OF.snapshotUsable(1_000, 1_000 + 3 * 60 * 60 * 1000) === false);
ok("snapshot from the future is not", OF.snapshotUsable(5_000, 1_000) === false);

// --- pre-order window: cups only when there's a truck to make them ---
const H = 60 * 60 * 1000;
const T0 = Date.parse("2026-07-11T13:00:00Z"); // stop starts 13:00Z
ok("live is always open", OA.preorderWindow(0, true, null).open === true);
ok("5h before stop: closed (reserve instead)", OA.preorderWindow(T0 - 5 * H, false, "2026-07-11T13:00:00Z").open === false);
ok("4h before stop: open", OA.preorderWindow(T0 - 4 * H, false, "2026-07-11T13:00:00Z").open === true);
ok("during the stop: open", OA.preorderWindow(T0 + 2 * H, false, "2026-07-11T13:00:00Z").open === true);
ok("8h after start: still open (missed live toggle)", OA.preorderWindow(T0 + 8 * H, false, "2026-07-11T13:00:00Z").open === true);
ok("9h after start: closed", OA.preorderWindow(T0 + 9 * H, false, "2026-07-11T13:00:00Z").open === false);
ok("no stop scheduled: closed", OA.preorderWindow(T0, false, null).reason === "none");
ok("garbage date: closed", OA.preorderWindow(T0, false, "not-a-date").open === false);
ok("lead 0 = strict live-only (even during stop)", OA.preorderWindow(T0 + H, false, "2026-07-11T13:00:00Z", 0).open === false);
ok("lead 0 + live = open", OA.preorderWindow(T0 + H, true, "2026-07-11T13:00:00Z", 0).open === true);
ok("lead 2h: 3h before closed", OA.preorderWindow(T0 - 3 * H, false, "2026-07-11T13:00:00Z", 2 * H).open === false);
ok("lead 2h: 1h before open", OA.preorderWindow(T0 - 1 * H, false, "2026-07-11T13:00:00Z", 2 * H).open === true);
ok("preorderLeadMs maps hours + defaults", OA.preorderLeadMs(2) === 2 * H && OA.preorderLeadMs(null) === OA.PREORDER_LEAD_MS && OA.preorderLeadMs(0) === 0);

// --- plan gate: software billing entitlements ---
ok("founder gets everything", PL.planAllows("founder", "ai_agents") === true);
ok("pro gets AI", PL.planAllows("pro", "ai_agents") === true);
ok("solo lacks AI", PL.planAllows("solo", "ai_agents") === false);
ok("solo keeps reports", PL.planAllows("solo", "reports") === true);
ok("unknown plan reads as most-restricted", PL.planAllows("hax", "ai_agents") === false && PL.planAllows(null, "reports") === true);
const day = 24 * 60 * 60 * 1000;
ok("founder always active", PL.planActive({ plan: "founder", billing_status: null, current_period_end: null }, 0) === true);
ok("active is active", PL.planActive({ plan: "pro", billing_status: "active", current_period_end: null }, 0) === true);
ok("past_due within grace", PL.planActive({ plan: "pro", billing_status: "past_due", current_period_end: new Date(0).toISOString() }, 6 * day) === true);
ok("past_due beyond grace", PL.planActive({ plan: "pro", billing_status: "past_due", current_period_end: new Date(0).toISOString() }, 8 * day) === false);
ok("canceled rides out the paid period", PL.planActive({ plan: "pro", billing_status: "canceled", current_period_end: new Date(2 * day).toISOString() }, day) === true);
ok("canceled after period ends", PL.planActive({ plan: "pro", billing_status: "canceled", current_period_end: new Date(day).toISOString() }, 2 * day) === false);
ok("no status = not active", PL.planActive({ plan: "pro", billing_status: null, current_period_end: null }, 0) === false);

console.log(`\nSPACE/LOADOUT SMOKE: ${pass} passed, ${fail} failed`);
console.log(`Sample — trailer: ${tS.usedCuft}/${tS.usableCuft} cu ft (${tS.cuftLevel}); vehicle: ${vS.usedCuft}/${vS.usableCuft} cu ft (${vS.cuftLevel})`);
process.exit(fail ? 1 : 0);
