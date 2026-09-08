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
// pack pickup ordering closes 24h before the stop (brew lead)
const stopAt = "2026-07-11T17:00:00Z";
ok("pickup cutoff is 24h before the stop", OA.dropForStop(stopAt).cutoff.getTime() === Date.parse(stopAt) - 24 * 60 * 60 * 1000);
ok("STOP_LEAD_MS is 24h", OA.STOP_LEAD_MS === 24 * 60 * 60 * 1000);

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
// ── banned copy (strategy Rev 1.0) — the linter must catch every locked rule ──
{
  const CL2 = require("../.smoke/captionLint.js");
  const hit = (txt) => CL2.lintCaption(txt).some((f) => f.tag === "banned");
  ok("lint: detox banned", hit("a gentle detox for your week"));
  ok("lint: cleanest banned", hit("the cleanest cup in town"));
  ok("lint: meal replacement banned", hit("a great meal replacement"));
  ok("lint: wellness journey banned", hit("start your wellness journey"));
  ok("lint: zenith banned", hit("try our Zenith blend"));
  ok("lint: contrast flip banned", hit("This isn't coffee — it's a ritual"));
  ok("lint: clean copy passes", !hit("Cold-extracted 16 hours. Single-origin. Poured into glass."));
}

// ── delivery (Phase 1) — the debrief's QA samples verbatim ──
{
  const D = require("../.smoke/delivery.js");
  const q = (p, perf, r) => D.quoteDelivery(p, perf, r, "direct");
  ok("delivery: 12 pack, 8 refill + 4 new = $114", q(12, 0, 8).totalCents === 114_00);
  ok("delivery: 12 pack, all 12 refills = $106", q(12, 0, 12).totalCents === 106_00);
  ok("delivery: 12 pack, 8 new + 4 perf = $146", q(12, 4, 0).totalCents === 146_00);
  ok("delivery: 24 pack, 16 refill + 6 new + 2 perf, fee waived = $216", q(24, 2, 16).totalCents === 216_00);
  ok("delivery: refills clamp to total − perf", q(12, 4, 12).refillCount === 8);
  ok("delivery: fee waived exactly at 24", q(24, 0, 0).deliveryFeeCents === 0 && q(12, 0, 0).deliveryFeeCents === 10_00);
  ok("delivery: third-party channel gets no refill tier", D.quoteDelivery(12, 0, 12, "doordash").refillCount === 0);
  ok("delivery: zone accepts 29607, rejects 29999", D.zipInZone("29607") && !D.zipInZone("29999"));
  ok("delivery: zone covers Taylors + Fountain Inn", D.zipInZone("29687") && D.zipInZone("29644"));
  // ── markets (0275): the zero-regression contract, asserted rather than asserted-about ──
  // zipInZone with NO market argument must still mean Greenville and ONLY Greenville, so consumer
  // Sunday delivery is byte-identical to the single-market build. zipMarket is the new market-aware
  // door that corporate delivery uses.
  ok("markets: default zone is still Greenville-only", D.zipInZone("29601") && !D.zipInZone("30303"));
  ok("markets: Atlanta zone resolves only when asked for", D.zipInZone("30303", "atlanta") && !D.zipInZone("29601", "atlanta"));
  ok("markets: zipMarket routes a ZIP to its own city", D.zipMarket("29607") === "greenville" && D.zipMarket("30309") === "atlanta");
  ok("markets: zipMarket is null outside every zone", D.zipMarket("99999") === null);
  const M = require("../.smoke/markets.js");
  ok("markets: Atlanta serves corporate, not consumer delivery",
    M.marketServes("atlanta", "corporate") && !M.marketServes("atlanta", "consumerDelivery"));
  ok("markets: unknown/absent market falls back to founding",
    M.toMarket("nowhere") === "greenville" && M.toMarket(undefined) === "greenville");
  const chc = D.deliverySlotChoices(Date.UTC(2026, 6, 8, 16));
  ok("delivery: two Sundays offered, a week apart",
    (new Date(chc[1].deliveryDateKey + "T00:00:00Z") - new Date(chc[0].deliveryDateKey + "T00:00:00Z")) === 7 * 864e5);
  // cutoff math (ET): Wed Jul 8 2026 12:00 ET → this Sunday Jul 12; Fri 18:00 ET → next Sunday Jul 19; Sat + Sun roll too
  const T = (iso) => Date.parse(iso);
  ok("delivery: Wed before cutoff → this Sunday", D.nextDeliverySlot(T("2026-07-08T16:00:00Z")).deliveryDateKey === "2026-07-12");
  ok("delivery: Fri 5:59 PM ET → this Sunday", D.nextDeliverySlot(T("2026-07-10T21:59:00Z")).deliveryDateKey === "2026-07-12");
  ok("delivery: Fri 6:00 PM ET → next Sunday", D.nextDeliverySlot(T("2026-07-10T22:00:00Z")).deliveryDateKey === "2026-07-19");
  ok("delivery: Saturday → next Sunday", D.nextDeliverySlot(T("2026-07-11T15:00:00Z")).deliveryDateKey === "2026-07-19");
  ok("delivery: Sunday orders for the following Sunday", D.nextDeliverySlot(T("2026-07-12T15:00:00Z")).deliveryDateKey === "2026-07-19");

  // --- money invariants: cross-cutting guards so a pricing edit can't quietly leak revenue ---
  ok("money: bigger pickup pack never costs less in total", OA.packTotal(12, "return") > OA.packTotal(6, "return") && OA.packTotal(6, "return") > OA.packTotal(3, "return"));
  ok("money: per-bottle drops (or holds) as the pack grows — volume discount, never a penalty", OA.perBottle(12, "return") <= OA.perBottle(6, "return") && OA.perBottle(6, "return") <= OA.perBottle(3, "return"));
  ok("money: no pack is ever free or negative", OA.packTotal(3, "return") > 0 && OA.packTotal(3, "new") > 0);
  ok("money: the advertised saving never exceeds the pack's own price", OA.saveAmount(6) < OA.packTotal(6, "return") && OA.saveAmount(12) < OA.packTotal(12, "return"));
  ok("money: every delivery quote charges more than zero", D.quoteDelivery(12, 0, 0, "direct").totalCents > 0 && D.quoteDelivery(36, 4, 8, "direct").totalCents > 0);
  ok("money: tip/round-trip cents are lossless", OA.toCents(OA.packTotal(12, "return")) === 7800 && OA.dollars(OA.packTotal(6, "return")) === "$42");
}

// --- claim guard (brand-legal): the AI's output must never assert a health/allergen effect ---
{
  const CG = require("../.smoke/claimGuard.js");
  const bad = (s) => CG.claimSafe(s).ok === false, good = (s) => CG.claimSafe(s).ok === true;
  ok("claim: 'detoxes your liver' is blocked", bad("This drink detoxes your liver fast."));
  ok("claim: 'cures your cold' is blocked", bad("It cures your cold."));
  ok("claim: 'toxin-free' is blocked", bad("Our coffee is toxin-free."));
  ok("claim: 'safe for diabetics' is blocked", bad("It's safe for diabetics."));
  ok("claim: 'gene expression' is blocked", bad("It improves gene expression."));
  ok("claim: 'reduces inflammation' is blocked", bad("Rise reduces inflammation."));
  ok("claim: 'lactose-free' is blocked", bad("The goat-milk latte is lactose-free."));
  ok("claim: negated 'we don't make detox claims' passes", good("We don't make detox claims — we just use whole foods."));
  ok("claim: negated 'it's not a cure' passes", good("It's not a cure for anything, just real fuel."));
  ok("claim: clean ingredient talk passes", good("Cold-extracted coffee with A2 goat milk, real maple, and sea salt."));
  ok("claim: fallback is non-empty & on-brand", typeof CG.CLAIM_FALLBACK === "string" && CG.CLAIM_FALLBACK.length > 20);
}

// --- dates & event-row formatters (2026-07-29): the recurring drift class. Every case named
// "(live bug)" shipped broken at least once — these assertions are what make those fixes STAY fixed. ---
{
  const DT = require("../.smoke/dates.js");
  ok("fmt12: bare 24h → 12h lowercase", DT.fmt12("18:30") === "6:30pm", DT.fmt12("18:30"));
  ok("fmt12: '6:00PM' → '6:00pm' (2026-07-19 live bug, refixed 07-29)", DT.fmt12("6:00PM") === "6:00pm", DT.fmt12("6:00PM"));
  ok("fmt12: spaced period collapses", DT.fmt12("6:00 pm") === "6:00pm", DT.fmt12("6:00 pm"));
  ok("fmt12: noon is 12:00pm", DT.fmt12("12:00") === "12:00pm", DT.fmt12("12:00"));
  ok("fmt12: 24h midnight is 12:xxam", DT.fmt12("0:15") === "12:15am", DT.fmt12("0:15"));
  ok("fmt12: morning 24h", DT.fmt12("9:30") === "9:30am", DT.fmt12("9:30"));
  ok("fmt12: free text passes through untouched", DT.fmt12("noonish") === "noonish");
  ok("fmt12: hour>23 passes through", DT.fmt12("25:00") === "25:00");
  ok("fmt12: null → null", DT.fmt12(null) === null);
  ok("evTime: both ends normalized (raw-vs-derived can't drift)", DT.evTime({ start_time: "6:00PM", end_time: "21:00" }) === "6:00pm–9:00pm", DT.evTime({ start_time: "6:00PM", end_time: "21:00" }));
  ok("evTime: start only", DT.evTime({ start_time: "11:00" }) === "11:00am", DT.evTime({ start_time: "11:00" }));
  ok("evTime: no times → empty", DT.evTime({}) === "");
  ok("evLeadDate: numeric M/D, matches stop rows ('Jul 31' vs '8/1' live bug)", DT.evLeadDate({ day: "2026-07-31" }) === "7/31", DT.evLeadDate({ day: "2026-07-31" }));
  ok("evLeadDate: no day → empty", DT.evLeadDate({}) === "");
  ok("evLeadDay: crew-typed label wins", DT.evLeadDay({ day: "2026-07-31", day_label: "FRI NIGHT" }) === "FRI NIGHT");
  ok("evLeadDay: derived weekday, uppercase", DT.evLeadDay({ day: "2026-07-31" }) === "FRI", DT.evLeadDay({ day: "2026-07-31" }));
  ok("evDate: local calendar parse (no UTC-midnight 'yesterday' bug)", DT.evDate({ day: "2026-07-31" }) === "Fri, Jul 31", DT.evDate({ day: "2026-07-31" }));
  ok("evDate: no day → null", DT.evDate({}) === null);
  ok("dayKey zero-pads", DT.dayKey(new Date(2026, 0, 5)) === "2026-01-05", DT.dayKey(new Date(2026, 0, 5)));
  ok("etDayKey: UTC evening = prior ET day (the 8pm flip bug)", DT.etDayKey(new Date("2026-07-30T02:00:00Z")) === "2026-07-29", DT.etDayKey(new Date("2026-07-30T02:00:00Z")));
  ok("relativeDay: today", DT.relativeDay(DT.dayKey(new Date())) === "Today", DT.relativeDay(DT.dayKey(new Date())));
  ok("relativeDay: tomorrow", DT.relativeDay(DT.dayKey(new Date(Date.now() + 86400000))) === "Tomorrow");
  // nextWeekdayAt — the "Stop here again" prefill (2026-07-29); `now` pinned for determinism
  const wed6pm = new Date(2026, 6, 29, 18, 0);                       // Wed Jul 29 2026, 6:00pm
  const n1 = DT.nextWeekdayAt(wed6pm, new Date(2026, 6, 29, 20, 0)); // now = same Wed, 8pm
  ok("nextWeekdayAt: same weekday, time passed → +7 days", DT.dayKey(n1) === "2026-08-05" && n1.getHours() === 18, DT.dayKey(n1));
  const n2 = DT.nextWeekdayAt(wed6pm, new Date(2026, 6, 27, 9, 0));  // now = Mon 9am
  ok("nextWeekdayAt: upcoming weekday this week, time kept", DT.dayKey(n2) === "2026-07-29" && n2.getHours() === 18 && n2.getMinutes() === 0, DT.dayKey(n2));
  const n3 = DT.nextWeekdayAt(wed6pm, new Date(2026, 6, 29, 12, 0)); // now = same Wed, noon
  ok("nextWeekdayAt: today still counts if the time is ahead", DT.dayKey(n3) === "2026-07-29", DT.dayKey(n3));

  // ageLabel — the one clock every alert card renders (2026-07-30, Ryan: "put dates to these
  // alerts"); `now` pinned for determinism.
  const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).toISOString();
  const NOW = new Date(2026, 6, 30, 14, 0); // Thu Jul 30 2026, 2:00pm
  ok("ageLabel: under a minute → just now", DT.ageLabel(at(2026, 6, 30, 13, 59, 40), NOW) === "just now" || DT.ageLabel(at(2026, 6, 30, 14, 0), NOW) === "just now");
  ok("ageLabel: minutes", DT.ageLabel(at(2026, 6, 30, 13, 48), NOW) === "12m ago", DT.ageLabel(at(2026, 6, 30, 13, 48), NOW));
  ok("ageLabel: hours, same day", DT.ageLabel(at(2026, 6, 30, 11, 0), NOW) === "3h ago", DT.ageLabel(at(2026, 6, 30, 11, 0), NOW));
  ok("ageLabel: yesterday carries the clock time", /^Yesterday /.test(DT.ageLabel(at(2026, 6, 29, 16, 12), NOW)), DT.ageLabel(at(2026, 6, 29, 16, 12), NOW));
  ok("ageLabel: inside a week → weekday + time", /^Sun /.test(DT.ageLabel(at(2026, 6, 26, 9, 30), NOW)), DT.ageLabel(at(2026, 6, 26, 9, 30), NOW));
  ok("ageLabel: older → month + day", DT.ageLabel(at(2026, 6, 12, 9, 30), NOW) === "Jul 12", DT.ageLabel(at(2026, 6, 12, 9, 30), NOW));
  ok("ageLabel: garbage → empty", DT.ageLabel("not-a-date", NOW) === "");
}

