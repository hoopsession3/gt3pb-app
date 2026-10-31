// IMS7-D — THE ROOM'S FIXTURES AGAINST THE PLAN. Library costs set beside the plan's startup costs (never added, never
// counted twice, a per-square-foot price never multiplied by a count), the library's size beside the drawing (to the
// inch, turned said as turned, nothing resized, only accepted sizes), and the plan's approval context through the
// insight contract. Pure: nothing here writes.
import { readFileSync } from "node:fs";
import { loadTs } from "./search.read.mjs";
const F = loadTs("lib/planFixtures.ts"), M = loadTs("lib/visionMoney.ts"), I = loadTs("lib/insight.ts");
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 500)}` : ""}`); } };

const A = (id, o = {}) => ({ id, name: o.name ?? id, status: "approved", status_reason: null, cost_cents: null, cost_unit: null, cost_basis: null, w_in: null, d_in: null, h_in: null, ...o });
const P = (id, lib, o = {}) => ({ id, kind: "bench", label: null, w_in: 72, d_in: 18, h_in: 18, library_id: lib, ...o });
const assets = new Map([
  ["bench", A("bench", { name: "Oak bench", cost_cents: 120000, cost_unit: "each", cost_basis: "actual", w_in: 72, d_in: 18, h_in: 18 })],
  ["lamp", A("lamp", { name: "Floor lamp", status: "candidate", cost_cents: 35000, cost_unit: null, cost_basis: "estimated", w_in: 14, d_in: 14, h_in: 66 })],
  ["floor", A("floor", { name: "Cork floor", cost_cents: 900, cost_unit: "sq ft", cost_basis: "estimated" })],
  ["stool", A("stool", { name: "Stool", status: "evidence_incomplete" })],
]);
const placed = [P("i1", "bench"), P("i2", "bench"), P("i3", "lamp", { w_in: 14, d_in: 14, h_in: 66 }), P("i4", "floor", { w_in: 120, d_in: 120, h_in: 0 }), P("i5", "stool"), P("i6", null), P("i7", "gone")];
const lines = M.toLines([
  { id: "L1", label: "Benches", category: "equipment", qty: 2, unitCents: 110000, libraryId: "bench" },
  { id: "L2", label: "Counter", category: "equipment", qty: 1, unitCents: 800000 },
  { id: "L3", label: "Old lamp", category: "equipment", qty: 1, unitCents: 20000, libraryId: "elsewhere" },
]);

// ── the plan's line can name its asset, and nothing else changes ──
ok("a plan line keeps the asset it names, read back from what was saved", lines[0].libraryId === "bench" && lines[1].libraryId === undefined);
ok("…naming it changes no total", M.lineTotal(lines[0]) === 220000 && M.lineTotal(M.toLines([{ id: "x", label: "B", category: "equipment", qty: 2, unitCents: 110000 }])[0]) === 220000);
ok("…a junk value is not a link", M.toLines([{ id: "x", label: "B", category: "equipment", libraryId: 7 }])[0].libraryId === undefined && M.toLines([{ id: "x", label: "B", category: "equipment", libraryId: "" }])[0].libraryId === undefined);

