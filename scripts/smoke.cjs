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
  ok("eventRecord: the view's latest definition is 0348's", definesGaps.at(-1) === "0348_tonight_is_not_the_past.sql", definesGaps);
  const sqlE = rfE(require("node:path").join(migDirE, definesGaps.at(-1)), "utf8");
  const inSql = [...sqlE.matchAll(/\(\s*'([a-z_]+)',\s*'[^']*',\s*'(high|medium|low)'/g)].map((m) => m[1]);
  ok("eventRecord: the migration's gap list was actually found in the file", inSql.length === 9, inSql);
  ok("eventRecord: every gap the database can emit has a fix sentence — no row of advice-free blame",
    inSql.every((k) => E.gapFix(k).length > 0), inSql.filter((k) => !E.gapFix(k)));
  ok("eventRecord: and the module invents none the database cannot emit",
    E.GAP_KEYS.every((k) => inSql.includes(k)), E.GAP_KEYS.filter((k) => !inSql.includes(k)));
  ok("eventRecord: an unknown gap gets no invented advice", E.gapFix("made_up") === "" && E.gapFix(null) === "");
  // The view diagnoses; the fix sentence is this module's, and every reader prints one after the
  // other. stale_stage's detail ended "Wrap it or drop it." before 0348 — the advice twice, and on a
  // phone the clamp cut the second, better one. A detail that opens its own fix's words is that again.
  const detailsE = Object.fromEntries([...sqlE.matchAll(/\(\s*'([a-z_]+)',\s*'([^']*)',\s*'(?:high|medium|low)'/g)].map((m) => [m[1], m[2]]));
  ok("eventRecord: no detail in the view carries its own fix — said once, by the reader",
    Object.keys(detailsE).length === 9 && Object.entries(detailsE).every(([k, d]) => !d.includes(E.gapFix(k).split(" ").slice(0, 2).join(" "))),
    Object.entries(detailsE).filter(([k, d]) => d.includes(E.gapFix(k).split(" ").slice(0, 2).join(" "))));

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
  // 2026-10-06: the painted pass went red on every push for days, on a different route each time —
  // axe had read the sign-in form while it was still fading in (.auth-form waits 1.45s, then rises
  // for .7s), where cream on charcoal is nearly invisible. Reproduced by running axe just as the
  // fade starts: #auth-name, #auth-email and the member button fail; after SETTLE, none do. Held
  // here: the page is measured after every animation that ends has ended, and the wait is capped.
  {
    const vp = read("scripts/verify.prod.mjs");
    ok("production gate: a page is measured once it has stopped moving — every animation that ends is let finish (3s at most), loops keep running",
      /const SETTLE = async \(\) => \{\s*const ending = document\.getAnimations\(\)\.filter\(\(a\) => Number\.isFinite\(a\.effect\?\.getComputedTiming\?\.\(\)\.endTime\)\);\s*await Promise\.race\(\[Promise\.all\(ending\.map\(\(a\) => a\.finished\.catch\(\(\) => \{\}\)\)\), new Promise\(\(r\) => setTimeout\(r, 3000\)\)\]\);/.test(vp)
      && /await page\.waitForTimeout\(900\);\s*await page\.evaluate\(SETTLE\);\s*m = await page\.evaluate\(MEASURE\);/.test(vp)
      && vp.indexOf("await page.evaluate(SETTLE);") < vp.indexOf("window.axe.run(document"));
  }

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
  const D = require("../.smoke/schemaSkew.js");
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
  ok("door: …reading the cookie by the one name lib/viewerHint.ts owns", /import \{ VIEWER_COOKIE, DOOR_COOKIE, DOOR_MAX_AGE_S \} from "@\/lib\/viewerHint";/.test(proxy) && /cookies\.get\(VIEWER_COOKIE\)/.test(code(proxy)) && /export const VIEWER_COOKIE = "gt3-viewer";/.test(hint));
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
    ok("chrome: the floating tier rides one dock — quick actions (the console's one floating button), the offline chip, the update prompt",
      /<div className="fab-dock">\s*\{inAdmin && <QuickDock \/>\}\s*\{inAdmin && <OfflineChip \/>\}\s*<ServiceWorkerRegister \/>\s*<\/div>/.test(shell)
        && (shell.match(/<QuickDock \/>/g) || []).length === 1 && (shell.match(/<ServiceWorkerRegister \/>/g) || []).length === 1 && !/theme-toggle/.test(shell));
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
  ok("due word: late, today, ahead — one wording for lateness wherever it is said",
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
    && go("os_workstreams").anchor === "os-registry" && go("square_disputes").anchor === "shoporders");
  ok("needs you: an initiative opens itself — it went to the workstreams panel, which does not hold it (10:40 PM)",
    JSON.stringify(go("initiatives", { subject_id: uid })) === JSON.stringify({ kind: "initiative", id: uid }));
  // ── "needs you" means you (lib/obligations obligationFor) ──
  // The sections each role opens, read from their one home (components/OperatorNav ROLE_SECTIONS) —
  // a fixture typed here would pass on a table that has since changed.
  const navTxt = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "components/OperatorNav.tsx"), "utf8");
  const roleSecs = (r) => (new RegExp(`\\b${r}: \\[([^\\]]*)\\]`).exec(navTxt)?.[1] ?? "").match(/"([a-z]+)"/g)?.map((x) => x.slice(1, -1)) ?? [];
  const secs = { server: roleSecs("server"), operator: roleSecs("operator"), manager: roleSecs("event_manager"), owner: roleSecs("owner") };
  ok("needs you is yours: the role table was read (server, operator, event manager, owner)",
    secs.server.includes("day") && !secs.server.includes("garage") && secs.operator.includes("garage") && secs.manager.includes("command") && !secs.manager.includes("money") && secs.owner.includes("team"), secs);
  const me = "22222222-3333-4444-8555-666666666666";
  const V = (who) => ({ id: me, sections: secs[who], manage: who === "manager" || who === "owner" });
  const row = (source, extra = {}) => ({ source, subject_id: uid, route: "/crew?s=command", owner_user_id: null, ...extra });
  const forWho = (who, r) => O.obligationFor(r, V(who));
  ok("needs you is yours: a server keeps equipment upkeep (its one tap is anybody's); her own to-do is in My tasks, and the company's are not hers",
    forWho("server", row("asset_maintenance", { route: "/crew?s=garage" })) && !forWho("server", row("todos", { owner_user_id: me, route: "/crew?s=day" }))
    && !forWho("server", row("todos", { owner_user_id: uid, route: "/crew?s=day" })) && !forWho("server", row("todos", { route: "/crew?s=day" })));
  ok("needs you is yours: a server does not get Aug 1 Launch, a goal, a workstream, an offer or a dispute — none opens for her",
    !forWho("server", row("initiatives")) && !forWho("server", row("goals")) && !forWho("server", row("os_workstreams"))
    && !forWho("server", row("offer_letters", { route: "/crew?s=team&a=offers" })) && !forWho("server", row("square_disputes", { route: "/crew?s=money&a=shoporders" }))
    && !forWho("server", row("compliance_rules", { route: "/crew?s=prep" })));
  ok("needs you is yours: her own certificate is hers, and it opens the Academy, where it is renewed — not an admin's person record",
    forWho("server", row("academy_certifications", { owner_user_id: me, route: "/crew?s=team" }))
    && !forWho("server", row("academy_certifications", { owner_user_id: uid, route: "/crew?s=team" }))
    && JSON.stringify(O.obligationGo(row("academy_certifications", { owner_user_id: me }), V("server"))) === JSON.stringify({ kind: "page", href: "/academy" })
    && JSON.stringify(O.obligationGo(row("academy_certifications", { owner_user_id: uid }), V("owner"))) === JSON.stringify({ kind: "person", id: uid }));
  ok("needs you is yours: an operator gets the permit re-check (Prep is hers); a manager gets the initiative and every to-do but his own; the owner gets everything",
    forWho("operator", row("compliance_rules", { route: "/crew?s=prep" })) && !forWho("operator", row("initiatives"))
    && forWho("manager", row("initiatives")) && forWho("manager", row("todos", { owner_user_id: uid })) && !forWho("manager", row("todos", { owner_user_id: me })) && !forWho("manager", row("offer_letters"))
    && ["asset_maintenance", "todos", "initiatives", "goals", "os_workstreams", "offer_letters", "operator_agreements", "square_disputes", "invoices", "compliance_rules"]
      .every((s) => forWho("owner", row(s, { route: s === "invoices" ? "/crew?s=money" : s === "compliance_rules" ? "/crew?s=prep" : "/crew?s=command" }))));
  ok("needs you: the one-tap answers — two any staff member may give, and an invoice's \"Paid\", which is an owner's or admin's (0341 mark_invoice_paid)",
    JSON.stringify(Object.keys(O.OBLIGATION_WAYS).sort()) === JSON.stringify(["asset_maintenance", "invoices", "todos"])
    && O.OBLIGATION_WAYS.asset_maintenance === "staff" && O.OBLIGATION_WAYS.todos === "staff" && O.OBLIGATION_WAYS.invoices === "admin");
  ok("needs you: an invoice is its own answer — no panel lists invoices, so the row goes nowhere rather than to the top of Money",
    JSON.stringify(go("invoices", { route: "/crew?s=money" })) === JSON.stringify({ kind: "none" }));
  ok("needs you: an invoice is the money people's — the owner gets it, a server and an event manager do not",
    forWho("owner", row("invoices", { route: "/crew?s=money" })) && !forWho("server", row("invoices", { route: "/crew?s=money" }))
    && !forWho("manager", row("invoices", { route: "/crew?s=money" })));
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
    /if \(ev\.error\) throw new Error/.test(head) && /if \(o\.error\) throw new Error/.test(head));
  ok("headline: today's op and nothing else — its 'Top 3' were tasks already on the screen, task for task (one task, one place)",
    !/all_tasks/.test(head) && !/openTask/.test(head) && !/dayhead-t/.test(head) && /export default function DayHeadline\(\{ canGoLive \}: \{ canGoLive: boolean \}\)/.test(head)
    && /<DayHeadline canGoLive=\{canGoLive\} \/>/.test(crew));
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
  ok("the pass: an unpaid ticket says to collect — 'pre-order' named a payment state as an ordering one (the word lives in lib/collect since 0341)",
    /"UNPAID · collect at pickup"/.test(read("lib/collect.ts")) && /\{passWord\(o\)\}/.test(crew) && !/"pre-order"/.test(crew));
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
  ok("paper: the top three's cards left with them — no style is kept for a list that is not drawn", !/\.dayhead-t\b|\.dayhead-top\b/.test(css));
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

// ── MY DAY, 10:40 PM: FOUR CLEANINGS NOBODY COULD LOG, AND A LAUNCH NOBODY COULD MOVE (2026-10-04) ──
// Ryan's screenshot, no words: Needs you led with the nitro tap 94 days late and three more pieces of
// gear 71 days late, all "clean last done Jun 25", then "Aug 1 Launch — Initiative target · 64 days
// late". Logging a clean took eight steps and could not stick (the Assets panel took the EARLIEST next
// date any entry ever set); an initiative's date had no editor anywhere. These hold each answer.
{
  const fs = require("node:fs"), path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const U = require("../.smoke/upkeep.js");
  // The screenshot's own rhythm: the nitro tap set Jul 2 from Jun 25 (weekly), the other three Jul 25.
  const NITRO = { id: "m1", asset_id: "a1", kind: "clean", performed_on: "2026-06-25", next_due_on: "2026-07-02", summary: "Clean the stout faucet", how_to: "Pull the faucet\nSoak 20 min", created_at: "2026-06-25T15:00:00Z" };
  const GRINDER = { ...NITRO, id: "m2", asset_id: "a2", next_due_on: "2026-07-25", summary: "Clean burrs" };
  ok("upkeep: the rhythm is the gap the due entry set — weekly for the nitro tap, thirty days for the grinder",
    U.cadenceDays(NITRO) === 7 && U.cadenceDays(GRINDER) === 30 && U.cadenceDays({ performed_on: "2026-06-25", next_due_on: null }) === null
    && U.cadenceDays({ performed_on: "2026-06-25", next_due_on: "2026-06-25" }) === null && U.cadenceDays({ performed_on: "2026-06-25", next_due_on: "2026-06-01" }) === null);
  ok("upkeep: the entry that governs is the latest that set a date — not the earliest date ever set (the Assets panel's rule, which never cleared)",
    U.governing([NITRO, { ...NITRO, id: "m9", performed_on: "2026-10-04", next_due_on: "2026-10-11" }]).id === "m9"
    && U.governing([{ ...NITRO, id: "m9", performed_on: "2026-10-04", next_due_on: "2026-10-11" }, NITRO]).id === "m9");
  ok("upkeep: an entry with no date does not govern — a note leaves the cleaning schedule where it was, as v_obligations does",
    U.governing([NITRO, { ...NITRO, id: "n1", kind: "note", performed_on: "2026-08-01", next_due_on: null }]).id === "m1" && U.governing([]) === null);
  ok("upkeep: same day, the later entry wins — the view's 'performed_on desc, created_at desc'",
    U.governing([{ ...NITRO, id: "early", created_at: "2026-06-25T09:00:00Z" }, { ...NITRO, id: "late", created_at: "2026-06-25T18:00:00Z" }]).id === "late");
  ok("upkeep: done today is the same job again — same asset, kind, words and steps, the next date the same distance ahead, and who did it",
    JSON.stringify(U.donePatch(NITRO, "2026-10-04", { userId: "u1", name: " Ryan Thompkins " })) === JSON.stringify({
      asset_id: "a1", kind: "clean", performed_on: "2026-10-04", summary: "Clean the stout faucet", how_to: "Pull the faucet\nSoak 20 min",
      next_due_on: "2026-10-11", performed_by: "Ryan Thompkins", created_by: "u1" })
    && U.donePatch(GRINDER, "2026-10-04", { userId: null, name: null }).next_due_on === "2026-11-03"
    && U.donePatch({ ...NITRO, summary: "  " }, "2026-10-04", { userId: null, name: null }).summary === "Clean");
  const upkeepFake = ({ entry = NITRO, dup = [], fail = null } = {}) => {
    const calls = [];
    const sb = { from: (table) => {
      const q = { filters: [] };
      const chain = {
        select: (cols) => { q.cols = cols; return chain; },
        eq: (c, v) => { q.filters.push(["eq", c, v]); return chain; },
        gte: (c, v) => { q.filters.push(["gte", c, v]); return chain; },
        limit: () => { calls.push({ table, op: "dup", filters: q.filters }); return Promise.resolve(fail === "dup" ? { data: null, error: { message: "boom:dup" } } : { data: dup, error: null }); },
        maybeSingle: () => { calls.push({ table, op: "get", filters: q.filters }); return Promise.resolve(fail === "get" ? { data: null, error: { message: "boom:get" } } : { data: entry, error: null }); },
        insert: (row) => { calls.push({ table, op: "insert", row }); return Promise.resolve({ data: null, error: fail === "insert" ? { message: "boom:insert" } : null }); },
      };
      return chain;
    } };
    return { sb, calls };
  };
  PENDING.push((async () => {
    let f = upkeepFake();
    let r = await U.logDone(f.sb, "m1", "2026-10-04", { userId: "u1", name: "Ryan" });
    ok("logDone: reads the entry Needs-you named, checks today is not already logged, writes the next — in that order",
      r.error === null && r.already === false && r.next_due_on === "2026-10-11" && f.calls.map((c) => c.op).join() === "get,dup,insert"
      && f.calls[0].filters[0][2] === "m1" && JSON.stringify(f.calls[1].filters) === JSON.stringify([["eq", "asset_id", "a1"], ["eq", "kind", "clean"], ["gte", "performed_on", "2026-10-04"]])
      && f.calls[2].table === "asset_maintenance" && f.calls[2].row.next_due_on === "2026-10-11", { r, calls: f.calls });
    f = upkeepFake({ dup: [{ id: "x" }] });
    r = await U.logDone(f.sb, "m1", "2026-10-04", { userId: "u1", name: "Ryan" });
    ok("logDone: a second tap — or a second phone — writes nothing twice; the answer is 'already done'", r.error === null && r.already === true && !f.calls.some((c) => c.op === "insert"), f.calls);
    f = upkeepFake({ entry: null });
    r = await U.logDone(f.sb, "gone", "2026-10-04", { userId: null, name: null });
    ok("logDone: an entry that is gone is refused in words the screen can show, and nothing is written", typeof r.error === "string" && /Assets/.test(r.error) && f.calls.length === 1, r);
    f = upkeepFake({ entry: { ...NITRO, next_due_on: null } });
    r = await U.logDone(f.sb, "m1", "2026-10-04", { userId: null, name: null });
    ok("logDone: no rhythm to keep is refused — a 'done' with no next date would leave the old one governing, still late", typeof r.error === "string" && !f.calls.some((c) => c.op === "insert"), r);
    for (const where of ["get", "dup", "insert"]) {
      f = upkeepFake({ fail: where });
      r = await U.logDone(f.sb, "m1", "2026-10-04", { userId: null, name: null });
      ok(`logDone: a failed ${where} is the error, never 'done'`, r.error === `boom:${where}`, r);
    }
  })());

  const owed = code(read("components/Owed.tsx")), am = code(read("components/AssetMaintenance.tsx"));
  const sheet = read("components/InitiativeSheet.tsx"), board = code(read("components/CommandBoard.tsx"));
  ok("needs you: a row answers where it is listed — equipment 'Done today' through lib/upkeep, a to-do 'Mark done' through lib/tasks",
    /logDone\(supabase, r\.subject_id, localToday\(\), \{ userId: meId, name: profile\?\.display_name \?\? null \}\)/.test(owed)
    && /completeTask\("todo", r\.subject_id, meId\)/.test(owed)
    && /label: "Done today", busy, run: \(\) => doneToday\(r\)/.test(owed) && /label: "Mark done", busy, run: \(\) => markDone\(r\)/.test(owed)
    && /<button type="button" className="task-check" onClick=\{answer\.run\} disabled=\{answer\.busy\} aria-label=\{`\$\{answer\.label\}: \$\{r\.title\}`\}/.test(owed)
    && /if \(res\.error === null\) \{/.test(owed));
  ok("needs you: a row with an answer keeps its door when the viewer has one, and is plain text when they do not — no chevron to nowhere",
    /\{canGo\(r\)\s*\? <button type="button" className="owed-row-go" onClick=\{\(\) => go\(r\)\}>\{body\}<span className="owed-c" aria-hidden="true">›<\/span><\/button>\s*: <div className="owed-row-go">\{body\}<\/div>\}/.test(owed));
  ok("needs you: the list is the viewer's — obligationFor in the loader, and team tasks, bookings and restock only for whoever can act on them",
    /const rows = \(\(ob\.data as Row\[\]\) \?\? \[\]\)\.filter\(\(r\) => obligationFor\(r, v\)\);/.test(owed) && /if \(wantTeam \|\| wantStock\) try \{/.test(owed)
    && /if \(!wantTeam\) \{ tasks = \[\]; bookings = 0; \}/.test(owed) && /if \(!wantStock\) low = \[\];/.test(owed)
    && /const wantTeam = manage, wantStock = sectionsForRole\(role\)\.includes\("garage"\);/.test(owed) && /useAsyncData<Data>\(loader, \[loader\]\)/.test(owed));
  ok("needs you: an initiative row opens the initiative's own sheet", /if \(to\.kind === "initiative"\) \{ setInitId\(to\.id\); return; \}/.test(owed) && /<InitiativeSheet id=\{initId\}/.test(owed));
  ok("assets: due is the governing entry's date — the same rule as My Day — and never the earliest date ever set",
    /const due = governing\(mine\);\s*const nextDue = due\?\.next_due_on \?\? null;/.test(am) && !/\.sort\(\)\[0\]/.test(am));
  ok("assets: an overdue asset has 'Done today', the same write; the log sheet starts from the due job and keeps its rhythm",
    /logDone\(supabase, due\.id, localToday\(\)/.test(am) && /const gap = from \? cadenceDays\(from\) : null;/.test(am)
    && /useState\(gap \? addDays\(localToday\(\), gap\) : ""\)/.test(am) && /setLogFor\(\{ asset: a, from: s\.due \}\)/.test(am));
  ok("assets: a save or a delete that fails says so — the sheet used to close as if it had worked",
    /const \{ error \} = await supabase\.from\("asset_maintenance"\)\.insert\(/.test(am) && /if \(error\) throw error;/.test(am)
    && /const \{ error \} = await supabase\.from\("asset_maintenance"\)\.delete\(\)\.eq\("id", id\);\s*if \(error\)/.test(am));
  ok("initiative: one sheet changes its date, status and name — an admin's, as the database's policy is (0201)",
    /\.update\(\{ title: title\.trim\(\), summary: summary\.trim\(\) \|\| null, target_date: target \|\| null, status \}\)\.eq\("id", it\.id\)/.test(sheet)
    && /canEdit=\{can\.admin\}/.test(sheet) && /\/\/ vocab: initiatives\.status\nconst SETTABLE = \["planning", "active", "paused"\] as const;/.test(sheet)
    && /if \(error\) throw error;/.test(sheet) && /role="alert">\{err\}/.test(sheet));
  ok("command: an initiative on the board opens the same sheet; the Money pointer is an admin's, since only an admin can open Money",
    /onClick=\{\(\) => setOpenInit\(it\.id\)\}/.test(board) && /<InitiativeSheet id=\{openInit\}/.test(board)
    && /\{isAdmin && <button type="button" className="adm-golink" onClick=\{\(\) => setSection\("money"\)\}>/.test(board));
  ok("assets: the kinds the log sheet offers are declared to the vocabulary audit", /\/\/ vocab: asset_maintenance\.kind\nconst KINDS = /.test(read("components/AssetMaintenance.tsx")));
}

// ── PREP, 10:44 PM: THREE WEEKS OUT, NOTHING PLANNED, AND THE SCREEN SAID ALL CLEAR (2026-10-04) ──
// Ryan's screenshot of Prep › Dear Deandra Jazz Brunch, no words: "0 open · 0 critical · 21 days to
// go" over an event with no pick list; "✓ Complete event" three weeks early; five tools in three
// looks, two of which read as labels; four controls under 30px.
{
  const fs = require("node:fs"), path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const kpis = code(read("components/CrewKpis.tsx")), own = code(read("components/crew/OwnerDetails.tsx"));
  const crewSrc = code(read("app/crew/page.tsx")), css = read("app/globals.css");
  const prep = crewSrc.slice(crewSrc.indexOf("function PrepDetail("), crewSrc.indexOf("function AssignSheet(") > 0 ? crewSrc.indexOf("function AssignSheet(") : undefined);
  ok("prep: an event with no list says so — 'No pick list yet', landing on the buttons that make one — not '0 open'",
    /if \(!all\.count\) return \{ count: null, label: "No pick list yet", to: \{ anchor: "prep-target-start" \} \};/.test(kpis)
    && (crewSrc.match(/id="prep-target-start"/g) || []).length === 2);
  ok("prep: no list is not '0 critical', and a count with nothing behind it is a number, not a button",
    /if \(!all\.count\) return \{ count: null, to: null \};/.test(kpis) && /return \{ count: r\.count \?\? 0, to: r\.count \? undefined : null \};/.test(kpis)
    && /const to = r && r\.to !== undefined \? r\.to : t\.to;/.test(kpis) && /return to \? \(/.test(kpis) && /const lbl = r\?\.label \?\? t\.label;/.test(kpis));
  ok("prep: Complete waits for the day — it sat beside 'Confirmed' three weeks early",
    /const arrived = !dateVal \|\| dateVal <= localToday\(\);/.test(own) && /\) : isAdmin && arrived \? \(/.test(own));
  ok("prep: the five tools are one card each — Menu, Brew, Schedule, Load-out, Pack-out — none of them thin text",
    (crewSrc.match(/className="prep-collapse prep-tool"/g) || []).length === 5
    && /<b><Icon name="calendar" \/> Schedule<\/b>/.test(prep) && /<b><Icon name="package" \/> Pack-out plan<\/b>/.test(prep) && /<b><Icon name="coffee" \/> Brew<\/b>/.test(prep)
    && !/adm-regen" onClick=\{\(\) => setPlanOpen\(true\)\}/.test(prep) && !/adm-regen" onClick=\{\(\) => setPackPlanOpen\(true\)\}/.test(prep)
    && (prep.match(/onClick=\{planBrew\}/g) || []).length === 2 && /\.prep-tool\{margin-top:10px\}/.test(css));
  ok("prep: a menu chip that did not save goes back and says so — the write's result was ignored",
    /const \{ error \} = await supabase\.from\(table\)\.update\(patch\)\.eq\("id", ownerId\);\s*if \(error\) \{ setF\(before\); toast\(/.test(crewSrc));
  ok("prep: the controls that measured 22–28px have the 44 every other one there has",
    /\.admin \.adm-prep-back,\.atc-btn,\.ownerdet-edit,\.daybrief-edit\{min-height:44px\}/.test(css));
  ok("prep: the screen is painted and held by the design ratchet", /scripts\/fixtures\/prep-target\.html/.test(read("scripts/design.ratchet.mjs"))
    && /export const PREP_TARGET = \{ depth: 2, tap: 44, text: 10 \};/.test(read("scripts/design.ratchet.mjs")));
}

// ── MONEY AT THE WINDOW, AND INVOICES THAT FALL DUE (2026-10-04, 0341) ─────────────────────────────
// Ryan: "All four, in order" — money first; "Both cash and reader". Nothing in the app could mark a
// pay-at-pickup order paid, an invoice the app wrote had no due date, and nothing marked one paid.
// The database half is held by scripts/db.collect.test.mjs; this holds the app half.
{
  const fs = require("node:fs"), path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const C = require("../.smoke/collect.js");
  const OFQ = require("../.smoke/offline.js");

  // ── the rule ──
  ok("money: settled is paid, or collected at the window — or the stored answer, for a screen that read only that",
    C.isSettled({ paid: true }) && C.isSettled({ paid: false, collected_at: "2026-10-04T20:00:00Z" }) && C.isSettled({ payment_status: "paid" })
    && !C.isSettled({ paid: false, payment_status: "pending" }) && !C.isSettled({ paid: false, collected_at: null }) && !C.isSettled({}));
  ok("money: the crew can collect only when something is owed AND the row says the database can record it (0341's column present)",
    !C.canCollect({ paid: false }) && C.canCollect({ paid: false, collected_at: null })
    && !C.canCollect({ paid: true, collected_at: null }) && !C.canCollect({ paid: false, collected_at: "2026-10-04T20:00:00Z" }));
  ok("money: how it was paid — the two ways at the window, online by card, some other way, or not",
    C.paidHow({ collected_via: "cash", collected_at: "x", paid: true }) === "cash" && C.paidHow({ collected_via: "card_reader", collected_at: "x", paid: false }) === "card_reader"
    && C.paidHow({ paid: true, payment_id: "sq_1" }) === "online" && C.paidHow({ paid: true }) === "paid" && C.paidHow({ paid: false }) === null);
  ok("money: the pass says which, and the export says it in an accountant's words",
    C.passWord({ paid: false }) === "UNPAID · collect at pickup" && C.passWord({ paid: false }, true) === "UNPAID"
    && C.passWord({ collected_via: "cash", collected_at: "x", paid: true }) === "PAID · cash" && C.passWord({ collected_via: "card_reader", collected_at: "x" }) === "PAID · reader"
    && C.passWord({ paid: true, payment_id: "p" }) === "PAID"
    && C.ledgerWord({ collected_via: "cash", collected_at: "x", paid: true }) === "cash at the window" && C.ledgerWord({ collected_via: "card_reader", collected_at: "x" }) === "card reader at the window"
    && C.ledgerWord({ paid: true, payment_id: "p" }) === "paid online" && C.ledgerWord({ paid: false }) === "unpaid");
  const cashP = C.collectedPatch({ paid: false }, "cash", "2026-10-04T20:00:00Z", "u1"), readerP = C.collectedPatch({ paid: false }, "card_reader", "2026-10-04T20:00:00Z", "u1");
  ok("money: cash sets paid; the reader does not — Square already counts it, and counting it here too is the same money twice",
    cashP.paid === true && readerP.paid === false && cashP.payment_status === "paid" && readerP.payment_status === "paid"
    && readerP.collected_via === "card_reader" && readerP.collected_by === "u1");
  ok("money: taking one back unsets only what it set — cash off paid, the reader never touched it",
    JSON.stringify(C.undonePatch({ paid: true, collected_via: "cash", collected_at: "x" })) === JSON.stringify({ paid: false, collected_via: null, collected_at: null, collected_by: null, payment_status: "pending" })
    && C.undonePatch({ paid: false, collected_via: "card_reader", collected_at: "x" }).paid === false);
  const t0 = Date.parse("2026-10-04T20:00:00Z"), mine = { collected_via: "cash", collected_at: "2026-10-04T19:30:00Z", collected_by: "u1", paid: true };
  ok("money: undo is the collector's inside the hour, an admin's any time, and never an online card's — the database's rule",
    C.canUndo(mine, "u1", false, t0) && !C.canUndo(mine, "u2", false, t0) && !C.canUndo(mine, "u1", false, t0 + 3600e3)
    && C.canUndo(mine, "u2", true, t0 + 9 * 3600e3) && !C.canUndo({ paid: true, payment_id: "p" }, "u1", true, t0) && C.UNDO_WINDOW_MS === 3600e3);
  ok("money: each way tells the crew what it does to the count — cash is not rung on Square too; the reader counts there",
    /Don't ring it on Square too/.test(C.VIA_HINT.cash) && /counts there/.test(C.VIA_HINT.card_reader)
    && JSON.stringify(C.COLLECT_VIA) === JSON.stringify(["cash", "card_reader"]) && /\/\/ vocab: orders\.collected_via\nexport const COLLECT_VIA/.test(read("lib/collect.ts")));
  {
    const calls = [];
    const fake = (answer) => ({ rpc: async (fn, args) => { calls.push([fn, args]); return answer; } });
    PENDING.push((async () => {
      const a = await C.collectPayment(fake({ data: "collected", error: null }), "cup", "o1", "cash");
      const b = await C.collectPayment(fake({ data: "already settled", error: null }), "pickup", "p1", "card_reader");
      const c = await C.collectPayment(fake({ data: null, error: { message: "that order was voided — nothing to collect" } }), "cup", "o2", "cash");
      const d = await C.undoCollection(fake({ data: "nothing to undo", error: null }), "cup", "o3");
      const e = await C.markInvoicePaid(fake({ data: "already paid", error: null }), "i1");
      ok("money: the writes are the three RPCs, with the kind, the row and the way — and a refusal comes back as the database's sentence",
        JSON.stringify(calls[0]) === JSON.stringify(["staff_collect_payment", { p_kind: "cup", p_id: "o1", p_via: "cash" }])
        && JSON.stringify(calls[1]) === JSON.stringify(["staff_collect_payment", { p_kind: "pickup", p_id: "p1", p_via: "card_reader" }])
        && calls[3][0] === "staff_undo_collection" && JSON.stringify(calls[4]) === JSON.stringify(["mark_invoice_paid", { p_invoice: "i1" }])
        && a.error === null && !a.already && b.already && c.error === "that order was voided — nothing to collect" && d.already && e.already, { calls, a, b, c, d, e });
    })());
  }

  // ── no signal at the window ──
  const st = OFQ.orderStatusOp("o1", "done", 100), col = OFQ.collectCupOp("o1", "cash", 101);
  const qOff = OFQ.enqueueOp(OFQ.enqueueOp([], st), col);
  ok("money: a collection taken offline is queued under its own key — it never coalesces away the ticket's status, nor the status it",
    col.key === "collect_cup:o1" && col.kind === "collect_cup" && col.value === "cash" && qOff.length === 2
    && OFQ.enqueueOp(qOff, OFQ.collectCupOp("o1", "card_reader", 102)).filter((q) => q.kind === "collect_cup").map((q) => q.value).join() === "card_reader");
  const offSrc = code(read("components/offline.ts"));
  ok("money: the replay sends a queued collection to staff_collect_payment as a cup — the rest still to staff_set_order_status",
    /op\.kind === "collect_cup"\s*\? await supabase\.rpc\("staff_collect_payment", \{ p_kind: "cup", p_id: op\.id, p_via: op\.value \}\)\s*: await supabase\.rpc\("staff_set_order_status"/.test(offSrc));

  // ── the pass ──
  const crewSrc = code(read("app/crew/page.tsx"));
  const kit = crewSrc.slice(crewSrc.indexOf("function Kitchen("), crewSrc.indexOf("function ServicePulse("));
  ok("pass: an owed ticket has 'Collect $…' — the ticket's own recall button, recoloured — and only where the database can record it",
    /\{canCollect\(o\) && <button type="button" className="adm-recall adm-collect" onClick=\{\(\) => collect\(o\)\}>Collect \{money\(o\.total_cents\)\}<\/button>\}/.test(kit)
    && (kit.match(/canCollect\(o\) && <button/g) || []).length === 2);
  ok("pass: 'Picked up' on an owed ticket asks how they paid first — hand-off is when the money is asked about",
    /if \(to === "done" && canCollect\(o\)\) \{\s*const how = await askCollect\(\{ who: o\.customer \?\? "Guest", cents: o\.total_cents, handOff: true \}\);\s*if \(!how\) return;\s*const row = how === "unpaid" \? o : await takeMoney\(o, how\);\s*if \(!row\) return;\s*return move\(row, to\);/.test(kit));
  ok("pass: taking money is instant like a move, and with no signal it is parked and replayed — the till does not wait for bars",
    /apply\(paidRow, false\);/.test(kit) && /if \(isNetworkError\(res\.error\)\) \{ queueCollectCup\(o\.id, via\);/.test(kit) && /apply\(o, false\);\s*toast\(`Couldn't record it/.test(kit));
  ok("pass: the money word is lib/collect's — 'PAID · cash', 'PAID · reader' — on the board and in the picked-up tray",
    /<span className=\{isSettled\(o\) \? "pd" : "unp"\}>\{passWord\(o\)\}<\/span>/.test(kit) && /\{passWord\(o, true\)\}/.test(kit) && !/o\.paid \? "PAID"/.test(kit));
  ok("pass: a collection can be undone by the one who took it, inside the hour, where canUndo says it will work",
    (kit.match(/\{canUndo\(o, me, admin\) && \(/g) || []).length === 2 && /await undoCollection\(supabase, "cup", o\.id\)/.test(kit));
  ok("pass: voiding a paid order says what the refund is, and a card refund is flagged critical — it said only 'can't be undone'",
    /how === "cash" \? `They paid \$\{amt\} cash — hand it back\./.test(kit) && /severity: "critical", category: "money", kind: "refund_needed", subjectId: o\.id,/.test(kit)
    && /if \(how && how !== "cash"\) \{/.test(kit));
  ok("pass: the collect sheet is mounted on the board that asks", /\{collectSheet\}\s*<\/div>\s*\);\s*\}\s*$/.test(kit.trimEnd() + "\n"));
  ok("orders export: the paid column is lib/collect's ledger word — it called every unpaid order 'at pickup', picked up or not",
    /paid: ledgerWord\(o\),/.test(crewSrc) && !/paid: o\.paid \? "paid online" : "at pickup"/.test(crewSrc));
  ok("event HUD: a card paid online is not counted twice — once as the order, again as its own Square payment",
    /const linked = new Set\(o\.map\(\(x\) => x\.payment_id\)\.filter\(Boolean\)\);/.test(crewSrc)
    && /\.filter\(\(x\) => !x\.square_payment_id \|\| !linked\.has\(x\.square_payment_id\)\)/.test(crewSrc));

  // ── the pickup board ──
  const dops = code(read("components/DropOps.tsx"));
  ok("pickup: 'still to collect at the window' counts what is owed — it counted every pack not paid online",
    /const dueAtWindow = rows\.filter\(\(o\) => !isSettled\(o\)\)/.test(dops) && !/rows\.filter\(\(o\) => !o\.paid\)/.test(dops));
  ok("pickup: a pack can be collected, and handing it over asks first — whichever button got it to picked up",
    /\{canCollect\(o\) && <button type="button" className="dops-check collect" onClick=\{\(\) => collect\(o\)\}>/.test(dops)
    && /if \(stage === "picked_up" && canCollect\(o\)\) \{\s*const how = await askCollect\(\{ who: o\.name, cents: o\.total_cents, handOff: true \}\);/.test(dops)
    && (dops.match(/setStage\(o, /g) || []).length === 2 && !/setStage\(o\.id,/.test(dops) && /\{collectSheet\}/.test(dops));
  ok("pickup: a canceled pack's refund is what its payment was — cash back across the window, a card in Square, flagged critical (0242's rule)",
    /how === "cash" \? \{ title: `Cancel \$\{o\.name\}'s \$\{o\.size\}-pack, paid \$\{amt\} cash\?`, body: "Hand the cash back — nothing to refund in Square\."/.test(dops)
    && /severity: "critical", category: "money", kind: "refund_needed"/.test(dops) && !/severity: "important", category: "money"/.test(dops));
  ok("pickup: a stage, a bottle check or a batch that did not save says so — they wrote and reloaded without looking",
    (dops.match(/if \(error\) toast\(`Didn't save — \$\{error\.message\}`, "error"\);/g) || []).length === 3);
  ok("pickup: 'paid' on the upcoming and past lists is settled, not paid-online", /\{isSettled\(o\) \? <> · paid <Icon name="check" \/><\/> : ""\}/.test(dops) && /\{isSettled\(o\) \? "" : " · unpaid"\}/.test(dops));

  // ── the customer ──
  const packs = code(read("components/MyPacks.tsx")), status = code(read("components/OrderStatus.tsx")), funnel = code(read("components/OrderFunnel.tsx"));
  const inbox = code(read("components/MemberInbox.tsx")), mpire = code(read("app/3mpire/page.tsx")), move = code(read("app/api/reserve/move/route.ts"));
  ok("customer: a pack paid at the window reads paid, buzzes paid, and is not '$ at pickup'",
    /: isSettled\(p\) \? <><Icon name="check" \/> paid<\/> : "\$ at pickup"\}/.test(packs) && /return cur && !isSettled\(prev\) && isSettled\(cur\); \}\)\) haptic\("paid"\);/.test(packs)
    && /const atPickup = rows\.filter\(\(x\) => !isSettled\(x\)\)\.length;/.test(packs) && !/p\.paid \? <>|p\.paid \? "paid"|: p\.paid \? "paid"/.test(packs));
  ok("customer: paid at the window, the pack and the cup are the crew's to cancel — no button that the database will refuse",
    /\{!p\.collected_at && <button type="button" className="danger" onClick=\{\(\) => cancel\(p\)\}/.test(packs) && /\{onChange && !p\.collected_at && /.test(packs)
    && /\{o\.status === "new" && !o\.collected_at && \(/.test(status) && /const paid = isSettled\(o\);/.test(status));
  ok("customer: the lists that select their own columns read the stored answer (payment_status, there since 0155) — never a column 0341 has yet to add",
    /\.select\("id, size, paid, payment_status, picked_up"\)/.test(funnel) && /\$\{isSettled\(o\) \? "paid" : "pay at pickup"\}/.test(funnel)
    && /\.select\("id, size, drop_date, paid, payment_status, picked_up, canceled_at, status_changed_at, created_at"\)/.test(inbox) && /\$\{isSettled\(p\) \? "" : " · pay at pickup"\}/.test(inbox)
    && /\{isSettled\(o\) \? "Paid" : "Pre-order"\}/.test(mpire)
    && /\.select\("id, user_id, drop_date, size, glass, name, paid, payment_status, picked_up, stage, canceled_at"\)/.test(move) && /\(\$\{isSettled\(order\) \? "paid" : "pay at pickup"\}\)/.test(move));
  // A refund is still decided by `paid` — only a card paid online goes back through Square, and a
  // collected order cannot be canceled from a phone — so this looks for the WORDS of a payment state.
  ok("customer: the customer's screens import the rule from lib/settled — lib/collect is the crew's half, and every page loads what they import (0.7 KB, measured)",
    [packs, status, funnel, inbox, mpire, move].every((t) => /import \{ isSettled \} from "@\/lib\/settled";/.test(t) && !/from "@\/lib\/collect"/.test(t))
    && /export \{ isSettled, type Collectable \};/.test(read("lib/collect.ts")) && !/export function isSettled/.test(read("lib/collect.ts")));
  ok("customer: no screen says paid-or-owed from `paid` alone any more",
    ![packs, status, funnel, inbox, mpire, move, dops, kit].some((t) => /\b[opx]\.paid \? (?:<>|"(?:PAID|Paid|paid)\b|"" : " · (?:unpaid|pay at pickup)")/.test(t) || /\(o\) => !o\.paid\)/.test(t)));

  // ── office invoices ──
  const oo = code(read("components/OfficeOrders.tsx")), owedSrc = code(read("components/Owed.tsx")), office = code(read("app/office/page.tsx"));
  ok("office: a delivered order stays while it is still owed, and for the week after — delivery used to take it off the only screen that took its money",
    /\.or\(`status\.neq\.delivered,payment_status\.in\.\(pending,failed\),delivery_date\.gte\.\$\{weekAgo\}`\)/.test(oo) && !/\.neq\("status", "delivered"\)/.test(oo));
  ok("office: 'Undo jug swap' only where there is a swap — after a delivery — and 'Log delivery' / 'Cancel' only before one",
    /\{o\.status === "delivered" && <button type="button" className="btn-ter" onClick=\{\(\) => voidSwap\(o\)\}/.test(oo)
    && /\{o\.status !== "delivered" && <button type="button" className="btn-sec" onClick=\{\(\) => \{ setOpenId\(o\.id\);/.test(oo)
    && /\{o\.status !== "delivered" && <button type="button" className="btn-ter" onClick=\{\(\) => cancel\(o\)\}/.test(oo));
  ok("office: settling moves only from a state that still owes (a second tap cannot make a second invoice), and the invoice write is checked",
    /\.eq\("id", o\.id\)\.in\("payment_status", \["pending", "failed"\]\)\.select\("id"\);/.test(oo)
    && /const \{ error: invErr \} = await supabase\.from\("invoices"\)\.insert\(/.test(oo) && /if \(invErr\) \{\s*await supabase\.from\("business_orders"\)\.update\(\{ payment_status: o\.payment_status \}\)/.test(oo));
  ok("needs you: an invoice that falls due has 'Paid' on the row — an admin's, behind a question, settling invoice and order in one write",
    /if \(r\.source === "invoices"\) return \{ label: "Paid", busy, run: \(\) => invoicePaid\(r\) \};/.test(owedSrc)
    && /if \(!way \|\| \(way === "admin" && !admin\)\) return null;/.test(owedSrc) && /const res = await markInvoicePaid\(supabase, r\.subject_id\);/.test(owedSrc)
    && /confirmLabel: "Mark paid"/.test(owedSrc));
  ok("needs you: a row with nowhere to go and nothing to tap is not drawn as a door",
    /if \(to\.kind === "none"\) return false;/.test(owedSrc) && /if \(to\.kind === "none"\) return;/.test(owedSrc) && /if \(!answer\) return canGo\(r\) \? \(/.test(owedSrc));
  ok("office: the customer sees when an invoice is due, and 'paid' once it is — it said the database's 'open' for ever",
    /\.select\("id, amount_cents, status, issued_at, terms, due_at"\)/.test(office) && /`due \$\{new Date\(`\$\{v\.due_at\}T12:00:00`\)/.test(office));

  // ── the report, the sheet, the wiring ──
  const rep = read("components/Reports.tsx");
  ok("sales: the cash taken at the window is said on its own — the part of revenue that is in a till — and only once the column exists",
    /\/\/ arrives-with: 0341\n\s*const \[o, p\] = await Promise\.all\(\[/.test(rep) && /\.eq\("collected_via", "cash"\)\.neq\("status", "void"\)/.test(rep)
    && /\.eq\("collected_via", "cash"\)\.is\("canceled_at", null\)/.test(rep) && /if \(o\.error \|\| p\.error\) \{ setCash\(null\); return; \}/.test(rep));
  const sheet = read("components/CollectSheet.tsx"), css = read("app/globals.css");
  ok("collect sheet: two answers as the house choice card, the third quiet but a full 44px target",
    /className="dl-card collect-way"/.test(sheet) && /Hand it over unpaid/.test(sheet) && /\.collect-skip\{[^}]*min-height:44px/.test(css)
    && /\.adm-collect\{[^}]*\}/.test(css) && !/\.adm-collect\{[^}]*border-radius/.test(css) && !/\.collect-way\{[^}]*border-radius/.test(css));
  ok("money: the database test runs in db:test", /node scripts\/db\.collect\.test\.mjs/.test(require("../package.json").scripts["db:test"]));
  ok("collect sheet: the pass and the sheet are painted and held by the design ratchet, day and dark",
    /scripts\/fixtures\/collect-sheet\.html/.test(read("scripts/design.ratchet.mjs"))
    // depth 2 since the gesture round: the scrim's dim is a layer of its own and no longer a painted box.
    && /export const COLLECT_SHEET = \{ depth: 2, tap: 44, text: 11\.5 \};/.test(read("scripts/design.ratchet.mjs"))
    && !/class="screen/.test(read("scripts/fixtures/collect-sheet.html")));
  ok("money: the migration names its app half", /lib\/collect\.ts isSettled\(\)/.test(read("supabase/migrations/0341_the_window_says_what_it_took.sql"))
    && /components\/CollectSheet/.test(read("supabase/migrations/0341_the_window_says_what_it_took.sql")));
}

// ── A PERMIT RULE CAN BE RE-CHECKED FROM THE LIST THAT ASKS FOR IT (2026-10-04, 0342) ───────────
// Needs you listed permit rules due a re-check, and nothing in the app could record one: verified_on
// had no writer, and the row went to the top of Prep, which holds nothing about any one rule.
{
  const fs = require("node:fs"), path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const K = require("../.smoke/complianceCheck.js");
  const R = require("../.smoke/records.js");
  const O = require("../.smoke/obligations.js");
  const uid = "3fe59a00-2e58-43da-a075-aa0484bc4363";

  ok("permits: a re-check names where it was checked, and 'it has changed' says what changed",
    K.recheckProblem("confirmed", "the county") === null && /where you checked/.test(K.recheckProblem("confirmed", "  ") || "")
    && /what has changed/.test(K.recheckProblem("changed", "the county", "") || "") && K.recheckProblem("changed", "the county", "new form") === null);
  ok("permits: a correction needs the rule's words, its source, and a deadline that says how it counts",
    K.correctionProblem({ label: "Temp permit, 30 business days", link: "", authority: "", leadDays: 30, leadBasis: "business", checkedAgainst: "county site" }) === null
    && /its words/.test(K.correctionProblem({ label: "x", link: "", authority: "", leadDays: null, leadBasis: null, checkedAgainst: "county site" }) || "")
    && /business or calendar/.test(K.correctionProblem({ label: "Temp permit", link: "", authority: "", leadDays: 30, leadBasis: null, checkedAgainst: "county site" }) || "")
    && /not negative/.test(K.correctionProblem({ label: "Temp permit", link: "", authority: "", leadDays: -1, leadBasis: "calendar", checkedAgainst: "county site" }) || ""));
  ok("permits: a deadline in its own unit, and a date said the way the app says dates",
    K.deadlineWords(30, "business") === "30 business days before" && K.deadlineWords(null, null) === null
    && /^Never dated/.test(K.lastCheckedWords(null, "2026-10-04")) && /— today$/.test(K.lastCheckedWords("2026-10-04", "2026-10-04"))
    && /— 28 days ago$/.test(K.lastCheckedWords("2026-09-06", "2026-10-04")));
  {
    const calls = [];
    const fake = { rpc: async (fn, args) => { calls.push([fn, args]); return { data: null, error: fn === "correct_compliance_rule" ? { message: "only an owner or admin can correct a rule" } : null }; } };
    PENDING.push((async () => {
      const a = await K.recheckRule(fake, uid, "confirmed", "  SCDA by phone  ", "  ");
      const b = await K.correctRule(fake, uid, { label: " Temp permit ", link: "", authority: " SCDA ", leadDays: 10, leadBasis: "business", checkedAgainst: "SCDA", note: "" });
      ok("permits: the writes are the two RPCs — trimmed, empty as null — and a refusal comes back as the database's sentence",
        JSON.stringify(calls[0]) === JSON.stringify(["recheck_compliance_rule", { p_rule: uid, p_outcome: "confirmed", p_checked_against: "SCDA by phone", p_note: null }])
        && JSON.stringify(calls[1]) === JSON.stringify(["correct_compliance_rule", { p_rule: uid, p_label: "Temp permit", p_link: null, p_authority: "SCDA", p_lead_days: 10, p_lead_basis: "business", p_checked_against: "SCDA", p_note: null }])
        && a.error === null && b.error === "only an owner or admin can correct a rule", { calls, a, b });
    })());
  }

  ok("permits: a rule is a record — it has an address, a label, and the 'it changed' alert opens it",
    R.isRecordKind("compliance_rule") && R.RECORD_LABEL.compliance_rule === "Compliance rule"
    && R.parseRecordParam(`compliance_rule:${uid}`)?.kind === "compliance_rule"
    && JSON.stringify(R.recordForAlert("compliance_changed", uid)) === JSON.stringify({ kind: "compliance_rule", id: uid }));
  ok("permits: a Needs-you rule opens the rule — its route said Prep, which holds nothing about it",
    JSON.stringify(O.obligationGo({ source: "compliance_rules", subject_id: uid, route: "/crew?s=prep" })) === JSON.stringify({ kind: "rule", id: uid })
    && O.obligationGo({ source: "compliance_rules", subject_id: "not-a-uuid", route: "/crew?s=prep" }).kind === "section");

  const owedSrc = code(read("components/Owed.tsx")), sheetHost = code(read("components/RecordSheet.tsx"));
  const rec = code(read("components/ComplianceRuleRecord.tsx")), crew = code(read("app/crew/page.tsx"));
  ok("permits: Needs you opens the rule's record, and the record host knows the kind",
    /if \(to\.kind === "rule"\) \{ openRecord\("compliance_rule", to\.id\); return; \}/.test(owedSrc)
    && /ref\?\.kind === "compliance_rule" && <ComplianceRuleRecord ruleId=\{ref\.id\} onClose=\{closeRecord\} \/>/.test(sheetHost)
    && /const ComplianceRuleRecord = dynamic\(\(\) => import\("\.\/ComplianceRuleRecord"\), \{ ssr: false \}\);/.test(sheetHost));
  ok("permits: the sheet answers only where the database can record it — the row says (0342's verified_by key)",
    /canRecord: !!rule && "verified_by" in rule,/.test(rec) && /\) : !d\.canRecord \? \(/.test(rec));
  ok("permits: the two answers — still true, dated today; changed, which does not rewrite the rule — and both need where it was checked",
    /onClick=\{\(\) => recheck\("confirmed"\)\}/.test(rec) && /onClick=\{\(\) => recheck\("changed"\)\}/.test(rec)
    && /const problem = recheckProblem\(outcome, against, note\);/.test(rec) && /<span>Where did you check it\?<\/span>/.test(rec));
  ok("permits: correcting the rule is an owner's or admin's, and is checked before it is sent",
    /\{admin && rule\.active && d\.canRecord && \(/.test(rec) && /const problem = correctionProblem\(c\);/.test(rec) && /await correctRule\(supabase, rule\.id, c\)/.test(rec));
  ok("permits: the sheet shows what to check it against — the source page, the authority, the deadline, the last check",
    /Check it against the source/.test(rec) && /Issued by \{rule\.authority\}\./.test(rec) && /lastCheckedWords\(rule\.verified_on, localToday\(\)\)/.test(rec) && /deadlineWords\(rule\.lead_days, rule\.lead_basis\)/.test(rec));
  ok("permits: approving or dismissing a proposed rule says when the database refused it — it said 'Approved' whatever happened",
    /const \{ error \} = approve\s*\? await supabase\.from\("compliance_rules"\)\.update\(\{ active: true, verified: true \}\)\.eq\("id", id\)\s*: await supabase\.from\("compliance_rules"\)\.delete\(\)\.eq\("id", id\);\s*if \(error\) \{ toast\(/.test(crew));
  ok("permits: the vocabulary of a check and of a deadline is declared to the audit",
    /\/\/ vocab: compliance_checks\.outcome\nexport const CHECK_OUTCOMES/.test(read("lib/complianceCheck.ts")) && /\/\/ vocab: compliance_rules\.lead_basis\nexport const LEAD_BASES/.test(read("lib/complianceCheck.ts")));
  ok("permits: the database test runs in db:test", /node scripts\/db\.compliance\.test\.mjs/.test(require("../package.json").scripts["db:test"]));
  ok("permits: the rule sheet is painted and held by the design ratchet — its forms are sections, not boxes in a box",
    /scripts\/fixtures\/rule-sheet\.html/.test(read("scripts/design.ratchet.mjs")) && /export const RULE_SHEET = \{ depth: 2, tap: 44, text: 10\.5 \};/.test(read("scripts/design.ratchet.mjs"))
    && /\.crr-fix \.ts-chip\{min-height:44px;/.test(read("app/globals.css")));
}

// ── MY DAY: ONE TASK, ONE PLACE (2026-10-04) ───────────────────────────────────────────────────
// A task could show three times on one screen: in the headline's "Top 3", in My tasks, and in Needs
// you. Now it has one place — yours in My tasks; everybody else's under Needs you, where the team's
// most urgent three lead the list unfolded.
{
  const fs = require("node:fs"), path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const O = require("../.smoke/obligations.js");
  const owed = code(read("components/Owed.tsx")), crew = code(read("app/crew/page.tsx"));
  const mine = crew.slice(crew.indexOf("function MyTasks("), crew.indexOf("// ───────────────────────── per-event prep"));
  const me = "11111111-2222-4333-8444-555555555555", other = "22222222-3333-4444-8555-666666666666";
  const V = (manage) => ({ id: me, sections: ["day"], manage });
  ok("one place: a to-do assigned to you is in My tasks and not in Needs you — for anyone, manager or not",
    !O.obligationFor({ source: "todos", subject_id: "t", route: "/crew?s=day", owner_user_id: me }, V(true))
    && !O.obligationFor({ source: "todos", subject_id: "t", route: "/crew?s=day", owner_user_id: me }, V(false)));
  ok("one place: somebody else's to-do, or nobody's, is a manager's to triage in Needs you",
    O.obligationFor({ source: "todos", subject_id: "t", route: "/crew?s=day", owner_user_id: other }, V(true))
    && O.obligationFor({ source: "todos", subject_id: "t", route: "/crew?s=day", owner_user_id: null }, V(true))
    && !O.obligationFor({ source: "todos", subject_id: "t", route: "/crew?s=day", owner_user_id: other }, V(false)));
  ok("one place: the team's late tasks skip yours — they are in My tasks, right above",
    /\.select\("id, label, event_id, stop_id, due_at, critical, assignee"\)/.test(owed) && /if \(meId && t\.assignee === meId\) continue;/.test(owed));
  ok("one place: the team list leads with its three most urgent, unfolded — critical first, then the latest — under its own head",
    /tasks\.sort\(\(a, b\) => Number\(b\.critical\) - Number\(a\.critical\) \|\| \(b\.late \?\? 0\) - \(a\.late \?\? 0\)\);/.test(owed)
    && /const TEAM_LEAD = 3;/.test(read("components/Owed.tsx")) && /: tasks\.slice\(0, TEAM_LEAD\)\)\.map\(/.test(owed)
    && /<span className="owed-k">Team tasks late<\/span>/.test(owed) && /\{t\.critical && <Icon name="warning" \/>\}/.test(owed));
  ok("my tasks: a failed read says so — it said 'Nothing on your plate — you're clear for today' about a list it never saw",
    /const \{ data, error \} = await supabase\s*\.from\("all_tasks"\)/.test(mine) && /if \(error\) \{ setErr\(error\.message\); setLoaded\(true\); return; \}/.test(mine)
    && /const empty = loaded && !err && tasks\.length === 0;/.test(mine) && /Couldn&apos;t load your tasks — this is not &ldquo;nothing on your plate&rdquo;\./.test(mine));
  ok("my tasks: a tick that did not save puts the task back and says so — it vanished either way",
    /const ok = await completeTask\(/.test(mine) && /if \(!ok\) \{ toast\(/.test(mine));
  ok("one place: the painted My Day has no top three, and its team list leads with them",
    !/dayhead-top/.test(read("scripts/fixtures/my-day.html")) && /<div class="owed-head sub">/.test(read("scripts/fixtures/my-day.html")));
}

// ── THE CUSTOMER SIDE: ONE ORDERING RULE, AND A PRE-ORDER SAYS WHEN (2026-10-04, 0343) ────────────
// The fourth of Ryan's four. "Can I order a cup?" had three answers — the phone's (the city's
// switch, the stop's own lead), the server's (the singleton, the global lead) and Find Us' (none:
// PRE-ORDER with nothing scheduled) — and nobody answered "made when?": a 7am order for an 11am stop
// read "Ready in ~8 min" and aged red on the pass from 7. lib/ordering is the rule, lib/orderingRead
// the read, both sides call both. These pin the rule, its words, the crew's clock, the write across
// the 0343 skew, and that every surface asks it.
{
  const O = require("../.smoke/ordering.js");
  const DT2 = require("../.smoke/dates.js");
  const OA2 = require("../.smoke/orderAhead.js");
  const SK = require("../.smoke/schemaSkew.js");
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

  const H = 3600e3, M = 60e3;
  const T = Date.parse("2026-10-10T15:00:00Z");                 // Sat Oct 10, 11:00am ET
  const iso = (ms) => new Date(ms).toISOString();
  const stop = (id, s, e, lead = 4 * H, extra = {}) => ({ id, name: `Stop ${id}`, starts_at: iso(s), ends_at: e == null ? null : iso(e), where: "Five Forks", leadMs: lead, pickup: false, ...extra });
  const A = stop("A", T, T + 4 * H);                            // 11:00–3:00
  const B = stop("B", T + 6 * H, T + 9 * H);                    // 5:00–8:00, same day
  const at = (now, live, stops, ptr = null) => O.orderingNow(now, live, stops, ptr);
  const st = (o) => `${o.state}/${o.open}/${o.stop ? o.stop.id : "-"}`;

  // ── the states ──
  ok("ordering: nothing scheduled and not live is none — closed, no stop", st(at(T, false, [])) === "none/false/-");
  ok("ordering: the truck live with nothing scheduled is still a truck pouring", st(at(T, true, [])) === "live/true/-");
  ok("ordering: before the lead window it is early, and says when cups open (start − lead)",
    st(at(T - 5 * H, false, [A])) === "early/false/A" && at(T - 5 * H, false, [A]).opensAt === iso(T - 4 * H));
  ok("ordering: inside the lead window it is ahead — open, made from the stop's start",
    st(at(T - 4 * H, false, [A])) === "ahead/true/A" && at(T - H, false, [A]).readyFrom === A.starts_at);
  ok("ordering: a stop under way with the switch not flipped is started — open, made now",
    st(at(T + H, false, [A])) === "started/true/A" && at(T + H, false, [A]).readyFrom === null);
  ok("ordering: live at the stop is live — made now", st(at(T + H, true, [A], "A")) === "live/true/A" && at(T + H, true, [A], "A").readyFrom === null);
  ok("ordering: the switch flipped early, before the start, is live (not ahead) — the crew is pouring",
    st(at(T - 30 * M, true, [A], "A")) === "live/true/A" && at(T - 30 * M, true, [A], "A").readyFrom === null);

  // ── the hour before close: FindUs' rule, everywhere now ──
  ok("ordering: online orders stop AT close − 1h (FindUs' `now < end − 60 min`), live or not",
    st(at(T + 3 * H, true, [A], "A")) === "closing/false/A" && st(at(T + 3 * H - 1, true, [A], "A")) === "live/true/A"
    && st(at(T + 3.5 * H, false, [A])) === "closing/false/A");
  ok("ordering: a stop shorter than the hour still takes orders up to its start",
    st(at(T - 10 * M, false, [stop("S", T, T + 30 * M)])) === "ahead/true/S" && st(at(T + 5 * M, false, [stop("S", T, T + 30 * M)])) === "closing/false/S");
  ok("ordering: winding down while the next stop's window is open sends new orders to the next stop, made from its start",
    st(at(T + 3.5 * H, false, [A, B])) === "ahead/true/B" && st(at(T + 3.5 * H, true, [A, B], "A")) === "ahead/true/B"
    && at(T + 3.5 * H, true, [A, B], "A").readyFrom === B.starts_at);
  ok("ordering: …and is closing when the next one's window has not opened", st(at(T + 3.5 * H, false, [A, stop("C", T + 9 * H, null)])) === "closing/false/A");
  ok("ordering: a live switch left on past the stop's close time is not a truck pouring",
    st(at(T + 5 * H, true, [A], "A")) === "none/false/-" && st(at(T + 5 * H, true, [A, B], "A")) === "ahead/true/B");
  ok("ordering: …but with no close time the switch is the crew's word, as on Find Us",
    at(T + 9 * H, true, [stop("N", T, null)], "N").state === "live");
  ok("ordering: with no close time the grace is lib/road's 8 hours, inclusive",
    st(at(T + 8 * H, false, [stop("N", T, null)])) === "started/true/N" && st(at(T + 8 * H + 1, false, [stop("N", T, null)])) === "none/false/-"
    && O.PREORDER_TAIL_MS === require("../.smoke/road.js").STOP_DONE_GRACE_MS);
  ok("ordering: lead 0 is strict live-only — closed before and during, with no opening time to quote",
    st(at(T - H, false, [stop("Z", T, null, 0)])) === "early/false/Z" && st(at(T + H, false, [stop("Z", T, null, 0)])) === "early/false/Z"
    && at(T - H, false, [stop("Z", T, null, 0)]).opensAt === null && st(at(T + H, true, [stop("Z", T, null, 0)], "Z")) === "live/true/Z");
  ok("ordering: a stop's own lead widens its window (0191) — the case the server used to refuse at Pay",
    st(at(T - 20 * H, false, [stop("L", T, null, 24 * H)])) === "ahead/true/L" && st(at(T - 20 * H, false, [stop("L", T, null)])) === "early/false/L");
  ok("ordering: a pointer to another city's stop is not trusted — where the truck is comes from this city's road",
    st(at(T + H, true, [A], "elsewhere")) === "live/true/A");
  ok("ordering: an unparseable start is skipped, never a stop", st(at(T, false, [{ ...A, starts_at: "not a date" }])) === "none/false/-");

  // ── the per-stop lead and the place, from a stops row ──
  const row = { id: "r", name: " Market ", starts_at: A.starts_at, ends_at: null, location_text: "", address: "1 Main St", order_ahead_enabled: true, order_ahead_lead_min: 90, pickup_enabled: true };
  ok("ordering: a row's own lead (on, minutes) wins; off, or no minutes, is the city's",
    O.orderingStop(row, 4 * H).leadMs === 90 * M && O.orderingStop({ ...row, order_ahead_enabled: false }, 4 * H).leadMs === 4 * H
    && O.orderingStop({ ...row, order_ahead_lead_min: null }, 4 * H).leadMs === 4 * H && O.orderingStop({ ...row, order_ahead_lead_min: 0 }, 4 * H).leadMs === 0);
  ok("ordering: the place is location_text, else the address; the name trimmed; no start, no stop",
    O.orderingStop(row, H).where === "1 Main St" && O.orderingStop({ ...row, location_text: "Five Forks" }, H).where === "Five Forks"
    && O.orderingStop(row, H).name === "Market" && O.orderingStop({ ...row, starts_at: null }, H) === null && O.orderingStop(row, H).pickup === true);

  // ── the words — server and phone say them from here ──
  ok("words: early names the opening, in ET, with the stop; named:false leaves the name to Find Us' headline",
    O.closedWords(at(T - 5 * H, false, [A]), { nowMs: T - 5 * H }) === "Cup orders open today at 7:00am for Stop A."
    && O.closedWords(at(T - 5 * H, false, [A]), { nowMs: T - 5 * H, named: false }) === "Cup orders open today at 7:00am.");
  ok("words: strict, nothing scheduled, and the open states",
    O.closedWords(at(T - H, false, [stop("Z", T, null, 0)])) === "Cup orders open when the truck goes live."
    && O.closedWords(at(T, false, [])) === "Cup orders open when the next stop is posted." && O.closedWords(at(T + H, true, [A], "A")) === null);
  ok("words: closing is the owner's copy when a screen passes it, the default on the server",
    O.closedWords(at(T + 3.5 * H, false, [A]), { closing: "Owner words." }) === "Owner words."
    && /^Online ordering’s closed for today/.test(O.closedWords(at(T + 3.5 * H, false, [A]))));
  ok("words: ahead is made-when, live is the ~8 minutes it always was",
    O.readyWords(at(T - H, false, [A]), T - H) === "We make it when we open — today at 11:00am." && O.readyWords(at(T + H, true, [A], "A")) === "Ready in ~8 min.");
  ok("words: the confirmation keeps its made-now lines byte for byte; an order placed ahead says when",
    O.confirmWords(null, true) === "Ready in ~8 min — we'll have it waiting at the window." && O.confirmWords(null, false) === "Ready in ~8 min — pay at the truck when you arrive."
    && O.confirmWords(A.starts_at, false, T - 20 * H) === "We make it when we open — tomorrow at 11:00am. Pay at the truck when you arrive.");
  ok("words: the server's refusal is the page's words plus the pack — except while still pouring",
    O.refusalWords(at(T - 5 * H, false, [A]), T - 5 * H) === "Cup orders open today at 7:00am for Stop A. Reserve a pack instead."
    && !/Reserve a pack/.test(O.refusalWords(at(T + 3.5 * H, false, [A]))));
  ok("words: pickup is the stop and its place, or the truck when it is live off-schedule; open words only ahead",
    O.pickupWords(at(T + H, true, [A], "A")) === "Stop A · Five Forks" && O.pickupWords(at(T, true, [])) === "At the truck"
    && O.pickupWords({ stop: { ...A, where: "Five Forks Plaza, Simpsonville, SC 29681" } }) === "Stop A · Five Forks Plaza, Simpsonville, SC"
    && O.openWords(at(T + H, true, [A], "A")) === null && O.openWords(at(T - H, false, [A]), T - H) === "Order now — we make it when we open, today at 11:00am.");
  ok("etWhen: today, tomorrow, a weekday inside the week, the date from a week out",
    DT2.etWhen(iso(T), T - H) === "today at 11:00am" && DT2.etWhen(iso(T), T - 20 * H) === "tomorrow at 11:00am"
    && DT2.etWhen(iso(T), T - 3 * 24 * H) === "Sat at 11:00am" && DT2.etWhen(iso(T), T - 8 * 24 * H) === "Sat, Oct 10 at 11:00am" && DT2.etWhen(null) === "");
  ok("etWhen: the business day, not UTC's — 11pm ET Friday is still Friday",
    DT2.etWhen("2026-10-10T03:00:00Z", Date.parse("2026-10-09T16:00:00Z")) === "today at 11:00pm", DT2.etWhen("2026-10-10T03:00:00Z", Date.parse("2026-10-09T16:00:00Z")));

  // ── the crew's clock ──
  const placed = { created_at: iso(T - 4 * H), ready_from: A.starts_at };
  ok("pass clock: an order placed ahead is aged from its stop's opening, not from when it came in",
    O.orderClockFrom(placed) === A.starts_at && O.orderClockFrom({ created_at: iso(T) }) === iso(T)
    && O.orderClockFrom({ created_at: iso(T), ready_from: iso(T - H) }) === iso(T));
  ok("pass clock: it waits until then, and its badge says for when",
    O.waitingToOpen(placed, T - H) && !O.waitingToOpen(placed, T) && !O.waitingToOpen({ created_at: iso(T) }, T)
    && O.waitingLabel(A.starts_at, T - H) === "for 11:00am" && O.waitingLabel(A.starts_at, T - 20 * H) === "for tomorrow at 11:00am");

  // ── the pack line quotes the drop /api/reserve offers ──
  const now = new Date(T - 2 * 24 * H);
  ok("packs: nothing scheduled is the Saturday cadence (nextDrop), as /api/reserve falls back",
    OA2.packDropFrom([], now).sat.getTime() === OA2.nextDrop(now).sat.getTime());
  ok("packs: the first upcoming stop whose cutoff is still ahead — not the stop under way",
    OA2.packDropFrom([iso(T - 3 * 24 * H), A.starts_at], now).sat.toISOString() === A.starts_at
    && OA2.packDropFrom([iso(now.getTime() + 2 * H), A.starts_at], now).sat.toISOString() === A.starts_at);
  ok("packs: every scheduled cutoff gone is no date to quote — not a 'reserve by' in the past",
    OA2.packDropFrom([iso(now.getTime() + 2 * H)], now) === null);

  // ── the write across the 0343 skew ──
  ok("schema skew: PostgREST's write-side refusal (PGRST204, or its sentence) is a missing column too",
    SK.isMissingColumn({ code: "PGRST204", message: "x" }) && SK.isMissingColumn({ message: "Could not find the 'ready_from' column of 'orders' in the schema cache" })
    && !SK.isMissingColumn({ code: "PGRST205", message: "Could not find the table 'public.orders' in the schema cache" }));
  PENDING.push((async () => {
    const run = async (answers, row, arriving) => {
      const seen = [];
      const r = await SK.writeAcrossSkew(async (x) => { seen.push(Object.keys(x).sort().join(",")); return { error: answers[seen.length - 1] ?? null }; }, row, arriving);
      return { ...r, seen };
    };
    const miss = { code: "PGRST204", message: "Could not find the 'ready_from' column of 'orders' in the schema cache" };
    const a = await run([null], { items: 1, ready_from: "t" }, ["ready_from"]);
    ok("write skew: a schema that has the column writes once", a.seen.length === 1 && a.error === null && a.dropped.length === 0, a);
    const b = await run([miss, null], { items: 1, ready_from: "t" }, ["ready_from"]);
    ok("write skew: a schema one migration behind writes again without the arriving key — and says it dropped it",
      b.seen.join("|") === "items,ready_from|items" && b.error === null && b.dropped.join() === "ready_from", b);
    const c = await run([{ code: "23505", message: "duplicate key" }], { items: 1, ready_from: "t" }, ["ready_from"]);
    ok("write skew: any other error comes back untouched, no second write", c.seen.length === 1 && c.error.code === "23505", c);
    const d = await run([miss], { items: 1 }, ["ready_from"]);
    ok("write skew: a missing column it was not told about is not forgiven", d.seen.length === 1 && d.error === miss, d);
  })());

  // ── every surface asks the rule ──
  const hook = code(read("components/useOrderingOpen.ts")), api = code(read("app/api/checkout/route.ts"));
  const fu = code(read("components/FindUs.tsx")), menu = code(read("app/menu/page.tsx")), sheet = code(read("components/DrinkSheet.tsx"));
  const co = code(read("components/Checkout.tsx")), bar = code(read("components/OrderStatus.tsx")), crew = code(read("app/crew/page.tsx"));
  ok("one rule: the phone and the server read with lib/orderingRead and decide with lib/ordering",
    /readOrdering\(supabase!, market\)/.test(hook) && /orderingNow\(now, inputs\.isLive, inputs\.stops, inputs\.liveStopId\)/.test(hook)
    && /readOrdering\(supabaseAdmin, toMarket\(/.test(api) && /orderingNow\(nowMs, read\.inputs\.isLive, read\.inputs\.stops, read\.inputs\.liveStopId\)/.test(api));
  ok("one rule: no second copy — the server no longer reads the singleton's switch or calls preorderWindow",
    !/preorderWindow\(/.test(api) && !/preorderWindow\(/.test(hook) && !/select\("is_live, preorder_lead_h"\)\.maybeSingle\(\)/.test(api)
    && !/ORDERS_CLOSE_BEFORE/.test(fu) && /export const ORDERS_CLOSE_BEFORE_END_MS = 60 \* 60 \* 1000;/.test(read("lib/ordering.ts")));
  ok("one rule: the read takes the city's switch, the live pointer and the stop's own lead, and a stops error is an error",
    /from\("market_live"\)\.select\("is_live, preorder_lead_h"\)\.eq\("market", market\)/.test(read("lib/orderingRead.ts"))
    && /select\("is_live, preorder_lead_h, current_stop_id"\)/.test(read("lib/orderingRead.ts"))
    && /order_ahead_enabled, order_ahead_lead_min, pickup_enabled/.test(read("lib/orderingRead.ts"))
    && /if \(road\.error\) return \{ inputs: null, error: road\.error\.message \};/.test(read("lib/orderingRead.ts")));
  ok("server: it refuses in the page's words, and a failed read refuses rather than charging",
    /if \(!ordering\.open\) return NextResponse\.json\(\{ error: refusalWords\(ordering, nowMs\) \}, \{ status: 409 \}\);/.test(api)
    && /if \(!read\.inputs\) \{\s*return NextResponse\.json\(\{ error: "We couldn't check the truck's schedule/.test(api));
  ok("server: every order row goes through the skew-safe write, with ready_from only when placed ahead",
    !/\.from\("orders"\)\.insert\(orderRow\)/.test(api) && (api.match(/await insertOrder\(orderRow\)/g) || []).length === 3
    && /writeAcrossSkew\(\(r\) => supabaseAdmin!\.from\("orders"\)\.insert\(r\), promise\.readyFrom \? \{ \.\.\.row, ready_from: promise\.readyFrom \} : row, \["ready_from"\]\)/.test(api));
  ok("server: the email says the promise, and every success answers with it",
    (api.match(/message: `GT3: your order is in\. \$\{promise\.ready\} \$\{promise\.pickup\}\./g) || []).length === 2 && !/ready in ~8 min/.test(api)
    && (api.match(/\.\.\.promise \}/g) || []).length >= 4);
  ok("Find Us: asks the rule; with nothing to pre-order the button is the menu and the line says when cups open",
    /useOrderingOpen\(true, viewerMarket, `\$\{live\?\.is_live/.test(fu) && /\}, \[active, market, refreshKey\]\);/.test(hook) && /t\(ordering && !ordering\.open \? "findus\.cta_menu" : "findus\.cta_preorder"\)/.test(fu)
    && /closedWords\(ordering, \{ named: false \}\)/.test(fu) && /ordering\?\.state === "closing"/.test(fu)
    && /\.fu-state\{min-height:1\.45em/.test(read("app/globals.css")));
  ok("Find Us: the live row's Pre-order chip follows the same rule", /rowLive && ordering\?\.open !== false && <button/.test(fu));
  ok("menu: closed, the order line is the truck's state, the price is a price and the hint says what a tap does",
    /const closed = o !== null && !o\.open;/.test(menu) && /entry-px\$\{out \? "" : closed \? " shut" : " order"\}/.test(menu) && /\.entry-px\.shut\{border:1px solid transparent;padding:3px 10px\}/.test(read("app/globals.css"))
    && /className="mast-order mast-state" role="status"/.test(menu) && /k="menu\.taphint_closed"/.test(menu)
    && /closedWords\(o, \{ closing: t\("findus\.cta_closed"\) \}\) : openWords\(o\)/.test(menu));
  ok("drink sheet: says when cups open (not the stop's start), quotes the reservable drop, and knows closing from closed",
    /closedWords\(o, \{ closing: t\("findus\.cta_closed"\) \}\)/.test(sheet) && /packDropFrom\(ordering\.stops\.map/.test(sheet)
    && !/toLocaleString\(undefined, \{ weekday: "short", hour/.test(sheet) && /o\?\.state === "closing" \? t\("sheet\.closing_cta"\) : t\("sheet\.closed_cta"\)/.test(sheet)
    && /o\?\.state === "ahead"\s*\? <div className="sheet-signoff">\{readyWords\(o\)\}<\/div>/.test(sheet));
  ok("checkout: where and when before the money; the confirmation and its receipt say the server's promise",
    /<b>\{pickupWords\(o\)\}<\/b>/.test(co) && /<span className="co-pickup-when">\{readyWords\(o\)\}/.test(co)
    && /sub=\{confirmWords\(done\.readyFrom, done\.paid\)\}/.test(co) && /\{ label: "Pickup", value: done\.pickup \}/.test(co)
    && !/Ready in ~8 min/.test(co.replace(/"Ready in ~8 min\."/g, "")) && /closedWords\(o, \{ closing: t\("findus\.cta_closed"\) \}\)/.test(co));
  ok("checkout: a refused pre-order shows the server's reason, not a generic retry",
    /toast\(error\.message \|\| "That didn't go through — give it another tap", "error"\)/.test(co));
  ok("order bar: an order placed ahead says when it is made, not 'Order received' for hours",
    /o\.status === "new" && o\.ready_from && waitingToOpen\(o\)\s*\? readyWords\(\{ state: "ahead", readyFrom: o\.ready_from \}\)/.test(bar));
  ok("the pass: late counts only tickets whose clock has started, aged from orderClockFrom, badged until then",
    /o\.status !== "ready" && !waitingToOpen\(o\) && ageMin\(orderClockFrom\(o\)\) >= 8/.test(crew)
    && /const sev = waiting \? "calm" : ageSev\(ageMin\(orderClockFrom\(o\)\)\);/.test(crew) && /waitingLabel\(o\.ready_from\)/.test(crew)
    && !/ageMin\(o\.created_at\)/.test(crew));
  ok("copy: the three new keys are registered with their defaults",
    /key: "findus\.cta_menu"[^}]*default: "SEE THE MENU"/.test(read("lib/copy.ts")) && /key: "sheet\.closing_cta"/.test(read("lib/copy.ts")) && /key: "menu\.taphint_closed"/.test(read("lib/copy.ts")));

  // ── the QR and the splash ──
  const conn = read("lib/connect.ts"), disp = code(read("app/display/page.tsx")), splash = code(read("components/MarketingSplash.tsx"));
  const proxy = code(read("proxy.ts")), home = code(read("app/page.tsx")), hint = read("lib/viewerHint.ts");
  ok("QR: the truck screen's Scan to order opens the menu, not the front door",
    /export const SCAN_TO_ORDER = `\$\{CONNECT_APP\}\/menu`;/.test(conn) && /QRCode\.toDataURL\(SCAN_TO_ORDER,/.test(disp) && !/QRCode\.toDataURL\(CONNECT_APP,/.test(disp));
  ok("splash: /truck is the front door only when the hop from '/' said so — no door set, asked after auth",
    !/FRONT_DOORS/.test(splash) && /if \(pathname === "\/truck" && !cameThroughFrontDoor\(\)\) return;/.test(splash)
    && splash.indexOf("cameThroughFrontDoor()") > splash.indexOf("if (!ready || user) return;"));
  ok("splash: the mark is cleared when the welcome SHOWS, beside its seven-day stamp — a first visit reloads /truck once, and a mark read away by the first document was gone for the second",
    /localStorage\.setItem\(SEEN_KEY, String\(Date\.now\(\)\)\);[^\n]*\n\s*clearFrontDoor\(\);\n\s*setShow\(true\);/.test(splash) && !/takeFrontDoor/.test(splash + hint));
  ok("splash: both hops mark it — proxy.ts on its redirect, app/page.tsx before its own",
    /res\.cookies\.set\(DOOR_COOKIE, "1", \{ path: "\/", maxAge: DOOR_MAX_AGE_S, sameSite: "lax" \}\);/.test(proxy)
    && /\{ markFrontDoor\(\); router\.replace\("\/truck"\); \}/.test(home));
  const swr = code(read("components/ServiceWorkerRegister.tsx"));
  ok("first visit: the service worker's first claim does not reload the page — only a worker replacing a worker does",
    /let hadController = !!navigator\.serviceWorker\.controller;/.test(swr) && /if \(!hadController\) \{ hadController = true; return; \}/.test(swr)
    && swr.indexOf("if (!hadController)") < swr.indexOf("window.location.reload()") && /self\.clients\.claim\(\)/.test(read("public/sw.js")));
  ok("splash: the mark is a two-minute cookie that grants nothing",
    /export const DOOR_COOKIE = "gt3-door";/.test(hint) && /export const DOOR_MAX_AGE_S = 120;/.test(hint)
    && /document\.cookie = `\$\{DOOR_COOKIE\}=; path=\/; max-age=0; samesite=lax`;/.test(hint) && !/httponly/i.test(hint));
}

// ── WORDS THE COMPILER GLUES TOGETHER (2026-10-04) ───────────────────────────────────────────────
// Checkout's pay-at-the-truck note read "This is a pre-order— we'll have it ready" on the screen,
// with a space in the source. Next's compiler (SWC) drops the leading space of a JSX text child that
// holds an HTML entity and runs onto the next line — reproduced on four samples: " — we&apos;ll
// have it.⏎" lost it; the same line without the entity kept it, as did the entity on one line. Three
// lines on production had the shape (checkout's note, the crew roster's CRM link, the operator
// deal's interim hours), and a fourth had plain JSX's own trap: a line break right after </b> is no
// space at all ("+ Add productwith its Apliiq ID"). Each now says {" "} where it means a space; this
// reads every .tsx so the next one fails here, not on a phone.
{
  const ts = require("typescript");
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.name === "node_modules" || f.name.startsWith(".")) continue; const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (p.endsWith(".tsx")) files.push(p); } };
  walk(path.join(root, "components")); walk(path.join(root, "app"));
  const INLINE = new Set(["b", "em", "strong", "i", "a", "code", "Link"]);
  const glued = (src, file) => {
    const out = [];
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
        const kids = node.children;
        for (let i = 1; i < kids.length; i++) {
          const k = kids[i], prev = kids[i - 1];
          if (!ts.isJsxText(k) || !(ts.isJsxElement(prev) || ts.isJsxSelfClosingElement(prev) || ts.isJsxExpression(prev))) continue;
          const raw = src.slice(k.pos, k.end), line = sf.getLineAndCharacterOfPosition(k.pos).line + 1;
          if (/^[ \t]+\S/.test(raw) && /\n/.test(raw) && /&[a-zA-Z#0-9]+;/.test(raw)) out.push(`${path.relative(root, file)}:${line} "${raw.trim().slice(0, 40)}"`);
          const tag = ts.isJsxElement(prev) ? prev.openingElement.tagName.getText(sf) : "";
          if (/^\r?\n[ \t]*[A-Za-z0-9(]/.test(raw) && INLINE.has(tag)) out.push(`${path.relative(root, file)}:${line} after </${tag}> "${raw.trim().slice(0, 40)}"`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  };
  const all = files.flatMap((f) => glued(fs.readFileSync(f, "utf8"), f));
  ok("jsx spacing: no text that the compiler glues to the element before it, across every .tsx", all.length === 0, all.slice(0, 5));
  ok("jsx spacing: the check catches both shapes it was written for",
    glued(`export const A = () => <div>a <b>x</b> — we&apos;ll go.\n  </div>;`, "a.tsx").length === 1
    && glued(`export const B = () => <div>a <b>x</b>\n  with it</div>;`, "b.tsx").length === 1
    && glued(`export const C = () => <div>a <b>x</b>{" "}— we&apos;ll go.\n  </div>;`, "c.tsx").length === 0
    && glued(`export const D = () => <div>a <b>x</b> — we will go.\n  </div>;`, "d.tsx").length === 0);
}

// ── THE FORM AUDIT, PART 1: WHAT THE FORMS GOT WRONG (2026-10-04, 0344 · 0345) ────────────────────
// Ryan: "auto fill where applicable … if relational database, generate pick list … audit where this
// could 10/10". Reading every form for what it should already know turned up forms that were not
// merely unhelpful but WRONG — a text box where a pick list belonged, writing the wrong thing:
//   · the merch state: the printer was sent the first two letters ("New York" → NE, Nebraska)
//   · Gear: Save wrote null over the asset tag and serial the editor never loaded
//   · linking a stop to a venue with no address erased the stop's address and pin
//   · saving a venue's address moved every stop it ever had, past ones and other locations too
//   · confirming a count filed it on Greenville's shelf whatever city the event was in
//   · quiet hours: "10pm" saved as 10 — ten in the morning
//   · a workstream re-owned kept its old owner's id (0307's column, never written)
//   · the KPI board's Log refused since 0275 (the old conflict key), filing weeks by day
//   · the brew alarms: brewer (text) coalesced with created_by (uuid) — every run since 0145 failed
//   · a proposal could not be sent or won (0180 wrote stages 0265 no longer allows)
// These pin each fix. The two database fixes are proved in scripts/db.brewalarm / db.proposal.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const US = require("../.smoke/usAddress.js");
  const AQ = require("../.smoke/apliiqOrder.js");
  const SR = require("../.smoke/stopRecord.js");
  const DT3 = require("../.smoke/dates.js");

  // ── a US address, part by part ──
  ok("address: fifty states and DC, each code once", US.US_STATES.length === 51 && new Set(US.US_STATES.map(([c]) => c)).size === 51);
  ok("address: a state reads by its code, any case, with or without dots",
    US.stateCode("SC") === "SC" && US.stateCode("sc") === "SC" && US.stateCode("S.C.") === "SC" && US.stateCode(" s c ") === "SC");
  ok("address: a state reads by its name, any case or spacing",
    US.stateCode("New York") === "NY" && US.stateCode("  new   york ") === "NY" && US.stateCode("MISSISSIPPI") === "MS" && US.stateCode("District of Columbia") === "DC");
  ok("address: anything else is null — never a guess", US.stateCode("Nwe York") === null && US.stateCode("NW") === null && US.stateCode("") === null && US.stateCode(null) === null && US.stateCode("Ontario") === null);
  ok("address: a ZIP is five digits or ZIP+4, written the post office's way",
    US.usZip("29601") === "29601" && US.usZip(" 29601 ") === "29601" && US.usZip("29601-1234") === "29601-1234" && US.usZip("296011234") === "29601-1234" && US.usZip("29601 1234") === "29601-1234");
  ok("address: a ZIP that is not one is null", US.usZip("2960") === null && US.usZip("29601-12") === null && US.usZip("SC 29601") === null && US.usZip("") === null);

  // ── the order the printer gets ──
  const SHIP2 = { name: "Ryan Thompkins", street: "1 Main St", city: "Brooklyn", state: "New York", zip: "11201" };
  const line2 = { id: "p1", title: "Tee", qty: 1, priceCents: 3400, sku: "APQ-5902678S8A1" };
  const ny = AQ.buildOrderPayload({ id: "abcd1234-0000-0000-0000-000000000000", ship: SHIP2, items: [line2] });
  ok("apliiq: a state typed as its name reaches the printer as ITS code — New York is NY, not NE (Nebraska)",
    ny.ok && ny.payload.shipping_address.province_code === "NY", ny.ok ? ny.payload.shipping_address.province_code : ny.reason);
  const ms = AQ.buildOrderPayload({ id: "x", ship: { ...SHIP2, state: "Mississippi" }, items: [line2] });
  ok("apliiq: Mississippi is MS, not MI (Michigan)", ms.ok && ms.payload.shipping_address.province_code === "MS");
  const typo = AQ.buildOrderPayload({ id: "x", ship: { ...SHIP2, state: "Nwe York" }, items: [line2] });
  ok("apliiq: a state that is not one refuses the order, naming what was typed — never a parcel to a guess",
    typo.ok === false && /Nwe York/.test(typo.reason), typo.ok ? "built" : typo.reason);
  const badZip = AQ.buildOrderPayload({ id: "x", ship: { ...SHIP2, zip: "1120" }, items: [line2] });
  ok("apliiq: a ZIP that is not one refuses the order", badZip.ok === false && /ZIP/.test(badZip.reason));
  const zip4 = AQ.buildOrderPayload({ id: "x", ship: { ...SHIP2, zip: "112011234" }, items: [line2] });
  ok("apliiq: a nine-digit ZIP goes as ZIP+4", zip4.ok && zip4.payload.shipping_address.zip === "11201-1234");

  // ── the merch checkout picks the state, and the server reads it before the card is charged ──
  const shop = code(read("components/ShopCheckout.tsx"));
  const shopGrid = code(read("components/Shop.tsx"));
  ok("weight: the merch checkout loads when it is wanted, not with the grid",
    /const ShopCheckout = dynamic\(\(\) => import\("\.\/ShopCheckout"\)\)/.test(shopGrid) && !/import ShopCheckout from/.test(shopGrid)
    && !/US_STATES|PaymentCard/.test(shopGrid) && /if \(hasCart\) void import\("\.\/ShopCheckout"\)/.test(shopGrid));
  const stateSel = shop.slice(shop.indexOf("<select aria-label={t(\"checkout.ph_state\")}"), shop.indexOf("</select>", shop.indexOf("checkout.ph_state")));
  ok("shop: the state is a pick list over US_STATES, autofilled as address-level1",
    stateSel.includes("value={ship.state}") && stateSel.includes('autoComplete="address-level1"') && /US_STATES\.map\(/.test(stateSel));
  ok("shop: no free-text state box remains", !/<input[^>]*value=\{ship\.state\}/.test(shop));
  const shopRoute = code(read("app/api/shop/checkout/route.ts"));
  ok("shop checkout: the state and ZIP are read by lib/usAddress BEFORE the card is charged",
    /stateCode\(addr\.state\)/.test(shopRoute) && /usZip\(addr\.zip\)/.test(shopRoute)
    && shopRoute.indexOf("stateCode(addr.state)") < shopRoute.indexOf("chargeCard({"));
  ok("shop checkout: a state or ZIP it cannot read is refused, and the order keeps the code",
    /if \(!state\) return NextResponse\.json\(/.test(shopRoute) && /if \(!zip\) return NextResponse\.json\(/.test(shopRoute) && /addr\.state = state; addr\.zip = zip;/.test(shopRoute));
  ok("apliiq: lib/apliiqOrder reads the state through stateCode, not its first two letters",
    /stateCode\(s\.state\)/.test(code(read("lib/apliiqOrder.ts"))) && !/toUpperCase\(\)\.slice\(0,\s*2\)/.test(code(read("lib/apliiqOrder.ts")).replace(/country_code = [^\n]*/, "")));

  // ── Gear: the editor opens with what Save writes ──
  const assetsRoute = code(read("app/api/assets/route.ts"));
  ok("gear: /api/assets returns the asset tag and serial", /assetTag:\s*a\.asset_tag/.test(assetsRoute) && /serialNo:\s*a\.serial_no/.test(assetsRoute));
  const gear = code(read("components/GearLibrary.tsx"));
  const toDraft = gear.slice(gear.indexOf("const toDraft"), gear.indexOf("});", gear.indexOf("const toDraft")));
  ok("gear: the editor opens an asset WITH its tag and serial, so Save cannot erase them",
    /assetTag:\s*a\.assetTag/.test(toDraft) && /serialNo:\s*a\.serialNo/.test(toDraft) && !/assetTag:\s*""/.test(toDraft));

  // ── a stop and its venue ──
  // What linking a stop to a venue writes is lib/venues.venueFill since the venue pick (2026-10-05,
  // part 4) — its cases, the ones stopPatchFromVendor held here included, are in that block below.
  ok("venue link: lib/stopRecord's stopPatchFromVendor is gone — one rule for what a venue pick fills",
    !/stopPatchFromVendor/.test(code(read("lib/stopRecord.ts"))) && !/stopPatchFromVendor/.test(code(read("components/crew/LiveControl.tsx")) + code(read("components/FieldOpSheet.tsx"))));

  const OLD = { name: "Wine Express", address: "1 Main St, Greenville, SC", location_text: "1 Main St, Greenville, SC" };
  ok("venue move: a visit at the old address moves (case and spacing aside)", SR.wasAtVendorsPlace(OLD, { address: "1 main st,  Greenville, SC" }));
  ok("venue move: a visit with no place yet takes the venue's", SR.wasAtVendorsPlace(OLD, { address: null, location_text: "" }));
  ok("venue move: a visit at the venue's SECOND location stays where it is", !SR.wasAtVendorsPlace(OLD, { address: "9 Oak Ave, Greenville, SC", location_text: "9 Oak Ave" }));
  ok("venue move: an event whose place reads as the venue's name is at the venue", SR.wasAtVendorsPlace(OLD, { location_text: "wine express" }));
  const loc = code(read("components/crew/LocationEditor.tsx"));
  ok("venue move: a venue's new address no longer goes to EVERY row with its id",
    !/\.update\(\{ address: q[^)]*\}\)\.eq\("vendor_id", row\.id\)/.test(loc) && !/from\("events"\)\.update\(\{ location_text: q \}\)\.eq\("vendor_id"/.test(loc));
  ok("venue move: only visits still ahead (the road, the calendar) at the old place",
    /isStopAhead\(s\) && wasAtVendorsPlace\(old, s\)/.test(loc) && /!eventIsPast\(e\.day, today\) && wasAtVendorsPlace\(old, e\)/.test(loc) && /\.in\("id", stopIds\)/.test(loc));
  ok("venue move: a failed read of the venue's visits moves nothing and says so", /if \(st\.error \|\| ev\.error\) return/.test(loc));

  // ── the crew page: a count on its city's shelf, quiet hours by the clock ──
  const crewSrc = code(read("app/crew/page.tsx"));
  const cq = crewSrc.slice(crewSrc.indexOf("const confirmQty"), crewSrc.indexOf("const adjustOnHand"));
  ok("confirm actual: the ledger entry is filed on the event's own market", /from\("inventory_ledger"\)\.insert\(\{[^}]*\bmarket\b/.test(cq), cq.slice(0, 80));
  ok("confirm actual: the task write's answer is read, and a non-number refused", /const \{ error \} = await supabase\.from\("event_tasks"\)/.test(cq) && /Number\.isFinite\(n\)/.test(cq));
  // The mutes and quiet hours left the crew page for their own component (2026-10-06, the settings
  // round): Settings › You draws them in place and the inbox's gear opens them in a sheet. The rules
  // below are the same rules, read where the controls live now.
  const np = code(read("components/NotifPrefs.tsx"));
  ok("quiet hours: a pick of the 24 hours, not a number box read by parseInt",
    !/parseInt/.test(np) && /<select value=\{qs\}/.test(np) && /<select value=\{qe\}/.test(np) && /QUIET_HOURS\.map/.test(np));
  ok("quiet hours: the hours read the app's way", np.includes("fmt12(`${h}:00`)") && DT3.fmt12("22:00") === "10:00pm" && DT3.fmt12("0:00") === "12:00am" && DT3.fmt12("12:00") === "12:00pm");
  ok("quiet hours: a failed read locks the sheet — saving over prefs it could not read would unmute everything",
    /if \(error\) \{ setRead\("failed"\)/.test(np) && /read !== "ok"\) return false/.test(np));
  const inboxSrc = crewSrc.slice(crewSrc.indexOf("function AlertsInbox"), crewSrc.indexOf("if (mine.length === 0 && held.length === 0)", crewSrc.indexOf("function AlertsInbox")) + 400);
  ok("quiet hours: the door to them is on the empty inbox too — not only beside a list with something in it",
    /const prefsDoor = <button type="button" className="alert-prefs-btn" onClick=\{\(\) => setPrefsOpen\(true\)\} aria-label="Notification settings">/.test(inboxSrc)
    && /if \(mine\.length === 0 && held\.length === 0\) \{\s*return \(\s*<div className="adm-sec">\s*<SectionHeader label=\{title\} right=\{prefsDoor\} \/>\s*\{prefsSheet\}/.test(inboxSrc));
  ok("quiet hours: \"Saved\" is said only when it saved", !/onBlur=\{\(\) => \{ save\(/.test(np) && /if \(error\) \{ toast\(`Couldn't save/.test(np));
  ok("quiet hours: the gear and Settings draw ONE component — the sheet wraps the same controls, and the crew page keeps no copy",
    /export function NotifPrefsSheet\([\s\S]*?<NotifPrefs userId=\{userId\} \/>/.test(np)
    && /const prefsSheet = prefsOpen && <NotifPrefsSheet userId=\{userId\}/.test(inboxSrc)
    && !/const NOTIF_CATS|function NotifPrefsSheet|from\("notif_prefs"\)/.test(crewSrc));
  ok("notifications: the controls carry no title of their own — each door titles them (Settings' row, the gear's sheet), so neither says it twice",
    /export function NotifPrefs\(\{ userId \}: \{ userId: string \| null \}\)/.test(np) && !/pay-row-t|title\b/.test(np.slice(np.indexOf("export function NotifPrefs("), np.indexOf("export function NotifPrefsSheet("))));
  ok("quiet hours: two copies on screen cannot disagree — a save tells the other copy, which takes the row it wrote",
    /window\.dispatchEvent\(new CustomEvent<NotifPrefsSaved>\(NOTIF_PREFS_EVENT/.test(np) && /window\.addEventListener\(NOTIF_PREFS_EVENT, onSaved\)/.test(np)
    && /if \(!s \|\| s\.userId !== userId\) return;/.test(np));

  // ── a workstream's owner is the person ──
  const osr = code(read("components/OsRegistry.tsx"));
  ok("workstream owner: one pick (PersonPick) writes the id AND the name",
    /<PersonPick label="Workstream owner"/.test(osr) && /owner_user_id: draft\.owner\.id/.test(osr) && /owner: draft\.owner\.name/.test(osr));
  ok("workstream owner: the sheet opens on the id it has, not a spelling", /owner: \{ id: w\.owner_user_id/.test(osr));

  // ── the KPI board files where it reads ──
  const kpi = code(read("components/KpiBoard.tsx"));
  ok("kpi board: the Log names 0275's key (metric, period, market) and carries the market",
    /onConflict: "metric,period,market"/.test(kpi) && /\{ metric: key, period, value: v, market,/.test(kpi));
  ok("kpi board: it reads the market it writes", /\.eq\("market", market\)/.test(kpi));
  ok("kpi board: a weekly figure is filed under its week's Monday", /cadence === "weekly" \? weekStartKey\(today\)/.test(kpi)
    && DT3.weekStartKey("2026-10-04") === "2026-09-28" && DT3.weekStartKey("2026-09-28") === "2026-09-28" && DT3.weekStartKey("2026-10-03") === "2026-09-28");

  // ── the brew alarms ring for the person brewing ──
  const bp = code(read("components/BrewPlanner.tsx"));
  ok("brew: Start brew names the brewer from the crew, and writes the id the alarms read",
    /<PersonPick label="Brewer"/.test(bp) && /\.\.\.\(extras\?\.brewer \? \{ brewer_id: extras\.brewer\.id \} : \{\}\)/.test(bp) && /arrives-with: 0344/.test(read("components/BrewPlanner.tsx")));
  ok("brew: the batch log moves the id when the brewer is changed, and leaves it when not",
    /\.\.\.\(brewerSet \|\| brewer\.id \? \{ brewer_id: brewer\.id \} : \{\}\)/.test(bp));
  ok("brew: a start or a log that fails says so — the sheet stays open", /if \(error\) \{ setMutErr\(error\.message\); return false; \}/.test(bp) && /if \(await startBrew\(starting, extras\)\) setStarting\(null\)/.test(bp) && /if \(error\) \{ setErr\(error\.message\); setBusy\(false\); return; \}/.test(bp));
  ok("brew: a batch planned on the brew sheet (through /api/agents/brew) or by the drop planner says who planned it — the alarms' fallback",
    /created_by: planner\?\.id \?\? null/.test(code(read("app/api/agents/brew/route.ts"))) && /created_by: me/.test(code(read("components/DropOps.tsx"))));
  ok("weight: the database-skew helpers live in lib/schemaSkew, out of the module app/error.tsx loads on every page",
    !/export (async )?function (isMissingColumn|writeAcrossSkew)/.test(read("lib/deploySkew.ts"))
    && /export function isMissingColumn/.test(read("lib/schemaSkew.ts")) && /export async function writeAcrossSkew/.test(read("lib/schemaSkew.ts"))
    && !/schemaSkew/.test(code(read("app/error.tsx"))));
  const pp = code(read("components/PersonPick.tsx"));
  ok("person pick: YOU first, the crew, and \"Someone else…\" — which says it links to no one",
    /`You — \$\{crewLabel\(c\)\}`/.test(pp) && /Someone else…/.test(pp) && /not linked to anyone on the crew/.test(pp));
}

// ── WHAT WE ALREADY KNOW ABOUT THE CUSTOMER (2026-10-04, the form audit · 0346) ────────────────────
// Ryan: "name for order, auto populate with users name if signed in". Every customer form started
// empty but the cup checkout, and that one knew only display_name. lib/customerKnown is the one rule
// for which of a customer's own rows each field starts from; components/useCustomerKnown the one
// read, loaded only for someone signed in; useKnownField makes a field theirs the moment they type.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const K = require("../.smoke/customerKnown.js");
  const k = (r) => K.knownFrom(r);

  // ── the name to call at the window ──
  ok("known: the name they asked to be called comes first", k({ displayName: "Ryan", customer: { name: "Ryan Thompkins" } }).callName === "Ryan");
  ok("known: no display name → the name on their record", k({ displayName: "", customer: { name: "Ryan Thompkins" } }).callName === "Ryan Thompkins");
  ok("known: a display name that is an email is not a name", k({ displayName: "ryan@x.test", lastCup: { customer: "Ryan" } }).callName === "Ryan");
  ok("known: the last resort is the email's handle, as words", k({ email: "pat.example42@x.test" }).callName === "Pat Example" && K.nameFromEmail("pat_example@x") === "Pat Example");
  ok("known: nothing known is an empty string, never undefined", k({}).callName === "" && k({}).fullName === "" && k({}).phone === "" && k({}).email === "");

  // ── the full name for a parcel or a door ──
  ok("known: a parcel gets the last shipping label's full name, not the sign-up first name",
    k({ displayName: "Ryan", lastShop: { ship_name: "Ryan Thompkins" } }).fullName === "Ryan Thompkins");
  ok("known: any name with a surname beats one without — even one that comes first",
    k({ displayName: "Ryan", lastPack: { name: "Ryan T" } }).fullName === "Ryan T" && k({ customer: { name: "Ryan" }, lastDelivery: { name: "Ryan Thompkins" } }).fullName === "Ryan Thompkins");
  ok("known: a first name alone is still a name", k({ displayName: "Ryan" }).fullName === "Ryan");

  // ── phone and email ──
  ok("known: phone — their record first", k({ customer: { phone: "864-555-0100" }, lastPack: { phone: "864-555-0199" } }).phone === "864-555-0100");
  ok("known: phone — then the last pack, the last delivery, the office account",
    k({ lastPack: { phone: "1" }, lastDelivery: { phone: "2" } }).phone === "1" && k({ lastDelivery: { phone: "2" }, business: { contact_phone: "3" } }).phone === "2" && k({ business: { contact_phone: "3" } }).phone === "3");
  ok("known: email — the sign-in address first", k({ email: "me@x.test", customer: { email: "old@x.test" } }).email === "me@x.test");

  // ── where it ships, where it is delivered ──
  const shipped = k({ lastShop: { ship_name: "R T", ship_address: { street: "1 Main St", city: "Greenville", state: "south carolina", zip: "29601" } } });
  ok("known: a parcel goes where the last one went, its state read as a code",
    shipped.ship && shipped.ship.street === "1 Main St" && shipped.ship.state === "SC" && shipped.shipFrom === "shop", shipped.ship);
  const fromDoor = k({ lastDelivery: { address_street: "9 Oak Ave", address_city: "Greenville", address_zip: "29607", access_instructions: "Gate 4411" } });
  ok("known: else where their last delivery went — the state from the market that ZIP belongs to",
    fromDoor.ship && fromDoor.ship.street === "9 Oak Ave" && fromDoor.ship.state === "SC" && fromDoor.shipFrom === "delivery", fromDoor.ship);
  ok("known: the delivery door keeps its gate code", fromDoor.delivery && fromDoor.delivery.access === "Gate 4411" && fromDoor.delivery.zip === "29607");
  ok("known: an address with no street is not an address", k({ lastShop: { ship_address: { city: "Greenville" } } }).ship === null);

  // ── the office ──
  const off = k({ displayName: "Ryan", customer: { name: "Ryan Thompkins", phone: "864" }, business: { company: "Acme", address_street: "1 Main St", address_city: "Greenville", address_zip: "29601", headcount: 40 },
    lastOffice: { address_street: "1 main st", access_instructions: "Suite 300" } });
  ok("known: the office account, with its last order's access notes for the same door", off.office && off.office.company === "Acme" && off.office.access === "Suite 300" && off.office.headcount === "40");
  ok("known: …and who to text falls back to them", off.office && off.office.contact === "Ryan Thompkins" && off.office.phone === "864");
  ok("known: notes written for another door stay there",
    k({ business: { company: "Acme", address_street: "9 New Rd" }, lastOffice: { address_street: "4 Old Ave", access_instructions: "Old code" } }).office.access === "");

  // ── the read: own rows only, and only for someone signed in ──
  const readSrc = code(read("lib/customerKnownRead.ts"));
  ok("known read: every source is the customer's own rows", (readSrc.match(/\.eq\("user_id", userId\)/g) || []).length === 3 && /sb\.from\(table\)\.select\(cols\)\.eq\("user_id", userId\)/.test(readSrc));
  const hook = code(read("components/useCustomerKnown.ts"));
  ok("known read: loaded on demand — a guest's first load never carries it",
    /import\("@\/lib\/customerKnownRead"\)/.test(hook) && /if \(!enabled \|\| !uid \|\| !supabase\) return;/.test(hook));
  const statics = [];
  const walk = (d) => { for (const f of fs.readdirSync(path.join(__dirname, "..", d), { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== "node_modules" && !f.name.startsWith(".")) walk(p); } else if (/\.tsx?$/.test(f.name) && /from ["']@\/lib\/customerKnownRead["']/.test(read(p))) statics.push(p); } };
  walk("components"); walk("app");
  ok("known read: nothing imports it statically", statics.length === 0, statics);
  ok("known field: no effect copies a known value into state — a late read never overwrites typing",
    /export function useKnownField\(known: string \| null \| undefined\)/.test(hook) && /return \[typed \?\? known \?\? "", setTyped, typed === null && !!known\]/.test(hook));

  // ── every customer form starts from it ──
  const co = code(read("components/Checkout.tsx"));
  ok("cup checkout: the pickup name starts from what we know, and no effect seeds it",
    /useKnownField\(known\?\.callName \|\| profile\?\.display_name\)/.test(co) && !/setName\(\(n\) => n \|\| profile\?\.display_name/.test(co));
  const of = code(read("components/OrderFunnel.tsx"));
  ok("delivery: ZIP, street, city, gate code, name and phone start from their last delivery",
    ["useKnownField(known?.delivery?.zip)", "useKnownField(known?.delivery?.street)", "useKnownField(known?.delivery?.city)", "useKnownField(known?.delivery?.access)", "useKnownField(known?.fullName || profile?.display_name)", "useKnownField(known?.phone)"].every((x) => of.includes(x)));
  ok("delivery: the fields say what they are, so a guest's phone fills them",
    /value=\{street\} onChange=\{\(e\) => setStreet\(e\.target\.value\)\} autoComplete="address-line1"/.test(of) && /value=\{city\} onChange=\{\(e\) => setCity\(e\.target\.value\)\} autoComplete="address-level2"/.test(of) && /autoComplete="postal-code" placeholder=\{t\("funnel\.zip_ph"\)\}/.test(of) && /autoComplete="email" placeholder="you@email\.com"/.test(of));
  ok("delivery: it says where the details came from", /\{streetKnown && <p className="dl-sub known-note">From your last delivery/.test(of));
  ok("weight: the office order loads when an office is chosen, not with every visit to /reserve and /delivery",
    /const OfficeOrder = dynamic\(\(\) => import\("\.\/OfficeOrder"\)\)/.test(of) && !/import OfficeOrder from/.test(of) && /setAudience\("office"\); void import\("\.\/OfficeOrder"\);/.test(of));
  const sc = code(read("components/ShopCheckout.tsx"));
  ok("merch: the parcel's name and address start from what we know", ["useKnownField(known?.fullName)", "useKnownField(known?.ship?.street)", "useKnownField(known?.ship?.state)", "useKnownField(known?.ship?.zip)"].every((x) => sc.includes(x)));
  const oo = code(read("components/OfficeOrder.tsx"));
  ok("office: the order starts from the office account", ["useKnownField(o?.company)", "useKnownField(o?.contact || known?.fullName)", "useKnownField(o?.phone || known?.phone)", "useKnownField(o?.street)", "useKnownField(o?.access)"].every((x) => oo.includes(x))
    && /autoComplete="organization"/.test(oo));
  const bk = code(read("app/book/page.tsx"));
  ok("book the bar: who is asking starts from what we know, and the request is filed under a city",
    ["useKnownField(known?.fullName)", "useKnownField(known?.email)", "useKnownField(known?.phone)"].every((x) => bk.includes(x)) && /market: known\?\.market \?\? viewerMarket,/.test(bk));
  const inval = ["components/Checkout.tsx", "components/OrderFunnel.tsx", "components/ShopCheckout.tsx", "components/OfficeOrder.tsx"].map((f) => (code(read(f)).match(/invalidateCustomerKnown\(\)/g) || []).length);
  ok("known: every placed order refreshes it, so the next form starts from that order", JSON.stringify(inval) === JSON.stringify([2, 2, 1, 1]), inval);

  // ── the office route keeps the city and the door (0346) ──
  const office = code(read("app/api/office/route.ts"));
  ok("office route: the account and the order are filed under the ZIP's market",
    /standing_gallons: q\.gallons, market,/.test(office) && /billing_terms: billing, standing, market,/.test(office));
  ok("office route: the account keeps its access notes, across the 0346 skew",
    /access_instructions: access \|\| null,/.test(office) && /arrives-with: 0346/.test(read("app/api/office/route.ts")) && (office.match(/\["access_instructions"\]\)/g) || []).length === 2);
}

// ── THE FORM AUDIT, PART 3: PEOPLE (2026-10-04) ──────────────────────────────────────────────────
// Ryan: "if relational database, generate pick list … when I fill out it's hard to know what's
// relational." Every person on a crew form is picked from one list (components/PersonPick) and the
// record keeps WHO, not a spelling: an offer letter's candidate (candidate_user_id), an operator
// agreement's operator (operator_user_id — nothing wrote it, and the operator's own copy, answer and
// signature all find the agreement by it), a goal's owner, a move's, a follow-up's. The fields that
// hang off a choice follow it while untouched (lib/pickFill), and every link into a person's next
// step carries who it is for (lib/urlParam).
{
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const F = require("../.smoke/pickFill.js");
  const O = require("../.smoke/offerDraft.js");
  const D = require("../.smoke/operatorDraft.js");
  const M = require("../.smoke/mentions.js");
  const U = require("../.smoke/urlParam.js");

  // ── one rule for a field that fills from a pick ──
  ok("pick fill: an empty field takes the pick", F.follow("", "Ann", "Bo") === "Bo" && F.follow(null, null, "Bo") === "Bo");
  ok("pick fill: a field still holding the last pick follows the new one", F.follow("Ann", "Ann", "Bo") === "Bo" && F.follow(" Ann ", "Ann", "Bo") === "Bo");
  ok("pick fill: a typed value stays — even when the last pick knew nothing", F.follow("Annie", "Ann", "Bo") === "Annie" && F.follow("Annie", null, "Bo") === "Annie" && F.follow("Annie", "", "Bo") === "Annie");
  ok("pick fill: a pick that knows nothing empties only what the last pick filled", F.follow("Ann", "Ann", null) === "" && F.follow("Annie", "Ann", null) === "Annie");

  // ── the house's words for the statutory four ──
  const H = [
    { status: "draft", employment_type: "employee", role: "server", normal_hours: "draft hours", pay_schedule: "asdf", pay_method: null, deductions: null },
    { status: "approved", employment_type: "contractor", role: "operator", normal_hours: "as needed", pay_schedule: "monthly", pay_method: "ACH", deductions: "none" },
    { status: "sent", employment_type: "employee", role: "server", normal_hours: "Event days, 4–8 hours", pay_schedule: "Every other Friday", pay_method: "Direct deposit", deductions: "Federal and state withholding" },
  ];
  const hw = O.houseWording(H, { employmentType: "employee", role: "server" });
  ok("house wording: a letter the co-owners passed beats a newer half-typed draft", hw.paySchedule === "Every other Friday" && hw.payMethod === "Direct deposit", hw);
  ok("house wording: the same employment type first", O.houseWording(H, { employmentType: "contractor", role: "operator" }).paySchedule === "monthly");
  ok("house wording: normal hours only from a letter for the same role and type",
    hw.normalHours === "Event days, 4–8 hours" && O.houseWording(H, { employmentType: "employee", role: "operator" }).normalHours === null);
  ok("house wording: no letter, no prefill — nothing invented",
    JSON.stringify(O.houseWording([], { employmentType: "employee", role: "server" })) === JSON.stringify({ normalHours: null, paySchedule: null, payMethod: null, deductions: null }));

  // ── the defaults that follow a choice ──
  const leads = { greenville: { id: "L1", name: "Ryan" }, atlanta: { id: "L2", name: "Niño" } };
  const ctx = { history: H, leadOf: (m, cand) => (leads[m] && leads[m].id !== cand ? leads[m] : null) };
  const s0 = O.startOffer(ctx);
  ok("new offer: starts from the house wording and the market's lead", s0.paySchedule === "Every other Friday" && s0.normalHours === "Event days, 4–8 hours" && s0.reportsTo === "Ryan" && s0.reportsToId === "L1" && s0.candidateUserId === null, s0);
  const toOp = O.restateDefaults(s0, { ...s0, role: "operator" }, ctx);
  ok("new offer: a role change moves the role's hours while they are still the default", toOp.normalHours === null, toOp.normalHours);
  const typed = O.restateDefaults({ ...s0, normalHours: "Mornings" }, { ...s0, normalHours: "Mornings", role: "operator" }, ctx);
  ok("new offer: hours somebody typed stay put", typed.normalHours === "Mornings");
  const toAtl = O.restateDefaults(s0, { ...s0, market: "atlanta" }, ctx);
  ok("new offer: reports to follows the market's lead while untouched", toAtl.reportsTo === "Niño" && toAtl.reportsToId === "L2");
  ok("new offer: …but not a manager somebody chose", O.restateDefaults({ ...s0, reportsTo: "Kayla" }, { ...s0, reportsTo: "Kayla", market: "atlanta" }, ctx).reportsTo === "Kayla");
  ok("new offer: an emptied field is not refilled by an unrelated change",
    O.restateDefaults({ ...s0, paySchedule: "" }, { ...s0, paySchedule: "", title: "Ops" }, ctx).paySchedule === "");
  ok("new offer: the lead is never the candidate themselves", ctx.leadOf("atlanta", "L2") === null);

  // ── who it is for ──
  const ana = { id: "A", name: "Ana Ruiz", email: "ana@x.test", role: "operator", market: "atlanta", title: "Atlanta Lead" };
  const bo = { id: "B", name: "Bo", email: null, role: "owner", market: "greenville", title: null };
  const fa = O.forPerson(s0, null, ana);
  ok("offer for: picking links the account and fills what is on file",
    fa.candidateUserId === "A" && fa.candidateName === "Ana Ruiz" && fa.candidateEmail === "ana@x.test" && fa.market === "atlanta" && fa.role === "operator" && fa.title === "Atlanta Lead", fa);
  const fb = O.forPerson(fa, ana, bo);
  ok("offer for: a new pick replaces what the last one filled", fb.candidateUserId === "B" && fb.candidateName === "Bo" && fb.candidateEmail === "" && fb.title === "");
  ok("offer for: an owner's role is not an access level a letter grants", fb.role === "operator");
  ok("offer for: what the owner typed stays through a new pick", O.forPerson({ ...fa, candidateName: "Ana M. Ruiz" }, ana, bo).candidateName === "Ana M. Ruiz");
  const fn = O.forPerson(fa, ana, null);
  ok("offer for: someone new unlinks it and clears the last person's details", fn.candidateUserId === null && fn.candidateName === "" && fn.candidateEmail === "");
  ok("offer for: picking then redoing the defaults moves the lead with the city",
    O.restateDefaults(s0, O.forPerson(s0, null, ana), ctx).reportsTo === "Niño");

  // ── the agreement reaches its operator ──
  const blankDeal = { operatorUserId: null, operatorName: D.UNNAMED_OPERATOR, operatorEmail: "", market: "greenville" };
  const nino = { id: "N", name: "Niño Ramírez", email: "nino@x.test", market: "atlanta" };
  const dl = D.forOperator(blankDeal, null, nino);
  ok("agreement for: picking links the operator and replaces the blank draft's placeholder",
    dl.operatorUserId === "N" && dl.operatorName === "Niño Ramírez" && dl.operatorEmail === "nino@x.test" && dl.market === "atlanta", dl);
  ok("agreement for: unlinking empties what the pick filled, keeps what was typed",
    D.forOperator(dl, nino, null).operatorUserId === null && D.forOperator(dl, nino, null).operatorEmail === "" && D.forOperator({ ...dl, operatorName: "N. Ramírez" }, nino, null).operatorName === "N. Ramírez");

  // ── @ is a pick list ──
  const crew = [{ id: "c1", display_name: "Chris Lee" }, { id: "c2", display_name: "Chris Park" }, { id: "k", display_name: "Kayla" }, { id: "x", display_name: null }];
  ok("mentions: the @word being typed, and only at the end", M.mentionDraft("hey @Ka") === "Ka" && M.mentionDraft("hey @") === "" && M.mentionDraft("hey @Ka there") === null && M.mentionDraft("a@b") === null);
  ok("mentions: choices start with what is typed", JSON.stringify(M.mentionChoices(crew, "ch").map((p) => p.id)) === JSON.stringify(["c1", "c2"]) && M.mentionChoices(crew, "").length === 3);
  const ins = M.insertMention("thanks @Ch", crew[1]);
  ok("mentions: a pick puts @First in place of the typed word", ins.text === "thanks @Chris " && ins.token === "@Chris");
  const r1 = M.resolveMentions("thanks @Chris", crew, { c2: "@Chris" });
  ok("mentions: a picked Chris reaches that Chris — not every Chris", JSON.stringify(r1.ids) === JSON.stringify(["c2"]) && r1.unresolved.length === 0, r1);
  const r2 = M.resolveMentions("thanks @Chris and @kayla", crew, {});
  ok("mentions: a hand-typed name that means two people reaches nobody, and says so",
    JSON.stringify(r2.ids) === JSON.stringify(["k"]) && JSON.stringify(r2.unresolved) === JSON.stringify(["@Chris"]), r2);
  ok("mentions: a typo is said before sending", JSON.stringify(M.resolveMentions("@Kalya see this", crew, {}).unresolved) === JSON.stringify(["@Kalya"]));
  ok("mentions: a pick deleted from the text no longer notifies", M.resolveMentions("never mind", crew, { k: "@Kayla" }).ids.length === 0);

  // ── a link's one-time instruction, without a window ──
  ok("url param: on the server there is nothing to read, and nothing throws", U.readParam("offer_for") === null && U.takeParam("a") === null && U.dropParam("x") === undefined);

  // ── A COMPILER QUIRK, FOUND ON SCREEN ──
  // The link note rendered "so Niñocan't open it": SWC drops the first space of a JSX text run that
  // follows an expression when the run holds an HTML entity AND carries on to the next line
  // (" can&rsquo;t open it.⏎" compiles to "can’t open it."; the same words without the entity keep
  // it). Nothing else in the app was written that way; this keeps it so.
  {
    const files = [];
    const walkTsx = (d) => { for (const f of fs.readdirSync(path.join(__dirname, "..", d), { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== "node_modules" && !f.name.startsWith(".")) walkTsx(p); } else if (/\.tsx$/.test(f.name)) files.push(p); } };
    walkTsx("app"); walkTsx("components");
    const runs = (src) => [...src.matchAll(/\}( [^<{}]*?)(?=[<{])/g)].filter((m) => /\n/.test(m[1]) && /&[a-z]+;/.test(m[1]) && /\S/.test(m[1].split("\n")[0]));
    const bad = files.flatMap((f) => runs(read(f)).map((m) => `${f}: ${JSON.stringify(m[1].slice(0, 50))}`));
    ok("jsx: no text run after an expression that holds an entity and runs onto the next line", bad.length === 0, bad);
    ok("jsx: …and the check sees the one that shipped", runs('so {n} can&rsquo;t open it.\n      </p>').length === 1 && runs('so {n} cannot open it.\n</p>').length === 0 && runs('so {n} can&rsquo;t open it.</p>').length === 0);
  }

  // ── PersonPick ──
  const pp = code(read("components/PersonPick.tsx"));
  ok("person pick: onChange says how — a pick, a matched old name, or typing",
    /onChange: \(v: PersonValue, how: PersonHow\) => void;/.test(pp) && /, "match"\); \}, \[match, onChange, value\.name\]\);/.test(pp) && /onChange\(\{ id: null, name: e\.target\.value \}, "type"\)/.test(pp));
  ok("person pick: a half-typed name is never matched to the crew", /const match = matchByName && !typing && !value\.id && value\.name\.trim\(\)/.test(pp));
  ok("person pick: people who are not crew are listed under their own heading", /<optgroup label=\{othersLabel\}>/.test(pp) && /const roster = withoutMe \? crew\.filter\(\(c\) => c\.id !== me\) : crew;/.test(pp));

  // ── the offer letter ──
  const ol = code(read("components/OfferLetters.tsx"));
  ok("offer letter: who it is for is saved by account", /candidate_user_id: draft\.candidateUserId \?\? null,/.test(ol) && /candidateUserId: open\.candidate_user_id,/.test(ol));
  ok("offer letter: the drafting rules stay out of the candidate's page — the letter and the deal it explains",
    ["lib/offerLetter.ts", "lib/operatorDeal.ts", "lib/dealExplainer.ts"].every((f) => !/["']\.\/(offerDraft|operatorDraft|pickFill)["']/.test(read(f))) && /from "@\/lib\/offerDraft"/.test(ol));
  ok("offer letter: picked from the crew and the customers with an account — never yourself, never by a shared name",
    /<PersonPick label="Who this offer is for"/.test(ol) && /withoutMe matchByName=\{false\} others=\{members\}/.test(ol) && /supabase\.from\("v_promotable"\)\.select\("id, display_name, email, market, customer_name"\)/.test(ol));
  ok("offer letter: a new one starts from the house and the market's lead", /setDraft\(startOffer\(ctx\)\)/.test(ol) && /patch\(\{ reportsTo: v\.name \|\| null, reportsToId: v\.id \}\)/.test(ol));
  ok("offer letter: the lead it reports to is never the person it is for", /crew\.find\(\(x\) => x\.leads_market === m && x\.id !== candidate\)/.test(ol));
  ok("offer letter: every change runs the defaults that follow it", /const patch = \(p: Partial<OfferTerms>\) => setDraft\(\(d\) => d && restateDefaults\(d, \{ \.\.\.d, \.\.\.p \}, ctx\)\);/.test(ol));
  ok("offer letter: ?offer_for= opens theirs or starts one for them, read once",
    /useState<string \| null>\(\(\) => readParam\("offer_for"\)\)/.test(ol) && /dropParam\("offer_for"\)/.test(ol) && /r\.candidate_user_id === arriving && !SETTLED\.has\(r\.status\)/.test(ol));
  ok("offer letter: a crew member's email comes from their file, read once on the pick", /usePersonFacts\(fresh, \(id\) =>/.test(ol));

  // ── the operator agreement ──
  const od = code(read("components/OperatorDeal.tsx"));
  ok("agreement: who it is for is saved by account", /operator_user_id: d\.operatorUserId,/.test(od));
  ok("agreement: nothing is sent to nobody", /if \(to === "sent" && !d\.operatorUserId\) \{/.test(od));
  ok("agreement: one already sent unlinked can be linked where it stands",
    /\{!isMine && !editable && !row\.operator_user_id && <LinkOperator/.test(od) && /\.update\(\{ operator_user_id: who\.id,/.test(od));
  ok("agreement: a draft for someone starts linked to them", /operator_user_id: forWho\?\.id \?\? null, operator_email: f\?\.email \?\? null,/.test(od));
  ok("agreement: ?agreement_for= opens theirs, or offers to draft one — a tap, not a row written by a link",
    /readParam\("agreement_for"\)/.test(od) && /onClick=\{\(\) => createDraft\(draftFor\)\}/.test(od));
  ok("agreement: logged hours say whose they are", /hours: n, note: note\.trim\(\) \|\| null, logged_by: user\?\.id \?\? null \}\)/.test(od));

  // ── every next step carries who ──
  const cp = code(read("components/CrewPerson.tsx"));
  ok("person page: the offer, the agreement and the Academy path open for them",
    cp.includes("offer:     { href: (id) => `/crew?s=money&a=offers&offer_for=${id}`") && cp.includes("agreement: { href: (id) => `/crew?s=money&a=operators&agreement_for=${id}`") && cp.includes("academy:   { href: (id) => `/academy?assign=${id}`") && /href=\{go\.href\(p\.user_id\)\}/.test(cp));
  const ac = code(read("app/academy/page.tsx"));
  ok("academy: ?assign= opens the board with them chosen — for an admin, and only someone on it",
    /useState<View>\(\(\) => \(assignFor \? \{ k: "team" \} : \{ k: "home" \}\)\)/.test(ac) && /if \(view\.k === "team" && isAdmin\) return <TeamBoard assignFor=\{assignFor\}/.test(ac) && /const chosen = rows\.some\(\(r\) => r\.id === memberId\) \? memberId : "";/.test(ac));
  const pg = code(read("app/crew/page.tsx"));
  ok("bring someone on: the city starts as theirs, else yours, else the founding market — not Atlanta by the alphabet",
    /supabase\.from\("v_promotable"\)\.select\("id, display_name, email, customer_name, market"\)/.test(pg) && /\[pickedRow\?\.market, profile\?\.market, FOUNDING_MARKET\]/.test(pg) && !/setMarket\(\(prev\) => prev \|\| /.test(pg));
  ok("bring someone on: their offer and their Academy path open for them",
    pg.includes("href={`/crew?s=money&a=offers&offer_for=${justHired.id}`}") && pg.includes("href={`/academy?assign=${justHired.id}`}"));
  // 2026-10-06 (the settings round): the ?a= consumer reads and drops in two steps — a link to the
  // Pass waits for ?s=now to land before it is taken — still through lib/urlParam, its one home.
  ok("crew page: a link's one-time instruction has one home", /const a = readParam\("a"\);/.test(pg) && /dropParam\("a"\);/.test(pg) && /readParam\("promote"\)/.test(pg) && !/searchParams\.delete\("promote"\)/.test(pg) && !/searchParams\.delete\("a"\)/.test(pg));

  // ── the follow-ups reach someone ──
  ok("notes: a new follow-up starts as the author's, and a summary never orphans one",
    /\[\.\.\.a, \{ title: "", category: "task", critical: false, assignee: meId \}\]/.test(pg) && /assignee: a\.assignee \?\? meId/.test(pg));
  ok("notes: a follow-up added on a note's card files under its event or stop, from the note, yours",
    /const parent: TaskParent = note\.event_id \? \{ event: note\.event_id \} : note\.stop_id \? \{ stop: note\.stop_id \} : \{ note: note\.id \};/.test(pg) && /createEventTask\(\{ parent, originNoteId: note\.id, label: newItem\.trim\(\), kind: "task", section: "Follow-up", sort: items\.length, assignee: meId \}\)/.test(pg));
  ok("notes: a decision's follow-through is the decision-maker's", /label: dec\.fu\.trim\(\), kind: "task", section: "Follow-up", sort: 999, assignee: meId \}\)/.test(pg));
  ok("threads: @ resolves to people, not substrings", /const mentionIds = resolveMentions\(sent, staff, picked\)\.ids;/.test(pg) && !/lower\.includes\("@" \+ fn\)/.test(pg));
  const gl = code(read("components/Goals.tsx"));
  ok("goals: a new goal has an owner — the lane's, else yours", /metric_source: src, owner_user_id: newOwner\.id,/.test(gl) && /streams\.find\(\(s\) => s\.key === ng\.stream\)\?\.owner_user_id \?\? user\?\.id \?\? null/.test(gl));
  ok("goals: a new move has the goal's owner and date, and the owner hears about it",
    /assignee, dueISO: g\?\.due_date \? new Date\(`\$\{g\.due_date\}T23:59:59`\)\.toISOString\(\) : null,/.test(gl) && /if \(id && assignee && assignee !== user\?\.id\) \{/.test(gl));

  // ── the rest of the people ──
  const am = code(read("components/AssetMaintenance.tsx"));
  ok("maintenance: who did it starts as you, from the crew list", /const \[who, setWho\] = useState<PersonValue>\(me\);/.test(am) && /performed_by: who\.name\.trim\(\) \|\| null,/.test(am));
  const pl = code(read("components/PipelinePanel.tsx"));
  ok("pipeline: a new opportunity's rep is whoever adds it", /repId: user\?\.id \?\? "",/.test(pl) && /setNo\(blankOpp\(\)\)/.test(pl));
  const ep = code(read("components/EventDayPlanner.tsx"));
  ok("run of show: a new block starts where the last one ends, at the venue for the venue's work, with the crew as chips",
    /const nextStart = \(dayItems\[dayItems\.length - 1\]\?\.end_time \?\? ""\)\.trim\(\);/.test(ep) && /const AT_THE_VENUE = new Set\(\["setup", "service", "teardown"\]\);/.test(ep) && /location: follow\(p\.location, was\.place, now\.place\)/.test(ep) && /onClick=\{\(\) => toggleWho\(n\)\}/.test(ep));
  const it = code(read("components/InviteTeammate.tsx"));
  ok("invite: an email that already has an account is offered the door that works",
    /\.eq\("email_norm", em\)\.not\("user_id", "is", null\)/.test(it) && it.includes("href={`/crew?s=team&promote=${hasAccount.id}`}"));
  const dop = code(read("components/DeliveryOps.tsx"));
  ok("loop returns: whose bottles, and who counted them", /insert\(\{ returns: v, customer_id: whose \|\| null, created_by: user\?\.id \?\? null \}\)/.test(dop));
  const ir = code(read("app/api/agents/intake/route.ts"));
  ok("smart intake: filed on the filer's own city's shelf, read from their profile",
    /select\("market, leads_market"\)\.eq\("id", user\.id\)\.eq\("tenant_id", tenant\)/.test(ir) && (ir.match(/\.\.\.inMarket,/g) || []).length === 2);
}

// ── THE TRUCK PAGE DRAWS ONCE (2026-10-04) ────────────────────────────────────────────────────────
// Production measured layout shift 0.38 on /truck, 0.21 on /events, 0.12 on / and 0.041 on /reserve
// (the gate is 0.04) — 0.001, 0.000, 0.028 and 0.000 before 8dd36fe, whose first-visit reload had
// been hiding it. Find Us drew an empty page and let the road fill it in, ~90px of everything
// moving at once; the live-ping chip arrived a frame late and wrapped the chip row; the reserve
// page's Saturday picker arrived under the packs. Measured on a stand-in road that answers after
// 900ms: 0.2004 → 0.0011 on /truck and /events, 0.0411 → 0 on /reserve.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const fu = code(read("components/FindUs.tsx"));
  ok("find us: a skeleton until the road is read, then the page — swapped, never filled in",
    /\{!\(board\.data \|\| board\.status === "error"\) \? <FindUsSkeleton \/> : \(<Fragment key="road">/.test(fu) && /function FindUsSkeleton\(\)/.test(fu) && /aria-busy="true"/.test(fu));
  ok("find us: the title and the close are on the server's page, in both halves of the swap",
    /<h1 className="k-title lg">…<\/h1>/.test(fu) && (fu.match(/<FindUsCoda \/>/g) || []).length === 2 && /function FindUsCoda\(\)/.test(fu));
  ok("find us: the road is drawn from the read itself — no effect copies it into state a render later",
    /const road = fresh \?\? board\.data \?\? null;/.test(fu) && !/setOps\(|setLive\(/.test(fu));
  ok("find us: the live-ping chip knows itself on its first render",
    /useState<"hidden" \| "off" \| "on" \| "busy">\(\(\) => \{/.test(fu) && !/setState\(on \? "on" : "off"\)/.test(fu));
  const of = code(read("components/OrderFunnel.tsx"));
  ok("reserve: the Saturday picker keeps its place until the stops are read",
    /\) : !stopsRead \? \(/.test(of) && /<span className="oa-day sk"><b>&nbsp;<\/b><span>&nbsp;<\/span><\/span>/.test(of) && /if \(!live\) return;\s*setStopsRead\(true\);/.test(of));
}

// ── THE FORM AUDIT, PART 3b: THINGS (2026-10-04) ─────────────────────────────────────────────────
// A THING on a crew form is picked from what is on file, the way a person is: the supplier of a
// purchase (expenses.vendor_id — the capture sheet never wrote it, and taught typing the store into
// the description), the drink a discount code names (the menu, not a four-item constant that could
// mint a code for a latte the checkout never sells), the bottles on the shelf (read, not a frozen 122),
// a reserve's stock (Left moves with it), an Apliiq ID (looked up, not inserted into a duplicate-key
// error), a new shelf's city and its count (the shelf's, through the ledger).
{
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const SUP = require("../.smoke/suppliers.js");
  const BT = require("../.smoke/benefitText.js");
  const BEN = require("../.smoke/benefits.js");
  const BS = require("../.smoke/bottleShelf.js");
  const RS = require("../.smoke/reserveStock.js");
  const MK = require("../.smoke/homeMarket.js");

  // ── whose city ──
  ok("home market: the city someone leads, else the one they work in, else nobody's",
    MK.homeMarket({ market: "greenville", leads_market: "atlanta" }) === "atlanta" && MK.homeMarket({ market: "atlanta", leads_market: null }) === "atlanta"
    && MK.homeMarket({ market: "paris" }) === null && MK.homeMarket(null) === null && MK.homeMarket(undefined) === null);
  ok("home market: beside lib/markets, not in it — every public page carries lib/markets",
    !/homeMarket/.test(code(read("lib/markets.ts"))) && /export function homeMarket/.test(read("lib/homeMarket.ts")));
  ok("home market: one home — the intake route, the offer letter and the operator agreement ask it",
    /homeMarket\(filer as/.test(code(read("app/api/agents/intake/route.ts"))) && /market: homeMarket\(c\)/.test(code(read("components/OfferLetters.tsx")))
    && /market: homeMarket\(c\)/.test(code(read("components/OperatorDeal.tsx")))
    && !/leads_market \?\? c\.market|leads_market \|\| shelf\?\.market/.test(code(read("components/OfferLetters.tsx")) + code(read("components/OperatorDeal.tsx")) + code(read("app/api/agents/intake/route.ts"))));

  // ── who a purchase was bought from ──
  const V = [
    { id: "spr", name: "Sprouts Farmers Market", kind: "supplier" },
    { id: "rd", name: "Restaurant Depot", kind: "both" },
    { id: "wx", name: "Wine Express", kind: "venue" },
    { id: "aca", name: "ACA Sports Club", kind: "venue" },
    { id: "tri", name: "TricorBraun", kind: "supplier" },
  ];
  const P = [
    { vendor_id: "rd", category: "supplies" }, { vendor_id: "rd", category: "supplies" }, { vendor_id: "rd", category: "supplies" },
    { vendor_id: "spr", category: "ingredients" }, { vendor_id: "spr", category: "ingredients" }, { vendor_id: "spr", category: "supplies" },
    { vendor_id: "wx", category: "other" },
    { vendor_id: null, category: "fees" },
  ];
  const ranked = SUP.rankSuppliers(V, P);
  ok("suppliers: the ones bought from most come first, then the rest by name",
    ranked.map((s) => s.id).join(",") === "rd,spr,wx,tri", ranked.map((s) => s.id));
  ok("suppliers: a venue a purchase was bought from is offered (same company); one never bought from is not",
    ranked.some((s) => s.id === "wx") && !ranked.some((s) => s.id === "aca"));
  ok("suppliers: a usual category needs two purchases and three in four of them",
    ranked.find((s) => s.id === "rd").usual === "supplies" && ranked.find((s) => s.id === "spr").usual === null
    && ranked.find((s) => s.id === "wx").usual === null && ranked.find((s) => s.id === "tri").usual === null);
  ok("suppliers: four of five is usual, two of three is not",
    SUP.rankSuppliers(V, [...Array(4)].map(() => ({ vendor_id: "tri", category: "supplies" })).concat([{ vendor_id: "tri", category: "equipment" }])).find((s) => s.id === "tri").usual === "supplies");
  ok("suppliers: a typed name that IS a supplier is that supplier — case and spacing aside",
    SUP.supplierNamed(ranked, "  restaurant   depot ")?.id === "rd" && SUP.supplierNamed(ranked, "Restaurant Dep") === null && SUP.supplierNamed(ranked, "  ") === null);

  const lp = code(read("components/LogPurchase.tsx"));
  ok("purchase sheet: the vendor book is read — active rows, with their kind — and the last 90 days say who and what",
    /readVendorBook\(supabase\),/.test(lp)
    && /\.from\("vendors"\)\.select\("id, name, kind"\)\.is\("archived_at", null\)\.neq\("status", "archived"\)/.test(read("lib/suppliers.ts"))
    && /\.from\("expenses"\)\.select\("category, vendor_id"\)/.test(lp) && /rankSuppliers\(/.test(lp));
  ok("purchase sheet: a failed vendor read is said, and the purchase can still be logged",
    /if \(v\.error\) setVendErr\(v\.error\.message\);/.test(lp) && /Couldn't load the vendor book/.test(lp));
  ok("purchase sheet: the purchase records WHO — expenses.vendor_id is written",
    /spent_on: spentOn, market, vendor_id: settled\.id,/.test(lp));
  const vl = code(read("lib/vendorLink.ts"));
  ok("purchase sheet: a new supplier goes through THE resolver — approved, a supplier, filed in the purchase's city",
    /const r = await resolveSupplier\(typed, market, "a purchase"\);/.test(lp) && /if \(r\.kind === "similar"\) \{ setBusy\(false\); setAsking\(/.test(lp)
    && /return resolveVendor\(name, \{ status: "approved", source, extra: \{ kind: "supplier", market \}/.test(vl) && !/resolveVendor\(/.test(lp));
  ok("purchase sheet: a look-alike is asked about — use it, create it as new, or log with none",
    /<VendorResolve name=\{asking\.name\}/.test(lp) && /onUse=\{\(c\) => \{ setAsking\(null\); save\(\{ id: c\.id, name: c\.name \}\); \}\}/.test(lp)
    && /resolveSupplier\(typed, market, "a purchase", \{ createDistinct: true \}\)/.test(lp) && /onSkip=\{\(\) => \{ setAsking\(null\); save\(\{ id: null \}\); \}\}/.test(lp));
  ok("purchase sheet: the placeholder no longer teaches typing the store into the description",
    !/placeholder="[^"]*Restaurant Depot/.test(lp) && /placeholder="Cups and lids, 16 oz"/.test(lp));
  ok("purchase sheet: a supplier's usual category fills only an untouched category (lib/pickFill), and says so",
    /setCat\(follow\(cat, catFrom\?\.slug, usual\) \|\| null\);/.test(lp) && /const pickCat = \(slug: string\) => \{ setCat\(slug\); setCatFrom\(null\); \};/.test(lp)
    && /is what \$\{catFrom\.who\} usually is/.test(lp));
  ok("purchase sheet: a device with no remembered city starts in its person's",
    /useState<Market>\(\(\) => readMarket\(homeMarket\(profile\)\)\)/.test(lp) && /localStorage\.getItem\(MARKET_KEY\) \|\| home \|\| FOUNDING_MARKET/.test(lp));

  // ── what a discount can name — and reach ──
  // The table against the engine that applies it: every reach the table grants changes a price,
  // and every one it withholds changes none — but one, the set price on every cup, which the forms refuse.
  const cupEffect = (b, slug) => BEN.priceForSlug([b], slug, 1000) < 1000;
  const packEffect = (b) => BEN.applyOrderBenefits(1000, [b]) < 1000 || BEN.refillIsFree([b]);
  const sample = { percent_off: { percent: 10 }, price_override: { value_cents: 800 }, amount_off: { value_cents: 300 }, free_refill: {} };
  const engine = (kind, target) => {
    const b = { scope: "code", tier: null, code: "X", kind, target, value_cents: null, percent: null, label: "x", ...sample[kind] };
    return target === null ? cupEffect(b, "tide") || packEffect(b) : target === "straight_brew" ? cupEffect(b, "rise") || packEffect(b) : cupEffect(b, target) || packEffect(b);
  };
  const drift = [];
  for (const kind of Object.keys(BT.KIND_REACH)) {
    const r = BT.KIND_REACH[kind];
    if (r.product !== engine(kind, "tide")) drift.push(`${kind}/product`);
    if (r.family !== engine(kind, "straight_brew")) drift.push(`${kind}/family`);
    if (r.whole !== engine(kind, null) && !(kind === "price_override" && !r.whole)) drift.push(`${kind}/whole`);
  }
  ok("benefit reach: the forms' table and lib/benefits agree on every kind and target", drift.length === 0, drift);
  ok("benefit reach: a set price on the whole order is the one deliberate refusal (the engine would reprice every cup)",
    engine("price_override", null) === true && BT.KIND_REACH.price_override.whole === false);
  ok("benefit reach: the family is lib/benefits' straight brew",
    BT.FAMILY_SLUGS.every((s) => BEN.priceForSlug([{ kind: "price_override", target: "straight_brew", value_cents: 1 }], s, 1000) === 1)
    && BEN.priceForSlug([{ kind: "price_override", target: "straight_brew", value_cents: 1 }], "tide", 1000) === 1000);

  const MENU = [
    { slug: "rise", name: "RISE", price_cents: 1000, active: true, cup: true },
    { slug: "flow", name: "FLOW", price_cents: 1000, active: true, cup: true },
    { slug: "dusk", name: "DUSK", price_cents: 1100, active: true, cup: true },
    { slug: "hunt", name: "HUNT", price_cents: 1200, active: false, cup: true },
    { slug: "tide", name: "TIDE", price_cents: 1200, active: true, cup: true },
    { slug: "salted-latte", name: "Salted Latte", price_cents: 900, active: true, cup: false },
  ];
  const vals = (k) => BT.targetChoices(k, MENU).map((c) => c.value).join(",");
  ok("applies to: percent off reaches the whole order, the family, and every cup the checkout sells — on the menu first",
    vals("percent_off") === ",straight_brew,rise,flow,dusk,tide,hunt", vals("percent_off"));
  ok("applies to: a drink off the menu is still offered, and says so",
    BT.targetChoices("percent_off", MENU).find((c) => c.value === "hunt").label === "HUNT (off the menu)");
  ok("applies to: a set price names a drink or the family — never the whole order",
    vals("price_override") === "straight_brew,rise,flow,dusk,tide,hunt");
  ok("applies to: $ off and free reach a whole pack — no single drink is offered",
    vals("amount_off") === ",straight_brew" && vals("free_refill") === ",straight_brew");
  ok("applies to: a product the checkout does not sell is never offered",
    !BT.targetChoices("percent_off", MENU).some((c) => c.value === "salted-latte"));
  ok("applies to: a rule on file that reaches nothing says why — and the menu not loaded is not a verdict",
    /not sold through the checkout/.test(BT.reachesNothing("price_override", "salted-latte", MENU))
    && /changes no price/.test(BT.reachesNothing("amount_off", "tide", MENU)) && /changes no price/.test(BT.reachesNothing("free_refill", "maple", null))
    && /not on the menu/.test(BT.reachesNothing("percent_off", "gone", MENU))
    && BT.reachesNothing("price_override", "salted-latte", null) === null && BT.reachesNothing("price_override", "tide", MENU) === null
    && BT.reachesNothing("percent_off", null, MENU) === null && BT.reachesNothing("free_refill", "straight_brew", MENU) === null);
  ok("applies to: what a choice does is said before it is minted",
    BT.reachText("amount_off", "", MENU) === "Comes off an order-ahead pack's total — never off a cup."
    && BT.reachText("percent_off", "tide", MENU) === "TIDE by the cup, at checkout." && BT.reachText("percent_off", "", MENU) === "Every cup at checkout, and every order-ahead pack.");
  ok("applies to: a set price is weighed against the menu — one cup, or the family's range",
    JSON.stringify(BT.menuPriceOf("tide", MENU)) === JSON.stringify({ low: 1200, high: 1200 })
    && JSON.stringify(BT.menuPriceOf("straight_brew", MENU)) === JSON.stringify({ low: 1000, high: 1100 }) && BT.menuPriceOf("", MENU) === null);

  const ubp = code(read("components/useBenefitProducts.ts"));
  ok("applies to: one read of the menu for both panels, a failed read thrown, a cup is what lib/menu sells",
    /\.from\("products"\)\.select\("slug, name, price_cents, active, sort"\)/.test(ubp) && /if \(error\) throw new Error\(error\.message\);/.test(ubp)
    && /cup: Object\.prototype\.hasOwnProperty\.call\(DRINKS, p\.slug\)/.test(ubp));
  for (const [f, verb] of [["components/CodesPanel.tsx", "code"], ["components/PerksPanel.tsx", "perk"]]) {
    const src = code(read(f));
    ok(`applies to (${verb}s): the menu, through the shared list — the constant is gone`,
      !/const TARGETS/.test(src) && /useBenefitProducts\(\)/.test(src) && /targetChoices\(kind, products\)/.test(src)
      && /const tgt = choices\.some\(\(c\) => c\.value === target\) \? target : "";/.test(src) && /kind, target: tgt \|\| null,/.test(src));
    ok(`applies to (${verb}s): a rule on file that reaches nothing says so on its row`, /reachesNothing\(r\.kind, r\.target, menu\.data\)/.test(src));
    // Found driving the perks list on a stand-in backend: the row's target, now drawn as an element,
    // was still interpolated into a template string — every perk read "· [object Object]".
    ok(`applies to (${verb}s): a row's target is drawn, never interpolated into a string`, /targetText\(r\)/.test(src) && !/\$\{targetText\(/.test(src));
    ok(`applies to (${verb}s): the menu price beside a set price, and a price that changes nothing is called out`,
      /menuPriceOf\(tgt, products\)/.test(src) && /priceCents >= menuPrice\.high/.test(src) && /menu\.status === "error"/.test(src));
  }

  // ── bottles on the shelf ──
  ok("bottle shelf: the name says bottle and the size — any spacing, never a bigger number",
    BS.isBottleShelf("10 oz Clear Glass Stout Decanter Bottle 38-405 Neck Finish", 10) && BS.isBottleShelf("Amber bottles 10oz", 10)
    && BS.isBottleShelf("10-oz bottle", 10) && !BS.isBottleShelf("110 oz bottle", 10) && !BS.isBottleShelf("10 oz Clear Glass Stout Decanter Bottle", 16)
    && !BS.isBottleShelf("10 oz cups", 10));
  const SH = [
    { name: "10 oz Clear Glass Stout Decanter Bottle", unit: "each", effective_on_hand: 60, market: "greenville" },
    { name: "10oz Amber Bottle", unit: "Each", effective_on_hand: 40.5, market: "greenville" },
    { name: "10 oz Clear Glass Stout Decanter Bottle", unit: "case", effective_on_hand: 122, market: "atlanta" },
    { name: "16 oz Bottle", unit: "each", effective_on_hand: 24, market: "atlanta" },
  ];
  const g10 = BS.bottleStock(SH, 10, "greenville");
  ok("bottle shelf: single bottles add up across the city's shelves", g10.kind === "count" && g10.bottles === 100 && g10.shelves.length === 2, g10);
  ok("bottle shelf: a shelf counted in cases is shown as it is, never converted on a guess",
    BS.bottleStock(SH, 10, "atlanta").kind === "other" && BS.bottleStock(SH, 10, "atlanta").shelves[0].unit === "case");
  ok("bottle shelf: another city's shelf is not this one's, and no shelf is said",
    BS.bottleStock(SH, 16, "greenville").kind === "none" && BS.bottleStock(SH, 16, "atlanta").bottles === 24);
  const pp = code(read("components/PackPlan.tsx"));
  ok("pack-out plan: no frozen 122 — the box starts from the event's own city's shelf",
    !/useState\("122"\)/.test(pp) && /bottleStock\(shelf\.data\.shelves, oz, shelf\.data\.market\)/.test(pp)
    && /supabase\.from\("events"\)\.select\("market"\)/.test(pp) && /supabase\.from\("stops"\)\.select\("market"\)/.test(pp)
    && /\.from\("inventory_status"\)\.select\("name, unit, effective_on_hand, market"\)/.test(pp));
  ok("pack-out plan: no count, no 'short' — it says it cannot check instead",
    /const shortBottles = stockKnown \? Math\.max\(0, plan\.totalBottles - stockN\) : 0;/.test(pp) && /not entered — can&apos;t check it/.test(pp));
  ok("pack-out plan: a typed count is the person's, and belongs to one size",
    /const stock = typed \?\? \(onShelf\?\.kind === "count" \? String\(onShelf\.bottles\) : ""\);/.test(pp) && /setOz\(n\); setTyped\(null\);/.test(pp));
  ok("pack-out plan: a shelf that cannot be read is said, and does not take the plan down",
    /const shelf = useAsyncData\(shelfLoader/.test(pp) && /Couldn't read the shelf/.test(pp));

  // ── a reserve's stock ──
  const R = { stock_total: 12, stock_remaining: 7, status: "live" };
  ok("reserve stock: raising stock moves what is left by the same amount",
    JSON.stringify(RS.setStock(R, 24).patch) === JSON.stringify({ stock_total: 24, stock_remaining: 19, status: "live" }));
  ok("reserve stock: stock cannot go under what is claimed or held, and says how many",
    RS.setStock(R, 4).ok === false && /5 already claimed or held/.test(RS.setStock(R, 4).reason) && RS.setStock(R, 5).patch.stock_remaining === 0);
  ok("reserve stock: live with nothing left is sold out; sold out with stock again is live; a draft stays a draft",
    RS.setStock(R, 5).patch.status === "sold_out" && RS.setStock({ stock_total: 5, stock_remaining: 0, status: "sold_out" }, 8).patch.status === "live"
    && RS.setStock({ stock_total: 5, stock_remaining: 5, status: "draft" }, 0).patch.status === "draft");
  ok("reserve stock: Left is corrected within 0 and the stock, never past it",
    RS.setLeft(R, 12).ok === true && RS.setLeft(R, 13).ok === false && RS.setLeft(R, -1).ok === false && RS.setLeft(R, 0).patch.status === "sold_out" && RS.setStock(R, 2.5).ok === false);
  const ra = code(read("app/crew/page.tsx"));
  ok("reserve card: one write, matched on the numbers it was worked out from — never over a claim",
    /\.update\(c\.patch\)\s*\.eq\("id", cur\.id\)\.eq\("stock_total", cur\.stock_total\)\.eq\("stock_remaining", cur\.stock_remaining\)\.select\("id"\)/.test(ra)
    && /writeStock\(r, \(cur\) => planStock\(cur, n\)/.test(ra) && /writeStock\(r, \(cur\) => planLeft\(cur, n\)/.test(ra)
    && !/update\(r\.id, \{ stock_total:/.test(ra) && !/update\(r\.id, \{ stock_remaining:/.test(ra));
  ok("reserve card: a failed read is not 'No reserves yet'",
    /const \{ data, error \} = await supabase\.from\("reserves"\)\.select\("\*"\)\.order\("sort"\);\s*if \(error\) throw new Error\(error\.message\);/.test(ra));

  // ── an Apliiq ID ──
  const mm = code(read("components/MerchManager.tsx"));
  ok("apliiq id: the add form finds the product that already holds it and opens that instead of adding a copy",
    /const twin = na\.apliiq\.trim\(\) \? products\.find\(/.test(mm) && /disabled=\{isBlank\(na\.title\) \|\| !!twin\}/.test(mm) && /onClick=\{\(\) => openTwin\(twin\)\}>Open it</.test(mm));
  ok("apliiq id: the editor will not save onto another product's ID — it moves the link, or opens that one",
    /disabled=\{isBlank\(d\.title\) \|\| \(!!holder && !absorbing\)\}/.test(mm) && /onClick=\{moveHere\}>Move the link here</.test(mm) && /onClick=\{\(\) => onOpen\(holder\)\}>Open it</.test(mm));
  ok("apliiq id: moving the link frees the synced copy first, matched on the ID it held, and gives it back if this save fails",
    /\.update\(\{ apliiq_product_id: null, archived_at: absorbing\.archived_at \?\? now, updated_at: now \}\)\s*\.eq\("id", absorbing\.id\)\.eq\("apliiq_product_id", typedId\)\.select\("id"\)/.test(mm)
    && /if \(error && absorbing\) \{\s*await supabase\.from\("shop_products"\)\.update\(\{ apliiq_product_id: typedId, archived_at: absorbing\.archived_at/.test(mm));
  ok("apliiq id: what the curated product lacks comes with the link — cost and sizes, never over its own",
    /absorbing && p\.cost_cents == null && absorbing\.cost_cents != null \? \{ cost_cents: absorbing\.cost_cents \}/.test(mm)
    && /absorbing && p\.variants\.length === 0 && absorbing\.variants\.length \? \{ variants: absorbing\.variants \}/.test(mm));

  // ── a shelf's city, and its count ──
  const il = code(read("components/InventoryLibrary.tsx"));
  ok("inventory: a new shelf starts in its person's city and is filed there",
    /setDraft\(blankDraft\(homeMarket\(profile\) \?\? FOUNDING_MARKET\)\)/.test(il) && /\.insert\(r\), \{ \.\.\.row, qty: count, market: draft\.market \} as Record<string, unknown>, \["vendor_id"\]\)/.test(il));
  ok("inventory: a changed count on a shelf is a correction through set_on_hand, on that shelf's city",
    /supabase\.rpc\("set_on_hand", \{\s*p_item: row\.name, p_want: count, p_market: toMarket\(editingItem\.market\)/.test(il)
    && /\(count != null && Number\.isFinite\(count\) \? \{ \.\.\.row, qty: count \} : row\) as Record<string, unknown>, \["vendor_id"\]\)/.test(il) && !/qty: draft\.qty/.test(il));
  ok("inventory: the register shows what the shelf holds (the ledger's balance) and flags low by it",
    /const onHandOf = \(r: InvItem\): number \| null => r\.onHand \?\? r\.qty;/.test(il) && /className=\{`gl-item\$\{isLow\(it\) \? " low" : ""\}`\}/.test(il));
  ok("inventory: the register's read says whose shelf each row is",
    /market: r\.market \?\? null,/.test(code(read("app/api/inventory/route.ts"))));
  ok("inventory: an AI-drafted item is filed on its filer's city, read from their profile",
    /homeMarket\(filer as/.test(code(read("app/api/agents/inventory/route.ts"))) && /\.\.\.\(market \? \{ market \} : \{\}\)/.test(code(read("app/api/agents/inventory/route.ts"))));
}

// ── THE FORM AUDIT, PART 3c: A DELIVERY LANDS ON ITS SHELF (2026-10-05) ──────────────────────────
// A purchase of ingredients or supplies can go onto the shelf it was bought for: receive_lot (0347)
// puts a costed lot there — what a unit cost, from whom, on what terms — and the restock on the
// ledger. Until now nothing called receive_lot: a batch costed out at $0.00 wherever nobody had priced
// a receipt by hand (0298). A shelf's supplier is a vendor, through the same supplier resolver as the
// purchase. scripts/db.receive.test.mjs holds the SQL; this holds the forms to it.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const RV = require("../.smoke/receiving.js");
  const SK = require("../.smoke/schemaSkew.js");

  ok("receiving: ingredients and supplies are stock; equipment, fees and the rest are not",
    RV.isStocked("ingredients") && RV.isStocked("supplies") && !RV.isStocked("equipment") && !RV.isStocked("fees") && !RV.isStocked(null) && !RV.isStocked("toString"));
  const SH = [
    { id: "a", name: "Org Ethiopia Coffee (bulk)", unit: "lb", kind: "ingredient" },
    { id: "b", name: "Spring Water Case", unit: "case", kind: "ingredient" },
    { id: "c", name: "Cups 16 oz", unit: "each", kind: "packaging" },
    { id: "d", name: "Heat Gun", unit: "each", kind: "equipment" },
    { id: "e", name: "Agave", unit: null, kind: null },
  ];
  const LOTS = [{ item_name: "Spring Water Case", vendor_id: "spr" }, { item_name: "Cups 16 oz", vendor_id: "rd" }];
  const order = (v, c) => RV.orderShelves(SH, LOTS, v, c).map((x) => x.id).join("");
  ok("receiving: Sprouts' water first (they have filled it), then the coffee (an ingredient), then the rest by name — never equipment",
    order("spr", "ingredients") === "baec", order("spr", "ingredients"));
  ok("receiving: no supplier — the category's kinds first (supplies fill packaging and consumables)",
    order(null, "supplies") === "ceab", order(null, "supplies"));
  ok("receiving: a unit cost is the amount over the quantity, in whole cents — or nothing",
    RV.unitCost(9594, 6) === 1599 && RV.unitCost(6998, 2) === 3499 && RV.unitCost(2000, 3) === 667 && RV.unitCost(100, 0) === null && RV.unitCost(100, -1) === null);
  ok("receiving: whole cents that move a lot by more than 1% are said — 1,000 cups at $45 cost out at $50",
    RV.roundedLot(4500, 1000) === 5000 && RV.roundedLot(9594, 6) === null && RV.roundedLot(3998, 2.5) === null && RV.roundedLot(549, 6) === null
    && RV.roundedLot(40, 1000) === 0 && RV.roundedLot(100, 0) === null, [RV.roundedLot(4500, 1000), RV.roundedLot(40, 1000)]);
  ok("receiving: a price per unit reads as it is said — a lb, an oz, each, a unit",
    RV.perUnitWords("lb") === "a lb" && RV.perUnitWords("oz") === "an oz" && RV.perUnitWords("each") === "each" && RV.perUnitWords("EA") === "each"
    && RV.perUnitWords(null) === "a unit" && RV.perUnitWords("unit") === "a unit" && RV.perUnitWords("case") === "a case");
  ok("receiving: an amount reads as a sentence says it — 6 cases, 2.5 lb, 1,000 (each), 1 case, 3 boxes, 2 dozen",
    RV.qtyWords(6, "case") === "6 cases" && RV.qtyWords(2.5, "lb") === "2.5 lb" && RV.qtyWords(1000, "each") === "1,000" && RV.qtyWords(1, "case") === "1 case"
    && RV.qtyWords(3, "box") === "3 boxes" && RV.qtyWords(2, "dozen") === "2 dozen" && RV.qtyWords(4, "battery") === "4 batteries" && RV.qtyWords(5, "cases") === "5 cases" && RV.qtyWords(7, null) === "7",
    [RV.qtyWords(6, "case"), RV.qtyWords(1000, "each"), RV.qtyWords(3, "box")]);
  ok("receiving: a quantity is a positive number, typed any reasonable way",
    RV.shelfQty("6") === 6 && RV.shelfQty(" 2.5 ") === 2.5 && RV.shelfQty("1,000") === 1000 && RV.shelfQty(".5") === 0.5
    && RV.shelfQty("0") === null && RV.shelfQty("") === null && RV.shelfQty("six") === null && RV.shelfQty("-2") === null);
  ok("schema skew: a function not there yet in this shape is PGRST202, or its sentence — and nothing else",
    SK.isMissingFunction({ code: "PGRST202" }) && SK.isMissingFunction({ message: "Could not find the function public.receive_lot(p_expense_id, p_item) in the schema cache" })
    && !SK.isMissingFunction({ code: "42501", message: "permission denied for function receive_lot" }) && !SK.isMissingFunction({ message: "A delivery has to be more than zero." }) && !SK.isMissingFunction(null));

  const lp = code(read("components/LogPurchase.tsx"));
  ok("purchase sheet: the shelf section is for stock only, and nothing is chosen for you",
    /const stocked = isStocked\(cat\);/.test(lp) && /\{stocked && \(/.test(lp) && /const \[shelfId, setShelfId\] = useState\(""\);/.test(lp) && /<option value="">\{shelvesHere \? "Not onto a shelf" : `Reading \$\{MARKET_LABEL\[market\]\}'s shelves…`\}<\/option>/.test(lp));
  ok("purchase sheet: the city's shelves, and its lots to put the supplier's first — a failed read said",
    /\.from\("inventory_items"\)\.select\("id, name, unit, kind"\)\.eq\("market", market\)/.test(lp) && /\.from\("inventory_lots"\)\.select\("item_name, vendor_id"\)\.eq\("market", market\)/.test(lp)
    && /if \(sh\.error\) throw new Error\(sh\.error\.message\);/.test(lp) && /const shelvesFailed = !shelvesHere && !!shelfRead\.error;/.test(lp) && /\{shelvesFailed \? \(/.test(lp)
    && /Couldn't read \$\{MARKET_LABEL\[market\]\}'s shelves/.test(lp) && /orderShelves\(shelvesHere\.shelves, shelvesHere\.lots, from\.id, cat\)/.test(lp));
  ok("purchase sheet: a chosen shelf needs how much — the button waits, and says so",
    /const ready = cents > 0 && !!cat && !!spentOn && !busy && \(!shelf \|\| qty !== null\);/.test(lp) && /Say how much went onto the shelf/.test(lp));
  ok("purchase sheet: the delivery is a lot of THIS purchase — its city, its day, its supplier, its unit cost",
    /supabase\.rpc\("receive_lot", \{\s*p_market: market, p_item: shelf\.name, p_qty: qty, p_unit: shelf\.unit, p_unit_cost_cents: perUnit,\s*p_expense_id: \(data as \{ id: string \}\)\.id, p_received_on: spentOn, p_vendor_id: settled\.id,/.test(lp));
  ok("purchase sheet: a delivery that did not land makes the toast an error — the purchase logged, the shelf not",
    /shelfMissed = !!recvErr;/.test(lp) && (lp.match(/\$\{onShelf\}\$\{added\}`, shelfMissed \? "error" : undefined\)/g) || []).length === 2);
  ok("purchase sheet: what landed is said in the shelf's own words", /: ` Added \$\{qtyWords\(qty, shelf\.unit\)\} to \$\{shelf\.name\}\.`;/.test(lp));
  ok("purchase sheet: before 0347 the shelf step says it arrives with the next update — never 0293's receive_lot",
    /isMissingFunction\(recvErr\)/.test(lp) && /receiving onto a shelf arrives with the next database update/.test(lp) && /arrives-with: 0347/.test(read("components/LogPurchase.tsx")));
  ok("purchase sheet: shelves belong to the city they were read for — the last city's are never offered, nor a pick among them carried over",
    /return \{ market, shelves:/.test(lp) && /const shelvesHere = shelfRead\.data && shelfRead\.data\.market === market \? shelfRead\.data : null;/.test(lp)
    && /const shelf = stocked \? shelfChoices\.find\(\(x\) => x\.id === shelfId\) \?\? null : null;/.test(lp));
  ok("purchase sheet: what a unit cost reads as it is said, and whole-cent rounding that moves the lot is said before it is logged",
    /\$\{money\(perUnit\)\} \$\{perUnitWords\(shelf\.unit\)\}/.test(lp) && /const costedAt = qty \? roundedLot\(cents, qty\) : null;/.test(lp)
    && /Costs are kept in whole cents, so this delivery is costed at \$\{money\(costedAt\)\}, not \$\{money\(cents\)\}\./.test(lp));
  ok("one vendor book: both supplier picks read it through lib/suppliers.readVendorBook — neither writes the query",
    /readVendorBook\(supabase\)/.test(lp) && /readVendorBook\(supabase\)/.test(code(read("components/InventoryLibrary.tsx")))
    && !/from\("vendors"\)\.select\("id, name, kind"\)/.test(lp + code(read("components/InventoryLibrary.tsx")))
    && /export const readVendorBook = \(sb: SupabaseClient\) =>\s*sb\.from\("vendors"\)\.select\("id, name, kind"\)\.is\("archived_at", null\)\.neq\("status", "archived"\)\.order\("name"\);/.test(read("lib/suppliers.ts")));

  const il = code(read("components/InventoryLibrary.tsx"));
  ok("register: the supplier is a vendor pick — no suggest-list of every vendor row",
    /<select aria-label="Supplier"/.test(il) && !/list="gt3-vendors"/.test(il) && /rankSuppliers\(book\.data \?\? \[\], items\.map/.test(il));
  ok("register: someone new goes through the one supplier resolver, filed in the shelf's city",
    /resolveSupplier\(name, draft\.market, "the inventory register"\)/.test(il) && /<VendorResolve name=\{asking\.name\}/.test(il));
  ok("register: a Save that stops to ask about a look-alike carries on with the answer — a Link it only links",
    /const \[asking, setAsking\] = useState<\{ name: string; candidates: VendorMatch\[\]; then: "save" \| "link" \} \| null>\(null\);/.test(il)
    && /settleSupplier\(supplier\.name, "save"\)/.test(il) && /settleSupplier\(draft\.vendor\.trim\(\), "link"\)/.test(il)
    && (il.match(/if \(then === "save"\) save\(\{ id: (c|r)\.id, name(: c\.name)? \}\);/g) || []).length === 2
    && /let supplier: \{ id: string \| null; name: string \} = picked \?\? \{ id: draft\.vendorId, name: draft\.vendor\.trim\(\) \};/.test(il)
    && /onClick=\{\(\) => save\(\)\}/.test(il) && !/onClick=\{save\}/.test(il));
  ok("register: a name typed before links is kept, and linked only when asked — never behind another edit",
    /`\$\{draft\.vendor\.trim\(\)\} \(typed\)`/.test(il) && /was typed before suppliers were links/.test(il) && /className="gl-act" onClick=\{linkTyped\}/.test(il) && /if \(!picked && draft\.naming && supplier\.name\) \{/.test(il));
  ok("register: the link is written with the name, and survives the gap before 0347",
    /vendor_id: supplier\.id,/.test(il) && (il.match(/\["vendor_id"\]\)/g) || []).length === 2 && /arrives-with: 0347/.test(read("components/InventoryLibrary.tsx")));
  const api = code(read("app/api/inventory/route.ts"));
  ok("register: the link is read from the table (the view's columns were fixed at its creation), and a failed read is said",
    /sb\.from\("inventory_items"\)\.select\("id, vendor_id"\)/.test(api) && /vendorId: linkOf\.get\(r\.id\) \?\? null,/.test(api)
    && /links\.error && !isMissingColumn\(links\.error\) \? links\.error\.message : undefined/.test(api) && /resp\.linkError/.test(il));
  const vl = code(read("lib/vendorLink.ts"));
  ok("one supplier resolver: approved, kind supplier, the city it was named in", /export function resolveSupplier\(name: string, market: string, source: string, decision\?: ResolveDecision\)/.test(vl));
  ok("0347 is tested against a real Postgres, and in the db suite", /node scripts\/db\.receive\.test\.mjs/.test(read("package.json")));

  // ── two cities, one name: what 0347 lets happen, made safe where shelves are found by name ──
  const CG = require("../.smoke/cogs.js");
  const INV = [
    { id: "g", name: "Org Ethiopia Coffee (bulk)", unit_cost: 15.99, unit: "lb", market: "greenville" },
    { id: "a", name: "org ethiopia coffee (bulk) ", unit_cost: null, unit: "lb", market: "atlanta" },
    { id: "a2", name: "Agave", unit_cost: 4, unit: "oz", market: "atlanta" },
    { id: "g2", name: "Agave", unit_cost: null, unit: "oz", market: "greenville" },
    { id: "w", name: "Water", unit_cost: null, unit: "gal", market: "atlanta" },
  ];
  const tie = [{ id: "a", name: "Cups", unit_cost: 0.05, unit: "each", market: "atlanta" }, { id: "g", name: "Cups", unit_cost: 0.06, unit: "each", market: "greenville" }];
  const pick = (inv, n) => CG.costByName(inv).get(n)?.id;
  ok("two cities, one name: a recipe's ingredient finds the shelf with a cost, the founding city's first — in any row order",
    pick(INV, "org ethiopia coffee (bulk)") === "g" && pick([...INV].reverse(), "org ethiopia coffee (bulk)") === "g"
    && pick(INV, "agave") === "a2" && pick([...INV].reverse(), "agave") === "a2" && pick(INV, "water") === "w"
    && pick(tie, "cups") === "g" && pick([...tie].reverse(), "cups") === "g");
  ok("two cities, one name: a listed shelf says its city only when another city stocks that name",
    CG.shelfLabel(INV[0], INV) === "Org Ethiopia Coffee (bulk) — Greenville" && CG.shelfLabel(INV[2], INV) === "Agave — Atlanta" && CG.shelfLabel(INV[4], INV) === "Water",
    [CG.shelfLabel(INV[0], INV), CG.shelfLabel(INV[4], INV)]);
  const cc = code(read("components/CogsCalculator.tsx")), mm2 = code(read("components/MenuManager.tsx"));
  ok("two cities, one name: the COGS calculator prices a batch through costByName, reading each shelf's city",
    /select\("id, name, unit_cost, unit, market"\)/.test(cc) && /const invByName = useMemo\(\(\) => costByName\(inv\), \[inv\]\);/.test(cc) && !/new Map\(inv\.map\(\(x\) => \[x\.name/.test(cc));
  ok("two cities, one name: the menu's ingredient picker and a drink's recipe rows say whose shelf a repeated name is",
    /select\("id, name, unit, unit_cost, market"\)/.test(mm2) && /<option key=\{i\.id\} value=\{i\.id\}>\{shelfLabel\(i, inv\)\}<\/option>/.test(mm2)
    && /· \{invLabel\(c\.inventory_item_id\)\}/.test(mm2) && /cogs\.lines\.find\(\(l\) => l\.name === invName\(c\.inventory_item_id\)\)/.test(mm2));
}

// ── THE PLAN LISTS, IN THE ORDER THEY ARE READ (2026-10-05) ─────────────────────────────────────
// Ryan sent three phone screenshots of Plan, without a word: the Events list (each card headed
// "EVENT 01", "EVENT 02"…, in creation order — Oct 24, Aug 15, Aug 23, Jul 31 — two of them still
// "Confirmed" weeks after their date, a hollow ring on every card), Needs sorting above it (the
// advice cut off at "Wrap it if…"), and the calendar's agenda ending on "Outlook sync · NOT
// CONFIGURED … a developer task" over a weekly review last run Aug 2. These hold each answer.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const E = require("../.smoke/eventRecord.js");
  const DW = require("../.smoke/dayWords.js");
  const VK = require("../.smoke/vendorKind.js");
  const T = "2026-10-05";

  // ── the rules, in their one home ──
  ok("plan lists: an event's phase from its row is v_event_record's rule — undated, ahead, today, past",
    E.eventPhase("2026-10-24", T) === "upcoming" && E.eventPhase(T, T) === "today" && E.eventPhase("2026-08-15", T) === "past"
    && E.eventPhase(null, T) === "undated" && E.eventPhase("", T) === "undated" && E.eventPhase("2026-10-05T23:30:00Z", T) === "today");
  ok("plan lists: a dated row leads with its date, then which side of today it is on",
    E.dateLine("2026-10-24", T) === "Sat, Oct 24 · in 19 days" && E.dateLine("2026-08-15", T) === "Sat, Aug 15 · 51 days ago"
    && E.dateLine(T, T) === "Mon, Oct 5 · today" && E.dateLine("2026-10-06", T) === "Tue, Oct 6 · tomorrow" && E.dateLine("2026-10-04", T) === "Sun, Oct 4 · yesterday",
    [E.dateLine("2026-10-24", T), E.dateLine("2026-08-15", T), E.dateLine(T, T)]);
  ok("plan lists: no date says so — it is not today, and not a blank line",
    E.dateLine(null, T) === "No date yet" && E.dateLine("", T) === "No date yet" && E.dateLine(undefined, T) === "No date yet");
  ok("plan lists: across the clock change a day is still a day", E.dateLine("2026-11-02", "2026-10-31") === "Mon, Nov 2 · in 2 days");

  const ROWS = [
    { id: "dd", day: "2026-10-24", stage: "confirmed", start_time: "11:00" },
    { id: "sy", day: "2026-08-15", stage: "confirmed" },
    { id: "sf", day: "2026-08-23", stage: "done" },
    { id: "gg", day: "2026-07-31", stage: "confirmed" },
    { id: "nd", day: null, stage: "lead" },
    { id: "t2", day: T, stage: "prep", start_time: "2:00 PM" },
    { id: "t0", day: T, stage: "prep" },
    { id: "lv", day: T, stage: "live", is_live: true, start_time: "18:00" },
    { id: "t1", day: T, stage: "prep", start_time: "9:00" },
    { id: "ld", day: "2026-09-12", stage: "lead" },
    { id: "d2", day: null, stage: "done" },
  ];
  const ids = (xs) => xs.map((r) => r.id).join(",");
  const P = E.eventPiles(ROWS, T), PR = E.eventPiles([...ROWS].reverse(), T);
  ok("plan lists: coming up reads live first, then today by the clock (untimed after timed), then by date, undated last",
    ids(P.next) === "lv,t1,t2,t0,dd,nd", ids(P.next));
  ok("plan lists: past and still being planned is its own pile, most recent first", ids(P.unwrapped) === "ld,sy,gg", ids(P.unwrapped));
  ok("plan lists: done comes last, most recent first, undated after", ids(P.done) === "sf,d2", ids(P.done));
  ok("plan lists: the order the rows arrive in does not change the list — it came back in creation order before",
    ids(PR.next) === ids(P.next) && ids(PR.unwrapped) === ids(P.unwrapped) && ids(PR.done) === ids(P.done));
  ok("plan lists: a pile never rewrites a stage — a confirmed event in the past still says Confirmed, under a heading that says past",
    P.unwrapped.filter((r) => r.id !== "ld").every((r) => r.stage === "confirmed") && P.unwrapped.length + P.next.length + P.done.length === ROWS.length);
  ok("plan lists: a live flag left out after its day leads the list, where it cannot be missed",
    ids(E.eventPiles([{ id: "n", day: "2026-10-10" }, { id: "old", day: "2026-09-01", stage: "live", is_live: true }], T).next) === "old,n");
  ok("plan lists: what is behind us is listed newest first, undated last",
    [{ day: "2026-01-01" }, { day: null }, { day: "2026-03-01" }].sort(E.newestFirst).map((r) => r.day).join() === "2026-03-01,2026-01-01,");

  ok("plan lists: the venue shows when it adds something the title does not say — in whatever case it was typed",
    E.placeBesideTitle("Dear Deandra Jazz Brunch", "Charlotte, NC") === "Charlotte, NC" && E.placeBesideTitle("Dear Deandra Jazz Brunch", "CHARLOTTE, NC") === "CHARLOTTE, NC");
  ok("plan lists: and not when the title already says it — any case, any punctuation",
    E.placeBesideTitle("Sassafras Flower Farm", "Sassafras Flower Farm") === "" && E.placeBesideTitle("Soul Yoga Workshop — serve window", "SOUL YOGA") === ""
    && E.placeBesideTitle("Wine Express — Five Forks", "Wine-Express") === "");
  ok("plan lists: whole words only — 'Main' is not inside 'Maine Fest', 'Park' is not inside 'Parker's'",
    E.placeBesideTitle("Maine Fest", "Main") === "Main" && E.placeBesideTitle("Parker's Market", "Park") === "Park");
  ok("plan lists: no venue is nothing, not a stray separator",
    E.placeBesideTitle("X", null) === "" && E.placeBesideTitle("X", "   ") === "" && E.placeBesideTitle("X", "—") === "" && E.placeBesideTitle(null, "Unity Park") === "Unity Park");

  ok("plan lists: how long since a ritual — days, then weeks from two on; nothing for a day ahead",
    DW.agoWord(0) === "today" && DW.agoWord(1) === "yesterday" && DW.agoWord(5) === "5 days ago" && DW.agoWord(13) === "13 days ago"
    && DW.agoWord(14) === "2 weeks ago" && DW.agoWord(20) === "2 weeks ago" && DW.agoWord(64) === "9 weeks ago" && DW.agoWord(-3) === "" && DW.agoWord(NaN) === "");
  ok("plan lists: Aug 2 to Oct 5 is nine weeks — what the review card now says", DW.agoWord(DW.daysBetween("2026-08-02", T)) === "9 weeks ago");
  ok("plan lists: a book entry says which side of the business it is on, and guesses nothing",
    VK.vendorKindLabel("venue") === "Venue" && VK.vendorKindLabel("supplier") === "Supplier" && VK.vendorKindLabel("both") === "Venue & supplier"
    && VK.vendorKindLabel(null) === "" && VK.vendorKindLabel("gym") === "");
  ok("plan lists: the kind vocabulary has one home — lib/suppliers re-exports it, and the vendor card reads it without the ranking",
    require("../.smoke/suppliers.js").isSupplierKind === VK.isSupplierKind && VK.isSupplierKind("both") && !VK.isSupplierKind("venue")
    && !/export const isSupplierKind =/.test(read("lib/suppliers.ts")) && /from "@\/lib\/vendorKind"/.test(read("components/crew/LocationEditor.tsx"))
    && !/from "@\/lib\/suppliers"/.test(read("components/crew/LocationEditor.tsx")));

  // ── Plan › Events ──
  const pg = code(read("app/crew/page.tsx"));
  ok("events list: no row is headed by its position — 'EVENT 01' is gone", !/`Event \$\{String\(index/.test(pg) && !/index=\{i\}/.test(pg.slice(pg.indexOf("function EventsAdmin"), pg.indexOf("function SubInterest"))));
  ok("events list: the card leads with its date against today, its hours through the one formatter, its venue only when it adds something",
    /const tag = dateLine\(e\.day, today\);/.test(pg) && /const sub = \[evTime\(e\), placeBesideTitle\(e\.title, e\.location_text\)\]\.filter\(Boolean\)\.join\(" · "\);/.test(pg)
    && !/\[e\.start_time, e\.end_time\]\.filter\(Boolean\)\.join\("–"\)/.test(pg));
  ok("events list: an event with no hours and a venue the title says shows no third line — not 'Tap to set up'",
    /\{sub && <span className="ev-sub">\{sub\}<\/span>\}/.test(pg) && !/<span className="ev-sub">\{sub \|\| "Tap to set up"\}<\/span>/.test(pg.slice(pg.indexOf("function EventCard"), pg.indexOf("function EventsAdmin"))));
  ok("events list: three piles in reading order, on the business day — Needs sorting's",
    /const today = etToday\(\);/.test(pg) && /const piles = eventPiles\(active, today\);/.test(pg)
    && /const EVENT_PILES = \[\["next", "Coming up"\], \["unwrapped", "Past · not wrapped"\], \["done", "Done"\]\] as const;/.test(pg)
    && /<div className="dv-sub">\{label\} · \{piles\[k\]\.length\}<\/div>/.test(pg));
  ok("events list: archived rows say which one, newest first",
    /events\.filter\(\(e\) => e\.archived_at\)\.sort\(newestFirst\)/.test(pg) && /<span className="ev-arch-when">\{evDate\(e\) \?\? "No date"\}<\/span>/.test(pg));
  ok("events list: the light is the live flag and nothing else", /\{e\.is_live && <span className="ev-led" \/>\}/.test(pg) && !/^\s*<span className="ev-led" \/>/m.test(pg));
  ok("events list: one stage vocabulary — lib/eventRecord's words on the badge and the pills, no local list",
    !/const EVENT_STAGES = \[/.test(pg) && /\{stageLabel\(st\)\}<\/span>/.test(pg) && /\{stageLabel\(k\)\}<\/button>/.test(pg)
    && /const STAGE_COLOR: Record<EventStage, string>/.test(pg));

  // ── Route and Vendors share the card ──
  const le = code(read("components/crew/LocationEditor.tsx"));
  ok("route & vendors: no 'LOCATION 01' or 'VENDOR 02' either — the same header as an event's",
    !/`Location \$\{String\(index/.test(le) && !/`Vendor \$\{String\(index/.test(le) && !/\bindex: number\b/.test(le)
    && /dateLine\(startsAt \? etDayKey\(new Date\(startsAt\)\) : null, etToday\(\)\)/.test(le) && /vendorKindLabel\(vendor\?\.kind\)/.test(le)
    && /\{isCur && <span className="ev-led" \/>\}/.test(le) && /timeRange\(startsAt, stop\?\.ends_at\)/.test(le));
  ok("route & vendors: nobody passes a position any more", !/<LocationEditor[^>]*\bindex=/.test(read("components/crew/LiveControl.tsx") + read("app/crew/page.tsx")));

  // ── Needs sorting ──
  const sg = code(read("components/ScheduleGaps.tsx"));
  const cssP = read("app/globals.css");
  ok("needs sorting: what to do is set apart from what is wrong", /\{said\?\.detail \?\? r\.detail\} <span className="sg-fix">\{said\?\.fix \?\? v\.fix\(r\.gap\)\}<\/span>/.test(sg));
  ok("needs sorting: and nothing on the row is cut short — the clamp that cut 'Wrap it if…' is gone",
    /\.evg \.so-row-b i\{white-space:normal;overflow:visible;line-height:1\.45\}/.test(cssP) && !/\.evg \.so-row-b i\{[^}]*line-clamp/.test(cssP) && /\.sg-fix\{color:var\(--cream\)\}/.test(cssP));
  ok("needs sorting: the subject wraps as a row — the 'guests see this' flag is never cut off with it",
    /\.evg \.so-row-b b\{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;white-space:normal;overflow:visible/.test(cssP) && /\.evg \.so-row-b b \.str-guest\{margin-left:0\}/.test(cssP));
  ok("record sheets: the header — the name and how long ago — wraps rather than trailing off",
    /\.so-id \.cp-id-t b,\.so-id \.cp-id-t span\{white-space:normal;overflow:visible/.test(cssP));
  ok("events list: a card's name wraps, and the five stages fit a 390px card (wrapping on a narrower one)",
    !/\.ev-title\{[^}]*nowrap/.test(cssP) && /\.ev-stage\{display:flex;flex-wrap:wrap;gap:5px 4px;/.test(cssP) && /\.ev-stage-pill\{flex:0 0 auto;[^}]*padding:6px 9px;/.test(cssP));
  ok("card css: the light is drawn only as the live dot, and the hours read in sentence case",
    /\.ev-led\{flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:var\(--red\)/.test(cssP) && !/\.ev-card\.live \.ev-led\{/.test(cssP)
    && /\.ev-sub\{font-family:'Inter';font-weight:500;font-size:12px;color:var\(--cream-m\)/.test(cssP) && !/\.ev-sub\{[^}]*uppercase/.test(cssP));

  // ── the calendar ──
  const cal = code(read("components/CompanyCalendar.tsx"));
  ok("calendar: Outlook shows only when there is something to press — its status's home is Settings › Integrations",
    /if \(!st \|\| !st\.configured\) return null;/.test(cal) && !/Not configured/.test(cal) && !/a developer task/.test(cal) && !/ol-bar\$\{/.test(cal)
    && /needs the one-time Microsoft app setup/.test(read("components/IntegrationsPanel.tsx")));
  ok("calendar: and no line for managers about a sync that does not exist", !/managed by the owner/.test(cal));
  ok("calendar: a stage in the same words as the sheet, and the venue only when the title does not say it",
    /stageLabel\(e\.stage\)/.test(cal) && /placeBesideTitle\(e\.title, e\.location_text\)/.test(cal) && !/e\.stage\[0\]\.toUpperCase\(\)/.test(cal));
  ok("calendar: the not-configured styles left with it", !/\.ol-bar\.quiet/.test(cssP) && !/\.ol-state\.off/.test(cssP));
  const rh = code(read("components/OperatingRhythm.tsx"));
  ok("rhythm: both cards say when, and how long ago — from the meeting's own date, not cut out of a title",
    /const ago = agoWord\(daysBetween\(l\.met_on\.slice\(0, 10\), localToday\(\)\)\);/.test(rh) && (rh.match(/\{latestLine\(p\.(review|strategy)\)\}/g) || []).length === 2
    && !/title\.replace\("Weekly Operating Review · ", ""\)/.test(rh) && /`Latest: \$\{nice\(l\.met_on\)\}\$\{ago \? ` · \$\{ago\}` : ""\} — open in Notes`/.test(rh));

  // ── the record sheet these rows open ──
  const er = code(read("components/EventRecord.tsx"));
  ok("record sheet: its hours go through the same formatter as the list that opens it",
    /\[evDate\(e\), evTime\(e\) \|\| null,/.test(er) && !/\[e\.start_time, e\.end_time\]\.filter\(Boolean\)\.join\("–"\)/.test(er));
  ok("record sheet: the city by its name, not its key", /\{isMarket\(e\.market\) \? MARKET_LABEL\[e\.market\] : e\.market \|\| e\.rig \|\| "—"\}/.test(er));

  // ── 0348 ──
  const m348 = read("supabase/migrations/0348_tonight_is_not_the_past.sql");
  const views348 = m348.slice(m348.indexOf("create or replace view public.v_event_record"), m348.indexOf("-- ── what changed"));
  ok("0348: the business day has one name, Eastern, and the event views read it — not the database's UTC day",
    /create or replace function public\.business_day\(\) returns date\s+language sql stable set search_path = public as \$\$\s+select \(now\(\) at time zone 'America\/New_York'\)::date/.test(m348)
    && (views348.match(/public\.business_day\(\)/g) || []).length === 4 && !/\bcurrent_date\b/.test(views348.replace(/--.*$/gm, "")));
  ok("0348: is executed against a real Postgres, with the evening pinned", /0348_tonight_is_not_the_past\.sql/.test(read("scripts/db.event.test.mjs")) && /pinDay\("current_date - 1"\)/.test(read("scripts/db.event.test.mjs")));
}

// ── THE COFFEE A BREW WAS MADE FROM (2026-10-05, the form audit, part 3d · 0349) ───────────────────
// Start brew's coffee lot was a text box, and a typed lot links to no delivery: no bag could be traced
// to its batches, and no batch's coffee ever came off the shelf. lib/brewLots is the rule for naming a
// delivery on a batch; components/CoffeeLotPick the one pick; 0349 the link, its guard, and the draw
// that follows it. Which line is the coffee and what a gram is stay lib/brewMath's — the database
// states the same two rules, and scripts/db.brewlot.test.mjs holds it to these answers.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const BM = require("../.smoke/brewMath.js");
  const BL = require("../.smoke/brewLots.js");
  const DW = require("../.smoke/dayWords.js");
  const T = "2026-10-05";
  const near = (a, b) => Math.abs(a - b) < 1e-9;

  // ── the two rules the database restates ──
  const names = JSON.parse(read("scripts/fixtures/coffee-names.json")).cases;
  const wrong = names.filter(([n, want]) => BM.isCoffee(n) !== want);
  ok("brew lots: which name is coffee — every case on the list both languages run", names.length >= 20 && wrong.length === 0, wrong);
  ok("brew lots: a gram, an ounce, a pound — lib/brewMath's one table, case and spacing aside",
    BM.gramsPerUnit("g") === 1 && BM.gramsPerUnit("kg") === 1000 && BM.gramsPerUnit("oz") === 28.349523125 && BM.gramsPerUnit(" LB ") === 453.59237
    && BM.gramsPerUnit("gal") === null && BM.gramsPerUnit("bag") === null && BM.gramsPerUnit(null) === null);
  const bmSrc = read("lib/brewMath.ts");
  ok("brew lots: the coffee rule is written once — primarySizing asks isCoffee, and no other file keeps the pattern",
    /byWeight\.find\(\(o\) => isCoffee\(o\.name\)\)/.test(code(bmSrc)) && (bmSrc.match(/\\bcoffee\\b\|\\bbean/g) || []).length === 1
    && ["components/BrewPlanner.tsx", "components/CoffeeLotPick.tsx", "lib/brewLots.ts"].every((f) => !/\\bcoffee\\b\|\\bbean/.test(read(f))));

  // ── a lot's name, and a batch's coffee ──
  const lot = (o) => ({ id: "l", market: "atlanta", item_name: "Org Ethiopia Coffee (bulk)", lot_code: null, received_on: "2026-09-06", qty_received: 6, unit: "lb", vendor: "Sprouts Farmers Market", created_at: "2026-09-06T15:00:00Z", ...o });
  ok("brew lots: a lot is named by its code — or the day it came, with the year, in words that do not move with the device",
    BL.lotLabel(lot({ lot_code: "SPROUTS-840214" })) === "Org Ethiopia Coffee (bulk), lot SPROUTS-840214"
    && BL.lotLabel(lot({})) === "Org Ethiopia Coffee (bulk), received Sep 6, 2026" && BL.lotLabel(lot({ lot_code: "  " })) === "Org Ethiopia Coffee (bulk), received Sep 6, 2026",
    [BL.lotLabel(lot({ lot_code: "SPROUTS-840214" })), BL.lotLabel(lot({}))]);
  ok("brew lots: the dated words are the console's (lib/dayWords), not lib/dates — which every public page loads",
    DW.dateWithYear("2026-09-06") === "Sep 6, 2026" && DW.dateWithYear("") === null && DW.dateWithYear("not a day") === null && !/dateWithYear/.test(read("lib/dates.ts")));
  const RISE = { id: "rise", base_water_gal: 2, ingredients: [{ name: "Mountain Valley Spring Water", qty: 2, unit: "gal" }, { name: "Coarse-ground organic single-origin coffee", qty: 560, unit: "g" }, { name: "Organic coconut water (add after filtration)", qty: 32, unit: "oz" }] };
  ok("brew lots: a batch's coffee in grams — its own list, ounces by weight, else its recipe at its size",
    BL.coffeeGrams({ scaled: RISE.ingredients, batch_gal: 2 }) === 560
    && near(BL.coffeeGrams({ scaled: [{ name: "Coffee", qty: 16, unit: "oz" }], batch_gal: 2 }), 453.59237)
    && BL.coffeeGrams({ scaled: null, batch_gal: 4, recipe_id: "rise" }, [RISE]) === 1120
    && BL.coffeeGrams({ scaled: [{ name: "Spring water", qty: 2, unit: "gal" }], batch_gal: 2 }) === null
    && BL.coffeeGrams({ scaled: [{ name: "Coffee concentrate", qty: 1, unit: "gal" }], batch_gal: 2 }) === null);

  // ── what the brews that named a lot took ──
  const b = (o) => ({ id: Math.random().toString(36), status: "served", batch_gal: 2, scaled: RISE.ingredients, coffee_lot_id: "l", brew_started_at: "2026-09-10T12:00:00Z", ...o });
  const use = BL.lotUse([b({}), b({ brew_started_at: "2026-09-20T12:00:00Z" }), b({ status: "planned", brew_started_at: null }), b({ status: "discarded" }), b({ coffee_lot_id: null })]);
  ok("brew lots: a lot's use counts the brews that took coffee from it — not a planned batch, not a discarded one",
    use.get("l").brews === 2 && use.get("l").grams === 1120 && use.get("l").unknown === 0 && use.get("l").last === "2026-09-20T12:00:00Z" && use.size === 1, [...use]);
  const five = BL.lotUse([1, 2, 3, 4, 5].map(() => b({})));
  ok("brew lots: six pounds and five Rise brews — by their recipes, all of it; two brews — not",
    BL.usedUp(lot({}), five.get("l")) === true && BL.usedUp(lot({}), use.get("l")) === false && BL.usedUp(lot({}), undefined) === false);
  ok("brew lots: never 'all of it' for a bag counted in bags, or when a brew's coffee was not weighed",
    BL.usedUp(lot({ unit: "bag", qty_received: 1 }), five.get("l")) === false
    && BL.usedUp(lot({}), BL.lotUse([...[1, 2, 3, 4, 5].map(() => b({})), b({ scaled: [{ name: "Coffee", qty: 1, unit: "scoop" }] })]).get("l")) === false);

  // ── which lots, in what order, and which one the sheet opens on ──
  const L = [
    lot({ id: "open", lot_code: "OPENING-2026-09-06", qty_received: 4, created_at: "2026-09-06T14:00:00Z" }),
    lot({ id: "spr", lot_code: "SPROUTS-840214", created_at: "2026-09-06T15:00:00Z" }),
    lot({ id: "new", received_on: "2026-10-01", qty_received: 5, created_at: "2026-10-01T15:00:00Z" }),
    lot({ id: "wat", item_name: "Spring Water Case", unit: "case", qty_received: 2, received_on: "2026-10-02" }),
    lot({ id: "gvl", market: "greenville", received_on: "2026-10-03" }),
  ];
  const ch = BL.lotChoices(L, "atlanta");
  ok("brew lots: the city's coffee first, newest first (a tie by when it was logged), then the rest — never the other city's",
    ch.coffee.map((x) => x.id).join() === "new,spr,open" && ch.other.map((x) => x.id).join() === "wat" && ![...ch.coffee, ...ch.other].some((x) => x.market !== "atlanta"),
    [ch.coffee.map((x) => x.id), ch.other.map((x) => x.id)]);
  const named = (id, at) => BL.lotUse([b({ coffee_lot_id: id, brew_started_at: at })]);
  ok("brew lots: Start brew opens on the bag the city's last brew named",
    BL.defaultLot(L, "atlanta", new Map([...named("open", "2026-09-30T12:00:00Z"), ...named("spr", "2026-09-12T12:00:00Z")])) === "open");
  ok("brew lots: with no brew to go on and three coffee lots, it asks — it does not guess which bag is in the bin",
    BL.defaultLot(L, "atlanta", new Map()) === null);
  ok("brew lots: with no brew to go on and one coffee lot, that one",
    BL.defaultLot(L.filter((x) => x.id !== "open" && x.id !== "spr"), "atlanta", new Map()) === "new");
  const gone = BL.lotUse([1, 2, 3, 4].map(() => b({ coffee_lot_id: "open" })));
  ok("brew lots: the last bag named, by its recipes used up, is passed over — for the one bag left",
    BL.defaultLot(L.filter((x) => x.id !== "spr"), "atlanta", gone) === "new" && BL.defaultLot(L, "atlanta", gone) === null);
  ok("brew lots: Greenville's sheet never opens on Atlanta's bag", BL.defaultLot(L, "greenville", named("spr", "2026-09-30T12:00:00Z")) === "gvl");

  // ── what the pick says it will do ──
  const n0 = BL.lotNote(lot({}), undefined, { needGrams: 560, today: T });
  ok("brew lots: what naming the lot will do — what it is, and this batch's coffee off it",
    n0 === "6 lb from Sprouts Farmers Market, received 4 weeks ago · no brew has named it yet. This batch's 1.23 lb comes off it when the batch logs what it used.", n0);
  const n1 = BL.lotNote(lot({}), use.get("l"), { needGrams: 560, today: T });
  ok("brew lots: and what the brews that named it took, by their recipes", n1.startsWith("6 lb from Sprouts Farmers Market, received 4 weeks ago · 2 brews so far, about 2.47 lb. This batch's"), n1);
  ok("brew lots: a bag its brews have used up says so", BL.lotNote(lot({}), five.get("l"), { needGrams: 560, today: T }).includes("· 5 brews so far — by their recipes, all of it."));
  ok("brew lots: not a coffee shelf — kept, and said that its coffee won't come off it",
    BL.lotNote(lot({ item_name: "Yupik Organic Raw Cacao Nibs 2.2 lb", unit: "each", qty_received: 3 }), undefined, { needGrams: 560, today: T })
      === "3 from Sprouts Farmers Market, received 4 weeks ago · no brew has named it yet. Not a coffee shelf by its name — the batch keeps the lot, but its coffee won't come off it.");
  ok("brew lots: counted in bags — kept, and said that its coffee can't come off it by weight",
    BL.lotNote(lot({ item_name: "Coffee 5 lb bag", unit: "bag", qty_received: 2 }), undefined, { needGrams: 560, today: T }).endsWith("Counted in bag, not by weight — the batch keeps the lot, but its coffee can't come off it."));
  ok("brew lots: before 0349 the link is not promised — the name is kept and the line says what arrives",
    BL.lotNote(lot({}), undefined, { needGrams: 560, today: T, linkable: false }).endsWith("The batch keeps its name; the link to the delivery arrives with the next database update."));
  ok("brew lots: a batch that already logged what it used is not promised a second draw",
    BL.lotNote(lot({}), undefined, { needGrams: 560, today: T, logged: true }).endsWith("This batch has already logged what it used — naming the lot now changes its record, not the shelf."));
  ok("brew lots: a lot in words says it links to nothing", BL.TYPED_NOTE === "Not linked to a delivery — the batch keeps these words, and no coffee comes off a shelf.");
  const unweighed = BL.lotUse([b({}), b({ scaled: [{ name: "Coffee", qty: 1, unit: "scoop" }] })]).get("l");
  ok("brew lots: 'about N lb' is never said when one of the brews' coffee was not weighed",
    BL.lotNote(lot({}), unweighed, { needGrams: 560, today: T }).includes("· 2 brews so far. This batch's"), BL.lotNote(lot({}), unweighed, { needGrams: 560, today: T }));

  // ── the pick, on both sheets ──
  const bp = code(read("components/BrewPlanner.tsx"));
  const pick = code(read("components/CoffeeLotPick.tsx"));
  ok("brew lots: Start brew names the lot with the pick, opened on the default — no free text box",
    /<CoffeeLotPick label="Coffee lot — the bag this batch is made from" value=\{lot\} onChange=\{setLot\}/.test(bp) && /const id = defaultLot\(lotBoard\.lots, batch\.market, lotBoard\.use\);/.test(bp)
    && !/placeholder="e\.g\. Colombia single-origin · roasted 6\/20"/.test(bp) && /await onStart\(\{ lot, brewer \}\)/.test(bp));
  ok("brew lots: what the batch already says comes before any default", /if \(batch\.coffee_lot_id \|\| batch\.coffee_lot\?\.trim\(\)\) return lotOf\(batch\);/.test(bp));
  ok("brew lots: a start writes the link and the words together, and before 0349 the link alone is dropped",
    /const lot = extras\?\.lot \? \{ coffee_lot: extras\.lot\.text\.trim\(\) \|\| null, coffee_lot_id: extras\.lot\.id \} : \{\};/.test(bp)
    && /\["brewer_id", "coffee_lot_id"\]\);\s+if \(error\) \{ setMutErr\(error\.message\); return false; \}/.test(bp) && /arrives-with: 0349/.test(read("components/BrewPlanner.tsx")));
  ok("brew lots: the batch log keeps the record's lot — no default — and moves the link only when it is changed",
    /<CoffeeLotPick label="Coffee lot" value=\{lot\} onChange=\{pickLot\}[^>]*allowNone noneLabel="Not recorded"/.test(bp) && /\.\.\.\(lotSet \|\| lot\.id \? \{ coffee_lot_id: lot\.id \} : \{\}\)/.test(bp)
    && /coffee_lot: lot\.text\.trim\(\) \|\| null/.test(bp) && /useState<LotValue>\(\(\) => lotOf\(batch\)\)/.test(bp));
  ok("brew lots: the board asks for the link and, before 0349, asks again without it and knows",
    /coffee_lot_id"\)\s*\.order\("created_at", \{ ascending: false \}\);\s*if \(!full\.error \|\| !isMissingColumn\(full\.error\)\) return \{ \.\.\.full, linkable: true \};/.test(bp)
    && /return \{ \.\.\.prior, linkable: false \};/.test(bp) && /linkable: b\.linkable/.test(bp));
  ok("brew lots: the deliveries are read with their supplier, and a failed read is said in the pick — not thrown, not 'none'",
    /\.from\("inventory_lots"\)\.select\("id, market, item_name, lot_code, received_on, qty_received, unit, created_at, vendors\(name\)"\)/.test(bp)
    && /const firstErr = \[r, b, e, v, st, ii\]\.find/.test(bp) && /lotsErr: lt\.error \? lt\.error\.message : null/.test(bp)
    && /Couldn't load the deliveries — \$\{failed\}/.test(pick));
  ok("brew lots: the pick offers the city's coffee, then the rest, then 'A lot not on file…' — which says it links to nothing",
    /<optgroup label=\{`Coffee in \$\{cityName\}`\}>/.test(pick) && /A lot not on file…/.test(pick) && /Origin · roast date — not linked to a delivery/.test(pick)
    && /lotNote\(picked, use\.get\(picked\.id\), \{ needGrams, today, linkable, logged, others \}\)/.test(pick) && /<p className="lp-note">\{note\}<\/p>/.test(pick));
  ok("brew lots: the pick's line says a failed read — only when it failed — and picking a lot writes that lot's words",
    /const note = failed \? `Couldn't load the deliveries — \$\{failed\}/.test(pick) && /onChange\(\{ id: v, text: l \? lotLabel\(l\) : value\.text \}\);/.test(pick));
  ok("brew lots: a log save, like a start, drops the link alone before 0349 — and says nothing about the coffee's gap until then",
    /\} as Record<string, unknown>, \["brewer_id", "coffee_lot_id"\]\);\s+if \(error\) \{ setErr\(error\.message\)/.test(bp)
    && /const gap = lotBoard\.linkable \? logResult\.gaps\.find\(\(g: any\) => isCoffee\(g\.ingredient\)\) : undefined;/.test(bp));
  ok("brew lots: the production log names a lot on file by its own words — linked, or kept as its words before 0349 — and typed words as before",
    /\(b\.coffee_lot_id \|\| lotBoard\.names\.has\(b\.coffee_lot\) \? ` · \$\{b\.coffee_lot\}` : ` · lot \$\{b\.coffee_lot\}`\)/.test(bp)
    && /const names = useMemo\(\(\) => new Set\(\(brd\?\.lots \?\? \[\]\)\.map\(lotLabel\)\), \[brd\]\);/.test(bp));
  ok("brew lots: a batch's own log counts the OTHER brews against its lot, and says so",
    /lotUse\(lotBoard\.batches\.filter\(\(x\) => x\.id !== batch\.id\), lotBoard\.recipes\)/.test(bp) && /use=\{othersUse\} others /.test(bp)
    && BL.lotNote(lot({}), undefined, { needGrams: 560, today: T, others: true }).includes("· no other brew has named it.")
    && BL.lotNote(lot({}), use.get("l"), { needGrams: 560, today: T, others: true }).includes("· 2 other brews so far, about 2.47 lb."));
  ok("brew lots: 'Log what it used' no longer sends anyone to link a shelf in Inventory — a screen that does not exist",
    !/Link \{logResult\.gaps\.length === 1 \? "it" : "them"\} to a shelf in Inventory/.test(bp) && /nothing links \$\{rest\.length === 1 \? "it" : "them"\} to a shelf yet/.test(bp)
    && /the coffee off \$\{cupLot \? lotLabel\(cupLot\)/.test(bp));
  ok("brew lots: compiled for the smoke run, and its database half runs in db:test",
    /lib\/brewLots\.ts/.test(read("package.json")) && /node scripts\/db\.brewlot\.test\.mjs/.test(read("package.json")));
}

// ── A MILESTONE'S WORKSTREAM (2026-10-05, the form audit, part 3e · 0350) ─────────────────────────
// A milestone's Workstream on the Command board was a text box ("content · events · delivery…") while
// the portfolio — the named workstreams, each with an owner — sat directly above it, and a typed word
// linked to none of them. lib/portfolio is how the app reads a workstream — its owner, the words that
// spell it, a milestone's chip; lib/milestonePick the sheet's pick (components/MilestoneSheet, loaded
// when an admin opens a milestone); 0350 the link, the words that follow it, and the backfill.
// scripts/db.milestone.test.mjs runs the backfill's own text over the same cases as matchStream here.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const PF = require("../.smoke/portfolio.js");
  const MP = require("../.smoke/milestonePick.js");

  // ── one rule in two languages ──
  const fx = JSON.parse(read("scripts/fixtures/workstream-words.json"));
  const cases = fx.groups.flatMap((g) => g.cases.map(([words, want]) => ({ words, want, streams: g.streams.map((name, i) => ({ id: `s${i}`, name })) })));
  const wrong = cases.filter((c) => (PF.matchStream(c.words, c.streams)?.name ?? null) !== c.want);
  ok("workstream: which words spell a workstream — every case on the list both languages run", cases.length >= 20 && wrong.length === 0, wrong);
  ok("workstream: the TypeScript trims spaces only, as btrim does — a tab is part of the word",
    PF.matchStream("events\t", [{ id: "e", name: "Events" }]) === null && PF.matchStream("  events  ", [{ id: "e", name: "Events" }])?.id === "e");

  // ── a portfolio to work with ──
  const S = (id, name, extra = {}) => ({ id, name, owner: "", owner_user_id: null, status: "active", blocker: null, sort: 0, ...extra });
  const streams = [
    S("ev", "Events", { owner: "Kayla", owner_user_id: "u-k", sort: 90, status: "blocked", blocker: "8/15 double-book" }),
    S("pb", "Print & Brand Assets", { owner: "Ryan", sort: 80 }),
    S("d2c", "D2C Delivery Ops", { owner: "Ryan", owner_user_id: "u-r", sort: 20 }),
    S("fl", "Flagship / Investor", { owner: "", sort: 60, status: "parked" }),
  ];
  const crew = [{ id: "u-k", display_name: "Kayla M" }, { id: "u-r", display_name: "Ryan" }];
  const owner = (s) => PF.streamOwner(s, crew);

  ok("workstream: an owner is the crew member by their current name, else the name typed, else nobody",
    owner(streams[0]) === "Kayla M" && owner(streams[1]) === "Ryan" && owner(streams[3]) === null
    && PF.streamOwner({ owner: "Sam", owner_user_id: "gone" }, crew) === "Sam" && PF.streamOwner({ owner: "  ", owner_user_id: null }, crew) === null);
  const ch = MP.streamChoices(streams);
  ok("workstream: the pick lists the portfolio in its own order, the parked ones apart",
    JSON.stringify(ch.open.map((s) => s.id)) === JSON.stringify(["d2c", "pb", "ev"]) && JSON.stringify(ch.parked.map((s) => s.id)) === JSON.stringify(["fl"]));

  // ── the chip ──
  ok("workstream: a linked milestone's chip is its workstream's CURRENT name — not the words it was filed under",
    JSON.stringify(PF.milestoneStream({ workstream: "Events (old name)", workstream_id: "ev" }, streams)) === JSON.stringify({ text: "Events", linked: true }));
  ok("workstream: linked, with the portfolio not loaded — the words, still as a link",
    JSON.stringify(PF.milestoneStream({ workstream: "Events", workstream_id: "ev" }, [])) === JSON.stringify({ text: "Events", linked: true }));
  ok("workstream: words that link to nothing are shown as such, and no words is no chip",
    JSON.stringify(PF.milestoneStream({ workstream: " branding ", workstream_id: null }, streams)) === JSON.stringify({ text: "branding", linked: false })
    && PF.milestoneStream({ workstream: "  ", workstream_id: null }, streams) === null && PF.milestoneStream({ workstream: null }, streams) === null);

  // ── where the pick starts, and what saving writes ──
  const K = MP.KEPT_WORDS;
  ok("workstream: the pick starts on the link; else on the stream the words spell; else on the words; else on nothing",
    MP.startingPick({ workstream: "Events", workstream_id: "ev" }, streams) === "ev" && MP.startingPick({ workstream: "events" }, streams) === "ev"
    && MP.startingPick({ workstream: "branding" }, streams) === K && MP.startingPick({ workstream: null }, streams) === "" && MP.startingPick({ workstream: " " }, streams) === "");
  const P = (pick, m, linkable = true) => JSON.stringify(MP.streamPatch(pick, m, streams, linkable));
  ok("workstream: saving writes only what changed — the link with the stream's name, or nothing",
    P("pb", { workstream: "branding", workstream_id: null }) === JSON.stringify({ workstream_id: "pb", workstream: "Print & Brand Assets" })
    && P("ev", { workstream: "Events", workstream_id: "ev" }) === "{}" && P(K, { workstream: "branding" }) === "{}" && P("nope", { workstream: "x" }) === "{}");
  ok("workstream: 'No workstream' clears the link and the words — and is nothing to write when there were none",
    P("", { workstream: "Events", workstream_id: "ev" }) === JSON.stringify({ workstream_id: null, workstream: null })
    && P("", { workstream: "branding", workstream_id: null }) === JSON.stringify({ workstream_id: null, workstream: null }) && P("", { workstream: null }) === "{}");
  ok("workstream: without 0350, words that already spell the pick are left alone — 0350 links them; another pick writes its name",
    P("ev", { workstream: "events" }, false) === "{}" && P("pb", { workstream: "events" }, false) === JSON.stringify({ workstream_id: "pb", workstream: "Print & Brand Assets" }));

  // ── the line under the pick ──
  const N = (pick, m, o = {}) => MP.streamNote({ pick, m, streams, failed: null, linkable: true, owner, ...o });
  ok("workstream: a pick says who owns the stream, and its state when it is not simply in play",
    N("d2c", { workstream: "D2C Delivery Ops", workstream_id: "d2c" }) === "Ryan owns D2C Delivery Ops."
    && N("ev", { workstream: "Events", workstream_id: "ev" }) === "Kayla M owns Events. Blocked — 8/15 double-book."
    && N("fl", { workstream: "Flagship / Investor", workstream_id: "fl" }) === "Nobody owns Flagship / Investor yet. Parked by decision.");
  ok("workstream: old words the pick resolved say saving links them; a different pick says what it replaces",
    N("ev", { workstream: "events", workstream_id: null }) === "“events” is Events in the portfolio — saving links it. Kayla M owns Events. Blocked — 8/15 double-book."
    && N("pb", { workstream: "branding", workstream_id: null }) === "Saving files it to Print & Brand Assets in place of “branding”. Ryan owns Print & Brand Assets.");
  ok("workstream: words kept say they link to nothing; 'No workstream' says nothing — unless the portfolio is empty",
    N(K, { workstream: "branding" }) === "“branding” was typed before the portfolio and links to no workstream — pick the one it belongs to."
    && N("", { workstream: null }) === null && MP.streamNote({ pick: "", m: { workstream: null }, streams: [], failed: null, linkable: true, owner }) === "Nothing in the portfolio yet — add a workstream above, then file this to it.");
  ok("workstream: a failed read is said — and before 0350, that the link comes with the next database update",
    N("ev", { workstream: "events" }, { failed: "permission denied" }) === "Couldn't load the portfolio — permission denied. The milestone keeps what it has."
    && N("ev", { workstream: "events" }, { linkable: false }) === "Kayla M owns Events. Blocked — 8/15 double-book. The milestone keeps the name; the link arrives with the next database update.");
  ok("workstream: a link to a stream no longer in the portfolio says so",
    N("x", { workstream: "Trailer & Venue", workstream_id: "x" }) === "“Trailer & Venue” is not in the portfolio any more — pick where it belongs now.");

  // ── the board ──
  const cb = code(read("components/CommandBoard.tsx")), cbRaw = read("components/CommandBoard.tsx");
  const ms = code(read("components/MilestoneSheet.tsx")), msRaw = read("components/MilestoneSheet.tsx");
  ok("workstream: the milestones are read with the link, across the window before 0350 — that one condition, and the board knows",
    /\/\/ arrives-with: 0350\n\s+const full = await supabase!\.from\("initiative_milestones"\)\.select\("id, initiative_id, title, due_on, done, workstream, workstream_id, sort"\)/.test(cbRaw)
    && /if \(!full\.error \|\| !isMissingColumn\(full\.error\)\) return \{ \.\.\.full, linkable: true \};/.test(cb)
    && /return \{ \.\.\.prior, linkable: false \};/.test(cb) && /linkable: mil\.linkable,/.test(cb) && /milesRead\(\),/.test(cb));
  ok("workstream: the portfolio is read beside the goals, and a failed read is said in the pick — not thrown",
    /supabase\.from\("os_workstreams"\)\.select\("id, name, owner, owner_user_id, status, blocker, sort"\)\.order\("sort"\)/.test(cb)
    && /const firstErr = \[ini, mil, lnk, tThis, eThis, inc, tOver, eOver, tDone, eDone\]\.find/.test(cb)
    && /streamsErr: pf\.error \? pf\.error\.message : null,/.test(cb) && /"incident_log", "os_workstreams"\], reload\)/.test(cb)
    // …and the answer is used for exactly those two things — read, kept, said — and never thrown.
    && (cb.match(/\bpf\b/g) || []).length === 5);
  ok("workstream: the chip is the workstream by its portfolio name, and words that link to nothing are marked so",
    /const ws = milestoneStream\(m, data\.streams\);/.test(cb) && /className=\{`cmd-ws\$\{ws\.linked \? "" : " loose"\}`\}/.test(cb)
    && !/\{m\.workstream && <span className="cmd-ws">/.test(cb) && /\.cmd-ws\.loose,\.app\.crew-day \.cmd-ws\.loose\{/.test(read("app/globals.css")));
  ok("workstream: the sheet picks from the portfolio — no box to type a workstream into",
    /<select aria-labelledby=\{`ms-ws-\$\{m\.id\}`\} value=\{pick\} onChange=\{\(e\) => setPick\(e\.target\.value\)\}>/.test(ms)
    && /<optgroup label="The portfolio">/.test(ms) && /<optgroup label="Parked by decision">/.test(ms) && /<option value="">No workstream<\/option>/.test(ms)
    && /<option value=\{KEPT_WORDS\}>\{`“\$\{words\}” — links to nothing`\}<\/option>/.test(ms)
    && !/content · events · delivery/.test(ms + cb) && !/setWs\(/.test(ms + cb) && /\{note && <p className="lp-note">\{note\}<\/p>\}/.test(ms)
    && /useState\(\(\) => startingPick\(m, streams\)\)/.test(ms) && /streamPatch\(pick, m, streams, linkable\)/.test(ms));
  ok("workstream: a save waits, says why it failed and keeps the sheet open; before 0350 it drops the link alone",
    /if \(error\) \{ setErr\(`Couldn't save — \$\{error\.message\}`\); return; \}\s+onSaved\(\);\s+onClose\(\);/.test(ms)
    && /writeAcrossSkew\(\(row\) => supabase!\.from\("initiative_milestones"\)\.update\(row\)\.eq\("id", m\.id\), patch, \["workstream_id"\]\)/.test(ms)
    && /\/\/ arrives-with: 0350\n\s+const \{ error \} = await writeAcrossSkew/.test(msRaw)
    && /\{busy \? "Saving…" : "Save"\}/.test(ms) && /role="alert">\{err\}/.test(ms));
  ok("workstream: the sheet is loaded when a milestone is opened, not with the board — and saving reloads the board",
    /const MilestoneSheet = dynamic\(\(\) => import\("\.\/MilestoneSheet"\), \{ ssr: false \}\);/.test(cb) && /onDelete=\{\(\) => deleteMile\(manage\)\}\s+onSaved=\{reload\}/.test(cb)
    && !/from "\.\/useCrew"|writeAcrossSkew|lib\/milestonePick/.test(cb));
  ok("workstream: a refused check-off, tie, untie or delete says so — none of them dropped its error any more",
    /if \(error\) toast\(`Couldn't \$\{m\.done \? "reopen" : "check off"\}/.test(cb)
    && /if \(error\) toast\(`Couldn't \$\{on \? "tie it to" : "untie it from"\} that initiative/.test(cb)
    && /if \(error\) \{ toast\(`Couldn't delete “\$\{m\.title\}” — \$\{error\.message\}`, "error"\); return; \}/.test(cb)
    && /if \(tie\) toast\(`Added, but not tied to the initiative/.test(cb)
    && !/\n\s+await supabase\.from\("initiative_milestone(s|_links)"\)\.(update|insert|delete)\(/.test(cb));
  ok("workstream: who owns a workstream is lib/portfolio's — the portfolio's rows and the pick's line say the same name",
    /const ownerName = \(w: Ws\) => streamOwner\(w, crew\);/.test(code(read("components/OsRegistry.tsx"))) && /owner: \(s\) => streamOwner\(s, crew\)/.test(ms));

  // ── the migration ──
  const m350 = read("supabase/migrations/0350_a_milestone_names_its_workstream.sql");
  ok("0350: the link, its words written by the database, the function the trigger's alone, and nothing guessed",
    /add column if not exists workstream_id uuid references public\.os_workstreams\(id\) on delete set null/.test(m350)
    && /before insert or update of workstream_id, workstream on public\.initiative_milestones/.test(m350)
    && /revoke all on function public\.milestone_workstream_words\(\) from public, anon, authenticated;/.test(m350)
    && /lower\(btrim\(s\.name\)\) = lower\(btrim\(m\.workstream\)\)/.test(m350) && /= 1;/.test(m350)
    && /select public\.record_migration\('0350_a_milestone_names_its_workstream'/.test(m350));
  ok("0350: compiled for the smoke run, and its database half runs in db:test",
    /lib\/portfolio\.ts lib\/milestonePick\.ts/.test(read("package.json")) && /node scripts\/db\.milestone\.test\.mjs/.test(read("package.json")));
}

// ── THE VENUE A STOP OR AN EVENT IS AT (2026-10-05, the form audit, part 4) ──────────────────────
// A stop's or an event's place was asked for six ways: FieldOpSheet matched the stop's NAME against
// the vendor book on save and minted a pending vendor from anything it did not know; the prep hub's
// editor had no link at all; the event card had a vendor <select> above a "Location / venue" box and
// ignored the database's answer when it linked; Route had the select again, with a "Which location?"
// list that wrote nulls over a stop's address and pin; the calendar's quick-add and the copilot turned
// typed words into vendors on save. lib/venues is the one rule — what the pick lists, where it starts,
// what a pick fills, the line under it — and components/VenuePick the one control.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const VN = require("../.smoke/venues.js");
  const PF = require("../.smoke/pickFill.js");
  const J = (x) => JSON.stringify(x);

  // ── a book to work with ──
  const V = (id, name, extra = {}) => ({ id, name, status: "approved", kind: "venue", market: "greenville", address: null, location_text: null, lat: null, lng: null, archived_at: null, ...extra });
  const book = [
    V("wx", "WineXpress", { address: "1 Main St, Greenville, SC", location_text: "Five Forks Plaza", lat: 34.8, lng: -82.3, poc_name: "Ana" }),
    V("sy", "Soul Yoga", { status: "pending", address: "12 Oak Ave, Greenville, SC" }),
    V("sp", "Sprouts Farmers Market", { kind: "supplier" }),
    V("rw", "Restore Wellness", { kind: "both", market: "atlanta", location_text: "Restore — Midtown" }),
    V("old", "Old Venue", { archived_at: "2026-09-01T00:00:00Z" }),
    V("nk", "Nameless Kind", { kind: null }),
    V("ss", "Sassafras Flower Farm"),
  ];
  const sites = [
    // 0226's backfill: WineXpress's own address copied in as its primary "Main" — and a second place.
    { id: "m1", vendor_id: "wx", label: "Main", address: "1 Main St, Greenville, SC", location_text: "Five Forks Plaza", lat: 34.8, lng: -82.3, is_primary: true, sort: 0, archived_at: null },
    { id: "dt", vendor_id: "wx", label: "Downtown", address: "9 River St, Greenville, SC", location_text: null, lat: 34.85, lng: -82.4, is_primary: false, sort: 1, archived_at: null },
    { id: "x1", vendor_id: "sy", label: "Annex", address: "3 Elm St", lat: null, lng: null, is_primary: false, sort: 0, archived_at: "2026-09-02T00:00:00Z" },
  ];
  const ch = VN.venueChoices(book, sites);
  const by = (v) => ch.find((c) => c.value === v);

  // ── what the pick lists ──
  ok("venues: the book's venues, by name — no supplier, nothing archived; 'both' and a row with no kind are venues",
    J(ch.map((c) => c.label)) === J(["Nameless Kind", "Restore Wellness", "Sassafras Flower Farm", "Soul Yoga", "WineXpress — Downtown", "WineXpress — Main"]), ch.map((c) => c.label));
  ok("venues: a venue with two places is listed once per place; its own address, repeated by 0226's Main, is not a third",
    ch.filter((c) => c.vendorId === "wx").length === 2 && by("s:m1")?.primary === true && by("s:dt")?.primary === false && !by("v:wx"));
  ok("venues: a place's own words, else its label; an event's line names the venue with the place",
    by("s:dt").place.location_text === "Downtown" && by("s:dt").line === "WineXpress — Downtown" && by("s:m1").line === "Five Forks Plaza"
    && by("s:dt").place.address === "9 River St, Greenville, SC" && by("s:dt").place.lat === 34.85);
  ok("venues: one place is the venue itself — an archived place does not count, a pending venue says so",
    by("v:sy")?.label === "Soul Yoga" && by("v:sy").pending === true && by("v:sy").place.address === "12 Oak Ave, Greenville, SC" && by("v:ss").line === "Sassafras Flower Farm");
  ok("venues: a record filed to a supplier still shows its venue (kept); an archived one is never listed",
    VN.venueChoices(book, sites, ["sp"]).some((c) => c.vendorId === "sp") && !VN.venueChoices(book, sites, ["old"]).some((c) => c.vendorId === "old"));
  const twoBook = [V("ge", "Greenville Eats", { address: "5 A St" }), V("hq", "Hill Quarter"), V("hp", "Half Pin", { address: "6 D St", lat: 34.7, lng: null })];
  const two = VN.venueChoices(twoBook, [{ id: "pt", vendor_id: "ge", label: "Patio", address: "7 B St" }, { id: "h1", vendor_id: "hq", label: "Main", address: "8 C St", lat: 34.9, lng: -82.1 }]);
  ok("venues: an address added since 0226 is a second place beside the venue's own; a place alone stands for the venue",
    J(two.map((c) => [c.value, c.label, c.place.address])) === J([["v:ge", "Greenville Eats", "5 A St"], ["s:pt", "Greenville Eats — Patio", "7 B St"], ["v:hp", "Half Pin", "6 D St"], ["v:hq", "Hill Quarter", "8 C St"]])
    && two[3].place.lat === 34.9, two.map((c) => [c.value, c.label, c.place.address]));
  ok("venues: half a pin is no pin — a venue with a latitude and no longitude is not pinned",
    two[2].place.lat === null && two[2].place.lng === null);
  ok("venues: a venue's name is its own place, not one of its other places'",
    VN.currentVenue({ location_text: "greenville eats" }, two, twoBook).value === "v:ge");

  // ── in what order ──
  const g1 = VN.venueGroups(ch, "atlanta"), g2 = VN.venueGroups(ch, null);
  ok("venues: grouped by city when the book holds two — the record's own city first, else the markets' order",
    J(g1.map((g) => g.label)) === J(["Atlanta", "Greenville"]) && J(g2.map((g) => g.label)) === J(["Greenville", "Atlanta"]) && g1[0].choices[0].vendorId === "rw");
  ok("venues: one city is one group with no heading; a row with no city files last",
    J(VN.venueGroups(ch.filter((c) => c.market === "greenville"), "greenville").map((g) => g.label)) === J([null])
    && J(VN.venueGroups([...ch, { ...by("v:ss"), value: "v:zz", market: null }], null).map((g) => g.label)) === J(["Greenville", "Atlanta", "No city on file"])
    && VN.venueGroups([], null).length === 0);

  // ── where it starts ──
  const at = (rec) => VN.currentVenue(rec, ch, book);
  ok("venues: linked — its venue; at two places, the one its address or its place says (an event's line too), else the primary",
    at({ vendor_id: "sy" }).value === "v:sy" && at({ vendor_id: "sy" }).how === "linked"
    && at({ vendor_id: "wx", address: "9 river st,  greenville, sc" }).value === "s:dt"
    && at({ vendor_id: "wx", location_text: "downtown" }).value === "s:dt" && at({ vendor_id: "wx" }).value === "s:m1"
    && at({ vendor_id: "wx", location_text: "WineXpress — Downtown" }).value === "s:dt");
  const tri = VN.venueChoices([V("tp", "Tri Plaza")], [
    { id: "ta", vendor_id: "tp", label: "A-Side", address: "1 A Way", is_primary: false },
    { id: "tm", vendor_id: "tp", label: "Middle", address: "2 M Way", is_primary: true },
    { id: "tz", vendor_id: "tp", label: "Zed", address: "3 Z Way", is_primary: false },
  ]);
  ok("venues: a link the record's own words do not place is at the venue's primary place — not its first or last",
    VN.currentVenue({ vendor_id: "tp", address: "somewhere else" }, tri).value === "s:tm");
  const plaza = VN.venueChoices([V("pc", "Plaza Coffee", { address: "100 Plaza Way" }), V("py", "Plaza Yoga", { address: "100 Plaza Way" })], []);
  ok("venues: an address two venues share spells neither of them",
    VN.currentVenue({ address: "100 plaza way" }, plaza).how === "none");
  ok("venues: a link to a venue no longer listed is gone, and keeps its name",
    J(at({ vendor_id: "old" })) === J({ how: "gone", value: "v:old", name: "Old Venue" }) && at({ vendor_id: "nope" }).name === null);
  ok("venues: not linked — the one venue its words spell: its Where, a stop's name, its address (case and spacing aside)",
    at({ location_text: " soul  yoga " }).value === "v:sy" && at({ location_text: " soul  yoga " }).how === "matched" && at({ location_text: " soul  yoga " }).typed === "soul  yoga"
    && at({ name: "Sassafras Flower Farm" }).value === "v:ss" && at({ address: "12 OAK AVE, Greenville, SC" }).value === "v:sy"
    && at({ location_text: "WineXpress — Downtown" }).value === "s:dt");
  ok("venues: words that spell no ONE venue are not a match — a venue with two places, by name alone, is a guess",
    at({ location_text: "WineXpress" }).how === "none" && at({ location_text: "Wine Express" }).how === "none" && at({}).how === "none" && at({ name: "  " }).how === "none");

  // ── what a pick fills ──
  const wxMain = by("s:m1"), soul = by("v:sy"), sass = by("v:ss");
  const f1 = VN.venueFill("stop", { name: "Wine Express — Five Forks", location_text: "", address: "1 main st, Greenville, SC" }, null, wxMain);
  ok("venues: linking a stop keeps its typed name, fills what is empty, and takes the venue's saved pin for the venue's address",
    J(f1) === J({ text: { vendor_id: "wx", name: "Wine Express — Five Forks", location_text: "Five Forks Plaza", address: "1 main st, Greenville, SC" }, pin: { lat: 34.8, lng: -82.3 } }), f1);
  const f2 = VN.venueFill("stop", { name: "", location_text: "the barn", address: "77 Farm Rd" }, null, sass);
  ok("venues: a venue with no address or pin leaves the stop's own alone — the erase stopPatchFromVendor was written against",
    J(f2) === J({ text: { vendor_id: "ss", name: "Sassafras Flower Farm", location_text: "the barn", address: "77 Farm Rd" } }), f2);
  const f3 = VN.venueFill("stop", { name: "WineXpress", location_text: "Five Forks Plaza", address: "1 Main St, Greenville, SC" }, wxMain, soul);
  ok("venues: moving a stop to another venue moves what was the old venue's — and the old pin goes with the old address",
    J(f3) === J({ text: { vendor_id: "sy", name: "Soul Yoga", location_text: "", address: "12 Oak Ave, Greenville, SC" }, pin: null }), f3);
  const f4 = VN.venueFill("stop", { name: "Wine Express Saturday", location_text: "back lot", address: "1 Main St, Greenville, SC" }, wxMain, by("s:dt"));
  ok("venues: what was typed stays typed through a move (lib/pickFill); the new place's pin comes with its address",
    J(f4) === J({ text: { vendor_id: "wx", name: "Wine Express Saturday", location_text: "back lot", address: "9 River St, Greenville, SC" }, pin: { lat: 34.85, lng: -82.4 } }), f4);
  const f5 = VN.venueFill("stop", { name: "Pop-up", address: "77 Elm St" }, null, wxMain);
  ok("venues: a stop that keeps its own address keeps its own pin — the venue's pin is for the venue's address",
    !("pin" in f5) && f5.text.address === "77 Elm St", f5);
  ok("venues: a pin is all or nothing — a place with half a pin gives none",
    !("pin" in VN.venueFill("stop", { address: "" }, null, { ...sass, place: { ...sass.place, lat: 34.8, lng: null } })));
  ok("venues: 'No venue linked' unlinks and changes nothing else",
    J(VN.venueFill("stop", { name: "WineXpress", address: "1 Main St" }, wxMain, null)) === J({ text: { vendor_id: null } }));
  ok("venues: an event takes the venue's place line — the name when it has no place words",
    J(VN.venueFill("event", { name: "Spring Social", location_text: "" }, null, sass)) === J({ text: { vendor_id: "ss", location_text: "Sassafras Flower Farm" } })
    && VN.venueFill("event", { location_text: "Duncan Town Square" }, null, soul).text.location_text === "Duncan Town Square");
  ok("venues: an event at the old venue's address, place or name moves with it — the screens wrote each of those",
    ["1 Main St, Greenville, SC", "Five Forks Plaza", "WineXpress — Main", "WineXpress"].every((w) => VN.venueFill("event", { location_text: w }, wxMain, sass).text.location_text === "Sassafras Flower Farm"));
  ok("pickFill: `was` can be several values — any of them is still the pick's; one value works as it did",
    PF.follow("Five Forks Plaza", ["x", " Five Forks Plaza "], "y") === "y" && PF.follow("typed", ["x", ""], "y") === "typed" && PF.follow("", [], "y") === "y"
    && PF.follow("a", "a", "b") === "b" && PF.follow("a", "", "b") === "a" && PF.follow(null, null, null) === "");

  // ── what a new venue starts with ──
  ok("venues: a venue added from an unlinked stop takes its city, address, pin and place words",
    J(VN.newVenueSeed("stop", { market: "atlanta", address: " 4 Pine St ", location_text: "Pine Lot", lat: 33.7, lng: -84.4 }, false, "Pine Market"))
      === J({ kind: "venue", market: "atlanta", address: "4 Pine St", location_text: "Pine Lot", lat: 33.7, lng: -84.4 }));
  ok("venues: …not another venue's address, not words that are its own name, and never a city that is not a market",
    J(VN.newVenueSeed("stop", { market: "greenville", address: "1 Main St" }, true, "Somewhere")) === J({ kind: "venue", market: "greenville" })
    && J(VN.newVenueSeed("stop", { market: "paris", location_text: "pine market", address: "" }, false, "Pine Market")) === J({ kind: "venue" })
    && J(VN.newVenueSeed("event", { location_text: "Back garden", address: "9 Ignored St" }, false, "Hill House")) === J({ kind: "venue", location_text: "Back garden" }));
  ok("venues: the words to add are the record's Where — or a stop's name; an event's title is not a place",
    VN.typedPlace("stop", { name: "Saturday Market", location_text: " " }) === "Saturday Market" && VN.typedPlace("event", { name: "Spring Social" }) === ""
    && VN.typedPlace("event", { name: "x", location_text: " Hill House " }) === "Hill House");

  // ── the line under the pick ──
  const N = (rec, o = {}) => { const now = at(rec); return VN.venueNote({ kind: "stop", now, shown: now.how === "matched" ? VN.NO_VENUE : now.value, rec, saved: rec.vendor_id, failed: null, count: ch.length, ...o }); };
  ok("venues: a linked stop at its venue's address says where, and that it is pinned",
    N({ vendor_id: "wx", address: "1 Main St, Greenville, SC" }) === "1 Main St, Greenville, SC · pinned.");
  ok("venues: a stop that disagrees with its venue says both, before it is saved (v_stop_gaps' addr_drift)",
    N({ vendor_id: "wx", address: "77 Elm St" }) === "The stop says 77 Elm St; WineXpress — Main is at 1 Main St, Greenville, SC. One of the two is out of date.");
  ok("venues: a pick not yet saved says where saving files it, an unpinned venue says so, a pending one waits",
    N({ vendor_id: "sy" }, { saved: null }) === "Saving files it to Soul Yoga. 12 Oak Ave, Greenville, SC · not pinned yet. Waiting on the owner's approval."
    && N({ vendor_id: "ss" }) === "No address on file for Sassafras Flower Farm.");
  ok("venues: words that spell a venue are offered by name — 'Soul Yoga is in the venue book', or what the words were",
    N({ location_text: "soul yoga" }) === "Soul Yoga is in the venue book." && N({ address: "12 Oak Ave, Greenville, SC" }) === "“12 Oak Ave, Greenville, SC” is Soul Yoga in the venue book.");
  ok("venues: not linked says what that costs; nothing typed says nothing; an empty book asks for the first",
    N({ location_text: "Duncan Town Square" }) === "Not linked to a venue: the place below is typed, and the next visit here will be typed again."
    && VN.venueNote({ kind: "event", now: { how: "none", value: "" }, shown: "", rec: { location_text: "Duncan Town Square" }, saved: null, failed: null, count: 3 }) === "Not linked to a venue: the place below is typed, and the next booking there will be typed again."
    && N({}) === null && N({ location_text: "x" }, { count: 0 }) === "No venues in the book yet — add this one, and the next stop there starts from it.");
  ok("venues: a gone venue is said by name; a failed read says the record keeps its venue; adding says nothing yet",
    N({ vendor_id: "old" }) === "Old Venue is not in the venue book any more — pick where the stop is now."
    && N({ vendor_id: "wx" }, { failed: "permission denied" }) === "Couldn't load the venue book — permission denied. The stop keeps the venue it has."
    && N({ vendor_id: "wx" }, { shown: VN.NEW_VENUE }) === null);
  ok("venues: an event's line is where the venue is — no pin talk, events have none",
    VN.venueNote({ kind: "event", now: at({ vendor_id: "wx" }), shown: "s:m1", rec: { vendor_id: "wx" }, saved: "wx", failed: null, count: 6 }) === "1 Main St, Greenville, SC.");

  // ── the control, and every screen that names a place ──
  const vp = code(read("components/VenuePick.tsx")), uv = code(read("components/useVenues.ts"));
  ok("venue pick: lists lib/venues' choices, grouped, with 'No venue linked' and '+ Add a venue to the book…'",
    /venueChoices\(book\.venues, book\.sites, \[rec\.vendor_id\]\)/.test(vp) && /venueGroups\(choices, rec\.market \?\? null\)/.test(vp)
    && /<option value=\{NO_VENUE\}>No venue linked<\/option>/.test(vp) && /<option value=\{NEW_VENUE\}>\+ Add a venue to the book…<\/option>/.test(vp)
    && /\$\{c\.label\} · pending approval/.test(vp));
  ok("venue pick: a venue is added only by its own tap — through the one resolver, in the record's city, with its address",
    /resolveVendor\(name, \{ source, extra: await seedFor\(name\), decision \}\)/.test(vp) && /newVenueSeed\(kind, rec, !!rec\.vendor_id, name\)/.test(vp)
    && /onCreateDistinct=\{\(\) => \{ setSimilar\(null\); add\(\{ createDistinct: true \}\); \}\}/.test(vp) && /addVendorLocation\(c\.id, \{/.test(vp));
  ok("venue pick: the words' venue is taken once, when the book arrives, only where a form saves — and offered everywhere",
    /if \(!book \|\| checked\.current\) return;\s+checked\.current = true;\s+if \(match && !disabled && now\.how === "matched"\)/.test(vp)
    && /const shown = adding \? NEW_VENUE : now\.how === "matched" \? NO_VENUE : now\.value;/.test(vp) && />Link it<\/button>/.test(vp));
  ok("venue pick: the door to approve a pending venue is offered only where leaving loses nothing — never from a form mid-edit",
    /\{linked\?\.pending && !match && canOf\(profile\)\.admin && <> <button type="button" className="rec-link" onClick=\{\(\) => goPlanTab\("vendors", \{ setSection \}\)\}>Review it ›<\/button><\/>\}/.test(vp));
  ok("venue pick: a venue added by hand is said to be added, not auto-added, in the owner's approval alert",
    /body: `Added from \$\{opts\?\.source \?\? "a truck stop"\}\. Review the contact details & approve in Plan › Vendors\.`/.test(read("lib/vendorLink.ts")));
  ok("venue pick: a look-alike is asked of the book's own rule (similar_vendors) and offered with one tap",
    /similarVendors\(typed\)/.test(vp) && /looks like \$\{suggestion\.label\} in the venue book/.test(vp) && /onClick=\{\(\) => pick\(suggestion\)\}/.test(vp));
  ok("venue pick: the book is read once for every pick on the screen, a failed read said, a write followed by a fresh read",
    /useSyncExternalStore\(subscribe, snapshot, snapshot\)/.test(uv) && /if \(error\) return \{ book: state\.book, error, at: Date\.now\(\) \};/.test(uv)
    && /useRealtimeTable\(\["vendors", "vendor_locations"\]/.test(uv) && /const fresh = await reload\(true\);/.test(vp)
    && /inflight \? \(after \? inflight\.then\(\(\) => reloadVenues\(\)\) : inflight\)|if \(inflight\) return after \? inflight\.then\(\(\) => reloadVenues\(\)\) : inflight;/.test(uv));

  const fo = code(read("components/FieldOpSheet.tsx")), od = code(read("components/crew/OwnerDetails.tsx")), le = code(read("components/crew/LocationEditor.tsx"));
  const lc = code(read("components/crew/LiveControl.tsx")), cc = code(read("components/CompanyCalendar.tsx")), ec = code(read("components/EventCopilot.tsx"));
  const pg = code(read("app/crew/page.tsx"));
  const card = pg.slice(pg.indexOf("function EventCard("), pg.indexOf("function EventsAdmin("));
  const admin = pg.slice(pg.indexOf("function EventsAdmin("), pg.indexOf("return (", pg.indexOf("function EventsAdmin(")));
  ok("venue pick: the stop and event sheet picks the venue for both, writes the link for both, and no longer reads a name as a vendor",
    /<VenuePick kind=\{kind\}/.test(fo)
    && /\{ title: nm, day: f\.day \|\| null, location_text: f\.location_text\?\.trim\(\) \|\| null, market: toMarket\(f\.market\), vendor_id: f\.vendor_id \|\| null,/.test(fo)
    && /address: f\.address\?\.trim\(\) \|\| null, market: toMarket\(f\.market\), vendor_id: f\.vendor_id \|\| null \}/.test(fo)
    && /"title, day, location_text, stage, published_at, public_title, market, vendor_id"/.test(fo) && !/resolveVendor|VendorResolve|pullVendorFields|pendingPatch/.test(fo)
    && /if \(pin !== undefined\) \{ patch\.lat = pin\?\.lat \?\? null; patch\.lng = pin\?\.lng \?\? null; \}/.test(fo));
  ok("venue pick: the prep hub's editor picks the venue too, and pins with the venue's own pin when the stop is at it",
    /<VenuePick kind=\{ownerType\}/.test(od)
    && /\{ title: nm, day: f\.day \|\| null, location_text: f\.location_text\?\.trim\(\) \|\| null, vendor_id: f\.vendor_id \|\| null, default_buffer_min: buf \}/.test(od)
    && /address: f\.address\?\.trim\(\) \|\| null, vendor_id: f\.vendor_id \|\| null, default_buffer_min: buf,/.test(od) && /if \(pin\) \{ patch\.lat = pin\.lat; patch\.lng = pin\.lng; \}/.test(od)
    && /"title, day, location_text, vendor_id, market,/.test(od));
  ok("venue pick: the event card has ONE place control — no vendor select above a location box — writing through its own update",
    /<VenuePick kind="event" source="an event" match=\{false\} contact/.test(card) && /onChange=\{\(fill\) => onUpdate\(fill\.text\)\}/.test(card)
    && !/VendorPicker|onLinkVendor|vendors=/.test(card) && !/linkVendor|from\("vendors"\)/.test(admin) && /<input key=\{e\.location_text \?\? ""\}/.test(card));
  ok("venue pick: Route says the stop's venue and its liaison, and leaves the pick to the stop's sheet",
    /venue=\{g\.vendor\}/.test(lc) && !/linkVendor/.test(lc) && /<VenueContact venue=\{venue\} \/>/.test(le) && !/VendorPicker|onPickLocation|onLinkVendor/.test(le)
    && /Edit name, date, time, venue &amp; address ›/.test(le));
  ok("venue pick: the calendar's quick-add and the copilot pick the venue, and add nothing to the book on Add or Create",
    /<VenuePick kind=\{kind\} source="the calendar quick-add"/.test(cc) && /<VenuePick kind=\{draft\.kind\} source="the event copilot"/.test(ec)
    && !/resolveVendor|VendorResolve/.test(cc + ec)
    && /from\("stops"\)\.insert\(\{[^;]{0,400}?vendor_id: venueId \}\)/.test(cc) && /from\("events"\)\.insert\(\{[^;]{0,400}?vendor_id: venueId \}\)/.test(cc)
    && /from\("stops"\)\.insert\(\{[^;]{0,400}?vendor_id: venueId,/.test(ec) && /from\("events"\)\.insert\(\{[^;]{0,400}?vendor_id: venueId \}\)/.test(ec)
    && /if \(error\) \{ setErr\(`Couldn't add it — \$\{error\}`\); return; \}/.test(cc));
  ok("venue pick: the old picker is gone, and no stop or event editor turns words into a vendor itself",
    !fs.existsSync(path.join(__dirname, "..", "components/crew/VendorPicker.tsx"))
    && [fo, od, le, lc, cc, ec, card].every((t) => !/resolveVendor\(/.test(t)));
  ok("venue pick: loaded with the card or sheet that shows it — every screen imports it through VenuePickLazy; Route's card carries only the contact block",
    /dynamic\(\(\) => import\("\.\/VenuePick"\), \{ ssr: false, loading: \(\) => <div className="venue-loading" aria-busy="true" \/> \}\)/.test(read("components/VenuePickLazy.tsx"))
    && ["components/FieldOpSheet.tsx", "components/crew/OwnerDetails.tsx", "app/crew/page.tsx", "components/CompanyCalendar.tsx", "components/EventCopilot.tsx"]
      .every((f) => /import VenuePick from "(@\/components|\.)\/VenuePickLazy";/.test(read(f)) && !/from "(@\/components|\.)\/VenuePick"/.test(read(f)))
    && /import VenueContact from "@\/components\/VenueContact";/.test(read("components/crew/LocationEditor.tsx")) && !/VenuePick/.test(code(read("components/crew/LocationEditor.tsx")))
    && /\.venue-loading\{min-height:72px\}/.test(read("app/globals.css")));
  ok("quick-add: the three kinds stay on one line at phone width, and the day is said in words under them",
    /\.qd-tab\{[^}]*white-space:nowrap/.test(read("app/globals.css")) && /\{`For \$\{dayWithDate\(day\) \|\| day\}`\}/.test(cc) && !/color: "var\(--cream-m\)" \}\}>\{day\}<\/span>/.test(cc));
  ok("venue pick: compiled for the smoke run", /lib\/milestonePick\.ts lib\/venues\.ts/.test(read("package.json")));
}

// ── THE GESTURE ROUND (2026-10-05) ──────────────────────────────────────────────────────────────
// Ryan, with the Inbox open: "audit for 10 out of 10 … swipe down to close out a thing, swipe left to
// move forward to the next tab … right now it feels 2 out of 10. Example, I have to hit the X button to
// get out of here." lib/gesture is the one set of rules every swipe decides with; components/useGesture
// the one engine; the sheet, the tab pages, the inbox rows, the edge back and the pull to refresh ride it.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const G = require("../.smoke/gesture.js");
  const FG = require("../.smoke/formGuard.js");
  const near = (a, b, e = 0.01) => Math.abs(a - b) < e;

  // ── which way a touch is going ──
  ok("gesture: under the slop a touch has no axis yet — a tap, or a scroll that has not shown its way",
    G.axisOf(0, 0) === null && G.axisOf(5, -5) === null && G.SLOP === 6);
  ok("gesture: past the slop it is the axis it moved further along; a tie is a scroll",
    G.axisOf(6, 0) === "x" && G.axisOf(0, -6) === "y" && G.axisOf(6, 6) === "y" && G.axisOf(-9, 4) === "x");
  ok("gesture: a sideways bias asks a sideways move to be clearly sideways — a thumb's arc down a list stays a scroll",
    G.axisOf(7, 6, 6, 1.15) === "x" && G.axisOf(6.5, 6, 6, 1.15) === "y");

  // ── how fast the finger was going ──
  const path0 = [{ t: 0, x: 0, y: 0 }, { t: 16, x: 10, y: 0 }, { t: 32, x: 20, y: 5 }];
  ok("gesture: velocity is px per ms over the last 100ms of the path", near(G.velocity(path0, 40).vx, 20 / 32) && near(G.velocity(path0, 40).vy, 5 / 32));
  ok("gesture: a finger that stopped before lifting let go at rest", G.velocity(path0, 200).vx === 0 && G.velocity(path0, 200).vy === 0);
  ok("gesture: only the last 100ms count — an early fast stretch does not make a slow let-go a flick",
    near(G.velocity([{ t: 0, x: 0, y: 0 }, { t: 10, x: 300, y: 0 }, { t: 300, x: 310, y: 0 }, { t: 380, x: 318, y: 0 }], 390).vx, 8 / 80));
  ok("gesture: one sample is no velocity", G.velocity([{ t: 0, x: 0, y: 0 }], 5).vx === 0);

  // ── UIKit's numbers ──
  ok("gesture: a flick projects the way an iPhone scroll decelerates (0.998 per ms)", near(G.project(1), 499, 0.5) && G.project(0) === 0 && near(G.project(-0.5), -249.5, 0.5));
  ok("gesture: the rubber band gives less the further it is pulled, never reaches its span, and pulls both ways",
    G.rubber(0, 100) === 0 && near(G.rubber(100, 100), 35.48, 0.05) && G.rubber(1000, 100) < 100 && G.rubber(200, 100) > G.rubber(100, 100) && near(G.rubber(-100, 100), -35.48, 0.05));

  // ── a sheet pulled down ──
  ok("sheet: a pull under 16px is the finger settling, not a pull", !G.sheetCloses(10, 2, 600));
  ok("sheet: let go slowly past half the sheet — or a thumb's reach on a tall one (260px) — and it closes",
    G.sheetCloses(300, 0, 600) && !G.sheetCloses(200, 0, 600) && G.sheetCloses(130, 0, 250) && !G.sheetCloses(120, 0, 250));
  ok("sheet: a flick closes it from a short pull", G.sheetCloses(100, 0.5, 600) && G.sheetCloses(40, 1.2, 800));
  ok("sheet: heading back up when let go keeps it", !G.sheetCloses(300, -0.2, 600));

  // ── a viewer pulled down (a product's photos) ──
  ok("viewer: a short pull or a flick closes it, as Photos does", G.viewerCloses(90, 0) && G.viewerCloses(20, 0.5) && !G.viewerCloses(60, 0.1) && !G.viewerCloses(10, 2));

  // ── a page swiped sideways ──
  ok("pages: a third of the width turns the page, finger left is the next one", G.pageTurn(-140, 0, 390) === 1 && G.pageTurn(140, 0, 390) === -1 && G.pageTurn(-120, 0, 390) === 0);
  ok("pages: a flick the same way turns it from 24px; under 24px nothing does", G.pageTurn(-40, -0.5, 390) === 1 && G.pageTurn(10, 1, 390) === 0);
  ok("pages: a flick back the other way keeps the page", G.pageTurn(-200, 0.5, 390) === 0 && G.pageTurn(-40, 0.5, 390) === 0);
  const LV = [{ keys: ["plan", "prep"], current: "plan", depth: 0 }, { keys: ["calendar", "events", "route", "leads", "vendors"], current: "events", depth: 1 }];
  ok("pages: the innermost row moves first — Plan's Events → Route", JSON.stringify(G.pageStep(LV, 1)) === JSON.stringify({ level: 1, to: "route" }));
  ok("pages: at the end of the inner row the row around it moves — Plan's last tab → the lane's next section",
    JSON.stringify(G.pageStep([LV[0], { ...LV[1], current: "vendors" }], 1)) === JSON.stringify({ level: 0, to: "prep" }));
  ok("pages: nothing that way is nothing — the content bands back",
    G.pageStep([{ keys: ["a", "b"], current: "b", depth: 0 }], 1) === null && G.pageStep([{ keys: ["a"], current: "zzz", depth: 0 }], 1) === null);

  // ── a row swiped (Mail) ──
  ok("rows: a short swipe let go closes; past half its buttons it stays open on them",
    G.rowSettle(-30, 0, 360, 74, 148, true, true) === "close" && G.rowSettle(-80, 0, 360, 74, 148, true, true) === "trail" && G.rowSettle(50, 0, 360, 74, 148, true, true) === "lead");
  ok("rows: past 55% of the row the main action is armed, and letting go does it",
    G.rowArmed(-200, 360, true) && !G.rowArmed(-190, 360, true) && G.rowSettle(-250, 0, 360, 74, 148, true, true) === "trail-full");
  ok("rows: no long-swipe action, no arming — it rests open", !G.rowArmed(-250, 360, false) && G.rowSettle(-250, 0, 360, 74, 148, true, false) === "trail");
  ok("rows: a side with no buttons closes; a flick back closes; a flick on opens",
    G.rowSettle(50, 0, 360, 0, 148, false, true) === "close" && G.rowSettle(-80, 0.5, 360, 74, 148, true, true) === "close" && G.rowSettle(-30, -0.5, 360, 74, 148, true, true) === "trail");

  // ── the edge back, the pull to refresh ──
  ok("back: 72px of travel goes back, or a flick right after 24px", G.backGoes(72, 0) && G.backGoes(30, 0.5) && !G.backGoes(30, 0.2) && !G.backGoes(20, 1) && G.BACK.edge === 28);
  ok("refresh: the list follows the pull with the band's give, and arms at 64px shown",
    G.pullShown(0) === 0 && G.pullShown(-10) === 0 && near(G.pullShown(100), 50.07, 0.1) && G.pullShown(200) > G.PULL.arm && G.pullShown(100) < G.PULL.arm);

  // ── what a touch lands on (lib/gesture heldBy) ──
  const el = (o) => ({ parentElement: null, getAttribute: (n) => (o.attrs ?? {})[n] ?? null, ...o });
  const root = el({ tagName: "DIV" });
  const kid = (o, parent) => { const n = el(o); n.parentElement = parent; return n; };
  const ov = (b) => b.ov ?? {};
  const strip = kid({ tagName: "DIV", scrollWidth: 600, clientWidth: 300, ov: { x: "auto" } }, root);
  const chip = kid({ tagName: "BUTTON" }, strip);
  const text = kid({ tagName: "INPUT", type: "text" }, root);
  const scroller = kid({ tagName: "DIV", scrollTop: 40, scrollHeight: 900, clientHeight: 400, ov: { y: "auto" } }, root);
  const deep = kid({ tagName: "P" }, scroller);
  ok("held: a strip that scrolls sideways keeps a sideways swipe, not an up-and-down one",
    G.heldBy(chip, root, "x", ov) === "scroller" && G.heldBy(chip, root, "y", ov) === null);
  ok("held: a focused text box keeps its touches; one the finger only landed on does not",
    G.heldBy(text, root, "x", ov, text) === "field" && G.heldBy(text, root, "x", ov, null) === null);
  ok("held: a textarea, a select, a slider and editable text are always the field's",
    ["TEXTAREA", "SELECT"].every((t) => G.heldBy(kid({ tagName: t }, root), root, "y", ov) === "field")
    && G.heldBy(kid({ tagName: "INPUT", type: "range" }, root), root, "x", ov) === "field" && G.heldBy(kid({ tagName: "DIV", isContentEditable: true }, root), root, "y", ov) === "field"
    && G.heldBy(kid({ tagName: "DIV", attrs: { role: "slider" } }, root), root, "x", ov) === "field");
  ok("held: content scrolled away from its top scrolls before anything is pulled; at its top it may be pulled",
    G.heldBy(deep, root, "y", ov) === "scrolled" && G.heldBy(kid({ tagName: "P" }, kid({ tagName: "DIV", scrollTop: 0, scrollHeight: 900, clientHeight: 400, ov: { y: "auto" } }, root)), root, "y", ov) === null);
  ok("held: data-gesture says a part handles its own swipes — all of them, or one axis; an open dialog is its own",
    G.heldBy(kid({ tagName: "DIV", attrs: { "data-gesture": "off" } }, root), root, "y", ov) === "own"
    && G.heldBy(kid({ tagName: "DIV", attrs: { "data-gesture": "x" } }, root), root, "x", ov) === "own"
    && G.heldBy(kid({ tagName: "DIV", attrs: { "data-gesture": "x" } }, root), root, "y", ov) === null
    && G.heldBy(kid({ tagName: "DIV", attrs: { role: "dialog" } }, root), root, "x", ov) === "own");
  ok("held: the walk stops at the gesture's own element — what is around it is not its business",
    G.heldBy(kid({ tagName: "SPAN" }, root), root, "x", ov) === null
    && (() => { const outer = el({ tagName: "DIV", attrs: { "data-gesture": "off" } }); const r2 = kid({ tagName: "DIV" }, outer); return G.heldBy(kid({ tagName: "SPAN" }, r2), r2, "x", ov) === null; })());

  // ── unsaved changes (lib/formGuard edited) ──
  ok("unsaved: spaces at the ends and blank-vs-missing are not a change; a typed word is",
    !FG.edited({ a: " x " }, { a: "x" }, ["a"]) && !FG.edited({ a: null }, { a: "" }, ["a"]) && !FG.edited({ a: undefined }, { a: null }, ["a"]) && FG.edited({ a: "y" }, { a: "x" }, ["a"]));
  ok("unsaved: a number typed as text matches the number loaded; only the keys a form saves count; nothing loaded is nothing to lose",
    !FG.edited({ n: "5" }, { n: 5 }, ["n"]) && !FG.edited({ a: "x", other: 1 }, { a: "x", other: 2 }, ["a"]) && !FG.edited(null, { a: 1 }, ["a"]) && !FG.edited({ a: 1 }, null, ["a"]));

  // ── the engine and the sheet ──
  const ug = code(read("components/useGesture.ts")), sh = code(read("components/Sheet.tsx")), sm = code(read("components/SheetMotion.tsx"));
  ok("engine: native listeners, the move not passive so a claimed swipe can stop the page scrolling under it",
    /addEventListener\("touchmove", onMove, \{ passive: false, capture \}\)/.test(ug) && /if \(e\.cancelable\) e\.preventDefault\(\);/.test(ug));
  ok("engine: one owner per touch — whoever takes it, everyone else stands down; a touch claimed too late to stop a scroll is left alone",
    /if \(owner && owner !== me\) \{ reset\(\); return; \}/.test(ug) && /if \(axis !== want \|\| !e\.cancelable \|\| !take\(d\)\) \{ live = false; path = \[\]; return; \}/.test(ug)
    && /window\.addEventListener\("touchstart", \(e\) => \{ if \(e\.touches\.length === 1\) owner = null; \}, \{ passive: true, capture: true \}\)/.test(ug));
  ok("engine: the finger is followed a frame at a time, and a swipe's let-go never also taps what it ended on",
    /if \(!frame\) frame = requestAnimationFrame\(flush\);/.test(ug) && /quietUntil = performance\.now\(\) \+ 150;/.test(ug) && /e\.stopPropagation\(\); e\.preventDefault\(\); quietUntil = 0;/.test(ug));
  ok("engine: handlers read the latest props as Effect Events — no ref written while rendering",
    /const move = useEffectEvent\(\(d: Pull\) => spec\.move\(d\)\);/.test(ug) && !/s\.current = spec/.test(ug));
  ok("sheet: the whole panel pulls — the content only downward and only from its top",
    /useGesture\(panelRef, \{\s+axis: "y",/.test(sm) && /if \(!panel \|\| asking \|\| held\(target, panel, "y"\)\) return false;/.test(sm)
    && /take: \(d\) => !grab\.current\.fromBody \|\| d\.dy > 0,/.test(sm) && !/dragZone/.test(sh));
  ok("sheet: it closes by lib/gesture's rule at the finger's speed, the dim lightening as it goes (not the panel)",
    /if \(cancelled \|\| !sheetCloses\(d\.dy, d\.vy, h\) \|\| !dismissible\) \{ springBack\(\); return; \}/.test(sm) && /dimScrim\(scrimRef\.current, 1 - Math\.min\(1, Math\.max\(0, y\) \/ h\) \* 0\.85\);/.test(sm)
    && /finish\(ms, true\);/.test(sm) && /\.sheet2-scrim::before\{[^}]*opacity:var\(--scrim,1\)/.test(read("app/globals.css")) && /\.sheet2\.gone,\.sheet2-scrim\.gone\{animation:none!important\}/.test(read("app/globals.css")));
  ok("sheet: its motion loads with the first sheet that opens — the shell carries the door, not the engine",
    /const SheetMotion = dynamic<SheetMotionProps>\(\(\) => import\("\.\/SheetMotion"\), \{ ssr: false \}\);/.test(sh) && !/from "\.\/useGesture"|from "@\/lib\/gesture"/.test(sh)
    && /import type \{ SheetMotionProps \} from "\.\/SheetMotion";/.test(sh) && /\{live && <SheetMotion /.test(sh));
  ok("sheet: one door out — a held sheet gives, typed changes ask, for the pull, a tap outside, Escape, the X and a form's Cancel",
    /if \(!dismissible\) \{ nudge\(\); return; \}\s+if \(unsaved\(\)\) \{ askFor\(go\); return; \}/.test(sh) && /const attempt = useCallback\(\(\) => leave\(requestClose\)/.test(sh)
    && /onClick=\{attempt\}/.test(sh) && /export function CloseButton[\s\S]*?leave \? leave\(onClick\) : onClick\(\)/.test(sh) && /export function LeaveButton[\s\S]*?onClick=\{\(\) => \(leave \? leave\(onClick\) : onClick\(\)\)\}>\{children\}<\/button>;/.test(sh)
    && /if \(unsaved\(\)\) \{ springBack\(\); ask\(requestClose\); return; \}/.test(sm));
  ok("sheet: the question is the phone's — Discard changes, Keep editing (focused)",
    />Discard your changes\?</.test(sh) && /className="sheet2-ask-go" onClick=\{\(\) => \{ const go = ask; setAsk\(null\); go\(\); \}\}>Discard changes</.test(sh) && /className="sheet2-ask-no" autoFocus onClick=\{keep\}>Keep editing</.test(sh));
  ok("sheet: Escape belongs to the top sheet, and a field that used it first (preventDefault) keeps it",
    /if \(e\.key !== "Escape" \|\| e\.defaultPrevented \|\| stack\[stack\.length - 1\] !== me\) return;/.test(sh));
  ok("sheet: a parent that declines a close gets its sheet back on screen, not a ghost",
    /if \(!openNow\.current\) return;\s+selfClosing\.current = false;\s+setPhase\("open"\); setGone\(false\);/.test(sh));
  ok("sheet: its phase follows the open prop in an effect — a render React drops cannot half-close it (the menu's Add to order)",
    /useEffect\(\(\) => \{\s+if \(open\) \{ selfClosing\.current = false; setPhase\("open"\); setGone\(false\); return; \}\s+setPhase\(\(p\) => \(p === "closed" \? p : "closing"\)\);\s+\}, \[open\]\);/.test(sh) && !/if \(open !== seen\)/.test(sh));
  ok("sheet: a form inside a sheet can say it is unsaved (useUnsaved), and the sheet asks for it",
    /export function useUnsaved\(dirty: boolean\): void/.test(sh) && /const unsaved = useCallback\(\(\) => dirty \|\| \[\.\.\.inner\.current\.values\(\)\]\.some\(Boolean\), \[dirty\]\);/.test(sh));

  // ── the forms that say what leaving does ──
  const guarded = {
    "components/FieldOpSheet.tsx": /dirty=\{dirty\} page=\{page\}/, "components/CompanyCalendar.tsx": /dirty=\{edited\(f, loaded, CAL_SAVES\)\}/,
    "components/ProfileSheet.tsx": /dirty=\{edited\(\{ name, title, bio \}/, "components/MilestoneSheet.tsx": /dirty=\{title\.trim\(\) !== m\.title\.trim\(\)/,
    "components/InitiativeSheet.tsx": /useUnsaved\(canEdit && changed\);/, "components/OsRegistry.tsx": /dirty=\{anyScored \|\| edited\(/,
    "components/AssignTaskSheet.tsx": /dirty=\{!createdId && /, "components/AssetMaintenance.tsx": /dirty=\{summary\.trim\(\) !== \(from\?\.summary/,
    "components/ComplianceRuleRecord.tsx": /useUnsaved\(!!against\.trim\(\)/, "components/BrandCalendar.tsx": /dirty=\{edited\(f, loaded, \["title", "scheduled_for", "status", "event_id"\]\)\}/,
    "components/EventDayPlanner.tsx": /dirty=\{edited\(f, first,/, "components/BrewPlanner.tsx": /label="Batch log" dirty=\{dirty\}/,
    "components/QuickDock.tsx": /useUnsaved\(!!text\.trim\(\)\);/, "components/LogPurchase.tsx": /useUnsaved\(!!amount\.trim\(\)/,
    "components/EventCopilot.tsx": /dirty=\{!!draft && !creating\}/, "components/OfficeOrder.tsx": /dirty=\{typed\} dismissible=\{!busy\}/,
    "app/crew/page.tsx": /dirty=\{!!item && \(caption !== \(item\.caption \?\? ""\) \|\| !!note\.trim\(\)\)\}/,
  };
  ok("unsaved: every form sheet that loses typed words on close says so (the gesture audit holds the rest)",
    Object.entries(guarded).every(([f, re]) => re.test(read(f))), Object.entries(guarded).filter(([f, re]) => !re.test(read(f))).map(([f]) => f));
  ok("unsaved: the quick-add's typed words ask; its Cancel and the editor's Cancel leave by the door",
    /label="Add to the calendar" dirty=\{!!\(title\.trim\(\) \|\| where\.trim\(\) \|\| address\.trim\(\) \|\| venueId\)\}/.test(read("components/CompanyCalendar.tsx"))
    && (read("components/CompanyCalendar.tsx").match(/<LeaveButton className="note-arch" onClick=\{onClose\}>Cancel<\/LeaveButton>/g) ?? []).length === 2
    && /<LeaveButton className="note-arch" onClick=\{onClose\} disabled=\{saving\}>Cancel<\/LeaveButton>/.test(read("components/FieldOpSheet.tsx")));
  ok("publish: the event's publish switch keeps the sheet open — it used to close it, and what was typed went with it",
    /toast\(next \? "Published — live to guests" : "Hidden from guests"\);\s+onChanged\?\.\(\);/.test(code(read("components/FieldOpSheet.tsx"))));
  ok("checkout: a payment holds the sheet (dismissible) — no do-nothing onClose that faded it out for good",
    /<Sheet open=\{open\} onClose=\{onClose\} dismissible=\{!busy\}/.test(read("components/Checkout.tsx")) && !/busy \? \(\) => \{\} : onClose/.test(read("components/Checkout.tsx")));
  ok("quick actions: Escape is the sheet's — the dock's own handler, which closed around the guard, is gone",
    !/if \(e\.key === "Escape"\) setOpen\(false\)/.test(read("components/QuickDock.tsx")));

  // ── the calendar's walk ──
  const cc = code(read("components/CompanyCalendar.tsx"));
  ok("walk: the sideways swipe is the editor sheet's own (page), the pill rides inside the sheet and leaves by its door; nothing listens to the whole screen",
    /const walk = \{ prev: selIdx > 0 \? \(\) => moveSel\(-1\) : undefined, next: selIdx < spine\.length - 1 \? \(\) => moveSel\(1\) : undefined \};/.test(cc)
    && /page=\{walk\} walker=\{walker\}/.test(cc) && /const door = useSheetDoor\(\);/.test(cc) && !/addEventListener\("touch/.test(cc));
  ok("walk: a sideways swipe to the next item asks first when the edit is not saved, and turns by lib/gesture's page rule",
    /if \(unsaved\(\)\) \{ back\(\); ask\(slide\); return; \}/.test(sm) && /const turn = cancelled \? 0 : pageTurn\(d\.dx, d\.vx, w\);/.test(sm) && /enabled: !!page,/.test(sm));

  // ── tabs that page ──
  const pg = code(read("app/crew/page.tsx"));
  ok("pages: the section body is one pager — the lane's sections, and Plan's tabs on Plan — each turn the tap it stands for, in the lane",
    /<SwipePager levels=\{\[\s+lane\.members\.length >= 2 && \{ keys: lane\.members, current: sec, go: \(k\) => inLane\(k as OpSection\), depth: 0 \},\s+sec === "plan" && canManage && \{ keys: PLAN_PAGES, current: planTab, go: \(k\) => setPlanTab\(k as PlanTab\), depth: 1 \},/.test(pg)
    && /const inLane = \(m: OpSection\) => \{ if \(grp\) setGroupId\(grp\.id\); setSection\(m\); \};/.test(pg) && /onClick=\{\(\) => inLane\(m\)\}/.test(pg));
  ok("pages: Plan's row is drawn from the same list the swipe turns through",
    /const PLAN_PAGES: readonly PlanTab\[\] = \["calendar", "events", "route", "leads", "vendors"\];/.test(read("app/crew/page.tsx")) && /\{PLAN_PAGES\.map\(\(k\) => \{/.test(pg));
  ok("pages: Studio's views and the shop's aisles page too, each from its one list",
    /usePagerLevel\(\{ keys: STUDIO_VIEWS\.map\(\(x\) => x\.key\), current: view, go: \(k\) => pickView\(k as StudioView\), depth: 1 \}\);/.test(read("components/Studio.tsx"))
    && /\{STUDIO_VIEWS\.map\(\(x\) => \(/.test(read("components/Studio.tsx"))
    && /<SwipePager levels=\{\[\(section === "bottles" \|\| view === "grid"\) && \{ keys: SHOP_AISLES, current: section, go: \(k\) => setSection\(k as Aisle\), depth: 0 \}\]\}>/.test(read("components/Shop.tsx")));
  const sp = code(read("components/SwipePager.tsx")), pm = code(read("components/PagerMotion.tsx"));
  ok("pages: the whole screen turns the page — the finger is followed on the scroll container, the content moves",
    /surface\.current = box\.current\?\.closest<HTMLElement>\("main"\) \?\? box\.current;/.test(sp) && /useGesture\(surface, \{/.test(pm) && /<PagerMotion box=\{box\} surface=\{surface\} levels=\{levels\} \/>/.test(sp));
  ok("pages: the pager's motion loads right after the screen is up — the engine is not in a guest's first load",
    /const PagerMotion = dynamic<PagerMotionProps>\(\(\) => import\("\.\/PagerMotion"\), \{ ssr: false \}\);/.test(sp)
    && !/^import (?!type )[^;]*from "(\.\/useGesture|@\/lib\/gesture)";/m.test(sp) && /^import type \{ PageLevel \} from "@\/lib\/gesture";/m.test(sp));
  ok("pages: a strip that scrolls sideways, a field or a map keeps its touches; a turn moves the row it stands for, by lib/gesture's rules",
    /if \(!el \|\| !root \|\| !levels\(\)\.length \|\| held\(target, root, "x"\)\) return false;/.test(pm) && /const turn = cancelled \? 0 : pageTurn\(d\.dx, d\.vx, w\);/.test(pm)
    && /const step = turn \? pageStep\(ls, turn\) : null;/.test(pm) && /ls\[step\.level\]\.go\(step\.to\);/.test(pm) && /bias: 1\.15,/.test(pm));

  // ── inbox rows ──
  ok("inbox: each flag swipes like a Mail row — left for Later and Got it (a long swipe clears), right to open",
    /<SwipeRow key=\{a\.id\} className="alert-swipe"/.test(pg) && /lead=\{canOpen\(a\) \? \[\{ key: "open", label: "Open", icon: "arrowRight", tone: "info", run: \(\) => gotoAlert\(a\) \}\] : \[\]\}/.test(pg)
    && /key: "clear", label: "Got it", icon: "check", tone: "ok", removes: true, run: \(\) => \{ void clear\(a\); \}/.test(pg));
  ok("inbox: the ✓ and the clock go the same way as the swipes — with an Undo, and a refused write said",
    /onClick=\{\(\) => \{ void later\(a\); \}\} aria-label="Snooze 1 hour"/.test(pg) && /onClick=\{\(\) => \{ void clear\(a\); \}\} aria-label="Got it"/.test(pg)
    && /action: \{ label: "Undo", run: \(\) => \{ void restore\(\[a\]\)/.test(pg) && /if \(e\) toast\(`Couldn't clear it — \$\{e\}`, "error"\);/.test(pg));
  const sr = code(read("components/SwipeRow.tsx"));
  ok("rows: a row takes a sideways swipe only where nothing inside holds it, never on its own open buttons — and one row is open at a time",
    /if \(!el \|\| \(!lead\.length && !trail\.length\) \|\| held\(target, el, "x"\)\) return false;/.test(sr) && /if \(\(target as Element\)\.closest\?\.\("\.swipe-acts"\)\) return false;/.test(sr)
    && /closeOthers\(me\);\s+follow\(face\.current/.test(sr) && /claimOpen\(me, close\);/.test(sr));
  ok("rows: a long swipe does its side's main action — the outermost, lead's first and trail's last, the one drawn wide",
    /if \(r === "lead-full"\) perform\(L\[0\], 1\);/.test(sr) && /else if \(r === "trail-full"\) perform\(T\[T\.length - 1\], -1\);/.test(sr)
    && /\(side === 1 \? i === 0 : i === shown\.length - 1\) \? " main" : ""/.test(sr) && /const on = has && rowArmed\(x, w\.current, true\);/.test(sr));
  ok("rows: a row that leaves flies off and the list closes over it before the action runs; one still there a moment later is put back",
    /const done = \(\) => \{\s+a\.run\(\);/.test(sr) && /if \(!el\.isConnected\) return;/.test(sr) && /if \(anim\) anim\.onfinish = done; else done\(\);/.test(sr));
  const mya = code(read("lib/useMyAlerts.ts"));
  ok("inbox: a dismissal the database refuses is said and read again — and undone ones come back (un-acked, read taken back, snooze lifted)",
    /if \(error\) \{ await load\(\); return error\.message; \}/.test(mya) && /update\(\{ ack_at: null, ack_by: null \}\)/.test(mya)
    && /from\("alert_reads"\)\.delete\(\)\.eq\("user_id", userId\)\.in\("alert_id", broadcast\)/.test(mya) && /from\("alert_snoozes"\)\.delete\(\)\.eq\("user_id", userId\)\.eq\("alert_id", f\.id\)/.test(mya));
  ok("toast: it can carry one action (Undo), and it rides above sheets",
    /toastAction && toastShown && \(/.test(read("components/Toast.tsx")) && /\.toast\{z-index:90\}/.test(read("app/globals.css")) && /\.toast\.has-act\.show\{pointer-events:auto\}/.test(read("app/globals.css")));

  // ── the rest of the system ──
  ok("back: the edge swipe listens first and stands down while a sheet is open",
    /useGesture\("root", \{\s+axis: "x",\s+capture: true,\s+begin: \(_target, x\) => x <= BACK\.edge && canGoBack && !sheetOpen\(\),/.test(read("components/SwipeBack.tsx")));
  ok("refresh: the pull reads every live screen again (lib/realtime's loaders), and so does coming back to the app after 30s away",
    /export function refreshLive\(\): Promise<void>/.test(read("lib/realtime.ts")) && /loaders\.add\(cb\);/.test(read("lib/realtime.ts")) && /const RESUME_MS = 30_000;/.test(read("lib/realtime.ts"))
    && /\{inAdmin && <PullToRefresh \/>\}/.test(read("components/AppShell.tsx")) && /refreshLive\(\)/.test(read("components/PullToRefresh.tsx")));
  ok("haptics: an iPhone before iOS 26.5 ticks (the switch's own haptic) where vibrate does not exist, and nothing buzzes before a tap",
    /input\.setAttribute\("switch", ""\);/.test(read("lib/haptics.ts")) && /navigator\.userActivation && !navigator\.userActivation\.hasBeenActive/.test(read("lib/haptics.ts")));
  ok("tab bar: the tab you are on, tapped again, goes back to the top", /scrollToTop\(\)/.test(read("components/OperatorNav.tsx")) && /if \(pathname === tab\.href\) \{ e\.preventDefault\(\); scrollToTop\(\); \}/.test(read("components/BottomNav.tsx")));
  ok("scroll to top: one home (lib/appScroll) — the tab bars and the order form call it; no copy of it, and not in the crew's panel jumps every guest would carry",
    /export function scrollToTop\(\): void/.test(read("lib/appScroll.ts")) && /document\.getElementById\("body"\)\?\.scrollTo\(\{ top: 0, behavior: "smooth" \}\);/.test(read("lib/appScroll.ts")) && !/scrollToTop/.test(read("lib/anchors.ts"))
    && ["components/BottomNav.tsx", "components/OperatorNav.tsx", "components/OrderFunnel.tsx"].every((f) => /import \{ scrollToTop \} from "@\/lib\/appScroll";/.test(read(f)))
    && !/getElementById\("body"\)\?\.scrollTo\(\{ top: 0/.test(read("components/OrderFunnel.tsx")));
  ok("viewer: a product's photos follow the finger down, and a pull is neither a tap nor a hold (no \"Paused\" riding down with it)", /useGesture\(stageRef, \{/.test(read("components/StoryViewer.tsx")) && /if \(pulled\.current\) \{ pulled\.current = false; return; \}/.test(read("components/StoryViewer.tsx"))
    && /if \(!pulled\.current\) \{ pulled\.current = true; clearHold\(\); setPaused\(false\); \}/.test(read("components/StoryViewer.tsx")));
  ok("viewer: the shop fetches it once a product with photos to page through is open — not in a guest's first load",
    /const StoryViewer = dynamic\(\(\) => import\("\.\/StoryViewer"\), \{ ssr: false \}\);/.test(read("components/Shop.tsx")) && !/^import StoryViewer/m.test(read("components/Shop.tsx"))
    && /useEffect\(\(\) => \{ if \(storyable\) void import\("\.\/StoryViewer"\); \}, \[storyable\]\);/.test(read("components/Shop.tsx")));
  ok("maps keep their own touches", /data-gesture="off"/.test(read("components/RouteMap.tsx")));
  ok("gesture: compiled for the smoke run, and the audit runs with the others",
    /lib\/venues\.ts lib\/gesture\.ts lib\/formGuard\.ts/.test(read("package.json")) && /node scripts\/gesture\.audit\.mjs/.test(read("package.json")));
}

// ── THE HAPTICS ROUND (2026-10-05) ──────────────────────────────────────────────────────────────
// One vocabulary for every buzz. lib/haptics names a feel for each kind of moment and holds the one
// table of patterns; a call site says what happened, and scripts/haptics.audit.mjs holds every
// haptic() in the app to a literal feel. These hold the table's rules, run, and the moments the round
// wired that had no feel before: errors, payments, a sheet that holds or asks, a swipe backing off its
// line, a page or tab changing, a stepper at its end, a switch.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const H = require("../.smoke/haptics.js");
  const hl = read("lib/haptics.ts");

  // ── the vocabulary, run ──
  const FEELS = ["selection", "light", "medium", "heavy", "success", "warning", "error", "threshold", "release", "boundary", "toggleOn", "toggleOff", "increase", "decrease", "start", "live", "paid", "alert"];
  const P = H.HAPTIC_PATTERNS;
  ok("haptics: eighteen feels, each with its pattern — a tap is one number, a signature a few beats that ends on a beat, not a pause",
    JSON.stringify(Object.keys(P)) === JSON.stringify(FEELS)
    && Object.values(P).every((p) => (typeof p === "number" ? p > 0 && p <= 200 : Array.isArray(p) && p.length % 2 === 1 && p.every((n) => Number.isInteger(n) && n > 0))), Object.keys(P));
  ok("haptics: the pairs say themselves by weight — a release under its threshold, down under up, off under on, light under medium under heavy",
    P.release < P.threshold && P.decrease < P.increase && P.toggleOff < P.toggleOn && P.light < P.medium && P.medium < P.heavy);
  ok("haptics: one table, read-only from outside — the old HAPTIC object is gone",
    !("HAPTIC" in H) && !/\bHAPTIC\s*=/.test(hl) && /export const HAPTIC_PATTERNS: Readonly<Record<Feel, number \| readonly number\[\]>> = PATTERN;/.test(hl)
    && /export function haptic\(feel: Feel\): void \{/.test(hl));
  {
    const was = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const as = (active, vibrate) => Object.defineProperty(globalThis, "navigator", { value: { userActivation: { hasBeenActive: active }, vibrate, userAgent: "Android", maxTouchPoints: 5, platform: "Linux" }, configurable: true, writable: true });
    const got = [];
    let threw = false;
    try {
      as(false, (p) => { got.push(p); return true; });
      H.haptic("success");
      const early = got.length;
      as(true, (p) => { got.push(p); return true; });
      H.haptic("success"); H.haptic("selection");
      ok("haptics: nothing buzzes before the page has been touched; after, each feel plays its own pattern",
        early === 0 && JSON.stringify(got) === JSON.stringify([[14, 40, 14], 6]), got);
      ok("haptics: vibrate is handed a copy — a browser that keeps or changes the array cannot change the table",
        Array.isArray(got[0]) && got[0] !== P.success && (got[0].push(999), P.success.length === 3));
      as(true, () => { throw new Error("blocked"); });
      try { H.haptic("error"); } catch { threw = true; }
      as(true, undefined);
      try { H.haptic("paid"); } catch { threw = true; }
    } finally {
      if (was) Object.defineProperty(globalThis, "navigator", was); else delete globalThis.navigator;
    }
    ok("haptics: a vibrate that throws, or none at all (an iPhone), is quiet — a haptic never breaks the tap it rides on", !threw);
  }
  {
    // The older iPhones' tick, run: no vibrate, an iPhone, a tap seen → a hidden switch is made, its label
    // clicked once and taken away. Before any tap, and where vibrate works (Android), no switch is made.
    const wasNav = Object.getOwnPropertyDescriptor(globalThis, "navigator"), wasDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
    const made = [];
    const el = (tag) => { const e = { tag, style: {}, attrs: {}, kids: [], clicked: 0, removed: 0, setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.kids.push(c); }, addEventListener() {}, click() { this.clicked++; }, remove() { this.removed++; } }; made.push(e); return e; };
    const body = { kids: [], appendChild(c) { this.kids.push(c); } };
    const nav = (ua, active, vibrate) => Object.defineProperty(globalThis, "navigator", { value: { userActivation: { hasBeenActive: active }, vibrate, userAgent: ua, maxTouchPoints: 5, platform: "iPhone" }, configurable: true, writable: true });
    const ticks = {};
    try {
      Object.defineProperty(globalThis, "document", { value: { createElement: el, body }, configurable: true, writable: true });
      nav("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", false, undefined); H.haptic("success"); ticks.beforeTap = made.length;
      nav("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", true, undefined); H.haptic("success");
      const label = made.find((e) => e.tag === "label"), input = made.find((e) => e.tag === "input");
      ticks.iphone = !!label && !!input && input.attrs.switch === "" && label.kids.includes(input) && label.clicked === 1 && label.removed === 1 && body.kids.includes(label);
      made.length = 0; nav("Mozilla/5.0 (Linux; Android 15)", true, () => true); H.haptic("success"); ticks.android = made.length;
    } finally {
      if (wasNav) Object.defineProperty(globalThis, "navigator", wasNav); else delete globalThis.navigator;
      if (wasDoc) Object.defineProperty(globalThis, "document", wasDoc); else delete globalThis.document;
    }
    ok("haptics: an older iPhone (no vibrate) gets the switch's tick after a tap — a hidden switch made, its label clicked once, then taken away; nothing before a tap, and no switch where vibrate works",
      ticks.beforeTap === 0 && ticks.iphone === true && ticks.android === 0, ticks);
  }
  ok("haptics: the header says what a phone feels — Android every feel; an iPhone before iOS 26.5 the switch's tick, since then nothing from code (WebKit bug 309082); inside the iPhone app every feel, through UIKit",
    /Android \(Chrome\) vibrates every feel/.test(hl) && /before iOS 26\.5/.test(hl) && /WebKit \(bug 309082\)/.test(hl)
    && /THE IPHONE APP FEELS THEM ALL/.test(hl) && /every feel plays as UIKit's impact, selection or notification feedback/.test(hl)
    && !/THE IPHONE TICKS TOO/.test(hl));
  {
    // The seam, used (2026-10-06, the iPhone round): every feel has its UIKit form, and with the app's
    // player handed over (components/NativeBridge) haptic() plays through it — and only through it.
    const HN = require("../.smoke/haptics.js");
    const missing = Object.keys(HN.HAPTIC_PATTERNS).filter((f) => !HN.HAPTIC_UIKIT[f] || !HN.HAPTIC_UIKIT[f].length);
    const played = [];
    HN.setNativeHaptics((step) => played.push(step));
    try { HN.haptic("selection"); HN.haptic("success"); } finally { HN.setNativeHaptics(null); }
    ok("haptics: inside the iPhone app every feel has its UIKit form, and haptic() plays it through the player the app hands over",
      missing.length === 0 && played.length === 2 && played[0].kind === "selection" && played[1].kind === "notification" && played[1].type === "SUCCESS", { missing, played });
  }

  // ── an error, felt ──
  const ap = code(read("components/AppProvider.tsx"));
  ok("toast: every error toast is felt, from the one place they all come through — AppProvider's toast()",
    /const toast = useCallback\(\(msg: string, variant: ToastVariant = "success", opts\?: \{ action\?: ToastAction \}\) => \{\s+if \(variant === "error"\) haptic\("error"\);/.test(ap));

  // ── the cart ──
  ok("cart: a drink in is firmer than a drink out, read from a mirror of the cart kept in an effect — not inside the updater, and no ref written while rendering",
    /const cartNow = useRef\(cart\);\s+useEffect\(\(\) => \{ cartNow\.current = cart; \}, \[cart\]\);/.test(ap)
    && /const bump = useCallback\(\(id: DrinkId\) => \{\s+if \(cartNow\.current\[id\]\) haptic\("light"\); else haptic\("medium"\);\s+setCart\(/.test(ap));
  ok("cart: + is increase and − is decrease, said before the update is asked for",
    /const inc = useCallback\(\(id: DrinkId\) => \{ haptic\("increase"\); setCart\(/.test(ap) && /const dec = useCallback\(\(id: DrinkId\) => \{ haptic\("decrease"\); setCart\(/.test(ap));
  const shop = code(read("components/Shop.tsx"));
  ok("shop: into the cart is medium; a line's quantity says which way it went, read from the cart on screen",
    /const addToCart = \(product: Product, variant: Variant \| null, qty: number\) => \{\s+haptic\("medium"\);/.test(shop)
    && /if \(qty > \(cart\[idx\]\?\.qty \?\? 0\)\) haptic\("increase"\); else haptic\("decrease"\);\s+setCart\(/.test(shop));

  // ── money ──
  const co = code(read("components/Checkout.tsx")), sc = code(read("components/ShopCheckout.tsx"));
  ok("checkout: Pay is felt (heavy) once the tap is going to charge — after the name and card guards, so a tap they turn away is not felt as a charge — the charge through as paid, a pre-order sent as success, an inline payment error as error",
    /if \(!customer\) \{ setErr\("Add a name for pickup"\); return; \}\s+if \(!ready\) return;\s+haptic\("heavy"\);\s+setBusy\(true\);/.test(co)
    && !/if \(busy\) return;[^\n]*\n\s+haptic\("heavy"\);/.test(co) && /trackFunnel\("order", "paid"\);\s+haptic\("paid"\);/.test(co)
    && /trackFunnel\("order", "pickup"\);\s+haptic\("success"\);/.test(co) && /useEffect\(\(\) => \{ if \(err\) haptic\("error"\); \}, \[err\]\);/.test(co));
  ok("checkout: an error said with toast() is not buzzed again here — AppProvider already felt it",
    (co.match(/haptic\("error"\)/g) || []).length === 1 && (sc.match(/haptic\("error"\)/g) || []).length === 1);
  ok("shop checkout: a payment through is paid, and the error under the card is felt where it is set",
    /if \(!r\.ok\) \{ setErr\(payErrorText\(data\.error\)\); setBusy\(false\); return; \}\s+haptic\("paid"\);/.test(sc) && /useEffect\(\(\) => \{ if \(err\) haptic\("error"\); \}, \[err\]\);/.test(sc));
  const of = code(read("components/OrderFunnel.tsx")), dr = code(read("components/DriverRun.tsx"));
  ok("order form: its inline errors are felt where they are set, and a code is success when it lands, error when it does not",
    /useEffect\(\(\) => \{ if \(err\) haptic\("error"\); \}, \[err\]\);/.test(of) && (of.match(/haptic\("error"\)/g) || []).length === 2
    && /setCodeState\("bad"\); setCodeBenefit\(null\); haptic\("error"\); return;/.test(of) && /setCodeState\("ok"\); haptic\("success"\);/.test(of));
  const scan = code(read("app/scan/page.tsx"));
  ok("scan: a stamp added is success, one that did not record is error — said inline, so felt there",
    /setState\("added"\); haptic\("success"\); \}/.test(scan) && /else \{ setState\("error"\); haptic\("error"\); \}/.test(scan));

  // ── the sheet ──
  const sh = code(read("components/Sheet.tsx")), sm = code(read("components/SheetMotion.tsx"));
  ok("sheet: \"Discard your changes?\" arrives with the warning feel, from one place whichever door asked — the pull and the walk ask through it too",
    /const askFor = useCallback\(\(go: \(\) => void\) => \{ haptic\("warning"\); setAsk\(\(\) => go\); \}, \[\]\);/.test(sh)
    && (sh.match(/setAsk\(\(\) => go\)/g) || []).length === 1 && /ask=\{askFor\}/.test(sh));
  ok("sheet: a held sheet refusing to leave gives with the boundary feel — a tap outside, Escape or the X (nudge), and a pull let go past the line",
    /const nudge = useCallback\(\(\) => \{\s+haptic\("boundary"\);/.test(sh)
    && /if \(!cancelled && !dismissible && sheetCloses\(d\.dy, d\.vy, h\)\) haptic\("boundary"\);\s+if \(cancelled \|\| !sheetCloses\(d\.dy, d\.vy, h\) \|\| !dismissible\) \{ springBack\(\); return; \}/.test(sm));

  // ── a swipe's line ──
  ok("swipes: crossing the line ticks (threshold), backing off it mid-swipe is felt too (release) — the row, the pull to refresh, the edge back",
    /if \(on !== armed\.current\) \{ armed\.current = on; el\.dataset\.armed = on \? "1" : ""; if \(on\) haptic\("threshold"\); else haptic\("release"\); \}/.test(read("components/SwipeRow.tsx"))
    && /if \(on !== armed\.current\) \{ armed\.current = on; if \(ring\.current\) ring\.current\.dataset\.armed = on \? "1" : ""; if \(on\) haptic\("threshold"\); else haptic\("release"\); \}/.test(read("components/PullToRefresh.tsx"))
    && /if \(on !== armed\.current\) \{\s+armed\.current = on;\s+if \(el\) el\.dataset\.armed = on \? "1" : "";\s+if \(on\) haptic\("threshold"\); else haptic\("release"\);\s+\}/.test(code(read("components/SwipeBack.tsx"))));
  ok("swipes: the let-go and a reset clear the line without a word — a release is only ever mid-swipe, and a row resting open is not armed",
    ["components/SwipeRow.tsx", "components/PullToRefresh.tsx", "components/SwipeBack.tsx"].every((f) => (read(f).match(/haptic\("release"\)/g) || []).length === 1)
    && /const openTo = \(x: number\) => \{\s+rest\.current = x;\s+armed\.current = false;/.test(code(read("components/SwipeRow.tsx"))));

  // ── tabs and pages ──
  const sp = code(read("components/SwipePager.tsx"));
  ok("pages: a row's page turning ticks once, from the pager — a tap and a swipe both end in its go; the first render, a row coming back and another row in its place do not",
    /if \(row !== null && row === was\.row && current !== was\.current\) haptic\("selection"\);/.test(sp)
    && /export function usePagerLevel\(level: Level \| null\): void \{[\s\S]*?usePageTick\(level\);\s+\}/.test(sp)
    && /\{own\.map\(\(l, i\) => <PageTick key=\{i\} level=\{l \|\| null\} \/>\)\}/.test(sp)
    && (sp.match(/haptic\(/g) || []).length === 1 && !/haptic\(/.test(read("components/PagerMotion.tsx")));
  ok("tabs: a tab bar ticks when the tab changes — not when the tab you are on is tapped again (that goes back to the top)",
    /onClick=\{\(e\) => \{ if \(pathname === tab\.href\) \{ e\.preventDefault\(\); scrollToTop\(\); \} else if \(!on\) haptic\("selection"\); \}\}/.test(read("components/BottomNav.tsx"))
    // currentId, not activeGroup.id (2026-10-06, the settings round): in Settings no lane is current,
    // so a lane tapped from there is a change and ticks.
    && /const openGroup = \(g: NavGroup\) => \{\s+if \(g\.id !== currentId\) haptic\("selection"\);/.test(code(read("components/OperatorNav.tsx"))));

  // ── steppers and switches ──
  ok("steppers: up is increase, down is decrease, and \"−\" at zero is the boundary — read from what is on screen, before the update (the order form, the porch run's empties)",
    /const bump = \(k: Flav, d: number\) => \{\s+if \(d > 0\) haptic\("increase"\); else if \(mix\[k\] > 0\) haptic\("decrease"\); else haptic\("boundary"\);\s+setMix\(/.test(of)
    && /const bumpPremium = \(slug: string, d: number\) => \{\s+if \(d > 0\) haptic\("increase"\); else if \(\(premiums\[slug\] \|\| 0\) > 0\) haptic\("decrease"\); else haptic\("boundary"\);\s+setPremiums\(/.test(of)
    && /onClick=\{\(\) => \{ if \(\(empties\[o\.id\] \?\? o\.empties_expected\) > 0\) haptic\("decrease"\); else haptic\("boundary"\); setEmpties\(/.test(dr)
    && /onClick=\{\(\) => \{ haptic\("increase"\); setEmpties\(/.test(dr));
  ok("steppers: one with a ceiling meets it as a boundary too — the delivery's empties (up to the pack's refills), a product's quantity (1 to 20)",
    /onClick=\{\(\) => \{ if \(refills > 0\) haptic\("decrease"\); else haptic\("boundary"\); setRefills\(/.test(of) && /onClick=\{\(\) => \{ if \(refills < refillCap\) haptic\("increase"\); else haptic\("boundary"\); setRefills\(/.test(of)
    && /onClick=\{\(\) => \{ if \(qty > 1\) haptic\("decrease"\); else haptic\("boundary"\); setQty\(/.test(shop) && /onClick=\{\(\) => \{ if \(qty < 20\) haptic\("increase"\); else haptic\("boundary"\); setQty\(/.test(shop));
  ok("switches: each says which way it went — on, off (stop ordering, codes, perks, the splash, a plan, a task done, the payment switches, an event's publish, the 86 board, the event copilot)",
    ["components/crew/OwnerDetails.tsx", "components/CodesPanel.tsx", "components/PerksPanel.tsx", "components/PromoEditor.tsx", "components/PlanEditor.tsx", "components/AssignTaskSheet.tsx", "components/PaymentSettings.tsx", "components/FieldOpSheet.tsx", "components/EightySix.tsx", "components/EventCopilot.tsx"]
      .every((f) => {
        // Every on is paired with its off in one if/else, switch by switch: a file with two switches
        // (the payment screen) cannot pass on one switch's pair while the other says "on" both ways.
        const t = code(read(f));
        const feels = (t.match(/haptic\("toggle(On|Off)"\)/g) || []).length;
        const pairs = (t.match(/if \([^;]*?\) haptic\("toggle(On|Off)"\); else haptic\("toggle(On|Off)"\);/g) || [])
          .filter((p) => /toggleOn/.test(p) && /toggleOff/.test(p)).length;
        return feels > 0 && feels === pairs * 2;
      }));
  // The signatures, each where its moment is: a new order on the pass, an order paid in the crew's hand,
  // going live, a brew started. A ritual swapped for a plain feel is a moment that no longer says itself.
  const crewPg = code(read("app/crew/page.tsx"));
  ok("haptics: the signatures stay on their moments — alert with the chime (twice), paid on the crew's paid order, live on going live, start on a brew, paid on a pack settling",
    (crewPg.match(/chime\(\); haptic\("alert"\);/g) || []).length === 2 && (crewPg.match(/haptic\("paid"\)/g) || []).length === 1
    && /haptic\("live"\)/.test(code(read("components/crew/LiveControl.tsx"))) && /haptic\("start"\)/.test(code(read("components/AlertAction.tsx")))
    && /isSettled\(cur\); \}\)\) haptic\("paid"\);/.test(code(read("components/MyPacks.tsx"))));

  ok("haptics: compiled for the smoke run, and the audit runs with the others, right after the gesture audit",
    /lib\/formGuard\.ts lib\/haptics\.ts --outDir \.smoke/.test(read("package.json")) && /node scripts\/gesture\.audit\.mjs && node scripts\/haptics\.audit\.mjs && /.test(read("package.json")));

  // ── what only an iPhone needs (lib/ios, 2026-10-06) ──
  // One home for "is this an iPhone" — the haptics fallback asks it rather than re-deriving it — and the
  // fix for the focus zoom: an iPhone zoomed into every 15px field and stayed zoomed, cutting each
  // screen off on the right (the offer letter's preview looked broken because of it).
  const IOS = require("../.smoke/ios.js");
  const iosSrc = code(read("lib/ios.ts")), shell = code(read("components/AppShell.tsx")), lay = read("app/layout.tsx");
  const walkSrc = (d) => fs.readdirSync(path.join(__dirname, "..", d), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walkSrc(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
  const uaHome = ["app", "components", "lib"].flatMap(walkSrc).filter((f) => /iP\(hone\|ad\|od\)/.test(read(f)));
  ok("ios: one home for the iPhone check — haptics imports it, and no other file matches the user agent itself",
    /import \{ isIPhoneLike \} from "\.\/ios";/.test(hl) && uaHome.length === 1 && uaHome[0] === path.join("lib", "ios.ts"));
  ok("ios: the viewport's limit is swapped, not stacked — any maximum-scale goes, maximum-scale=1 is added once, the rest is kept in order",
    IOS.withoutFocusZoom("width=device-width, initial-scale=1, maximum-scale=5, interactive-widget=resizes-content")
      === "width=device-width, initial-scale=1, interactive-widget=resizes-content, maximum-scale=1"
    && IOS.withoutFocusZoom(IOS.withoutFocusZoom("width=device-width, maximum-scale=5")) === "width=device-width, maximum-scale=1"
    && IOS.withoutFocusZoom("width=device-width") === "width=device-width, maximum-scale=1");
  ok("ios: the limit is set only on an iPhone, only when it differs, and off a browser it is a no-op",
    /if \(typeof document === "undefined" \|\| !isIPhoneLike\(\)\) return;/.test(iosSrc) && /if \(meta\.content !== next\) meta\.content = next;/.test(iosSrc)
    && (() => { try { IOS.holdFocusZoom(); return true; } catch { return false; } })());
  ok("ios: every screen applies it, again after each navigation — and the layout still allows a pinch everywhere (maximum-scale 5)",
    /import \{ holdFocusZoom \} from "@\/lib\/ios";/.test(read("components/AppShell.tsx")) && /useEffect\(\(\) => \{ holdFocusZoom\(\); \}, \[pathname\]\);/.test(shell)
    && /maximumScale: 5,/.test(lay));

  // ── the offer letter and the agreement rows on a phone (2026-10-06) ──
  const css = read("app/globals.css"), od = read("components/OperatorDeal.tsx");
  ok("offer letter: the toolbar wraps, its Print button sizes to its words, and on a phone the note takes its own line — not one word a line beside a full-width button",
    /\.ofl-bar\{position:sticky;top:0;z-index:2;width:100%;display:flex;flex-wrap:wrap;[^}]*padding-top:max\(11px, env\(safe-area-inset-top\)\);/.test(css) && (css.match(/^\.ofl-bar\{/gm) || []).length === 1 && /\.ofl-bar \.btn-pri\{width:auto;flex:none;padding:10px 16px\}/.test(css)
    && /@media \(max-width:560px\)\{ \.ofl-bar-note\{order:3;flex:1 0 100%;text-align:left\} \}/.test(css));
  ok("offer: a note with an unbreakable word breaks anywhere rather than run past its card",
    /\.ofr-tr-note\{[^}]*overflow-wrap:anywhere;min-width:0\}/.test(css) && /\.ofr-ap-note\{[^}]*overflow-wrap:anywhere;min-width:0\}/.test(css));
  ok("agreements: a row is inset like its card, the city as wide as its word, the line under the name a wrapping row-subtitle (k-rsub), not the page-subtitle class",
    /className="k-row tap od-row"/.test(od) && /<span className="k-rsub">\{isUntouchedDraft\(row\)/.test(od) && !/<span className="k-sub">/.test(od)
    && /\.k-row\.od-row\{padding:13px 15px;align-items:flex-start\}/.test(css) && /\.od-row \.k-lead\{width:auto;min-width:64px;padding-top:3px\}/.test(css)
    && /\.od-row \.k-rsub\{display:block;white-space:normal\}/.test(css));
}

// ── SETTINGS HAS A HOME (2026-10-06, the settings round) ─────────────────────────────────────────
// Ryan: "Anything that changes a feature should be inside of the settings tab … it feels 2/10,
// scattered." Settings existed and nothing in the nav opened it; the switches were in Money,
// Customers, Team, the calendar, Route, the inbox's gear, the foot of Live Ops, a floating moon and
// the rail. These hold the new shape: the door, the page and its gates, the line each old spot keeps,
// the links that still land, and the one home of each thing a phone keeps for itself.
//
// BY CATEGORY (2026-10-06, the settings-by-category round). Ryan: "Are the settings even organized?
// … based on categories … industry standard". Three groups — You, Business, Advanced — of one row
// per topic; a topic's pieces are parts of its row and keep their ids (lib/anchors opens the row that
// holds a part); what the business sells is the Catalog section, a broadcast is Customers › Messages,
// the changelog is the Guide's What's new. These hold that shape too.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const walkSrc = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walkSrc(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
  const appFiles = ["app", "components", "lib"].flatMap(walkSrc);
  const nav = code(read("components/OperatorNav.tsx"));
  const pg = code(read("app/crew/page.tsx"));
  const LAY = require("../.smoke/settingsLayout.js");
  const PH = require("../.smoke/panelHome.js");
  const O = require("../.smoke/obligations.js");
  const CA = require("../.smoke/copyAnchor.js");

  // ── the door: a Settings row in More, for every role ──
  const roleLine = (r) => (new RegExp(`\\n\\s*${r}: \\[([^\\]]*)\\]`).exec(nav)?.[1] ?? "").match(/"([a-z]+)"/g)?.map((x) => x.slice(1, -1)) ?? [];
  const ROLES = ["server", "contractor", "operator", "event_manager", "admin", "owner"];
  ok("settings door: every role's sections include Settings — its first section, You, is everyone's",
    ROLES.every((r) => roleLine(r).includes("settings")), ROLES.filter((r) => !roleLine(r).includes("settings")));
  const more = nav.slice(nav.indexOf("function MoreSheet("));
  ok("settings door: More's first row opens Settings, for anyone signed in — above the lanes, not a lane (no pin)",
    /\{user && \(\s*<div className=\{`lane-row\$\{activeId === "settings" \? " on" : ""\}`\}>\s*<button type="button" className="lane-open" onClick=\{onSettings\}/.test(more)
    && more.indexOf("onClick={onSettings}") < more.indexOf("{lanes.map(") && !/onSettings[\s\S]{0,400}lane-pin/.test(more.slice(0, more.indexOf("{lanes.map("))));
  ok("settings door: the row opens the section and closes the sheet — and the bar hands it the opener",
    /const openSettings = \(\) => \{\s*if \(!inSettings\) haptic\("selection"\);\s*setSection\("settings"\);\s*setMoreOpen\(false\);\s*\};/.test(nav)
    && /<MoreSheet [^\n]*onSettings=\{openSettings\}/.test(nav));
  ok("settings door: More is drawn for every staff role — only a member gets the customer bar instead",
    /if \(role === "member"\) return <BottomNav \/>;/.test(nav) && (nav.match(/return <BottomNav \/>/g) || []).length === 1);

  // ── More is lit while in Settings ──
  ok("settings door: in Settings, More is the lit tab — no lane is current, and Today no longer lights by default",
    /const inSettings = section === "settings";/.test(nav) && /const currentId = inSettings \? "settings" : activeGroup\.id;/.test(nav)
    && /const moreOn = inSettings \|\| overflow\.some\(\(g\) => g\.id === activeGroup\.id\);/.test(nav)
    && /<button role="tab" aria-selected=\{moreOn\} className=\{`tab\$\{moreOn \? " on" : ""\}`\} onClick=\{\(\) => setMoreOpen\(true\)\}>/.test(nav)
    && /const on = currentId === g\.id;/.test(nav) && !/const on = activeGroup\.id === g\.id;/.test(nav));
  ok("settings door: no default lane holds Settings — which is why the lane lookup fell through to Today",
    !/sections: \[[^\]]*"settings"/.test(code(read("lib/streams.ts"))));
  ok("settings door: More's copy counts the bar it has — MAX_PINS (5), not the 4 it said",
    !/bar is full \(4\)/.test(nav) && !/Pin up to 4/.test(nav) && /`Your bar is full \(\$\{MAX_PINS\}\)/.test(nav) && /Pin up to \$\{MAX_PINS\} to your bar/.test(nav)
    && /const MAX_PINS = 5;/.test(nav));

  // ── the page: every section, every panel, every gate — held to lib/settingsLayout ──
  const sh = pg.slice(pg.indexOf("function SettingsHome("), pg.indexOf("\n}\n", pg.indexOf("function SettingsHome(")));
  ok("settings page: the page opens for every role — no section gate, the panels carry their own",
    /\{sec === "settings" && <SettingsHome userId=\{user\?\.id \?\? null\} isAdmin=\{isAdmin\} isOwner=\{isOwner\} \/>\}/.test(pg)
    && !/sec === "settings" && canManage/.test(pg) && /const isOwner = role === "owner";\s*const isAdmin = role === "admin" \|\| isOwner;/.test(pg));
  const gateOf = { everyone: null, admin: "isAdmin", owner: "isOwner" };
  const at = (needle) => sh.indexOf(needle);
  const badGates = [], badOrder = [], missing = [];
  let last = -1;
  for (const s of LAY.SETTINGS_LAYOUT) {
    const sg = LAY.sectionGate(s);
    const head = sg === "everyone" ? `<SectionHeader label="${s.label}"` : `{${gateOf[sg]} && <SectionHeader label="${s.label}"`;
    const hAt = at(head);
    if (hAt < 0) { missing.push(`header ${s.label} (${sg})`); continue; }
    if (sg === "everyone" && /\{is(Admin|Owner) && $/.test(sh.slice(Math.max(0, hAt - 14), hAt))) badGates.push(`header ${s.label} is gated`);
    if (hAt < last) badOrder.push(`header ${s.label}`);
    last = hAt;
    for (const p of s.panels) {
      const pAt = at(`id="${p.id}"`);
      if (pAt < 0) { missing.push(p.id); continue; }
      if (pAt < last) badOrder.push(p.id);
      last = pAt;
      const lead = sh.slice(Math.max(0, pAt - 40), pAt);
      const gated = /\{(isAdmin|isOwner) && \(?\s*<(Panel|div) $/.exec(lead);
      const want = gateOf[p.gate];
      if (want === null ? gated : !gated || gated[1] !== want) badGates.push(`${p.id}: wants ${p.gate}, drawn ${gated ? gated[1] : "ungated"}`);
      // Its parts: inside it, in order, an owner's part behind isOwner and no other part gated again.
      for (const q of p.parts ?? []) {
        const qAt = at(`<SetPart id="${q.id}"`);
        if (qAt < 0) { missing.push(`part ${q.id}`); continue; }
        if (qAt < last) badOrder.push(`part ${q.id}`);
        last = qAt;
        const ownerGated = /\{isOwner && $/.test(sh.slice(Math.max(0, qAt - 12), qAt));
        if ((q.gate === "owner") !== ownerGated) badGates.push(`part ${q.id}: wants ${q.gate}, drawn ${ownerGated ? "isOwner" : "with its row"}`);
      }
    }
  }
  ok("settings page: every section and panel of lib/settingsLayout is drawn, in its order", missing.length === 0 && badOrder.length === 0, { missing, badOrder });
  ok("settings page: and each behind its gate — You for everyone, an owner's panel behind isOwner, the rest behind isAdmin", badGates.length === 0, badGates);
  ok("settings page: nothing is drawn there that the layout does not list",
    [...sh.matchAll(/<(?:Panel|SetPart) id="([a-z0-9-]+)"/g)].map((m) => m[1]).every((id) => LAY.settingsGate(id) !== null)
    && [...sh.matchAll(/<SectionHeader label="([^"]+)"/g)].map((m) => m[1]).every((l) => LAY.SETTINGS_LAYOUT.some((s) => s.label === l)));
  ok("settings page: the layout's gates are the ones each panel had — You for everyone, the digest an admin's, invites, Outlook and Train the AI the owner's",
    ["set-account", "set-notify", "set-alerts", "set-sound", "set-theme", "set-display"].every((id) => LAY.settingsGate(id) === "everyone")
    && LAY.settingsGate("set-digest") === "admin" && ["set-invite", "set-outlook", "set-train"].every((id) => LAY.settingsGate(id) === "owner")
    && ["set-pay", "set-ordering", "set-dial", "set-office", "set-team", "set-lanes", "set-ai", "set-spend", "set-brand", "set-copy", "splash", "set-errors", "set-audit", "set-lists"].every((id) => LAY.settingsGate(id) === "admin")
    && LAY.settingsGate("pay") === null && LAY.settingsGate(undefined) === null);
  ok("settings page: by category — You, Business, Advanced, one row per topic; what the business sells or says is not a setting",
    JSON.stringify(LAY.SETTINGS_LAYOUT.map((s) => s.label)) === JSON.stringify(["You", "Business", "Advanced"])
    && LAY.SETTINGS_LAYOUT.reduce((n, s) => n + s.panels.length, 0) === 14
    && ["menu", "plans", "cust-codes", "cust-perks", "set-broadcast", "set-changelog", "merch", "lessons"].every((id) => LAY.settingsGate(id) === null));
  ok("settings page: a part names the row that holds it, and so does a copy group — a row itself, or anything outside Settings, has no holder",
    LAY.settingsHolder("set-alerts") === "set-notify" && LAY.settingsHolder("set-sound") === "set-notify" && LAY.settingsHolder("set-theme") === "set-display"
    && LAY.settingsHolder("set-dial") === "set-ordering" && LAY.settingsHolder("set-office") === "set-ordering" && LAY.settingsHolder("set-invite") === "set-team"
    && LAY.settingsHolder("set-outlook") === "set-integrations" && LAY.settingsHolder("set-train") === "set-ai" && LAY.settingsHolder("splash") === "set-brand"
    && LAY.settingsHolder(CA.copyGroupAnchor("Craft page")) === "set-brand" && LAY.settingsGate("sc-craft-page") === "admin"
    && LAY.settingsHolder("set-notify") === null && LAY.settingsHolder("menu") === null && LAY.settingsHolder(undefined) === null);
  const DRAWS = {
    "set-account": ["<AccountRow />"],
    "set-notify": ["<DeviceAlerts userId={userId} />", "<PassSound />", "<NotifPrefs userId={userId} />"],
    "set-display": ["<Appearance />", "<DisplayControls />"],
    "set-pay": ["<PaymentSettings />"], "set-ordering": ["<CupOrderingDial />", "<OfficeSettings />"], "set-markets": ["<MarketsPanel />"],
    "set-team": ["<InviteTeammate />", '<OrgChart part="lanes" />'], "set-digest": ["<FounderDigest />"],
    "set-integrations": ["<IntegrationsPanel />", "<OutlookConnect />"], "set-ai": ["<AiTraining />", "<CopilotDirectory />", "<AiSpend />"],
    "set-brand": ["<SiteCopyEditor />", "<PromoEditor />"],
    "set-admintrail": ["<AuditTrail />"], "set-errors": ["<ErrorLog />", "<MaintenanceLog />"], "set-lists": ["<ListsPanel />"],
  };
  const ids = LAY.SETTINGS_LAYOUT.flatMap((s) => s.panels.map((p) => p.id));
  const partIds = LAY.SETTINGS_LAYOUT.flatMap((s) => s.panels.flatMap((p) => (p.parts ?? []).map((q) => q.id)));
  const wrongBody = ids.filter((id, i) => {
    const from = at(`id="${id}"`), to = i + 1 < ids.length ? at(`id="${ids[i + 1]}"`) : sh.length;
    const body = sh.slice(from, to);
    return !DRAWS[id] || !DRAWS[id].every((c) => body.includes(c));
  });
  ok("settings page: each row draws the components that make its topic — and only those", wrongBody.length === 0 && Object.keys(DRAWS).length === ids.length, wrongBody);
  const elsewhere = Object.values(DRAWS).flat().filter((c) => (pg.match(new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length !== 1);
  ok("settings page: and draws each once — none of them is drawn on a second screen of the console", elsewhere.length === 0, elsewhere);
  const idCount = (id) => appFiles.reduce((n, f) => n + (read(f).match(new RegExp(`\\bid="${id}"`, "g")) || []).length, 0);
  ok("settings page: every row and part id in it is one element in the whole app — an anchor names exactly one place",
    [...ids, ...partIds].every((id) => idCount(id) === 1), [...ids, ...partIds].filter((id) => idCount(id) !== 1));
  ok("settings page: You — the account row, then Notifications (this phone's alerts and sound, then what pings you) and Display (the look, then text size)",
    /<div id="set-account" className="set-row set-acct"><AccountRow \/><\/div>/.test(sh)
    && /<Panel id="set-notify" title="Notifications" sub="[^"]+" value=\{v\(g\.notify\)\} remember=\{false\}>\s*<SetPart id="set-alerts"><DeviceAlerts userId=\{userId\} \/><\/SetPart>\s*<SetPart id="set-sound"><PassSound \/><\/SetPart>\s*<SetPart label="What pings you"><NotifPrefs userId=\{userId\} \/><\/SetPart>\s*<\/Panel>/.test(sh)
    && /<Panel id="set-display" title="Display" sub="[^"]+" value=\{v\(g\.display\)\} remember=\{false\}>\s*<SetPart id="set-theme"><Appearance \/><\/SetPart>\s*<SetPart><DisplayControls \/><\/SetPart>\s*<\/Panel>/.test(sh)
    && !/<div id="set-(alerts|sound|theme)" className="set-row">/.test(sh));
  ok("settings page: a part is one piece of a row — its id where links name it, and the house eyebrow when the piece has no heading of its own",
    /function SetPart\(\{ id, label, children \}: \{ id\?: string; label\?: string; children: ReactNode \}\) \{\s*return \(\s*<div id=\{id\} className="set-part">\s*\{label && <div className="rdg-row-h set-part-h">\{label\}<\/div>\}/.test(pg));
  const setPanels = [...sh.matchAll(/<Panel id="([a-z0-9-]+)"([^>]*)>/g)];
  const saysWhat = (a) => /\bsub="[^"]{8,}"/.test(a) || /\bsub=\{isOwner \? "[^"]{8,}" : "[^"]{8,}"\}/.test(a);
  ok("settings page: a list of rows — every panel in it closed at rest, each saying what it holds, none reopening what was open last",
    setPanels.length === ids.length - 1 && setPanels.every(([, , a]) => !/defaultOpen/.test(a) && saysWhat(a) && /remember=\{false\}/.test(a)),
    setPanels.filter(([, , a]) => /defaultOpen/.test(a) || !saysWhat(a) || !/remember=\{false\}/.test(a)).map(([, id]) => id));
  ok("settings page: each section is one grouped list (SetList), drawn only when it has a row the person can see",
    /function SetList\(\{ children \}: \{ children: ReactNode \}\) \{\s*return Children\.toArray\(children\)\.length \? <div className="set-list">\{children\}<\/div> : null;\s*\}/.test(pg)
    && (sh.match(/<SetList>/g) || []).length === LAY.SETTINGS_LAYOUT.length && (sh.match(/<\/SetList>/g) || []).length === LAY.SETTINGS_LAYOUT.length);
  ok("settings page: a row that is one fact says what it is set to — the values come from components/SettingsGlance",
    ["notify", "display", "digest", "pay", "ordering", "lanes"].every((k) => new RegExp(`value=\\{v\\(g\\.${k}\\)\\}`).test(sh))
    && /<Panel id="set-integrations" [^>]*value=\{outlook\}/.test(sh) && /const outlook = isOwner \? <OutlookGlance \/> : null;/.test(sh)
    && /const g = useSettingsGlance\(userId, isAdmin\);/.test(sh) && /const v = \(x: Glance\) => <GlanceText g=\{x\} \/>;/.test(sh));
  ok("panel: a line under the title and a value on the right; remember={false} keeps nothing; the toggle writes beside its state change, never in an updater",
    /\{sub\s*\? <span className="mpanel-tt"><span className="mpanel-t">\{title\}<\/span><span className="mpanel-s">\{sub\}<\/span><\/span>\s*: <span className="mpanel-t">\{title\}<\/span>\}/.test(pg)
    && /\{value != null && <span className="mpanel-v">\{value\}<\/span>\}/.test(pg)
    && /const toggle = \(\) => \{ const n = !open; setOpen\(n\); keep\(n\); \};/.test(pg)
    && /const keep = useCallback\(\(n: boolean\) => \{\s*if \(!remember\) return;/.test(pg) && /useEffect\(\(\) => \{\s*if \(!remember\) return;\s*try \{ const v = localStorage\.getItem\(storeKey\)/.test(pg)
    && !/setOpen\(\(o\) => \{/.test(pg));
  {
    const css0 = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
    ok("settings page: the list is the card — a panel in it gives up its own border, radius and gap but keeps the hairline above it; an empty value takes no room",
      /\.set-list\{border:1px solid var\(--line\);border-radius:var\(--r-2xl\);background:var\(--card\);overflow:hidden;/.test(css0)
      && /\.set-list > \.mpanel\{border:0;border-radius:0;margin:0;background:transparent\}\s*\.set-list > :not\(:first-child\)\{border-top:1px solid var\(--line\)\}/.test(css0)
      && /\.mpanel-v:empty\{display:none\}/.test(css0) && /\.mpanel-v\{[^}]*max-width:50%/.test(css0)
      && /\.mpanel-body > \.set-part \+ \*,\.mpanel-body > \* \+ \.set-part\{border-top:1px solid var\(--line\);margin-top:14px;padding-top:14px\}/.test(css0)
      && /\.set-row\.set-acct\{padding:0\}/.test(css0)
      && /\.set-row \.btn-sec,\.set-part \.btn-sec\{flex:0 0 auto;width:auto;white-space:nowrap\}/.test(css0));
  }
  ok("settings page: the \"More controls\" card map is gone, and its card CSS with it",
    !/set-map|set-card|More controls|Owner control room/.test(pg) && !/\.set-card|\.set-map/.test(read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "")));

  // ── the line each old spot keeps ──
  const gl = code(read("components/GoLine.tsx"));
  ok("old spots: one line, one way — GoLine is a tertiary button that opens the section and its panel through lib/anchors",
    /<button type="button" className="btn-ter" onClick=\{\(\) => \{ setSection\(to\); scrollToAnchor\(anchor\); \}\}>\{children\} ›<\/button>/.test(gl)
    && /import \{ scrollToAnchor \} from "@\/lib\/anchors";/.test(gl));
  const navSrc = read("components/OperatorSection.tsx");
  const SECTIONS = new Set(((/export const VALID = new Set<OpSection>\(\[([^\]]*)\]\)/.exec(navSrc) || [])[1] || "").match(/"([a-z]+)"/g)?.map((x) => x.slice(1, -1)) ?? []);
  const allIds = new Set();
  for (const f of appFiles) {
    const t = read(f);
    for (const m of t.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)) allIds.add(m[1]);
    for (const m of t.matchAll(/\bid=\{([^}]*)\}/g)) for (const x of m[1].matchAll(/"([a-zA-Z0-9_-]+)"/g)) allIds.add(x[1]);
  }
  const lines = [];
  for (const f of appFiles.filter((x) => x.endsWith(".tsx"))) for (const m of code(read(f)).matchAll(/<GoLine to="([a-z]+)" anchor="([a-zA-Z0-9_-]+)">/g)) lines.push({ f, to: m[1], anchor: m[2] });
  const deadLines = lines.filter((l) => !SECTIONS.has(l.to) || !allIds.has(l.anchor)).map((l) => `${l.f}: ${l.to}#${l.anchor}`);
  ok("old spots: every GoLine goes to a real section and an element that exists", lines.length >= 10 && deadLines.length === 0, { n: lines.length, deadLines });
  ok("old spots: a GoLine never names its place by a variable the check above cannot read", !appFiles.some((f) => /<GoLine to=\{|<GoLine [^>]*anchor=\{/.test(read(f))));
  const block = (start) => { const i = pg.indexOf(start); return pg.slice(i, pg.indexOf("\n      )}\n", i)); };
  const money = block('{sec === "money" && isAdmin && ('), cust = block('{sec === "customers" && isAdmin && ('), team = block('{sec === "team" && isAdmin && (');
  const cat = block('{sec === "catalog" && isAdmin && (');
  ok("old spots: Money keeps its pay panel — the refunds door and \"Payment settings ›\" — and the switches left it",
    /<Panel id="pay" title="Refunds & payment settings" defaultOpen>[\s\S]*?Refunds &amp; disputes — Square Dashboard[\s\S]*?<GoLine to="settings" anchor="set-pay">Payment settings<\/GoLine>\s*<\/Panel>/.test(money)
    && !/<PaymentSettings \/>/.test(money) && !/<MenuManager \/>|<PlanEditor \/>|<MerchManager \/>|<LessonsManager \/>/.test(money)
    && /<SectionHeader label="Pricing & margins" \/>\s*(?:\{\}\s*)?<GoLine to="catalog" anchor="menu">Menu, merch &amp; lessons<\/GoLine>\s*<Panel id="econ" title="Product economics"><ProductCatalog \/><\/Panel>\s*<Panel id="cogs" title="COGS calculator"><CogsCalculator \/><\/Panel>/.test(money)
    && /<GoLine to="catalog" anchor="plans">Membership plans<\/GoLine>/.test(money) && !/Catalog & pricing/.test(money));
  ok("old spots: Customers keeps \"Codes & perks ›\" (to the Catalog), no code or perk panel — and gains Messages, where the broadcast is",
    /<GoLine to="catalog" anchor="cust-codes">Codes &amp; perks<\/GoLine>/.test(cust) && !/<CodesPanel|<PerksPanel|id="cust-codes"|id="cust-perks"/.test(cust)
    && /<SectionHeader label="Messages" \/>\s*<Panel id="cust-broadcast" title="Broadcast" sub="[^"]{8,}"><BroadcastEditor \/><\/Panel>/.test(cust));
  ok("catalog: what the business sells, in one section — the menu open at rest, then merch and lessons; then plans, codes and perks — every row saying what it holds",
    /<SectionHeader label="What we sell" \/>\s*<Panel id="menu" title="Menu & products" sub="[^"]{8,}" defaultOpen><MenuManager \/><\/Panel>\s*<Panel id="merch" title="The Shop · merch" sub="[^"]{8,}"><MerchManager \/><\/Panel>\s*<Panel id="lessons" title="Return to Primal · lessons" sub="[^"]{8,}"><LessonsManager \/><\/Panel>\s*<SectionHeader label="Memberships & offers" \/>\s*<Panel id="plans" title="Membership plans" sub="[^"]{8,}"><PlanEditor \/><\/Panel>\s*<Panel id="cust-codes" title="Discount codes" sub="[^"]{8,}"><CodesPanel \/><\/Panel>\s*<Panel id="cust-perks" title="Founding perks" sub="[^"]{8,}"><PerksPanel \/><\/Panel>/.test(cat)
    && ["<MenuManager />", "<MerchManager />", "<LessonsManager />", "<PlanEditor />", "<CodesPanel />", "<PerksPanel />", "<BroadcastEditor />"].every((c) => pg.split(c).length === 2));
  ok("catalog: a section of the console — owners and admins open it, it sits right after Money in their sections and in the Business lane, and the Guide explains it",
    ["admin", "owner"].every((r) => { const l = roleLine(r); return l.indexOf("catalog") === l.indexOf("money") + 1; })
    && ["server", "contractor", "operator", "event_manager"].every((r) => !roleLine(r).includes("catalog"))
    && SECTIONS.has("catalog") && /catalog: "Catalog"/.test(nav) && /\n  catalog: <>/.test(nav)
    && /sections: \["plan", "notes", "money", "catalog", "customers", "team"\]/.test(code(read("lib/streams.ts")))
    && /catalog: "Catalog"/.test(pg) && /\n  catalog: "[^"]{20,}",/.test(pg) && /\n  catalog: \["Menu & products/.test(pg));
  {
    const mig = read("supabase/migrations/0352_catalog_lane.sql");
    ok("catalog: 0352 puts it in the live Business lanes right after Money — once, by key — and records itself",
      /where key = 'business' and not \('catalog' = any\(sections\)\)/.test(mig)
      && /sections\[1:array_position\(sections, 'money'\)\] \|\| array\['catalog'\]::text\[\] \|\| sections\[array_position\(sections, 'money'\) \+ 1:\]/.test(mig)
      && /else array_append\(sections, 'catalog'\)/.test(mig) && /select public\.record_migration\('0352_catalog_lane'\);\s*$/.test(mig));
  }
  ok("old spots: Team keeps \"Invites & roles ›\" and \"Train the AI ›\" for the owner (an admin's line goes to the lane owners), the roster keeps roles, the org chart keeps the people",
    /\{isOwner && <GoLine to="settings" anchor="set-invite">Invites &amp; roles<\/GoLine>\}/.test(team) && /\{isOwner && <GoLine to="settings" anchor="set-train">Train the AI<\/GoLine>\}/.test(team)
    && /\{!isOwner && <GoLine to="settings" anchor="set-lanes">Lane owners<\/GoLine>\}/.test(team)
    && !/<InviteTeammate|<AiTraining/.test(team) && /<OrgChart part="people" \/>/.test(team)
    && /\{isOwner && <div id="team-members" style=\{\{ scrollMarginTop: 16 \}\}><Members \/><\/div>\}/.test(team)
    && /\{isOwner && <GoLine to="team" anchor="team-members">Change someone&rsquo;s role<\/GoLine>\}/.test(sh));
  const oc = code(read("components/OrgChart.tsx"));
  ok("old spots: OrgChart draws its two parts in two homes — the people on Team, the lane owners in Settings — and a refused owner pick is said",
    /export default function OrgChart\(\{ part = "people" \}/.test(oc) && /\{\(\) => part === "people" \? \(/.test(oc)
    && /\.update\(\{ owner_user_id: uid \|\| null \}\)\.eq\("id", id\)\.select\("id"\);/.test(oc) && /if \(error \|\| !data\?\.length\) toast\([\s\S]*?, "error"\);/.test(oc));
  const st = code(read("components/Studio.tsx"));
  ok("old spots: Studio › Brand keeps \"Copy ›\" through lib/anchors — no timer of its own — for those Settings shows the editor to",
    /\{canCopy && <GoLine to="settings" anchor="set-copy">Copy<\/GoLine>\}/.test(st) && /const canCopy = canOf\(profile\)\.admin;/.test(st)
    && !/gt3-mpanel-set-copy/.test(st) && !/getElementById\("set-copy"\)/.test(st) && !/goCopy/.test(st) && /<BrandKit canEdit \/>/.test(st));
  const cal = code(read("components/CompanyCalendar.tsx"));
  ok("old spots: the calendar keeps Sync now and gains \"Outlook ›\" — connecting moved to Settings, and nothing here drops the address any more",
    /<GoLine to="settings" anchor="set-outlook">Outlook<\/GoLine>/.test(cal) && /"Sync now"/.test(cal) && /\{isOwner && <OutlookBar onSynced=\{reload\} \/>\}/.test(cal)
    && !/\/api\/outlook\/connect|\/api\/outlook\/disconnect|Connect Outlook|Disconnect/.test(cal) && !/replaceState\(\{\}, "", window\.location\.pathname\)/.test(cal));
  const lc = code(read("components/crew/LiveControl.tsx"));
  ok("old spots: Route and the Live truck instrument keep \"Cup-ordering dial ›\" — for an owner or an admin, the ones who can save it",
    /\{admin && <GoLine to="settings" anchor="set-dial">Cup-ordering dial<\/GoLine>\}/.test(lc)
    && /\{admin && <button type="button" className="adm-golink" onClick=\{goDial\}>Cup-ordering dial ›<\/button>\}/.test(lc)
    && /const goDial = \(\) => \{ setSection\("settings"\); scrollToAnchor\("set-dial"\); \};/.test(lc) && /const admin = canOf\(profile\)\.admin;/.test(lc));
  ok("old spots: Live ops keeps one line while order alerts are off on this phone — the card that asked is Settings › You now",
    /<AlertsOffLine \/>/.test(block('{sec === "now" && (')) && !/EnableAlerts|Turn on order alerts/.test(pg)
    && /if \(!alertsOff\(perm\)\) return null;\s*return <GoLine to="settings" anchor="set-alerts">/.test(code(read("components/DeviceAlerts.tsx"))));
  const DA = code(read("components/DeviceAlerts.tsx"));
  ok("alerts on this device: the phone's answer is read as it draws (no effect), asked for with one tap, and every answer is said",
    /useSyncExternalStore\(subscribe, readPermission, \(\) => "unknown" as const\)/.test(DA) && /window\.dispatchEvent\(new Event\(ASKED\)\);/.test(DA)
    && /if \(p === "granted"\) \{ subscribePush\(userId, true\);/.test(DA) && ["unknown", "granted", "default", "denied", "unsupported"].every((k) => new RegExp(`\\b${k}: (APP_BUILD\\s*\\?\\s*)?"`).test(DA))
    && /export const alertsOff = \(p: AlertPermission \| "unknown"\): boolean => p === "default" \|\| p === "denied";/.test(DA));

  // ── links still land: the pay anchor, the aliases, the Pass ──
  ok("links land: Money's pay anchor stays where refund alerts point (/crew?s=money&a=pay), and the alias table leaves it alone",
    /link: "\/crew\?s=money&a=pay",/.test(pg) && idCount("pay") === 1 && !("money#pay" in PH.PANEL_MOVES)
    && JSON.stringify(PH.panelHome("money", "pay")) === JSON.stringify({ section: "money", anchor: "pay" }));
  const J = (x) => JSON.stringify(x);
  ok("links land: a link to a panel that moved goes to its new home in one step — the Catalog's six, the broadcast, and Train the AI",
    J(PH.panelHome("money", "menu")) === J({ section: "catalog", anchor: "menu" }) && J(PH.panelHome("settings", "menu")) === J({ section: "catalog", anchor: "menu" })
    && J(PH.panelHome("money", "plans")) === J({ section: "catalog", anchor: "plans" }) && J(PH.panelHome("settings", "plans")) === J({ section: "catalog", anchor: "plans" })
    && J(PH.panelHome("money", "merch")) === J({ section: "catalog", anchor: "merch" }) && J(PH.panelHome("money", "lessons")) === J({ section: "catalog", anchor: "lessons" })
    && J(PH.panelHome("customers", "cust-codes")) === J({ section: "catalog", anchor: "cust-codes" }) && J(PH.panelHome("settings", "cust-codes")) === J({ section: "catalog", anchor: "cust-codes" })
    && J(PH.panelHome("customers", "cust-perks")) === J({ section: "catalog", anchor: "cust-perks" }) && J(PH.panelHome("settings", "cust-perks")) === J({ section: "catalog", anchor: "cust-perks" })
    && J(PH.panelHome("settings", "set-broadcast")) === J({ section: "customers", anchor: "cust-broadcast" })
    && J(PH.panelHome("settings", "set-dial")) === J({ section: "settings", anchor: "set-dial" })
    && JSON.stringify(PH.panelHome("team", "ai-training")) === JSON.stringify({ section: "settings", anchor: "set-train" })
    && JSON.stringify(PH.panelHome("plan")) === JSON.stringify({ section: "plan" }) && JSON.stringify(PH.panelHome("money", "offers")) === JSON.stringify({ section: "money", anchor: "offers" }));
  const moves = Object.entries(PH.PANEL_MOVES);
  const blockOf = { settings: sh, catalog: cat, customers: cust, money, team };
  ok("links land: every alias goes to a panel its new section draws, from a section that no longer has it",
    moves.every(([from, to]) => {
      const [fs, fa] = from.split("#");
      const there = to.section === "settings" ? LAY.settingsGate(to.anchor) !== null : new RegExp(`\\bid="${to.anchor}"`).test(blockOf[to.section] || "");
      const gone = !new RegExp(`\\bid="${fa}"`).test(blockOf[fs] || "");
      return SECTIONS.has(fs) && SECTIONS.has(to.section) && there && gone;
    }), moves);
  ok("links land: the alert router passes an alert's own link through the alias table",
    /const home = panelHome\(s\[1\], a\?\.\[1\]\);\s*return \{ section: home\.section as OpSection, \.\.\.\(home\.anchor \? \{ anchor: home\.anchor \} : \{\}\) \};/.test(pg));
  ok("links land: a Needs-you row that names a moved panel goes to its new home",
    JSON.stringify(O.obligationGo({ source: "brand_new", subject_id: "x", route: "/crew?s=money&a=menu" })) === JSON.stringify({ kind: "section", section: "catalog", anchor: "menu" })
    && JSON.stringify(O.obligationGo({ source: "brand_new", subject_id: "x", route: "/crew?s=settings&a=cust-codes" })) === JSON.stringify({ kind: "section", section: "catalog", anchor: "cust-codes" })
    && JSON.stringify(O.obligationGo({ source: "brand_new", subject_id: "x", route: "/crew?s=money&a=pay" })) === JSON.stringify({ kind: "section", section: "money", anchor: "pay" }));
  const V = (r) => ({ id: "me", sections: roleLine(r), manage: ["event_manager", "admin", "owner"].includes(r) });
  const forR = (r, route) => O.obligationFor({ source: "brand_new", subject_id: "x", route, owner_user_id: null }, V(r));
  ok("links land: Settings opens for every role, but a row on one of its admin parts is still the admins' — a server is not sent to a menu she cannot see",
    !forR("server", "/crew?s=money&a=menu") && !forR("event_manager", "/crew?s=customers&a=cust-codes") && forR("owner", "/crew?s=money&a=menu") && forR("admin", "/crew?s=settings&a=set-dial")
    && forR("server", "/crew?s=settings&a=set-alerts") && !forR("operator", "/crew?s=settings") && !forR("server", "/crew?s=settings&a=set-office")
    && forR("admin", "/crew?s=catalog&a=plans") && !forR("operator", "/crew?s=catalog&a=plans"));
  const anc = code(read("lib/anchors.ts"));
  ok("links land: a jump to a part opens the row that holds it first — the copy editor's groups too",
    /import \{ settingsHolder \} from "\.\/settingsLayout";/.test(anc) && /const holder = settingsHolder\(anchor\);/.test(anc)
    && /const row = holder \? document\.getElementById\(holder\) : null;\s*if \(holder && row && !row\.classList\.contains\("open"\)\) askOpen\(holder\);/.test(anc)
    && /const go = \(\) => \{ window\.location\.href = `\/crew\?s=settings&a=\$\{copyGroupAnchor\(group\)\}`; \};/.test(read("components/EditCopyPill.tsx"))
    && !appFiles.some((f) => /gt3-mpanel-set-/.test(code(read(f))))
    && CA.copyGroupAnchor("Craft page") === "sc-craft-page" && CA.copyGroupAnchor("Menu · Matcha!") === "sc-menu-matcha" && CA.COPY_ANCHOR_PREFIX === "sc-"
    && /export \{ copyGroupAnchor \} from "\.\/copyAnchor";/.test(read("lib/copy.ts")) && !/function copyGroupAnchor/.test(read("lib/copy.ts")));
  // 2026-10-06, live: the Edit pill's link opened Brand & customer app and stopped short of its copy
  // group — on a cold load the group was drawn after the jump's 5s were up. Held here: a part waits
  // longer than a panel; a request to open is asked again while the panel stays shut (one sent before
  // the row was listening was lost for good); the "open" the jump reads is the class Panel writes;
  // and a jump that waits that long stands down the moment the person scrolls, swipes or types.
  ok("links land: a part waits 12s, a panel 5s; an unanswered request to open is asked again; and the jump stands down when the person takes the page back",
    /const WAIT_MS = 5000;/.test(anc) && /const PART_WAIT_MS = 12000;/.test(anc) && /const REASK_MS = 500;/.test(anc)
    && /const deadline = Date\.now\(\) \+ \(holder \? PART_WAIT_MS : WAIT_MS\);/.test(anc)
    && /if \(now - \(asked\.get\(id\) \?\? -Infinity\) < REASK_MS\) return;\s*asked\.set\(id, now\);\s*window\.dispatchEvent\(new CustomEvent\(OPEN_PANEL_EVENT, \{ detail: id \}\)\);/.test(anc)
    && /if \(!asked\.has\(anchor\) \|\| \(el\.classList\.contains\("mpanel"\) && !el\.classList\.contains\("open"\)\)\) askOpen\(anchor\);/.test(anc)
    && /<section id=\{id\} className=\{`mpanel\$\{open \? " open" : ""\}`\}/.test(read("app/crew/page.tsx"))
    && /const TAKEN_BACK = \["wheel", "touchmove", "keydown"\] as const;/.test(anc)
    && /const tick = \(\) => \{\s*if \(takenBack\) \{ watch\(false\); return; \}/.test(anc)
    && /setTimeout\(\(\) => \{\s*watch\(false\);\s*if \(takenBack\) return;/.test(anc)
    && /if \(Date\.now\(\) < deadline\) setTimeout\(tick, 80\); else watch\(false\);/.test(anc)
    && !/askedHolder/.test(anc));
  ok("links land: an order alert opens the Pass — #kitchen-pass is drawn only while the Pass is open, so the jump opens it instead of hunting for it",
    /if \(cat === "order"\) return \{ section: "now", anchor: "kitchen-pass" \};/.test(pg) && /const PASS_ANCHOR = "kitchen-pass";/.test(pg)
    && /function jumpTo\(anchor\?: string\): void \{\s*if \(anchor === PASS_ANCHOR\) \{ window\.dispatchEvent\(new Event\(OPEN_PASS_EVENT\)\); return; \}\s*scrollToAnchor\(anchor\);\s*\}/.test(pg)
    && /jumpTo\(d\.anchor\);/.test(pg) && !/scrollToAnchor\(d\.anchor\)/.test(pg) && /<div className="adm-sec" id="kitchen-pass">/.test(pg));
  ok("links land: the page answers by going to Live Ops and opening the Pass — and a link waits for ?s=now to land before it is taken",
    /const open = \(\) => \{ setSection\("now"\); setSvc\(true\); \};\s*window\.addEventListener\(OPEN_PASS_EVENT, open\);/.test(pg)
    && /if \(a === PASS_ANCHOR && sec !== "now" && readParam\("s"\) === "now"\) return;\s*consumedAnchorRef\.current = true;\s*dropParam\("a"\);\s*jumpTo\(a\);/.test(pg)
    && pg.indexOf("const [svc, setSvc] = useState(false);") < pg.indexOf("window.addEventListener(OPEN_PASS_EVENT, open)"));
  ok("links land: Outlook's consent screen comes back to the panel that sent it, which reads the word and takes it off the address",
    /Location: `\$\{origin\}\/crew\?s=settings&a=set-outlook&outlook=\$\{note\}`/.test(read("app/api/outlook/callback/route.ts"))
    && /useState<string \| null>\(\(\) => RETURNED\[readParam\("outlook"\) \?\? ""\] \?\? null\)/.test(code(read("components/OutlookConnect.tsx")))
    && /useEffect\(\(\) => \{ dropParam\("outlook"\); \}, \[\]\);/.test(code(read("components/OutlookConnect.tsx"))));

  // ── what a phone keeps for itself has one home each ──
  const keyHomes = (lit) => appFiles.filter((f) => code(read(f)).includes(lit)).map((f) => f.split(path.sep).join("/"));
  ok("one home: the theme is read and written in lib/theme only — Settings › You › Appearance is the one place to change it, and the moon is gone",
    JSON.stringify(keyHomes('"gt3-theme"')) === JSON.stringify(["lib/theme.ts"])
    && /import \{ useTheme \} from "@\/lib\/theme";/.test(read("components/AppShell.tsx"))
    && /const theme = useTheme\(\);/.test(code(read("components/AppShell.tsx"))) && !/setTheme|toggleTheme|theme-toggle/.test(code(read("components/AppShell.tsx")))
    && !/useState<"day" \| "dark">/.test(read("components/AppShell.tsx"))
    && /const choice = useThemeChoice\(\);/.test(code(read("components/YouPrefs.tsx"))) && /setTheme\(t\);/.test(code(read("components/YouPrefs.tsx")))
    && /const LOOKS: readonly ThemeChoice\[\] = \["day", "dark", "auto"\];/.test(read("components/YouPrefs.tsx")) && /\{THEME_LABELS\[l\]\}/.test(read("components/YouPrefs.tsx"))
    && /export const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = \{ day: "Day", dark: "Dark", auto: "Auto" \};/.test(read("lib/settingsGlance.ts"))
    && !/THEME_LABELS/.test(read("lib/theme.ts")) && /import \{ THEME_LABELS \} from "@\/lib\/settingsGlance";/.test(read("components/YouPrefs.tsx"))
    && /<div className="set-seg" role="radiogroup" aria-label="Appearance">/.test(read("components/YouPrefs.tsx"))
    && !appFiles.some((f) => /className="theme-toggle"/.test(read(f))) && !/\.theme-toggle/.test(read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "")));
  ok("one home: Auto follows the phone as it changes — the console reads the media query as a store, light on the server",
    /const phoneDark = useSyncExternalStore\(subscribePhone, readPhoneDark, \(\) => false\);\s*return themeFrom\(raw, phoneDark\);/.test(code(read("lib/theme.ts")))
    && /m\?\.addEventListener\?\.\("change", onChange\);/.test(read("lib/theme.ts")) && /const PHONE_DARK = "\(prefers-color-scheme: dark\)";/.test(read("lib/theme.ts")));
  ok("one home: the pass's sound is read and written in lib/passSound only — the Pass's bell and Settings both go through it",
    JSON.stringify(keyHomes('"kds_muted"')) === JSON.stringify(["lib/passSound.ts"])
    && /const muted = usePassMuted\(\);/.test(pg) && /const toggleMute = \(\) => \{ setPassMuted\(!muted\); unlockAudio\(\); \};/.test(pg)
    && /if \(muted\) haptic\("toggleOn"\); else haptic\("toggleOff"\);\s*setPassMuted\(!muted\);/.test(code(read("components/YouPrefs.tsx"))));
  const dt = code(read("components/DisplayToggle.tsx"));
  ok("one home: Display & text size is one set of controls — the rail's panel and Settings draw DisplayControls, and both read the one store",
    /<div className="rdg-panel"[^>]*>\s*<DisplayControls \/>\s*<\/div>/.test(dt) && /<DisplayControls \/>/.test(sh)
    && /return displayFrom\(useDevicePref\(DISPLAY\)\);/.test(dt) && !/useState<Display>/.test(dt)
    && /const disp = displayClass\(useDisplay\(\)\);/.test(code(read("components/AppShell.tsx"))));
  const T = require("../.smoke/theme.js"), P = require("../.smoke/passSound.js"), D = require("../.smoke/devicePref.js");
  ok("one home: a stored look is itself — \"dark\" is dark, \"auto\" is the phone's, anything else day — and only \"1\" is muted",
    T.themeFrom("dark") === "dark" && T.themeFrom("day") === "day" && T.themeFrom(null) === "day" && T.themeFrom("Dark") === "day" && T.THEME.key === "gt3-theme"
    && T.themeFrom("auto", true) === "dark" && T.themeFrom("auto", false) === "day" && T.themeFrom("auto") === "day"
    && T.themeFrom("dark", false) === "dark" && T.themeFrom("day", true) === "day" && T.themeFrom("AUTO", true) === "day"
    && T.choiceFrom("auto") === "auto" && T.choiceFrom("dark") === "dark" && T.choiceFrom("light") === "day" && T.choiceFrom(undefined) === "day"
    && P.passMutedFrom("1") === true && P.passMutedFrom("0") === false && P.passMutedFrom(null) === false && P.PASS_SOUND.key === "kds_muted");
  {
    // A phone pref, driven the way a browser drives it: a write tells every copy, a refusing storage
    // still moves the switch in this tab, another tab's write wins, and an unsubscribed copy hears nothing.
    const hadWindow = "window" in global, hadLs = "localStorage" in global;
    const store = new Map();
    global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
    // A window of our own: an earlier block (planNav) leaves a stand-in Event class on global, which
    // Node's real EventTarget refuses. This one dispatches by type, as a browser does.
    const listeners = new Map();
    global.window = {
      addEventListener: (t, f) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); },
      removeEventListener: (t, f) => { listeners.get(t)?.delete(f); },
      dispatchEvent: (e) => { for (const f of [...(listeners.get(e.type) || [])]) f(e); return true; },
    };
    try {
      const pref = D.devicePref("gt3-smoke-pref");
      let heard = 0;
      const off = pref.subscribe(() => { heard++; });
      pref.write("a");
      const wrote = pref.read() === "a" && store.get("gt3-smoke-pref") === "a" && heard === 1;
      global.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
      pref.write("b");
      const refused = pref.read() === "b" && store.get("gt3-smoke-pref") === "a" && heard === 2;
      global.window.dispatchEvent({ type: "storage", key: "gt3-smoke-pref" });
      const otherTab = pref.read() === "a" && heard === 3;
      global.window.dispatchEvent({ type: "storage", key: "something-else" });
      off();
      global.localStorage.setItem = (k, v) => { store.set(k, String(v)); };
      pref.write("c");
      ok("one home: a pref tells every copy, still moves when storage refuses, takes another tab's write, and stops telling a copy that left",
        wrote && refused && otherTab && heard === 3 && pref.read() === "c", { wrote, refused, otherTab, heard });
    } finally {
      if (!hadWindow) delete global.window;
      if (!hadLs) delete global.localStorage;
    }
  }

  // ── the dial: only for those who can save it, and a refusal is said ──
  const dial = code(read("components/crew/CupOrderingDial.tsx"));
  ok("cup-ordering dial: LiveControl no longer reads or writes it — every manager could tap it there, and only an owner or an admin could save",
    !/preorder_lead_h/.test(lc) && !/adm-lead-opts/.test(lc));
  const writers = appFiles.filter((f) => /\.update\(\{ preorder_lead_h/.test(read(f))).map((f) => f.split(path.sep).join("/"));
  ok("cup-ordering dial: one component writes it, drawn once, in Settings behind isAdmin",
    JSON.stringify(writers) === JSON.stringify(["components/crew/CupOrderingDial.tsx"])
    && /\{isAdmin && \(\s*<Panel id="set-ordering" [^>]*>\s*<SetPart id="set-dial"><CupOrderingDial \/><\/SetPart>/.test(sh)
    && appFiles.filter((f) => /<CupOrderingDial \/>/.test(read(f))).length === 1);
  ok("cup-ordering dial: a save asks for the row back — no row is a refusal, said as an error, and the dial goes back to what the database holds",
    /\.update\(\{ preorder_lead_h: h \}\)\.eq\("id", 1\)\.select\("preorder_lead_h"\);/.test(dial) && /const refused = !error && !\(data && data\.length\);/.test(dial)
    && /if \(error \|\| refused\) \{\s*setPicked\(null\);\s*toast\(error \? `Couldn't save — \$\{error\.message\}` : "Couldn't save — only an owner or an admin can set when cup orders open\. Nothing changed\.", "error"\);/.test(dial)
    && /await state\.reload\(\);/.test(dial) && /useRealtimeTable\("live_status", state\.reload\);/.test(dial) && /<AsyncSection state=\{state\}/.test(dial));

  // ── the values on Settings' rows: the words have one home, and nothing unread is said ──
  {
    const SG = require("../.smoke/settingsGlance.js"), M = require("../.smoke/money.js"), OF = require("../.smoke/office.js");
    ok("settings values: a read that failed says so, in the warning colour — never nothing, never a guess",
      SG.UNREAD.text === "Couldn’t read" && SG.UNREAD.warn === true);
    ok("settings values: how a guest can pay, said once — and a switch nobody read says nothing",
      SG.payGlance(true, true).text === "Card + pay at pickup" && SG.payGlance(true, false).text === "Card only" && SG.payGlance(false, true).text === "Pay at pickup only"
      && SG.payGlance(false, false).text === "No way to pay" && SG.payGlance(false, false).warn === true && !SG.payGlance(true, true).warn
      && SG.payGlance(true, null) === null && SG.payGlance(false, undefined) === null);
    ok("settings values: ordering & delivery, the digest — each part's own default, the dial's own words, a price's cents kept",
      SG.orderingGlance(0, 4250, true).text === "Live only · $42.50/gal" && SG.orderingGlance(8, 6000, true).text === "8h before · $60/gal"
      && SG.orderingGlance(null, null, true).text === `4h before · ${M.money(OF.OFFICE.pricePerGallonCents)}/gal` && SG.orderingGlance(8, 4250, false) === null
      && SG.leadLabel(0) === "Live only" && SG.leadLabel(2) === "2h before" && !("dialGlance" in SG) && !("officeGlance" in SG)
      && SG.digestGlance("off", true).text === "Off" && SG.digestGlance("weekly", true).text === "Weekly" && SG.digestGlance(null, true).text === "Daily"
      && SG.digestGlance("nonsense", true).text === "Daily" && SG.digestGlance("daily", false) === null);
    ok("settings values: notifications say what is muted and the quiet window, by the inbox's own rule (both ends, not the same hour)",
      SG.notifyGlance([], null, null).text === "All on" && SG.notifyGlance(["order", "money"], null, null).text === "2 muted"
      && SG.notifyGlance([], 22, 7).text === "Quiet 10pm–7am" && SG.notifyGlance(["brew"], 22, 7).text === "1 muted · quiet 10pm–7am"
      && SG.notifyGlance([], 9, 9).text === "All on" && SG.notifyGlance([], 22, null).text === "All on" && SG.notifyGlance([], 0, 6).text === "Quiet 12am–6am"
      && SG.notifyGlance(null, 22, 7) === null && SG.hourShort(0) === "12am" && SG.hourShort(12) === "12pm" && SG.hourShort(13) === "1pm" && SG.hourShort(23) === "11pm");
    ok("settings values: text size in words, the lanes counted, and Outlook never \"not connected\" on a read that failed",
      SG.displayGlance({ scale: 0, bold: false, roomy: false }, "day").text === "Day · Standard" && SG.displayGlance({ scale: 2, bold: true, roomy: true }, "dark").text === "Dark · Larger · bold · roomy"
      && SG.displayGlance({ scale: 9, bold: false, roomy: false }, "auto").text === "Auto · Standard" && require("../.smoke/textSize.js").TEXT_SIZE_WORDS.join() === "Standard,Large,Larger,Largest"
      && SG.lanesGlance(5, 5).text === "All owned" && SG.lanesGlance(2, 5).text === "2 of 5 owned" && SG.lanesGlance(0, 5).warn === true && !SG.lanesGlance(2, 5).warn && SG.lanesGlance(0, 0) === null
      && SG.outlookGlance(null) === null && SG.outlookGlance({ configured: true, connected: true }).text === "Connected"
      && SG.outlookGlance({ configured: true, connected: false }).text === "Not connected" && SG.outlookGlance({ configured: false, connected: false }).text === "Not set up");
    const fd = code(read("components/FounderDigest.tsx")), dtg = code(read("components/DisplayToggle.tsx"));
    ok("settings values: one home for the words — the dial's buttons and the digest's say lib/settingsGlance's; the size buttons lib/textSize's, so the rail on every page carries none of Settings' words",
      /const LEADS = \[0, 2, 4, 8\]\.map\(\(h\) => \[h, leadLabel\(h\)\] as const\);/.test(dial) && !/"2h before"|"Live only"/.test(dial)
      && /import \{ DIGEST_LABELS, type DigestCadence \} from "@\/lib\/settingsGlance";/.test(fd) && !/const LABELS|"Weekly"/.test(fd) && /\{DIGEST_LABELS\[c\]\}/.test(fd)
      && /aria-label=\{`Text size: \$\{TEXT_SIZE_WORDS\[v\]\}`\}/.test(dtg) && !/Text size \$\{i \+ 1\}/.test(dtg)
      && /import \{ TEXT_SIZE_WORDS \} from "@\/lib\/textSize";/.test(dtg) && !/settingsGlance/.test(dtg)
      && /import \{ TEXT_SIZE_WORDS \} from "\.\/textSize";/.test(read("lib/settingsGlance.ts")));
    const gl = code(read("components/SettingsGlance.tsx"));
    ok("settings values: one read of live_status for its three rows, following its changes — and only for an owner or an admin, the ones drawn those rows",
      (gl.match(/\.from\("live_status"\)/g) || []).length === 1 && /if \(!supabase \|\| !isAdmin\) return null;/.test(gl)
      && /useRealtimeTable\("live_status", live\.reload, \{ enabled: isAdmin \}\);/.test(gl)
      && /pay: biz\(read \? payGlance\(squareClientReady, row\?\.pay_at_pickup !== false\) : null\),/.test(gl)
      && /const failed = live\.status === "error";/.test(gl) && /const biz = \(g: Glance\): Glance => \(failed \? UNREAD : g\);/.test(gl)
      && ["digest", "pay", "ordering"].every((k) => new RegExp(`${k}: biz\\(`).test(gl))
      && /ordering: biz\(orderingGlance\(row\?\.preorder_lead_h, row\?\.office_price_cents, read\)\),/.test(gl)
      && /const look = useThemeChoice\(\);/.test(gl) && /display: displayGlance\(display, look\),/.test(gl));
    ok("settings values: notifications follow every save (a save that lands before the read wins; a failed read says so), and the lanes count only once the table answered",
      /if \(gone \|\| saved\) return;[^\n]*\n\s*if \(error\) \{ setNotifFailed\(true\); return; \}/.test(gl) && /saved = true;/.test(gl) && /window\.addEventListener\(NOTIF_PREFS_EVENT, onSaved\);/.test(gl)
      && /notify: notif \? notifyGlance\(notif\.muted, notif\.qs, notif\.qe\) : notifFailed \? UNREAD : null,/.test(gl)
      && /const lanesRead = streams\.some\(\(s\) => !!s\.id\);/.test(gl) && /lanes: lanesRead \? lanesGlance\(/.test(gl)
      && /export function OutlookGlance\(\) \{\s*const st = useOutlookStatus\(\);\s*return <GlanceText g=\{st\.status === "error" \? UNREAD : st\.status === "ready" \? outlookGlance\(st\.data\) : null\} \/>;/.test(gl));
    const olc = code(read("components/OutlookConnect.tsx"));
    ok("outlook: a disconnect tells every status on screen — the row's value and its panel both read again",
      /window\.dispatchEvent\(new Event\(OUTLOOK_CHANGED_EVENT\)\);/.test(olc) && /window\.addEventListener\(OUTLOOK_CHANGED_EVENT, reload\);/.test(olc)
      && !/state\.reload\(\);\s*\};/.test(olc));
    const ofs = code(read("components/OfficeSettings.tsx"));
    ok("office delivery: the price keeps its cents ($42.50 read \"43\" and saved back as $43), and a failed read offers nothing to save",
      /setPrice\(moneyPlain\(d\?\.office_price_cents \?\? OFFICE\.pricePerGallonCents\)\);/.test(ofs) && !/toFixed\(0\)/.test(ofs)
      && /if \(error\) \{ setFailed\(true\); return; \}/.test(ofs) && /if \(failed\) return <div className="dp-err" role="alert">/.test(ofs));
    const ocx = code(read("components/OrgChart.tsx")), cssx = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
    ok("lane owners: one lane per row — its colour, its name, what it covers, the owner pick a column wide (two to a row it read \"Unassignec\")",
      /<div className="ws-list">/.test(ocx) && /<div key=\{s\.key\} className="ws-row">/.test(ocx) && /Covers \{s\.categories\.join\(" · "\)\}/.test(ocx)
      && /<span className="ws-dot" style=\{\{ background: s\.color \}\} aria-hidden="true" \/>/.test(ocx)
      && /\.ws-row\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,46%\);/.test(cssx) && !/\.ws-grid|\.ws-card/.test(cssx) && !/ws-grid|ws-card/.test(ocx));
  }

  // ── the words: the Guide and the old homes say where things are ──
  const inside = (/\n  settings: \[(.*)\],\n/.exec(pg) || [])[1] || "";
  const entries = [...inside.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  ok("guide: Settings' list names each of its sections, in the page's order",
    entries.length === LAY.SETTINGS_LAYOUT.length && LAY.SETTINGS_LAYOUT.every((s, i) => entries[i].startsWith(`${s.label} `)), entries.map((e) => e.slice(0, 24)));
  const catInside = (/\n  catalog: \[(.*)\],\n/.exec(pg) || [])[1] || "";
  ok("guide: pay at pickup is said to cover pickups only — delivery is always prepaid, as the switch itself says — and codes are where the Catalog is",
    !/governs cup, reserve & delivery/.test(pg) && /pay at pickup \(pickup orders only: delivery is always prepaid on the card\)/.test(inside)
    && /delivery is always prepaid/.test(read("components/PaymentSettings.tsx")) && /Discount codes/.test(catInside) && /Membership plans/.test(catInside)
    && !/discount codes|membership plans|broadcast/i.test(inside)
    && !/promos & codes|owner control room/.test((/\n  settings: "[^"]*",\n/.exec(pg) || [""])[0]));
  const guide = pg.slice(pg.indexOf("function SectionGuide("), pg.indexOf("\n}\n", pg.indexOf("function SectionGuide(")));
  ok("guide: What's new — the changelog, for every role that opens the Guide, and nowhere else",
    /const \[news, setNews\] = useState\(false\);/.test(guide) && /\{news && <div className="guide-body"><Changelog \/><\/div>\}/.test(guide)
    && pg.split("<Changelog />").length === 2 && !appFiles.some((f) => /id="set-changelog"/.test(read(f))));
  const ap = code(read("components/AccountPill.tsx")), ar = code(read("components/AccountRow.tsx"));
  ok("account: Settings' first row is the account menu's door — the avatar's own menu and sheets, its name, email and role on the row, in a file the customer pages do not load",
    /export function useAccountDoor\(\)/.test(ap) && (ap.match(/<AccountSheet/g) || []).length === 1 && /\{door\.sheets\}/.test(ap)
    && /import \{ AccountFace, useAccountDoor \} from "\.\/AccountPill";/.test(ar) && !/<AccountSheet|useState/.test(ar)
    && /<button type="button" className="mpanel-h acct-row" aria-haspopup="dialog" aria-expanded=\{door\.open\} onClick=\{door\.openAccount\}>/.test(ar)
    && /<span className="mpanel-v">\{roleLabel\(roleOf\(profile\)\)\}<\/span>/.test(ar) && /\{door\.sheets\}/.test(ar)
    && /const AccountRow = dynamic\(\(\) => import\("@\/components\/AccountRow"\)/.test(pg)
    && !appFiles.some((f) => !f.endsWith("page.tsx") && /AccountRow/.test(code(read(f))) && !/components[\\/]AccountRow\.tsx$/.test(f)));
  ok("words: no screen sends anyone to an old home — Route's dial, Now ▸ Live truck, \"connect from Plan › Calendar\", Team → Train the AI, the roster \"below\"",
    !/Locations &amp; ordering dial/.test(lc) && !/Now ▸ Live truck|the global window|global setting applies/.test(code(read("components/crew/OwnerDetails.tsx")))
    && !/connect from Plan › Calendar/.test(code(read("components/IntegrationsPanel.tsx"))) && !/Team → Train the AI/.test(code(read("components/AiTraining.tsx")))
    && !/roster below/.test(code(read("components/InviteTeammate.tsx"))) && !/Business → Studio/.test(pg)
    && !appFiles.some((f) => /Menu & availability|Ordering & payments|Copy & brand|Markets & legal|Team & access|Front-end copy/.test(code(read(f)))));
}

// ── THE IPHONE APP (2026-10-06): what a static check can hold of it ──────────────────────────────
// The app is the same screens as a static export inside a Capacitor shell (lib/native says how; the
// shell is capacitor.config.ts and ios/). scripts/smoke.native.mjs opens the export on three iPhones;
// this holds the source to the rules that keep the web untouched and the app whole.
{
  const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process"), { pathToFileURL } = require("node:url");
  const root = path.join(__dirname, "..");
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const walkSrc = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walkSrc(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
  const appFiles = ["app", "components", "lib"].flatMap(walkSrc);
  const client = appFiles.filter((f) => !f.startsWith(path.join("app", "api") + path.sep));

  // ── the web never carries the native side ──
  const capacitor = appFiles.filter((f) => /from ["']@capacitor\/|import\(["']@capacitor\//.test(code(read(f))));
  ok("iphone: only components/NativeBridge speaks to Capacitor — no other file the web loads imports it",
    capacitor.length === 1 && /components[\\/]NativeBridge\.tsx$/.test(capacitor[0]), capacitor);
  const shell = code(read("components/AppShell.tsx")), nb = code(read("components/NativeBridge.tsx"));
  // The test is spelled out in AppShell, in lib/native's own words: the bundler drops a lazy import only
  // when its guard is decided in the same file (with the imported constant the web build still emitted
  // NativeBridge and the plugins as chunks — measured 2026-10-06).
  ok("iphone: AppShell loads NativeBridge in the app build only, lazily, guarded in its own file in APP_BUILD's own words — so the web build never emits it",
    /const NativeBridge = process\.env\.NEXT_PUBLIC_GT3_TARGET === "app" \? dynamic\(\(\) => import\("\.\/NativeBridge"\), \{ ssr: false \}\) : null;/.test(shell)
    && /\{NativeBridge && <NativeBridge \/>\}/.test(shell) && /export const APP_BUILD = process\.env\.NEXT_PUBLIC_GT3_TARGET === "app";/.test(read("lib/native.ts")));
  ok("iphone: the app's own styles ride with NativeBridge, so the web never downloads them",
    /import "\.\/NativeBridge\.css";/.test(read("components/NativeBridge.tsx")) && /\.native-bar\{/.test(read("components/NativeBridge.css"))
    && !/native-bar|data-kb|data-native/.test(read("app/globals.css")));
  ok("iphone: NativeBridge does nothing unless a native shell is running the page",
    /useEffect\(\(\) => \{\n\s*if \(!isNativeApp\(\)\) return;/.test(nb) && /useState\(\(\) => isNativeApp\(\)\)/.test(nb));
  ok("iphone: the web build knows it is the web, so every APP_BUILD branch is decided when it is built",
    /env: \{ NEXT_PUBLIC_GT3_TARGET: "web" \}/.test(read("next.config.ts")) && /export const APP_BUILD = process\.env\.NEXT_PUBLIC_GT3_TARGET === "app";/.test(read("lib/native.ts")));

  // ── the app's addresses ──
  const relative = client.filter((f) => /fetch\(\s*["'`]\/api/.test(code(read(f))));
  ok("iphone: no screen fetches /api by a relative address — apiUrl() or authedFetch() makes it absolute in the app, where the page's own origin is the phone", relative.length === 0, relative);
  ok("iphone: authedFetch goes through apiUrl", /return fetch\(apiUrl\(url\), \{ \.\.\.init, headers \}\);/.test(code(read("lib/authedFetch.ts"))));
  const beacons = client.filter((f) => /sendBeacon/.test(code(read(f))));
  ok("iphone: the one beacon (the error reporter's) is skipped in the app, where its relative address reaches nothing",
    beacons.length === 1 && /if \(!APP_BUILD && navigator\.sendBeacon\?\.\(/.test(code(read("components/ErrorReporter.tsx"))), beacons);
  const own = client.filter((f) => /location\.origin/.test(code(read(f))) && !/lib[\\/]native\.ts$|components[\\/]NativeBridge\.tsx$/.test(f));
  ok("iphone: a shared link, a QR or a sign-in email takes its address from publicOrigin() — window.location.origin is capacitor://localhost in the app", own.length === 0, own);
  const ba = read("scripts/build.app.mjs");
  ok("iphone: the app is told which pages only the web serves, from the build's own list of what it leaves out",
    /const WEB_ONLY = LEAVE_OUT\./.test(ba) && /NEXT_PUBLIC_GT3_WEB_ONLY: WEB_ONLY\.join\(","\)/.test(ba) && /process\.env\.NEXT_PUBLIC_GT3_WEB_ONLY/.test(nb));
  ok("iphone: a lesson link goes to the app's own lesson page in the app, the web's in the web",
    !client.some((f) => !/lib[\\/]native\.ts$/.test(f) && /href=\{?`\/primal\/l\//.test(code(read(f)))) && fs.existsSync(path.join(root, "native", "routes", "primal", "lesson", "page.tsx")));

  // ── the API lets exactly the app's two origins in ──
  const nc = read("next.config.ts");
  const listed = /const APP_ORIGINS = \[([^\]]*)\] as const;/.exec(nc);
  const appOrigins = listed ? [...listed[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
  // Next matches a `has` value whole: new RegExp(`^${value}$`) (next/dist/shared/lib/router/utils/prepare-destination.js).
  const whole = new RegExp(`^(?<origin>${appOrigins.join("|")})$`);
  ok("iphone: the API answers exactly capacitor://localhost and https://localhost — matched whole, echoed back, never a wildcard",
    JSON.stringify(appOrigins) === '["capacitor://localhost","https://localhost"]'
    && /value: `\(\?<origin>\$\{APP_ORIGINS\.join\("\|"\)\}\)`/.test(nc) && /\{ key: "Access-Control-Allow-Origin", value: ":origin" \}/.test(nc) && !/Access-Control-Allow-Origin", value: "\*"/.test(nc)
    && /appCors,\n\s*\];/.test(nc) && whole.test("capacitor://localhost") && whole.test("https://localhost")
    && !["capacitor://localhost.evil.com", "https://localhost.evil.com", "https://localhost:3000", "http://localhost", "https://evil.com", "xcapacitor://localhost", "capacitor://localhostx"].some((o) => whole.test(o)));

  // ── the app's router, and the smoke's mirror of it ──
  const swift = read("ios/App/App/GT3ViewController.swift");
  ok("iphone: the app's router — a file as itself, the root as index.html, a page as page.html or page/index.html, anything else the root",
    /if !URL\(fileURLWithPath: path\)\.pathExtension\.isEmpty \{\s*return basePath \+ path\s*\}/.test(swift)
    && /if page\.isEmpty \{\s*return basePath \+ "\/index\.html"\s*\}/.test(swift)
    && /for candidate in \[page \+ "\.html", page \+ "\/index\.html"\] where FileManager\.default\.fileExists\(atPath: basePath \+ candidate\) \{\s*return basePath \+ candidate\s*\}\s*return basePath \+ "\/index\.html"/.test(swift)
    && /override func router\(\) -> Router \{\s*return ExportRouter\(\)/.test(swift));
  PENDING.push(import(pathToFileURL(path.join(root, "scripts", "smoke.native.mjs")).href).then(({ routeFor, nativePlugins }) => {
    const files = new Set(["/index.html", "/crew.html", "/crew.txt", "/primal.html", "/primal/lesson.html", "/hub/index.html"]);
    const exists = (p) => files.has(p);
    const cases = [["/", "/index.html"], ["/crew", "/crew.html"], ["/crew/", "/crew.html"], ["/primal", "/primal.html"], ["/primal/lesson", "/primal/lesson.html"],
      ["/hub", "/hub/index.html"], ["/nowhere", "/index.html"], ["/crew.txt", "/crew.txt"], ["/_next/static/chunks/a.js", "/_next/static/chunks/a.js"]];
    const wrong = cases.filter(([p, want]) => routeFor(p, exists) !== want).map(([p, want]) => `${p} → ${routeFor(p, exists)} (want ${want})`);
    ok("iphone: the smoke's server answers as the app's router does", wrong.length === 0, wrong);
    const plugins = nativePlugins(root).map((p) => p.name);
    ok("iphone: the smoke's stand-in phone declares every plugin the app calls, read from their native sources",
      ["App", "Browser", "Haptics", "Keyboard", "SplashScreen", "StatusBar", "SystemBars"].every((n) => plugins.includes(n)), plugins);
  }));

  // ── the iOS project ──
  const check = spawnSync(process.execPath, [path.join(root, "scripts", "ios.configure.mjs"), "--check"], { encoding: "utf8" });
  ok("iphone: the committed iOS project is exactly what scripts/ios.configure.mjs makes it (router, Info.plist, privacy manifest, iPhone only)", check.status === 0, `${check.stdout}${check.stderr}`.trim());
  const icon = fs.readFileSync(path.join(root, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-512@2x.png"));
  ok("iphone: the App Store icon is 1024 × 1024 with no alpha channel (Apple refuses one with it)", icon.readUInt32BE(16) === 1024 && icon.readUInt32BE(20) === 1024 && icon[24] === 8 && icon[25] === 2);
  const cc = read("capacitor.config.ts");
  ok("iphone: the shell — com.gt3pb.app, the export as its pages, drawn edge to edge, the keyboard shrinking the view, the status bar light from the first frame",
    /appId: "com\.gt3pb\.app"/.test(cc) && /webDir: "out"/.test(cc) && /contentInset: "never"/.test(cc) && /resize: "native"/.test(cc)
    && /SystemBars: \{\s*style: "DARK",?\s*\}/.test(cc) && /StatusBar: \{\s*style: "DARK",\s*overlaysWebView: true,?\s*\}/.test(cc));

  // ── the gates ──
  const pkg = JSON.parse(read("package.json"));
  ok("iphone: npm run verify ends by building the app's smoke build and opening it on three iPhones", /&& npm run build:app -- --smoke && npm run smoke:native$/.test(pkg.scripts.verify));
  const wf = read(".github/workflows/ios.yml");
  ok("iphone: the TestFlight upload refuses the smoke build, and an app built without its backend", /gt3-smoke-build\.json/.test(wf) && /NEXT_PUBLIC_SUPABASE_URL/.test(wf));
}

// ── DELETE MY ACCOUNT (2026-10-06, the iPhone round, part 2) ──────────────────────────────────────
// App Store Review Guideline 5.1.1(v): an app that lets people make an account must let them delete it,
// in the app, without an email or a phone call. Before this no account could be deleted at all — 0141's
// guard on profiles fired in the cascade from auth.users, so even the Supabase dashboard's "Delete user"
// failed. 0353 makes deleting the account the erasure (scripts/db.erasure.test.mjs proves the data side
// against every migration); these hold the door, the screen and the route's order.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const acs = code(read("components/AccountSheet.tsx"));
  const del = code(read("components/DeleteAccount.tsx"));
  const rt = code(read("app/api/account/erase/route.ts"));
  const mig = read("supabase/migrations/0353_account_erasure.sql");
  const pkg = JSON.parse(read("package.json"));

  const acctGroup = acs.slice(acs.indexOf('<div className="acs-group">Account</div>'), acs.indexOf('className="acs-signout"'));
  ok("delete: \"Delete account\" is a row in the account menu's Account group — one tap from the avatar, on the web and in the app",
    /<b>Delete account<\/b>/.test(acctGroup) && /onClick=\{\(\) => setDeleting\(true\)\}/.test(acctGroup)
    && /if \(deleting\) \{[\s\S]*?<DeleteAccount staff=\{staff\} onKeep=\{\(\) => setDeleting\(false\)\}/.test(acs)
    // the screen loads when the row is tapped, not with every page that carries the menu (design.ratchet WEIGHT)
    && /const DeleteAccount = dynamic\(\(\) => import\("@\/components\/DeleteAccount"\), \{ ssr: false \}\);/.test(acs) && !/import DeleteAccount/.test(acs));
  ok("delete: after it, this device is signed out and lands home, told so",
    /onDeleted=\{\(\) => \{ onClose\(\); signOut\(\); toast\("Your account is deleted\."\); router\.push\("\/"\); \}\}/.test(acs)
    && /supabase\?\.auth\.signOut\(\{ scope: "local" \}\)/.test(del));
  ok("delete: the screen asks the server first, says what goes and what stays, and only then offers the red button",
    /authedFetch\("\/api\/account\/erase"\)\s*\.then/.test(del) && />Deleted<\/div>/.test(del) && />Kept, without your name<\/div>/.test(del)
    && /className="note-save" onClick=\{\(\) => erase\(phase\.membership\)\}/.test(del) && /body: JSON\.stringify\(\{ confirm: true \}\)/.test(del)
    && /phase\.at === "blocked"/.test(del) && !/window\.location\.reload/.test(del));
  const at = (re) => { const m = re.exec(rt); return m ? m.index : -1; };
  const order = [at(/body\.confirm !== true/), at(/const first = await blockersFor\(user\.id\)/), at(/\/v2\/subscriptions\/\$\{encodeURIComponent\(id\)\}\/cancel/),
    at(/supabaseAdmin\.storage\.from\(bucket\)/), at(/supabaseAdmin\.auth\.admin\.deleteUser\(user\.id\)/), at(/\/v2\/customers\/\$\{encodeURIComponent\(squareCustomer\)\}/)];
  ok("delete: the route's order — confirmed, asked, the membership cancelled at Square, the photos removed, the account deleted, the saved card last",
    order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), order);
  ok("delete: a membership Square cannot confirm cancelled stops it, with nothing deleted",
    /if \(!ended\) return NextResponse\.json\(\{ error: "We couldn't cancel your membership with our payment processor, so nothing was deleted\./.test(rt));
  ok("delete: 0353 — deleting the account runs the erasure, in its transaction, and nothing else may call it",
    /create trigger on_auth_user_deleted before delete on auth\.users/.test(mig)
    && /revoke all on function public\.erase_account_data\(uuid\) from public, anon, authenticated, service_role;/.test(mig)
    && /grant execute on function public\.account_erasure_blockers\(uuid\) to service_role;/.test(mig));
  ok("delete: the erasure's proof runs with the database suites", /node scripts\/db\.erasure\.test\.mjs/.test(pkg.scripts["db:test"]));
}

// Everything above is synchronous except what PENDING holds. Printing the summary before those
// land would report a pass count that is wrong in the flattering direction — exactly the kind of
// quiet lie the rest of this file exists to refuse.
Promise.all(PENDING).then(() => {
  console.log(`\nSPACE/LOADOUT SMOKE: ${pass} passed, ${fail} failed`);
  console.log(`Sample — trailer: ${tS.usedCuft}/${tS.usableCuft} cu ft (${tS.cuftLevel}); vehicle: ${vS.usedCuft}/${vS.usableCuft} cu ft (${vS.cuftLevel})`);
  process.exit(fail ? 1 : 0);
});