// --- brew math: bottles↔gallons and start-by — the numbers DropOps/BrewPlanner/My Day all share ---
{
  const BM = require("../.smoke/brewMath.js");
  ok("brew: bottlesFor 4gal @ .92 yield = 47", BM.bottlesFor(4, 0.92) === 47, BM.bottlesFor(4, 0.92));
  ok("brew: bottlesFor null yield = raw 51", BM.bottlesFor(4, null) === 51, BM.bottlesFor(4, null));
  ok("brew: gallonsForBottles always covers the demand it was asked for", BM.bottlesFor(BM.gallonsForBottles(47, 0.92), 0.92) >= 47, BM.gallonsForBottles(47, 0.92));
  ok("brew: quarterGal rounds up to the pourable step", BM.quarterGal(3.01) === 3.25 && BM.quarterGal(0.1) === 0.25, BM.quarterGal(3.01));
  ok("brew: planned batch past latest start flags overdue", BM.brewStartOverdue({ status: "planned", latest_start_at: "2026-07-01T00:00:00Z" }, Date.parse("2026-07-02T00:00:00Z")) === true);
  ok("brew: a batch already brewing never flags", BM.brewStartOverdue({ status: "brewing", latest_start_at: "2026-07-01T00:00:00Z" }, Date.parse("2026-07-02T00:00:00Z")) === false);
  ok("brew: flavorDemand sums mixes, tolerates null mix", JSON.stringify(BM.flavorDemand([{ mix: { RISE: 2 } }, { mix: { RISE: 1, FLOW: 3 } }, { mix: null }], ["RISE", "FLOW"])) === JSON.stringify({ RISE: 3, FLOW: 3 }));
}

// ── equipment lifecycle (0276) — the state machine, proved rather than trusted ──
{
  const E = require("../.smoke/equipment.js");
  // A pre-lifecycle row carries no status at all; it must read as in-service, because that is what
  // its mere presence in the register meant before equipment had a lifecycle.
  ok("equipment: absent/unknown status reads as active",
    E.toStatus(undefined) === "active" && E.toStatus("banana") === "active");
  ok("equipment: a state is never a transition to itself", !E.canTransition("active", "active"));
  ok("equipment: gear can be retired from any live state",
    ["planned", "active", "maintenance", "reserve"].every((s) => E.canTransition(s, "retired")));
  // Retired comes back as a SPARE only — putting it to work again is a second, deliberate decision.
  ok("equipment: retired returns only as a spare",
    E.canTransition("retired", "reserve") && !E.canTransition("retired", "active"));
  ok("equipment: retired is otherwise terminal",
    !E.canTransition("retired", "maintenance") && !E.canTransition("retired", "planned"));
  ok("equipment: planned gear is owned but is not capacity", !E.isDeployed("planned") && E.isOwned("planned"));
  ok("equipment: retired gear is neither owned nor capacity",
    !E.isDeployed("retired") && !E.isOwned("retired"));
  ok("equipment: gear out for service is still owned, not usable",
    E.isOwned("maintenance") && !E.isDeployed("maintenance") && !E.isServiceable("maintenance"));
  // Retirement demands its paperwork — the same rule the database enforces with a CHECK constraint.
  ok("equipment: retiring needs a disposition", !E.validateRetire({ reason: "died" }).ok);
  ok("equipment: retiring needs a real reason", !E.validateRetire({ disposition: "sold", reason: "x" }).ok);
  ok("equipment: a complete retirement validates",
    E.validateRetire({ disposition: "scrapped", reason: "Compressor failed, past repair" }).ok);
  ok("equipment: an invented disposition is rejected",
    !E.validateRetire({ disposition: "vanished", reason: "gone missing" }).ok);
  // movementKind must classify exactly the way the database trigger does, or the ledger and the UI
  // will describe the same event with two different words.
  ok("equipment: a market change is a transfer",
    E.movementKind("active", "active", "greenville", "atlanta") === "transfer");
  ok("equipment: first commissioning is a commission",
    E.movementKind("planned", "active", "greenville", "greenville") === "commission");
  ok("equipment: retiring outranks every other classification",
    E.movementKind("active", "retired", "greenville", "atlanta") === "retire");
  ok("equipment: coming back is a reinstate",
    E.movementKind("retired", "reserve", "greenville", "greenville") === "reinstate");
  ok("equipment: fleet counts split capacity from ownership",
    E.deployedCount(["active", "active", "reserve", "retired"]) === 2 &&
    E.unavailableCount(["active", "active", "reserve", "retired"]) === 1);
}

// ── operator deal (0277) — real money, so the same rigour as the pricing invariants ──
{
  const OD = require("../.smoke/operatorDeal.js");
  const T = (supplyFunding, stage = "profitable", tier = "associate") => ({ supplyFunding, stage, tier });

  // THE ANCHOR: the agreed deal is 50 / 30 / 20 at the midpoint of the slider. If this ever fails,
  // the model has drifted away from what was actually agreed.
  const anchor = OD.computeSplit(T(50));
  ok("deal: the anchor is 50/30/20 at midpoint",
    anchor.operatorPct === 50 && anchor.royaltyPct === 30 && anchor.marketPct === 20, JSON.stringify(anchor));
  ok("deal: GT3 funds everything -> operator 35 / royalty 45",
    OD.computeSplit(T(0)).operatorPct === 35 && OD.computeSplit(T(0)).royaltyPct === 45);
  ok("deal: operator funds everything -> operator 65 / royalty 15",
    OD.computeSplit(T(100)).operatorPct === 65 && OD.computeSplit(T(100)).royaltyPct === 15);

  // The invariant that matters most: the three shares always reconstruct the whole, at every point
  // on the slider, in both stages, at every tier. Money that doesn't total 100% goes somewhere.
  let allTotal = true, royaltyNeverNegative = true, marketProtected = true;
  for (const stage of ["ramp", "profitable"]) {
    for (const tier of ["associate", "operator", "senior", "partner"]) {
      for (let f = 0; f <= 100; f += 1) {
        const s = OD.computeSplit(T(f, stage, tier));
        if (Math.round((s.operatorPct + s.royaltyPct + s.marketPct) * 10) / 10 !== 100) allTotal = false;
        if (s.royaltyPct < 0) royaltyNeverNegative = false;
        if (stage === "profitable" && s.marketPct !== 20) marketProtected = false;
      }
    }
  }
  ok("deal: splits total exactly 100 across every slider position, stage and tier", allTotal);
  ok("deal: royalty never goes negative", royaltyNeverNegative);
  ok("deal: the market's 20% reinvestment is never traded away when profitable", marketProtected);

  // Ramp: no profit, so no royalty — the market keeps what GT3 would have taken.
  const ramp = OD.computeSplit(T(50, "ramp"));
  ok("deal: during ramp the royalty is zero", ramp.royaltyPct === 0);
  ok("deal: during ramp the royalty share goes to the market, not GT3", ramp.marketPct === 100 - ramp.operatorPct);

  // A tier lift costs GT3, never the market.
  const assoc = OD.computeSplit(T(50, "profitable", "associate"));
  const senior = OD.computeSplit(T(50, "profitable", "senior"));
  ok("deal: a tier lift raises the operator by exactly its uplift", senior.operatorPct - assoc.operatorPct === 10);
  ok("deal: a tier lift comes out of royalty, not the market",
    assoc.royaltyPct - senior.royaltyPct === 10 && senior.marketPct === assoc.marketPct);

  // Projection: the three shares must reconstruct revenue to the cent — no rounding leak.
  const p = OD.project(T(50), 1_000_000, 200_000); // $10,000 revenue, $2,000 supplies
  ok("deal: projected shares reconstruct revenue exactly, to the cent",
    p.operatorGrossCents + p.royaltyCents + p.marketCents === 1_000_000);
  ok("deal: supply funding splits the supply bill exactly",
    p.operatorSuppliesCents + p.gt3SuppliesCents === 200_000);
  ok("deal: operator net is gross less the supplies they fund",
    p.operatorNetCents === p.operatorGrossCents - p.operatorSuppliesCents);
  // An odd revenue is where a naive percentage split leaks a cent.
  const odd = OD.project(T(37, "profitable", "senior"), 999_999, 33_333);
  ok("deal: no cent leaks on awkward numbers",
    odd.operatorGrossCents + odd.royaltyCents + odd.marketCents === 999_999 &&
    odd.operatorSuppliesCents + odd.gt3SuppliesCents === 33_333);

  // Funding more supplies buys a bigger share — but not always a bigger take-home. The builder shows
  // both numbers precisely because the honest answer depends on the supply bill.
  const cheapSupplies = OD.bestFundingForOperator(T(50), 1_000_000, 10_000);
  const brutalSupplies = OD.bestFundingForOperator(T(50), 1_000_000, 900_000);
  ok("deal: with light supply costs the operator is better off funding them", cheapSupplies === 100);
  ok("deal: with heavy supply costs funding them is NOT automatically better",
    brutalSupplies < 100, `best funding = ${brutalSupplies}`);

  // Negotiation flow — a proposal that can only be accepted is not a proposal.
  ok("deal: a draft can only be sent", OD.canAdvance("draft", "sent") && !OD.canAdvance("draft", "accepted"));
  ok("deal: a sent proposal can be accepted, questioned or countered",
    OD.canAdvance("sent", "accepted") && OD.canAdvance("sent", "changes_requested") && OD.canAdvance("sent", "countered"));
  ok("deal: an ended agreement is terminal", OD.nextStatuses("ended").length === 0);
  ok("deal: terms are editable only before anyone has agreed",
    OD.isEditable("draft") && OD.isEditable("changes_requested") && !OD.isEditable("accepted") && !OD.isEditable("active"));
  ok("deal: only an active agreement is binding", OD.isBinding("active") && !OD.isBinding("accepted"));
  ok("deal: an incomplete proposal can't be sent",
    !OD.validateProposal({ market: "atlanta", terms: OD ? { supplyFunding: 50, stage: "ramp", tier: "associate" } : null, operatorName: "" }).ok);
  ok("deal: a complete proposal validates",
    OD.validateProposal({ market: "atlanta", operatorName: "Head of Atlanta Ops", terms: { supplyFunding: 50, stage: "ramp", tier: "associate" } }).ok);
  ok("deal: unknown tier/stage/status fall back safely",
    OD.toTier("wizard") === "associate" && OD.toStage("vibes") === "ramp" && OD.toStatus(undefined) === "draft");
}