// ── cost ──
const c = F.fixtureCosts(placed, assets, lines);
const row = (id) => c.rows.find((r) => r.asset.id === id);
ok("each asset once, however many times it's placed", c.rows.length === 4 && row("bench").placed === 2 && row("bench").itemIds.join() === "i1,i2");
ok("a per-one price × the count: two benches at $1,200", row("bench").libraryCents === 240000 && row("lamp").libraryCents === 35000);
ok("…a per-square-foot price is never multiplied by a count — it needs a quantity", row("floor").libraryCents === null && row("floor").noFigure === "needs_quantity" && c.needsQuantity === 1);
ok("…no cost is said as no cost, never $0", row("stool").libraryCents === null && row("stool").noFigure === "no_cost" && c.missing === 1);
ok("the basis kept with each figure, apart — never one total said as sure", c.byBasis.actual === 240000 && c.byBasis.estimated === 35000 && c.byBasis.scenario === 0 && c.byBasis.unsaid === 0);
ok("already in the plan: compared with its line, never added again", row("bench").lines.join() === "L1" && row("bench").planCents === 220000 && row("bench").diffCents === 20000 && c.inPlan === 1);
ok("not in the plan: said, with what the library would put there — and left out until a person reconciles it", c.notInPlan === 3 && c.notInPlanCents === 35000);
ok("placed things naming no asset (or one no longer in the library) are counted, not guessed", c.unlinked === 2);
ok("a line naming an asset that isn't in this room is said, not dropped", c.strayLines.join() === "L3");
const two = F.fixtureCosts(placed, assets, [...lines, ...M.toLines([{ id: "L4", label: "Bench extra", category: "equipment", qty: 1, unitCents: null, libraryId: "bench" }])]);
ok("…two lines on one asset: both named; an unpriced one leaves the comparison unknown, not low", two.rows.find((r) => r.asset.id === "bench").lines.join() === "L1,L4" && two.rows.find((r) => r.asset.id === "bench").planCents === null && two.rows.find((r) => r.asset.id === "bench").diffCents === null);
ok("each/ea/unit/blank are per one; sq ft, gallon, linear foot are not", ["each", "EA", " unit ", "", null, "pcs"].every(F.perOne) && !["sq ft", "gallon", "linear ft", "box of 12"].some(F.perOne));
ok("the plan's own inputs are not touched", JSON.stringify(lines) === JSON.stringify(M.toLines([
  { id: "L1", label: "Benches", category: "equipment", qty: 2, unitCents: 110000, libraryId: "bench" }, { id: "L2", label: "Counter", category: "equipment", qty: 1, unitCents: 800000 },
  { id: "L3", label: "Old lamp", category: "equipment", qty: 1, unitCents: 20000, libraryId: "elsewhere" }])));

// ── size ──
const bench = assets.get("bench");
ok("the same to the inch is the same", F.sizeTruth(P("x", "bench", { w_in: 72.4 }), bench).differs.length === 0 && F.sizeWords(F.sizeTruth(P("x", "bench"), bench), "B") === null);
const off = F.sizeTruth(P("x", "bench", { w_in: 84 }), bench);
ok("a difference you'd read is a difference, said in feet and inches", off.differs.join() === "w_in" && F.sizeWords(off, "Oak bench") === "Oak bench: the library says 6′ wide; drawn 7′.", F.sizeWords(off, "Oak bench"));
ok("compared raw, 1″ is material: 72.99 vs 72 is the same, 73 differs, 71.01 the same, 71 differs — before any rounding for display",
  F.sizeTruth(P("x", "bench", { w_in: 72.99 }), bench).differs.length === 0 && F.sizeTruth(P("x", "bench", { w_in: 73 }), bench).differs.join() === "w_in"
  && F.sizeTruth(P("x", "bench", { w_in: 71.01 }), bench).differs.length === 0 && F.sizeTruth(P("x", "bench", { w_in: 71 }), bench).differs.join() === "w_in");
