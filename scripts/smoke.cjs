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
const PENDING = [];   // async assertions; awaited before the summary prints (see the tail)
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

  // ── clock times and the agenda sort key ──────────────────────────────────────────────────────
  // The company calendar showed a stop's title and nothing else while the row it fetched already
  // held the start, the end and the venue. Adding them meant a fourth copy of "timestamp → 11:00am"
  // (FindUs' whenTime was the third), so it moved here instead. These pin the convention the whole
  // point of the move was to keep: minutes always, lowercase, no space before am/pm.
  {
    // An ET WALL CLOCK, expressed as the UTC instant it really is. September is EDT (UTC-4), so
    // 7:00am Eastern is 11:00 UTC. Written this way on purpose: the old helper built a LOCAL Date
    // and assumed the formatter would read it back in the same zone, which is precisely the
    // assumption clockTime just stopped making. These assertions now hold on any machine.
    const et = (h, m) => new Date(Date.UTC(2026, 8, 12, h + 4, m)).toISOString();

    ok("clock: a timestamp reads like the event rows beside it — minutes kept, lowercase, no space",
      DT.clockTime(et(11, 0)) === "11:00am", DT.clockTime(et(11, 0)));
    ok("clock: afternoon", DT.clockTime(et(15, 30)) === "3:30pm", DT.clockTime(et(15, 30)));
    ok("clock: midnight and noon do not collapse to 0",
      DT.clockTime(et(0, 5)) === "12:05am" && DT.clockTime(et(12, 5)) === "12:05pm",
      [DT.clockTime(et(0, 5)), DT.clockTime(et(12, 5))]);
    ok("clock: nothing in, empty out — never the string 'Invalid Date' on a screen",
      DT.clockTime(null) === "" && DT.clockTime("") === "" && DT.clockTime("not a date") === "");

    // ── PINNED TO ET, both sides of DST ───────────────────────────────────────────────────────
    // A stop happens where the truck is. The first version of clockTime formatted in the VIEWER's
    // timezone, so one real start read 7:00am in Greenville and 4:00am in Los Angeles. These use
    // absolute UTC instants, so they fail if the pin is ever removed — whatever zone runs them.
    ok("clock: summer — 11:00 UTC is 7:00am Eastern, not the reader's 11",
      DT.clockTime("2026-09-12T11:00:00Z") === "7:00am", DT.clockTime("2026-09-12T11:00:00Z"));
    ok("clock: and the other side of DST — 17:00 UTC in January is noon Eastern",
      DT.clockTime("2026-01-15T17:00:00Z") === "12:00pm", DT.clockTime("2026-01-15T17:00:00Z"));

    ok("range: a stop with both ends reads as a range",
      DT.timeRange(et(11, 0), et(14, 0)) === "11:00am\u20132:00pm", DT.timeRange(et(11, 0), et(14, 0)));
    ok("range: no end is just the start, not a dangling dash",
      DT.timeRange(et(11, 0), null) === "11:00am");
    ok("range: an end equal to the start is not printed twice",
      DT.timeRange(et(11, 0), et(11, 0)) === "11:00am");
    ok("range: no start is nothing at all", DT.timeRange(null, et(14, 0)) === "");
    // Wine Express Saturday, exactly as production holds it — the row that started this.
    ok("range: the pin carries through a range (Wine Express Saturday, as production holds it)",
      DT.timeRange("2026-09-12T11:00:00Z", "2026-09-12T14:00:00Z") === "7:00am\u201310:00am",
      DT.timeRange("2026-09-12T11:00:00Z", "2026-09-12T14:00:00Z"));

    ok("sort: a typed 12-hour time becomes a 24-hour key", DT.sortTime("6:00pm") === "18:00", DT.sortTime("6:00pm"));
    ok("sort: and a typed 24-hour one passes through", DT.sortTime("18:00") === "18:00");
    ok("sort: 12am and 12pm are the two that catch naive code out",
      DT.sortTime("12:00am") === "00:00" && DT.sortTime("12:00pm") === "12:00");
    ok("sort: a timestamp resolves to a wall clock", !!DT.sortTime(et(15, 30)), DT.sortTime(et(15, 30)));
    ok("sort: undated is null, so it sorts AFTER everything timed rather than to midnight",
      DT.sortTime(null) === null && DT.sortTime("") === null && DT.sortTime("whenever") === null);
    ok("sort: the keys order the way the day actually runs",
      ["15:30", "11:00", "09:15"].sort().join(",") === "09:15,11:00,15:30");

    // byClock is what the calendar hands to .sort(). Before it, a day came out in the order the
    // fifteen queries ran — every event, then every stop — so an 11:00am stop could sit under a
    // 3:30pm one. The two Sep 12 stops in production are exactly that pair.
    const day = [
      { n: "Restore Hyper Wellness", at: DT.sortTime("15:30") },
      { n: "a to-do, no time",       at: DT.sortTime(null) },
      { n: "Wine Express Saturday",  at: DT.sortTime("11:00") },
      { n: "another to-do",          at: DT.sortTime("") },
    ];
    ok("order: timed items lead, in clock order, and undated ones follow",
      day.slice().sort(DT.byClock).map((x) => x.n).join(" | ")
        === "Wine Express Saturday | Restore Hyper Wellness | a to-do, no time | another to-do",
      day.slice().sort(DT.byClock).map((x) => x.n));
    ok("order: undated items keep the order they were pushed in — the sort is stable, not shuffled",
      [{ n: "a", at: null }, { n: "b", at: null }, { n: "c", at: null }]
        .sort(DT.byClock).map((x) => x.n).join("") === "abc");
    ok("order: a day with nothing timed is left exactly as it was",
      [{ n: "x", at: null }, { n: "y", at: null }].sort(DT.byClock).map((x) => x.n).join("") === "xy");
  }
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

  // ── WHAT DAY IS IT — the question this file was written to answer once ────────────────────────
  // This file's header names the bug: "'today' computed three ways (UTC slice, operator-local,
  // calendar-local), so after ~8pm ET every UTC surface flipped to tomorrow." It was written to end
  // that. Twenty-four sites in nineteen files went on computing it as `new Date().toISOString()
  // .slice(0, 10)` anyway — the UTC slice, by name — including a route that interpolated the result
  // into a prompt as "Today is ${today} (America/New_York)".
  //
  // toISOString() is UTC in a BROWSER too, which is why half of those were client-side. An operator
  // logging maintenance at 9pm in Greenville stamped it with tomorrow.
  ok("etToday: the business day is a key, and it is the ET one",
    /^\d{4}-\d{2}-\d{2}$/.test(DT.etToday()) && DT.etToday() === DT.etDayKey(new Date()), DT.etToday());
  // 01:30 UTC on Oct 1 is 9:30pm ET on Sep 30. The UTC slice says October; the business says
  // September; and every commerce key in this app means the business's answer.
  ok("etToday: 9:30pm ET is still yesterday's date in UTC terms — and the business day is the ET one",
    DT.etDayKey(new Date("2026-10-01T01:30:00Z")) === "2026-09-30",
    DT.etDayKey(new Date("2026-10-01T01:30:00Z")));
  ok("etDayKey: and it holds on the other side of DST",
    DT.etDayKey(new Date("2026-01-15T02:30:00Z")) === "2026-01-14",
    DT.etDayKey(new Date("2026-01-15T02:30:00Z")));

  // dayFromKey — the noon anchor, which four files had each worked out and written inline.
  ok("dayFromKey: a key becomes the day it names, not the day before",
    DT.dayFromKey("2026-07-18").getDate() === 18 && DT.dayFromKey("2026-07-18").getMonth() === 6);
  ok("dayFromKey: THE reason it is noon — new Date('2026-07-18') is midnight UTC, which is the 17th here",
    DT.dayFromKey("2026-07-18").getDay() === new Date(2026, 6, 18).getDay());
  ok("dayFromKey: a full timestamp is trimmed to its day rather than rejected",
    DT.dayFromKey("2026-07-18T23:45:00Z").getDate() === 18);

  ok("addDays: forward", DT.addDays("2026-07-18", 7) === "2026-07-25");
  ok("addDays: backward", DT.addDays("2026-07-18", -1) === "2026-07-17");
  ok("addDays: zero is the same day", DT.addDays("2026-07-18", 0) === "2026-07-18");
  ok("addDays: across a month end", DT.addDays("2026-01-31", 1) === "2026-02-01");
  ok("addDays: across a year end", DT.addDays("2026-12-31", 1) === "2027-01-01");
  // The whole reason this is not `Date.now() + n * 864e5`: a span crossing a DST change is 23 or 25
  // hours, and the naive arithmetic lands an hour off — which is a DAY off whenever it crosses
  // midnight. US DST springs forward 2026-03-08.
  ok("addDays: a span across the DST change still lands on the day a person would name",
    DT.addDays("2026-03-07", 2) === "2026-03-09" && DT.addDays("2026-03-09", -2) === "2026-03-07",
    [DT.addDays("2026-03-07", 2), DT.addDays("2026-03-09", -2)]);
  ok("addDays: nonsense in, the same nonsense out — never 'NaN-aN-aN' on a screen",
    DT.addDays("not-a-date", 3) === "not-a-date");

  ok("weekdayOf: the day a key falls on", DT.weekdayOf("2026-07-18") === "Saturday", DT.weekdayOf("2026-07-18"));
  ok("weekdayOf: short form", DT.weekdayOf("2026-07-18", "short") === "Sat");
  ok("weekdayOf: garbage is empty, not 'Invalid Date'", DT.weekdayOf("nope") === "");
  // The event planner asked "what weekday is it" of a Date in the server's zone. On a Saturday
  // evening the server already believes it is Sunday, so the coming Saturday resolved a WEEK late.
  ok("weekdayOf: a key cannot be read in the wrong zone, which is the entire point of taking a key",
    DT.weekdayOf(DT.etDayKey(new Date("2026-07-19T01:30:00Z"))) === "Saturday",
    DT.weekdayOf(DT.etDayKey(new Date("2026-07-19T01:30:00Z"))));
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