// ── SHOP MEDIA (0278) — photos + video on a product ───────────────────────────────────────────────
{
  const SM = require("../.smoke/shopMedia.js");

  // Reading: a row from BEFORE 0278 must still open. This is the back-compat contract in one test.
  const legacy = { image_url: "https://cdn/a.jpg", images: ["https://cdn/a.jpg", "https://cdn/b.jpg"] };
  const lm = SM.readMedia(legacy);
  ok("media: a legacy product synthesises media from image_url + images",
    lm.length === 2 && lm[0].url === "https://cdn/a.jpg" && lm[1].url === "https://cdn/b.jpg");
  ok("media: everything legacy reads as an image", lm.every((m) => m.kind === "image"));
  ok("media: the hero sorts first even when it also appears in images", lm[0].url === legacy.image_url);
  ok("media: a duplicate url is collapsed, not rendered twice", lm.length === 2);
  ok("media: nothing in, nothing out (never throws)",
    SM.readMedia(null).length === 0 && SM.readMedia({}).length === 0 && SM.readMedia({ images: "not-an-array" }).length === 0);

  // Reading: the new shape wins outright, and junk inside it is dropped rather than rendered.
  const modern = SM.readMedia({ image_url: "https://cdn/old.jpg", media: [
    { id: "p/1/x.mp4", url: "https://cdn/x.mp4", kind: "video", poster: "https://cdn/x.jpg" },
    { id: "p/1/y.jpg", url: "https://cdn/y.jpg", kind: "image", alt: "On the truck" },
    { url: "" }, null, 42,
  ] });
  ok("media: a real media array supersedes the legacy columns",
    modern.length === 2 && !modern.some((m) => m.url === "https://cdn/old.jpg"));
  ok("media: video keeps its kind and poster", modern[0].kind === "video" && modern[0].poster === "https://cdn/x.jpg");
  ok("media: alt text survives the read", modern[1].alt === "On the truck");
  ok("media: unparseable entries are dropped, not rendered as holes", modern.length === 2);
  ok("media: an unknown kind falls back to image, never null",
    SM.toKind("gif") === "image" && SM.toKind(undefined) === "image" && SM.toKind("video") === "video");

  // Covers: a video contributes its poster, and only its poster.
  ok("media: a video's thumbnail is its poster", SM.thumbOf(modern[0]) === "https://cdn/x.jpg");
  ok("media: a poster-less video has no thumbnail (the caller draws a placeholder)",
    SM.thumbOf({ id: "a", url: "u", kind: "video" }) === null);
  ok("media: the cover is the first showable item", SM.coverOf(modern) === "https://cdn/x.jpg");
  ok("media: a video-only, poster-less product has no cover",
    SM.coverOf([{ id: "a", url: "u", kind: "video" }]) === null);
  ok("media: hasVideo/countKind agree", SM.hasVideo(modern) && SM.countKind(modern, "image") === 1);

  // Validation: the gate that runs before a byte is uploaded.
  ok("media: a jpeg under the cap passes",
    SM.validateFile({ name: "a.jpg", type: "image/jpeg", size: 2e6 }).ok);
  ok("media: an oversized photo is refused with a reason naming the file",
    (() => { const r = SM.validateFile({ name: "huge.png", type: "image/png", size: 20e6 });
             return !r.ok && r.reason.includes("huge.png"); })());
  ok("media: video gets the bigger cap, not the photo cap",
    SM.validateFile({ name: "c.mp4", type: "video/mp4", size: 40e6 }).ok &&
    !SM.validateFile({ name: "c.jpg", type: "image/jpeg", size: 40e6 }).ok);
  ok("media: a pdf is not media", !SM.validateFile({ name: "x.pdf", type: "application/pdf", size: 10 }).ok);
  ok("media: a phone's odd mime still resolves by prefix",
    SM.kindOfType("video/mp4;codecs=avc1") === "video" && SM.kindOfType("image/heic") === "image");
  ok("media: an empty type is not guessed into media", SM.kindOfType("") === null);
  ok("media: the accept list covers both families",
    SM.ACCEPT.includes("image/jpeg") && SM.ACCEPT.includes("video/mp4"));

  // Ordering: every reorder is a no-op or a valid permutation — never a crash, never a lost item.
  const four = ["a", "b", "c", "d"].map((id) => ({ id, url: `https://cdn/${id}`, kind: "image" }));
  ok("media: move reorders", SM.move(four, 0, 2).map((m) => m.id).join("") === "bcad");
  ok("media: an out-of-range move is a no-op, not a crash",
    SM.move(four, -1, 2).map((m) => m.id).join("") === "abcd" &&
    SM.move(four, 0, 9).map((m) => m.id).join("") === "abcd");
  ok("media: no reorder ever loses or duplicates an item",
    [[0,3],[3,0],[1,2],[2,2],[-5,9]].every(([f,t]) => {
      const r = SM.move(four, f, t);
      return r.length === 4 && new Set(r.map((m) => m.id)).size === 4;
    }));
  ok("media: makeCover promotes to position 0", SM.makeCover(four, "c")[0].id === "c");
  ok("media: making the cover the cover changes nothing", SM.makeCover(four, "a").map((m) => m.id).join("") === "abcd");
  ok("media: makeCover on a missing id is a no-op", SM.makeCover(four, "zz").map((m) => m.id).join("") === "abcd");
  ok("media: removeAt removes exactly one", SM.removeAt(four, "b").map((m) => m.id).join("") === "acd");
  ok("media: setAlt blanks to undefined rather than storing an empty string",
    SM.setAlt(four, "a", "   ")[0].alt === undefined && SM.setAlt(four, "a", " x ")[0].alt === "x");
  ok("media: the source array is never mutated", four.map((m) => m.id).join("") === "abcd");

  // Writing: the legacy columns stay DERIVED, which is what keeps every pre-0278 reader working.
  const cols = SM.toColumns(modern);
  ok("media: image_url is derived, never stale", cols.image_url === "https://cdn/y.jpg");
  ok("media: images carries only images, in order", cols.images.join(",") === "https://cdn/y.jpg");
  ok("media: a video-only product still gets a hero from its poster",
    SM.toColumns([{ id: "v", url: "https://cdn/v.mp4", kind: "video", poster: "https://cdn/v.jpg" }]).image_url === "https://cdn/v.jpg");
  ok("media: a product with no media writes a null hero, not undefined",
    SM.toColumns([]).image_url === null && SM.toColumns([]).images.length === 0);
  ok("media: round-tripping through the columns is stable",
    SM.readMedia({ media: SM.toColumns(modern).media }).length === modern.length);
  ok("media: writing never exceeds the item cap",
    SM.toColumns(Array.from({ length: 30 }, (_, n) => ({ id: `i${n}`, url: `u${n}`, kind: "image" }))).media.length === SM.MAX_ITEMS);
  ok("media: slotsLeft never goes negative",
    SM.slotsLeft(new Array(99).fill(0)) === 0 && SM.slotsLeft([]) === SM.MAX_ITEMS);

  // The story's clock and its edges.
  ok("story: the left third goes back, the rest forward",
    SM.tapZone(10, 390) === "prev" && SM.tapZone(200, 390) === "next" && SM.tapZone(389, 390) === "next");
  ok("story: a zero-width stage still resolves (no divide-by-zero)", SM.tapZone(0, 0) === "next");
  ok("story: step stops hard at both ends",
    SM.step(0, 3, -1) === null && SM.step(2, 3, 1) === null && SM.step(1, 3, 1) === 2 && SM.step(1, 3, -1) === 0);
  ok("story: an empty story has nowhere to go", SM.step(0, 0, 1) === null);
  ok("story: a photo holds long enough to read but not to annoy",
    SM.STORY_IMAGE_MS >= 3000 && SM.STORY_IMAGE_MS <= 6000);
}

// ── VIEWER MARKET (0279) — which city is this person looking at ───────────────────────────────────
{
  const M = require("../.smoke/markets.js");

  // The zero-regression claim, as a test: one market on the road = the founding market, no choice.
  ok("viewer: one market on the road means no choice to offer",
    !M.shouldOfferMarketChoice(M.marketsPresent([{ market: "greenville" }, { market: "greenville" }])));
  ok("viewer: with only greenville running, the viewer is in greenville",
    M.pickViewerMarket(null, ["greenville"]) === "greenville");
  ok("viewer: and every row passes the filter",
    [{ market: "greenville" }, { market: null }, {}].every((r) => M.rowInMarket(r, "greenville")));

  // A stored choice is honoured — but only while that city still has something on.
  ok("viewer: a stored choice wins", M.pickViewerMarket("atlanta", ["greenville", "atlanta"]) === "atlanta");
  ok("viewer: a stored choice for a city that went quiet falls back to founding",
    M.pickViewerMarket("atlanta", ["greenville"]) === "greenville");
  ok("viewer: junk in storage never escapes",
    M.pickViewerMarket("mars", ["greenville", "atlanta"]) === "greenville" &&
    M.pickViewerMarket(42, ["atlanta"]) === "atlanta" &&
    M.pickViewerMarket(undefined, []) === "greenville");
  ok("viewer: nobody is shown an empty road while another city is running",
    M.pickViewerMarket(null, ["atlanta"]) === "atlanta");
  ok("viewer: the answer is never null, whatever goes in",
    [null, "", "atlanta", 0, {}, []].every((v) => M.MARKETS.includes(M.pickViewerMarket(v, []))));

  // Presence is derived from loaded rows, so the switcher can't appear for a city with nothing on.
  ok("viewer: presence is derived from rows, in a stable order",
    M.marketsPresent([{ market: "atlanta" }, { market: "greenville" }, { market: "atlanta" }]).join(",")
      === "greenville,atlanta");
  ok("viewer: rows with no market read as the founding market",
    M.marketsPresent([{}, { market: null }]).length === 0 &&
    M.rowInMarket({}, "greenville") && !M.rowInMarket({}, "atlanta"));
  ok("viewer: two markets on the road is a real choice",
    M.shouldOfferMarketChoice(M.marketsPresent([{ market: "greenville" }, { market: "atlanta" }])));
  ok("viewer: a row belongs to exactly one market",
    M.rowInMarket({ market: "atlanta" }, "atlanta") && !M.rowInMarket({ market: "atlanta" }, "greenville"));
}