ok("…the tolerance is 1″ and is this comparison's only — the room's own checks keep theirs (lib/spatial untouched)", F.SIZE_TOLERANCE_IN === 1 && !/SIZE_TOLERANCE_IN|planFixtures/.test(read("lib/spatial/evaluate.ts")));
const turned = F.sizeTruth(P("x", "bench", { w_in: 18, d_in: 72 }), bench);
ok("width and depth the other way round: turned, not wrong", turned.turned && turned.differs.length === 0 && /drawn turned/.test(F.sizeWords(turned, "Oak bench")));
ok("…turned and too tall: turned, and the height said", (() => { const t = F.sizeTruth(P("x", "bench", { w_in: 18, d_in: 72, h_in: 30 }), bench); return t.turned && t.differs.join() === "h_in"; })());
const unk = F.sizeTruth(P("x", "stool"), assets.get("stool"));
ok("what the library doesn't say is unknown — never a difference", unk.unknown.join() === "w_in,d_in,h_in" && unk.differs.length === 0);
ok("installation footprint: not recorded; clearance: the room's checks — never invented here", unk.footprint === "not_recorded" && unk.clearance === "the_room_checks");
const src = read("lib/planFixtures.ts");
ok("only the library's accepted size is read (std_materials), never a pending finding", !/std_asset_facts|pending finding.*=|review ===/.test(src.replace(/\/\/.*$/gm, "")));
ok("nothing resized, nothing written", !/supabase|\.update\(|\.insert\(|fetch\(/.test(src));

// ── insights ──
const ROOM = { kind: "layout", id: "room", name: "The gym bar" };
const go = (status, extra = {}) => F.fixtureInsights({ plan: { id: "p1", name: "The gym bar", status }, room: ROOM, placed: [...placed, P("i8", "bench", { w_in: 84 })], assets, lines, ...extra });
const ins = go("go", { blockers: new Map([["lamp", ["1 criterion judged unknown — unknown is never approved."]]]) });
const by = (rule) => ins.filter((x) => x.rule === rule);
ok("an asset short of approved: the library's own insight, naming the room and the plan", by("status").length === 2 && by("status").every((x) => x.related.some((r) => r.kind === "plan") && x.related.some((r) => r.kind === "layout")));
ok("…the lamp's gate refuses qualifying (the database's), the stool's has nothing standing", by("status").find((x) => x.subject.id === "lamp").blocks === true && by("status").find((x) => x.subject.id === "stool").blocks === false);
ok("a plan marked go with unapproved assets: said once, as advice — a look that refuses nothing", by("going_unapproved").length === 1 && by("going_unapproved")[0].level === "look" && !by("going_unapproved")[0].blocks && /marked go with 2 assets/.test(by("going_unapproved")[0].words));
ok("…not said for a plan still being drafted", !go("draft").some((x) => x.rule === "going_unapproved"));
ok("not in the plan: a look per asset, its action a person's", by("not_in_plan").length === 3 && by("not_in_plan").every((x) => x.level === "look" && /Say whether the allowance covers it, it's extra, or it isn't this plan's/.test(x.action)));
ok("in the plan at a different price: a look to reconcile — the plan keeps its number", by("cost_differs").length === 1 && /plan keeps its number/.test(by("cost_differs")[0].action));
ok("no cost and needs-a-quantity are notes", by("no_cost").length === 1 && by("needs_quantity").length === 1 && [...by("no_cost"), ...by("needs_quantity")].every((x) => x.level === "note"));
ok("a size that differs: a look on the placed thing; each placed thing its own", by("size_differs").length === 1 && by("size_differs")[0].subject.id === "i8" && by("size_differs")[0].visibility.includes("member"));
ok("deterministic, and gathered without duplicates", JSON.stringify(I.gather([go("go")])) === JSON.stringify(I.gather([go("go").reverse()])) && new Set(go("go").map((x) => x.id)).size === go("go").length);
ok("the same condition with a moved price keeps its id; a new difference moves its mark", (() => {
  const a2 = new Map(assets); a2.set("bench", { ...assets.get("bench"), cost_cents: 125000 });
  const x = go("go").find((i) => i.rule === "cost_differs"), y = F.fixtureInsights({ plan: { id: "p1", name: "The gym bar", status: "go" }, room: ROOM, placed, assets: a2, lines }).find((i) => i.rule === "cost_differs");
  return x.id === y.id && x.mark !== y.mark; })());
ok("resolved: name the line and the price matches — the cost insight is gone", (() => {
  const fixed = M.toLines([{ id: "L1", label: "Benches", category: "equipment", qty: 2, unitCents: 120000, libraryId: "bench" }]);
  return !F.fixtureInsights({ plan: { id: "p1", name: "x", status: "go" }, room: ROOM, placed: [P("i1", "bench"), P("i2", "bench")], assets, lines: fixed }).some((i) => i.rule === "cost_differs" || i.rule === "not_in_plan"); })());
ok("a room two plans share: said once, so nobody sums it twice", go("go", { roomAlsoFor: ["The kiosk"] }).filter((x) => x.rule === "shared_room").length === 1 && !go("go").some((x) => x.rule === "shared_room"));
ok("investors see none of it (owners and admins; a size, the crew)", I.visibleTo(go("go"), ["investor"]).length === 0);
ok("no dollar figure in any insight's words — figures stay in the reconciliation, beside their basis", go("go").every((x) => !/\$\d/.test(x.words)));
// ── reconciliation and the five figures (Ryan, 2026-10-31) ──
const plan2 = M.toLines([{ id: "E1", label: "Fixtures allowance", category: "equipment", qty: 1, unitCents: 300000 }, { id: "E2", label: "Bar back", category: "equipment", qty: 1, unitCents: null },
  { id: "B1", label: "Build", category: "buildout", qty: 1, unitCents: 999999 }, { id: "L1", label: "Benches", category: "equipment", qty: 2, unitCents: 110000, libraryId: "bench" }]);
const P2 = [P("i1", "bench"), P("i2", "bench"), P("i3", "lamp", { w_in: 14, d_in: 14, h_in: 66 }), P("i4", "floor"), P("i5", "stool")];
const f0 = F.fixtureCosts(P2, assets, plan2).figures;
ok("the existing allowance is the plan's own Equipment & fixtures lines (visionMoney's lineTotal), unpriced ones counted, other categories not", f0.allowance.cents === 300000 + 220000 && f0.allowance.lines === 3 && f0.allowance.unpriced === 1);
ok("identified: the library's figures for what's placed, by basis", f0.identified.cents === 240000 + 35000 && f0.identified.byBasis.actual === 240000 && f0.identified.byBasis.estimated === 35000 && f0.identified.byBasis.listed === 0 && f0.identified.byBasis.quoted === 0);
ok("unknown: no price, or needs a quantity — never $0", f0.unknown === 2);
ok("potential variance: identified-and-inside against the allowance (here within it)", f0.variance === 275000 - 520000);
ok("confirmed incremental: nothing until a person says so", f0.incremental === 0);
const rec = { lamp: "incremental", floor: "excluded" };
const r1 = F.fixtureCosts(P2, assets, plan2, rec);
ok("a person's reconciliation is its status; a line naming it is its own line", r1.rows.find((r) => r.asset.id === "lamp").status === "incremental" && r1.rows.find((r) => r.asset.id === "floor").status === "excluded" && r1.rows.find((r) => r.asset.id === "bench").status === "named_line" && r1.rows.find((r) => r.asset.id === "stool").status === "unreviewed");
ok("…incremental is said beside the plan, never added to the allowance", r1.figures.incremental === 35000 && r1.figures.allowance.cents === f0.allowance.cents && r1.figures.variance === 240000 - 520000);
ok("…excluded counts nowhere — not identified, not unknown", r1.figures.identified.cents === 240000 + 35000 && r1.figures.unknown === 1);
const both = F.fixtureCosts(P2, assets, plan2, { bench: "incremental" });
ok("a line naming it and marked extra too: counted once, as its line — the conflict said", both.rows.find((r) => r.asset.id === "bench").status === "named_line" && both.rows.find((r) => r.asset.id === "bench").conflict === "incremental" && both.figures.incremental === 0);
ok("…each placement counted once: two benches are two, once", both.rows.find((r) => r.asset.id === "bench").placed === 2 && both.figures.identified.cents === f0.identified.cents);
ok("a reconciliation for an asset no longer in the room is said, not counted", F.fixtureCosts(P2, assets, plan2, { ...rec, gone: "incremental" }).strayRecon.join() === "gone");
const over = F.fixtureCosts(P2, assets, M.toLines([{ id: "E1", label: "Fixtures", category: "equipment", qty: 1, unitCents: 100000 }]));
ok("over the allowance: a positive variance", over.figures.variance === 275000 - 100000);
const I2 = (fx, lines = plan2) => F.fixtureInsights({ plan: { id: "p1", name: "The gym bar", status: "draft" }, room: ROOM, placed: P2, assets, lines, fixtures: fx });
ok("reconciled assets aren't said as not in the plan; only the unreviewed are", I2(rec).filter((x) => x.rule === "not_in_plan").map((x) => x.subject.id).join() === "stool");
ok("an overrun is said once, without its figure, the plan keeping its number", (() => { const x = I2({}, M.toLines([{ id: "E1", label: "Fixtures", category: "equipment", qty: 1, unitCents: 100000 }])).filter((i) => i.rule === "over_allowance"); return x.length === 1 && !/\$\d/.test(x[0].words) && /plan keeps its number/.test(x[0].action) && x[0].tier === 3; })());
ok("…and not when within it", !I2({}).some((x) => x.rule === "over_allowance"));
ok("a reconciliation conflict is a note, once", I2({ bench: "incremental" }).filter((x) => x.rule === "recon_conflict").length === 1);
ok("an excluded asset doesn't hold up a plan going ahead", !F.fixtureInsights({ plan: { id: "p1", name: "x", status: "go" }, room: ROOM, placed: [P("i5", "stool")], assets, lines: [], fixtures: { stool: "excluded" } }).some((x) => x.rule === "going_unapproved"));
const saved = M.toInputs({ uses: [], fixtures: { "0c000000-0000-4000-8000-000000000001": "incremental", "0c000000-0000-4000-8000-000000000002": "maybe", "not-a-uuid": "excluded" } });
ok("saved in the scenario and read back safely: only asset ids and the three answers", JSON.stringify(saved.fixtures) === JSON.stringify({ "0c000000-0000-4000-8000-000000000001": "incremental" }) && M.toInputs({ uses: [] }).fixtures === undefined);
ok("…and no money figure reads it: the engine's totals are the same with or without it", JSON.stringify(M.project(M.toInputs({ ...JSON.parse(JSON.stringify(saved)), ordersPerDay: 80, avgOrderCents: 900, daysOpenPerMonth: 26 }), { kind: "none" }, { counterPerHour: null }).startupSpend)
  === JSON.stringify(M.project(M.toInputs({ uses: [], ordersPerDay: 80, avgOrderCents: 900, daysOpenPerMonth: 26 }), { kind: "none" }, { counterPerHour: null }).startupSpend));
// ── the reconciliation on screen ──
const ui = read("components/vision/FixturesInPlan.tsx"), mp = read("components/vision/MoneyPanel.tsx");
ok("under the plan's startup lines, loaded only where drawn (owners' and admins' panel)", /const FixturesInPlan = dynamic\(\(\) => import\("\.\/FixturesInPlan"\), \{ ssr: false \}\);/.test(mp) && /<FixturesInPlan i=\{i\} set=\{set\} room=\{room\} \/>/.test(mp) && mp.indexOf("<FixturesInPlan") > mp.indexOf("if (!canEdit) return"));
ok("…the five figures said apart, and the answers a person gives", ["<dt>Allowance</dt>", "<dt>Identified</dt>", "<dt>Unknown</dt>", "<dt>Variance</dt>", "<dt>Confirmed extra</dt>"].every((t) => ui.includes(t)) && /<option value="in_allowance">/.test(ui) && /<option value="incremental">/.test(ui) && /<option value="excluded">/.test(ui));
ok("…an answer is saved with the scenario (set → Save), never written into a line or a total", /set\(\{ fixtures: Object\.keys\(next\)\.length \? next : undefined \}\)/.test(ui) && !/\.insert\(|\.update\(|uses:/.test(ui) && /Nothing here changes the plan&apos;s figures/.test(ui));
ok("…a line naming it shows as its own line, not as a choice", /r\.status === "named_line"/.test(ui));
ok("…unknown is never $0, a failure is said", /not counted as \$0/.test(ui) && /Couldn&apos;t read the room&apos;s library assets just now/.test(ui));
ok("…money through lib/money", /moneyRound/.test(ui) && !/style: "currency"/.test(ui));
ok("the console smoke's room names a library asset, so the reconciliation is drawn there", /'Fixture community table', 'seating', 'community', 96, 42, 30/.test(read("scripts/fixtures/consoleWorld.mjs")));
console.log(`IMS7-D — THE ROOM'S FIXTURES AGAINST THE PLAN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