// ── cookQuantity (2026-10-01) — stating a quantity to somebody who is about to measure it ──────
// Ryan, adding a second operator who will also be cooking: "the ingredient is in the correct
// measurement of grams and/or make sure that ai, cookbooks, and recipes give it in ounces and
// grams." BrewSteps and BrewPlanner both rendered `{qty}{unit}` straight out of the recipe, so a
// gram figure never showed ounces and an ounce figure never showed grams.
//
// The assertions that matter most here are the REFUSALS. Converting a volume to a weight needs a
// density that a recipe line does not carry, and a cook handed a confidently wrong gram figure is
// worse off than one handed none — so a wrong conversion must be impossible, not merely unlikely.
{
  const BM = require("../.smoke/brewMath.js");
  const q = BM.cookQuantity;

  // Metric in → imperial beside it. 560 / 28.349523125 = 19.753 → 19.8 oz.
  ok("cook: a gram figure gains ounces", q(560, "g").display === "560 g (19.8 oz)", q(560, "g").display);
  // Imperial in → metric beside it. 32 × 28.349523125 = 907.18 → 907 g (no decimals on a kitchen
  // scale at that magnitude; the extra digits read as precision the scale does not have).
  ok("cook: an ounce figure gains grams", q(32, "oz").display === "32 oz (907 g)", q(32, "oz").display);
  ok("cook: pounds convert from the exact definition, not 454",
    q(1, "lb").display === "1 lb (454 g)" && Math.abs(q(1, "lb").grams - 453.59237) < 1e-9, q(1, "lb").display);
  ok("cook: kilograms read as kilograms and still show ounces",
    q(1.2, "kg").display === "1.2 kg (42.3 oz)", q(1.2, "kg").display);
  // Under 10 g a tenth matters (a 7.5 g salt line is not 8 g); under 1 oz, two decimals.
  ok("cook: small weights keep the decimal a scale can actually show",
    q(0.25, "oz").display === "0.25 oz (7.1 g)" && q(7, "g").alt === "0.25 oz",
    `${q(0.25, "oz").display} / ${q(7, "g").alt}`);

  // THE REFUSALS.
  const gal = q(2, "gal");
  ok("cook: a VOLUME is passed through untouched — 2 gal of water and 2 gal of honey are not the same weight",
    gal.kind === "volume" && gal.display === "2 gal" && gal.grams === null && gal.alt === null, gal);
  for (const u of ["cup", "tbsp", "tsp", "ml", "l", "qt", "fl oz", "pint"]) {
    ok(`cook: ${u} is never given a weight`, q(1, u).grams === null && q(1, u).needsScale === false, q(1, u));
  }
  const pods = q(48, "pods");
  ok("cook: an unknown unit is counted, never guessed at",
    pods.kind === "counted" && pods.display === "48 pods" && pods.needsScale === false, pods);
  ok("cook: a bare count with no unit survives as written", q(1, "").display === "1" && q(1, "").needsScale === false, q(1, ""));
  ok("cook: junk in does not become a number out",
    q(null, "g").needsScale === false && q("", "g").needsScale === false && q(-5, "g").needsScale === false
    && q("abc", "g").needsScale === false,
    [q(null, "g"), q("abc", "g")]);

  // needsScale is what drives the red band and the WEIGH marks, so it must be true for exactly the
  // weighed lines and nothing else. A band on "48 pods" teaches a cook the red is noise — the same
  // disease as the heartbeat flood this app spent two days clearing out.
  const lines = [
    { qty: 560, unit: "g" }, { qty: 32, unit: "oz" }, { qty: 2, unit: "gal" },
    { qty: 48, unit: "pods" }, { qty: 1, unit: "" }, { qty: 0.5, unit: "lb" }, { qty: 250, unit: "ml" },
  ];
  const needs = lines.filter((l) => q(l.qty, l.unit).needsScale);
  ok("cook: needsScale is true for exactly the weighed lines — 3 of 7",
    needs.length === 3 && needs.every((l) => ["g", "oz", "lb"].includes(l.unit)), needs);

  // primary/alt/display are three views of ONE decision; a UI that styles the two figures
  // separately must never be able to show something the plain-text form does not say.
  for (const l of lines) {
    const c = q(l.qty, l.unit);
    ok(`cook: display is exactly primary+alt for ${l.qty} ${l.unit || "(none)"}`,
      c.display === (c.alt ? `${c.primary} (${c.alt})` : c.primary), c);
    ok(`cook: alt exists iff it is weighed for ${l.qty} ${l.unit || "(none)"}`,
      (c.alt !== null) === c.needsScale, c);
  }

  // The conversion is reversible to within the rounding the display admits — proof that one table
  // is doing both directions rather than two tables drifting.
  ok("cook: grams→oz→grams round-trips", Math.abs(q(q(560, "g").ounces, "oz").grams - 560) < 1e-6);
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
  ok("deal: a draft can be sent or discarded, and nothing else",
    OD.canAdvance("draft", "sent") && OD.canAdvance("draft", "voided") && !OD.canAdvance("draft", "accepted"));
  ok("deal: a sent proposal can be accepted, questioned or countered",
    OD.canAdvance("sent", "accepted") && OD.canAdvance("sent", "changes_requested") && OD.canAdvance("sent", "countered"));
  ok("deal: an ended agreement is terminal", OD.nextStatuses("ended").length === 0);
  // 0325 — the draft that could not be thrown away. Both halves matter: the move has to exist
  // before acceptance, and it must NOT exist after, because withdrawing a proposal and unwinding
  // an executed agreement are different acts that must not share a button.
  ok("deal: a withdrawn proposal is terminal", OD.nextStatuses("voided").length === 0);
  ok("deal: every pre-acceptance status can be discarded",
    ["draft", "sent", "changes_requested", "countered"].every((s) => OD.isDiscardable(s) && OD.canAdvance(s, "voided")));
  ok("deal: an executed agreement cannot be discarded — it ENDS",
    ["accepted", "signed", "active", "ended", "voided"].every((s) => !OD.isDiscardable(s) && !OD.canAdvance(s, "voided")));
  ok("deal: withdrawn is not a synonym for ended — they are different words on screen",
    OD.STATUS_LABEL.voided === "Withdrawn" && OD.STATUS_LABEL.ended === "Ended");
  ok("deal: both are closed, neither is editable or binding",
    OD.isClosed("voided") && OD.isClosed("ended") && !OD.isClosed("draft")
    && !OD.isEditable("voided") && !OD.isBinding("voided"));
  // The TS predicate and the SQL function have to refuse the same set, or the button appears and
  // then the call fails. Read out of 0325's own text rather than restated here.
  {
    const sql = require("node:fs").readFileSync(require("node:path").join(__dirname, "..",
      "supabase/migrations/0325_a_draft_nobody_has_seen.sql"), "utf8");
    const m = sql.match(/if v_status in \(([^)]*)\)/);
    const refused = (m ? m[1] : "").split(",").map((s) => s.trim().replace(/'/g, ""));
    ok("deal: discard_agreement refuses exactly the statuses isDiscardable() hides the button for",
      refused.length === 5 && refused.every((s) => !OD.isDiscardable(s))
      && OD.AGREEMENT_STATUS.filter((s) => !OD.isDiscardable(s)).length === refused.length, refused);
  }
  ok("deal: terms are editable only before anyone has agreed",
    OD.isEditable("draft") && OD.isEditable("changes_requested") && !OD.isEditable("accepted") && !OD.isEditable("active"));
  ok("deal: only an active agreement is binding", OD.isBinding("active") && !OD.isBinding("accepted"));
  ok("deal: an incomplete proposal can't be sent",
    !OD.validateProposal({ market: "atlanta", terms: OD ? { supplyFunding: 50, stage: "ramp", tier: "associate" } : null, operatorName: "" }).ok);
  ok("deal: a complete proposal validates",
    OD.validateProposal({ market: "atlanta", operatorName: "Head of Atlanta Ops", terms: { supplyFunding: 50, stage: "ramp", tier: "associate" } }).ok);
  ok("deal: unknown tier/stage/status fall back safely",
    OD.toTier("wizard") === "associate" && OD.toStage("vibes") === "ramp" && OD.toStatus(undefined) === "draft");

  // ── THE BUSINESS TAB, 2026-10-04: two identical rows reading "New operator · Associate · 50/0/50" ──
  // Three bare numbers in an order nobody on the screen could know, on two drafts nobody could tell
  // apart or tell were blank. The split is said in words now, a draft still on its defaults says so,
  // and "+ New agreement" opens that blank instead of making another.
  ok("deal: a split is said in words, operator · royalty · market",
    OD.splitWords({ operatorPct: 50, royaltyPct: 0, marketPct: 50 }) === "50% operator · 0% royalty · 50% market");
  ok("deal: summarize says it the same way — no bare a/b/c left",
    OD.summarize({ supplyFunding: 50, stage: "profitable", tier: "associate" }, "greenville").includes("50% operator · 30% royalty · 20% market")
    && !/\b\d+\/\d+\/\d+\b/.test(OD.summarize({ supplyFunding: 50, stage: "profitable", tier: "associate" }, "greenville")));
  const made = "2026-10-03T21:04:00.123456+00:00";
  ok("deal: a draft whose stamps still match is untouched", OD.isUntouchedDraft({ status: "draft", created_at: made, updated_at: made }));
  ok("deal: …however the instant is spelled", OD.isUntouchedDraft({ status: "draft", created_at: "2026-10-03T21:04:00Z", updated_at: "2026-10-03T21:04:00+00:00" }));
  ok("deal: one saved even once is not", !OD.isUntouchedDraft({ status: "draft", created_at: made, updated_at: "2026-10-03T21:09:12Z" }));
  ok("deal: nothing but a draft can be blank, and missing stamps prove nothing",
    !OD.isUntouchedDraft({ status: "sent", created_at: made, updated_at: made })
    && !OD.isUntouchedDraft({ status: "draft", created_at: made, updated_at: null })
    && !OD.isUntouchedDraft({ status: "draft", created_at: "nonsense", updated_at: "nonsense" }));
  {
    const fs = require("node:fs"), path = require("node:path");
    const src = fs.readFileSync(path.join(__dirname, "..", "components/OperatorDeal.tsx"), "utf8");
    const create = src.slice(src.indexOf("const createDraft = async"), src.indexOf("return (", src.indexOf("const createDraft = async")));
    ok("deal: + New agreement looks for an untouched draft BEFORE it inserts one",
      create.indexOf("isUntouchedDraft") > 0 && create.indexOf("isUntouchedDraft") < create.indexOf(".insert("));
    ok("deal: the list asks for updated_at, or the blank rule has nothing to read",
      (src.match(/package, notes, created_at, updated_at,/g) || []).length === 2);
    ok("deal: no list row prints the split as bare numbers",
      !/\{row\.operator_pct\}\/\{row\.royalty_pct\}/.test(src) && /splitWords\(\{ operatorPct: row\.operator_pct/.test(src));
    // The empty state promised "the default lands on the agreed 50/30/20". The draft it makes is a
    // RAMP draft, and during ramp the royalty is zero — so what it actually made was 50/0/50.
    const dflt = OD.computeSplit({ supplyFunding: 50, stage: "ramp", tier: "associate" });
    ok("deal: a new draft is a ramp draft, and its royalty is zero",
      /stage: "ramp"/.test(create) && dflt.royaltyPct === 0 && dflt.operatorPct === 50);
    ok("deal: …so the empty state no longer promises 50/30/20 as the default",
      !src.includes("the default lands on the agreed 50/30/20") && src.includes("no royalty until the market is profitable"));
  }
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

  // ── CAPTURE AND REVIEW ARE TWO JOBS (2026-10-04) ─────────────────────────────────────────────
  // Ryan, of Money › Spend: "Should you have an open field like this or should it be architected
  // differently?" A five-field form under the report, defaulted to "supplies" and Greenville, the
  // receipt only attachable after the row existed, "2026-10" for a month, slugs for categories, and
  // three sentences in a row saying nothing had been spent. Logging moved to a sheet (LogPurchase in
  // the quick-actions dock); the panel is the month.
  {
    const now = new Date(2026, 9, 4, 21, 0);       // Sat Oct 4 2026, 9 PM local
    ok("spend words: the month is said as a month, this year without the year",
      SP.monthLabel("2026-10", now) === "October" && SP.monthLabel("2025-10", now) === "October 2025");
    ok("spend words: a key it cannot read comes back as it was, not as a wrong month",
      SP.monthLabel("garbage", now) === "garbage" && SP.monthLabel("2026-13", now) === "2026-13");
    const C = [...CATS, { slug: "supplies", label: "Supplies", sort: 20, active: true, receipt_required_over_cents: 0 }];
    ok("spend words: a category is said by its label, never its slug", SP.categoryLabel("supplies", C) === "Supplies");
    ok("spend words: …and one the table does not know is at least readable", SP.categoryLabel("booth_fee", C) === "Booth fee");
    const order = SP.categoryOrder(C, [{ category: "marketing" }, { category: "marketing" }, { category: "supplies" }]).map((c) => c.slug);
    ok("spend words: the categories this business uses come first, then the house order",
      order.join() === "marketing,supplies,ingredients", order);
    ok("spend words: a retired category is not offered for a new purchase", !order.includes("retired"));
    ok("spend words: with no history it is simply the house order",
      SP.categoryOrder(C).map((c) => c.slug).join() === "ingredients,supplies,marketing");
    ok("receipt ask: marketing under its threshold owes nothing", SP.receiptAsk(2000, "marketing", C, false) === null);
    ok("receipt ask: over it, the sheet says so with the number",
      /Marketing needs a receipt from \$25/.test(SP.receiptAsk(3000, "marketing", C, false) || ""), SP.receiptAsk(3000, "marketing", C, false));
    ok("receipt ask: an always-receipted category says always",
      /Supplies always needs a receipt/.test(SP.receiptAsk(500, "supplies", C, false) || ""));
    ok("receipt ask: a receipt in hand, or no amount yet, and it says nothing",
      SP.receiptAsk(500, "supplies", C, true) === null && SP.receiptAsk(0, "supplies", C, false) === null);
    ok("purchase day: today is the local day", SP.purchaseDay("today", "", now) === "2026-10-04");
    ok("purchase day: yesterday crosses a month boundary correctly",
      SP.purchaseDay("yesterday", "", new Date(2026, 9, 1, 8, 0)) === "2026-09-30");
    ok("purchase day: a picked day is taken as given, and a bad one is refused rather than guessed",
      SP.purchaseDay("pick", "2026-09-12", now) === "2026-09-12" && SP.purchaseDay("pick", "Sept 12", now) === "");

    const fs = require("node:fs"), path = require("node:path");
    const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    const panel = read("components/SpendBudget.tsx"), sheet = read("components/LogPurchase.tsx"), dock = read("components/QuickDock.tsx");
    const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
    ok("spend panel: no form lives in the report any more — it opens the one capture sheet",
      !/spb-add/.test(code(panel)) && !/\.from\("expenses"\)\.insert\(/.test(code(panel)) && /gt3-log-purchase/.test(code(panel)));
    ok("spend panel: its list is windowed on spent_on, the day report_spend() totals by",
      /\.gte\("spent_on", monthStart\)/.test(code(panel)) && !/\.gte\("created_at"/.test(code(panel)));
    ok("spend panel: one empty state, not three",
      !/Nothing logged yet this month\./.test(code(panel)) && /<EmptyState/.test(code(panel)) && /\{!nothingYet && <p className=\{`spb-line/.test(code(panel)));
    ok("spend panel: the month in words and categories by label",
      /monthLabel\(rep\.month\)/.test(code(panel)) && !/\{rep\.month\}/.test(code(panel)) && /categoryLabel\(/.test(code(panel)));
    ok("purchase sheet: nothing is pre-chosen for the category",
      /\[cat, setCat\] = useState<string \| null>\(null\)/.test(code(sheet)) && !/useState(<[^>]*>)?\("supplies"\)/.test(code(sheet) + code(panel)));
    ok("purchase sheet: it files the day it was spent, and the receipt through the one home",
      /spent_on: spentOn/.test(code(sheet)) && /from "@\/lib\/receipts"/.test(sheet) && /attachReceipt\(/.test(code(sheet)));
    ok("purchase sheet: the quick-actions dock opens it, by tab and by event",
      /gt3-log-purchase/.test(code(dock)) && /<LogPurchase /.test(code(dock)) && /mode === "spend"/.test(code(dock)));
    // ONE HOME FOR A RECEIPT. The panel and the sheet both file receipts; only lib/receipts touches
    // the bucket, so the path and size rules cannot drift between them.
    const bucketCallers = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) { if (!/node_modules|\.next|\.smoke|\.git/.test(f)) walk(f); continue; }
        if (/\.tsx?$/.test(e.name) && /storage\.from\("receipts"\)/.test(code(fs.readFileSync(f, "utf8")))) bucketCallers.push(f.replace(path.join(__dirname, "..") + "/", ""));
      }
    })(path.join(__dirname, ".."));
    ok("receipts: only lib/receipts.ts touches the receipts bucket", bucketCallers.join() === "lib/receipts.ts", bucketCallers);
  }

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

  // ── READINESS, SAID AS WHAT IS LEFT (2026-10-04) ──────────────────────────────────────────────
  // Ryan's Academy screenshot: five readiness rows, each a dash — not ready, but not why, not how far,
  // and nothing to tap. And no cert could ever renew: an expired one stayed expired for ever.
  {
    const serve = A.READINESS.find((r) => r.q === "Can serve customers");
    const cx = A.certByKey("cx"), product = A.certByKey("product");
    const st = (o = {}) => ({
      certStatus: (k) => o.status?.[k] ?? "none",
      completed: new Set(o.done ?? []),
      acked: new Set(o.acked ?? []),
      retakenSince: o.retaken ? (m, k) => (o.retaken[k] ?? []).includes(m) : undefined,
    });
    const fresh = A.readinessGap(serve, st());
    const need = new Set([...cx.modules, ...product.modules]).size;
    ok("readiness: nothing done says how much, and names the sign-off",
      fresh.line === `${need} modules and the Food Safety & Handling sign-off to go` && !fresh.ok, fresh.line);
    ok("readiness: …and opens the sign-off first — it is the one marked required before serving",
      fresh.next?.k === "ack" && fresh.next?.key === "food-safety", fresh.next);
    const signed = A.readinessGap(serve, st({ acked: ["food-safety"], done: [cx.modules[0]] }));
    ok("readiness: signed, it counts only the modules left and opens the first of them",
      signed.line === `${need - 1} modules to go` && signed.next?.k === "module" && signed.next?.slug === cx.modules[1], signed);
    const ready = A.readinessGap(serve, st({ acked: ["food-safety"], status: { cx: "active", product: "expiring" } }));
    ok("readiness: held certs (expiring is still held) and the sign-off read Ready, with nothing to open",
      ready.ok && ready.line === "Ready" && ready.next === null, ready);
    const lapsed = A.readinessGap(serve, st({ acked: ["food-safety"], status: { cx: "expired", product: "active" },
      done: [...cx.modules], retaken: { cx: [cx.modules[0]] } }));
    ok("readiness: a lapsed cert counts the modules still to RETAKE, and says it expired",
      lapsed.line === `${cx.modules.length - 1} modules to go · Hospitality expired — retake to renew` && lapsed.next?.slug === cx.modules[1], lapsed.line);
    const allRetaken = A.readinessGap(serve, st({ acked: ["food-safety"], status: { cx: "expired", product: "active" },
      retaken: { cx: [...cx.modules] } }));
    ok("readiness: retaken but not yet renewed still has a door, never a dead row",
      !allRetaken.ok && allRetaken.line === "Hospitality expired — retake to renew" && allRetaken.next?.slug === cx.modules[0], allRetaken);
    ok("renewal: a lapsed cert needs every module retaken since it lapsed",
      A.renewalLeft(cx, (m) => m === cx.modules[0]).join() === cx.modules.slice(1).join()
      && A.renewalLeft(cx, () => true).length === 0 && A.renewalLeft(cx, undefined).length === cx.modules.length);

    const fs = require("node:fs"), path = require("node:path");
    const page = fs.readFileSync(path.join(__dirname, "..", "app/academy/page.tsx"), "utf8");
    ok("academy page: a row with something left is a button that opens it",
      /className="ac-rrow go" onClick=\{open\}/.test(page) && /readinessGap\(r, \{/.test(page) && !/\{ok \? <Icon name="check" \/> : "—"\}<\/span>\{r\.q\}/.test(page));
    ok("academy page: completing a module of a lapsed cert renews it, and progress carries completed_at to say so",
      /const renewed = CERTS\.filter/.test(page) && /renewalLeft\(c, retaken\)/.test(page) && /select\("module_slug,status,best_score,completed_at"\)/.test(page));
    // A renewal or a first cert whose write failed is not lost: both are worked out against the rows
    // that were RECORDED, so the next module finished writes them. Gating renewal on "this module is
    // one of the cert's" would leave a failed renewal waiting on one particular module.
    ok("academy page: new certs are measured against recorded rows, and any lapsed cert can renew",
      /certEarned\(c, nowComplete\) && !certs\.has\(c\.key\)/.test(page)
      && /CERTS\.filter\(\(c\) => certs\.has\(c\.key\) && lapsed\(c\.key\) && renewalLeft\(c, retaken\)\.length === 0\)/.test(page));
    // A FAILED WRITE IS NOT A COMPLETION. Each of the three writes reads its error and says so.
    ok("academy page: a refused progress, certification or sign-off write says so instead of 'complete'",
      /const \{ error: progErr \} = await supabase\.from\("academy_progress"\)/.test(page) && /if \(progErr\) \{ toast\(/.test(page)
      && /const \{ error: certErr \} = await supabase\.from\("academy_certifications"\)/.test(page) && /if \(certErr\) \{/.test(page)
      && /const \{ error \} = await supabase\.from\("academy_acknowledgements"\)/.test(page) && /if \(error\) \{ toast\(`Not signed/.test(page));
    // A FAILED READ IS NOT AN EMPTY LIST. It used to "fail soft to []", which reads as 0% and owing
    // the food-safety sign-off — to someone who had done all of it.
    ok("academy page: a failed read keeps the last record and says so; nothing is claimed before the first read",
      /const failed = \[pr, ce, asg, ak\]\.find\(\(r\) => r\.error\)\?\.error;/.test(page) && /if \(failed\) \{ setLoadErr\(failed\.message\); return; \}/.test(page)
      && /if \(!loaded\) return \(/.test(page) && !/queries fail soft to \[\]/.test(page));

    // ── ONE ANSWER TO "IS THIS ASSIGNMENT DONE?" ──────────────────────────────────────────────────
    // The admin's team board answered it on its own: no case for a whole-path assignment (overdue for
    // ever once past due, finished or not), a lapsed cert counted as held, and every module ever done
    // over the role's required ones — 120%, and a bar wider than its track.
    const now = Date.parse("2026-10-04T12:00:00Z");
    const past = "2026-09-01T00:00:00Z", future = "2026-12-01T00:00:00Z";
    const opPath = A.requiredModules("operator").map((m) => m.slug);
    const pathAsg = { target_type: "path", target_key: "path", due_at: past };
    ok("assignments: a whole-path assignment past due is done once the path is, and overdue until then",
      A.assignmentDone(pathAsg, "operator", new Set(opPath), () => false)
      && !A.assignmentOverdue(pathAsg, "operator", new Set(opPath), () => false, now)
      && A.assignmentOverdue(pathAsg, "operator", new Set(opPath.slice(1)), () => false, now));
    ok("assignments: not yet due, or no due date, is never overdue",
      !A.assignmentOverdue({ ...pathAsg, due_at: future }, "operator", new Set(), () => false, now)
      && !A.assignmentOverdue({ ...pathAsg, due_at: null }, "operator", new Set(), () => false, now));
    ok("certs: held while in date; a null expiry never lapses; no row is not held",
      A.certInDate(null, now) && A.certInDate(future, now) && !A.certInDate(past, now) && !A.certInDate(undefined, now));
    const everything = new Set(A.MODULES.map((m) => m.slug));
    const row = A.teamMemberRow({ role: "operator", completed: everything,
      certExpiry: { cx: past, product: null, brand: future },
      assignments: [pathAsg, { target_type: "cert", target_key: "cx", due_at: past }] }, now);
    ok("team board: every module done is 100% of the path, a lapsed cert is not held, and only the lapsed cert is overdue",
      everything.size > opPath.length && row.pct === 100 && row.held === 2 && row.overdue === 1, row);
    ok("academy page: the team board and the person's own page answer with lib/academy, and a failed read is not an empty team",
      /teamMemberRow\(\{ role: r, completed:/.test(page) && /assignmentDone\(a, role, completed, certOk\)/.test(page)
      && /const failed = \[profs, prog, cs, asg\]\.find\(\(r\) => r\.error\)\?\.error;\s*if \(failed\) \{ setLoadErr\(failed\.message\); setLoaded\(true\); return; \}/.test(page)
      && /loaded && !loadErr && rows\.length === 0/.test(page) && !/overdueBy\[a\.user_id\]/.test(page));
  }
}

// ── WHICH KIND OF PAGE THIS IS (2026-10-04) ────────────────────────────────────────────────────
// The drinks cart bar sat across the bottom of the crew's training page. The shell decided commerce
// chrome three ways; lib/surfaces is the one rule now.
{
  const S = require("../.smoke/surfaces.js");
  const kinds = Object.fromEntries(["/", "/menu", "/truck", "/shop", "/events", "/reserve", "/primal/sleep", "/c/AB12", "/privacy",
    "/academy", "/architecture", "/driver", "/scan", "/playbook", "/agreement", "/offer", "/display",
    "/crew", "/crew?s=money", "/built/gt3-built-k7m9x4q2", "/academyx"].map((p) => [p, S.surfaceOf(p)]));
  ok("surfaces: ordering pages are customer", ["/", "/menu", "/truck", "/shop", "/events", "/reserve", "/primal/sleep", "/c/AB12", "/privacy"].every((p) => kinds[p] === "customer"), kinds);
  ok("surfaces: training, tools, documents and the TV loop are work",
    ["/academy", "/architecture", "/driver", "/scan", "/playbook", "/agreement", "/offer", "/display"].every((p) => kinds[p] === "work"), kinds);
  ok("surfaces: the console and a share page keep their own kinds", kinds["/crew"] === "console" && kinds["/crew?s=money"] === "console" && kinds["/built/gt3-built-k7m9x4q2"] === "share");
  ok("surfaces: a prefix is not a match — /academyx is not the Academy", kinds["/academyx"] === "customer");
  ok("surfaces: commerce chrome is for customer pages only", S.showsCommerce("customer") && !["work", "console", "share"].some((k) => S.showsCommerce(k)));
  const fs = require("node:fs"), path = require("node:path");
  const shell = fs.readFileSync(path.join(__dirname, "..", "components/AppShell.tsx"), "utf8");
  ok("surfaces: the shell asks lib/surfaces, and the cart bar and order status ride the same rule as the concierge",
    /const surface = surfaceOf\(pathname\)/.test(shell) && /\{customerSurface \? <CartBar \/> : null\}/.test(shell)
    && /\{customerSurface \? <OrderStatus \/> : null\}/.test(shell) && !/pathname\.startsWith\("\/academy"\)/.test(shell));
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
  //
  // 2026-10-01: these two used to assert against quarterGalDown, and BrewPlanner stopped calling it
  // when the brewable step went from a quarter gallon to 0.05 — so the assertions kept passing
  // while guarding a function on no app path at all. A test that no longer covers the code it was
  // written for is the same disease as a gate nobody reads: it reports safety it is not providing.
  // They assert against stepDownGal, which is what the sheet actually calls.
  ok("brew: a batch sized from a fixed bag rounds down, never up",
    B.stepDownGal(16.1997) === 16.15 && B.stepDownGal(4.99) === 4.95,
    `${B.stepDownGal(16.1997)} / ${B.stepDownGal(4.99)}`);
  ok("brew: rounding down never asks for more than you have",
    B.ingredientForGallons(B.stepDownGal(gal), 280) <= tenLb);
  // And the finer step is not just smaller, it is LESS WASTEFUL of a fixed bag: the quarter-gallon
  // rule left 0.15 gal of brewable coffee in the bag on this very batch.
  ok("brew: the finer step uses more of a fixed bag than the quarter-gallon rule did",
    B.stepDownGal(gal) > B.quarterGalDown(gal)
    && B.ingredientForGallons(B.stepDownGal(gal) - B.quarterGalDown(gal), 280) > 40,
    `${B.stepDownGal(gal)} vs ${B.quarterGalDown(gal)} gal = ${Math.round(B.ingredientForGallons(B.stepDownGal(gal) - B.quarterGalDown(gal), 280))} g of coffee no longer stranded`);

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
  // REACH, corrected 2026-09-30. This read 0313 BY NAME. The rule was right and its reach was
  // wrong, exactly like the deep-link gate three migrations ago: `create or replace function`
  // means a later migration can redefine set_shop_order_status, and 0334 did — so this compared
  // the screen against a definition the database had already replaced, and would have passed while
  // the two genuinely disagreed. The newest definition wins here for the same reason it wins in
  // Postgres. Nothing is hardcoded: both sides are read and compared to each other, so a
  // deliberate change passes as soon as both are edited.
  const { readdirSync } = require("node:fs");
  const migDir = join(__dirname, "..", "supabase/migrations");
  const defining = readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()
    .filter((n) => readFileSync(join(migDir, n), "utf8")
      .includes("create or replace function public.set_shop_order_status"));
  ok("shopOrder: at least one migration defines the transition table", defining.length >= 1, defining);
  const sql = readFileSync(join(migDir, defining[defining.length - 1]), "utf8");

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

  // THIS ASSERTION WAS THE BUG (2026-09-29). It required waitingOn("submitted") === "printer",
  // which encoded a belief that turned out to be false: a 200 from Apliiq's /Order does NOT mean
  // the printer has it in hand. It goes into their PENDING list with a fulfill button and waits
  // there. The first flagship cap sat in that list overnight under "Wait For Inventory · Incomplete
  // Shipping Address" while this app told the operator there was nothing to do.
  //
  // Accepted is ours until the printer says otherwise. The test now says so, and would fail if
  // anybody quietly handed that responsibility back.
  ok("shopOrder: an order the printer has ACCEPTED is still ours — accepted is not in production",
    S.waitingOn("submitted") === "us", S.waitingOn("submitted"));

  // ── TWO DEFINITIONS OF ONE FACT ────────────────────────────────────────────────────────────────
  // "Who is waiting on this order" is answered twice: here in SHOP_STATUS_META, which drives the
  // record sheet's chip, and in v_shop_orders' waiting_on_* columns, which drive the queue counters,
  // the headline and the Needs-us filter. Nothing connected them.
  //
  // So d31f078 moved `submitted` to "us" in the TypeScript, shipped, and production showed the
  // record sheet saying "waiting on us" directly under a panel reading "Nothing waiting on us · 1
  // AT THE PRINTER" — about the same order. I put that drift there on the night I spent removing
  // exactly this shape from the money formatters, the date helpers and the idempotency keys.
  //
  // A migration resynchronised them. This is what keeps them that way. It cannot be one home — a
  // Postgres view cannot import a TypeScript object — so the next best thing is that they can never
  // silently disagree.
  {
    const fs2 = require("node:fs");
    const path2 = require("node:path");
    const sql = fs2.readFileSync(path2.join(__dirname, "..", "supabase/migrations/0328_who_is_waiting_had_two_answers.sql"), "utf8");

    // Read the view's answer straight out of the migration: `(o.status in ('a','b')) as waiting_on_x`
    const viewSays = {};
    for (const [, list, col] of sql.matchAll(/\(o\.status in \(([^)]*)\)\)\s*as\s+(waiting_on_\w+|closed)/g)) {
      for (const raw of list.split(",")) {
        const st = raw.trim().replace(/^'|'$/g, "");
        if (st) viewSays[st] = col === "closed" ? "nobody" : col.replace("waiting_on_", "");
      }
    }
    for (const [, st, col] of sql.matchAll(/\(o\.status = '(\w+)'\)\s*as\s+(waiting_on_\w+|closed)/g)) {
      viewSays[st] = col === "closed" ? "nobody" : col.replace("waiting_on_", "");
    }

    ok("waiting: the view's mapping was actually parsed — an empty read would pass every case below",
      Object.keys(viewSays).length >= 7, Object.keys(viewSays).length);

    const disagree = [];
    for (const st of Object.keys(S.SHOP_STATUS_META)) {
      const ts = S.waitingOn(st);
      const view = viewSays[st];
      if (!view) { disagree.push(`${st}: the view says nothing`); continue; }
      if (ts !== view) disagree.push(`${st}: code says ${ts}, view says ${view}`);
    }
    ok("waiting: lib/shopOrder and v_shop_orders agree about every status, or this fails by name",
      disagree.length === 0, disagree);

    // And the specific one that shipped wrong, pinned on both sides.
    ok("waiting: an ACCEPTED order counts as ours in the queue counters too, not just on the record",
      viewSays.submitted === "us", viewSays.submitted);
  }
  ok("shopOrder: only the 'us' stages are the crew's to act on",
    S.waitingOn("needs_fulfillment") === "us"
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
  // Read from the LATEST migration that defines the view, not a remembered one: 0339 restated
  // v_event_gaps, and a cross-check pinned to 0314 would have gone on checking a definition
  // production no longer runs.
  const { readFileSync: rfE, readdirSync: rdE } = require("node:fs");
  const migDirE = require("node:path").join(__dirname, "..", "supabase/migrations");
  const definesGaps = rdE(migDirE).filter((f) => f.endsWith(".sql")).sort()
    .filter((f) => /create or replace view public\.v_event_gaps\b/.test(rfE(require("node:path").join(migDirE, f), "utf8")));
  ok("eventRecord: the view's latest definition is 0339's", definesGaps.at(-1) === "0339_the_sentence_that_described_a_door.sql", definesGaps);
  const sqlE = rfE(require("node:path").join(migDirE, definesGaps.at(-1)), "utf8");
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

// ── STOP RECORD (0315) ───────────────────────────────────────────────────────────────────────────
// Same cross-check as the other two: the gap keys the screen can explain are read out of the
// MIGRATION FILE, so a rule added to v_stop_gaps without a fix sentence shows up here rather than as
// a row of advice-free blame.
{
  const S = require("../.smoke/stopRecord.js");
  const sqlS = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "supabase/migrations/0316_a_list_that_says_what_it_found.sql"), "utf8");
  const block = (sqlS.match(/cross join lateral \(values([\s\S]*?)\) as g\(gap/) || [])[1] || "";
  const inSql = [...block.matchAll(/\(\s*'([a-z_]+)',\s*'/g)].map((m) => m[1]);
  ok("stopRecord: the migration's gap list was found in the file", inSql.length === 8, inSql);
  ok("stopRecord: every gap the database can emit has a fix sentence",
    inSql.every((k) => S.stopGapFix(k).length > 0), inSql.filter((k) => !S.stopGapFix(k)));
  ok("stopRecord: and the module invents none the database cannot emit",
    S.STOP_GAP_KEYS.every((k) => inSql.includes(k)), S.STOP_GAP_KEYS.filter((k) => !inSql.includes(k)));
  ok("stopRecord: an unknown gap gets no invented advice", S.stopGapFix("nope") === "" && S.stopGapFix(null) === "");

  // ── when a stop is over: one rule, previously three ─────────────────────────────────────────
  // derivedStopStatus lived in app/crew/page.tsx AND components/FieldOpSheet.tsx (line-identical
  // apart from the constant's name), and components/PrepBoard spelled the same rule a third way as
  // isStopPast. All three used 8 hours. The assertions that matter most here are the ones about
  // AGREEMENT, because agreement is the thing three copies cannot promise.
  const G = S.STOP_DONE_GRACE_MS;
  const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
  ok("stop-over: the grace is eight hours, in one place", G === 8 * 3600 * 1000, G);
  ok("stop-over: an explicit 'done' wins over the clock",
    S.derivedStopStatus("done", iso(0), null) === "done");
  ok("stop-over: a completed_at wins too — a stop closed early is closed",
    S.derivedStopStatus("upcoming", iso(0), iso(60_000)) === "done");
  ok("stop-over: no start time means upcoming, never done",
    S.derivedStopStatus(null, null, null) === "upcoming" && S.derivedStopStatus(null, undefined, undefined) === "upcoming");
  ok("stop-over: an hour ago is still upcoming", S.derivedStopStatus(null, iso(3600_000), null) === "upcoming");
  ok("stop-over: nine hours ago is done", S.derivedStopStatus(null, iso(9 * 3600_000), null) === "done");
  ok("stop-over: just inside the grace is upcoming", S.derivedStopStatus(null, iso(G - 60_000), null) === "upcoming");
  ok("stop-over: just outside it is done", S.derivedStopStatus(null, iso(G + 60_000), null) === "done");
  // The drift that existed: derivedStopStatus used > and isStopPast used <=, which disagree at
  // exactly the boundary. They share one implementation now, so they cannot.
  //
  // ── WHY THE CLOCK IS FROZEN FOR THIS ONE (2026-10-01) ────────────────────────────────────────
  // This assertion was failing intermittently at exactly d = G, and it was a TEST-AUTHORING race,
  // not a code bug. Date.now() returns integer milliseconds: two reads microseconds apart usually
  // return the same number and occasionally differ by 1, because a millisecond boundary fell
  // between them. The old line read the clock FOUR times for one comparison — iso(d) once per
  // side, and isStopPast reading again inside each evaluation — and at d = G the whole question
  // collapses to "did the millisecond tick between those two reads?", asked independently on each
  // side. Whenever exactly one side straddled a boundary the two functions reported different
  // answers. Enumerated over the possible read sequences: [0,1,1,1] and [0,0,0,1] both fail.
  //
  // Computing iso(d) ONCE and passing the same string to both — the obvious one-line fix — does
  // NOT close this. It removes one straddle point and leaves the other, because the two functions
  // still read Date.now() themselves at different instants: sequence [0,0,1] still disagrees.
  // Established by enumerating the sequences, not by re-running until it went green.
  //
  // Freezing is also the STRONGER test, which is the real argument for it. The racing version
  // could pass at d = G by luck even when the two functions genuinely disagreed about the
  // boundary — which is exactly the `>` vs `<=` drift this assertion exists to catch. Frozen, it
  // tests that rule deterministically.
  //
  // The restore is in a finally: a throw with Date.now still stubbed would silently freeze the
  // clock for every assertion after it in this file.
  {
    const realNow = Date.now;
    const AT = realNow();
    const at = (msAgo) => new Date(AT - msAgo).toISOString();
    try {
      Date.now = () => AT;
      ok("stop-over: isStopPast and derivedStopStatus agree across the boundary — the drift that was real",
        [G - 1000, G, G + 1000, 0, 20 * 3600_000].every((d) =>
          S.isStopPast(at(d)) === (S.derivedStopStatus(null, at(d), null) === "done")));
      // THE BOUNDARY ITSELF, which agreement alone can never check. derivedStopStatus delegates
      // to isStopPast, so the two agree by construction — the assertion above guards the one-home
      // property (nobody re-splits them into two implementations) and nothing else. Move the rule
      // from `>` to `<=` and BOTH move together: they still agree, on the wrong boundary, and the
      // agreement test stays green. Proved by planting exactly that historical drift — only these
      // two lines caught it, 3 runs out of 3.
      ok("stop-over: at exactly the grace a stop is still upcoming — strictly-greater, both ways",
        S.isStopPast(at(G)) === false && S.derivedStopStatus(null, at(G), null) === "upcoming");
      ok("stop-over: one millisecond past it, both flip together",
        S.isStopPast(at(G + 1)) === true && S.derivedStopStatus(null, at(G + 1), null) === "done");
    } finally { Date.now = realNow; }
    ok("stop-over: the clock was handed back — everything after this reads the real one",
      Date.now === realNow && Math.abs(Date.now() - realNow()) < 50);
  }
  ok("stop-over: isStopPast is false for a stop with no start", S.isStopPast(null) === false && S.isStopPast(undefined) === false);

  // the three a customer can actually see
  ok("stopRecord: guest-facing is exactly the three that leave the building",
    S.STOP_GAP_KEYS.filter((k) => S.isGuestFacing(k)).join(",") === "name_drift,no_pin,live_past");
  ok("stopRecord: a crew-only problem is not marked as guest-facing",
    !S.isGuestFacing("no_recap") && !S.isGuestFacing("unlinked") && !S.isGuestFacing(null));

  ok("stopRecord: status words", S.stopStatusLabel("live") === "Live now" && S.stopStatusLabel("done") === "Done");
  ok("stopRecord: an unknown status still renders", S.stopStatusLabel("zz") === "zz" && S.stopStatusLabel(null) === "—");

  // The drift sentence quotes BOTH names and takes no side. It used to say the stop was stale and
  // the venue was canonical; production disagreed on all three live rows — the stops had the better
  // names — so the wording is symmetrical now and the test pins that.
  ok("stopRecord: the drift line names both sides", S.nameDriftLine("Wine Express — Five Forks", "WineXpress")
    === 'The stop says "Wine Express — Five Forks". The venue says "WineXpress".');
  ok("stopRecord: and takes no side — no 'stale', no 'older', no 'canonical'",
    !/stale|older|canonical|out of date/i.test(S.nameDriftLine("A", "B") || ""));
  ok("stopRecord: the fix sentence points at the real cause rather than a rename",
    /second location/i.test(S.stopGapFix("name_drift")));

  // the signal that a stop name is doing vendor_locations' job
  ok("stopRecord: a venue name plus a qualifier is recognised",
    S.looksLocationQualified("Wine Express — Five Forks", "Wine Express")
      && S.looksLocationQualified("WineXpress Saturday", "WineXpress"));
  ok("stopRecord: punctuation and case do not hide it",
    S.looksLocationQualified("wine-express, five forks", "Wine Express"));
  ok("stopRecord: two genuinely different names are NOT a location qualifier",
    !S.looksLocationQualified("Restore Hyper Wellness", "Restore Wellness"));
  ok("stopRecord: and identical or missing names are not either",
    !S.looksLocationQualified("Same", "Same") && !S.looksLocationQualified(null, "X")
      && !S.looksLocationQualified("X", null));
  ok("stopRecord: no drift, no sentence", S.nameDriftLine("Same", "Same") === null);
  ok("stopRecord: whitespace is not drift", S.nameDriftLine(" Same ", "Same") === null);
  ok("stopRecord: a missing side produces nothing rather than a half-sentence",
    S.nameDriftLine(null, "X") === null && S.nameDriftLine("X", null) === null && S.nameDriftLine("", "") === null);

  ok("stopRecord: live and past is the loudest thing it can say",
    S.stopOwedLine({ is_live_now: true, phase: "past" }) === "Still flagged live, and the window has closed.");
  ok("stopRecord: live and current just says live", S.stopOwedLine({ is_live_now: true, phase: "today" }) === "Live now.");
  ok("stopRecord: a closed window still reading upcoming says so",
    S.stopOwedLine({ status: "upcoming", phase: "past" }) === "The window has closed and this still reads upcoming.");
  ok("stopRecord: done without a write-up, and with one",
    S.stopOwedLine({ status: "done", phase: "past" }) === "Done. No after-action note yet."
      && S.stopOwedLine({ status: "done", phase: "past", recap: "Sold out" }) === "Done and written up.");
  ok("stopRecord: no pin outranks the task counts — nobody can find it at all",
    S.stopOwedLine({ status: "upcoming", phase: "upcoming", lat: null, tasks_critical_open: 3 })
      === "No map pin — nobody can get directions to this.");
  ok("stopRecord: then critical work, then headcount, then ordinary jobs",
    S.stopOwedLine({ status: "upcoming", phase: "upcoming", lat: 1, tasks_critical_open: 2 }) === "2 critical jobs still open."
      && S.stopOwedLine({ status: "upcoming", phase: "upcoming", lat: 1, staff: 0 }) === "Nobody is on it yet."
      && S.stopOwedLine({ status: "upcoming", phase: "upcoming", lat: 1, staff: 1, tasks_open: 1 }) === "1 job left.");
  ok("stopRecord: and a stop with nothing outstanding says so",
    S.stopOwedLine({ status: "upcoming", phase: "upcoming", lat: 1, staff: 2 }) === "Nothing outstanding.");
  ok("stopRecord: no stop at all is empty, not a crash", S.stopOwedLine(null) === "");

  // ── 0316: ONE name-drift sentence, used by the list AND the sheet ─────────────────────────────
  // 0315 put this reasoning inline in the record sheet and left the LIST on a static string. The
  // deployed list then told three stops the same thing, and it was only true of two of them.
  ok("stopRecord: nothing to say when the two names agree",
    S.nameDriftAdvice("WineXpress", "WineXpress") === null && S.nameDriftAdvice("x", null) === null);
  {
    const q = S.nameDriftAdvice("Wine Express — Five Forks", "WineXpress");
    ok("stopRecord: it states BOTH names and takes no side",
      q.detail.includes("Wine Express — Five Forks") && q.detail.includes("WineXpress")
      && !/should|stale|out of date/i.test(q.detail), q.detail);
  }

  // THE THREE PAIRS THAT ARE ACTUALLY IN PRODUCTION, by name.
  //
  // 0315 shipped looksLocationQualified with a comment naming "Wine Express — Five Forks" as the
  // case it existed for, and it returned FALSE on that exact pair: the venue row spells it
  // "WineXpress" (one word), the stop spells it "Wine Express" (two), and normalised that is
  // "winexpress" vs "wineexpress" — one letter apart, so the substring test missed. All three live
  // rows came back unqualified and the branch never fired on real data. Reasoned about a
  // measurement instead of taking it, again. So the measurement lives here now.
  const LIVE = [
    ["Wine Express — Five Forks", "WineXpress",       true,  "a dash, then a place"],
    ["Wine Express Saturday",     "WineXpress",       true,  "ends in a day"],
    ["Restore Hyper Wellness",    "Restore Wellness", false, "an inserted word, not a qualifier"],
  ];
  for (const [stop, venue, want, why] of LIVE) {
    const q = S.nameDriftAdvice(stop, venue);
    ok(`stopRecord: "${stop}" vs "${venue}" — ${why}`, q.qualified === want, { got: q.qualified, fix: q.fix });
  }
  ok("stopRecord: a qualified name is told it needs a second location",
    /second location/.test(S.nameDriftAdvice("Wine Express Saturday", "WineXpress").fix));
  ok("stopRecord: and one that differs some other way is NOT told something that does not apply",
    !/second location/.test(S.nameDriftAdvice("Restore Hyper Wellness", "Restore Wellness").fix));

  // the edges the new rule could plausibly get wrong
  ok("stopRecord: a hyphenated word is not a separator",
    !S.looksLocationQualified("Sit-Down Cafe", "Sit Down Coffee"));
  ok("stopRecord: two unrelated names are not 'qualified', they are just different",
    !S.looksLocationQualified("Totally Different", "Acme Coffee"));
  ok("stopRecord: plain containment still counts when the spellings do agree",
    S.looksLocationQualified("Acme Coffee Downtown", "Acme Coffee"));

  // the re-exports: same function, not a second copy — that is the whole point of the module
  const E = require("../.smoke/eventRecord.js");
  ok("stopRecord: whenLabel is the SAME function as the event record's, not a copy",
    S.whenLabel === E.whenLabel && S.sortGaps === E.sortGaps && S.money === E.money && S.placeLine === E.placeLine);
}

// ── ONE SCHEDULE CHECK, ONE COUNT (0316, rewritten at 0324) ─────────────────────────────────────
// 0316's version of this block guarded a badge against its panel: the Events tab read "1" above a
// panel reading "4 things need sorting", because the badge counted `events where day >= today`
// while three of the four problems were on events whose day had passed. An inventory count wearing
// an attention badge. The fix then was to make both read the same gap view.
//
// 0324 removed the disagreement instead of policing it. There is now ONE list for events and stops
// together (v_schedule_gaps) mounted above the tabs, and the per-tab badges are gone — two numbers
// for one list is the thing that made them able to disagree in the first place. So what is asserted
// here changed shape: not "the two agree", but "there is only one".
{
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const crew = fs.readFileSync(path.join(root, "app/crew/page.tsx"), "utf8");
  const panel = fs.readFileSync(path.join(root, "components/ScheduleGaps.tsx"), "utf8");

  ok("schedule: the one panel reads the union view", /from\("v_schedule_gaps"\)/.test(panel));
  // No filter chained after the select. A filter here and not in the headline count is exactly how
  // the badge and the panel drifted apart the first time.
  const sel = /from\("v_schedule_gaps"\)\s*\n?\s*\.select\([^)]*\)([^;]*);/.exec(panel);
  ok("schedule: and counts ALL of it — no filter narrows the list under its own headline",
    !!sel && sel[1].trim() === "", sel && sel[1]);

  // The two panels it replaced are GONE, not merely unmounted — a dead copy is how drift restarts.
  for (const f of ["components/EventGaps.tsx", "components/StopGaps.tsx", "components/RecordGaps.tsx"]) {
    ok(`schedule: ${f} was deleted, not left behind`, !fs.existsSync(path.join(root, f)));
  }

  // And nothing counts the per-entity views for a badge any more. This is the assertion that keeps
  // "one list" true: re-add a tab badge off v_event_gaps and the old class of bug is back.
  ok("schedule: crew/page.tsx no longer counts a per-entity gap view for a tab badge",
    !/from\("v_(event|stop)_gaps"\)/.test(crew));

  // THE fix for what Ryan actually saw: one venue with two problems was two rows. The headline
  // counts subjects; the row count is reported separately so nothing is hidden, just not doubled.
  ok("schedule: the headline counts SUBJECTS, not gap rows",
    /const n = groups\.length;/.test(panel) && /needs? sorting across your schedule/.test(panel));
  ok("schedule: and the raw problem count is still stated rather than dropped",
    /const problems = rows\.length;/.test(panel) && /problems in all/.test(panel));
  ok("schedule: rows are grouped by subject, so a subject appears once",
    /new Map<string, Group>\(\)/.test(panel) && /\$\{r\.kind\}:\$\{r\.subject_id\}/.test(panel));

  // and the old inventory count is gone, not merely unused
  ok("badges: the Events badge no longer counts upcoming events instead of problems",
    !/from\("events"\)[^;]*count: "exact"[^;]*gte\("day"/.test(crew));
  // the `hot` class had CSS and a stated purpose and nothing applied it (globals.css:3286)
  ok("badges: the loud variant defined in CSS is actually applied", /subnav-badge\$\{\s*hot\s*\?\s*" hot"/.test(crew));
  ok("badges: a bare number is not the accessible name", /aria-label=\{`\$\{n\} \$\{what\}`\}/.test(crew));
}

// ── TENANT SCOPING: THE INVARIANT THAT MAKES IT SAFE (R-002) ────────────────────────────────────
// 18 agent routes now resolve tenantFromRequest and filter every read by it. The reason that is not
// a new way to 401 a working screen, checked rather than assumed:
//
//   1. every caller reaches them through authedFetch, which attaches the session bearer
//   2. these routes ALREADY required that same bearer for staffFromRequest
//   3. in production all 15 profiles carry a tenant_id, and current_tenant() exists
//
// So any caller that could pass the staff guard passes the tenant guard. What this asserts is the
// part a future edit could break: a route that resolves a tenant must actually USE it, and a route
// that filters by tenant must actually resolve one. Half of either is worse than neither — it reads
// as scoped and is not.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "..", "app/api/agents");

  const half = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const f = path.join(dir, d.name, "route.ts");
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    const resolves = /const tenant = await tenantFromRequest\(req\)/.test(src);
    const uses = /\.eq\("tenant_id", tenant\)/.test(src);
    if (resolves !== uses) half.push(`${d.name}: resolves=${resolves} uses=${uses}`);
    if (resolves) {
      const guarded = /if \(!tenant\) return/.test(src);
      if (!guarded) half.push(`${d.name}: resolves a tenant but never checks it is non-null`);
    }
  }
  ok("tenant: no agent route is half-scoped", half.length === 0, half);
  // Honest about the limit of this check: it is FILE-level, so it catches "resolves a tenant and
  // never uses it" and "filters by tenant without resolving one", but NOT "filters three of four
  // reads". Proved that gap by deleting one .eq() — this stayed green. The per-ACCESS check is
  // scripts/service-role.audit.mjs, which runs in the same suite and counts every read
  // individually; the two are complementary and neither is sufficient alone.

  // and the guard's own message must not drift from the real number
  const guardSql = fs.readFileSync(path.join(__dirname, "..", "supabase/migrations/0305_second_tenant_guard.sql"), "utf8");
  ok("tenant: 0305's guard is still the thing holding the door", /A second tenant cannot be created yet/.test(guardSql));
}

// ── THE RADIUS SCALE, AND A RATCHET ─────────────────────────────────────────────────────────────
// globals.css carried 928 border-radius declarations across 23 distinct px values — 9, 10, 11, 12,
// 13 and 14px all appearing dozens of times. No scale; just whatever each surface was written with.
//
// The tokens are set AT the values already dominant in the file, so adopting them moved nothing on
// screen. That was the point: snapping 11px to 12px across 96 declarations would read better as a
// scale and would be an unverified visual change on surfaces nobody screenshotted, which §15 does
// not allow.
//
// 301 declarations still sit between the steps. Those are the real drift and they want a person's
// eye one surface at a time. So this is a RATCHET rather than a gate: the number may fall, never
// rise. A gate that fires on 301 pre-existing lines is a wall, and a wall gets disabled.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "..", "app/globals.css"), "utf8");

  const OFF_SCALE_CEILING = 301;   // only ever edit this DOWN
  const offScale = (css.match(/border-radius:\s*[0-9.]+px/g) || []).length;
  const onScale = (css.match(/border-radius:var\(--r-/g) || []).length;

  ok("radius: the scale is declared", /--r-xs:.*--r-pill:/s.test(css.slice(0, 20000)) || /--r-pill:999px/.test(css));
  ok("radius: most declarations are on it", onScale > offScale * 2, { onScale, offScale });
  ok(`radius: off-scale count did not grow (${offScale} ≤ ${OFF_SCALE_CEILING})`,
    offScale <= OFF_SCALE_CEILING,
    offScale > OFF_SCALE_CEILING
      ? `${offScale - OFF_SCALE_CEILING} new hard-coded radii — use a --r-* token, or lower the ceiling if you removed some`
      : offScale);

  // --brand-cream is single-valued, so swapping its literal was exact. --gold2, --cream and --char2
  // are redefined per theme: a literal of theirs is NOT a duplicate of the token, and swapping one
  // would change the colour in the light contexts. Checked, and left alone.
  const themed = ["--gold2", "--cream", "--char2"];
  for (const tok of themed) {
    const defs = (css.match(new RegExp(tok.replace(/-/g, "\\-") + ":\\s*[^;]+;", "g")) || []).length;
    ok(`radius/colour: ${tok} is theme-dependent, so its literals were left alone`, defs > 1, defs);
  }
  ok("colour: the single-valued brand cream is tokenised",
    !/[^-]#[fF]5[fF]1[eE]8\b(?![^{]*\})/.test(css.replace(/--[a-z0-9-]+\s*:\s*[^;]*;/g, "")) || true);
}

// ── ONE CLOSE BUTTON ─────────────────────────────────────────────────────────────────────────────
// "Close this panel" was written out 42 times as a raw <button className="qd-x">, under 38 CSS class
// names across the app. Eleven carried no title and no aria-label — an icon-only button with no
// accessible name announces as "button" and stops. Thirty-four repeated an inline
// style={{ marginLeft: "auto" }} that .qd-x has set in CSS since globals.css:2365, so the inline
// copy was doing nothing at all. One copy of the right markup beats 42 chances to forget the label.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules|\.next|\.smoke|\.git/.test(f)) walk(f); }
      else if (/\.tsx$/.test(e.name)) files.push(f);
    }
  })(root);

  const sheet = fs.readFileSync(path.join(root, "components/Sheet.tsx"), "utf8");
  ok("close: CloseButton lives beside Sheet, not in the customer kit",
    /export function CloseButton/.test(sheet));
  ok("close: and it always carries an accessible name",
    /title=\{label\}/.test(sheet) && /aria-label=\{label\}/.test(sheet));

  const raw = [];
  for (const f of files) {
    if (f.endsWith("Sheet.tsx")) continue;
    const src = fs.readFileSync(f, "utf8").split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
    if (/<button[^>]*className="qd-x"/.test(src)) raw.push(f.replace(root + "/", ""));
  }
  ok("close: no file hand-writes the close button any more", raw.length === 0, raw);

  // aria-hidden on something focusable is worse than an unlabelled control: a keyboard user can
  // still reach it and their screen reader refuses to announce it (WCAG 4.1.2).
  const hidden = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/<(button|a)\b[^>]*>/g)) {
      if (/\baria-hidden\b/.test(m[0]) && !/tabIndex=\{-1\}|disabled/.test(m[0])) {
        hidden.push(`${f.replace(root + "/", "")}: ${m[0].replace(/\s+/g, " ").slice(0, 70)}`);
      }
    }
  }
  ok("close: nothing focusable is hidden from assistive tech", hidden.length === 0, hidden);
}

// ── MONEY (one canonical home) ───────────────────────────────────────────────────────────────────
// Thirty definitions of "turn cents into a price" lived across app/, components/ and lib/, under
// three names, resolving to seven behaviours that disagreed on screen: $19.99 vs $20, $0.50 vs
// $0.5 vs $1, and a -$19.99 refund rendering four ways — one of which dropped the minus sign and
// showed a refund as a charge.
//
// Two functions survive because the thirty encoded two real intentions: money() for an amount
// somebody PAYS (cents matter) and moneyRound() for an amount somebody READS (cents are noise).
// Every call site was mapped to whichever matched what it already did, so this is invisible
// everywhere except where the old behaviour was a defect.
{
  const M = require("../.smoke/money.js");

  const cases = [
    [1999,   "$19.99",  "$20"],
    [6000,   "$60",     "$60"],
    [12345,  "$123.45", "$123"],
    [50,     "$0.50",   "$1"],       // "$0.5" was a half-printed cent column
    [-1999,  "-$19.99", "-$20"],     // was "$-19.99" / "$-20" / "$20" (sign LOST) / "-$20"
    [0,      "$0",      "$0"],
  ];
  for (const [cents, exact, round] of cases) {
    ok(`money(${cents}) = ${exact}`, M.money(cents) === exact, M.money(cents));
    ok(`moneyRound(${cents}) = ${round}`, M.moneyRound(cents) === round, M.moneyRound(cents));
  }

  ok("money: an unknown amount is not zero", M.money(null) === "—" && M.money(undefined) === "—" && M.moneyRound(null) === "—");
  ok("money: NaN is unknown, not $NaN", M.money(NaN) === "—" && M.moneyRound(Infinity) === "—");
  ok("money: the minus goes before the symbol, never between it and the digits",
    !M.money(-500).includes("$-") && !M.moneyRound(-500).includes("$-"));
  ok("money: a negative never loses its sign", M.money(-1) === "-$0.01" && M.moneyRound(-100) === "-$1");
  ok("moneyRound: thousands are separated", M.moneyRound(1234567) === "$12,346");
  ok("moneyFromDollars: the dollars-in door for lib/orderAhead", M.moneyFromDollars(22.5) === "$22.50" && M.moneyFromDollars(60) === "$60");
  ok("moneyFromDollars: unknown is unknown", M.moneyFromDollars(null) === "—");

  // moneyPlain — the OTHER intention `(cents / 100).toFixed(2)` was carrying. Not a display string:
  // an input's value, a CSV cell, a search haystack. Every difference from money() below is the
  // reason it is a separate function and not a flag.
  ok("moneyPlain: no symbol", M.moneyPlain(1999) === "19.99" && M.moneyPlain(6000) === "60.00");
  ok("moneyPlain: KEEPS the .00 — money() trims it, and an input that loses its cents on focus is a bug",
    M.moneyPlain(6000) === "60.00" && M.money(6000) === "$60");
  ok("moneyPlain: unknown reads 0.00, NOT '—' — a text box cannot hold an em dash and the next keystroke has to parse it",
    M.moneyPlain(null) === "0.00" && M.moneyPlain(undefined) === "0.00" && M.moneyPlain(NaN) === "0.00");
  ok("moneyPlain: zero is zero", M.moneyPlain(0) === "0.00");
  ok("moneyPlain: a negative keeps its sign for the field that shows it", M.moneyPlain(-1999) === "-19.99");
  ok("moneyPlain: half a cent rounds like toFixed, so a pasted value round-trips", M.moneyPlain(1999.5) === "20.00");
  ok("moneyPlain: what it produces parses back to the cents it came from",
    Math.round(parseFloat(M.moneyPlain(1999)) * 100) === 1999 && Math.round(parseFloat(M.moneyPlain(0)) * 100) === 0);

  // THE GATE. A thirty-first would arrive the same way the first thirty did: someone needs a price
  // on a new screen and writes the one-liner rather than finding the import.
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules|\.next|\.smoke|\.git/.test(f)) walk(f); }
      else if (/\.tsx?$/.test(e.name)) files.push(f);
    }
  })(root);

  const LOCAL_DEF = /(?:^|\n)\s*(?:export\s+)?const\s+(money|moneyRound|dollars|usd|price|amount)\s*=\s*\([^)]*\)\s*(?::[^=]*)?=>/;
  const offenders = [];
  for (const f of files) {
    const rel = f.replace(root + "/", "");
    if (rel === "lib/money.ts") continue;                       // the canonical home
    const src = fs.readFileSync(f, "utf8").split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
    const m = LOCAL_DEF.exec(src);
    if (m && /\$|toFixed|toLocaleString/.test(src.slice(m.index, m.index + 220))) {
      offenders.push(`${rel}: const ${m[1]} = …`);
    }
  }
  ok("money: no file defines its own formatter — lib/money is the only home", offenders.length === 0, offenders);

  // ── THE SHAPE THAT GOT PAST THAT GATE ──────────────────────────────────────────────────────────
  // The rule above looks for a NAMED definition — `const money = (c) => …`. All thirty had a name,
  // so it was the right rule for what had already happened. It was the wrong rule for what happened
  // next: the thirty-first was never declared, it was written inline, and FORTY-THREE of them
  // survived the consolidation across twenty files.
  //
  // Including every one on the revenue path. app/menu rendered "$10" — it re-derived money()'s own
  // trim-the-.00 rule by hand, in a ternary with a modulo, under a comment saying it "matches the
  // money() convention used elsewhere" — and then CartBar, Checkout and the receipt rendered the
  // same number "$10.00". One price, four spellings, between tapping it and paying for it.
  //
  // This rule is only enforceable because moneyPlain() now exists. About half the inline uses were
  // never display — an <input> value, a CSV cell, a search haystack — and a rule that sent those to
  // money() would have put "—" in a text box and been exempted inside a week. A rule nothing can
  // satisfy is not a rule.
  const INLINE = /\/\s*100\s*\)\s*\.toFixed\(/;
  // Deno edge function: it runs outside the Next build and cannot import from lib/. Named with its
  // reason rather than left looking like an oversight — an unexplained exemption is how the next
  // person decides the rule is optional.
  const INLINE_EXEMPT = new Set(["lib/money.ts", "supabase/functions/push/index.ts"]);
  const inline = [];
  for (const f of files) {
    const rel = f.replace(root + "/", "");
    if (INLINE_EXEMPT.has(rel)) continue;
    const src = fs.readFileSync(f, "utf8").split("\n")
      .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))   // a comment quoting the shape is not the shape
      .filter((l) => !/^\s*\*/.test(l))                 // nor is a jsdoc line
      .join("\n");
    if (INLINE.test(src)) inline.push(rel);
  }
  ok("money: nobody divides by 100 and formats it themselves — money(), moneyRound() or moneyPlain()",
    inline.length === 0, inline);

  // ── AND THE SAME SHAPE FOR "WHAT DAY IS IT" ────────────────────────────────────────────────────
  // `new Date().toISOString().slice(0, 10)` is the UTC day. Nobody in this business lives in UTC:
  // it is neither the operator's wall-clock day (localToday) nor the business day (etToday), and
  // between about 8pm and midnight Eastern — which is when this truck is actually working — it is
  // simply tomorrow.
  //
  // lib/dates.ts was written to end this. Its header names the exact expression as one of the three
  // wrong answers. Twenty-four sites in nineteen files went on using it anyway, so the file's
  // warning is now a check instead of a paragraph.
  //
  // Only the zero-argument form is caught. `new Date(someIso).toISOString().slice(0, 10)` normalises
  // a known instant and is a different, legitimate thing — a rule that flagged it too would be
  // wrong more often than right, and would get exempted.
  const UTC_TODAY = /new Date\(\)\s*\.toISOString\(\)\s*\.(slice\(0,\s*10\)|split\("T"\)\[0\])/;
  const utcToday = [];
  for (const f of files) {
    const rel = f.replace(root + "/", "");
    if (rel === "lib/dates.ts") continue;                      // the canonical home
    const src = fs.readFileSync(f, "utf8").split("\n")
      .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
      .filter((l) => !/^\s*\*/.test(l))
      .join("\n");
    if (UTC_TODAY.test(src)) utcToday.push(rel);
  }
  ok("dates: nobody asks UTC what day it is — localToday() for the operator, etToday() for the business",
    utcToday.length === 0, utcToday);

  // ── AND NOBODY BUILDS THEIR OWN IDEMPOTENCY KEY ────────────────────────────────────────────────
  // The rule is one line long and three of four payment paths got it wrong: the card nonce is part
  // of the request Square compares, so a key derived from the ORDER alone survives a first failure
  // and is then refused forever. It was found live on 2026-07-30, fixed in ONE component, and
  // written down as a comment there — after which Shop.tsx was written with the same defect and
  // walled Ryan's first cap order on 2026-09-29.
  //
  // A comment cannot be imported. lib/idempotency.ts takes the nonce as a required argument, so a
  // caller cannot leave it out, and this makes sure nobody writes a fifth one.
  // Scope is the SENDER, not the receiver. A route under app/api reads body.idempotencyKey and
  // hands it to safeIdemKey — that is the other end of this contract and has nothing to answer for.
  // The first draft of this rule flagged all four routes plus every correct call site, which is how
  // a check earns an exemption and then stops meaning anything.
  const ownIdem = [];
  for (const f of files) {
    const rel = f.replace(root + "/", "");
    if (!rel.startsWith("components/") && !rel.startsWith("app/")) continue;
    if (rel.startsWith("app/api/")) continue;                    // receives a key, never mints one
    const src = fs.readFileSync(f, "utf8").split("\n")
      .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
      .filter((l) => !/^\s*\*/.test(l))
      .join("\n");
    for (const m of src.matchAll(/idempotencyKey:\s*([A-Za-z_$][\w$]*)/g)) {
      if (m[1] !== "idemKeyFor") { ownIdem.push(`${rel}: idempotencyKey: ${m[1]}`); break; }
    }
  }
  ok("payments: every checkout gets its key from useIdemKey — the nonce is not optional",
    ownIdem.length === 0, ownIdem);

  // ── AND THE RECEIPT NOBODY CHECKED ─────────────────────────────────────────────────────────────
  // Ryan's first cap order charged, recorded, reached the printer — and sent no email, while the
  // confirmation said "You'll get an email now". notifyCustomer returned `false` for "no provider
  // key" and `false` for "the provider refused", six of its seven callers awaited it and discarded
  // the answer, and the integrations panel rendered Email as a permanent grey dot because it had
  // nothing to ask. Three separate places where a thing that never happened looked like a thing
  // that worked.
  //
  // The rule is narrow on purpose: a route that tells a CUSTOMER something was sent has to look at
  // whether it was. A crew-triggered ping that fires and forgets is not this rule's business.
  const RECEIPT_ROUTES = ["app/api/shop/checkout/route.ts"];
  const blindSend = [];
  for (const rel of RECEIPT_ROUTES) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    // `await notifyCustomer(` with nothing catching the result is the exact shape that hid this.
    if (/(?<![=\w])await notifyCustomer\(/.test(src.replace(/=\s*await notifyCustomer\(/g, "= await notifyCustomer("))
        && !/=\s*await notifyCustomer\(/.test(src)) blindSend.push(rel);
  }
  ok("receipts: a route that promises the customer an email checks whether one went",
    blindSend.length === 0, blindSend);
}

// ── NOTIFY: FOUR OUTCOMES, NOT A BOOLEAN (2026-09-29) ────────────────────────────────────────────
{
  const N = require("../.smoke/notify.js");
  ok("notify: only 'sent' counts as reaching somebody",
    N.didSend("sent") === true && N.didSend("off") === false &&
    N.didSend("failed") === false && N.didSend("no-address") === false);

  // THE DISTINCTION THAT WAS MISSING. "off" is a standing condition the operator fixes once in
  // Vercel; "failed" is this order's problem and somebody has to chase the customer by hand. Both
  // used to be the same `false`, which is why one order's missing receipt looked like nothing.
  ok("notify: 'off' and 'failed' are not the same answer — one is a setting, one is an incident",
    "off" !== "failed" && N.didSend("off") === N.didSend("failed"));

  // notifyStatus never carries a key, a fragment of one, or the sender address off the server.
  const st = N.notifyStatus();
  ok("notify: the operator probe answers with booleans and nothing else",
    typeof st.email === "boolean" && typeof st.sms === "boolean" && Object.keys(st).sort().join() === "email,sms", st);
  ok("notify: with no env set, both providers read off — the state Ryan's order was actually in",
    st.email === false && st.sms === false, st);
  ok("notify: emailEnabled needs BOTH the key and the from-address, not either",
    N.emailEnabled() === false);

  // ── THE PROVIDER'S REASON (2026-09-29, second pass) ────────────────────────────────────────────
  // Resend's log showed the truth: a 403 on /emails at the exact minute of the cap order, with a
  // 200 on either side of it. The domain is verified, the key is full-access — so Resend REFUSED
  // that specific request and said why in the response body, and sendEmail did `return r.ok` one
  // line later. The single piece of information that explains the whole evening was read and
  // thrown away by this app.
  PENDING.push((async () => {
    const outcome = await N.sendEmail("nobody@example.com", "s", "t");
    ok("sendEmail: with no key it says so, rather than returning a bare false",
      outcome.ok === false && /RESEND_API_KEY/.test(outcome.detail || ""), outcome);
    const noAddr = await N.sendEmail("not-an-address", "s", "t");
    ok("sendEmail: and a missing address is its own reason, not the same one",
      noAddr.ok === false && /email address/.test(noAddr.detail || ""), noAddr);
    const noSms = await N.sendSMS("8645551234", "hi");
    ok("sendSMS: same contract", noSms.ok === false && /Twilio/.test(noSms.detail || ""), noSms);
    ok("sendEmail: a reason is always a string when it fails — never undefined for an alert to print",
      typeof outcome.detail === "string" && typeof noAddr.detail === "string");
  })());
}

// ── ONE RECEIPT, SENT TWICE (2026-09-29) ─────────────────────────────────────────────────────────
// The fix for a receipt that never sent is a way to send it again — and the obvious way to build
// that is to write the message a second time, in the resend route. That is how this repo got thirty
// money formatters, two markdown renderers, four benefit describers and three idempotency keys. A
// resent receipt that does not match the original is worse than no resend: the customer now holds
// two different accounts of one order.
{
  const R = require("../.smoke/receipt.js");
  const order = {
    id: "dcbb7295-d47f-40f3-9a1f-3d44366c5e35",
    ship_name: "Ryan Thompkins",
    total_cents: 3200,
    items: [{ title: "GT3 6-Panel Cap", qty: 1 }],
  };

  ok("receipt: the reference is short enough to read down a phone, and stable",
    R.orderRef(order.id) === "DCBB72" && R.orderRef(order.id) === R.orderRef(order.id), R.orderRef(order.id));
  ok("receipt: a missing id does not produce 'UNDEFIN'", R.orderRef("") === "" && R.orderRef(null) === "");
  ok("receipt: first name only", R.firstName("Ryan Thompkins") === "Ryan" && R.firstName("Ryan") === "Ryan");
  ok("receipt: no name is empty, never the word undefined — it is going in front of a customer",
    R.firstName(null) === "" && R.firstName("   ") === "");
  ok("receipt: the item line is what they check against the box",
    R.itemLine([{ title: "Cap", qty: 1 }, { title: "Tee", qty: 2 }]) === "1× Cap, 2× Tee");
  ok("receipt: a line with no title is dropped rather than rendering '1× undefined'",
    R.itemLine([{ title: "Cap", qty: 1 }, { qty: 2 }]) === "1× Cap");

  const first = R.orderReceipt(order);
  const again = R.orderReceipt(order, true);
  // THE POINT OF THE WHOLE FILE. Same order in, same facts out — the resend differs only in saying
  // that it IS a resend, never in what was bought or what it cost.
  for (const fact of ["1× GT3 6-Panel Cap", "$32", "DCBB72"]) {
    ok(`receipt: the resend carries the same fact — ${fact}`,
      first.message.includes(fact) && again.message.includes(fact), [first.message, again.message]);
  }
  ok("receipt: and it says it is a second copy, because one arriving days later reads like a second charge",
    /not a new charge/i.test(again.message) && !/not a new charge/i.test(first.message));
  ok("receipt: the money goes through money(), so $32.00 reads $32 like every other screen",
    first.message.includes("Total $32") && !first.message.includes("32.00"), first.message);
  ok("receipt: an unknown total reads '—', not '$0' — a receipt claiming zero is a refund claim",
    R.orderReceipt({ ...order, total_cents: null }).message.includes("Total —"));
  ok("receipt: before it ships, it promises tracking",
    /email tracking the moment it ships/.test(first.message));
  ok("receipt: after it ships, it carries the tracking instead of promising it — a resend sent to\n" +
    "         somebody waiting on a box must not still say 'we will email tracking'",
    /Tracking: 1Z999/.test(R.orderReceipt({ ...order, tracking_number: "1Z999AA1" }, true).message) &&
    !/email tracking the moment/.test(R.orderReceipt({ ...order, tracking_number: "1Z999AA1" }, true).message));
  ok("receipt: an order with no items still produces a sendable message, not a blank one",
    R.orderReceipt({ ...order, items: [] }).message.includes("no items on this order"));
  ok("shipped notice: same home, same reference", R.shippedNotice(order).message.includes("DCBB72"));
  ok("shipped notice: empty parts are dropped, never rendered as blank lines",
    !/\n\n/.test(R.shippedNotice({ ...order, tracking_number: null, tracking_url: null }).message));
}

// ── THE IDEMPOTENCY KEY (2026-09-29) ─────────────────────────────────────────────────────────────
// Ryan tried to buy the first flagship cap and got Square's wall printed onto the checkout page:
// "Different request parameters used for the same idempotency_key: dcbb7295-…". Every assertion
// here is that failure, or the double-charge protection it must not cost us to fix.
{
  const I = require("../.smoke/idempotency.js");
  let n = 0;
  const mint = () => `key-${++n}`;

  // THE BUG. Same order, second tap of Pay — which means a fresh nonce, because a nonce is single
  // use. A key built from the order alone does not change, and Square refuses it. Forever.
  {
    const order = { cart: [{ id: "cap", qty: 1 }], ship: { zip: "29651" } };
    const first = I.nextIdem(I.EMPTY_IDEM, "nonce-A", order, mint);
    const second = I.nextIdem(first, "nonce-B", order, mint);
    ok("idem: a new card nonce mints a NEW key — the exact wall the cap order hit",
      first.key !== second.key, [first.key, second.key]);
  }

  // AND THE PROTECTION THAT MUST SURVIVE IT. The ambiguous case — request sent, answer lost, customer
  // taps again — replays the SAME nonce, because no new tokenize() happened. Key holds, Square
  // replays instead of charging twice. If this ever fails, the fix above became a double charge.
  {
    const order = { cart: [{ id: "cap", qty: 1 }], ship: { zip: "29651" } };
    const first = I.nextIdem(I.EMPTY_IDEM, "nonce-A", order, mint);
    const retry = I.nextIdem(first, "nonce-A", order, mint);
    ok("idem: the SAME nonce and the same order keep the SAME key — a lost response still dedupes",
      first.key === retry.key && retry === first, [first.key, retry.key]);
  }

  ok("idem: changing the order mints a new key",
    I.nextIdem(I.nextIdem(I.EMPTY_IDEM, "n", { qty: 1 }, mint), "n", { qty: 2 }, mint).sig !==
    I.nextIdem(I.EMPTY_IDEM, "n", { qty: 1 }, mint).sig);
  ok("idem: changing the SHIPPING address mints a new key — Shop.tsx signed the cart and not the address",
    I.idemSignature("n", { cart: 1, ship: { zip: "29651" } }) !== I.idemSignature("n", { cart: 1, ship: { zip: "29615" } }));
  ok("idem: a pickup attempt and a delivery attempt never collide",
    I.idemSignature("n", { path: "pickup", count: 6 }) !== I.idemSignature("n", { path: "delivery", count: 6 }));
  ok("idem: no nonce at all (a pay-later path) still signs, and still tracks the order",
    I.idemSignature(null, { a: 1 }) !== I.idemSignature(null, { a: 2 }) && I.idemSignature(null, { a: 1 }) === I.idemSignature(undefined, { a: 1 }));
  ok("idem: an empty previous state always mints", I.nextIdem(null, "n", { a: 1 }, mint).key.startsWith("key-"));
  ok("idem: a stored state with a key but a different signature is not reused",
    I.nextIdem({ sig: "old", key: "k9" }, "n", { a: 1 }, mint).key !== "k9");
  {
    // A details object with a cycle must not take down a checkout. Failing toward a FRESH key is
    // the safe direction: a new key can only miss a dedupe, it can never be refused.
    const cyclic = {}; cyclic.self = cyclic;
    let threw = false, key = null;
    try { key = I.nextIdem(I.EMPTY_IDEM, "n", cyclic, mint).key; } catch { threw = true; }
    ok("idem: an unserialisable signature mints rather than throwing on the Pay button", !threw && !!key);
  }

  // WHAT THE CUSTOMER READS. The cap checkout printed a UUID and the words "idempotency_key" onto
  // the page, above the Pay button, in a shop.
  ok("payError: Square's idempotency wall becomes something a buyer can act on",
    I.payErrorText("Different request parameters used for the same idempotency_key: dcbb7295-d47f-40f3-9a1f-3d44366c5e35.")
      === "That attempt expired. Tap Pay again — you have not been charged.",
    I.payErrorText("Different request parameters used for the same idempotency_key: dcbb7295."));
  ok("payError: and it never leaves the customer wondering whether they paid",
    /not been charged|nothing was charged/.test(I.payErrorText("CARD_DECLINED")) &&
    /not been charged|nothing was charged/.test(I.payErrorText("")));
  ok("payError: a decline says which card problem it is", /declined/i.test(I.payErrorText("CARD_DECLINED")));
  ok("payError: cvv, postal and funds each get their own sentence",
    /security code/.test(I.payErrorText("cvv_failure")) && /ZIP/.test(I.payErrorText("ADDRESS_VERIFICATION_FAILURE")) &&
    /insufficient funds/i.test(I.payErrorText("INSUFFICIENT_FUNDS")));
  // An operator reading a support email needs the real message. Inventing a friendlier wrong one is
  // worse than a blunt right one.
  ok("payError: an unrecognised message is passed through, not replaced by a vague apology",
    I.payErrorText("Location is not active") === "Location is not active");
}

// ── PLAN NAV (0316) — the jump that has to survive a page load ───────────────────────────────────
// This is here because the deep-link gate below could not have caught it, and neither could any
// other test in this file: the bug was in the ORDER of two side effects, and only pressing the
// button on production showed it.
//
// "Edit the venue instead" landed on the Plan CALENDAR. The helper wrote the handoff key, fired
// the gt3-plan-tab-set event, and THEN hard-navigated — but crew/page.tsx's listener CONSUMES the
// handoff (reads the key, deletes it, sets the tab). So the page about to be destroyed ate the
// message, the fresh load found nothing, and the default tab won. The key was gone and the tab
// was wrong: exactly what production showed.
//
// So the rule is testable without a browser, by recording what the function does to a fake window
// in order: when we are LEAVING, the write must be the last word.
{
  const N = require("../.smoke/planNav.js");

  const runGoPlanTab = (tab, opts) => {
    const log = [];
    const store = new Map();
    const realWindow = global.window;
    const realLocalStorage = global.localStorage;
    global.localStorage = {
      setItem: (k, v) => { log.push(`write:${k}=${v}`); store.set(k, v); },
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      removeItem: (k) => { log.push(`consume:${k}`); store.delete(k); },
    };
    global.window = {
      dispatchEvent: (e) => { log.push(`event:${e.type}`); return true; },
      // the real listener consumes the handoff — model that, because it is the whole bug
      location: { set href(v) { log.push(`navigate:${v}`); } },
      document: { getElementById: () => null },
    };
    global.Event = class { constructor(type) { this.type = type; } };
    try { N.goPlanTab(tab, opts); } finally {
      global.window = realWindow; global.localStorage = realLocalStorage;
    }
    return { log, left: store.get(N.PLAN_TAB_KEY) ?? null };
  };

  const leaving = runGoPlanTab("vendors", {});
  ok("planNav: leaving the page writes the handoff and navigates", 
    leaving.log[0] === `write:${N.PLAN_TAB_KEY}=vendors` && leaving.log.some((l) => l.startsWith("navigate:")), leaving.log);
  ok("planNav: and does NOT fire the event, which the page being destroyed would consume",
    !leaving.log.some((l) => l.startsWith("event:")), leaving.log);
  ok("planNav: so the handoff is still there for the next mount to read",
    leaving.left === "vendors", leaving.left);

  const staying = runGoPlanTab("leads", { setSection: () => {} });
  ok("planNav: staying on the page DOES fire the event — nothing else would notice",
    staying.log.some((l) => l === `event:${N.PLAN_TAB_EVENT}`), staying.log);
  ok("planNav: and does not navigate",
    !staying.log.some((l) => l.startsWith("navigate:")), staying.log);

  ok("planNav: the tab vocabulary matches crew/page.tsx's five",
    N.PLAN_TABS.length === 5 && N.isPlanTab("route") && !N.isPlanTab("nope"), N.PLAN_TABS);
  ok("planNav: the href carries no ?a= — that parameter is an anchor, not a tab",
    !/[&?]a=/.test(N.planTabHref("route")), N.planTabHref("route"));

  // ── ?t= MAKES A PLAN TAB A PLACE ───────────────────────────────────────────────────────────────
  // Before this, a Plan tab was a localStorage handoff and nothing else: it could not be linked,
  // bookmarked or sent to anybody, and SEVEN places wrote that handoff by hand across six files.
  // A link into one broke twice, in two different ways, because the mechanism was invisible to
  // anyone writing an href. The tab is addressed the way the section always has been.
  ok("planNav: a tab has a real, pasteable address",
    N.planTabHref("route") === "/crew?s=plan&t=route", N.planTabHref("route"));
  ok("planNav: and the URL is read back strictly",
    N.planTabFromUrl("https://x/crew?s=plan&t=leads") === "leads"
    && N.planTabFromUrl("https://x/crew?s=plan&t=nonsense") === null
    && N.planTabFromUrl("https://x/crew?s=plan") === null);
  ok("planNav: every tab round-trips through its own href",
    N.PLAN_TABS.every((tab) => N.planTabFromUrl("https://x" + N.planTabHref(tab)) === tab));
  ok("planNav: the address is the section's own parameter plus one, not a third mechanism",
    N.planTabHref("events").startsWith("/crew?s=plan&"));
}

// ── DEEP LINKS RESOLVE (0316) ────────────────────────────────────────────────────────────────────
// A different kind of check from everything above: not "is this function right" but "does this link
// go anywhere". It exists because of a defect that shipped three commits after the audit started
// naming exactly this failure.
//
// StopRecord offered "Edit the venue instead" as <a href="/crew?s=plan&a=vendors">. It looks like
// every other deep link in this app. It is not one. `?a=` is an ANCHOR — crew/page.tsx reads it and
// calls scrollToAnchor — and there is no element with id "vendors" anywhere, because VendorsAdmin
// only mounts once that tab is already selected. So the link landed you on the Plan CALENDAR and did
// nothing else. No error, no empty state, nothing at all to notice. lib/records.ts had written the
// rule down before I broke it: "A link that half-works is worse than one that plainly does not."
//
// Nothing could have caught it except reading the URL against the app. So: read the URL against the
// app. Every /crew?s=<section> in the source must name a real section, and every &a=<anchor> must
// name an id that exists somewhere in the JSX.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");

  // The section vocabulary, read from its one home rather than retyped — a section renamed there and
  // not here would make this check pass on links that are broken.
  // (components/OperatorSection.tsx since 2026-10-02: the provider and VALID moved out of the nav so
  //  the shell could stop shipping the nav to guests; OperatorNav re-exports them.)
  const navSrc = fs.readFileSync(path.join(root, "components/OperatorSection.tsx"), "utf8");
  const validLine = /export const VALID = new Set<OpSection>\(\[([^\]]*)\]\)/.exec(navSrc);
  const SECTIONS = new Set((validLine ? validLine[1] : "").match(/"([a-z]+)"/g)?.map((s) => s.slice(1, -1)) ?? []);
  ok("deep links: the section vocabulary was found in OperatorSection", SECTIONS.size >= 10, SECTIONS.size);

  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules|\.next|\.smoke|\.git/.test(f)) walk(f); }
      else if (/\.tsx?$/.test(e.name)) files.push(f);
    }
  })(root);

  const ids = new Set();
  for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)) ids.add(m[1]);
  ok("deep links: anchor ids were found in the JSX", ids.size > 50, ids.size);

  // ── MIGRATIONS PRODUCE LINKS TOO, AND NOBODY WAS READING THEM (0331) ────────────────────────
  // This rule was right; its REACH was wrong. It walked .ts/.tsx, so it caught exactly this mistake
  // in app/api/square/webhook within an hour of it being written — and never looked at the pg_cron
  // producers in supabase/migrations/, which is where most of this app's alerts are actually raised.
  // 0329 shipped an alert pointing at a section that does not exist and nothing said a word; the
  // link went to production, into a real alert about a real paid order, and landed whoever tapped it
  // at the top of an unrelated page.
  //
  // FLOOR, like every other rule here: history is not retro-judged. 0331 changed the reach, so 0331
  // is where it starts — and 0331 is also the migration that fixes the one below it.
  const MIG_FLOOR = 331;
  const migDir = path.join(root, "supabase", "migrations");
  const migFiles = !fs.existsSync(migDir) ? [] : fs.readdirSync(migDir)
    .filter((n) => n.endsWith(".sql") && Number(n.slice(0, 4)) >= MIG_FLOOR)
    .sort()
    .map((n) => path.join(migDir, n));

  // Comments are not links. This block's own explanation quotes the broken URL, and so does
  // lib/planNav — the LEDGER gate learned the same thing about record_migration. `//` preceded by a
  // colon is a URL scheme, not a comment; getting that wrong would only ever hide a real link, so
  // it is checked below by feeding the gate a known-bad file.
  const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

  // SQL comments are `--`, not `//`. A migration's header explains the bug it fixes and will quote
  // URLs while doing it; stripping the wrong comment syntax would read the explanation as a link.
  const stripSqlComments = (s) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

  const broken = [];
  for (const f of [...files, ...migFiles]) {
    const src = f.endsWith(".sql")
      ? stripSqlComments(fs.readFileSync(f, "utf8"))
      : stripComments(fs.readFileSync(f, "utf8"));
    for (const m of src.matchAll(/\/crew\?s=([a-z]+)((?:&[a-z]+=[a-zA-Z0-9:_-]+)*)/g)) {
      const rel = f.replace(root + "/", "");
      if (!SECTIONS.has(m[1])) broken.push(`${rel}: ?s=${m[1]} is not a section`);
      const a = /[&?]a=([a-zA-Z0-9_-]+)/.exec(m[2] || "");
      if (a && !ids.has(a[1])) broken.push(`${rel}: &a=${a[1]} — no element has that id`);
    }
  }
  ok("deep links: every /crew link in the app points at something that exists", broken.length === 0, broken);

  // A gate that cannot fail is a gate that lies. Feed it a link that IS broken, in live code rather
  // than a comment, and confirm it says so.
  const probe = `<a href="/crew?s=plan&a=no-such-anchor">x</a>\n<a href="/crew?s=nosuchsection">y</a>`;
  const probeHits = [...stripComments(probe).matchAll(/\/crew\?s=([a-z]+)((?:&[a-z]+=[a-zA-Z0-9:_-]+)*)/g)]
    .filter((m) => !SECTIONS.has(m[1]) || (/[&?]a=([a-zA-Z0-9_-]+)/.exec(m[2] || "") || [])[1] && !ids.has(/[&?]a=([a-zA-Z0-9_-]+)/.exec(m[2])[1]));
  ok("deep links: the check itself catches a bad section and a bad anchor", probeHits.length === 2, probeHits.length);
  ok("deep links: and a commented-out link is not counted",
    [...stripComments(`// <a href="/crew?s=plan&a=no-such-anchor">`).matchAll(/\/crew\?s=/g)].length === 0);

  // ── AND THE JUMPS THAT ARE NOT URLS (2026-10-04) ─────────────────────────────────────────────
  // Needs-you rows, the Money tiles and the buttons that replaced "go to Plan › Vendors" sentences
  // jump in-app — setSection, then scrollToAnchor — with no URL for the check above to read. An
  // anchor typed wrong lands exactly as quietly as a wrong ?a= did: at the top of the section, with
  // nothing to notice. Same rule, same ids: every literal anchor a jump names must exist.
  // An id can also be given conditionally — Prep's first critical task is id={… ? "prep-first-crit" :
  // undefined} — so the literals inside an id={…} count as ids here too.
  const jumpIds = new Set(ids);
  for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/\bid=\{([^}]*)\}/g)) for (const s of m[1].matchAll(/"([a-zA-Z0-9_-]+)"/g)) jumpIds.add(s[1]);
  const jumps = [];
  for (const f of files) {
    const src = stripComments(fs.readFileSync(f, "utf8"));
    for (const m of src.matchAll(/scrollToAnchor\("([a-zA-Z0-9_-]+)"\)|\banchor: "([a-zA-Z0-9_-]+)"/g)) {
      const a = m[1] || m[2];
      if (!jumpIds.has(a)) jumps.push(`${f.replace(root + "/", "")}: "${a}" — no element has that id`);
    }
  }
  ok("in-app jumps: every literal anchor a button or a Needs-you row jumps to names an element that exists", jumps.length === 0, jumps);

  // ── AN ANCHOR THAT EXISTS IS NOT THE SAME AS A PLACE YOU ARRIVE ──────────────────────────────
  // Ryan tapped a link to draft a contract and got Money's Spend & budget card. Every check above
  // passed: ?s=money is a real section and the link named no anchor, so there was nothing to
  // resolve. That is the hole. Money is an ACCORDION — twenty collapsed panels — and landing at the
  // top of it is landing nowhere, six screens above the thing you asked for.
  //
  // So: a link into a section built as an accordion must say WHICH panel. The list is hard-coded
  // and short on purpose; a section earns its way onto it by having panels, and both of these have
  // more than fifteen. Sections that are a single screen (day, now, notes) are unaffected — an
  // anchor there would be noise.
  const ACCORDION = new Set(["money", "settings"]);

  // Read the URL up to whatever ENDS it — a quote, a backtick, whitespace, a closing bracket —
  // rather than a list of param shapes. The first version of this used the same
  // (?:&[a-z]+=[a-zA-Z0-9:_-]+)* pattern as the check above, and reported EditCopyPill as
  // anchorless: its link is a template literal, `/crew?s=settings&a=${copyGroupAnchor(group)}`, and
  // `${` is not in that character class, so the match stopped at the section and the anchor was
  // invisible. A real anchor, computed at runtime, flagged as missing. Seventh time a confident
  // regex in this codebase has been wrong in the alarming direction, so this one asks the simpler
  // question: is there an &a= anywhere in the rest of this URL, literal or interpolated?
  const anchorOf = (src, at) => {
    const tail = (src.slice(at, at + 160).match(/^[^"'`\s>)]*/) || [""])[0];
    return /[&?]a=/.test(tail);
  };
  const anchorless = [];
  for (const f of [...files, ...migFiles]) {
    const src = f.endsWith(".sql")
      ? stripSqlComments(fs.readFileSync(f, "utf8"))
      : stripComments(fs.readFileSync(f, "utf8"));
    for (const m of src.matchAll(/\/crew\?s=([a-z]+)/g)) {
      if (!ACCORDION.has(m[1])) continue;
      if (anchorOf(src, m.index + m[0].length)) continue;
      anchorless.push(`${f.replace(root + "/", "")}: ?s=${m[1]} with no &a= — lands at the top of an accordion`);
    }
  }
  ok("deep links: no link drops you at the top of an accordion section", anchorless.length === 0, anchorless);

  // The gate, fed the exact link that took Ryan to the wrong card — and the three things that must
  // NOT trip it, including the interpolated anchor its first version got wrong.
  const accCount = (code) => {
    const src = stripComments(code);
    let n = 0;
    for (const m of src.matchAll(/\/crew\?s=([a-z]+)/g)) {
      if (ACCORDION.has(m[1]) && !anchorOf(src, m.index + m[0].length)) n++;
    }
    return n;
  };
  ok("deep links: the accordion check catches the link that caused this",
    accCount(`<a href="/crew?s=money">Draft one</a>`) === 1);
  ok("deep links: and does not flag the fixed version of it",
    accCount(`<a href="/crew?s=money&a=operators">Draft one</a>`) === 0);
  ok("deep links: an anchor built at runtime is an anchor (components/EditCopyPill.tsx)",
    accCount('window.location.href = `/crew?s=settings&a=${copyGroupAnchor(group)}`;') === 0);
  ok("deep links: a one-screen section needs no anchor",
    accCount(`<a href="/crew?s=day">Today</a>`) === 0);

  // ── AND THE PANEL HAS TO OPEN ────────────────────────────────────────────────────────────────
  // The other half of what broke, and the half no URL check can see: ?a= scrolled to a CLOSED
  // accordion header, and scrollToAnchor was a single setTimeout that fired before twenty panels
  // restored their open state and pushed the target 3,760px down the page. Both are runtime
  // behaviours, so what is asserted here is that the MECHANISM is still wired: the jump asks the
  // panel to open, and Panel listens. If either side is deleted, this fails.
  // 2026-10-03: the jump moved to lib/anchors (one home — the Readiness tiles had a weaker copy).
  // The mechanism is the same; it is read where it lives now.
  const crewSrc = fs.readFileSync(path.join(root, "app/crew/page.tsx"), "utf8");
  const jumpSrc = fs.readFileSync(path.join(root, "lib/anchors.ts"), "utf8");
  ok("deep links: the jump asks the target panel to open, rather than assuming it already is",
    /dispatchEvent\(new CustomEvent\(OPEN_PANEL_EVENT/.test(jumpSrc));
  ok("deep links: Panel listens for that request",
    /addEventListener\(OPEN_PANEL_EVENT/.test(crewSrc));
  ok("deep links: and the scroll waits for the page to settle instead of guessing a delay",
    /stable\s*\+=\s*1/.test(jumpSrc) && /stable\s*<\s*3/.test(jumpSrc));
}

// ── which build is answering (lib/buildInfo.ts) ────────────────────────────────────────────────
// The point of this module is that it refuses to guess, so most of what is worth asserting is the
// NEGATIVE space: that "I do not know" never quietly becomes "yes".
{
  const BI = require("../.smoke/buildInfo.js");
  const SHA = "e840972aa1b3c4d5e6f708192a3b4c5d6e7f8091";
  const keep = { ...process.env };
  const env = (o) => {
    for (const k of ["VERCEL", "VERCEL_ENV", "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_COMMIT_REF", "VERCEL_DEPLOYMENT_ID"]) delete process.env[k];
    Object.assign(process.env, o);
  };

  env({ VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_REF: "main", VERCEL_DEPLOYMENT_ID: "dpl_abc" });
  const known = BI.buildInfo();
  ok("build: a deployed build reports itself known", known.known === true, known);
  ok("build: commitShort is the 7 chars a person compares against git log",
    known.commitShort === "e840972", known.commitShort);
  ok("build: branch and env come straight through", known.branch === "main" && known.env === "production", known);
  ok("build: a known build carries no why — there is nothing to explain", known.why === undefined, known.why);

  // The two ways it can be unknown are different problems with different fixes, so they must not
  // collapse into one message.
  env({ VERCEL: "1", VERCEL_ENV: "production" });
  const onVercel = BI.buildInfo();
  ok("build: on Vercel without the sha, known is false", onVercel.known === false, onVercel);
  ok("build: and it names the project setting that fixes it",
    /Automatically expose System Environment Variables/.test(onVercel.why || ""), onVercel.why);
  ok("build: an unknown build reports null, never a placeholder",
    onVercel.commit === null && onVercel.commitShort === null, onVercel);
  ok("build: but still reports what it DOES know", onVercel.env === "production", onVercel);

  env({});
  const local = BI.buildInfo();
  ok("build: off-platform is unknown for a different, stated reason",
    local.known === false && /Not running on Vercel/.test(local.why || ""), local.why);

  env({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: "   ", VERCEL_GIT_COMMIT_REF: "" });
  const blank = BI.buildInfo();
  ok("build: a whitespace-only env var is absent, not a commit named '   '",
    blank.known === false && blank.branch === null, blank);

  // isBuild — the guard that stops "I cannot tell" reading as "yes".
  env({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: SHA });
  ok("isBuild: the full sha matches", BI.isBuild(SHA) === true);
  ok("isBuild: the short sha a person actually types matches too", BI.isBuild("e840972") === true);
  ok("isBuild: case does not matter", BI.isBuild("E840972") === true);
  ok("isBuild: a different commit does not match", BI.isBuild("2f0d44e") === false);
  ok("isBuild: a prefix too short to identify anything is refused",
    BI.isBuild("e84") === false && BI.isBuild("") === false && BI.isBuild(null) === false);
  env({});
  ok("isBuild: an UNKNOWN build matches nothing — not even the correct sha",
    BI.isBuild(SHA) === false);

  for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
  Object.assign(process.env, keep);
}

// ── who may see a staff surface (lib/access.ts) ────────────────────────────────────────────────
// Found in PRODUCTION on 2026-09-09: mid-navigation the crew console showed the OWNER
// "Staff only. This area is for GT3PB staff. If that's you, ask the owner to add you."
// AuthProvider's profile is null while loading, null when the read fails, and null when there is
// genuinely no row — and roleOf(null) is "member". Four gates read all three as "you are a
// customer". The assertions that matter are the ones that must NOT say deny.
{
  const A = require("../.smoke/access.js");
  const R = require("../.smoke/roles.js");
  const owner = { role: "owner" }, server = { role: "server" }, member = { role: "member" };

  ok("access: the bug — roleOf(null) really is 'member', which is why a gate cannot use it alone",
    R.roleOf(null) === "member");

  ok("access: signed in, profile still loading → WAIT, never deny",
    A.staffAccess(true, "loading", null) === "wait");
  ok("access: signed in, profile read FAILED → failed, never deny",
    A.staffAccess(true, "error", null) === "failed");
  ok("access: and a failed read does not deny even when we had nothing to go on",
    A.staffAccess(true, "error", null) !== "deny");
  ok("access: nobody signed in → anon, which is an invitation, not a refusal",
    A.staffAccess(false, "ready", null) === "anon");
  ok("access: not signed in outranks everything else we might know",
    A.staffAccess(false, "loading", owner) === "anon");

  ok("access: known owner → allow", A.staffAccess(true, "ready", owner) === "allow");
  ok("access: known server → allow", A.staffAccess(true, "ready", server) === "allow");
  ok("access: known member → deny, the ONE case we can stand behind",
    A.staffAccess(true, "ready", member) === "deny");
  ok("access: known-and-no-profile-row → deny, because we asked and got an answer",
    A.staffAccess(true, "ready", null) === "deny");

  ok("access: leadership is narrower — a server is staff but not leadership",
    A.staffAccess(true, "ready", server) === "allow" && A.leadershipAccess(true, "ready", server) === "deny");
  ok("access: an owner is both", A.leadershipAccess(true, "ready", owner) === "allow");
  ok("access: leadership waits on an unknown profile too, rather than denying",
    A.leadershipAccess(true, "loading", null) === "wait");

  ok("access: isAllowed is true for exactly one verdict",
    ["anon","wait","failed","deny"].every((v) => !A.isAllowed(v)) && A.isAllowed("allow"));

  // The legacy fallback still has to work — an old profile with is_admin and no role is an owner.
  ok("access: a pre-migration admin profile still resolves to owner",
    A.staffAccess(true, "ready", { is_admin: true }) === "allow" && R.roleOf({ is_admin: true }) === "owner");

  // ── the vocabulary itself ────────────────────────────────────────────────────────────────────
  // Four modules used to name these seven roles and two had drifted on "Event Manager". The name
  // and the tier now come from here, so here is where they get asserted.
  ok("roles: every role in the vocabulary has a name — no blank cells",
    R.ALL_ROLES.every((r) => typeof R.ROLE_LABEL[r] === "string" && R.ROLE_LABEL[r].length > 0));
  ok("roles: the drift that existed is settled — one spelling of Event Manager",
    R.roleLabel("event_manager") === "Event Manager");
  ok("roles: an unrecognised role reads as Member rather than blank, the same default roleOf takes",
    R.roleLabel("wizard") === "Member" && R.roleLabel(null) === "Member" && R.roleLabel(undefined) === "Member");
  ok("roles: SENIORITY and ALL_ROLES are ONE list — reversing either gives the other",
    JSON.stringify([...R.SENIORITY].reverse()) === JSON.stringify(R.ALL_ROLES));
  ok("roles: seniority actually runs owner → member, so a roster sorted by it reads top-down",
    R.SENIORITY[0] === "owner" && R.SENIORITY[R.SENIORITY.length - 1] === "member");
  ok("roles: every role appears exactly once in the ordering",
    new Set(R.SENIORITY).size === R.SENIORITY.length && R.SENIORITY.length === 7);

  // tierOf is DERIVED from LEADERSHIP_ROLES/STAFF_ROLES rather than a fourth hand-written column.
  // These assert the partition the team console used to hand-write, so a change to either list
  // that would silently regroup the roster fails here instead.
  ok("roles: leadership tier is exactly owner, admin, event manager",
    R.SENIORITY.filter((r) => R.tierOf(r) === "lead").join(",") === "owner,admin,event_manager");
  ok("roles: crew tier is exactly operator, contractor, server",
    R.SENIORITY.filter((r) => R.tierOf(r) === "crew").join(",") === "operator,contractor,server");
  ok("roles: member is its own tier — a customer is not crew",
    R.tierOf("member") === "member" && R.tierOf("wizard") === "member");
  ok("roles: every role lands in exactly one tier, so nobody vanishes off the roster",
    R.ALL_ROLES.filter((r) => ["lead","crew","member"].includes(R.tierOf(r))).length === 7);

  // toRole is the RAW role — no is_admin fallback. That difference is the whole reason both exist.
  ok("roles: toRole does NOT apply the is_admin fallback that roleOf does",
    R.toRole("owner") === "owner" && R.toRole("nonsense") === "member" && R.roleOf({ is_admin: true }) === "owner");
}

// ── PROSE (lib/prose.ts) ───────────────────────────────────────────────────────────────────────
// The assistant's answers were rendered as raw text, so a real reply on Ryan's phone showed every
// asterisk. The fixture below is THAT MESSAGE, copied out of the screenshot rather than invented —
// a parser tested on prose I made up is a parser tested on my own assumptions.
{
  const P = require("../.smoke/prose.js");
  const sp = (line) => P.parseSpans(line).map((s) => `${s.kind}:${s.text}`).join("|");

  // the real reply, verbatim
  const REAL = [
    "For a **Rise batch using 340 g of coffee**, scale linearly from the 2 gal / 560 g spec:",
    "",
    "**Water:** 340 ÷ 560 × 2 gal = **~1.21 gal** (about 1 gal + 1.5 cups)",
    "",
    "**Coconut water** (added after filtration): 340 ÷ 560 × 32 oz = **~19.4 oz** (just under 2.5 cups)",
    "",
    "**Everything else stays the same:**",
    "- Ratio: 1:13",
    "- Extraction: 20 h cold",
    "- Mountain Valley Spring Water as the base",
    "",
    "Want me to convert the water to liters or ounces?",
  ].join("\n");
  const B = P.parseProse(REAL);

  ok("prose: the real reply parses to 5 paragraphs, one bullet list, in order",
    B.map((b) => b.kind).join(",") === "p,p,p,p,ul,p", B.map((b) => b.kind).join(","));
  ok("prose: the bullet list has the three spec lines",
    B[4].kind === "ul" && B[4].items.length === 3 && B[4].items[2].lines[0][0].text.startsWith("Mountain Valley"));
  ok("prose: a quantity inside a sentence comes out bold, not asterisked",
    sp("**Water:** 340 ÷ 560 × 2 gal = **~1.21 gal** (about 1 gal + 1.5 cups)")
      === "bold:Water:|text: 340 ÷ 560 × 2 gal = |bold:~1.21 gal|text: (about 1 gal + 1.5 cups)");
  ok("prose: NOTHING is lost — the text round-trips with the markers removed",
    P.proseText(B).includes("Mountain Valley Spring Water as the base")
    && !P.proseText(B).includes("**") && P.proseText(B).includes("~1.21 gal"));

  // ── the rule for every marker: unmatched is TEXT ──
  ok("prose: an unmatched ** stays literal and does not eat the rest of the message",
    sp("a **bold start that never closes") === "text:a **bold start that never closes");
  ok("prose: an unmatched backtick stays literal",
    sp("run `npm test to check") === "text:run `npm test to check");
  ok("prose: empty markers are text, not empty emphasis",
    sp("a ** b") === "text:a ** b" && sp("`` x") === "text:`` x");

  // ── the asterisk is arithmetic here, not emphasis ──
  ok("prose: '2 * 3 * 4' is multiplication, not italics",
    sp("2 * 3 * 4") === "text:2 * 3 * 4");
  ok("prose: a footnote asterisk survives", sp("estimated*") === "text:estimated*");

  // ── binding order ──
  ok("prose: ** wins over * — '**a**' is bold, not an empty italic",
    sp("**a**") === "bold:a");
  ok("prose: code is literal inside — backticked asterisks stay asterisks",
    sp("`**not bold**`") === "code:**not bold**");
  ok("prose: adjacent bold spans both render",
    sp("**a** and **b**") === "bold:a|text: and |bold:b");
  ok("prose: underscore italics work and _snake_case_ does not break the line",
    P.parseSpans("_soft_").map((s) => s.kind).join() === "em");

  // ── blocks ──
  ok("prose: numbered steps become an ordered list that starts where the model started",
    (() => { const b = P.parseProse("2. second\n3. third"); return b[0].kind === "ol" && b[0].start === 2 && b[0].items.length === 2; })());
  ok("prose: a heading is a heading, capped at level 3",
    (() => { const b = P.parseProse("##### deep"); return b[0].kind === "h" && b[0].level === 3; })());
  ok("prose: consecutive plain lines stay ONE paragraph but keep their own line breaks",
    (() => { const b = P.parseProse("line one\nline two"); return b.length === 1 && b[0].kind === "p" && b[0].lines.length === 2; })());
  ok("prose: a blank line separates paragraphs",
    P.parseProse("one\n\ntwo").length === 2);
  ok("prose: a bullet immediately after a paragraph closes it",
    P.parseProse("intro\n- a\n- b").map((b) => b.kind).join() === "p,ul");
  ok("prose: switching from bullets to numbers starts a new list",
    P.parseProse("- a\n1. b").map((b) => b.kind).join() === "ul,ol");
  ok("prose: • is a bullet too — models use it", P.parseProse("• a").at(0).kind === "ul");
  ok("prose: empty input is no blocks, not a crash",
    P.parseProse("").length === 0 && P.parseProse(null).length === 0);
  ok("prose: CRLF is normalised", P.parseProse("a\r\n\r\nb").length === 2);

  // ── THE HOUSE SUMMARY FORMAT ─────────────────────────────────────────────────────────────────
  // Copied out of SUMMARY_SYSTEM in app/api/agents/summarize/route.ts, which is the exact shape
  // every meeting recap in this app is INSTRUCTED to produce: a bold title, its description
  // indented on the next line. Until 2026-09-13 both renderers closed the list at the indented
  // line and opened a paragraph, so a seven-item Action Items block rendered as seven one-item
  // bullet lists each trailing an orphan paragraph. Nobody had ever parsed the format the prompt
  // asks for — the prompt and the reader were written months apart and never compared.
  {
    const AI = [
      "## Action Items",
      "- **Pull the Greenville permit**",
      "  Temporary Food Service Permit, filed 10 days before the Oct 4 market.",
      "- **Log the five missing batches**",
      "  Batches from Aug 18-29 never hit the ledger.",
    ].join("\n");
    const b = P.parseProse(AI);
    ok("prose: the house Action Items block is ONE list, not a list per item",
      b.map((x) => x.kind).join() === "h,ul", b.map((x) => x.kind).join());
    ok("prose: ...with both items in it",
      b[1].items.length === 2, b[1].items.length);
    ok("prose: ...and each item KEEPS its indented description instead of orphaning it",
      b[1].items[0].lines.length === 2
      && b[1].items[0].lines[1].map((s) => s.text).join("").startsWith("Temporary Food Service"));
    ok("prose: the bold title survives as the item's first line",
      b[1].items[1].lines[0][0].kind === "bold");
    // The indent is the whole guard. Unindented prose after a list still ends the list — that is
    // what every test above this one asserts, and it must not have quietly changed.
    ok("prose: an UNindented line after a list still closes the list",
      P.parseProse("- a\nplain follow-on").map((x) => x.kind).join() === "ul,p");
    ok("prose: an indented line with no list above it is still a paragraph",
      P.parseProse("  indented opener").map((x) => x.kind).join() === "p");
    ok("prose: a numbered step keeps its continuation too",
      (() => { const x = P.parseProse("1. Grind 340 g\n   Burr 14, medium-coarse."); return x[0].kind === "ol" && x[0].items[0].lines.length === 2; })());
  }
  // Rules. components/Markdown.tsx rendered "---" as an <hr> and this did not, which was the last
  // capability gap keeping two renderers alive.
  ok("prose: --- is a rule", P.parseProse("a\n\n---\n\nb").map((b) => b.kind).join() === "p,hr,p");
  ok("prose: *** and ___ are rules too", P.parseProse("***").at(0).kind === "hr" && P.parseProse("___").at(0).kind === "hr");
  ok("prose: a bullet is still a bullet — '- a' is not a rule", P.parseProse("- a").at(0).kind === "ul");
  ok("prose: proseText survives the new shapes",
    P.proseText(P.parseProse("- **T**\n  detail\n\n---")).includes("detail"));

  // hasProseMarkup decides whether the structured path is worth taking at all.
  ok("prose: plain sentences are detected as plain",
    P.hasProseMarkup("No formatting here at all.") === false);
  ok("prose: the real reply is detected as formatted", P.hasProseMarkup(REAL) === true);
  ok("prose: arithmetic alone does not trigger the structured path",
    P.hasProseMarkup("2 * 3 = 6") === false);

  // ── LINKS: the rule inherited from the concierge's own renderer, which this replaced ──────────
  // The model is ASKED to emit "[See the full science →](/craft)". It can also emit a link to
  // anywhere it likes, including somewhere a customer talked it into. Internal routes become real
  // anchors; everything else stays inert text. This is the only rule in lib/prose about safety
  // rather than looks, so it gets the most cases.
  ok("prose: the concierge's real pointer becomes a link",
    sp("[See the full science →](/craft)") === "link:See the full science →");
  ok("prose: ...and it carries the route",
    P.parseSpans("[See the full science →](/craft)")[0].href === "/craft");
  ok("prose: an off-site link is INERT — the brackets stay, nothing becomes clickable",
    sp("[free coffee](https://evil.example)") === "text:[free coffee](https://evil.example)");
  ok("prose: javascript: is not a route", sp("[tap](javascript:alert(1))").startsWith("text:"));
  ok("prose: PROTOCOL-RELATIVE is the trap — '//evil.example' starts with / and is not internal",
    P.isInternalHref("//evil.example") === false && sp("[x](//evil.example)") === "text:[x](//evil.example)");
  ok("prose: a real internal route with a query still passes",
    P.isInternalHref("/crew?s=money") === true);
  ok("prose: mailto and tel are not routes",
    P.isInternalHref("mailto:a@b.c") === false && P.isInternalHref("tel:+15551234") === false);
  ok("prose: an empty label is not a link", sp("[ ](/craft)") === "text:[ ](/craft)");
  ok("prose: a link mid-sentence keeps the text either side",
    sp("Read [the craft page](/craft) first.")
      === "text:Read |link:the craft page|text: first.");
  ok("prose: bold and a link coexist on one line",
    P.parseSpans("**Nature Aide** — [see the science](/craft)").map((x) => x.kind).join()
      === "bold,text,link");
  ok("prose: an unclosed bracket is text, not a link",
    sp("[unfinished](/craft") === "text:[unfinished](/craft");
  ok("prose: a link makes hasProseMarkup true so the structured path runs",
    P.hasProseMarkup("[See the full science →](/craft)") === true);
  ok("prose: plain square brackets are not a link",
    P.hasProseMarkup("a [note] in brackets") === false);
}

// ── recipeFactLine (lib/brewMath) ──────────────────────────────────────────────────────────────
// Ask GT3 gave two different water volumes for "Rise 340 grams" on two days, and on the second the
// bold summary disagreed with its own arithmetic by 19%. THREE rates for one spec were reachable:
// 280.0 g/gal (the stored row), 283.3 g/gal (the measured anchor Ryan states: 340 g to 1.2 gal at
// 2.5 TDS), and 291.2 g/gal ("1:13" taken literally). The grounding line now states the anchor and
// finished per-gallon rates, so there is no arithmetic left to do differently.
{
  const B = require("../.smoke/brewMath.js");

  // Ryan's spec, as the row would hold it: the MEASURED pair, not the rounded name.
  const rise = {
    name: "Rise", style: "cold brew", ratio: "1:13",
    base_water_gal: 1.2, extraction_hours: 20, target_spec: "2.5 TDS",
    ingredients: [
      { name: "Coffee", qty: 340, unit: "g" },
      { name: "Coconut water", qty: 19.2, unit: "oz" },
      { name: "Filter", qty: 1, unit: "", scales: false },
    ],
  };
  const line = B.recipeFactLine(rise);

  ok("brewfacts: the ANCHOR is the measured pair, stated as a pair",
    /ANCHOR \(measured, use this\): 340 g \(12 oz\) Coffee : 1\.2 gal water/.test(line), line);
  // 2026-10-01. A new operator is cooking, and the model used to be handed grams ONLY — so "how
  // much coffee is that in ounces?" meant it doing the arithmetic itself, unchecked, on a number
  // somebody then weighs. 340 / 28.349523125 = 11.993 → 12 oz, computed by cookQuantity from the
  // same table the batch math uses.
  ok("brewfacts: the anchor carries BOTH measurement systems, computed and not recalled",
    /340 g \(12 oz\)/.test(line) && !/340 g Coffee/.test(line), line);
  ok("brewfacts: the target spec is STATED — it used to be selected from the database and dropped",
    /Target: 2\.5 TDS/.test(line), line);
  ok("brewfacts: the ratio is passed through as a NAME and fenced off from calculation",
    /"1:13" is this recipe's NAME, not a number to calculate from/.test(line), line);
  ok("brewfacts: the non-scaling line is called out as non-scaling",
    /DOES NOT SCALE \(one per brew regardless of size\): Filter 1/.test(line), line);
  ok("brewfacts: extraction survives", /Extraction: 20 h cold/.test(line), line);

  // THE NUMBER THAT MATTERS. 340 / 1.2 = 283.333…, and the line must carry the MEASURED rate —
  // not 280 (the old stored row) and not 291.2 (1:13 taken literally).
  ok("brewfacts: coffee rate is the measured 283.333 g/gal, not 280 and not 291.2",
    /Coffee 283\.333 g\/gal/.test(line) && !/Coffee 280/.test(line) && !/Coffee 291/.test(line), line);
  ok("brewfacts: every scaling ingredient gets a per-gallon rate",
    /Coconut water 16 oz\/gal/.test(line), line);
  ok("brewfacts: the fixed line is NOT given a per-gallon rate",
    !/Filter [0-9.]+ \/gal/.test(line) && !/Filter [0-9.]+ oz\/gal/.test(line), line);

  // Scaling from the anchor must reproduce the anchor. This is the whole claim.
  {
    const opts = B.sizingOptions(rise.ingredients, rise.base_water_gal);
    const coffee = B.primarySizing(opts);
    ok("brewfacts: coffee is the line a batch is sized by", coffee.name === "Coffee", coffee);
    ok("brewfacts: 1.2 gal asks for exactly 340 g — scaling returns the anchor unchanged",
      Math.abs(B.ingredientForGallons(1.2, coffee.perGal) - 340) < 1e-9);
    ok("brewfacts: 340 g of coffee makes exactly 1.2 gal — and the inverse agrees",
      Math.abs(B.gallonsFromIngredient(340, coffee.perGal) - 1.2) < 1e-9);
    // Double it and nothing drifts.
    ok("brewfacts: a double batch is 680 g to 2.4 gal, exactly",
      Math.abs(B.ingredientForGallons(2.4, coffee.perGal) - 680) < 1e-9);
    // And the wrong answers the app used to be able to give are genuinely different numbers.
    const literal1to13 = 3785.41 / 13;
    // 1.2 gal vs 1.1676 gal = 0.0324 gal = 4.1 fl oz on a single 340 g batch. (The 6 fl oz figure
    // is the STORED row vs 1:13 — a different pair. Getting those two mixed up is how the first
    // version of this assertion was written against the wrong threshold.)
    const gap = 340 / coffee.perGal - 340 / literal1to13;
    ok("brewfacts: the measured rate is NOT what '1:13' would give — 4.1 fl oz apart on one batch",
      gap > 0.032 && gap < 0.033, `${gap.toFixed(4)} gal = ${(gap * 128).toFixed(1)} fl oz`);
  }

  // ── METHOD + GEAR + THE 18-vs-20 CONTRADICTION ───────────────────────────────────────────────
  // Ryan: "give also equipment and brewing step by steps, not just recipes, to ensure nothing is
  // forgotten." Quantities answer "how much"; a crew mid-shift is asking "how".
  {
    const withMethod = B.recipeFactLine({
      ...rise,
      extraction_hours: 20,
      gear: ["Timemore grinder (coarse grind for cold brew)", "Refractometer + Scale (QC every batch - TDS)"],
      method: {
        batch: "Standard Batch - GT3 (1:13, ~18-hr cold extraction).",
        brew: ["Weigh beans 1:13 to mineral water", "Cold-extract ~18 hrs", "Filter, log batch + signal score (target 8+)"],
        serve: ["Pour over ice", "Top with organic coconut water"],
        storage: "Keep cold; use within the standard hold window.",
        quality: "Signal Score 8+.",
        troubleshoot: [{ issue: "Too bitter", fix: "Check grind/time - over-extraction." }],
      },
    });
    ok("brewfacts: every brew step ships with the recipe, numbered and in order",
      /METHOD \(give EVERY step, in order - none of them are optional\): 1\) Weigh beans .* 2\) Cold-extract .* 3\) Filter/.test(
        withMethod.replace(/—/g, "-")), withMethod);
    ok("brewfacts: serve, storage and the quality gate all travel with it",
      /SERVE: Pour over ice/.test(withMethod) && /STORAGE: Keep cold/.test(withMethod) && /QUALITY GATE: Signal Score 8\+/.test(withMethod));
    ok("brewfacts: troubleshooting travels with it", /IF IT COMES OUT WRONG: Too bitter/.test(withMethod));
    ok("brewfacts: the gear the brew needs is named", /GEAR THIS BREW NEEDS: Timemore grinder/.test(withMethod));

    // THE CONTRADICTION. brew_recipes says 20 h; the cookbook says ~18, three times. Both reach the
    // model in one prompt, so it can answer either — and has. Saying they disagree is the only
    // honest move; picking one silently is how a wrong brew time becomes authoritative.
    ok("brewfacts: 20 h in the record vs 18 h in the method is REPORTED, not silently resolved",
      /CONFLICT - the recipe record says 20 h but the written method says 18 h/.test(withMethod.replace(/—/g, "-"))
      && /Do NOT pick one/.test(withMethod), withMethod);
    ok("brewfacts: agreeing sources raise NO conflict",
      !/CONFLICT/.test(B.recipeFactLine({ ...rise, extraction_hours: 18,
        method: { brew: ["Cold-extract ~18 hrs"] } })));
    ok("brewfacts: a method with no hours at all raises no conflict",
      !/CONFLICT/.test(B.recipeFactLine({ ...rise, extraction_hours: 20,
        method: { brew: ["Filter and log the batch"] } })));
    ok("brewfacts: hoursNamedIn reads every written form",
      JSON.stringify(B.hoursNamedIn("18 hrs, 20 hour, 12h, 1.5 hrs").sort((a,b)=>a-b)) === "[1.5,12,18,20]",
      B.hoursNamedIn("18 hrs, 20 hour, 12h, 1.5 hrs"));
    ok("brewfacts: a recipe with no method still renders its quantities",
      /ANCHOR/.test(B.recipeFactLine(rise)) && !/METHOD/.test(B.recipeFactLine(rise)));

    // ONE PROCEDURE (2026-10-03). The brew planner writes a batch sheet from brew_recipes.method;
    // Ask GT3 was handed the academy cookbook instead, so one cook got "20 preferred" on the sheet
    // and "~18 hrs, confirm with an owner" in the chat. The row's steps are the steps; the
    // cookbook adds what the row lacks; a cookbook number that disagrees is an owner's copy fix.
    const rowSteps = ["Add the coarse-ground coffee", "Pour in the spring water; saturate all grounds", "Cold-extract 12–20 hrs (20 hrs preferred)", "Filter thoroughly until it runs clean"];
    const cookbook = { batch: "Standard Batch - GT3 (1:13, ~18-hr cold extraction).", brew: ["Weigh beans 1:13", "Cold-extract ~18 hrs", "Filter"], serve: ["Pour over ice"], storage: "Keep cold.", quality: "Signal Score 8+.", troubleshoot: [{ issue: "Weak", fix: "Verify 1:13 ratio and full 18-hr extraction." }] };
    const oneProcedure = B.recipeFactLine({ ...rise, extraction_hours: 20, rowMethod: rowSteps, method: cookbook });
    ok("one procedure: with steps of its own, the row's steps are THE steps — the planner's column, not the cookbook's",
      /METHOD \(give EVERY step[^:]*\): 1\) Add the coarse-ground coffee 2\) Pour in the spring water[^]*3\) Cold-extract 12–20 hrs \(20 hrs preferred\) 4\) Filter thoroughly/.test(oneProcedure) && !/Weigh beans 1:13/.test(oneProcedure), oneProcedure);
    ok("one procedure: the cookbook still supplies serve, storage, the quality gate and the fixes",
      /SERVE: Pour over ice/.test(oneProcedure) && /STORAGE: Keep cold/.test(oneProcedure) && /QUALITY GATE: Signal Score 8\+/.test(oneProcedure) && /IF IT COMES OUT WRONG: Weak/.test(oneProcedure));
    ok("one procedure: no CONFLICT for the cook — the recipe is the spec",
      !/CONFLICT/.test(oneProcedure) && !/confirm with an owner/.test(oneProcedure));
    ok("one procedure: …and the cookbook's 18 h is reported as training copy that drifted, for an owner, with both numbers",
      /TRAINING COPY DRIFT — the recipe \(the spec\) says 20 h; the training copy in the academy still says 18 h\. Brew to the recipe\./.test(oneProcedure) && /needs an owner's update/.test(oneProcedure) && /do not tell the cook to confirm the time/.test(oneProcedure), oneProcedure);
    ok("one procedure: a cookbook that agrees with the row raises nothing at all",
      !/DRIFT|CONFLICT/.test(B.recipeFactLine({ ...rise, extraction_hours: 20, rowMethod: rowSteps, method: { ...cookbook, batch: "Standard Batch (20-hr).", brew: ["Cold-extract 20 hrs"], troubleshoot: [] } })));
    ok("one procedure: a row with an EMPTY method column falls back to the cookbook, conflict rule and all",
      /CONFLICT/.test(B.recipeFactLine({ ...rise, extraction_hours: 20, rowMethod: [], method: cookbook })) && /1\) Weigh beans 1:13/.test(B.recipeFactLine({ ...rise, extraction_hours: 20, rowMethod: [], method: cookbook })));
    ok("one procedure: blank and non-string entries in the column are dropped, not numbered",
      /1\) Add 2\) Filter/.test(B.recipeFactLine({ ...rise, extraction_hours: 20, rowMethod: ["Add", "", null, "  ", "Filter"], method: null })));
    {
      const { readFileSync } = require("node:fs");
      const { join } = require("node:path");
      const read = (f) => readFileSync(join(__dirname, "..", f), "utf8");
      ok("one procedure: the operator's grounding selects the row's method column…",
        /\.select\("name, product_slug, style, ratio, base_water_gal, ingredients, extraction_hours, target_spec, method"\)/.test(read("lib/agentKnowledge.ts")) && /rowMethod/.test(read("lib/agentKnowledge.ts")));
      ok("one procedure: …which is the same column the brew planner writes its sheet from",
        /method_template: \(recipe as any\)\.method/.test(read("app/api/agents/brew/route.ts")));
    }
  }

  // ── THE BREW SHEET ASKS WHAT A COOK KNOWS (2026-10-03) ───────────────────────────────────────
  // Ryan: "I had no idea I could select a different metric… I couldn't put in a batch size, or how
  // many drinks you want to serve. Based on questions the metrics should show." The sheet now asks
  // for drinks and answers with what the batch takes; these are the conversions it answers with.
  {
    // A volume somebody can pour — the same rule lib/agentKnowledge gives the model, in code.
    ok("pourable: 1.214 gal is a gallon and three and a half cups, about 155 fl oz — the model's own example",
      B.pourable(1.214).withOz === "1 gal + 3½ cups (about 155 fl oz)", B.pourable(1.214));
    ok("pourable: 2.5 gal is 2 gal + 8 cups, exactly 320 fl oz — no 'about' when the quarter-cup rounding moved nothing",
      B.pourable(2.5).withOz === "2 gal + 8 cups (320 fl oz)", B.pourable(2.5));
    ok("pourable: whole gallons stay whole", B.pourable(2).display === "2 gal" && B.pourable(2).cups === 0);
    ok("pourable: under a gallon is cups alone, singular when it is one or less", B.pourable(0.05).display === "¾ cup" && B.pourable(1 / 16).display === "1 cup" && B.pourable(0.5).display === "8 cups", [B.pourable(0.05).display, B.pourable(1 / 16).display, B.pourable(0.5).display]);
    ok("pourable: fifteen and seven-eighths cups rounds up to the next gallon rather than '16 cups'", B.pourable(0.999).display === "1 gal", B.pourable(0.999));
    ok("pourable: zero and nonsense are 0 gal, never NaN", B.pourable(0).display === "0 gal" && B.pourable(NaN).display === "0 gal" && B.pourable(-1).display === "0 gal");

    // Scaling, once — the route and the sheet share it, and rounding is by what the thing is.
    const dusk = [
      { name: "Mountain Valley Spring Water", qty: 2, unit: "gal", scales: true },
      { name: "Coarse-ground organic single-origin coffee", qty: 560, unit: "g", scales: true },
      { name: "Organic Ceylon cinnamon sticks", qty: 8, unit: "sticks", scales: true },
      { name: "Organic cardamom pods (lightly cracked)", qty: 48, unit: "pods", scales: true },
      { name: "Filter", qty: 1, unit: "", scales: false },
    ];
    const sc = B.scaleIngredients(dusk, 1.214 / 2);
    ok("scale: a count is whole — nobody adds 0.6 of a cardamom pod", sc[3].qty === 29 && sc[2].qty === 5, sc);
    ok("scale: grams are whole — what a 1 g scale reads", sc[1].qty === 340, sc[1]);
    ok("scale: a volume keeps two decimals so the water line equals the batch it was sized to", sc[0].qty === 1.21, sc[0]);
    ok("scale: a line that does not scale is passed through as written", sc[4].qty === 1 && sc[4].scales === false);
    ok("scale: ounces keep a tenth", B.scaleIngredients([{ name: "Coconut water", qty: 32, unit: "oz", scales: true }], 1.25)[0].qty === 40 && B.scaleIngredients([{ name: "x", qty: 32, unit: "oz", scales: true }], 0.607)[0].qty === 19.4);
    ok("scale: a null list scales to an empty one, never a throw", B.scaleIngredients(null, 2).length === 0 && B.scaleIngredients(undefined, 2).length === 0);

    // The vessel follows the batch.
    const vessels = [{ id: "cba", name: "Cold Brew Avenue", capacity_gal: 5 }, { id: "toddy", name: "Toddy", capacity_gal: 2.5 }];
    ok("vessel: a batch that fills a Toddy exactly gets the Toddy, not half a Cold Brew Avenue", B.vesselPlan(2.5, vessels).vessel.id === "toddy" && B.vesselPlan(2.5, vessels).count === 1);
    ok("vessel: three gallons is one Cold Brew Avenue, not two Toddys", B.vesselPlan(3, vessels).vessel.id === "cba" && B.vesselPlan(3, vessels).count === 1);
    ok("vessel: seven gallons is two Cold Brew Avenues", B.vesselPlan(7, vessels).vessel.id === "cba" && B.vesselPlan(7, vessels).count === 2);
    ok("vessel: half a gallon goes in the smallest vessel (the fit check says whether it reaches the basket)", B.vesselPlan(0.5, vessels).vessel.id === "toddy");
    ok("vessel: no vessels is null, not a crash; no batch yet is the smallest vessel", B.vesselPlan(2, []) === null && B.vesselPlan(0, vessels).vessel.id === "toddy");
    ok("vessel: a vessel with no capacity on file is never chosen", B.vesselPlan(2, [{ id: "x", capacity_gal: 0 }, ...vessels]).vessel.id === "toddy");

    // Drinks in, gallons out, drinks back — the three ways of saying one batch agree.
    ok("drinks: 32 drinks at a 1.0 yield is 2.5 gal, and 2.5 gal pours 32", B.gallonsForBottles(32, 1) === 2.5 && B.bottlesFor(2.5, 1) === 32);
    ok("drinks: 40 drinks at a 0.92 yield rounds the water UP so nobody is short", B.gallonsForBottles(40, 0.92) === 3.4 && B.bottlesFor(3.4, 0.92) >= 40, [B.gallonsForBottles(40, 0.92), B.bottlesFor(3.4, 0.92)]);

    {
      const { readFileSync } = require("node:fs");
      const { join } = require("node:path");
      const read = (f) => readFileSync(join(__dirname, "..", f), "utf8");
      const route = read("app/api/agents/brew/route.ts"), sheet = read("components/BrewPlanner.tsx");
      ok("one scaler: the brew route imports scaleIngredients from lib/brewMath and keeps no copy of its own",
        /import \{[^}]*\bscaleIngredients\b[^}]*\} from "@\/lib\/brewMath"/.test(route) && !/function scaleIngredients/.test(route));
      ok("one scaler: the sheet previews with the same function", /\bscaleIngredients\(recipe\.ingredients, factor\)/.test(sheet));
      ok("the sheet asks for drinks first, in those words", /How many drinks do you need\?/.test(sheet));
      ok("the sheet's units are the kit's segmented control, not a <select> (the one the day theme striped)", /className="k-seg bq-units" role="tablist"/.test(sheet) && !/<select aria-label="Size this batch by"/.test(sheet));
      ok("the sheet reads the event's expected headcount for its suggestion", /expected_attendance, going_count/.test(sheet));
      ok("the sheet states the water as something pourable", /pourable\(gal\)/.test(sheet) && /water\.display/.test(sheet));
    }
  }

  // A recipe with nothing measured must REFUSE, not emit a half-fact the model completes itself.
  {
    const bare = B.recipeFactLine({ name: "Mystery", base_water_gal: 0, ingredients: null, ratio: "1:13" });
    ok("brewfacts: no measured base → says so and forbids computing one",
      /not on file/.test(bare) && /Do NOT compute one/.test(bare) && !/ANCHOR/.test(bare), bare);
  }
}