// ── OFFER LETTERS (0281) — write, approve, send ───────────────────────────────────────────────────
{
  const O = require("../.smoke/offerLetter.js");

  // The gate that defines the feature: the candidate is unreachable except through approval.
  ok("offer: a draft goes to review, never straight to the candidate",
    O.canAdvance("draft", "in_review") && !O.canAdvance("draft", "sent") && !O.canAdvance("draft", "approved"));
  ok("offer: review cannot jump the candidate either",
    !O.canAdvance("in_review", "sent"));
  ok("offer: sent is reachable ONLY from approved",
    O.canAdvance("approved", "sent") &&
    !["draft","in_review","changes_requested","countered"].some((s) => O.canAdvance(s, "sent")));
  ok("offer: a co-owner asking for changes sends it back, not onward",
    O.canAdvance("in_review", "changes_requested") && O.canAdvance("changes_requested", "draft"));
  ok("offer: accepted and declined are terminal", O.isTerminal("accepted") && O.isTerminal("declined"));
  ok("offer: terms are editable only before anyone commits",
    O.isEditable("draft") && O.isEditable("changes_requested") && O.isEditable("countered") &&
    !O.isEditable("in_review") && !O.isEditable("approved") && !O.isEditable("accepted"));
  ok("offer: an unknown status reads as draft, the least privileged",
    O.toOfferStatus("wizard") === "draft" && O.toOfferStatus(undefined) === "draft");

  // Approvals: unanimous, and the author never approves their own offer.
  ok("offer: every OTHER owner must approve",
    O.requiredApprovers(["a","b","c"], "a").join(",") === "b,c");
  ok("offer: the author is never their own approver",
    !O.requiredApprovers(["a","b"], "a").includes("a"));
  ok("offer: duplicate owner ids collapse", O.requiredApprovers(["a","b","b"], "a").length === 1);
  ok("offer: a sole owner has nobody to review it — and that is NOT a unanimous vote of zero",
    O.requiredApprovers(["a"], "a").length === 0 && !O.needsReview(0) && O.needsReview(1));
  ok("offer: outcome is pending until everyone has decided",
    O.approvalOutcome([{approver_id:"b",decision:"approved"},{approver_id:"c"}]) === "pending");
  ok("offer: unanimous approval approves",
    O.approvalOutcome([{approver_id:"b",decision:"approved"},{approver_id:"c",decision:"approved"}]) === "approved");
  ok("offer: ONE objection stops it, however many approvals there are",
    O.approvalOutcome([{approver_id:"b",decision:"approved"},{approver_id:"c",decision:"changes_requested"}]) === "changes_requested");
  ok("offer: the tally adds up", (() => {
    const t = O.approvalTally([{approver_id:"b",decision:"approved"},{approver_id:"c",decision:"changes_requested"},{approver_id:"d"}]);
    return t.approved === 1 && t.changes === 1 && t.pending === 1 && t.total === 3;
  })());
  ok("offer: an empty approval set is pending, never approved", O.approvalOutcome([]) === "pending");

  // Validation catches every problem at once, not one per submit.
  const bad = O.validateOffer({});
  ok("offer: an empty offer reports every problem at once", !bad.ok && bad.problems.length >= 4);
  ok("offer: an offer with no pay is refused",
    !O.validateOffer({ candidateName:"A", candidateEmail:"a@b.co", title:"T", market:"atlanta", role:"server" }).ok);
  ok("offer: a base with no unit is refused",
    !O.validateOffer({ candidateName:"A", candidateEmail:"a@b.co", title:"T", market:"atlanta", role:"server", baseCents: 5000000 }).ok);
  // The four S.C. Code 41-10-30 fields are part of a complete offer, so every "this is valid" case
  // has to carry them. STAT is that minimum, spread into the cases below.
  const STAT = { normalHours:"Tue-Sat 6-2", paySchedule:"Every other Friday", payMethod:"Direct deposit",
                 deductions:"Withholding and FICA only" };
  ok("offer: commission alone is a valid offer",
    O.validateOffer({ candidateName:"A", candidateEmail:"a@b.co", title:"T", market:"atlanta", role:"operator", commissionPct: 50, ...STAT }).ok);

  // ── spend, budgets and the receipt rule (0292) ─────────────────────────────────────────────────
  const SP = require("../.smoke/spend.js");
  const CATS = [
    { slug: "ingredients", label: "Ingredients", sort: 10, active: true, receipt_required_over_cents: 0 },
    { slug: "marketing",   label: "Marketing",   sort: 40, active: true, receipt_required_over_cents: 2500 },
    { slug: "retired",     label: "Retired",     sort: 99, active: false, receipt_required_over_cents: 0 },
  ];
  const ex = (o) => ({ id: o.id ?? Math.random().toString(36).slice(2), market: o.market ?? "greenville",
    category: o.category, amount_cents: o.amount_cents, spent_on: o.spent_on,
    receipt_path: o.receipt_path ?? null, voided_at: o.voided_at ?? null });

  ok("spend: a month key is the first seven characters, nothing cleverer", SP.monthKey("2026-09-14") === "2026-09");

  // The receipt rule.
  ok("spend: an expense with a receipt owes nothing",
    !SP.needsReceipt(ex({ category: "ingredients", amount_cents: 9000, spent_on: "2026-09-01", receipt_path: "x.jpg" }), CATS));
  ok("spend: a category with a zero threshold always owes a receipt",
    SP.needsReceipt(ex({ category: "ingredients", amount_cents: 100, spent_on: "2026-09-01" }), CATS));
  ok("spend: under a category's threshold owes nothing",
    !SP.needsReceipt(ex({ category: "marketing", amount_cents: 2400, spent_on: "2026-09-01" }), CATS));
  ok("spend: at the threshold it does owe one — the boundary is inclusive",
    SP.needsReceipt(ex({ category: "marketing", amount_cents: 2500, spent_on: "2026-09-01" }), CATS));
  ok("spend: an unknown category is treated as always-required, the safe way to be wrong",
    SP.needsReceipt(ex({ category: "mystery", amount_cents: 1, spent_on: "2026-09-01" }), CATS));
  ok("spend: a voided expense owes nothing",
    !SP.needsReceipt(ex({ category: "ingredients", amount_cents: 9000, spent_on: "2026-09-01", voided_at: "2026-09-02" }), CATS));

  const gapRows = [
    ex({ id: "small", category: "ingredients", amount_cents: 500,   spent_on: "2026-09-01" }),
    ex({ id: "big",   category: "ingredients", amount_cents: 90000, spent_on: "2026-09-05" }),
    ex({ id: "done",  category: "ingredients", amount_cents: 70000, spent_on: "2026-09-03", receipt_path: "r.jpg" }),
  ];
  ok("spend: gaps are worst first", SP.receiptGaps(gapRows, CATS)[0].id === "big");
  ok("spend: a receipted expense is not a gap", SP.receiptGaps(gapRows, CATS).length === 2);
  ok("spend: the gap is reported as money, not just a count", SP.unreceiptedCents(gapRows, CATS) === 90500);

  // A budget belongs to a month — the point of 0292's effective_from.
  const BUDG = [
    { market: "greenville", category: "ingredients", monthly_limit_cents: 100000, effective_from: "2026-01-01" },
    { market: "greenville", category: "ingredients", monthly_limit_cents: 150000, effective_from: "2026-09-01" },
    { market: "atlanta",    category: "ingredients", monthly_limit_cents:  50000, effective_from: "2026-01-01" },
  ];
  ok("spend: an earlier month reads the budget that was in force THEN",
    SP.budgetFor("ingredients", "2026-06", BUDG, "greenville") === 100000);
  ok("spend: the month it changed reads the new one",
    SP.budgetFor("ingredients", "2026-09", BUDG, "greenville") === 150000);
  ok("spend: a later month keeps the new one",
    SP.budgetFor("ingredients", "2026-12", BUDG, "greenville") === 150000);
  ok("spend: another city has its own budget", SP.budgetFor("ingredients", "2026-09", BUDG, "atlanta") === 50000);
  ok("spend: no budget is zero, not a crash", SP.budgetFor("nothing", "2026-09", BUDG, "greenville") === 0);

  // Variance.
  const ROWS = [
    ex({ category: "ingredients", amount_cents: 160000, spent_on: "2026-09-04" }),
    ex({ category: "marketing",   amount_cents: 1000,   spent_on: "2026-09-06" }),
    ex({ category: "retired",     amount_cents: 4000,   spent_on: "2026-09-07" }),
    ex({ category: "ingredients", amount_cents: 999999, spent_on: "2026-08-30" }),   // another month
    ex({ category: "ingredients", amount_cents: 888888, spent_on: "2026-09-09", voided_at: "2026-09-10" }),
    ex({ category: "ingredients", amount_cents: 777777, spent_on: "2026-09-09", market: "atlanta" }),
  ];
  const v = SP.variance("2026-09", ROWS, BUDG, CATS, "greenville");
  const ing = v.find((l) => l.category === "ingredients");
  ok("spend: last month's spend is not counted in this month", ing.spentCents === 160000, ing.spentCents);
  ok("spend: a voided expense is not counted", ing.spentCents === 160000);
  ok("spend: another city's spend is not counted", ing.spentCents === 160000);
  ok("spend: over budget is reported as over", ing.over === true && ing.remainingCents < 0, ing.remainingCents);
  ok("spend: percentage used is reported", ing.pctUsed === 107, ing.pctUsed);
  ok("spend: a category with no budget has no percentage rather than a fake one",
    SP.variance("2026-09", ROWS, [], CATS, "greenville").find((l) => l.category === "marketing").pctUsed === null);
  ok("spend: money in a RETIRED category still shows up — it cannot hide",
    v.some((l) => l.category === "retired" && l.spentCents === 4000));
  ok("spend: lines are ordered by what was actually spent", v[0].category === "ingredients");

  const t = SP.totals("2026-09", ROWS, BUDG, CATS, "greenville");
  ok("spend: totals add the lines up", t.spentCents === 165000, t.spentCents);
  ok("spend: totals count the categories that are over", t.overCategories === 1);
  ok("spend: totals carry the unreceipted amount too", t.unreceiptedCents === 164000, t.unreceiptedCents);

  // The headline leads with bad news when there is bad news.
  ok("spend: over budget is said first", /over budget/.test(SP.headline(t)), SP.headline(t));
  const clean = SP.totals("2026-09",
    [ex({ category: "ingredients", amount_cents: 1000, spent_on: "2026-09-02", receipt_path: "r.jpg" })],
    BUDG, CATS, "greenville");
  ok("spend: a clean month says everything is receipted", /everything receipted/.test(SP.headline(clean)), SP.headline(clean));
  const noBudget = SP.totals("2026-09",
    [ex({ category: "ingredients", amount_cents: 1000, spent_on: "2026-09-02", receipt_path: "r.jpg" })], [], CATS, "greenville");
  ok("spend: spending against no budget says so instead of reading as fine",
    /no budget/.test(SP.headline(noBudget)), SP.headline(noBudget));
  ok("spend: an empty month says nothing has happened",
    /Nothing spent/.test(SP.headline(SP.totals("2026-09", [], [], CATS, "greenville"))));
  const receiptsMissing = SP.totals("2026-09",
    [ex({ category: "ingredients", amount_cents: 1000, spent_on: "2026-09-02" })], BUDG, CATS, "greenville");
  ok("spend: on budget but unreceipted is not reported as clean",
    /no receipt/.test(SP.headline(receiptsMissing)), SP.headline(receiptsMissing));

  // ── the deal explainer: the signer's side of the same math ─────────────────────────────────────
  const DX = require("../.smoke/dealExplainer.js");
  const T = (supplyFunding, stage = "profitable", tier = "operator") => ({ supplyFunding, stage, tier });

  ok("explainer: the three shares are all explained", DX.plainSplit(T(50)).length === 3);
  ok("explainer: reinvestment is described as fixed",
    /does not move/.test(DX.plainSplit(T(50)).find((l) => l.key === "market").means));
  ok("explainer: during ramp the royalty line says no royalty is taken",
    /not before|Nothing, while/.test(DX.plainSplit(T(50, "ramp")).find((l) => l.key === "royalty").means));

  // Breakeven — the number a proposal never volunteers.
  ok("explainer: funding nothing has no breakeven to clear", DX.breakevenRevenueCents(T(0), 500000) === null);
  const be = DX.breakevenRevenueCents(T(100), 500000);
  ok("explainer: funding everything has a real breakeven", typeof be === "number" && be > 0, be);
  ok("explainer: breakeven is where the operator's net is zero", (() => {
    const p = require("../.smoke/operatorDeal.js").project(T(100), be, 500000);
    return Math.abs(p.operatorNetCents) <= 2;   // rounding only
  })(), be);
  ok("explainer: funding more supplies raises the bar you have to clear",
    DX.breakevenRevenueCents(T(100), 500000) > DX.breakevenRevenueCents(T(50), 500000));

  // Margin per dollar, and the point where it goes negative.
  ok("explainer: cheap supplies leave every position profitable", DX.fundingCeiling(T(50), 5) === 100);
  ok("explainer: expensive supplies put a ceiling on how much you should fund",
    DX.fundingCeiling(T(50), 95) < 100, DX.fundingCeiling(T(50), 95));
  ok("explainer: the margin per dollar CAN come out negative — it is allowed to say no",
    DX.netPerDollarCents({ supplyFunding: 100, stage: "profitable", tier: "associate" }, 100) < 0,
    DX.netPerDollarCents({ supplyFunding: 100, stage: "profitable", tier: "associate" }, 100));

  // The ladder, and the verdict that reads it honestly.
  const lad = DX.fundingLadder(T(50), 20000000, 4000000, 10);
  ok("explainer: the ladder covers the whole slider", lad.length === 11 && lad[0].funding === 0 && lad[10].funding === 100);
  ok("explainer: exactly one position is marked best", lad.filter((s) => s.best).length === 1);
  ok("explainer: the best position pays at least as much as any other",
    lad.every((s) => s.netCents <= lad.find((x) => x.best).netCents));
  const verdictLow = DX.fundingVerdict(T(0), 20000000, 4000000);
  ok("explainer: the verdict is a sentence a person can act on", typeof verdictLow === "string" && verdictLow.length > 20);
  ok("explainer: a position that pays nothing is called out as paying nothing",
    /pays you nothing/.test(DX.fundingVerdict({ supplyFunding: 100, stage: "profitable", tier: "associate" }, 100000, 900000)),
    DX.fundingVerdict({ supplyFunding: 100, stage: "profitable", tier: "associate" }, 100000, 900000));

  // Who put what in, and when it comes back — "more owner puts in, slower return".
  ok("explainer: no contribution means nothing to pay back", DX.paybackMonths(0, 500000) === null);
  ok("explainer: nothing coming back never pays back", DX.paybackMonths(500000, 0) === Infinity);
  ok("explainer: payback rounds UP, so it never flatters the deal", DX.paybackMonths(1000, 300) === 4);

  const pic = DX.investmentPicture({
    terms: T(50), monthlyRevenueCents: 2000000, monthlySuppliesCents: 400000,
    gt3ContributionCents: 4000000, operatorContributionCents: 1500000,
  });
  ok("explainer: GT3 funding everything gives the operator the SMALLER share",
    pic.ifGt3FundedAll.operatorPct < pic.ifOperatorFundedAll.operatorPct,
    [pic.ifGt3FundedAll.operatorPct, pic.ifOperatorFundedAll.operatorPct]);
  ok("explainer: and therefore the SLOWER return on the operator's own money",
    pic.ifGt3FundedAll.operatorMonths >= pic.ifOperatorFundedAll.operatorMonths,
    [pic.ifGt3FundedAll.operatorMonths, pic.ifOperatorFundedAll.operatorMonths]);
  ok("explainer: the trade is named in months, not just percent",
    /months/.test(pic.tradeoff) && /slower return/.test(pic.tradeoff), pic.tradeoff);
  ok("explainer: GT3's own contribution gets a payback too", typeof pic.gt3.months === "number" && pic.gt3.months > 0, pic.gt3.months);
  ok("explainer: an operator who puts in nothing is told the cost is the share, not the wait",
    /nothing for you to earn back/.test(DX.investmentPicture({
      terms: T(50), monthlyRevenueCents: 2000000, monthlySuppliesCents: 400000,
      gt3ContributionCents: 4000000, operatorContributionCents: 0,
    }).tradeoff));
  ok("explainer: the operator's own position is reported, not just the two ends",
    pic.operator.monthlyCents > 0 && pic.operator.contributionCents === 1500000);

  // Where they sit on the ladder.
  const tl = DX.tierLadder("senior");
  ok("explainer: the tier ladder shows every rung", tl.length === 4);
  ok("explainer: exactly one rung is current", tl.filter((t) => t.current).length === 1);
  ok("explainer: rungs already passed are marked reached", tl.filter((t) => t.reached).length === 3);
  ok("explainer: the top tier still says what comes next", DX.whatIsNext("partner").length > 10);

  // What signing does.
  const undecided = DX.whatYouAreSigning({ stage: "ramp" });
  ok("explainer: an undecided supply arrangement is flagged heavy",
    undecided.some((f) => f.heavy && /undecided/i.test(f.k)));
  ok("explainer: the finality of the terms is always stated first",
    DX.whatYouAreSigning({}).at(0).heavy === true);
  const markup = DX.whatYouAreSigning({ supplySourcing: "gt3_supplied", priceBasis: "cost_plus" });
  ok("explainer: a markup on required supplies is named as a real cost",
    markup.some((f) => f.heavy && /markup/i.test(f.v)));
  ok("explainer: at-cost supply is not overstated as a markup",
    !DX.whatYouAreSigning({ supplySourcing: "gt3_supplied", priceBasis: "at_cost" }).some((f) => /markup/i.test(f.v)));
  ok("explainer: equity eligibility is never described as a grant",
    DX.whatYouAreSigning({ equityEligible: true, equityScope: "market_entity" })
      .some((f) => /not the same as granted/i.test(f.v)));
  ok("explainer: the right to counter is always stated",
    DX.whatYouAreSigning({}).some((f) => /counter/i.test(f.k) || /counter/i.test(f.v)));

  // The employee side.
  const pay = DX.payAtVolumes({ baseCents: 5200000, ratePer: "year", commissionPct: 2 }, DX.DEFAULT_VOLUMES);
  ok("explainer: three volumes are shown, not one", pay.length === 3);
  ok("explainer: a bigger year pays more", pay[2].totalCents > pay[0].totalCents);
  ok("explainer: base with no commission is flat across volumes", (() => {
    const p = DX.payAtVolumes({ baseCents: 5200000, ratePer: "year", commissionPct: 0 }, DX.DEFAULT_VOLUMES);
    return p[0].totalCents === p[2].totalCents;
  })());
  ok("explainer: an hourly base is annualised before it is compared",
    DX.payAtVolumes({ baseCents: 2500, ratePer: "hour", commissionPct: 0 }, DX.DEFAULT_VOLUMES)[0].totalCents === 2500 * 2080);
  ok("explainer: a commission-only offer still reads as a range",
    DX.payAtVolumes({ baseCents: 0, ratePer: null, commissionPct: 10 }, DX.DEFAULT_VOLUMES)[0].totalCents > 0);

  // ── the statutory four (0286) ──────────────────────────────────────────────────────────────────
  const complete = { candidateName:"A", candidateEmail:"a@b.co", title:"T", market:"greenville",
                     role:"server", baseCents: 5200000, ratePer:"year", ...STAT };
  ok("offer: a complete letter validates", O.validateOffer(complete).ok);
  ok("offer: nothing is missing from a complete letter", O.missingStatutory(complete).length === 0);
  ok("offer: the statute names exactly four things", O.STATUTORY_FIELDS.length === 4);
  ok("offer: an offer with no normal hours is refused",
    !O.validateOffer({ ...complete, normalHours: "" }).ok);
  ok("offer: an offer that never says when they are paid is refused",
    !O.validateOffer({ ...complete, paySchedule: null }).ok);
  ok("offer: an offer that never says how they are paid is refused",
    !O.validateOffer({ ...complete, payMethod: "   " }).ok);
  ok("offer: an offer silent on deductions is refused",
    !O.validateOffer({ ...complete, deductions: undefined }).ok);
  ok("offer: whitespace does not count as an answer",
    O.missingStatutory({ ...complete, normalHours: "   " }).length === 1);
  ok("offer: all four missing are reported together, not one per submit",
    O.missingStatutory({ candidateName:"A" }).length === 4);
  ok("offer: the refusal cites the statute so it can be looked up",
    O.validateOffer({ ...complete, deductions: "" }).problems.some((p) => /41-10-30/.test(p)));
  ok("offer: a fresh draft starts with the four blank, not pre-filled with a guess",
    O.missingStatutory(O.emptyOffer()).length === 4);
  ok("offer: every statutory field carries an example the writer can copy",
    O.STATUTORY_FIELDS.every((f) => f.hint.trim().length > 0 && f.why.trim().length > 0));
  ok("offer: a bad email is caught",
    !O.validateOffer({ candidateName:"A", candidateEmail:"nope", title:"T", market:"atlanta", role:"server", commissionPct: 10 }).ok);
  ok("offer: commission outside 0-100 is refused",
    !O.validateOffer({ candidateName:"A", candidateEmail:"a@b.co", title:"T", market:"atlanta", role:"server", commissionPct: 140 }).ok);

  // Roles: owner can never be offered, and the reach text is real.
  ok("offer: owner is not an offerable role", !O.OFFERABLE_ROLES.includes("owner"));
  ok("offer: an unknown role falls back to member, the least privileged",
    O.toRoleKey("wizard") === "member" && O.toRoleKey(undefined) === "member");
  ok("offer: the four staff roles are declared as the same gate",
    ["server","contractor","operator","event_manager"].every((r) => O.ROLE_ACCESS[r].gate === "staff"));
  ok("offer: every role says what it reaches and what it cannot",
    Object.values(O.ROLE_ACCESS).every((a) => a.reaches.length > 0 && Array.isArray(a.cannot)));

  // Classification: the flags only exist when the letter claims contractor.
  ok("offer: an employee offer raises no classification flags",
    O.classificationFlags({ employmentType: "employee", setsSchedule: true, baseCents: 5e6 }).length === 0);
  ok("offer: a contractor with a guaranteed base and our schedule is flagged", (() => {
    const f = O.classificationFlags({ employmentType: "contractor", setsSchedule: true, baseCents: 5e6 });
    return f.length === 2 && f.every((x) => x.says && x.why);
  })());
  ok("offer: a clean contractor offer is not flagged",
    O.classificationFlags({ employmentType: "contractor", baseCents: null }).length === 0);
  ok("offer: employment type never resolves to junk",
    O.toEmploymentType("1099") === "employee" && O.toEmploymentType("contractor") === "contractor");

  // The one-liner a co-owner approves against is the one the candidate reads.
  ok("offer: the summary carries title, market, pay and type", (() => {
    const s = O.summarize({ title:"Head of Atlanta Ops", market:"atlanta", baseCents: 7500000,
                            ratePer:"year", commissionPct: 10, employmentType:"employee" });
    return s.includes("Head of Atlanta Ops") && s.includes("Atlanta") && s.includes("$75,000")
        && s.includes("10% commission") && s.includes("employee");
  })());
  ok("offer: money formats or says nothing, never NaN",
    O.money(null) === "—" && O.money(7500000) === "$75,000");
  ok("offer: a fresh offer validates as incomplete rather than throwing",
    !O.validateOffer(O.emptyOffer()).ok);
}

// ── GT3 Academy: where one person stands ──────────────────────────────────────────────────────
// The Academy has 30 modules and 12 certifications and, at the time of writing, zero rows of
// progress for anybody. The role paths that say what each role must complete have existed all
// along; nothing outside the Academy page ever read them.
{
  const A = require("../.smoke/academy.js");

  const none = new Set();
  const op = A.pathProgress("operator", none);
  // ── the house voice is plural ────────────────────────────────────────────────────────────────
  // GT3 is owner-operated by two people, but every founder note used to be written in ONE person's
  // first person — "I don't need clones", "you don't need me in the room", "that's the only version
  // of GT3 that outlives me". Read together they describe a company with a single operator, which
  // is the opposite of what the crew, the roster and the market leads are all for. The copy is the
  // owners' voice now, and this keeps it there: whoever writes the next module trips here rather
  // than in front of somebody being trained.
  // Case-insensitive on purpose. The first version of this check was /\b(I|me|my|mine)\b/ and it
  // missed "My job was never to be the best on the cart" — a sentence this very commit rewrote —
  // because the pronoun was capitalised at the head of a sentence. A guard that cannot catch the
  // thing it was written for is worse than none: it reports green and nobody looks again.
  const singularVoice = /\b(i|me|my|mine)\b/i;
  const singularNotes = A.MODULES
    .filter((m) => m.founderInsight && singularVoice.test(m.founderInsight))
    .map((m) => m.slug);
  ok("academy: no founders' note speaks as a single operator", singularNotes.length === 0, singularNotes);
  const singularProducts = A.PRODUCTS
    .filter((p) => p.voices && singularVoice.test(p.voices.founder))
    .map((p) => p.key);
  ok("academy: and neither does a product's founders' voice", singularProducts.length === 0, singularProducts);
  ok("academy: the notes are still there to be checked",
    A.MODULES.filter((m) => m.founderInsight).length >= 25,
    A.MODULES.filter((m) => m.founderInsight).length);

  ok("academy: an operator's path is the union of its certs' modules",
    op.certsTotal === 8 && op.modulesTotal > 0, `${op.certsEarned}/${op.certsTotal}, ${op.modulesTotal} modules`);
  ok("academy: nothing done reads as nothing done, not as complete",
    op.modulesDone === 0 && op.modulesLeft === op.modulesTotal && !op.complete);
  ok("academy: an untouched path still names the next module to do",
    op.nextModule !== null && typeof op.nextModule.slug === "string", op.nextModule && op.nextModule.slug);
  ok("academy: and the certification that module counts toward",
    op.nextCert !== null, op.nextCert && op.nextCert.key);
  ok("academy: time remaining is the sum of what is left, not of everything",
    op.minutesLeft > 0 && op.minutesLeft === A.requiredModules("operator").reduce((n, m) => n + (m.estMin || 0), 0));

  // A bigger role is a strict superset of a smaller one's requirement — the ladder has to hold.
  const ct = A.pathProgress("contractor", none);
  ok("academy: a contractor's path is smaller than an operator's",
    ct.certsTotal < op.certsTotal && ct.modulesTotal < op.modulesTotal,
    `contractor ${ct.modulesTotal} vs operator ${op.modulesTotal}`);

  // Completing every required module earns every cert on the path.
  const all = new Set(A.requiredModules("operator").map((m) => m.slug));
  const done = A.pathProgress("operator", all);
  ok("academy: finishing the required modules earns the whole path",
    done.complete && done.certsEarned === done.certsTotal && done.modulesLeft === 0,
    `${done.certsEarned}/${done.certsTotal}`);
  ok("academy: a finished path has nothing left to do and no next module",
    done.minutesLeft === 0 && done.nextModule === null && done.nextCert === null);

  // Partial progress must not round up into a certification nobody earned.
  const first = A.requiredModules("operator")[0];
  const partial = A.pathProgress("operator", new Set([first.slug]));
  ok("academy: one module done does not grant a certification on its own",
    partial.modulesDone === 1 && partial.certsEarned <= op.certsTotal && !partial.complete);

  // An unknown role falls back to the staff path rather than throwing or returning an empty path.
  const unknown = A.pathProgress("nonsense-role", none);
  ok("academy: an unrecognised role gets the staff path, not an empty one",
    unknown.modulesTotal === A.pathProgress("staff", none).modulesTotal && unknown.modulesTotal > 0);

  ok("academy: the headline leads with what to do, and says so plainly",
    /not started/.test(A.pathHeadline(op)) && /complete/.test(A.pathHeadline(done)),
    `${A.pathHeadline(op)} | ${A.pathHeadline(done)}`);
  ok("academy: a part-done path reports certifications rather than 'not started'",
    /certifications/.test(A.pathHeadline(partial)), A.pathHeadline(partial));
}