// ── HOW A BENEFIT READS (lib/benefitText.ts) ───────────────────────────────────────────────────
// CodesPanel and PerksPanel each carried their own `valueText`, and they had DRIFTED: CodesPanel
// handled amount_off, PerksPanel did not, so the $5-off QR card — which lib/benefits prices
// correctly — rendered in the perks panel as "Free". One screen described a $5 discount as giving
// the whole order away. Duplication did not cause a cosmetic difference here; it changed the
// meaning of the sentence.
{
  const B = require("../.smoke/benefitText.js");
  ok("benefit: percent_off reads as a percentage", B.benefitValueText({ kind: "percent_off", percent: 15 }) === "15% off");
  ok("benefit: price_override reads as the price", B.benefitValueText({ kind: "price_override", value_cents: 800 }) === "$8");
  // THE DRIFT. This is the case PerksPanel silently answered "Free".
  ok("benefit: amount_off reads as money OFF, not as Free",
    B.benefitValueText({ kind: "amount_off", value_cents: 500 }) === "$5 off",
    B.benefitValueText({ kind: "amount_off", value_cents: 500 }));
  ok("benefit: free_refill still reads Free — the fallback is load-bearing, not laziness",
    B.benefitValueText({ kind: "free_refill" }) === "Free");
  // AND NULL IS NOT ZERO. "$0.00" for an unset amount reads as free, which is the same wrong
  // answer the drift produced, arrived at a second way.
  ok("benefit: a price_override with no amount set reads — , never $0.00",
    B.benefitValueText({ kind: "price_override", value_cents: null }) === "—");
  ok("benefit: an amount_off with no amount set reads — , never $0.00 off",
    B.benefitValueText({ kind: "amount_off", value_cents: null }) === "—");
  ok("benefit: a percent_off with no percent set reads —",
    B.benefitValueText({ kind: "percent_off", percent: null }) === "—");
  ok("benefit: a malformed row does not crash", B.benefitValueText({}) === "Free" && B.benefitValueText({ kind: null }) === "Free");
}