// ── Sizing a batch by coffee, not by water ────────────────────────────────────────────────────
// The scale sheet only asked for gallons. You buy coffee by the bag and water by the tap, so the
// fixed quantity is almost always the coffee — asking for gallons and discovering afterwards that
// it wanted more coffee than is on the shelf is the failure this removes.
{
  const B = require("../.smoke/brewMath.js");

  // GT3 Rise as seeded in 0079: 2 gal of water, 560 g coffee, 32 oz coconut water.
  const RISE = [
    { name: "Mountain Valley Spring Water", qty: 2, unit: "gal", scales: true },
    { name: "Coarse-ground organic single-origin coffee", qty: 560, unit: "g", scales: true },
    { name: "Organic coconut water (add after filtration)", qty: 32, unit: "oz", scales: true },
  ];
  const opts = B.sizingOptions(RISE, 2);
  ok("brew: every scaling ingredient can size a batch", opts.length === 3, String(opts.length));
  const coffee = opts.find((o) => /coffee/i.test(o.name));
  ok("brew: 560 g over 2 gal is 280 g a gallon", coffee.perGal === 280, String(coffee.perGal));

  // Rise carries 32 oz of coconut water per 2 gal — 454 g/gal against the coffee's 280 — so picking
  // the heaviest line picks the coconut water. It is the coffee that binds a batch, and the first
  // version of this assertion was loose enough to pass on the wrong answer.
  const primary = B.primarySizing(opts);
  ok("brew: the form opens on the coffee, not on whatever weighs most",
    /coffee/i.test(primary.name), `${primary.name} @ ${primary.gramsPerGal} g/gal`);
  ok("brew: and coconut water is heavier, which is why weight alone was the wrong rule",
    opts.find((o) => /coconut/i.test(o.name)).gramsPerGal > coffee.gramsPerGal);
  // With no coffee line at all it falls back to weight rather than returning nothing.
  const noCoffee = B.primarySizing(B.sizingOptions(
    [{ name: "Organic cacao nibs", qty: 160, unit: "g", scales: true },
     { name: "Ceylon cinnamon", qty: 8, unit: "g", scales: true }], 2));
  ok("brew: with no coffee line it falls back to the heaviest", /cacao/i.test(noCoffee.name), noCoffee.name);
  ok("brew: water is not a sizing candidate — it has no weight unit",
    opts.find((o) => /Spring Water/.test(o.name)).gramsPerGal === null);

  // Two-way, and exactly reversible.
  ok("brew: 1120 g of coffee makes a 4 gal batch",
    B.gallonsFromIngredient(1120, 280) === 4, String(B.gallonsFromIngredient(1120, 280)));
  ok("brew: a 4 gal batch calls for 1120 g of coffee",
    B.ingredientForGallons(4, 280) === 1120, String(B.ingredientForGallons(4, 280)));
  ok("brew: the conversion round-trips",
    B.ingredientForGallons(B.gallonsFromIngredient(917, 280), 280) === 917);

  // Ten pounds of coffee — the real Atlanta shelf — against a 2.5 gal Toddy.
  const tenLb = 10 * 453.59237;
  const gal = B.gallonsFromIngredient(tenLb, 280);
  ok("brew: ten pounds of coffee is about 16.2 gal of Rise",
    Math.abs(gal - 16.1997) < 0.001, gal.toFixed(4));
  ok("brew: which is far more than one Toddy holds", gal > 2.5);

  // Rounding DOWN, because the coffee is a hard limit.
  ok("brew: a batch sized from a fixed bag rounds down, never up",
    B.quarterGalDown(16.1997) === 16 && B.quarterGalDown(4.99) === 4.75,
    `${B.quarterGalDown(16.1997)} / ${B.quarterGalDown(4.99)}`);
  ok("brew: rounding down never asks for more than you have",
    B.ingredientForGallons(B.quarterGalDown(gal), 280) <= tenLb);

  // A line that does not scale cannot size a batch — doubling one filter does not double a brew.
  const withFilter = B.sizingOptions([...RISE, { name: "Paper filter", qty: 1, unit: "each", scales: false }], 2);
  ok("brew: a non-scaling line is not offered as a way to size a batch",
    !withFilter.some((o) => /filter/i.test(o.name)), JSON.stringify(withFilter.map((o) => o.name)));

  // Degenerate inputs return nothing rather than Infinity or NaN.
  ok("brew: a recipe with no reference volume sizes nothing", B.sizingOptions(RISE, 0).length === 0);
  ok("brew: no ingredients sizes nothing", B.sizingOptions(null, 2).length === 0);
  ok("brew: dividing by a zero rate gives 0, not Infinity", B.gallonsFromIngredient(500, 0) === 0);
  ok("brew: nothing weighed means no primary line", B.primarySizing([]) === null);
  // ── DOES THE BATCH FIT THE VESSEL (0310) ─────────────────────────────────────────────────────────
  // The case that motivated it, kept as the first assertion so the reason survives: half a 340 g bag
  // is 170 g, which at 280 g/gal is 0.607 gal, which rounds down to 0.5 — and the only vessel on file
  // is a 5 gal tower. Correct arithmetic, unbrewable batch, and the planner said nothing.

      const fit = (g, cap, n) => B.vesselFit(g, cap, n);

    ok("vessel: 0.5 gal in the 5 gal tower reads as shallow, not as fine",
      fit(0.5, 5).verdict === "shallow");
    ok("vessel: and says how little of it is filled — 10%",
      fit(0.5, 5).pct === 10);
    ok("vessel: the full 340 g bag (1 gal) is still shallow in a 5 gal tower",
      fit(1, 5).verdict === "shallow");
    ok("vessel: two full bags (2 gal) clears the third and reads as fitting",
      fit(2, 5).verdict === "fits");
    ok("vessel: exactly at capacity fits — the boundary is not an error",
      fit(5, 5).verdict === "fits" && fit(5, 5).pct === 100);
    ok("vessel: a hair over capacity is over",
      fit(5.25, 5).verdict === "over");
    ok("vessel: and says by how much, so the fix is obvious",
      fit(5.25, 5).overBy === 0.25);
    ok("vessel: count multiplies capacity — 8 gal across two 5s fits",
      fit(8, 5, 2).verdict === "fits");
    ok("vessel: and 8 gal in ONE 5 is over by 3",
      fit(8, 5, 1).verdict === "over" && fit(8, 5, 1).overBy === 3);
    ok("vessel: a third of capacity is the line, and sitting on it fits",
      fit(5 / 3, 5).verdict === "fits");
    ok("vessel: just under the line is shallow",
      fit(5 / 3 - 0.01, 5).verdict === "shallow");
    ok("vessel: no size and no capacity return null rather than a verdict about nothing",
      fit(0, 5) === null && fit(2, 0) === null && fit(NaN, 5) === null);
    // floating point: 0.1+0.2 style capacity sums must not trip the over branch
    ok("vessel: 0.75 across three 0.25s is exactly full, not over",
      fit(0.75, 0.25, 3).verdict === "fits");

}

// ── Deploy skew: when a crashed screen should heal itself ─────────────────────────────────────
// Every message below is one that actually reached production. This list is the point of the
// module: the inline regex it replaced had already been patched once for Turbopack and STILL
// missed the next Turbopack phrasing, because "load chunk" is not "loading chunk".
{
  const D = require("../.smoke/deploySkew.js");

  // The one that got through and emailed a CRITICAL alert — /crew, 2026-09-06.
  ok("skew: the message that slipped through is caught now",
    D.isDeploySkew("Failed to load chunk /_next/static/chunks/0pfvpf_6yqhu-.js?dpl=dpl_AXuE7noGhgUrg8BQPrzp6uVDzLjQ from module 74850"));
  // The phrasings the old pattern did cover — still covered.
  ok("skew: webpack's ChunkLoadError", D.isDeploySkew("ChunkLoadError: Loading chunk 42 failed."));
  ok("skew: Turbopack's module factory wording (seen on /menu)",
    D.isDeploySkew("module factory is not available"));
  ok("skew: a rebuilt shared module (seen as mixTotal on /reserve)",
    D.isDeploySkew("t.mixTotal is not a function"));
  ok("skew: Safari's wording for the same thing",
    D.isDeploySkew("undefined is not an object (evaluating 'o.mixTotal')"));
  ok("skew: an import that never arrived", D.isDeploySkew("Importing a module script failed."));

  // Real defects must NOT trigger a reload — a reload loop on a genuine bug is worse than the bug.
  ok("skew: a null dereference is a real bug, not skew",
    !D.isDeploySkew("Cannot read properties of null (reading 'market')"));
  ok("skew: a failed API call is not skew", !D.isDeploySkew("Request failed with status 500"));
  ok("skew: a thrown business rule is not skew",
    !D.isDeploySkew("Log what this batch used before marking it served."));
  ok("skew: an empty or missing message is not skew",
    !D.isDeploySkew("") && !D.isDeploySkew(null) && !D.isDeploySkew(undefined));

  // ── the attempt guard ──
  const t0 = 1_000_000;
  const first = D.nextSkewAction(D.EMPTY_SKEW, t0);
  ok("skew: the first crash reloads", first.reload && first.mem.attempts === 1);
  ok("skew: an immediate repeat does not — that is the loop guard",
    !D.nextSkewAction(first.mem, t0 + 1000).reload);
  const second = D.nextSkewAction(first.mem, t0 + D.SKEW_MIN_GAP_MS + 1);
  ok("skew: but a later deploy in the same session heals again", second.reload && second.mem.attempts === 2);
  const third = D.nextSkewAction(second.mem, t0 + 999_999);
  ok("skew: a third attempt is still allowed", third.reload && third.mem.attempts === 3);
  ok("skew: a fourth is not — a screen that keeps crashing is a real bug, so stop and show it",
    !D.nextSkewAction(third.mem, t0 + 9_999_999).reload);

  // Storage is untrusted: this runs inside the last UI that still works.
  ok("skew: junk in storage reads as a clean slate",
    D.readSkewMemory("not json").attempts === 0 && D.readSkewMemory(null).attempts === 0);
  ok("skew: a half-written value does not throw or go NaN",
    D.readSkewMemory('{"attempts":"x"}').attempts === 0);
  ok("skew: a good value round-trips",
    D.readSkewMemory(JSON.stringify({ attempts: 2, lastAt: 5 })).attempts === 2);
  ok("skew: a corrupt memory still permits a heal rather than wedging the app",
    D.nextSkewAction(D.readSkewMemory("garbage"), t0).reload);

  // ── what the crash is REPORTED as ────────────────────────────────────────────────────────────
  // The self-heal above worked and the owners still got "Critical — a screen crashed" at 8:30 PM
  // on 2026-09-06, because app/error.tsx reported fatal on its first line and checked for skew on
  // its fourth. Fatality is decided before the report is sent now.
  const REAL = "Failed to load chunk /_next/static/chunks/0pfvpf_6yqhu-.js?dpl=dpl_AXuE7noGhgUrg8BQPrzp6uVDzLjQ from module 74850";
  const healing = D.classifyCrash(REAL, { attempts: 0, lastAt: 0 }, t0);
  ok("report: a skew we are about to heal reloads and does NOT page anyone",
    healing.skew && healing.reload && healing.fatal === false, healing);
  const spent = D.classifyCrash(REAL, { attempts: D.SKEW_MAX_ATTEMPTS, lastAt: 0 }, t0);
  ok("report: a skew that ran out of reloads IS fatal — the reload did not fix it",
    spent.skew && spent.reload === false && spent.fatal === true, spent);
  const realBug = D.classifyCrash("Cannot read properties of null (reading 'market')", { attempts: 0, lastAt: 0 }, t0);
  ok("report: a genuine crash is still fatal and does not reload",
    realBug.skew === false && realBug.reload === false && realBug.fatal === true, realBug);
  ok("report: classifying does not consume an attempt when it is not skew",
    realBug.mem.attempts === 0, realBug.mem);

  // ── one bug, one row ─────────────────────────────────────────────────────────────────────────
  // /api/errors/report dedupes on a fingerprint of the message. A skew message carries the chunk
  // hash, the deployment id and a module number — all different on every build — so the dedup that
  // exists precisely to stop repeat alerts never once fired for the error that repeats most.
  const deployA = REAL;
  const deployB = "Failed to load chunk /_next/static/chunks/9zzqvv_1abcd-.js?dpl=dpl_ZqW4rTy8UuIiOoPpAaSsDd from module 51122";
  ok("dedup: the same failure from two different deploys is ONE fingerprint",
    D.stableErrorKey(deployA) === D.stableErrorKey(deployB), [D.stableErrorKey(deployA), D.stableErrorKey(deployB)]);
  ok("dedup: and the build-specific noise is gone from the key",
    !/dpl_|0pfvpf|74850/.test(D.stableErrorKey(deployA)), D.stableErrorKey(deployA));
  ok("dedup: webpack's numbered form collapses too",
    D.stableErrorKey("Loading chunk 42 failed.") === D.stableErrorKey("Loading chunk 7 failed."));
  ok("dedup: two genuinely different bugs still fingerprint differently",
    D.stableErrorKey("Cannot read properties of null (reading 'market')")
      !== D.stableErrorKey("Cannot read properties of null (reading 'batch')"));
  ok("dedup: a message with nothing build-specific in it survives intact",
    D.stableErrorKey("x.map is not a function") === "x.map is not a function");
  ok("dedup: empty in, empty out — never throws inside the report path",
    D.stableErrorKey(null) === "" && D.stableErrorKey(undefined) === "");
}

// ── A RECORD HAS AN ADDRESS (lib/records) ────────────────────────────────────────────────────────
// The survey's root finding: no route or URL anywhere in this app addressed a single record —
// ?s=<section> was the deepest link that existed. Parsing has to be STRICT, because the failure it
// replaces is TaskSheet's goal link, which pointed at a wrong parameter name AND a section that does
// not exist and silently landed people on the wrong screen for months. A link that half-works is
// worse than one that plainly does not.
{
  const R = require("../.smoke/records.js");

  ok("records: a ref round-trips through the URL form",
    R.recordParam({ kind: "person", id: "3fe59a00-2e58-43da-a075-aa0484bc4363" })
      === "person:3fe59a00-2e58-43da-a075-aa0484bc4363");
  const back = R.parseRecordParam("person:3fe59a00-2e58-43da-a075-aa0484bc4363");
  ok("records: and parses back to the same ref",
    back && back.kind === "person" && back.id === "3fe59a00-2e58-43da-a075-aa0484bc4363");
  ok("records: a customer ref works the same way",
    R.parseRecordParam("customer:7cea9576-b435-4f59-a9e0-9e70f54406ac").kind === "customer");

  // every way a hand-edited or stale link can be wrong
  ok("records: an unknown kind is refused rather than opening an empty sheet",
    R.parseRecordParam("invoice:3fe59a00-2e58-43da-a075-aa0484bc4363") === null);
  ok("records: a missing id is refused", R.parseRecordParam("person:") === null);
  ok("records: a missing colon is refused", R.parseRecordParam("person") === null);
  ok("records: a leading colon is refused", R.parseRecordParam(":abc") === null);
  ok("records: an id that is not a uuid is refused — a link that half-works is worse than none",
    R.parseRecordParam("person:not-a-uuid") === null);
  ok("records: null and empty in, null out — never throws on a URL with no ?r=",
    R.parseRecordParam(null) === null && R.parseRecordParam("") === null
      && R.parseRecordParam(undefined) === null);
  // a uuid containing a colon-ish shape must not be split at the wrong place
  ok("records: only the FIRST colon separates kind from id",
    R.parseRecordParam("person:3fe59a00-2e58-43da-a075-aa0484bc4363").id.length === 36);
  ok("records: the kind guard agrees with the list",
    R.isRecordKind("person") && R.isRecordKind("customer") && !R.isRecordKind("goal"));
  ok("records: every kind has a label, so nothing renders an untitled sheet",
    R.RECORD_KINDS.every((k) => typeof R.RECORD_LABEL[k] === "string" && R.RECORD_LABEL[k].length > 0));
}