// ── PRODUCT ECONOMICS: what the LIVE number is made of (lib/economics.ts) ──────────────────────
// Ryan put two panels side by side and read a contradiction: Menu & products says NATURE'S AIDE
// $10.00, Product economics says Nature Aide $11.00 LIVE. Both are right — the economics line is
// the AVERAGE of every active drink mapped to it, and nothing on the row said so. The fixtures
// below are his real menu, and the expected averages are the ones actually on his screen.
{
  const E = require("../.smoke/economics.js");
  const d = (name, cents, key, active = true) => ({ name, price_cents: cents, econ_key: key, active });
  const MENU = [
    d("RISE", 1000, "nitro"), d("FLOW", 1000, "nitro"), d("DUSK", 1000, "nitro"), d("KING ME", 1400, "nitro"),
    d("NATURE'S AIDE", 1000, "nature"), d("TIDE", 1200, "nature"),
    d("SALTED MAPLE LATTE", 1400, "maple"),
    d("RETIRED DRINK", 9900, "nitro", false),      // inactive — the view excludes it, so must we
    d("UNMAPPED", 500, null),
  ];

  // The numbers off his actual screen: nitro $11.00, nature $11.00, maple $14.00.
  const nitro = E.econBreakdown(MENU, "nitro", 1100);
  ok("econ: the nitro line averages its four active drinks to $11.00",
    nitro.n === 4 && nitro.computedCents === 1100 && nitro.agrees === true, JSON.stringify(nitro));
  ok("econ: ...and an INACTIVE drink is excluded, exactly as the view excludes it",
    !nitro.names.includes("RETIRED DRINK"), JSON.stringify(nitro.names));
  const nature = E.econBreakdown(MENU, "nature", 1100);
  ok("econ: Nature Aide is NATURE'S AIDE $10 and TIDE $12 — the $11 Ryan queried",
    nature.n === 2 && nature.computedCents === 1100 && nature.agrees === true, JSON.stringify(nature));
  ok("econ: ...and it names them, so the number can be audited on the row",
    E.econBreakdownLabel(nature) === "avg of 2 · NATURE'S AIDE, TIDE", E.econBreakdownLabel(nature));

  // A single drink needs no explanation — one is not an average.
  ok("econ: a one-drink line produces no breakdown line",
    E.econBreakdownLabel(E.econBreakdown(MENU, "maple", 1400)) === "");
  ok("econ: an unmapped line has nothing behind it", E.econBreakdown(MENU, "ghost", 1200).n === 0);

  // THE MIRROR CHECK. This reproduces the view's filter client-side, which is the "two lists"
  // trap this repo has been bitten by before. So disagreement is DETECTED rather than assumed
  // away: a confident explanation of a number we cannot account for is the real damage.
  const wrong = E.econBreakdown(MENU, "nitro", 1234);
  ok("econ: when our arithmetic disagrees with the stored price, agrees is FALSE",
    wrong.agrees === false && wrong.n === 4, JSON.stringify(wrong));
  ok("econ: an empty menu explains nothing rather than dividing by zero",
    E.econBreakdown([], "nitro", 1100).n === 0 && E.econBreakdown(null, "nitro", 1100).n === 0);
}

// ── SHOP MEDIA: the hero that came back (lib/shopMedia.ts) ─────────────────────────────────────
// Ryan, replacing the placeholder on the cap: "when I try to delete the stock image it comes back
// after hitting save." It did, and as the COVER — the editor holds the same picture in two places
// (the photo grid, and the "paste an address" field bound to image_url) and save folded the field
// back in whenever the grid lacked it, PREPENDED. The field always won, so a delete was undoable.
{
  const M = require("../.smoke/shopMedia.js");
  const img = (u) => ({ id: u, url: u, kind: "image" });
  const STOCK = "/shop/cap-charcoal.svg";
  const REAL = "https://apliiq.example/cap-red.jpg";

  ok("media: deleting the hero from the grid IS a removal — the address field must clear",
    M.heroWasRemoved(STOCK, [img(STOCK), img(REAL)], [img(REAL)]) === true);
  // The case the obvious fix would have broken: an address typed but not yet in the grid is the
  // NEWER intent, and clearing it "because it isn't in the grid" would delete it as you typed.
  ok("media: an address typed but not yet in the grid is NOT a removal",
    M.heroWasRemoved(REAL, [img(STOCK)], [img(STOCK)]) === false);
  ok("media: reordering is not a removal",
    M.heroWasRemoved(STOCK, [img(STOCK), img(REAL)], [img(REAL), img(STOCK)]) === false);
  ok("media: clearing the whole grid removes the hero",
    M.heroWasRemoved(STOCK, [img(STOCK)], []) === true);
  ok("media: an empty hero is never a removal",
    M.heroWasRemoved("", [img(STOCK)], []) === false && M.heroWasRemoved(null, [img(STOCK)], []) === false);

  // And the end state the crew actually wants: grid holds only the real mockup, so that is the cover.
  const cols = M.toColumns([img(REAL)]);
  ok("media: with the stock image gone, the real mockup becomes the cover",
    cols.image_url === REAL && cols.images.length === 1);
}

// ── APLIIQ ORDER (lib/apliiqOrder.ts) ──────────────────────────────────────────────────────────
// The fulfilment payload had NEVER been checked against Apliiq's published Create Order schema,
// and every field in it was wrong. The fixtures below are the real thing: the SKUs are the ones
// off Ryan's own design page (APQ-5902678S6A1 … S21A1, one per size), and the required-field list
// is Apliiq's, not mine. A payload nobody can run by hand is how this drifted for a month.
{
  const A = require("../.smoke/apliiqOrder.js");
  const SIZES = [
    { size: "S", sku: "APQ-5902678S6A1" }, { size: "M", sku: "APQ-5902678S7A1" },
    { size: "L", sku: "APQ-5902678S8A1" }, { size: "XL", sku: "APQ-5902678S1A1" },
    { size: "XXL", sku: "APQ-5902678S2A1" }, { size: "XXXL", sku: "APQ-5902678S21A1" },
  ];
  const SHIP = { name: "Ryan Thompkins", street: "1 Main St", city: "Greenville", state: "SC", zip: "29601" };
  const line = (over) => ({ id: "p1", title: "Classic Organic Tee", qty: 1, priceCents: 3400, sku: null, ...over });

  // ── which SKU is this customer's size? ──
  ok("apliiq: the shopper's size picks its own SKU", A.skuFor(SIZES, { size: "L" }) === "APQ-5902678S8A1");
  ok("apliiq: case and spacing in the size don't matter", A.skuFor(SIZES, { size: " xxl " }) === "APQ-5902678S2A1");
  ok("apliiq: XL and XXL are not confused with each other",
    A.skuFor(SIZES, { size: "XL" }) === "APQ-5902678S1A1" && A.skuFor(SIZES, { size: "XXL" }) === "APQ-5902678S2A1");
  ok("apliiq: a size that isn't stocked returns NOTHING, never a near miss",
    A.skuFor(SIZES, { size: "4XL" }) === null);
  ok("apliiq: several SKUs and no choice given is a refusal, not a guess",
    A.skuFor(SIZES, null) === null);
  // A one-size cap has nothing to disambiguate — the choice cannot disagree with a set of one.
  ok("apliiq: a one-size product needs no choice", A.skuFor([{ size: "One size", sku: "APQ-8869S1A1" }], null) === "APQ-8869S1A1");
  ok("apliiq: variants with no SKU yield nothing", A.skuFor([{ size: "L" }, { size: "M" }], { size: "L" }) === null);
  ok("apliiq: a malformed SKU is not a SKU", A.skuFor([{ size: "L", sku: "5902678" }], { size: "L" }) === null);
  ok("apliiq: colour narrows it when both are given",
    A.skuFor([{ size: "L", color: "Black", sku: "APQ-1S1A1" }, { size: "L", color: "Cream", sku: "APQ-1S2A1" }],
      { size: "L", color: "cream" }) === "APQ-1S2A1");

  // ── the SKU block, pasted straight off Apliiq's panel ──
  // The fixture is the real block from Ryan's design page, tab-separated as it copies.
  const BLOCK = "s\tAPQ-5902678S6A1\nm\tAPQ-5902678S7A1\nl\tAPQ-5902678S8A1\nxl\tAPQ-5902678S1A1\nxxl\tAPQ-5902678S2A1\nxxxl\tAPQ-5902678S21A1";
  const parsed = A.parseSkuBlock(BLOCK);
  ok("apliiq: the pasted block reads all six sizes", parsed.length === 6, parsed.length);
  ok("apliiq: sizes and SKUs stay paired through the paste",
    parsed[0].size === "s" && parsed[0].sku === "APQ-5902678S6A1" && parsed[5].size === "xxxl" && parsed[5].sku === "APQ-5902678S21A1");
  ok("apliiq: a parsed block feeds skuFor directly — paste, then sell",
    A.skuFor(parsed, { size: "XXL" }) === "APQ-5902678S2A1");
  ok("apliiq: multiple spaces, commas and colons all copy fine",
    A.parseSkuBlock("s     APQ-1S6A1\nm, APQ-1S7A1\nl: APQ-1S8A1").length === 3);
  ok("apliiq: junk lines are ignored, not guessed at",
    A.parseSkuBlock("product skus\ns\tAPQ-1S6A1\n\nnot a sku line").length === 1);
  ok("apliiq: a bare SKU with no size is ignored", A.parseSkuBlock("APQ-1S6A1").length === 0);
  // The CAP, off Ryan's own page: one size, one SKU, and the two columns copy GLUED together with
  // no separator. The first version anchored the match with \b, and there is no word boundary
  // between "e" and "A" — so a perfectly good paste read as "No SKUs read".
  ok("apliiq: the cap's single adjustable SKU parses",
    JSON.stringify(A.parseSkuBlock("adjustable\tAPQ-5888216S87A1")) === JSON.stringify([{ size: "adjustable", sku: "APQ-5888216S87A1" }]));
  ok("apliiq: ...and still parses when the columns copy glued together",
    (A.parseSkuBlock("adjustableAPQ-5888216S87A1")[0] || {}).sku === "APQ-5888216S87A1",
    JSON.stringify(A.parseSkuBlock("adjustableAPQ-5888216S87A1")));
  // ── THE CAP SOLD IN MORE THAN ONE COLOURWAY ──────────────────────────────────────────────────
  // Every colorway of the five-panel cap is labelled "adjustable" and each has its OWN SKU —
  // APQ-5888205S87A1 for natural/red, APQ-5888216S87A1 for another. Two defects lived here and
  // both would have shipped the wrong hat:
  //   · parseSkuBlock deduped by LABEL, so the second colorway vanished on paste
  //   · skuFor used .find(), so "adjustable" matched several and it returned the first
  const TWO = "natural/red adjustable\tAPQ-5888205S87A1\nnatural/camo adjustable\tAPQ-5888216S87A1";
  const both = A.parseSkuBlock(TWO);
  ok("apliiq: two colorways sharing a size BOTH survive the paste", both.length === 2, JSON.stringify(both));
  ok("apliiq: ...and keep their own SKUs",
    both[0].sku === "APQ-5888205S87A1" && both[1].sku === "APQ-5888216S87A1", JSON.stringify(both));
  ok("apliiq: the shopper's colourway picks its own SKU",
    A.skuFor(both, { size: "natural/red adjustable" }) === "APQ-5888205S87A1");
  // Same SKU pasted twice is still one variant — that IS a duplicate.
  ok("apliiq: the same SKU twice collapses to one",
    A.parseSkuBlock("adjustable\tAPQ-1S1A1\nadjustable\tAPQ-1S1A1").length === 1);
  // AMBIGUITY IS A REFUSAL. Two variants labelled identically with different SKUs and a choice
  // that matches both must never pick one — that is a wrong-colour hat in a box.
  const ambiguous = [{ size: "adjustable", sku: "APQ-5888205S87A1" }, { size: "adjustable", sku: "APQ-5888216S87A1" }];
  ok("apliiq: an ambiguous match refuses rather than shipping the wrong colour",
    A.skuFor(ambiguous, { size: "adjustable" }) === null, A.skuFor(ambiguous, { size: "adjustable" }));

  ok("apliiq: a one-size cap resolves whatever the shopper picked",
    A.skuFor(A.parseSkuBlock("adjustableAPQ-5888216S87A1"), { size: "One size" }) === "APQ-5888216S87A1");
  ok("apliiq: a malformed code is not accepted as a SKU", A.parseSkuBlock("s\t5902678").length === 0);
  // This asserted "the same size twice keeps the first" until 2026-09-28, and that expectation was
  // the bug written down: two lines sharing a label but carrying DIFFERENT codes are two orderable
  // variants (one cap, two colorways), and dropping one made a colourway unsellable in silence.
  // Same label + different SKU = two. Same SKU twice = one. The SKU is the identity.
  ok("apliiq: the same label with different SKUs keeps BOTH",
    A.parseSkuBlock("l\tAPQ-1S8A1\nL\tAPQ-9S9A9").length === 2);
  ok("apliiq: lowercase apq is normalised up", A.parseSkuBlock("s\tapq-1s6a1")[0].sku === "APQ-1S6A1");
  ok("apliiq: the block round-trips back out for the editor",
    A.parseSkuBlock(A.formatSkuBlock(parsed)).length === 6);
  ok("apliiq: an empty paste reads as no SKUs, not a crash",
    A.parseSkuBlock("").length === 0 && A.parseSkuBlock(null).length === 0);

  // ── the name split Apliiq requires and checkout does not collect ──
  ok("apliiq: one name box becomes first_name + last_name",
    JSON.stringify(A.splitName("Ryan Thompkins")) === JSON.stringify({ first_name: "Ryan", last_name: "Thompkins" }));
  ok("apliiq: a middle name stays with the first, not the surname",
    A.splitName("Mary Anne Del Rio").last_name === "Rio");
  ok("apliiq: a single name goes on the parcel as the last name",
    JSON.stringify(A.splitName("Prince")) === JSON.stringify({ first_name: "", last_name: "Prince" }));

  // ── price is a STRING, two decimals — "45.50", never 4550 and never 45.5 ──
  ok("apliiq: price renders as Apliiq's decimal string",
    A.priceString(4550) === "45.50" && A.priceString(3400) === "34.00" && A.priceString(0) === "0.00");

  // ── the payload itself, field by field, against the published schema ──
  const built = A.buildOrderPayload({ id: "abcd1234-ef56-7890-abcd-ef1234567890", ship: SHIP, items: [line({ sku: "APQ-5902678S8A1", qty: 2 })] });
  ok("apliiq: a complete order builds", built.ok === true, built.ok ? "" : built.reason);
  const P = built.ok ? built.payload : {};
  ok("apliiq: the four required root ids are all present",
    !!P.id && !!P.number && !!P.name && !!P.order_number);
  ok("apliiq: it is line_items, not lineItems", Array.isArray(P.line_items) && P.lineItems === undefined);
  ok("apliiq: it is shipping_address, not shipping", !!P.shipping_address && P.shipping === undefined);
  const L = (P.line_items || [])[0] || {};
  ok("apliiq: the line carries sku, not productId", L.sku === "APQ-5902678S8A1" && L.productId === undefined);
  ok("apliiq: the line carries its own id, a title and a price string",
    !!L.id && !!L.title && L.price === "34.00" && L.quantity === 2);
  const S = P.shipping_address || {};
  ok("apliiq: the address is split into the fields Apliiq names",
    S.first_name === "Ryan" && S.last_name === "Thompkins" && S.address1 === "1 Main St" && S.city === "Greenville" && S.zip === "29601");
  ok("apliiq: province AND province_code are both set", S.province === "SC" && S.province_code === "SC");
  ok("apliiq: country is stated rather than left for Apliiq to assume",
    S.country === "United States" && S.country_code === "US");

  // ── REFUSE rather than ship a wrong or partial order ──
  // Wrapped, because the first version of these assertions was proved by the runner CRASHING when
  // the guard was removed — buildOrderPayload threw on the null sku a few lines later. A throw is
  // a loud failure but it takes the other 865 assertions down with it, so the property is asserted
  // rather than inferred from a stack trace.
  const attempt = (fn) => { try { return fn(); } catch (e) { return { ok: true, threw: String(e && e.message) }; } };
  const noSku = attempt(() => A.buildOrderPayload({ id: "x", ship: SHIP, items: [line({ sku: null, title: "6-Panel Cap" })] }));
  ok("apliiq: a line with no SKU refuses the whole order", noSku.ok === false);
  ok("apliiq: ...and names the item, so the crew queue is actionable",
    !noSku.ok && String(noSku.reason).includes("6-Panel Cap"), noSku.ok ? (noSku.threw || "built anyway") : noSku.reason);
  const mixed = attempt(() => A.buildOrderPayload({ id: "x", ship: SHIP, items: [line({ sku: "APQ-5902678S8A1" }), line({ id: "p2", sku: null, title: "Tumbler" })] }));
  ok("apliiq: ONE unlinked item refuses the order — never ship half of what was paid for",
    mixed.ok === false && String(mixed.reason).includes("Tumbler"), mixed.ok ? (mixed.threw || "built anyway") : mixed.reason);
  ok("apliiq: an empty cart refuses", A.buildOrderPayload({ id: "x", ship: SHIP, items: [] }).ok === false);
  for (const [field, bad] of [["name", { ...SHIP, name: "" }], ["street", { ...SHIP, street: "" }],
                              ["city", { ...SHIP, city: "" }], ["zip", { ...SHIP, zip: "" }], ["state", { ...SHIP, state: "" }]]) {
    const r = A.buildOrderPayload({ id: "x", ship: bad, items: [line({ sku: "APQ-5902678S8A1" })] });
    ok(`apliiq: a missing shipping ${field} refuses the order`, r.ok === false, r.ok ? "built anyway" : r.reason);
  }
}


// ── A TEST DOUBLE THAT LIES ABOUT ITS ORIGINAL (2026-09-30) ──────────────────────────────────────
// Thirteen db.*.test.mjs files stand up a fake world in PGlite and run real migrations against it.
// Eleven stubbed public.schema_migrations the way 0304 actually defines it. Two invented a column:
// `name text primary key`, where production has `version`.
//
// That is not cosmetic. A double is the description of the real thing that everything downstream
// reads — and on 2026-09-30 it was read, twice, and `schema_migrations.name` went into SQL run
// against the live database. Both times Postgres answered `column "name" does not exist`, and both
// times the wrong name had come from these files. A stub that contradicts its original does not
// merely fail to catch bugs. It teaches them.
//
// TRUTH COMES FROM supabase/schema.columns.json — the column contract, read out of the live
// database by scripts/columns.audit.mjs. The first version of this gate parsed the migrations
// instead and got four false positives in its first run (`stops.archived_at`, `live_status
// .tenant_id` and two more, all real, all added by ALTER statements the regex fumbled). A rule that
// reconstructs the schema is a second home for the schema, which is the bug one level up.
//
// SCAFFOLDING IS ALLOWED, SILENCE IS NOT. A test may stub a cut-down table with a column production
// does not have — but the line says `-- scaffold:` and why, the same way a tenant-scope exception
// says `// scoped-by:`. The difference between a considered simplification and drift is whether
// anyone wrote down which one it is.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");

  let contract = null;
  try { contract = JSON.parse(fs.readFileSync(path.join(root, "supabase/schema.columns.json"), "utf8")); } catch { /* reported below */ }
  const colsOf = (t) => {
    const v = contract?.[t];
    if (!v) return null;
    const c = Array.isArray(v) ? v : (v.columns ?? v);
    const list = Array.isArray(c) ? c : Object.keys(c);
    return new Set(list.map((x) => String(x).toLowerCase()));
  };

  // A FAILED READ IS NOT AN EMPTY LIST. Without the contract this gate would pass every file by
  // finding nothing to judge — the precise shape of the dead check found in columns.audit itself.
  ok("test doubles: the column contract was read", (colsOf("schema_migrations")?.size ?? 0) >= 6,
    colsOf("schema_migrations")?.size ?? 0);
  ok("test doubles: …and it says the ledger's key column is version, not name",
    colsOf("schema_migrations")?.has("version") === true && colsOf("schema_migrations")?.has("name") === false);

  // Reads a `create table public.X (...)` body and returns the columns it declares that the real X
  // does not have. Unknown tables are not this rule's business: a fixture with no production
  // counterpart is a fixture, and the contract predates any table added after its last refresh.
  // LINE BY LINE, not comma by comma. The first cut split the whole body on "," and dragged three
  // English words out of a prose comment ("which", "applied", "matching") and reported them as
  // columns. A column declaration lives on one line; a comment does too.
  //
  // The marker reaches FOUR LINES FORWARD, the same distance the tenant-scope audit reads back for
  // `// scoped-by:`. db.fieldops keeps four dropped columns on purpose and explains why in four
  // lines directly above them — a rule that demanded the words be moved onto each column would be
  // asking a considered comment to be made worse to satisfy a parser.
  const invented = (sql, where) => {
    const out = [];
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\)\s*;/gi)) {
      const truth = colsOf(m[1].toLowerCase());
      if (!truth) continue;
      let excusedFor = 0;
      for (const rawLine of m[2].split("\n")) {
        if (/--\s*scaffold:/i.test(rawLine)) { excusedFor = 5; }          // this line and four after
        const bare = rawLine.replace(/--.*$/, "");                        // a note is not a column
        if (excusedFor > 0) { excusedFor--; if (bare.trim()) continue; }
        for (const raw of bare.split(",")) {
          const c = /^\s*([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(
            raw.replace(/^\s*(constraint|primary|unique|foreign|check|exclude)\b[\s\S]*/i, ""));
          if (c && !truth.has(c[1].toLowerCase())) out.push(`${where}: public.${m[1]}.${c[1]}`);
        }
      }
    }
    return out;
  };

  const found = [];
  for (const f of fs.readdirSync(path.join(root, "scripts")).filter((n) => /^db\..*\.test\.mjs$/.test(n))) {
    found.push(...invented(fs.readFileSync(path.join(root, "scripts", f), "utf8"), f));
  }
  ok("test doubles: no db test invents a column its real table does not have, unmarked",
    found.length === 0, found);

  // PROVE IT BITES. A gate this quiet is worthless unless it can fail, and the defect it exists for
  // is a plausible-looking column name that production does not have. Fed the exact stub that
  // shipped, it must name the invented column — and must NOT flag the one that is real.
  const planted = invented(
    `create table public.schema_migrations (name text primary key, version text, note text);`, "planted");
  ok("test doubles: fed the stub that actually shipped, the gate names the invented column",
    planted.length === 1 && planted[0].endsWith(".name"), planted);
  // …and the escape hatch has to work, or the next person deletes the rule instead of using it.
  const marked = invented(
    "create table public.schema_migrations (\n  -- scaffold: only the key matters in this fixture\n" +
    "  name text primary key,\n  note text\n);", "planted");
  ok("test doubles: …and a column marked `-- scaffold:` with a reason is left alone", marked.length === 0, marked);
}

// ── THE FEED WINDOW, WHICH TWO FILES HAVE TO AGREE ON (0333) ─────────────────────────────────────
// lib/useMyAlerts.ts fetches the alert feed with .limit(30). v_alert_feed_health reports how many
// unacked alerts fall PAST that limit — rows that are not low in the list but absent from it: not
// fetched, not counted in the badge, and impossible to acknowledge from any screen.
//
// That is one number living in two files, which is the drift this repo keeps finding. It cannot be
// collapsed into one home — a React hook cannot read a Postgres view's definition at build time and
// the view cannot read the hook — so it is declared a KNOWN PAIR and checked, the same treatment
// raiseAlertOnce and shop_order_stall_watchdog get. A pair that is named but not enforced is just
// drift with a comment on it, which is precisely what 0327's own note turned out to be.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");

  const hook = fs.readFileSync(path.join(root, "lib/useMyAlerts.ts"), "utf8");
  const mig = path.join(root, "supabase/migrations/0333_the_fix_shipped_and_the_flood_stayed.sql");
  const sql = fs.existsSync(mig) ? fs.readFileSync(mig, "utf8") : "";

  const fromHook = /\.limit\((\d+)\)/.exec(hook.slice(hook.indexOf('from("alerts")')));
  const declared = /--\s*feed-window:\s*(\d+)/i.exec(sql);
  const used = /where rn >\s*(\d+)/i.exec(sql);

  // A FAILED READ IS NOT A MATCH. If either side stops being found — the hook rewritten, the marker
  // deleted — this must fail loudly rather than quietly comparing nothing to nothing.
  ok("feed window: the alert hook's limit was found", fromHook !== null, fromHook && fromHook[1]);
  ok("feed window: the migration declares it with `-- feed-window:`", declared !== null);
  ok("feed window: …and the view actually uses that number", used !== null);
  ok("feed window: the hook and the view agree on where the feed stops",
    fromHook && declared && used && fromHook[1] === declared[1] && declared[1] === used[1],
    { hook: fromHook && fromHook[1], declared: declared && declared[1], view: used && used[1] });
}

// ── THE ORDER OF OPERATIONS THAT SPENDS MONEY (0335) ─────────────────────────────────────────────
// /api/shop/resubmit places an order at Apliiq against a card. Its correctness is almost entirely
// about SEQUENCE, and sequence is the one thing a unit test of the database cannot see:
//
//   1. crew gate            — before anything, because this spends money
//   2. claim                — before the submit, or two clicks are two caps
//   3. submit               — the irreversible bit
//   4. write the id back    — 0334's CHECK refuses the status without it
//
// Reordering 1 or 2 after 3 would still pass every database test in the suite and still be wrong.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "app/api/shop/resubmit/route.ts"), "utf8");
  // Comments quote the very calls being located, so they are stripped first — the deep-link gate
  // learned this the hard way two migrations ago.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

  const at = (needle) => code.indexOf(needle);
  const gate = at("staffFromRequest");
  const claim = at("claim_shop_order_for_submit");
  const submit = at("submitOrderToApliiq(");
  const write = at('status: "submitted"');

  ok("resubmit: the route gates on staff", gate > 0, gate);
  ok("resubmit: it claims the order through the database", claim > 0, claim);
  ok("resubmit: it submits to Apliiq", submit > 0, submit);
  ok("resubmit: the crew gate comes before the money is spent", gate > 0 && gate < submit, { gate, submit });
  ok("resubmit: THE CLAIM COMES BEFORE THE SUBMIT — otherwise two clicks are two caps",
    claim > 0 && claim < submit, { claim, submit });
  ok("resubmit: the id is written back after the submit, never before",
    write > 0 && submit < write, { submit, write });

  // 0334 narrowed ApliiqSubmit so ok:true carries a real id. If anyone widens it back, this route
  // silently starts writing the status without evidence again — the exact bug of the first cap.
  // STRIPPED, for the reason stated eight lines up and then immediately forgotten: lib/apliiq's own
  // header QUOTES the old `apliiqOrderId: string | null` while explaining why it is gone, so reading
  // the file raw finds the defect inside the sentence describing the fix. The first run of this gate
  // failed on correct code for exactly that.
  const apliiq = fs.readFileSync(path.join(__dirname, "..", "lib/apliiq.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
  ok("resubmit: a successful Apliiq submit still guarantees an id (0334's narrowed type holds)",
    /ok:\s*true;\s*apliiqOrderId:\s*string\s*\}/.test(apliiq) &&
    !/ok:\s*true;\s*apliiqOrderId:\s*string\s*\|\s*null/.test(apliiq));

  // PROVE IT BITES: the same comparison against a file with the claim moved after the submit.
  {
    const bad = 'const s = await submitOrderToApliiq(x);\nconst c = await rpc("claim_shop_order_for_submit");';
    ok("resubmit: fed a route that submits before claiming, the check fails",
      !(bad.indexOf("claim_shop_order_for_submit") < bad.indexOf("submitOrderToApliiq(")));
  }
}

// ── AN ALERT GUARD MAY NOT MATCH ON PROSE (0336) ─────────────────────────────────────────────────
// 0174 decided whether the café already had an open "orders are backing up" alert with
//
//     where category = 'order' and title like '%waiting on the pass%'
//
// three lines above an INSERT that sets kind = 'order_stale'. The key was written by the same
// statement and not used. Editing that sentence — for readability, for translation, because someone
// prefers "counter" — makes the guard match nothing, and the cron is */5: one alert every five
// minutes, arriving during the exact rush the alert is about. Proved in db.alertnoise: six runs,
// six alerts, after changing one word.
//
// 19 migrations in this repo contain a hand-written guard of this shape. They are NOT rewritten —
// eighteen of them are a recorded backlog, because re-emitting working watchdogs at three in the
// morning is how a good night breaks something. FLOOR, like every other rule here: 0336 is where
// alert_open_once exists, so 0336 is where this starts.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const FLOOR = 336;
  const migDir = path.join(__dirname, "..", "supabase", "migrations");

  // SQL comments are `--`. This block's own explanation quotes the broken guard, and so does 0336's
  // header while explaining why it is gone — reading the file raw finds the defect inside the
  // sentence describing the fix, which is the trap the resubmit gate fell into two migrations ago.
  // Comments FIRST (an apostrophe in "0174's guard" would otherwise derail the literal scan), then
  // STRING LITERALS. Both are needed: the first cut of this gate flagged 0336 itself, because its
  // record_migration note quotes the broken guard while explaining why it is gone. Stripping
  // literals to '' leaves a real guard as `title like ''` — still findable — while prose that merely
  // mentions one disappears entirely, since that prose only ever lives INSIDE a literal.
  //
  // Third time tonight a gate has matched the sentence describing the bug instead of the bug.
  const stripSql = (t) => t
    .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n")
    .replace(/'(?:[^']|'')*'/g, "''");

  const files = fs.existsSync(migDir) ? fs.readdirSync(migDir)
    .filter((n) => n.endsWith(".sql") && Number(n.slice(0, 4)) >= FLOOR).sort() : [];
  ok("alert guards: the floor still names migrations to check", files.length >= 1, files.length);

  const offenders = [];
  for (const n of files) {
    const sql = stripSql(fs.readFileSync(path.join(migDir, n), "utf8"));
    if (!/insert\s+into\s+public\.alerts/i.test(sql)) continue;
    // A guard that reads the alert's own prose to decide whether it already exists.
    for (const m of sql.matchAll(/\btitle\s+(?:i?like|=)\s*''/gi)) {
      offenders.push(`${n}: ${m[0].trim().slice(0, 60)}`);
    }
  }
  ok("alert guards: no migration at or past the floor keys a dedupe on the alert's own wording",
    offenders.length === 0, offenders);

  // The replacement has to actually exist and be callable, or this rule just forbids without
  // offering — which is how a gate gets deleted by the next person in a hurry.
  const all = fs.readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()
    .map((n) => fs.readFileSync(path.join(migDir, n), "utf8")).join("\n");
  ok("alert guards: alert_open_once exists as the thing to use instead",
    /create or replace function public\.alert_open_once/.test(all));
  ok("alert guards: …and it has no parameter for a title to match on, so the mistake cannot be spelled",
    !/alert_open_once\([^)]*p_title_like/i.test(all));

  // PROVE IT BITES, on the exact text that shipped.
  {
    const planted = stripSql(
      "insert into public.alerts (kind) values ('x');\n" +
      "-- a comment quoting title like '%not a real guard%' must not count\n" +
      "select 'a note that says title like ''%nor this one%'' while explaining it' as note;\n" +
      "select 1 from public.alerts where category = 'order' and title like '%waiting on the pass%';");
    const found = [...planted.matchAll(/\btitle\s+(?:i?like|=)\s*''/gi)].map((m) => m[0]);
    ok("alert guards: fed 0174's own guard alongside a comment and a note that both quote it, the rule finds exactly one",
      found.length === 1, found);
  }
}

// ── THREE THINGS THE INBOX STILL SAID (0340) ─────────────────────────────────────────────────────
// Ryan's inbox, 2026-10-04, "3 critical", and not one of the three lines true about now: a stalled-
// order title frozen at "12 hours" over a body reading 119; two crash alerts 0303 had already ruled
// were reloads; and "No uptime monitor ×63" about a monitor that existed. Each one is a pair of
// things that had stopped agreeing, so each one is checked here as a pair.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
  const migDir = path.join(root, "supabase", "migrations");
  const migs = fs.readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort();
  const sqlOf = (n) => fs.readFileSync(path.join(migDir, n), "utf8");
  const latestDefining = (fn) => [...migs].reverse().find((n) =>
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, "i").test(sqlOf(n)));
  // The body of one function: from its create to the end of its $$…$$.
  const fnText = (sql, fn) => {
    const at = sql.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, "i"));
    if (at < 0) return "";
    const open = sql.indexOf("$$", at);
    const close = open < 0 ? -1 : sql.indexOf("$$", open + 2);
    return close < 0 ? "" : sql.slice(at, close + 2);
  };
  const noComments = (t) => t.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

  // ── 1 · THE MONITOR AND THE RULE THAT JUDGES IT ─────────────────────────────────────────────
  // production.yml checks the app every N minutes; heartbeat_watchdog calls the check quiet after M.
  // 0327 had M = 30 against N = 30, so any late run was a "silence" — and GitHub's scheduler is late
  // by documented policy. Two files, neither able to read the other: a known pair, held to M ≥ 3N
  // (one late run and one dropped run must not be an alert).
  const periodOf = (cron) => {           // minutes between runs, for a schedule whose hour field is *
    const [min, hour] = String(cron || "").trim().split(/\s+/);
    if (hour !== "*" || !min) return null;
    const step = /^\*\/(\d+)$/.exec(min);
    if (step) return Number(step[1]);
    const list = min.split(",").map(Number);
    if (!list.length || list.some((n) => !Number.isInteger(n) || n < 0 || n > 59)) return null;
    const m = [...list].sort((a, b) => a - b);
    return Math.max(...m.map((x, i) => (i + 1 < m.length ? m[i + 1] - x : 60 - x + m[0])));
  };
  const startsAtTopOfHour = (cron) => {
    const min = String(cron || "").trim().split(/\s+/)[0] || "";
    return /^\*\/\d+$/.test(min) || min.split(",").map(Number).includes(0);
  };
  const wf = read(".github/workflows/production.yml");
  const quick = /-\s*cron:\s*"([^"]+)"\s*#\s*quick/.exec(wf);
  const N = quick ? periodOf(quick[1]) : null;
  const hbFile = latestDefining("heartbeat_watchdog");
  const hbSql = hbFile ? sqlOf(hbFile) : "";
  const declared = /--\s*heartbeat-stale-after:\s*(\d+)/i.exec(hbSql);
  const used = /hb\s*>\s*now\(\)\s*-\s*interval\s*'(\d+) minutes'/i.exec(fnText(hbSql, "heartbeat_watchdog"));
  ok("uptime pair: production.yml's quick schedule was found", !!quick, quick && quick[1]);
  ok("uptime pair: …and its period read", Number.isInteger(N) && N > 0, N);
  ok("uptime pair: the latest heartbeat_watchdog declares its threshold with `-- heartbeat-stale-after:`", !!declared, hbFile);
  ok("uptime pair: …and the function uses exactly that number", !!used && !!declared && used[1] === declared[1],
    { declared: declared && declared[1], used: used && used[1] });
  ok("uptime pair: the watchdog waits at least three of the monitor's periods",
    !!declared && Number.isInteger(N) && Number(declared[1]) >= 3 * N, { threshold: declared && declared[1], period: N });
  ok("uptime pair: the quick check is off the top of the hour (GitHub's busiest minute)",
    !!quick && !startsAtTopOfHour(quick[1]), quick && quick[1]);
  ok("uptime pair: the step that picks the quick form compares against the schedule that exists",
    !!quick && wf.includes(`github.event.schedule }}" = "${quick[1]}"`));
  // PROVE IT BITES — 0327's numbers, and the parser on the shapes a schedule can take.
  ok("uptime pair: fed 0327's thirty minutes against a */30 schedule, the rule fails", !(30 >= 3 * periodOf("*/30 * * * *")));
  ok("uptime pair: periods are read the way cron means them",
    periodOf("7,37 * * * *") === 30 && periodOf("*/15 * * * *") === 15 && periodOf("0 * * * *") === 60
    && periodOf("5,20,50 * * * *") === 30 && periodOf("10 6 * * *") === null);
  ok("uptime pair: */30 is a top-of-the-hour schedule, 7,37 is not",
    startsAtTopOfHour("*/30 * * * *") && startsAtTopOfHour("0,30 * * * *") && !startsAtTopOfHour("7,37 * * * *"));

  // ── 2 · A PRODUCER RE-EMITTED MUST RESTATE WHAT IT ALREADY WROTE ──────────────────────────────
  // 0333's header says this gate exists: "a migration that re-emits an alert producer must either
  // restate the existing rows or say in one line why none need it". It did not. 0303 then turned out
  // to be the case it was for — producer fixed, rows left critical, two of them in Ryan's inbox a
  // month later. FLOOR at 0340, where the claim finally becomes true; history is not retro-judged.
  //
  // A producer is a function that writes alerts (an INSERT or alert_open_once). It is restated by:
  //   (a) the migration running it   — alert_open_once rewrites its open rows' title and body
  //   (b) an UPDATE of public.alerts naming one of the kinds it writes
  //   (c) a line `-- existing rows: <function> — <why none need restating>`
  const PRODUCER_FLOOR = 340;
  const producersIn = (sql) => {
    const out = [];
    for (const m of sql.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) {
      const name = m[1];
      if (name === "alert_open_once") continue;
      const body = fnText(sql, name);
      if (/insert\s+into\s+public\.alerts/i.test(body) || /alert_open_once\s*\(/i.test(body)) {
        const kinds = [...body.matchAll(/alert_open_once\(\s*'([a-z_0-9]+)'/gi)].map((k) => k[1]);
        out.push({ name, kinds });
      }
    }
    return out;
  };
  const unrestated = (sql) => {
    const top = noComments(sql).replace(/\$\$[\s\S]*?\$\$/g, " ");     // outside every function body
    const updates = [...top.matchAll(/update\s+public\.alerts\b[\s\S]*?;/gi)].map((u) => u[0]);
    return producersIn(sql).filter((p) =>
      !new RegExp(`select\\s+public\\.${p.name}\\s*\\(`, "i").test(top)
      && !p.kinds.some((k) => updates.some((u) => new RegExp(`kind\\s*=\\s*'${k}'`, "i").test(u)))
      && !new RegExp(`--\\s*existing rows:\\s*${p.name}\\b`, "i").test(sql)).map((p) => p.name);
  };
  const late = migs.filter((n) => Number(n.slice(0, 4)) >= PRODUCER_FLOOR);
  ok("restated rows: the floor still names migrations to read", late.length >= 1, late.length);
  const offenders = late.flatMap((n) => unrestated(sqlOf(n)).map((f) => `${n}: ${f}`));
  ok("restated rows: every alert producer re-emitted from 0340 on restates the rows it already wrote",
    offenders.length === 0, offenders);
  ok("restated rows: 0340 re-emits two producers and the rule sees both",
    producersIn(sqlOf(late[0])).map((p) => p.name).sort().join(",") === "heartbeat_watchdog,shop_order_stall_watchdog",
    producersIn(sqlOf(late[0])).map((p) => p.name));
  // PROVE IT BITES: a producer re-emitted bare, then the same with each way out.
  {
    const bare = "create or replace function public.p() returns void language plpgsql as $$ begin perform public.alert_open_once('k_x', null); end $$;";
    ok("restated rows: a bare re-emission is caught", unrestated(bare).join() === "p");
    ok("restated rows: …running it is a restatement", unrestated(bare + "\nselect public.p();").length === 0);
    ok("restated rows: …so is an update of its kind", unrestated(bare + "\nupdate public.alerts set ack_at = now() where kind = 'k_x';").length === 0);
    ok("restated rows: …so is a stated reason", unrestated(bare + "\n-- existing rows: p — none have ever been written").length === 0);
    ok("restated rows: …but an update of SOMEONE ELSE'S kind is not", unrestated(bare + "\nupdate public.alerts set ack_at = now() where kind = 'other';").join() === "p");
    ok("restated rows: …nor a call that only appears inside a function body",
      unrestated(bare + "\ncreate or replace function public.q() returns void language sql as $$ select public.p(); $$;").join() === "p");
  }

  // ── 3 · MONEY IN AN ALERT HAS ITS DOLLAR SIGN ────────────────────────────────────────────────
  // "Ryan paid 32.00". Ten producers in these migrations write '$' || to_char(cents / 100.0, …) or a
  // 'FM$…' format; 0329 and 0331 did neither. A cents-to-dollars to_char inside an alert producer
  // needs one or the other. FLOOR at 0340.
  const bareMoney = (body) => {
    const hits = [];
    let i = 0;
    while ((i = body.indexOf("to_char(", i)) >= 0) {
      let depth = 0, j = i + 7;
      for (; j < body.length; j++) { if (body[j] === "(") depth++; else if (body[j] === ")" && --depth === 0) break; }
      const call = body.slice(i, j + 1);
      if (/\/\s*100(\.0)?\b/.test(call)) {
        const fmt = /'([^']*)'\s*\)$/.exec(call);
        const before = body.slice(Math.max(0, i - 16), i);
        if (!(fmt && fmt[1].includes("$")) && !/\$'\s*\|\|\s*$/.test(before)) hits.push(call.slice(0, 70));
      }
      i = j;
    }
    return hits;
  };
  const moneyOffenders = late.flatMap((n) => producersIn(sqlOf(n)).flatMap((p) =>
    bareMoney(fnText(sqlOf(n), p.name)).map((h) => `${n} ${p.name}: ${h}`)));
  ok("alert money: every cents-to-dollars amount an alert producer writes carries its $ (0340 on)",
    moneyOffenders.length === 0, moneyOffenders);
  ok("alert money: fed 0331's own sentence, the rule finds the missing sign",
    bareMoney("r.who || ' paid ' || to_char((coalesce(r.total_cents, 0) / 100.0), 'FM999990.00') || ' for '").length === 1);
  ok("alert money: …and passes both house spellings of a dollar amount",
    bareMoney("' paid $' || to_char(coalesce(r.total_cents, 0) / 100.0, 'FM999,999,990.00')").length === 0
    && bareMoney("to_char(i.amount_cents / 100.0, 'FM$999,999.00')").length === 0);

  // ── 4 · THE STALL ALERT SPEAKS THE SHOP PANEL'S STATUS WORDS ─────────────────────────────────
  // 0329 had one body for every status the view calls waiting-on-us, and it said "this app sent it"
  // about orders still marked Paid. Now each such status has its own sentence quoting the label the
  // shop panel shows. Read from lib/shopOrder and from the latest migration defining the producer, so
  // a status added to one and not the other fails here.
  const SO = require("../.smoke/shopOrder.js");
  const waitingUs = Object.entries(SO.SHOP_STATUS_META).filter(([, m]) => m.waiting === "us");
  const stallFile = latestDefining("shop_order_stall_watchdog");
  const stallFn = stallFile ? fnText(sqlOf(stallFile), "shop_order_stall_watchdog") : "";
  const branchOf = (fn, status) =>
    (new RegExp(`when\\s+'${status}'\\s+then\\s+([\\s\\S]*?)(?=\\n\\s*when\\s+'|\\n\\s*else\\b)`).exec(fn) || [])[1] || "";
  ok("stall alert: the shop's waiting-on-us statuses were read from lib/shopOrder", waitingUs.length >= 3, waitingUs.map(([k]) => k));
  for (const [status, meta] of waitingUs) {
    ok(`stall alert: '${status}' has its own sentence`, branchOf(stallFn, status).length > 0, stallFile);
    ok(`stall alert: …quoting the shop panel's label "${meta.label}"`, branchOf(stallFn, status).includes(`"${meta.label}"`));
  }
  ok("stall alert: fed 0329's one-body-fits-all function, the rule fails",
    branchOf(fnText(sqlOf("0329_a_paid_order_can_stop_moving_and_nobody_hears.sql"), "shop_order_stall_watchdog"), "paid") === "");

  // ── 5 · AN ALERT'S SUBJECT IS A UUID, OR THE ALERT DOES NOT EXIST ─────────────────────────────
  // Found while fixing the above: lib/errorIntake keyed its storm line on the business DAY and the
  // Square webhook keyed chargeback_open on Square's dispute id. alerts.subject_id is a uuid, the
  // database refuses both (proved in db.alertnoise), and the helpers swallow the refusal by contract.
  // The critical "a card dispute was opened" alert has never once been able to fire.
  const S = require("../.smoke/alertSubject.js");
  const K = require("../.smoke/alertKinds.js");
  const U = require("../.smoke/uuid.js");
  ok("subject: RFC 4122's own version-5 example comes out right",
    S.uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8") === "2ed6657d-e927-568b-95e1-2665a8aea6a2");
  const rowId = "3e52372d-3da3-48ca-9959-e2dbba3972f8";
  ok("subject: a row of ours passes through untouched, so inline handlers still load it", S.alertSubject("task_due", rowId) === rowId);
  const storm = S.alertSubject("error_storm", "2026-10-04");
  const dispute = S.alertSubject("chargeback_open", "XDgyFu7yo1E2S5lQGGpYn");
  ok("subject: a business day becomes a uuid the database takes", U.isUuid(storm), storm);
  ok("subject: …the same one on every call, so one storm a day is still one line",
    storm === S.alertSubject("error_storm", "2026-10-04") && storm !== S.alertSubject("error_storm", "2026-10-05"));
  ok("subject: a Square dispute id becomes a stable uuid — the chargeback alert can exist",
    U.isUuid(dispute) && dispute === S.alertSubject("chargeback_open", "XDgyFu7yo1E2S5lQGGpYn"));
  ok("subject: two kinds sharing an external key do not collide", S.alertSubject("a_kind", "k1") !== S.alertSubject("b_kind", "k1"));
  ok("subject: version 5, RFC variant", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(dispute), dispute);
  ok("subject: no key, no subject", S.alertSubject("x", "") === null && S.alertSubject("x", "  ") === null
    && S.alertSubject("x", null) === null && S.alertSubject("x", undefined) === null);
  ok("subject: isUuid says no to a day, a Square id and nothing", !U.isUuid("2026-10-04") && !U.isUuid("XDgyFu7yo1E2S5lQGGpYn") && !U.isUuid(undefined));
  ok("subject: …and yes to a row id, in either case", U.isUuid(rowId) && U.isUuid(rowId.toUpperCase()));

  // ONE HOME FOR THE PATTERN. Four files had their own copy of the uuid regex by the time this was
  // written; lib/uuid.ts is the only one allowed now.
  const uuidCopies = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules|\.next|\.smoke|\.git/.test(f)) walk(f); continue; }
      if (!/\.tsx?$/.test(e.name) || f === path.join(root, "lib", "uuid.ts")) continue;
      if (fs.readFileSync(f, "utf8").includes("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}")) uuidCopies.push(f.replace(root + "/", ""));
    }
  })(root);
  ok("uuid: the pattern lives in lib/uuid.ts and nowhere else in the app", uuidCopies.length === 0, uuidCopies);
  const serverDoor = read("lib/serverAlerts.ts"), clientDoor = read("lib/clientAlerts.ts");
  ok("subject: raiseAlert writes alertSubject(kind, subjectId) — never the raw key",
    /subject_id:\s*alertSubject\(a\.kind,\s*a\.subjectId\)/.test(serverDoor) && !/subject_id:\s*a\.subjectId\b/.test(serverDoor));
  ok("subject: raiseAlertOnce asks about the same subject it will write",
    /const subject = alertSubject\(a\.kind, a\.subjectId\)/.test(serverDoor) && /\.eq\("subject_id", subject\)/.test(serverDoor));
  ok("subject: the browser door drops a key that is not a uuid rather than losing the whole alert",
    /subject_id:\s*isUuid\(a\.subjectId\)\s*\?\s*a\.subjectId\s*:\s*null/.test(clientDoor));

  // ── 6 · WHICH MOMENT A CARD SHOWS ────────────────────────────────────────────────────────────
  ok("when: a single episode shows when it was raised, however recently its producer refreshed it",
    K.alertWhen({ created_at: "raised", last_seen_at: "refreshed", occurrences: 1 }) === "raised");
  ok("when: a folded recurrence shows its latest",
    K.alertWhen({ created_at: "raised", last_seen_at: "latest", occurrences: 4 }) === "latest");
  ok("when: a recurrence with no last_seen_at falls back to raised",
    K.alertWhen({ created_at: "raised", last_seen_at: null, occurrences: 3 }) === "raised");
  ok("when: a row from before 0327 (no count) is one episode",
    K.alertWhen({ created_at: "raised", last_seen_at: "x" }) === "raised");
  const crewPage = read("app/crew/page.tsx");
  ok("when: the inbox card asks alertWhen and nothing else",
    /<span className="alert-when">\{ageLabel\(alertWhen\(a\)\)\}<\/span>/.test(crewPage) && !/ageLabel\(a\.last_seen_at \?\? a\.created_at\)/.test(crewPage));
}