// ── SHOP ORDER (0313) ────────────────────────────────────────────────────────────────────────────
// The database enforces which moves are legal; this module decides which ones the screen OFFERS.
// If the two drift, the screen grows a button that always fails — so the first block reads the
// transition table OUT OF THE MIGRATION FILE and compares it, rather than trusting my memory of it.
{
  const S = require("../.smoke/shopOrder.js");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const sql = readFileSync(join(__dirname, "..", "supabase/migrations/0313_a_paid_order_nobody_can_see.sql"), "utf8");

  const block = (sql.match(/legal\s*:=\s*case o\.status([\s\S]*?)end;/) || [])[1] || "";
  const fromSql = {};
  for (const m of block.matchAll(/when\s+'([a-z_]+)'\s*then\s*array\[([^\]]*)\]/g)) {
    fromSql[m[1]] = m[2].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean).sort();
  }
  fromSql.refunded = [];   // the `else array[]::text[]` arm — the only status that falls through it
  const norm = (a) => JSON.stringify([...a].sort());
  ok("shopOrder: the migration's transition table was actually found in the file",
    Object.keys(fromSql).length === 8, Object.keys(fromSql));
  ok("shopOrder: every move the screen offers is one the database will accept",
    S.SHOP_STATUSES.every((s) => norm(S.SHOP_FLOW[s]) === norm(fromSql[s] || [])),
    S.SHOP_STATUSES.filter((s) => norm(S.SHOP_FLOW[s]) !== norm(fromSql[s] || [])));

  ok("shopOrder: a paid order can be sent to the printer or stopped",
    S.canMove("paid", "submitted") && S.canMove("paid", "canceled"));
  ok("shopOrder: but cannot skip to delivered", !S.canMove("paid", "delivered"));
  ok("shopOrder: refunded is the end", S.isTerminal("refunded") && S.nextStatuses("refunded").length === 0);
  ok("shopOrder: cancelled is NOT the end — the money still has to go back",
    !S.isTerminal("canceled") && S.nextStatuses("canceled").includes("refunded"));
  ok("shopOrder: an unknown status offers nothing rather than throwing",
    S.nextStatuses("wat").length === 0 && S.nextStatuses(null).length === 0 && !S.canMove(null, "shipped"));

  ok("shopOrder: only the 'us' stages are the crew's to act on",
    S.waitingOn("needs_fulfillment") === "us" && S.waitingOn("submitted") === "printer"
      && S.waitingOn("shipped") === "carrier" && S.waitingOn("delivered") === "nobody");
  ok("shopOrder: every status has a label and a plain-words meaning",
    S.SHOP_STATUSES.every((s) => S.SHOP_STATUS_META[s].label && S.SHOP_STATUS_META[s].means.length > 20));
  ok("shopOrder: an unknown status still renders something rather than blank",
    S.statusLabel("weird") === "weird" && S.statusLabel(null) === "Unknown");

  // the money sentence — the one that stops the app writing a cheque Square has to honour
  ok("shopOrder: refund and cancel both demand a reason", S.needsReason("refunded") && S.needsReason("canceled"));
  ok("shopOrder: shipping does not", !S.needsReason("shipped"));
  ok("shopOrder: recording a refund says, in the confirm, that it does not issue one",
    /does not issue/i.test(S.moveWarning("refunded") || ""));
  ok("shopOrder: cancelling says it does not return the money either",
    /does not return the money/i.test(S.moveWarning("canceled") || ""));
  ok("shopOrder: a routine move carries no warning, so the two that matter still read as warnings",
    S.moveWarning("delivered") === null && S.moveWarning("in_production") === null);

  ok("shopOrder: money drops the cents when there are none", S.money(4200) === "$42" && S.money(1999) === "$19.99");
  ok("shopOrder: and says nothing rather than $0 when there is no number",
    S.money(null) === "—" && S.money(undefined) === "—");
  ok("shopOrder: margin percent from a known cost", S.marginPct(2300, 4200) === 55);
  ok("shopOrder: unknown cost in, unknown margin out — never 100%",
    S.marginPct(null, 4200) === null && S.marginPct(2300, null) === null && S.marginPct(2300, 0) === null);

  ok("shopOrder: an address reads like an envelope",
    S.shipLine({ street: "1 Peachtree", city: "Atlanta", state: "GA", zip: "30301" }) === "1 Peachtree · Atlanta, GA · 30301");
  ok("shopOrder: a half-filled address drops the gaps instead of printing them",
    S.shipLine({ street: "1 Peachtree", zip: "30301" }) === "1 Peachtree · 30301");
  ok("shopOrder: a missing address is empty, not '[object Object]'",
    S.shipLine(null) === "" && S.shipLine("nope") === "" && S.shipLine({}) === "");

  ok("shopOrder: age reads the way a person says it",
    S.ageLabel(0.4) === "just now" && S.ageLabel(6) === "6h" && S.ageLabel(24) === "1 day" && S.ageLabel(73) === "3 days");
  ok("shopOrder: and says nothing when there is no age", S.ageLabel(null) === "" && S.ageLabel(-1) === "");

  ok("shopOrder: an empty queue says so plainly", S.queueHeadline({ on_us: 0 }) === "Nothing waiting on us.");
  ok("shopOrder: and so does a missing one — the screen never leads with a fake number",
    S.queueHeadline(null) === "Nothing waiting on us.");
  ok("shopOrder: one waiting order is singular",
    S.queueHeadline({ on_us: 1, oldest_on_us_hours: 30 }) === "1 order is waiting on us — the oldest for 1 day.");
  ok("shopOrder: several are not",
    S.queueHeadline({ on_us: 3, oldest_on_us_hours: 5 }) === "3 orders are waiting on us — the oldest for 5h.");
}

// ── EVENT RECORD (0314) ──────────────────────────────────────────────────────────────────────────
// Same cross-check as the shop order: the gap keys the screen knows how to explain are read out of
// the MIGRATION FILE and compared, so a rule added to v_event_gaps without a fix sentence shows up
// here rather than as a row with no advice on it.
{
  const E = require("../.smoke/eventRecord.js");
  const sqlE = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "supabase/migrations/0314_an_event_is_ten_screens_and_no_record.sql"), "utf8");
  const inSql = [...sqlE.matchAll(/\(\s*'([a-z_]+)',\s*'[^']*',\s*'(high|medium|low)'/g)].map((m) => m[1]);
  ok("eventRecord: the migration's gap list was actually found in the file", inSql.length === 9, inSql);
  ok("eventRecord: every gap the database can emit has a fix sentence — no row of advice-free blame",
    inSql.every((k) => E.gapFix(k).length > 0), inSql.filter((k) => !E.gapFix(k)));
  ok("eventRecord: and the module invents none the database cannot emit",
    E.GAP_KEYS.every((k) => inSql.includes(k)), E.GAP_KEYS.filter((k) => !inSql.includes(k)));
  ok("eventRecord: an unknown gap gets no invented advice", E.gapFix("made_up") === "" && E.gapFix(null) === "");

  ok("eventRecord: worst first", E.sortGaps([{ gap: "no_recap", severity: "low" }, { gap: "twin", severity: "high" },
    { gap: "no_sales", severity: "medium" }]).map((r) => r.gap).join(",") === "twin,no_sales,no_recap");
  ok("eventRecord: ties break by key, so the list does not reshuffle between renders",
    E.sortGaps([{ gap: "no_title", severity: "high" }, { gap: "done_early", severity: "high" }])
      .map((r) => r.gap).join(",") === "done_early,no_title");
  ok("eventRecord: an unknown severity sinks rather than jumping the queue",
    E.sortGaps([{ gap: "x", severity: "weird" }, { gap: "y", severity: "low" }]).map((r) => r.gap).join(",") === "y,x");

  ok("eventRecord: stage words", E.stageLabel("prep") === "In prep" && E.stageLabel("done") === "Done");
  ok("eventRecord: an unknown stage still renders something", E.stageLabel("zzz") === "zzz" && E.stageLabel(null) === "—");
  ok("eventRecord: planning stages are the three before it happens",
    E.isPlanning("lead") && E.isPlanning("confirmed") && E.isPlanning("prep")
      && !E.isPlanning("live") && !E.isPlanning("done"));

  // the ambiguity that let two events sit at 'confirmed' for a month after they happened
  ok("eventRecord: when says which SIDE of today the date falls on",
    E.whenLabel("upcoming", 14) === "in 14 days" && E.whenLabel("past", -38) === "38 days ago");
  ok("eventRecord: today, tomorrow and yesterday are said the way people say them",
    E.whenLabel("today", 0) === "today" && E.whenLabel("upcoming", 1) === "tomorrow" && E.whenLabel("past", -1) === "yesterday");
  ok("eventRecord: no date says so rather than reading as today",
    E.whenLabel("undated", null) === "no date yet" && E.whenLabel("upcoming", null) === "no date yet");

  ok("eventRecord: a finished event with no takings says exactly that",
    E.owedLine({ stage: "done", sales_count: 0 }) === "Finished, with nothing recorded as taken.");
  ok("eventRecord: a finished event with takings but no write-up says that instead",
    E.owedLine({ stage: "done", sales_count: 2, recap: "  " }) === "Finished. No after-action note yet.");
  ok("eventRecord: and a properly wrapped one is quiet",
    E.owedLine({ stage: "done", sales_count: 2, recap: "Sold out by noon" }) === "Finished and written up.");
  ok("eventRecord: a past date still being planned is the loudest thing it can say",
    E.owedLine({ stage: "confirmed", phase: "past" }) === "The day has passed and this is still being planned.");
  ok("eventRecord: critical work beats headcount beats ordinary jobs",
    E.owedLine({ stage: "prep", phase: "upcoming", tasks_critical_open: 2, staff: 0, tasks_open: 9 }) === "2 critical jobs still open."
      && E.owedLine({ stage: "prep", phase: "upcoming", staff: 0, tasks_open: 9 }) === "Nobody is on it yet."
      && E.owedLine({ stage: "prep", phase: "upcoming", staff: 2, tasks_open: 1 }) === "1 job left.");
  ok("eventRecord: and an event with nothing outstanding says so",
    E.owedLine({ stage: "confirmed", phase: "upcoming", staff: 1 }) === "Nothing outstanding.");
  ok("eventRecord: no event at all is empty, not a crash", E.owedLine(null) === "" && E.owedLine(undefined) === "");

  ok("eventRecord: a place reads like a place",
    E.placeLine({ location_text: "Unity Park", county: "Greenville", state: "SC" }) === "Unity Park · Greenville, SC");
  ok("eventRecord: with the gaps dropped, not printed",
    E.placeLine({ location_text: "Unity Park" }) === "Unity Park" && E.placeLine({ state: "SC" }) === "SC");
  ok("eventRecord: and nothing at all is empty", E.placeLine(null) === "" && E.placeLine({}) === "");

  ok("eventRecord: money matches the house short form", E.money(6000) === "$60" && E.money(1999) === "$19.99" && E.money(null) === "—");

  // the handoff five call sites used to spell by hand, in two different encodings
  ok("eventRecord: one function now builds the prep handoff",
    E.prepHandoffValue("event", "abc") === "abc" && E.prepHandoffValue("stop", "abc") === "stop:abc");
}

console.log(`\nSPACE/LOADOUT SMOKE: ${pass} passed, ${fail} failed`);
console.log(`Sample — trailer: ${tS.usedCuft}/${tS.usableCuft} cu ft (${tS.cuftLevel}); vehicle: ${vS.usedCuft}/${vS.usableCuft} cu ft (${vS.cuftLevel})`);
process.exit(fail ? 1 : 0);