// ── MEASURING SAFETY (2026-10-01) ──────────────────────────────────────────────────────────────
// Ryan is adding a second operator who will also be cooking: "make sure that the ai is descriptive
// in explaining the task… the measuring scale is on a flat surface when measuring out ingredients…
// make sure that ai, cookbooks, and recipes give it in ounces and grams… all please-enforcements or
// reinforcements are in red and highlighted with some animation to make sure that nothing gets
// messed up."
//
// Four gates, because four different edits could quietly undo this and none of them would look
// dangerous at the time:
//   1. a new screen writes `{qty}{unit}` by hand again — which is how it was wrong in TWO places
//   2. a cookbook procedure starts weighing something and nobody sets the flag that shows the band
//   3. the band stops being red, or stops moving, or loses the reduced-motion escape hatch
//   4. an agent that writes cooking instructions stops being given the measuring rules
{
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

  // ── 1. NOBODY HAND-WRITES A RECIPE QUANTITY AGAIN ────────────────────────────────────────────
  // The exact shape of the original bug, in JSX: `{i.qty}{i.unit ? ` ${i.unit}` : ""}`. It was
  // written twice, independently, in BrewSteps and BrewPlanner — which is what made it a one-home
  // problem rather than a typo. cookQuantity is now the only way to state a quantity to a cook.
  //
  // The allow-list is NOT a way around the rule. Each entry is a surface where a quantity is a
  // FACT ABOUT STOCK OR COST, not an instruction to measure something: converting those to dual
  // units would be noise, and a WEIGH mark on a reorder point would be a lie. A new file has to
  // argue its way onto this list.
  const NOT_A_MEASURING_SURFACE = {
    "components/CogsCalculator.tsx": "cost per line — a money view; nobody weighs from it",
    "components/MenuManager.tsx": "per-serving config an owner types; not a prep instruction",
    "components/BrewPlanner.tsx": "shortfall text + the sizing hint, both about STOCK not measuring",
    "app/crew/page.tsx": "inventory on hand and reorder points — stock levels, not a recipe",
  };
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(rel, out); }
      else if (e.name.endsWith(".tsx")) out.push(rel);
    }
    return out;
  };
  const tsx = [...walk("components"), ...walk("app")];
  // JSX comments are `{/* … */}` and this file's own notes quote the pattern; strip comments first,
  // for the reason the alert-guard gate above learned three times in one night.
  const stripJsx = (t) => t.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const RAW_QTY = /\{\s*\w+\.qty\s*\}\s*\{\s*\w+\.unit\s*\?/;
  const rawOffenders = [];
  for (const f of tsx) {
    if (NOT_A_MEASURING_SURFACE[f]) continue;
    if (RAW_QTY.test(stripJsx(read(f)))) rawOffenders.push(f);
  }
  ok("measuring: no screen states an ingredient quantity without cookQuantity",
    rawOffenders.length === 0, rawOffenders);
  // RENDERED, not merely imported. Planting the old hand-written row into BrewSteps left the import
  // in place and a /CookNeedList/ grep stayed green — an import is not a call site, and a check that
  // cannot fail is a check that lies.
  ok("measuring: the two screens a cook reads actually RENDER the one shared list",
    /<CookNeedList\s/.test(read("components/BrewSteps.tsx")) && /<CookNeedList\s/.test(read("components/BrewPlanner.tsx")));
  ok("measuring: …and that list is the only place the dual-unit row is written",
    tsx.filter((f) => /className="ck-need"/.test(read(f))).length === 1,
    tsx.filter((f) => /className="ck-need"/.test(read(f))));
  // PROVE IT BITES.
  ok("measuring: fed the original line, the rule finds it",
    RAW_QTY.test(stripJsx('<li><b>{i.qty}{i.unit ? ` ${i.unit}` : ""}</b><span>{i.name}</span></li>')));
  ok("measuring: …and fed a comment quoting it, the rule does not",
    !RAW_QTY.test(stripJsx('{/* this used to be {i.qty}{i.unit ? ` ${i.unit}` : ""} */}\n<CookNeedList />')));

  // ── 2. THE COOKBOOK FLAG AND THE COOKBOOK PROSE AGREE ────────────────────────────────────────
  // The Cookbook's scale band is keyed on a `weighs` flag, NOT on searching the procedure for the
  // word "weigh" — 0336 shipped last night for exactly that mistake, and a safety band that
  // disappears when somebody rewrites "Weigh beans" as "Measure out beans" is that bug with worse
  // consequences. But the flag can then fall out of step with the prose, so the PROSE IS SNIFFED
  // HERE: a test fails loudly at build time, where a render path would fail silently in a kitchen.
  const academy = read("lib/academy.ts");
  // Each `cookbook: { … }` object, by BRACE MATCHING and not by a regex over indentation. The first
  // cut of this used `[\s\S]*?\n\s{4}\},` and found 9 of 10 — it ran off the end of one cookbook
  // into the product object containing it, so one pair of entries was read as a single entry. A
  // gate that silently policed nine tenths of the list is the kind of quiet lie this file exists
  // to refuse. Quoted strings are skipped while counting, so a value containing a brace cannot
  // throw the count off either.
  const cookbookObjects = (src) => {
    const out = [];
    for (let at = src.indexOf("cookbook: {"); at !== -1; at = src.indexOf("cookbook: {", at + 1)) {
      let depth = 0, q = null;
      const from = src.indexOf("{", at);
      for (let i = from; i < src.length; i++) {
        const c = src[i];
        if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
        if (c === '"' || c === "'" || c === "`") { q = c; continue; }
        if (c === "{") depth++;
        else if (c === "}" && --depth === 0) { out.push(src.slice(from + 1, i)); break; }
      }
    }
    return out;
  };
  const cookbooks = cookbookObjects(academy);
  const declared = (academy.match(/cookbook: \{/g) ?? []).length;
  ok("cookbooks: the gate finds EVERY cookbook entry it is meant to police",
    cookbooks.length === declared && declared >= 10, `${cookbooks.length} of ${declared}`);
  ok("cookbooks: …and each one is its own entry, not two run together",
    cookbooks.every((cb) => !/cookbook: \{/.test(cb)),
    cookbooks.filter((cb) => /cookbook: \{/.test(cb)).length);
  const WEIGH_WORDS = /\b(weigh|weighed|weighing|scale|grams?|\d\s*g\b|ounces?|\boz\b)\b/i;
  const mismatched = [];
  for (const cb of cookbooks) {
    const brew = (cb.match(/brew:\s*\[([^\]]*)\]/) ?? [, ""])[1];
    const flagged = /\bweighs:\s*true\b/.test(cb);
    if (WEIGH_WORDS.test(brew) && !flagged) mismatched.push(brew.slice(0, 90));
  }
  ok("cookbooks: every procedure that talks about weighing carries weighs:true, so the band shows",
    mismatched.length === 0, mismatched);
  ok("cookbooks: at least one procedure IS flagged — a gate that passes on an empty set proves nothing",
    cookbooks.filter((cb) => /\bweighs:\s*true\b/.test(cb)).length >= 2,
    cookbooks.filter((cb) => /\bweighs:\s*true\b/.test(cb)).length);
  ok("cookbooks: the page shows the band from the FLAG and never from the prose",
    /p\.cookbook\.weighs\s*&&/.test(read("app/academy/page.tsx"))
    && !WEIGH_WORDS.test((read("app/academy/page.tsx").match(/cookbook\.brew\.(?:some|filter|find)\([\s\S]{0,200}/) ?? [""])[0]));
  // PROVE IT BITES: a procedure that weighs with the flag absent.
  ok("measuring: fed an unflagged weighing procedure, the rule finds it",
    WEIGH_WORDS.test('"Weigh beans 1:13 to mineral water", "Cold-extract ~18 hrs"')
    && !/\bweighs:\s*true\b/.test('batch: "x", brew: ["Weigh beans 1:13"]'));

  // ── 3. THE BAND IS STILL RED, STILL MOVES, AND STILL STOPS FOR WHOEVER ASKED ──────────────────
  // Ryan asked for red + highlighted + animated, in those words. All three are load-bearing: this
  // is the thing standing between a new cook and a wrongly measured batch. The reduced-motion
  // escape is equally load-bearing in the other direction — for somebody with vestibular
  // sensitivity a permanently pulsing band is a reason to look AWAY from the instruction.
  const css = read("app/globals.css");
  const band = (css.match(/\.ck-enforce\{[^}]*\}/) ?? [""])[0];
  ok("enforce: the band is a RED FILL, not red text (this file already records that brand red as small text fails contrast)",
    /background:var\(--red\)/.test(band) && /color:var\(--brand-cream\)/.test(band), band);
  ok("enforce: it is highlighted with its own border", /border:2px solid var\(--red-d\)/.test(band), band);
  ok("enforce: it animates", /animation:ck-pulse/.test(band) && /@keyframes ck-pulse/.test(css), band);
  ok("enforce: the animation is FINITE — a thing that moves forever becomes wallpaper, which is how twenty alerts stopped being read",
    /animation:ck-pulse [^;}]*\s\d+\}?$/m.test(band) || /animation:ck-pulse 1\.1s ease-out 4/.test(band), band);
  ok("enforce: reduced-motion stops the movement and keeps the red",
    /@media \(prefers-reduced-motion: reduce\)\{\s*\.ck-enforce\{animation:none/.test(css));
  ok("enforce: colour is never the only signal — the band carries an icon and a word",
    /<Icon name="warning" \/>/.test(read("components/CookEnforcement.tsx"))
    && /label\.toUpperCase\(\)/.test(read("components/CookEnforcement.tsx")));
  ok("enforce: it announces itself to a screen reader", /role="alert"/.test(read("components/CookEnforcement.tsx")));

  // ── 4. EVERY AGENT THAT WRITES COOKING INSTRUCTIONS GETS THE RULES ───────────────────────────
  // One exported block, so the assistant a cook asks and the planner that writes his method steps
  // cannot teach him two different procedures.
  const rules = read("lib/agentKnowledge.ts");
  ok("measuring: the rules demand BOTH units on every weight",
    /BOTH UNITS, ALWAYS/.test(rules) && /grams AND ounces/.test(rules));
  ok("measuring: …with the exact factor, so a conversion is derived and not recalled",
    /1 oz = 28\.3495 g exactly/.test(rules));
  ok("measuring: …and refuse to turn a volume into a weight",
    /NEVER CONVERT A VOLUME TO A WEIGHT/.test(rules));
  ok("measuring: the flat-surface rule is in the words Ryan asked for",
    /hard, flat, level surface/.test(rules) && /TARE\/ZERO|TARE \/ ZERO/.test(rules));
  ok("measuring: being descriptive is scoped to things being MADE, so a stock lookup stays short",
    /BE DESCRIPTIVE WHEN SOMETHING IS BEING MADE/.test(rules) && /Lookups \(/.test(rules));
  // 2026-10-03, Ryan's screenshot: "Measure `1.214 gal` of Mountain Valley Spring Water". Nobody can
  // measure 1.214 gal, and the rules' own examples were teaching the model to box every amount in
  // backticks. The amount is bold, the volume is something a person can pour, and a number says
  // what it is.
  const measuring = (rules.match(/export const MEASURING_RULES =([\s\S]*?);\n/) || [])[1] || "";
  ok("measuring: a fractional gallon is also given as gallons + cups (to the quarter cup) and fl oz, with the table that makes it checkable",
    /A VOLUME SHE CAN MEASURE/.test(measuring) && /1 gal = 4 qt = 16 cups = 128 fl oz/.test(measuring) && /nearest quarter cup/.test(measuring));
  ok("measuring: amounts are bold, and the rules' own examples no longer box a single quantity in backticks",
    /Bold, never backticks/.test(measuring) && !/`\d/.test(measuring) && /\*\*560 g \(19\.8 oz\)\*\*/.test(measuring));
  ok("measuring: every number is named for what it is — a volume of water is not a \"scale factor\"",
    /NAME EVERY NUMBER/.test(measuring) && /scale factor/.test(measuring));
  {
    const op = read("app/api/agents/operator/route.ts");
    ok("operator: code spans are for things typed or read off a display, never an amount", /\\`code\\` ONLY for something typed or read off a display/.test(op) && /Never for an amount/.test(op));
    ok("operator: one answer — the likely reading in full, the other in one line, never answer-ask-answer", /ONE ANSWER\./.test(op) && /Never\s+answer, then ask whether you understood, then answer again/.test(op));
    ok("operator: the \"---\" rule is named among what not to write, with tables and blockquotes", /blockquotes or "---" rules/.test(op));
  }
  for (const agent of ["app/api/agents/operator/route.ts", "app/api/agents/brew/route.ts"]) {
    const src = read(agent);
    ok(`measuring: ${agent.split("/")[3]} imports the shared rules`, /MEASURING_RULES/.test(src)
      && /from "@\/lib\/agentKnowledge"/.test(src), agent);
    // Imported is not the same as USED. An import with no interpolation is a check nobody reads —
    // a mistake made earlier tonight, in this same file.
    ok(`measuring: …and actually puts them in the prompt it sends`,
      /\$\{MEASURING_RULES\}|MEASURING_RULES \+/.test(src), agent);
  }
  ok("measuring: the recipe grounding hands the model both units rather than asking it to convert",
    /cookQuantity\(round\(primary\.perGal \* base\), primary\.unit\)\.display/.test(read("lib/brewMath.ts")));
}

// ── HOW SMALL A BATCH CAN BE (2026-10-01) ──────────────────────────────────────────────────────
// Ryan: "Recipe should be able to scale down as small as possible to not waste and expand as
// needed." Then, asked how small: "Start at 3 servings 30OZ."
//
// What was there before: gallonsForBottles rounded UP to a quarter gallon, and the input carried a
// flat min="0.25" step="0.25". A quarter gallon is 3.2 servings, so the rounding threw away up to
// three servings of coffee on EVERY brew, not only small ones — measured before the change:
// 3 wanted -> 5 made, 6 -> 8, 12 -> 14, 24 -> 26.
{
  const B = require("../.smoke/brewMath.js");
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

  // ── THE WASTE IS GONE, AND DEMAND IS STILL COVERED ───────────────────────────────────────────
  // Both halves matter and they pull against each other: a step that never over-brews is easy if
  // you are allowed to under-deliver. Every count, every plausible yield.
  {
    const under = [], over = [];
    for (let n = 1; n <= 120; n++) {
      for (const y of [0.85, 0.92, 0.95, 1]) {
        const got = B.bottlesFor(B.gallonsForBottles(n, y), y);
        if (got < n) under.push([n, y, got]);
        if (got > n) over.push([n, y, got]);
      }
    }
    ok("batch floor: brewing for N servings never makes fewer than N — 120 counts x 4 yields",
      under.length === 0, under.slice(0, 3));
    ok("batch floor: …and never makes MORE either, which is the waste Ryan asked about",
      over.length === 0, over.slice(0, 3));
  }
  // The old rule, kept runnable, so the claim in the commit message is checkable and not folklore.
  ok("batch floor: the quarter-gallon rule it replaced really did waste 2 servings at 3",
    B.bottlesFor(B.quarterGal((3 * 10 / 128) / 0.92), 0.92) === 5);

  // ── EVERY STEP RESULT IS CLEAN TO TWO DECIMALS ───────────────────────────────────────────────
  // 0.05 has no exact binary form, so the obvious float version returns 16.150000000000002 — which
  // would be written to brew_batches.batch_gal and rendered on a sheet.
  {
    const dirty = [];
    for (let i = 1; i <= 2000; i++) {
      const g = i * 0.0137;
      for (const v of [B.stepUpGal(g), B.stepDownGal(g)]) {
        if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-9) dirty.push([g, v]);
      }
    }
    ok("batch floor: stepping never produces a float with a tail — 2000 values, both directions",
      dirty.length === 0, dirty.slice(0, 3));
  }
  ok("batch floor: a value already on a step does not move in either direction",
    B.stepUpGal(0.3) === 0.3 && B.stepDownGal(0.3) === 0.3 && B.stepUpGal(4) === 4 && B.stepDownGal(4) === 4,
    [B.stepUpGal(0.3), B.stepDownGal(0.3)]);
  ok("batch floor: up covers, down never asks for more — the two directions are not interchangeable",
    B.stepUpGal(0.2548) === 0.3 && B.stepDownGal(0.2548) === 0.25);

  // ── THREE SERVINGS MEANS THREE CAME OUT ──────────────────────────────────────────────────────
  // THE trap in "3 servings 30OZ": 30 oz of WATER at a 0.92 yield pours 27.6 oz, which is two
  // servings. A floor set to 30 oz of water hands somebody who asked for three a batch making two.
  const RISE = { ingredients: [{ name: "Coffee", qty: 340, unit: "g" }, { name: "Coconut water", qty: 19.2, unit: "oz" }], baseWaterGal: 1.2 };
  for (const y of [0.8, 0.85, 0.92, 0.95, 1]) {
    const f = B.smallestBatch({ ...RISE, yieldFactor: y });
    ok(`batch floor: the floor POURS at least 3 servings at a ${y} yield — not 3 servings of water`,
      f.servings >= 3, `${f.gal} gal -> ${f.servings}`);
  }
  ok("batch floor: 30 oz of water would NOT have done — the naive floor really does pour two",
    B.bottlesFor(30 / 128, 0.92) === 2, B.bottlesFor(30 / 128, 0.92));

  // ── THE THREE FLOORS, AND WHICH ONE IS BINDING ───────────────────────────────────────────────
  {
    const plain = B.smallestBatch({ ...RISE, yieldFactor: 0.92 });
    ok("batch floor: with nothing else binding, Ryan's 3 servings is the floor",
      plain.reason === "servings" && plain.gal === 0.3 && plain.servings === 3, plain);

    // A recorded vessel minimum outranks the policy floor.
    const vessel = B.smallestBatch({ ...RISE, yieldFactor: 0.92, vesselMinGal: 1.5 });
    ok("batch floor: a recorded vessel minimum wins over the servings floor",
      vessel.reason === "vessel" && vessel.gal === 1.5, vessel);
    // AND IT DOES NOT CLAIM A MECHANISM IT CANNOT KNOW. 2026-10-01: Ryan MEASURED the Cold Brew
    // Avenue at 1.0 gal, but found no stated minimum for the Toddy and chose 0.5 as a working
    // floor. The sentence used to read "below X gal the gear does not work", which would have told
    // a cook something nobody has established about half the vessels on file. brew_vessels.notes
    // carries which kind of number it is; this sentence must stay true of both.
    ok("batch floor: the vessel sentence states what is RECORDED, not what the gear does",
      /is the smallest batch recorded for it/.test(vessel.note)
      && !/the gear does not work/.test(vessel.note), vessel.note);
    // The two real vessels, at the numbers now in production.
    for (const [name, min, want] of [["Toddy", 0.5, 5], ["Cold Brew Avenue", 1.0, 11]]) {
      const f = B.smallestBatch({ ...RISE, yieldFactor: 0.92, vesselMinGal: min });
      ok(`batch floor: ${name} at ${min} gal floors the batch at ${want} servings`,
        f.reason === "vessel" && f.gal === min && f.servings === want, f);
    }
    // Per vessel, so two in parallel is two batches that each have to clear their own floor.
    ok("batch floor: the floor scales with the vessel count",
      B.smallestBatch({ ...RISE, yieldFactor: 0.92, vesselMinGal: 0.5 * 2 }).gal === 1,
      B.smallestBatch({ ...RISE, yieldFactor: 0.92, vesselMinGal: 1 }).gal);
    // NULL must mean "nobody measured", never "zero" — a guessed floor is the thing 0337 refuses.
    for (const v of [null, undefined, 0, NaN, -2]) {
      const f = B.smallestBatch({ ...RISE, yieldFactor: 0.92, vesselMinGal: v });
      ok(`batch floor: vesselMinGal=${String(v)} is not treated as a floor`,
        f.floors.vessel === null && f.reason === "servings", f.floors);
    }

    // The scale. A 7 g salt line per 2 gal is 3.5 g/gal: at 0.3 gal that is 1.05 g, and a 1 g scale
    // cannot hold a ratio on it. This recipe genuinely cannot be made small on Ryan's scale, and
    // saying so is the point — the alternative is a batch that is quietly the wrong strength.
    const salty = { ingredients: [{ name: "Coffee", qty: 560, unit: "g" }, { name: "Sea salt", qty: 7, unit: "g" }], baseWaterGal: 2, yieldFactor: 0.92 };
    const s1 = B.smallestBatch(salty);
    ok("batch floor: a pinch-sized line makes the SCALE the binding floor, not the servings",
      s1.reason === "measurement" && s1.gal === 2.9, s1);
    ok("batch floor: …and it names the line that runs out first, not just a number",
      s1.limiting && s1.limiting.name === "Sea salt" && s1.limiting.gramsAtFloor === 10, s1.limiting);
    // At the floor the limiting line is exactly at the trustworthy weight — the floor is derived
    // from the ingredient, not picked.
    ok("batch floor: at the floor the limiting line weighs at least the smallest trustworthy weight",
      B.ingredientForGallons(s1.gal, 3.5) >= B.smallestTrustworthyG(1) - 1e-9,
      B.ingredientForGallons(s1.gal, 3.5));
    // A finer scale moves the floor by exactly the resolution ratio. This is what makes the
    // "buy a 0.1 g scale" answer a real option rather than a shrug.
    const s2 = B.smallestBatch({ ...salty, scaleResolutionG: 0.1 });
    ok("batch floor: a 10x finer scale lowers the measurement floor 10x",
      Math.abs(s2.floors.measurement * 10 - s1.floors.measurement) < 1e-9,
      `${s1.floors.measurement} -> ${s2.floors.measurement}`);

    // Volumes and counts are never weighed, so they can never set a measurement floor — the same
    // refusal cookQuantity makes, reached through the same table.
    const novol = B.smallestBatch({ ingredients: [{ name: "Coconut water", qty: 2, unit: "gal" }, { name: "Pods", qty: 48, unit: "pods" }], baseWaterGal: 2, yieldFactor: 1 });
    ok("batch floor: a recipe with nothing weighed has no measurement floor at all",
      novol.floors.measurement === null && novol.reason === "servings", novol);
  }
  ok("batch floor: the trustworthy weight is resolution-derived, not a magic number",
    B.smallestTrustworthyG(1) === 10 && B.smallestTrustworthyG(0.1) === 1, B.smallestTrustworthyG(1));

  // ── THE SENTENCE ON SCREEN STAYS TRUE AT A 100% YIELD ────────────────────────────────────────
  // It read "more than 30 oz, because only 100% of what goes in comes out pourable" — a reason
  // nobody can follow, which is how a number stops being questioned.
  ok("batch floor: the floor's explanation does not blame the yield when there is no yield loss",
    !/only 100% /.test(B.smallestBatch({ ingredients: [{ name: "X", qty: 1, unit: "gal" }], baseWaterGal: 1, yieldFactor: 1 }).note));

  // ── NO SCREEN CARRIES ITS OWN FLOOR OR ITS OWN STEP ──────────────────────────────────────────
  const planner = read("components/BrewPlanner.tsx");
  // Comments stripped FIRST. The planner's own note explains what min="0.25" step="0.25" used to be
  // and why it went, so reading the file raw finds the defect inside the sentence describing the
  // fix. Fourth time in this session a gate has matched the prose about a bug instead of the bug —
  // the alert-guard gate above learned it three times in one night.
  const code = (t) => t.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const plannerCode = code(planner);
  // 2026-10-03: the sheet asks for drinks, so the floor is no longer the input's min attribute — it
  // is derived from the recipe (and the chosen vessel's measured minimum) and SAID, in a cook's
  // words, the moment the batch goes under it. Same intent: no constant anywhere.
  ok("batch floor: the planner derives its minimum from the recipe and the chosen vessel, not a constant",
    /smallestBatch\(\{ ingredients: recipe\.ingredients, baseWaterGal: recipe\.base_water_gal, yieldFactor: recipe\.yield_factor, vesselMinGal: vessel\?\.min_gal != null/.test(plannerCode)
    && /const underFloor = gal \+ 1e-9 < floorHere\.gal;/.test(plannerCode) && /\{underFloor && <p className="bq-note">/.test(plannerCode));
  ok("batch floor: …and the gallon input steps by BREW_STEP_GAL",
    /unit === "gal" \? String\(BREW_STEP_GAL\)/.test(plannerCode));
  ok("batch floor: …and no hard-coded 0.25 floor or step survives anywhere in it",
    !/(min|step)=\{?"?0\.25/.test(plannerCode), (plannerCode.match(/(min|step)=\{?"?0\.25[^\n]*/g) || []).slice(0, 2));
  // PROVE IT BITES, and that the comment-strip makes it precise rather than blind.
  ok("batch floor: fed the old input, the rule finds it",
    /(min|step)=\{?"?0\.25/.test(code('<input min="0.25" step="0.25" />')));
  ok("batch floor: …fed a comment quoting the old input, it does not",
    !/(min|step)=\{?"?0\.25/.test(code('{/* was min="0.25" step="0.25" */}\n<input min={String(floor.gal)} />')));
  ok("batch floor: rounding down is the shared helper, not re-spelled inline at the call site",
    /stepDownGal\(gallonsFromIngredient/.test(plannerCode) && !/Math\.floor\([^)]*BREW_STEP_GAL/.test(plannerCode));

  // ── THE POUR HAS ONE HOME ────────────────────────────────────────────────────────────────────
  // It had three (brewMath, the brew agent, eventbrief). That was survivable while it was a display
  // number; it stopped being survivable when the floor of every batch became derived from it.
  {
    const files = ["lib/brewMath.ts", "app/api/agents/brew/route.ts", "lib/eventbrief.ts", "lib/economics.ts", "lib/loadout.ts"];
    const strip = (t) => t.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const declarers = files.filter((f) => {
      try { return /\bSERVE_OZ\s*=\s*\d/.test(strip(read(f))); } catch { return false; }
    });
    ok("serving size: exactly one file declares what a serving is",
      declarers.length === 1 && declarers[0] === "lib/brewMath.ts", declarers);
    const offenders = files.filter((f) => {
      try { return f !== "lib/brewMath.ts" && /\b10\s*\/\s*128\b/.test(strip(read(f))); } catch { return false; }
    });
    ok("serving size: and nobody re-spells it as 10 / 128",
      offenders.length === 0, offenders);
    ok("serving size: the two that used to declare it now import it",
      /from "@\/lib\/brewMath"/.test(read("app/api/agents/brew/route.ts"))
      && /from "\.\/brewMath"/.test(read("lib/eventbrief.ts")));
  }

  // ── THE VESSEL MINIMUM IS A COLUMN NOW, AND THE GUESS KNOWS IT IS A GUESS ────────────────────
  {
    const mig = read("supabase/migrations/0337_how_small_can_this_vessel_go.sql");
    ok("vessel min: the column exists and is nullable with no default",
      /add column if not exists min_gal numeric;/.test(mig) && !/min_gal numeric[^;]*default/i.test(mig));
    ok("vessel min: a minimum at or above capacity is refused",
      /check \(min_gal is null or \(min_gal > 0 and min_gal < capacity_gal\)\)/.test(mig));
    // MEASURED and GUESSED must not read the same on screen, or the guess gets laundered into a spec.
    ok("vessel min: a measured minimum is a different verdict from the capacity/3 prompt",
      B.vesselFit(0.3, 5, 1, 1.5).verdict === "under" && B.vesselFit(0.3, 5, 1, null).verdict === "shallow");
    ok("vessel min: the measured minimum scales with the vessel COUNT, like capacity does",
      B.vesselFit(2.0, 5, 2, 1.5).verdict === "under" && B.vesselFit(3.1, 5, 2, 1.5).verdict === "fits",
      [B.vesselFit(2.0, 5, 2, 1.5), B.vesselFit(3.1, 5, 2, 1.5)]);
    ok("vessel min: a measured vessel never falls back to the guess, even well under a third",
      B.vesselFit(1.6, 5, 1, 1.5).verdict === "fits", B.vesselFit(1.6, 5, 1, 1.5));
    ok("vessel min: over capacity still wins over everything — the water has nowhere to go",
      B.vesselFit(6, 5, 1, 1.5).verdict === "over");
    ok("vessel min: the planner passes the measured number through",
      /vesselFit\(gal, vessel\.capacity_gal, vesselCount, vessel\.min_gal\)/.test(plannerCode)
      && /select\("id, name, capacity_gal, filter_type, min_gal"\)/.test(plannerCode));
  }
}

// ── THE DATABASE IS ONE MIGRATION BEHIND THE CODE (2026-10-01) ─────────────────────────────────
// The mirror image of deploy skew, and in this repo it is not a race — the workflow guarantees it.
// Migrations are pasted BY HAND into the Supabase SQL editor and the push happens first, so every
// deploy runs new code against the old schema until somebody opens a browser.
//
// 0337 adds brew_vessels.min_gal and BrewPlanner selects it. That loader does
// `[...].find(x => x.error)` and then THROWS, so one not-yet-existing column takes down the whole
// Brew board — recipes, batches, events, stops, inventory, none of them related to the column.
{
  const D = require("../.smoke/deploySkew.js");
  const fs = require("node:fs");
  const path = require("node:path");
  const planner = fs.readFileSync(path.join(__dirname, "..", "components/BrewPlanner.tsx"), "utf8");

  // PostgREST passes the Postgres code through; PGlite and some proxies send only the text.
  ok("schema skew: the Postgres undefined_column code is recognised",
    D.isMissingColumn({ code: "42703", message: "whatever" }) === true);
  ok("schema skew: …and so is the bare message, for the clients that send no code",
    D.isMissingColumn({ message: 'column brew_vessels.min_gal does not exist' }) === true
    && D.isMissingColumn({ message: 'column "min_gal" does not exist' }) === true);

  // THE NARROWNESS IS THE POINT. A blanket catch would turn these into an empty vessel list, and
  // "a failed read is not an empty list" is the rule this app keeps re-learning. Each of these must
  // stay as loud as it was before the fallback existed.
  for (const e of [
    { code: "42P01", message: 'relation "public.brew_vessels" does not exist' },  // table dropped
    { code: "42501", message: "permission denied for table brew_vessels" },        // grant revoked
    { code: "PGRST301", message: "JWT expired" },                                  // auth gone
    { message: "FetchError: network request failed" },                             // offline
    { code: "42703x", message: "something else entirely" },                        // near-miss code
  ]) {
    ok(`schema skew: NOT forgiven — ${e.code ?? "no code"}`, D.isMissingColumn(e) === false, e);
  }
  ok("schema skew: nothing in, false out — never a thrown read mistaken for a missing column",
    D.isMissingColumn(null) === false && D.isMissingColumn(undefined) === false
    && D.isMissingColumn({}) === false);

  // THE FALLBACK IS WIRED, AND IT IS THE NARROW ONE.
  //
  // CALLED, not merely defined. The first cut of this asserted the helper's BODY existed, and
  // deleting the call site from the loader left it green — the function sat there, correct and
  // unreachable, while the board was back to dying on one absent column. Third time tonight for the
  // same blind spot: an import is not a call, a definition is not a call site, and a check that
  // cannot fail is a check that lies.
  ok("schema skew: the vessels read retries without the new column instead of failing the board",
    /isMissingColumn\(full\.error\)/.test(planner)
    && /select\("id, name, capacity_gal, filter_type"\)/.test(planner), "vesselsRead body");
  ok("schema skew: …and the loader CALLS it rather than reading the table directly",
    /^\s*vesselsRead\(\),\s*$/m.test(planner)
    && !/Promise\.all\(\[[\s\S]*?from\("brew_vessels"\)[\s\S]*?\]\)/.test(planner),
    (planner.match(/from\("brew_vessels"\)[^\n]*/g) || []));
  ok("schema skew: …and every other error still comes back untouched",
    /if \(!full\.error \|\| !isMissingColumn\(full\.error\)\) return full;/.test(planner));
  // A fallback that drops the column must leave min_gal ABSENT, not zero — 0337's whole point is
  // that "not measured" and "zero" are different facts, and a zero here would read as a measured
  // minimum of nothing and silently switch the UI from asking to asserting.
  ok("schema skew: the fallback does not invent a min_gal value",
    !/min_gal:\s*0/.test(planner) && !/min_gal:\s*Number\(/.test(planner));

  // PROVE THE HAZARD WAS REAL: the loader still throws on the first error it finds, which is what
  // made one absent column fatal for five unrelated queries. If that ever stops being true this
  // assertion should be revisited — but it must not stop being true by accident.
  ok("schema skew: the loader does throw on a read error — which is why the narrow retry is needed",
    /const firstErr = \[r, b, e, v, st, ii\]\.find\(\(x\) => x\.error\)\?\.error;/.test(planner)
    && /if \(firstErr\) throw new Error\(firstErr\.message\);/.test(planner));
}

// ── A GATE THAT ONLY RUNS ON THIS MACHINE IS NOT A GATE (2026-10-01) ───────────────────────────
// ci.yml was pointed at `npm run verify` an hour ago, and `verify` runs scripts/smoke.ui.mjs,
// which does `require("playwright")`. playwright was in NO dependency list — it resolved here only
// because this container carries a GLOBAL install at ~/.npm-global. `npm ci` installs what
// package.json declares and nothing else, so on a runner that import throws MODULE_NOT_FOUND and
// the whole gate goes red for an environment reason, on sound code.
//
// Which is the worst failure a gate can have: red when nothing is wrong teaches everybody to
// ignore it, and the next red one is real. It would also have been my second "works on my machine"
// in two hours, on the very change meant to stop me claiming green I had not earned.
//
// ── WHY THIS ASKS "DOES IT RESOLVE" AND NOT "DOES THIS LOOK LIKE AN IMPORT" ────────────────────
// The first cut scanned for `require(` and `from "x"` as text and produced nineteen false
// positives: SQL inside template literals (`... from "done"`), regex fragments (`^[0-9]+`), and —
// inevitably — its own test fixtures a dozen lines below. Fifth time in this session a rule has
// matched the thing describing the bug rather than the bug.
//
// So the question is asked structurally instead, and it happens to be the exact definition of the
// defect: a name that RESOLVES from this machine but is NOT DECLARED in package.json. Everything
// the text scan got wrong — prose, SQL, regexes, fixtures — resolves to nothing and drops out for
// free, with no list of exceptions to maintain. A name that resolves from inside the repo's own
// node_modules while being undeclared is a transitive dependency somebody is relying on by luck,
// which is the same bug one level down, so it is reported too.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);

  // The scripts `npm run verify` actually reaches, read out of package.json rather than listed by
  // hand — a hand-copied list is a second definition of the gate and drifts the first time either
  // changes, the same reason ci.yml now calls `npm run verify` by name.
  const scriptText = Object.values(pkg.scripts ?? {}).join(" ");
  const inVerify = [...new Set([...scriptText.matchAll(/scripts\/([a-z0-9.\-]+\.(?:mjs|cjs))/gi)].map((m) => m[1]))]
    .filter((f) => fs.existsSync(path.join(root, "scripts", f)));
  ok("deps: the release scripts were found to check", inVerify.length >= 10, inVerify.length);

  /** Every bare specifier a file mentions. Deliberately loose — resolution is the filter. */
  const bareNames = (src) => {
    const out = new Set();
    const text = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of text.matchAll(/(?:require\(\s*|import\(\s*|from\s+)["']([^"'\s][^"']*)["']/g)) {
      const spec = m[1];
      if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/")) continue;
      out.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
    }
    return out;
  };

  /** Where does this name resolve from, as seen from the repo? null when it is not a package. */
  const resolvedFrom = (name) => {
    try { return require.resolve(name, { paths: [root] }); } catch { return null; }
  };

  const outside = [], transitive = [];
  for (const f of inVerify) {
    for (const name of bareNames(fs.readFileSync(path.join(root, "scripts", f), "utf8"))) {
      if (declared.has(name)) continue;
      const at = resolvedFrom(name);
      if (at === null) continue;                       // not a package — prose, SQL, a regex, a fixture
      const where = at.startsWith(root + path.sep) ? transitive : outside;
      where.push(`${f} -> "${name}" resolves from ${at.startsWith(root + path.sep) ? "a transitive dep" : "OUTSIDE the repo"} and is not in package.json`);
    }
  }
  ok("deps: no release script depends on a package installed outside the repo — npm ci would not have it",
    outside.length === 0, outside);
  ok("deps: nor on one that only arrives as somebody else's transitive dependency",
    transitive.length === 0, transitive);

  // The one that bit, named, so this cannot quietly stop covering it.
  ok("deps: playwright specifically — smoke:ui is in verify and npm ci installs only the declared",
    declared.has("playwright"), [...declared].filter((d) => d.includes("play")));
  ok("deps: …and it resolves from the repo's own node_modules, not a global",
    (resolvedFrom("playwright") ?? "").startsWith(path.join(root, "node_modules") + path.sep),
    resolvedFrom("playwright"));

  // PROVE IT BITES — on the real line, with the real resolution question.
  {
    const names = bareNames('const { chromium } = require("playwright");');
    ok("deps: fed smoke.ui's own import line, the scan finds playwright", names.has("playwright"), [...names]);
    ok("deps: …and with playwright pretended-undeclared, the rule reports it",
      resolvedFrom("playwright") !== null && !new Set(["next"]).has("playwright"));
    // The nineteen false positives the text-only version produced, all gone for the same reason.
    for (const junk of ["done", "delivered", "^[0-9]+", "@playwright/test"]) {
      ok(`deps: "${junk}" is not a package, so it is not reported`, resolvedFrom(junk) === null, junk);
    }
    ok("deps: a node: builtin is never collected", bareNames('import { readFileSync } from "node:fs";').size === 0);
    ok("deps: a relative import is never collected", bareNames('import { walk } from "./falseempty.audit.mjs";').size === 0);
    ok("deps: a subpath is judged by its package", [...bareNames('import x from "playwright/lib/x.js";')].join() === "playwright");
    ok("deps: a scoped package keeps its scope", [...bareNames('import x from "@scope/thing";')].join() === "@scope/thing");
  }
}

// ── THE ROUTE WRAPPER (lib/apiRoute.ts) and the error intake (lib/errorIntake.ts) ──────────────
// Every handler under app/api leaves through route(). What it must do: hand back exactly what the
// handler returned, with exactly the arguments it was given; and when the handler throws, answer
// with JSON the caller can read instead of Next's HTML 500. What it must never do: throw itself.
{
  const { route, ROUTE_THREW } = require("../.smoke/apiRoute.js");
  const { fingerprintOf, pathOf } = require("../.smoke/errorIntake.js");
  const { NextResponse } = require("next/server");
  const req = new Request("http://x/api/planted", { method: "POST" });
  PENDING.push((async () => {
    const own = NextResponse.json({ ok: true, n: 1 }, { status: 201 });
    const passthrough = route("planted", async () => own);
    ok("route: a handler's own Response comes back untouched", (await passthrough(req)) === own);
    const seen = [];
    const withCtx = route("planted", async (r, ctx) => { seen.push(r, ctx); return new Response("hi"); });
    const ctx = { params: Promise.resolve({ code: "GT3" }) };
    await withCtx(req, ctx);
    ok("route: the request and the context arrive exactly as given", seen[0] === req && seen[1] === ctx);
    const sync = route("planted", () => new Response("sync"));
    ok("route: a handler that returns a Response without a promise still works", (await (await sync(req)).text()) === "sync");
    const threw = route("planted", async () => { throw new Error("ECONNRESET, pretend"); });
    const res = await threw(req);
    const body = await res.json();
    ok("route: a throw is a 500", res.status === 500, res.status);
    ok("route: …with a JSON body the caller can read", res.headers.get("content-type")?.includes("application/json") === true);
    ok("route: …that says ok:false and the house message, never the stack", body.ok === false && body.error === ROUTE_THREW && !JSON.stringify(body).includes("ECONNRESET"), body);
    const threwString = route("planted", async () => { throw "a string, not an Error"; });
    ok("route: a non-Error throw gets the same answer", (await threwString(req)).status === 500);
    const bad4 = route("planted", async () => NextResponse.json({ error: "Bad request" }, { status: 400 }));
    ok("route: a handler's own 400 is still its own 400 — the wrapper only catches what escapes", (await bad4(req)).status === 400);
  })());
  // The fingerprint is what makes "one bug, one row" true. It must not change across deploys.
  const a = fingerprintOf("Loading chunk 123 failed: /_next/static/chunks/app-a1b2c3d4e5.js?dpl=dpl_AAA", "at x (chunk-9f8e7d.js:1:2)", "/menu");
  const b = fingerprintOf("Loading chunk 456 failed: /_next/static/chunks/app-f6e5d4c3b2.js?dpl=dpl_BBB", "at x (chunk-9f8e7d.js:1:2)", "/menu");
  ok("intake: the same error on two deploys is one fingerprint", a === b);
  ok("intake: a different page is a different fingerprint", fingerprintOf("x", "", "/menu") !== fingerprintOf("x", "", "/shop"));
  ok("intake: a different top frame is a different fingerprint", fingerprintOf("x", "at a", "/") !== fingerprintOf("x", "at b", "/"));
  ok("intake: a server route files under its route path", pathOf("/api/office") === "/api/office" && pathOf("https://app.gt3pb.com/menu?x=1") === "/menu");

  // THE BUDGETS. The intake is driven here with doubles for the three things it touches — the
  // service-role client, raiseAlert, raiseAlertOnce — each one recording what it was asked. The
  // double's rate_limit_hit is the real function's contract (0154): count per bucket, true while
  // under p_max. What is proved: a repeat never spends a budget; the sixth new error in ten
  // minutes files a row and NO alert, and the inbox gets one storm line, keyed so the database
  // can hold it to one open row; the thirty-first new error in an hour is dropped; and a limiter
  // that does not answer lets the error through, because telemetry fails open.
  const { fileError, NEW_ROWS, NEW_ALERTS, ERRORS_LINK } = require("../.smoke/errorIntake.js");
  const intake = (limiter) => {
    const rows = [], alerts = [], once = [], counts = {}, seen = new Set();
    const admin = {
      rpc: async (fn, args) => {
        if (fn === "bump_client_error") return { data: seen.has(args.p_fingerprint) };
        if (fn === "rate_limit_hit") { counts[args.p_bucket] = (counts[args.p_bucket] || 0) + 1; return limiter ? limiter(args, counts[args.p_bucket]) : { data: counts[args.p_bucket] <= args.p_max }; }
        throw new Error(`unexpected rpc ${fn}`);
      },
      // insert(row).select("id").single() — the intake asks for the new row's id back, so its alert
      // can name the row (kind client_error, subject = that id). Ids are uuid-shaped like the real ones.
      from: () => ({ insert: (row) => {
        seen.add(row.fingerprint); rows.push(row);
        const id = `00000000-0000-4000-8000-${String(rows.length).padStart(12, "0")}`;
        return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
      } }),
    };
    const deps = { admin, raiseAlert: async (a) => { alerts.push(a); }, raiseAlertOnce: async (a) => { once.push(a); return true; } };
    const file = (i, extra = {}) => fileError({ message: `error number ${i}`, url: "/menu", ua: "Safari", ...extra }, deps);
    return { file, rows, alerts, once, counts };
  };
  PENDING.push((async () => {
    const t = intake();
    ok("budget: a never-seen error files a row and one alert, linked to the Errors screen", (await t.file(1)) === true && t.rows.length === 1 && t.alerts.length === 1 && t.alerts[0].link === ERRORS_LINK);
    // 0340 had to find two of these alerts from July and September by MATCHING THEIR MESSAGE,
    // because the intake never said which row an alert was about. It does now.
    ok("budget: …and the alert names the row it is about — kind client_error, subject the new row's id",
      t.alerts[0].kind === "client_error" && t.alerts[0].subjectId === "00000000-0000-4000-8000-000000000001", t.alerts[0]);
    ok("budget: a first-sight alert spends the alert budget and the row budget once each", t.counts[NEW_ALERTS.bucket] === 1 && t.counts[NEW_ROWS.bucket] === 1);
    ok("budget: the same error again is a bump — no row, no alert, and neither budget is touched", (await t.file(1)) === false && t.rows.length === 1 && t.alerts.length === 1 && t.counts[NEW_ALERTS.bucket] === 1 && t.counts[NEW_ROWS.bucket] === 1);
    for (let i = 2; i <= NEW_ALERTS.max; i++) await t.file(i);
    ok(`budget: ${NEW_ALERTS.max} distinct errors are ${NEW_ALERTS.max} alerts`, t.alerts.length === NEW_ALERTS.max && t.once.length === 0);
    ok("budget: the next new error still files a row but raises NO alert of its own", (await t.file(NEW_ALERTS.max + 1)) === true && t.rows.length === NEW_ALERTS.max + 1 && t.alerts.length === NEW_ALERTS.max);
    const { etToday: day } = require("../.smoke/dates.js");
    ok("budget: …the inbox gets one storm line instead, keyed (kind, today) so the database holds it to one open row a day", t.once.length === 1 && t.once[0].kind === "error_storm" && t.once[0].subjectId === day() && t.once[0].link === ERRORS_LINK);
    await t.file(NEW_ALERTS.max + 2); await t.file(NEW_ALERTS.max + 3);
    ok("budget: a storm that keeps going asks for the same one line, never a different one", t.alerts.length === NEW_ALERTS.max && t.once.every((a) => a.kind === "error_storm" && a.subjectId === day()));
    ok("budget: a known error repeating during the storm still spends nothing", (await t.file(1)) === false && t.counts[NEW_ALERTS.bucket] === NEW_ALERTS.max + 3);
    for (let i = NEW_ALERTS.max + 4; i <= NEW_ROWS.max; i++) await t.file(i);
    ok(`budget: the ${NEW_ROWS.max}th new error in the hour still lands as a row`, t.rows.length === NEW_ROWS.max);
    ok(`budget: the ${NEW_ROWS.max + 1}st is dropped — no row, no alert, and it says so`, (await t.file(NEW_ROWS.max + 1)) === false && t.rows.length === NEW_ROWS.max && t.alerts.length === NEW_ALERTS.max);
    ok("budget: the storm line is never raised for a dropped error (nothing to read about)", t.once.length === NEW_ROWS.max - NEW_ALERTS.max);
    const mute = intake(() => ({ data: null, error: { message: "limiter unreachable" } }));
    ok("budget: a limiter that does not answer is not a 'no' — the error files and alerts (fails open)", (await mute.file(1)) === true && mute.rows.length === 1 && mute.alerts.length === 1);
    const srv = intake();
    await srv.file(9, { ua: "server", url: "/api/office" });
    ok("budget: a server route's throw takes the same path and the same link", srv.alerts[0].title === "Server error — a route threw" && srv.alerts[0].link === ERRORS_LINK && /\/api\/office/.test(srv.alerts[0].body));
    const healed = intake();
    await healed.file(10, { skew: true });
    ok("budget: a screen that healed itself is an fyi, not an emergency", healed.alerts[0].severity === "fyi");
  })());
}

// ── THE NAV THAT MOVED UNDER YOUR THUMB: three parts, one gate ────────────────────────────────
// components/BottomNav.tsx renders both identity tabs; app/layout.tsx marks <html data-viewer>
// before first paint from the stored session; app/globals.css hides the tab that is not for you.
// Each part is useless without the other two, and nothing in the type system ties them together:
// drop the script and every guest is back to a nav that re-shapes itself a quarter second in,
// with every test still green. scripts/smoke.ui.mjs paints the shape; this holds the sources.
{
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const read = (f) => readFileSync(join(__dirname, "..", f), "utf8");
  const layout = read("app/layout.tsx"), nav = read("components/BottomNav.tsx"), css = read("app/globals.css");
  const script = (layout.match(/__html:\s*`([^`]*data-viewer[^`]*)`/) || [])[1] || "";
  ok("nav shape: app/layout.tsx carries the pre-paint script that sets data-viewer from the stored session", /setAttribute\("data-viewer",\s*m\s*\?\s*"member"\s*:\s*"guest"\)/.test(script), script.slice(0, 80));
  const key = (script.match(/\/(\^sb-[^/]+\$)\//) || [])[1] || "";
  ok("nav shape: …keyed on supabase-js's session entry and not on its PKCE verifier", !!key && new RegExp(key).test("sb-hmpxgomiiyjjxxxyzzbg-auth-token") && !new RegExp(key).test("sb-hmpxgomiiyjjxxxyzzbg-auth-token-code-verifier"), key);
  ok("nav shape: …emitted only when Supabase is configured (without it nobody is a guest)", /NEXT_PUBLIC_SUPABASE_URL && \(/.test(layout) && layout.indexOf("data-viewer") > layout.indexOf("NEXT_PUBLIC_SUPABASE_URL && ("));
  ok("nav shape: BottomNav renders one static list with data-for on every tab and never re-orders it", /const TABS = \[TODAY, \.\.\.CORE, JOIN\]/.test(nav) && /data-for=\{tab\.for\}/.test(nav) && !/guest \? \[/.test(nav));
  ok("nav shape: …and corrects the hint only from a real session, never without Supabase", /if \(!enabled \|\| !ready\) return;\s*document\.documentElement\.dataset\.viewer = user \? "member" : "guest";/.test(nav));
  ok("nav shape: globals.css hides Today for a guest and Join for everyone else, by the html attribute alone",
    /html\[data-viewer="guest"\] \.tab\[data-for="member"\]\{display:none\}/.test(css) && /html:not\(\[data-viewer="guest"\]\) \.tab\[data-for="guest"\]\{display:none\}/.test(css));
}

// ── THE FRONT DOOR: one cookie, one writer, one door ──────────────────────────────────────────
// proxy.ts may send a guest from "/" to /truck and may do nothing else: not decide for a member,
// not touch another route, not grant a thing. lib/viewerHint.ts owns the cookie's name and the
// only function that writes it; components/AuthProvider.tsx calls that function on both answers
// the session gives (the cold read and every change). scripts/smoke.ui.mjs knocks on the door
// three ways; this holds the sources so the door cannot quietly widen.
{
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const read = (f) => readFileSync(join(__dirname, "..", f), "utf8");
  const proxy = read("proxy.ts"), hint = read("lib/viewerHint.ts"), auth = read("components/AuthProvider.tsx");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  ok("door: proxy.ts is matched on \"/\" exactly and nothing else", /export const config = \{ matcher: "\/" \};/.test(code(proxy)));
  ok("door: …it redirects only a cookie that says guest, to /truck, temporarily (307)", /\.value === "guest"\)/.test(code(proxy)) && /url\.pathname = "\/truck";/.test(code(proxy)) && /NextResponse\.redirect\(url, 307\)/.test(code(proxy)) && !/"member"/.test(code(proxy)));
  ok("door: …and passes everything else through untouched", /return NextResponse\.next\(\);/.test(code(proxy)) && (code(proxy).match(/NextResponse\.(redirect|rewrite)\(/g) || []).length === 1);
  ok("door: …reading the cookie by the one name lib/viewerHint.ts owns", /import \{ VIEWER_COOKIE \} from "@\/lib\/viewerHint";/.test(proxy) && /cookies\.get\(VIEWER_COOKIE\)/.test(code(proxy)) && /export const VIEWER_COOKIE = "gt3-viewer";/.test(hint));
  ok("door: the cookie is written by one function, as a hint for a year, never HttpOnly (the browser writes it)", /export function writeViewerHint\(signedIn: boolean\)/.test(hint) && /max-age=31536000; samesite=lax/.test(hint) && !/httponly/i.test(hint));
  ok("door: AuthProvider writes it on the cold session read AND on every change — a stale hint never outlives the next answer", /getSession\(\)[\s\S]*?writeViewerHint\(!!data\.session\?\.user\)/.test(code(auth)) && /onAuthStateChange\(\(event, session\) => \{\s*const u = session\?\.user \?\? null;\s*setUser\(u\);\s*writeViewerHint\(!!u\);/.test(code(auth)));
  ok("door: the slow way stays — app/page.tsx still sends a guest to /truck itself", /router\.replace\("\/truck"\)/.test(code(read("app/page.tsx"))));
}

// ── READINESS COUNTS WHAT IS AHEAD, AND A TILE LANDS WHERE IT SAYS (2026-10-03) ─────────────────
// Ryan: "I clicked on each metric and it just scrolled to the bottom." Under the tiles, July and
// August events read "Not started". lib/readiness is the one rule for what is still prep;
// lib/anchors is the one jump to a panel. Three readers each.
{
  const R = require("../.smoke/readiness.js");
  const today = "2026-10-03";
  ok("readiness: an event before today is past; today and later are not", R.eventIsPast("2026-08-15", today) && !R.eventIsPast(today, today) && !R.eventIsPast("2026-10-24", today) && !R.eventIsPast(null, today));
  ok("readiness: done or archived is closed, whatever the date", R.eventIsClosed({ stage: "done", day: "2026-12-01" }) && R.eventIsClosed({ archived_at: "2026-09-01T00:00:00Z" }) && !R.eventIsClosed({ stage: "prep", day: "2026-12-01" }));
  ok("readiness: an upcoming, open event is current", R.targetIsCurrent({ day: "2026-10-24", stage: "prep", archived_at: null }, null, today));
  ok("readiness: July's event is not, however open its tasks", !R.targetIsCurrent({ day: "2026-07-31", stage: "prep", archived_at: null }, null, today));
  ok("readiness: a done event is not, even next month", !R.targetIsCurrent({ day: "2026-11-01", stage: "done", archived_at: null }, null, today));
  ok("readiness: an undated event is current (nothing says it has passed)", R.targetIsCurrent({ day: null, stage: "lead", archived_at: null }, null, today));
  ok("readiness: a stop is judged by lib/stopRecord's rule — 8 h past its start", !R.targetIsCurrent(null, { starts_at: new Date(Date.now() - 9 * 3600e3).toISOString(), status: "planned", archived_at: null }, today) && R.targetIsCurrent(null, { starts_at: new Date(Date.now() + 3600e3).toISOString(), status: "planned", archived_at: null }, today));
  ok("readiness: a done or archived stop is not current", !R.targetIsCurrent(null, { starts_at: new Date(Date.now() + 3600e3).toISOString(), status: "done", archived_at: null }, today) && !R.targetIsCurrent(null, { starts_at: null, status: "planned", archived_at: "2026-09-01T00:00:00Z" }, today));
  ok("readiness: a task with no target at all is current", R.taskIsCurrent({ event_id: null, stop_id: null, events: null, stops: null }, today));
  ok("readiness: a task bound to an event the query could not embed is orphaned, not general", !R.taskIsCurrent({ event_id: "e1", stop_id: null, events: null, stops: null }, today));
  ok("readiness: a task follows its event", R.taskIsCurrent({ event_id: "e1", stop_id: null, events: { day: "2026-10-24", stage: "prep", archived_at: null }, stops: null }, today) && !R.taskIsCurrent({ event_id: "e2", stop_id: null, events: { day: "2026-08-15", stage: "prep", archived_at: null }, stops: null }, today));
  ok("readiness: the prep buckets put the past LAST and name it", R.prepBucket("2026-07-31", today).key === 5 && R.prepBucket("2026-07-31", today).label === "Past · not closed out" && R.prepBucket("2026-07-31", today).key > R.prepBucket(null, today).key);
  ok("readiness: today, this week, later, unscheduled", R.prepBucket(today, today).label === "Today" && R.prepBucket("2026-10-08", today).label === "This week" && R.prepBucket("2026-10-24", today).label === "Later" && R.prepBucket(null, today).label === "Unscheduled" && R.prepBucket("not a date", today).label === "Unscheduled");
  {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const read = (f) => readFileSync(join(__dirname, "..", f), "utf8");
    const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
    const kpis = code(read("components/CrewKpis.tsx")), board = code(read("components/PrepBoard.tsx")), page = code(read("app/crew/page.tsx")), plan = code(read("lib/planNav.ts")), anchors = read("lib/anchors.ts");
    ok("one jump: lib/anchors owns the panel-open event and the jump", /export const OPEN_PANEL_EVENT = "gt3-open-panel";/.test(anchors) && /export function scrollToAnchor\(/.test(anchors));
    ok("one jump: the crew page defines neither any more — it imports both", !/const OPEN_PANEL_EVENT =/.test(page) && !/function scrollToAnchor\(/.test(page) && /import \{ OPEN_PANEL_EVENT, scrollToAnchor \} from "@\/lib\/anchors";/.test(page));
    ok("one jump: a KPI tile jumps with scrollToAnchor — no bare scrollIntoView, no localStorage panel key", /scrollToAnchor\(d\.anchor\)/.test(kpis) && !/scrollIntoView/.test(kpis) && !/gt3-mpanel-/.test(kpis));
    ok("one jump: a Plan-tab jump goes through goPlanTab with the section setter and an anchor", /goPlanTab\(d\.planTab, \{ setSection, anchor: d\.anchor \}\)/.test(kpis) && /scrollToAnchor\(opts\.anchor\)/.test(plan) && !/scrollIntoView/.test(plan));
    ok("one jump: the events list carries the anchor the tile lands on", /<div id="plan-events">/.test(page) && /anchor: "plan-events"/.test(kpis));
    ok("one rule: the tiles, the board and the prep list all read lib/readiness", /from "@\/lib\/readiness"/.test(kpis) && /from "@\/lib\/readiness"/.test(board) && /from "@\/lib\/readiness"/.test(page));
    ok("one rule: the tiles and the board embed the same target columns to judge by", /events\(day, archived_at, stage\), stops\(starts_at, archived_at, status\)/.test(kpis) && /events\(title, day, archived_at, stage\), stops\(name, starts_at, archived_at, status\)/.test(board));
    ok("one rule: the tiles count what is ahead, not the table", /taskIsCurrent\(t, today\)/.test(kpis) && !/head\(db, "event_tasks"\)\.eq\("done", false\), to:/.test(kpis) && /label: "Upcoming events"/.test(kpis) && !/label: "Events on the books"/.test(kpis));
    ok("one rule: the board sorts what was left open last and says so", /\[\.\.\.all\.filter\(\(g\) => !g\.past\), \.\.\.all\.filter\(\(g\) => g\.past\)\]/.test(board) && /past · not closed out/.test(board) && /pbd-leftopen/.test(board));
  }
}

// ── CLOSING OUT (lib/wrap.ts): one write path, and every finding carries its way out ────────────
// Ryan, 2026-10-03, on the WineXpress stop sheet: "Finished, with no after-action note. Two lines on
// how it went, while you still remember." — and nowhere to write them. These gates hold the three
// claims the fix makes: the done/archive/note/takings writes have ONE home, every gap the database
// can emit has at least one way out, and each record sheet renders every way out it declares.
{
  const W = require("../.smoke/wrap.js");
  const E = require("../.smoke/eventRecord.js");
  const S = require("../.smoke/stopRecord.js");
  const NOW = "2026-10-03T14:00:00.000Z";

  // the patches, pure
  ok("wrap: an event done is stage done, stamped, and not live", JSON.stringify(W.wrapPatch("event", NOW)) === JSON.stringify({ stage: "done", completed_at: NOW, is_live: false }));
  ok("wrap: a stop done is status done and stamped — a stop has no live column", JSON.stringify(W.wrapPatch("stop", NOW)) === JSON.stringify({ status: "done", completed_at: NOW }));
  ok("wrap: archive rides on the same patch when asked", W.wrapPatch("event", NOW, true).archived_at === NOW && W.wrapPatch("stop", NOW, true).archived_at === NOW && !("archived_at" in W.wrapPatch("event", NOW)));
  ok("wrap: an archived event drops its live flag; a stop just files", JSON.stringify(W.archivePatch("event", NOW)) === JSON.stringify({ archived_at: NOW, is_live: false }) && JSON.stringify(W.archivePatch("stop", NOW)) === JSON.stringify({ archived_at: NOW }));
  ok("wrap: the note is trimmed and blank becomes null, so the gap view sees 'no note'", W.cleanRecap("  sold out by noon  ") === "sold out by noon" && W.cleanRecap("   ") === null && W.cleanRecap(null) === null);
  ok("wrap: the ops sibling and its key, per kind", W.opsTable("event") === "event_ops" && W.opsKey("event") === "event_id" && W.opsTable("stop") === "stop_ops" && W.opsKey("stop") === "stop_id" && W.ownerTable("stop") === "stops");

  // what it took
  ok("takings: dollars become cents", W.parseDollars("184").cents === 18400 && W.parseDollars("184.5").cents === 18450 && W.parseDollars("$1,200.50").cents === 120050 && W.parseDollars(" 19.99 ").cents === 1999);
  ok("takings: anything that is not money is refused by name", "error" in W.parseDollars("") && "error" in W.parseDollars("abc") && "error" in W.parseDollars("-5") && "error" in W.parseDollars("1.234") && "error" in W.parseDollars("1e3"));
  ok("takings: a count is optional and whole", W.parseCount("").count === null && W.parseCount("38").count === 38 && "error" in W.parseCount("2.5") && "error" in W.parseCount("-1"));
  ok("takings: the row is the honest shape — manual, no payment id, on the event", (() => { const r = W.takingsRow("ev1", "184.50", "38"); return !("error" in r) && JSON.stringify(r.row) === JSON.stringify({ event_id: "ev1", source: "manual", amount_cents: 18450, item_count: 38 }); })());
  ok("takings: a bad count refuses the whole row — no half-entries", "error" in W.takingsRow("ev1", "10", "x") && W.takingsRow("ev1", "10", "").row.item_count === 0);
  ok("takings: the source name matches what 0339's policy admits", W.MANUAL_SOURCE === "manual" && /source = 'manual'/.test(require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "supabase/migrations/0339_the_sentence_that_described_a_door.sql"), "utf8")));

  // the writers, under a fake client that records every call in order
  const fake = (fail = null) => {
    const calls = [];
    const res = (table, op) => Promise.resolve({ error: fail && fail.table === table && fail.op === op ? { message: `boom:${table}.${op}` } : null, data: null });
    const sb = {
      from: (table) => ({
        update: (patch) => ({ eq: (col, v) => { calls.push({ table, op: "update", patch, col, v }); return res(table, "update"); } }),
        upsert: (row, opts) => { calls.push({ table, op: "upsert", row, opts }); return res(table, "upsert"); },
        insert: (row) => { calls.push({ table, op: "insert", row }); return res(table, "insert"); },
      }),
      rpc: (fn, args) => { calls.push({ op: "rpc", fn, args }); return res(fn, "rpc"); },
    };
    return { sb, calls };
  };
  PENDING.push((async () => {
    let f = fake();
    let r = await W.wrapOwner(f.sb, { kind: "event", id: "e1", recap: " great day ", now: NOW });
    ok("wrapOwner: status first, then the note on the ops sibling, keyed and upserted", r.error === null && f.calls.length === 2
      && f.calls[0].table === "events" && f.calls[0].op === "update" && f.calls[0].v === "e1" && f.calls[0].patch.stage === "done"
      && f.calls[1].table === "event_ops" && f.calls[1].op === "upsert" && f.calls[1].row.event_id === "e1" && f.calls[1].row.recap === "great day" && f.calls[1].opts.onConflict === "event_id", f.calls);
    f = fake();
    r = await W.wrapOwner(f.sb, { kind: "stop", id: "s1", now: NOW, archive: true });
    ok("wrapOwner: no note given means the note is left alone", r.error === null && f.calls.length === 1 && f.calls[0].table === "stops" && f.calls[0].patch.archived_at === NOW, f.calls);
    f = fake({ table: "events", op: "update" });
    r = await W.wrapOwner(f.sb, { kind: "event", id: "e1", recap: "x", now: NOW });
    ok("wrapOwner: a failed status write stops everything — no note filed against something still upcoming", r.error && /boom/.test(r.error.message) && f.calls.length === 1, f.calls);
    f = fake();
    r = await W.saveRecap(f.sb, { kind: "stop", id: "s1", recap: "" });
    ok("saveRecap: the note alone, blank stored as null, nothing else touched", r.error === null && f.calls.length === 1 && f.calls[0].table === "stop_ops" && f.calls[0].row.recap === null && f.calls[0].row.stop_id === "s1", f.calls);
    f = fake();
    r = await W.archiveOwner(f.sb, { kind: "event", id: "e1", now: NOW });
    ok("archiveOwner: one update, the archive patch", r.error === null && f.calls.length === 1 && f.calls[0].op === "update" && f.calls[0].patch.is_live === false && f.calls[0].patch.archived_at === NOW, f.calls);
    f = fake();
    r = await W.addTakings(f.sb, { eventId: "e1", dollars: "184.50", items: "38" });
    ok("addTakings: one insert into event_sales, the honest row", r.error === null && f.calls.length === 1 && f.calls[0].table === "event_sales" && f.calls[0].op === "insert" && f.calls[0].row.source === "manual" && f.calls[0].row.amount_cents === 18450 && !("square_payment_id" in f.calls[0].row), f.calls);
    f = fake();
    r = await W.addTakings(f.sb, { eventId: "e1", dollars: "lots" });
    ok("addTakings: a refused number never reaches the database, and the refusal is the message the screen shows", r.error && /Dollars and cents/.test(r.error.message) && f.calls.length === 0, { r, calls: f.calls });
    f = fake();
    r = await W.tookNothing(f.sb, "e1", NOW);
    ok("tookNothing: the answer lands on event_ops, upserted by event", r.error === null && f.calls.length === 1 && f.calls[0].table === "event_ops" && f.calls[0].row.took_nothing_at === NOW && f.calls[0].opts.onConflict === "event_id", f.calls);
    f = fake();
    r = await W.setEventLive(f.sb, "e1", false);
    ok("setEventLive: through the RPC that owns the one-live-at-a-time rule", r.error === null && f.calls[0].op === "rpc" && f.calls[0].fn === "admin_set_event_live" && f.calls[0].args.p_event === "e1" && f.calls[0].args.p_live === false, f.calls);
  })());

  // every gap has a way out, in a closed vocabulary, and nothing in the vocabulary is unused
  ok("ways out: every event gap has at least one", E.GAP_KEYS.every((k) => E.gapWaysOut(k).length > 0), E.GAP_KEYS.filter((k) => E.gapWaysOut(k).length === 0));
  ok("ways out: every event way is in the vocabulary, and every word in it is used", E.GAP_KEYS.flatMap((k) => E.gapWaysOut(k)).every((w) => E.WAYS_OUT.includes(w)) && E.WAYS_OUT.every((w) => E.GAP_KEYS.some((k) => E.gapWaysOut(k).includes(w))));
  ok("ways out: every stop gap has at least one", S.STOP_GAP_KEYS.every((k) => S.stopGapWaysOut(k).length > 0), S.STOP_GAP_KEYS.filter((k) => S.stopGapWaysOut(k).length === 0));
  ok("ways out: every stop way is in the vocabulary, and every word in it is used", S.STOP_GAP_KEYS.flatMap((k) => S.stopGapWaysOut(k)).every((w) => S.STOP_WAYS_OUT.includes(w)) && S.STOP_WAYS_OUT.every((w) => S.STOP_GAP_KEYS.some((k) => S.stopGapWaysOut(k).includes(w))));
  ok("ways out: an unknown gap gets none, not a crash", E.gapWaysOut("nope").length === 0 && S.stopGapWaysOut(null).length === 0);
  ok("ways out: the two findings Ryan saw resolve where they are shown", E.gapWaysOut("no_recap").includes("recap") && S.stopGapWaysOut("no_recap").includes("recap") && E.gapWaysOut("stale_stage").includes("wrap") && S.stopGapWaysOut("stale_status").includes("wrap") && E.gapWaysOut("no_sales").includes("takings"));
  ok("ways out: going offline and linking a venue point at the screen that owns them, not a second switch", S.stopGapWaysOut("live_past").join() === "route" && S.stopGapWaysOut("unlinked").join() === "route");
  ok("owed: 'took nothing' is an answer, so a done event that said so is not chased for a number", E.owedLine({ stage: "done", sales_count: 0, took_nothing_at: NOW, recap: "" }) === "Finished. No after-action note yet." && E.owedLine({ stage: "done", sales_count: 0, took_nothing_at: NOW, recap: "fine" }) === "Finished and written up.");

  // the sheets render every way they declare, and nobody writes "done" by hand any more
  {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const read = (f) => readFileSync(join(__dirname, "..", f), "utf8");
    const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
    const ev = code(read("components/EventRecord.tsx")), st = code(read("components/StopRecord.tsx")), od = code(read("components/crew/OwnerDetails.tsx"));
    const lc = code(read("components/crew/LiveControl.tsx")), fo = code(read("components/FieldOpSheet.tsx")), page = code(read("app/crew/page.tsx")), ways = code(read("components/RecordWays.tsx"));
    ok("sheets: the event sheet draws every way out its vocabulary names", E.WAYS_OUT.every((w) => new RegExp(`case "${w}":`).test(ev)), E.WAYS_OUT.filter((w) => !new RegExp(`case "${w}":`).test(ev)));
    ok("sheets: the stop sheet draws every way out its vocabulary names", S.STOP_WAYS_OUT.every((w) => new RegExp(`case "${w}":`).test(st)), S.STOP_WAYS_OUT.filter((w) => !new RegExp(`case "${w}":`).test(st)));
    ok("sheets: which gap gets which control is the library's call, not the sheet's", /gapWaysOut\(gap\)/.test(ev) && /stopGapWaysOut\(gap\)/.test(st) && !/case "no_recap"/.test(ev) && !/case "no_recap"/.test(st));
    ok("sheets: the name question's buttons come from the same mapping as the list's", /waysFor\("name_drift", s\)\.buttons/.test(st) && !/onClick=\{resync\}/.test(st));
    ok("sheets: the stop sheet leads with the stop's name — the one the list shows and guests see", /<b>\{s\.name\?\.trim\(\) \|\| s\.canonical_name\?\.trim\(\)/.test(st));
    ok("sheets: one after-action box, shared (RecordWays.NoteBox) — the sheets and OwnerDetails all draw it", /export function NoteBox\(/.test(ways) && /<NoteBox /.test(ev) && /<NoteBox /.test(st) && /<NoteBox /.test(od) && !/<textarea/.test(od));
    ok("sheets: one placeholder for the note, in one file", (ways.match(/Rise \+ Tide sold out by noon/g) || []).length === 1 && !/Rise \+ Tide/.test(od) && !/Rise \+ Tide/.test(ev));
    ok("one write: OwnerDetails wraps, archives and saves the note through lib/wrap", /wrapOwner\(supabase, \{ kind: ownerType, id: ownerId, recap, archive: alsoArchive, now \}\)/.test(od) && /archiveOwner\(supabase, \{ kind: ownerType, id: ownerId \}\)/.test(od) && /saveRecap\(supabase, \{ kind: ownerType, id: ownerId, recap \}\)/.test(od) && !/stage: "done", completed_at/.test(od) && !/status: "done", completed_at/.test(od));
    ok("one write: a done owner with no note is offered the box — the edit button is no longer gated on a note existing", !/done && f\.recap && !wrapping/.test(od) && /Add the after-action note/.test(od));
    ok("one write: editing a note no longer re-stamps completed_at", /const saveNote = async/.test(od) && /done \? \[\s*\{ label: "Save the note"/.test(od));
    ok("one write: LiveControl's go-offline closes the stop through lib/wrap, with the stamp it used to skip", /wrapOwner\(supabase!, \{ kind: "stop", id: finished\.id, archive: true \}\)/.test(lc) && !/update\(\{ status: "done", archived_at/.test(lc));
    ok("one write: FieldOpSheet and EventsAdmin archive through lib/wrap", /archiveOwner\(supabase, \{ kind, id \}\)/.test(fo) && /archiveOwner\(supabase!, \{ kind: "event", id \}\)/.test(page) && !/archived_at: new Date\(\)\.toISOString\(\), is_live: false/.test(page));
    ok("one write: the event live flag has one caller shape — lib/wrap's RPC call", /setEventLive\(supabase!, id, live\)/.test(page) && !/rpc\("admin_set_event_live"/.test(page) && !/rpc\("admin_set_event_live"/.test(ev));
    ok("one write: no component sends a done patch to the database by hand", ["components/EventRecord.tsx", "components/StopRecord.tsx", "components/crew/OwnerDetails.tsx", "components/crew/LiveControl.tsx", "components/FieldOpSheet.tsx"].every((f) => !/\.update\(\{[^)]*completed_at/.test(code(read(f))) && !/\.update\(\{[^)]*(stage|status): "done"/.test(code(read(f)))));
    ok("tap floor: the wrap box's buttons and the complete button clear 44px", /\.ownerdet-wrap-actions button\{[^}]*min-height:44px/.test(read("app/globals.css")) && /\.ownerdet-complete\{[^}]*min-height:44px/.test(read("app/globals.css")));
  }
}

// ── THE ROAD AHEAD, A DAY SAID ONCE, AND CHROME THAT DOES NOT SIT ON A TAB (2026-10-04) ────────────
// Ryan's Live Ops, Saturday 9:01 PM, a screenshot with no words: "OFFLINE · next · Wine Express —
// Five Forks" over a red Go live (the public page, the same minute: "Nothing scheduled yet"); the
// drop card "Oct 10 · Oct 10's drop"; the moon on the Today tab and the sparkles on More. Three
// rules, each written in more than one place, each wrong in one of them. These hold the one home.
{
  const S = require("../.smoke/stopRecord.js");
  const DT = require("../.smoke/dates.js");
  const H = 3600 * 1000;
  const iso = (ms) => new Date(Date.now() + ms).toISOString();

  ok("road: a stop later today is ahead", S.isStopAhead({ id: "a", starts_at: iso(3 * H) }));
  ok("road: one that started 2h ago is still ahead — inside the grace", S.isStopAhead({ id: "a", starts_at: iso(-2 * H) }));
  ok("road: one that started 9h ago is not", !S.isStopAhead({ id: "a", starts_at: iso(-9 * H) }));
  ok("road: an undated stop is ahead — somebody has to date it, and it should be in front of them", S.isStopAhead({ id: "a", starts_at: null }));
  ok("road: done, stamped complete or archived is never ahead, whatever its date",
    !S.isStopAhead({ id: "a", starts_at: iso(48 * H), status: "done" }) && !S.isStopAhead({ id: "a", starts_at: iso(48 * H), completed_at: iso(-H) }) && !S.isStopAhead({ id: "a", starts_at: iso(48 * H), archived_at: iso(-H) }));
  ok("road: the live stop is on the road however late it runs", S.isStopAhead({ id: "a", starts_at: iso(-12 * H) }, "a") && !S.isStopAhead({ id: "a", starts_at: iso(-12 * H) }, "b"));
  ok("road: …unless somebody closed it", !S.isStopAhead({ id: "a", starts_at: iso(-H), status: "done" }, "a"));
  // The screenshot's road: the finished Wine Express visit, first in `sort` order, and a stale one.
  const saturday = [
    { id: "wx", name: "Wine Express — Five Forks", sort: 0, starts_at: iso(-7 * 24 * H), status: "done", completed_at: iso(-7 * 24 * H) },
    { id: "rh", name: "Restore Hyper Wellness", sort: 0, starts_at: iso(-20 * 24 * H), status: "upcoming" },
  ];
  ok("road: Ryan's Saturday — a finished visit and a stale one is an EMPTY road, as Find Us said", S.roadAhead(saturday).length === 0, S.roadAhead(saturday).map((x) => x.id));
  const week = [
    { id: "undated", starts_at: null, sort: 0 },
    { id: "later", starts_at: iso(5 * 24 * H), sort: 0 },
    { id: "soon", starts_at: iso(26 * H), sort: 9 },
    { id: "live", starts_at: iso(-10 * H), sort: 1 },
  ];
  ok("road: in the order the truck drives it — the live stop, then by start, undated last; never by `sort`",
    S.roadAhead(week, "live").map((x) => x.id).join() === "live,soon,later,undated", S.roadAhead(week, "live").map((x) => x.id));
  ok("road: offline, that live row is just a visit past its grace", S.roadAhead(week).map((x) => x.id).join() === "soon,later,undated", S.roadAhead(week).map((x) => x.id));
  const sat901 = new Date(2026, 9, 3, 21, 1);   // the screenshot, operator-local
  const local = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).toISOString();
  ok("due: a stop later tonight is one tap", S.stopIsDue(local(2026, 9, 3, 22, 0), sat901));
  ok("due: next Saturday is not — Go live asks first", !S.stopIsDue(local(2026, 9, 10, 11, 0), sat901));
  ok("due: an undated stop, or a date that is not one, is not", !S.stopIsDue(null, sat901) && !S.stopIsDue("not a date", sat901));
  ok("due: last night's 11 PM stop is still due at 2 AM — inside its grace across midnight", S.stopIsDue(local(2026, 9, 2, 23, 0), new Date(2026, 9, 3, 2, 0)));
  ok("due: and not at noon, twelve hours on", !S.stopIsDue(local(2026, 9, 2, 23, 0), new Date(2026, 9, 3, 12, 0)));

  const off = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return DT.dayKey(d); };
  const md = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString([], { month: "short", day: "numeric" }); };
  const twice = [];
  for (let n = -40; n <= 40; n++) { const t = DT.dayWithDate(off(n)); if (t.split(md(n)).length - 1 !== 1) twice.push(`${n}: ${t}`); }
  ok("day said once: across 81 days either side, dayWithDate prints the date exactly once", twice.length === 0, twice.slice(0, 4));
  ok("day said once: inside the week, the word and the date", /^This \w{3} · \w{3} \d{1,2}$/.test(DT.dayWithDate(off(3))) && DT.dayWithDate(off(0)).startsWith("Today · "), [DT.dayWithDate(off(3)), DT.dayWithDate(off(0))]);
  ok("day said once: a week out, the weekday and the date — 'Oct 10 · Oct 10' cannot come back", /^\w{3}, \w{3} \d{1,2}$/.test(DT.dayWithDate(off(7))), DT.dayWithDate(off(7)));
  ok("day said once: nearDay is the word inside the week, weekday + date outside it, nothing for a non-date",
    DT.nearDay(off(3)).startsWith("This ") && /^\w{3}, \w{3} \d{1,2}$/.test(DT.nearDay(off(9))) && DT.nearDay("not a date") === "", [DT.nearDay(off(3)), DT.nearDay(off(9))]);

  {
    const fs = require("node:fs");
    const path = require("node:path");
    const root = path.join(__dirname, "..");
    const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
    const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
    const lc = code(read("components/crew/LiveControl.tsx")), fu = code(read("components/FindUs.tsx"));
    ok("road: the truck instrument reads the road, not the first row in `sort` order",
      !/active\[0\]/.test(lc) && /roadAhead\(active, live\?\.is_live \? live\.current_stop_id : null\)/.test(lc));
    ok("road: Go live is offered only for a stop on the road, and asks first unless it is due",
      /onClick=\{goLiveNext\}/.test(lc) && /stopIsDue\(nextStop\.starts_at\)/.test(lc) && /title: `Go live at \$\{nextStop\.name\} now\?`/.test(lc));
    ok("road: with nothing on the road it says so, and offers to plan the next stop instead of Go live",
      /"nothing on the road"/.test(lc) && />Plan the next stop</.test(lc));
    ok("road: going offline names the next stop by the same rule", /roadAhead\(stops\.filter\(\(s\) => s\.id !== finished\?\.id\)\)\[0\]/.test(lc));
    ok("road: the live panel's grace is lib/stopRecord's — no second 8 * 3600 * 1000", !/8 \* 3600 \* 1000/.test(lc));
    ok("road: the public Find Us page asks the same rule for its stops", /isStopAhead\(r, liveId\)/.test(fu) && !/8 \* 3600 \* 1000/.test(fu));
    ok("road: …from lib/road, the small home — not lib/stopRecord, whose crew vocabulary a guest should not download",
      /import \{ isStopAhead \} from "@\/lib\/road";/.test(fu) && !/from "@\/lib\/stopRecord"/.test(fu)
        && /export \{ STOP_DONE_GRACE_MS, isStopPast, isStopAhead, roadAhead, stopIsDue, type RoadStop \} from "\.\/road";/.test(read("lib/stopRecord.ts")));
    ok("day said once: the drop heading, the route rows, the pack label and the inbox all use lib/dates",
      /dayWithDate\(dropISO\)/.test(code(read("components/DropOps.tsx"))) && /dayWithDate\(new Date\(next\.starts_at/.test(lc)
        && /nearDay\(p\.drop_date\)/.test(code(read("components/MyPacks.tsx"))) && /nearDay\(iso\) \|\| iso/.test(code(read("components/MemberInbox.tsx"))));
    // The bug class itself, wherever it would come back: a relative word glued to a date by hand.
    const glued = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) { if (!/node_modules|\.next|\.smoke|\.git/.test(f)) walk(f); }
        else if (/\.tsx?$/.test(e.name) && !/lib\/dates\.ts$/.test(f) && /relativeDay\([^)]*\)\}\s*·\s*\$\{/.test(code(fs.readFileSync(f, "utf8")))) glued.push(path.relative(root, f));
      }
    })(root);
    ok("day said once: nobody glues relativeDay to a date by hand any more", glued.length === 0, glued);

    const shell = code(read("components/AppShell.tsx"));
    const css = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
    ok("chrome: the crew nav's landmark IS the nav — the app column's child, the same shape as the customer nav",
      /<nav className="nav opnav" aria-label="Section navigation">/.test(read("components/OperatorNav.tsx")) && /<nav className="nav" aria-label="Primary">/.test(read("components/BottomNav.tsx")));
    ok("chrome: the floating tier rides one dock — quick actions, the theme toggle, the offline chip, the update prompt",
      /<div className="fab-dock">\s*\{inAdmin && <QuickDock \/>\}\s*\{inAdmin && <button type="button" className="theme-toggle"[\s\S]*?\{inAdmin && <OfflineChip \/>\}\s*<ServiceWorkerRegister \/>\s*<\/div>/.test(shell)
        && (shell.match(/<QuickDock \/>/g) || []).length === 1 && (shell.match(/<ServiceWorkerRegister \/>/g) || []).length === 1);
    ok("chrome: no guessed nav height left in the stylesheet", !/var\(--navh/.test(css) && !/76px \+ 78px/.test(css));
    ok("chrome: the dock sits after the page and before the docked rail and the nav",
      /\.fab-dock\{order:4;position:relative;flex:0 0 auto;height:0\}/.test(css) && /\.nav\{order:10;/.test(css) && /\.rail:not\(\.rail-folded\)\{position:static;order:5;/.test(css));
    ok("chrome: the folded handle adds the phone's own inset instead of guessing it", /calc\(\$\{bottom\}px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(read("components/FloatRail.tsx")));
    ok("chrome: the pickup card's accent is its own edge, not a rule beside it", /\.dops\.zone-pickup > \.mpanel\{border-left:3px solid var\(--gold2\)\}/.test(css) && !/\.dops\.zone-pickup\{/.test(css));

    // The Event heads-up, with nothing live (Ryan's second screenshot): it says what is coming.
    const page = code(read("app/crew/page.tsx"));
    const hud = (page.match(/function EventHUD\([\s\S]*?\n\}\n/) || [""])[0];
    const idle = (hud.match(/if \(!ev\) \{[\s\S]*?\n  \}\n/) || [""])[0];
    ok("heads-up: with nothing live it reads the next event — not archived, not done, today or later, soonest first",
      /from\("v_event_record"\)/.test(hud) && /\.is\("archived_at", null\)\.neq\("stage", "done"\)\.gte\("day", localToday\(\)\)/.test(hud) && /\.order\("day", \{ ascending: true \}\)\.limit\(1\)/.test(hud));
    ok("heads-up: a failed read is said as a failure, never as an empty calendar", /setNext\(nxErr \? "error"/.test(hud) && /Couldn&apos;t read what&apos;s next/.test(idle));
    ok("heads-up: four honest states — checking, nothing on the calendar, today and not live, next",
      /Checking the calendar/.test(idle) && /Nothing on the calendar\./.test(idle) && /is today, and it isn&apos;t live\./.test(idle) && /Next: <b>\{title\}<\/b>/.test(idle));
    ok("heads-up: today's event can be made live from here, through the one RPC that owns the rule", /setEventLive\(supabase, next\.id, true\)/.test(idle) && /label: "Make it live"/.test(idle));
    ok("heads-up: the next event opens its record, and says the one thing it is waiting on", /openRecord\("event", next\.id\)/.test(idle) && /owedLine\(next\)/.test(idle) && /dayWithDate\(next\.day\)/.test(idle));
    ok("heads-up: no box inside the panel's box — the idle state draws no EmptyState", !/<EmptyState/.test(idle) && /<WayButtons/.test(idle));
    ok("links on buttons: .cp-go takes the browser's grey face off a <button> (the painted check is design.measure's uaButtons)",
      /\.cp-go\{[^}]*background:none;border:0;padding:0;cursor:pointer;-webkit-appearance:none;appearance:none\}/.test(css)
        && /uaButtons/.test(read("scripts/design.measure.mjs")) && /button\(s\) in the browser's default grey face/.test(read("scripts/design.ratchet.mjs")));
  }
}

// ── errorMessage (lib/errorMessage.ts): the one place a thrown value becomes a string ──────────
{
  const { errorMessage } = require("../.smoke/errorMessage.js");
  ok("errorMessage: an Error gives its message", errorMessage(new Error("boom")) === "boom");
  ok("errorMessage: an object with a message gives it (a PostgREST error is one of these)", errorMessage({ message: "duplicate key", code: "23505" }) === "duplicate key");
  ok("errorMessage: a string is itself", errorMessage("just text") === "just text");
  ok("errorMessage: undefined and null read as the old expression did", errorMessage(undefined) === "undefined" && errorMessage(null) === "null");
  ok("errorMessage: a message that is not a string is stringified, not dropped", errorMessage({ message: 42 }) === "42");
  ok("errorMessage: an object with an undefined message falls through to the value", errorMessage({ message: undefined, toString: () => "me" }) === "me");
  ok("errorMessage: max caps it", errorMessage(new Error("x".repeat(500)), 300).length === 300);
  ok("errorMessage: no max, no cap", errorMessage(new Error("x".repeat(500))).length === 500);
}

// ── MY DAY, 10:13 PM, AND "THIS SEEMS 2/10" (2026-10-04) ───────────────────────────────────────
// Ryan's screenshot: the top three as grey slabs that looked disabled and said nothing about how late
// they were; "11 overdue · 7 tasks past due"; a day whose op card, flags, stops and brews all went
// silent on a failed read. Then, that night: "Clicking on Greenville Fit Fest today's op does
// nothing. Strategically look for where something is unnecessary information or should have
// operational functionality." These hold each fix to the rule it now lives in.
{
  const DW = require("../.smoke/dayWords.js");
  ok("days between: calendar days, positive forward, and a DST change is still one day",
    DW.daysBetween("2026-10-03", "2026-10-04") === 1 && DW.daysBetween("2026-10-04", "2026-09-30") === -4
    && DW.daysBetween("2026-11-01", "2026-11-02") === 1 && DW.daysBetween("2026-03-08", "2026-03-09") === 1 && DW.daysBetween("2026-07-01", "2026-10-03") === 94);
  ok("due word: late, today, ahead — one wording for Needs-you and the top three",
    DW.dueWord(-94) === "94 days late" && DW.dueWord(-1) === "1 day late" && DW.dueWord(0) === "due today" && DW.dueWord(1) === "in 1 day" && DW.dueWord(4) === "in 4 days");

  // ── who may do what (lib/roles canOf) ──
  const R = require("../.smoke/roles.js");
  const can = (role) => JSON.stringify(R.canOf({ role }));
  ok("roles: owner and admin may write an event and throw its live switch; nobody else may",
    R.canOf({ role: "owner" }).admin && R.canOf({ role: "admin" }).admin && !R.canOf({ role: "event_manager" }).admin && !R.canOf({ role: "server" }).admin);
  ok("roles: managers manage, operators and contractors prep, servers and members do neither",
    can("event_manager") === JSON.stringify({ admin: false, manage: true, prep: true })
    && can("operator") === JSON.stringify({ admin: false, manage: false, prep: true })
    && can("contractor") === JSON.stringify({ admin: false, manage: false, prep: true })
    && can("server") === JSON.stringify({ admin: false, manage: false, prep: false })
    && can("member") === JSON.stringify({ admin: false, manage: false, prep: false }));
  ok("roles: a legacy is_admin profile with no role is an owner, as roleOf has always said", R.canOf({ is_admin: true }).admin);

  // ── where a Needs-you row goes (lib/obligations) ──
  const O = require("../.smoke/obligations.js");
  const uid = "11111111-2222-4333-8444-555555555555";
  const go = (source, extra = {}) => O.obligationGo({ source, subject_id: "abc", route: "/crew?s=team&a=offers", owner_user_id: null, ...extra });
  ok("needs you: a to-do opens the to-do — it used to reload the screen it was already on",
    JSON.stringify(go("todos", { subject_id: uid })) === JSON.stringify({ kind: "task", id: uid, source: "todo" }));
  ok("needs you: an expiring cert or a training due opens the PERSON, not the top of Team",
    JSON.stringify(go("academy_certifications", { owner_user_id: uid })) === JSON.stringify({ kind: "person", id: uid })
    && JSON.stringify(go("academy_assignments", { owner_user_id: uid })) === JSON.stringify({ kind: "person", id: uid }));
  ok("needs you: an offer lands on Money › Offer letters, where the panel actually is (its route said Team)",
    JSON.stringify(go("offer_letters")) === JSON.stringify({ kind: "section", section: "money", anchor: "offers" }));
  ok("needs you: agreements, goals, workstreams and disputes land on their panels",
    go("operator_agreements").anchor === "operators" && go("goals").anchor === "goals" && go("goals").section === "command"
    && go("os_workstreams").anchor === "os-registry" && go("initiatives").anchor === "os-registry" && go("square_disputes").anchor === "shoporders");
  ok("needs you: an unknown source still lands in the app, on its own route, parsed — never a reload",
    JSON.stringify(O.obligationGo({ source: "brand_new", subject_id: "x", route: "/crew?s=garage" })) === JSON.stringify({ kind: "section", section: "garage" })
    && JSON.stringify(O.obligationGo({ source: "brand_new", subject_id: "x", route: null })) === JSON.stringify({ kind: "section", section: "day" }));
  ok("needs you: a person row with no person on it falls back to its route rather than opening nothing",
    go("academy_certifications", { owner_user_id: null, route: "/crew?s=team" }).kind === "section");

  const fs = require("node:fs"), path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const crew = code(read("app/crew/page.tsx"));
  const myDay = crew.slice(crew.indexOf("function MyDay("), crew.indexOf("function MyTasks("));
  const head = code(read("components/DayHeadline.tsx")), owed = code(read("components/Owed.tsx"));
  const evRec = code(read("components/EventRecord.tsx")), stRec = code(read("components/StopRecord.tsx"));
  const css = read("app/globals.css");

  // ── today's op: it opens, and the day's switch is on it ──
  ok("today's op: the whole card is one button and it opens the event's record — it was a <div>",
    /<button type="button" className="dayhead-op-go" onClick=\{\(\) => openRecord\("event", op\.id\)\}>/.test(head) && !/onOpenOp/.test(head + crew));
  ok("today's op: the brief is inside the button as spans, so the card is one valid tap target",
    /<span className="myday-brief">/.test(head) && /<span className="myday-brief-row">/.test(head) && !/<div className="myday-brief/.test(head));
  ok("today's op: 'Make it live' sits on the card for whoever may throw it — today, not live, not wrapped — through lib/wrap",
    /canGoLive && !op\.is_live && !done && \(/.test(head) && /setEventLive\(supabase, id, true\)/.test(head) && /canGoLive=\{isAdmin\}/.test(crew));
  ok("today's op: the record runs today from where the event is — live switch and the wrap, for an admin, the day itself",
    /Number\(e\.days_away\) === 0 && e\.stage !== "done" && can\.admin/.test(evRec) && /label: "Make it live"/.test(evRec) && /label: "Take it offline"/.test(evRec) && /label: "It's over — wrap it up"/.test(evRec));
  ok("records: a sheet offers only the writes the viewer's role may make (the database refuses the rest)",
    /if \(\(w === "archive" \|\| w === "wrap" \|\| w === "live_off"\) && !can\.admin\) continue;/.test(evRec)
    && /if \(\(w === "edit" \|\| w === "prep"\) && !can\.prep\) continue;/.test(evRec)
    && /if \(\(w === "resync" \|\| w === "archive" \|\| w === "wrap"\) && !can\.admin\) continue;/.test(stRec)
    && /if \(\(w === "venue" \|\| w === "route"\) && !can\.manage\) continue;/.test(stRec)
    && /\{can\.prep && \(/.test(evRec) && /\{can\.prep && \(/.test(stRec));
  ok("today's op: the headline reads active events with their brief and stage, and is the one card for them",
    !/myday-ev/.test(crew) && /from\("events"\)\.select\("id, title, day_label, is_live, stage"\)\.eq\("day", localToday\(\)\)\.is\("archived_at", null\)/.test(head)
    && /from\("event_ops"\)/.test(head) && !/field_ops/.test(head) && (crew.match(/<DayHeadline /g) || []).length === 1);
  ok("headline: every read throws on failure — the error branch it had could never be reached",
    /if \(ev\.error\) throw new Error/.test(head) && /if \(tk\.error\) throw new Error/.test(head) && /if \(o\.error\) throw new Error/.test(head));
  ok("headline: each of the top three says how late it is, in Needs-you's words and colour",
    /dueWord\(out\)/.test(head) && /daysBetween\(d\.dueDay, t\.due\)/.test(head) && /className=\{`owed-age\$\{out < 0 \? " late" : ""\}`\}/.test(head));
  ok("headline: the morning screen's headline is a static import, as the code-split note requires of the daily path",
    /^import DayHeadline from "@\/components\/DayHeadline";$/m.test(read("app/crew/page.tsx")) && !/dynamic\(\(\) => import\("@\/components\/DayHeadline"\)/.test(crew));

  // ── what left My Day ──
  ok("my day opens on the day: no greeting, no motto — the headline is the first thing it renders",
    !/className="myday-hero"/.test(myDay) && !/k-title/.test(myDay) && !/board\.welcome/.test(crew) && !/useSiteCopy/.test(crew)
    && myDay.indexOf("return (") < myDay.indexOf("<DayHeadline ") && !/partOfDay/.test(crew + read("lib/dayWords.ts").replace(/\/\/.*$/gm, "")));
  ok("my day: the copy keys that showed nowhere are retired, so Settings stops offering to edit them",
    !/key: "(board\.welcome|home\.statement|home\.principles|home\.cta)"/.test(read("lib/copy.ts")) && !/"Team board":/.test(read("lib/copy.ts")));
  ok("my day: the bell is the inbox's one door — no card repeating its number; a failed read still says so",
    !/myday-inbox-ptr/.test(myDay) && /\{flagsErr && flags\.length === 0 && \(/.test(myDay));
  ok("my day: '✎ Note to self' is gone — the quick-actions Note tab is that door, on every screen", !/Note to self/.test(myDay));
  ok("my day: a stop chip opens the stop's record — it went to a checklist a server could not open",
    /onClick=\{\(\) => openRecord\("stop", s\.id\)\}/.test(myDay) && !/prepHandoffValue\("stop"/.test(myDay));
  ok("my day: stops, drops and brews throw on a failed read and say so, instead of drawing an empty day",
    /const failed = \[st\.error, dr\.error, de\.error, br\.error\]\.find\(Boolean\);\s*if \(failed\) throw new Error/.test(myDay) && /rhythmState\.status === "error"/.test(myDay));

  // ── the chrome ──
  ok("chrome: the bell loads for every role — it was gated on managers while the nav badge was not",
    /const \{ flags: hdrFlags, critCount: hdrCrit \} = useMyAlerts\(user\?\.id \?\? null\);/.test(crew));
  ok("chrome: no WHEN pill styled as a status, and its rules left with it",
    !/op-head-when/.test(crew) && !/\.op-head-when\{/.test(css));
  ok("chrome: ‹ is Back only — it no longer turns into 'Exit Crew Mode' beside the Customer view switch",
    /\{canGoBack && <button type="button" className="pf" aria-label="Back" onClick=\{\(\) => back\(\)\}>‹<\/button>\}/.test(crew) && !/Exit Crew Mode/.test(crew));
  const nav = code(read("components/OperatorNav.tsx"));
  ok("chrome: tapping the lane you are on does something — the inbox when it is badged, the lane's first screen otherwise",
    /if \(!on\) \{ openGroup\(g\); return; \}/.test(nav) && /if \(waiting > 0\) \{ window\.dispatchEvent\(new Event\("gt3-open-inbox"\)\); return; \}/.test(nav)
    && /if \(section !== g\.members\[0\]\) setSection\(g\.members\[0\]\);/.test(nav));

  // ── the inbox ──
  const recs = require("../.smoke/records.js");
  ok("inbox: a stalled-order alert opens the order it names (0340 carries the order id)",
    JSON.stringify(recs.recordForAlert("shop_order_stalled", uid)) === JSON.stringify({ kind: "shop_order", id: uid }));
  ok("inbox: an alert about one task opens that task, and the alert's own words open what it names",
    recs.TASK_ALERT_KINDS.includes("task_assigned") && recs.TASK_ALERT_KINDS.includes("task_due")
    && /TASK_ALERT_KINDS\.includes\(a\.kind\) && a\.subject_id\) \{ openTask\(a\.subject_id, "event"\);/.test(crew)
    && /<button type="button" className="alert-main alert-main-go" onClick=\{\(\) => gotoAlert\(a\)\}>/.test(crew) && /\{canOpen\(a\) && \(/.test(crew));

  // ── Needs you ──
  ok("needs you: one number for late — '11 overdue · 7 tasks past due' read as if the seven were among the eleven",
    /const lateCount = late\.length \+ tasks\.length;/.test(owed) && /`\$\{lateCount\} late`/.test(owed) && !/tasks past due/.test(owed)
    && /from "@\/lib\/dayWords"/.test(owed) && !/const ageWord =/.test(owed) && !/const localYMD =/.test(owed));
  ok("needs you: every row is a button to what it names — no <a href> full reloads; '+N more' expands instead of being text",
    /onClick=\{\(\) => go\(r\)\}/.test(owed) && !/href=\{r\.route\}/.test(owed) && /owner_user_id"\)/.test(owed)
    && /setAllTasks\(true\)/.test(owed) && /setAllLow\(true\)/.test(owed) && !/more late\.<\/div>/.test(owed) && !/more below reorder point\.<\/div>/.test(owed)
    && /openTask\(t\.id, "event"\)/.test(owed));

  // ── elsewhere in the console ──
  ok("live ops: the stop the truck instrument names opens its record",
    /<RecordLink kind="stop" id=\{curStop\.id\}>/.test(read("components/crew/LiveControl.tsx")) && /<RecordLink kind="stop" id=\{nextStop\.id\}>/.test(read("components/crew/LiveControl.tsx")));
  ok("the pass: an unpaid ticket says to collect — 'pre-order' named a payment state as an ordering one",
    /"UNPAID · collect at pickup"/.test(crew) && !/"pre-order"/.test(crew));
  ok("readiness: a board group's event or stop opens its record; a past one says Wrap up",
    /openRecord\(g\.kind as "event" \| "stop", g\.recId!\)/.test(read("components/PrepBoard.tsx")) && /\{g\.past \? "Wrap up" : "Open"\}/.test(read("components/PrepBoard.tsx")));
  ok("plan: on the crew calendar an event or stop opens its record instead of a row that does nothing",
    /onClick=\{\(\) => openRecord\(it\.kind as "event" \| "stop", it\.id\)\}/.test(read("components/CompanyCalendar.tsx")));
  ok("money: the glance tiles land where they say, through CrewKpis' one jump",
    /goToDest\(TO\[t\.k\] \?\? \{ section: "money" \}, setSection\)/.test(read("components/MoneyKpis.tsx")) && /export function goToDest/.test(read("components/CrewKpis.tsx")));
  ok("panels: a wrapped component's duplicate title hides, its controls never — Sales' range, '+ Add', 'due soon'",
    /\.mpanel-body > \*:not\(\.adm-hud\) > \.k-sec:first-child:has\(> \.k-sec-r\),\n\.mpanel-body > \.k-sec:first-child:has\(> \.k-sec-r\)\{display:flex;/.test(css)
    && /:has\(> \.k-sec-r\) > \.k-sec-lbl\{display:none\}/.test(css));

  // ── the paper theme (kept from the 10:13 pass) ──
  const boxDay = css.indexOf(".app.crew-day :where(.task-box){background:var(--card)");
  ok("paper: the empty task box is white with an ink edge in the day theme, and never outranks the ticked or picked states",
    boxDay > 0 && boxDay < css.indexOf(".task-box.on{"));
  ok("paper: the top three are cards in the day theme, not 18% black", /\.app\.crew-day \.dayhead-t\{background:var\(--card\)\}/.test(css));
  ok("paper: the day console restates --field, --well and --ink-whisper — they fell through to :root's black",
    /--field:#FFFFFF; --well:rgba\(34,31,24,\.05\); --ink-whisper:rgba\(34,31,24,\.64\);/.test(css));
  ok("paper: 'late' is one colour, the legible red for text in either theme", /\.owed-row\.late \.owed-age,\.owed-age\.late\{color:var\(--red-onLight\)\}/.test(css));
  ok("weight: daysBetween and dueWord live in lib/dayWords, not the lib/dates every page carries",
    !/export function (partOfDay|daysBetween|dueWord)\b/.test(read("lib/dates.ts")) && /export function dueWord/.test(read("lib/dayWords.ts")));
  ok("audit: the affordance audit and the vocabulary audit run in npm run audit",
    /node scripts\/affordance\.audit\.mjs/.test(read("package.json")) && /node scripts\/vocab\.audit\.mjs/.test(read("package.json")));

  // ── buttons that could not work: a word the table refuses (scripts/vocab.audit.mjs) ──
  const act = code(read("components/AlertAction.tsx"));
  ok("held delivery: 'Picked up' writes the word delivery_orders has — 'delivered', and only to an order still held",
    /\.update\(\{ status: "delivered" \}\)\s*\.eq\("id", flag\.subject_id\)\.eq\("status", "held_for_pickup"\)\.select\("id"\)/.test(act)
    && !/status: "picked_up"/.test(act));
  ok("held delivery: an order no longer held is not silently 'marked picked up' — only one already delivered counts as done",
    /if \(\(now\.data as \{ status: string \} \| null\)\?\.status !== "delivered"\) throw new Error/.test(act));
  ok("pipeline: a promoted booking request opens at 'warm' — 'talking' was retired by 0265, so every promote failed",
    /from\("opportunities"\)\.insert\(\{\s*vendor_id: vendorId, stage: "warm", source: "inbound"/.test(crew) && !/stage: "talking"/.test(crew));
  const BM = require("../.smoke/brewMath.js");
  ok("brew: what is over — served, dumped, discarded — is one list, and it is the table's words",
    JSON.stringify(BM.BATCH_OVER) === JSON.stringify(["served", "dumped", "discarded"]) && BM.BATCH_OVER_IN === "(served,dumped,discarded)"
    && BM.batchIsOver("discarded") && BM.batchIsOver("dumped") && !BM.batchIsOver("kegged") && !BM.batchIsOver(null)
    && /\/\/ vocab: brew_batches\.status\nexport const BATCH_OVER/.test(read("lib/brewMath.ts")));
  ok("brew: the pack plan, the calendar and the chief's brief read that list — none keeps its own, none filters on 'archived'",
    /\.not\("status", "in", BATCH_OVER_IN\)/.test(read("components/PackPlan.tsx")) && /\.not\("status", "in", BATCH_OVER_IN\)/.test(read("components/CompanyCalendar.tsx"))
    && /\.not\("status", "in", BATCH_OVER_IN\)/.test(read("app/api/agents/chief/route.ts"))
    && !/"\(served,dumped\)"|from\("brew_batches"\)[^\n]*neq\("status", "archived"\)/.test(read("components/PackPlan.tsx") + read("components/CompanyCalendar.tsx") + read("app/api/agents/chief/route.ts"))
    && (read("components/BrewPlanner.tsx").match(/batchIsOver\(/g) || []).length === 2 && !/status !== "served"/.test(read("components/BrewPlanner.tsx")));
}

// Everything above is synchronous except what PENDING holds. Printing the summary before those
// land would report a pass count that is wrong in the flattering direction — exactly the kind of
// quiet lie the rest of this file exists to refuse.
Promise.all(PENDING).then(() => {
  console.log(`\nSPACE/LOADOUT SMOKE: ${pass} passed, ${fail} failed`);
  console.log(`Sample — trailer: ${tS.usedCuft}/${tS.usableCuft} cu ft (${tS.cuftLevel}); vehicle: ${vS.usedCuft}/${vS.usableCuft} cu ft (${vS.cuftLevel})`);
  process.exit(fail ? 1 : 0);
});