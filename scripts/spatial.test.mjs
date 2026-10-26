// THE SHARED SPATIAL ENGINE (2026-10-26 — Ryan: "one shared spatial intelligence and computational geometry foundation
// across all supported operating models… a correction to a shared spatial calculation must propagate consistently across
// every applicable GT3 operating model without duplicating implementation logic").
//
//   1 · Measured by hand: clearance, the widest route and its narrowest point, a door's swing, a work zone.
//   2 · Every profile, the same rooms: the seed store, a blocked door, a pinched route, a crowded back bar.
//   3 · One engine: the geometry findings equal today's plan reviewer's on the seed; a change to the shared gap reaches
//       all five models; a new model is a row of data.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const E = loadTs("lib/spatial/evaluate.ts"), P = loadTs("lib/spatial/profiles.ts"), V = loadTs("lib/vision.ts");
const MODELS = Object.keys(P.PROFILES);

const SQL = read("supabase/migrations/0447_the_plan_people_can_see.sql");
const SEED = [...SQL.matchAll(/\(lay, '(\w+)',\s*'([^']*)',\s*(-?\d+),\s*(-?\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*'((?:[^']|'')*)', '\{([^}]*)\}', (\d+)\)/g)]
  .map((m, i) => ({ id: `i${i + 1}`, kind: m[1], label: m[2], x_in: +m[3], y_in: +m[4], rot: +m[5], w_in: +m[6], d_in: +m[7], h_in: +m[8], why: m[9], pillars: m[10] ? m[10].split(",") : [], sort: +m[11] }));
const STORE = { width_in: 360, depth_in: 480, items: SEED };
const it = (id, kind, x, y, w, d, h = 36, rot = 0) => ({ id, kind, label: null, x_in: x, y_in: y, rot, w_in: w, d_in: d, h_in: h, why: null, pillars: [], sort: 0 });

// ── 1 · by hand ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  // A 10 × 10 ft room, a door in the bottom wall, a counter facing the room: a 4-ft-wide corridor between two walls of
  // shelving leads from the door to the counter.
  const room = { width_in: 120, depth_in: 120, items: [it("door", "door", 60, 117, 36, 6, 84), it("ctr", "order_counter", 60, 15, 96, 30, 42),
    it("L", "storage", 18, 80, 36, 80, 84), it("R", "storage", 102, 80, 36, 80, 84)] };
  const g = E.clearance(room);
  ok("clearance: a point in the middle of a 48-in corridor is 24 in from each side", Math.abs(g.d[Math.floor(80 / 3) * g.cols + Math.floor(60 / 3)] - 24) <= 1.5, g.d[Math.floor(80 / 3) * g.cols + Math.floor(60 / 3)]);
  const w = E.widest(g, { x: 60, y: 100 }, { x: 60, y: 45 });
  ok("the widest route through it is the corridor's width — 48 in (to the 3-in grid)", w && Math.abs(w.width - 48) <= 6, w && w.width);
  ok("…and its narrowest point is inside the corridor", w && w.narrowest.y > 40 && w.narrowest.y < 120, w && w.narrowest);
  const sw = E.doorSwing(room, room.items[0]);
  ok("a 36-in door in the bottom wall sweeps a 36-in square on the room side", sw.x1 - sw.x0 === 36 && sw.y1 - sw.y0 === 36 && sw.y1 <= 117, sw);
  const z = E.workZone(room.items[1], 36);
  ok("the counter's work zone is 36 in deep on the side it faces", z.y0 === 30 && z.y1 === 66 && z.x1 - z.x0 === 96, z);
}

// ── 2 · every profile, the same rooms ─────────────────────────────────────────────────────────────────────────────
{
  const geo = V.groupIssues(V.issues(STORE)).map((f) => f.words).sort();
  for (const m of MODELS) {
    const f = E.evaluate(STORE, P.PROFILES[m]);
    ok(`${m}: the seed store's geometry findings are exactly today's plan reviewer's`, JSON.stringify(f.filter((x) => x.check === "geometry").map((x) => x.words).sort()) === JSON.stringify(geo));
    ok(`${m}: every finding says whether it's detected or needs a site check, and names what it's about`, f.every((x) => (x.source === "detected" || x.source === "site_check") && x.ids.length > 0 && x.words.length > 10));
  }
  // A fridge in the door's swing.
  const blocked = { width_in: 240, depth_in: 240, items: [it("door", "door", 120, 237, 36, 6, 84), it("fridge", "reach_in", 120, 214, 30, 30, 80), it("ctr", "order_counter", 120, 20, 96, 30, 42)] };
  for (const m of MODELS) {
    const f = E.evaluate(blocked, P.PROFILES[m]);
    ok(`${m}: a fridge where the door swings is found — and marked to check on site`, f.some((x) => x.check === "door" && x.ids.includes("fridge") && x.source === "site_check"), f.map((x) => x.words));
  }
  // A pinched route to the counter: two tables leave 24 in between them.
  const pinched = { width_in: 240, depth_in: 240, items: [it("door", "door", 120, 237, 36, 6, 84), it("ctr", "order_counter", 120, 20, 96, 30, 42),
    it("t1", "community", 54, 140, 96, 36, 30), it("t2", "community", 186, 140, 96, 36, 30), it("wall1", "partition", 6, 140, 12, 36, 96), it("wall2", "partition", 234, 140, 12, 36, 96)] };
  const pub = E.evaluate(pinched, P.PROFILES.brick_and_mortar);
  const r = pub.find((x) => x.check === "route" && x.ids.includes("ctr"));
  ok("storefront: the way from the door to the counter narrows below 36 in — found, the width measured, the place named", r && /narrows to/.test(r.words) && r.at && Math.abs(r.at.y - 140) < 30, r);
  ok("…and the route comes with its path, so the plan can draw it", r && r.path.length > 3);
  const kioskF = E.evaluate(pinched, P.PROFILES.kiosk);
  ok("kiosk: guests don't walk inside — the tables aren't public targets, but the crew's way to the counter is still measured", !kioskF.some((x) => x.check === "route" && (x.ids.includes("t1") || x.ids.includes("t2"))) && kioskF.some((x) => x.check === "route" && x.ids.includes("ctr")));
  // A walled-off counter: no way through at all.
  const walled = { width_in: 240, depth_in: 240, items: [it("door", "door", 120, 237, 36, 6, 84), it("ctr", "order_counter", 120, 20, 96, 30, 42), it("wall", "partition", 120, 120, 240, 6, 96)] };
  for (const m of MODELS) ok(`${m}: a counter no one can reach is an error`, E.evaluate(walled, P.PROFILES[m]).some((x) => x.check === "route" && x.level === "error" && x.ids.includes("ctr")));
  // Something in the crew's work zone.
  const back = { width_in: 240, depth_in: 240, items: [it("prep", "prep_counter", 120, 15, 96, 30, 36), it("bin", "storage", 120, 50, 36, 18, 60)] };
  for (const m of MODELS) ok(`${m}: shelving inside the prep counter's work zone is found`, E.evaluate(back, P.PROFILES[m]).some((x) => x.check === "work_zone" && x.ids.includes("bin")));
}

// ── orientation ──
{
  const room = { width_in: 240, depth_in: 240, items: [it("door", "door", 120, 237, 36, 6, 84), it("shelf", "pickup_shelf", 200, 7, 48, 14, 60, 180), it("ctr", "order_counter", 120, 120, 96, 30, 42)] };
  // rot 180: the front is the top edge — against the top wall.
  for (const m of MODELS) {
    const f = E.evaluate(room, P.PROFILES[m]);
    if (P.PROFILES[m].publicInside) {
      ok(`${m}: a shelf drawn facing the wall is flagged to check — not reported unreachable`, f.some((x) => x.check === "orientation" && x.ids.includes("shelf") && /faces the wall/.test(x.words)) && !f.some((x) => x.check === "route" && x.ids.includes("shelf") && x.level === "error"), f.map((x) => x.words));
    }
  }
}

// ── 3 · one engine ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const src = read("lib/spatial/evaluate.ts");
  ok("one evaluate for every model: no model is named inside the engine", !/brick_and_mortar|stationary_trailer|recurring_trailer|"kiosk"|partnership/.test(src));
  ok("the engine reuses the shared geometry (footprint, issues, the flow's door and stand points), never its own copy", /from "\.\.\/vision"/.test(src) && /from "\.\.\/visionFlow"/.test(src) && !/function footprint/.test(src));
  // A correction to a shared calculation reaches every model: widen every profile's route rule and every model reports more.
  const pinched = { width_in: 240, depth_in: 240, items: [it("door", "door", 120, 237, 36, 6, 84), it("ctr", "order_counter", 120, 20, 96, 30, 42), it("t1", "community", 60, 140, 96, 36, 30), it("t2", "community", 180, 140, 96, 36, 30)] };
  const counts = MODELS.map((m) => E.evaluate(pinched, P.PROFILES[m]).filter((x) => x.check === "route").length);
  const wider = MODELS.map((m) => E.evaluate(pinched, { ...P.PROFILES[m], routeIn: 120 }).filter((x) => x.check === "route").length);
  ok("a changed rule reaches every model through the one engine", wider.every((n, k) => n >= counts[k]) && wider.some((n, k) => n > counts[k]), { counts, wider });
  ok("a new operating model is a row of data: the engine runs it unchanged", E.evaluate(STORE, { ...P.PROFILES.kiosk, key: "food_hall", name: "Food hall stall" }).length >= 0);
  ok("every profile says its dimensions are GT3 working defaults, not code — and each finding says so too", Object.values(P.PROFILES).every((p) => /not a code requirement/.test(p.basis)) && (src.match(/a GT3 working default, not a code/g) ?? []).length >= 2);
  ok("Evaluate says which operating model the room was checked as", /checkedAs=\{PROFILES\[model\]\}/.test(read("components/vision/StoreDesigner.tsx")) && /Checked as a/.test(read("components/vision/Evaluate.tsx")));
  ok("each plan format maps to a model", P.modelOf("kiosk") === "kiosk" && P.modelOf("storefront_lease") === "brick_and_mortar" && P.modelOf("gym_bar") === "partnership" && P.modelOf("pop_up") === "recurring_trailer" && P.modelOf(null) === "brick_and_mortar");
  // Fast enough to run as you work: 100 things, every model.
  const many = { width_in: 360, depth_in: 480, items: [...SEED, ...Array.from({ length: 81 }, (_, k) => it(`x${k}`, "two_top", 24 + (k % 9) * 36, 24 + Math.floor(k / 9) * 36, 24, 24, 30))] };
  const t0 = performance.now(); for (const m of MODELS) E.evaluate(many, P.PROFILES[m]); const per = (performance.now() - t0) / MODELS.length;
  ok(`100 things: one evaluation in ${per.toFixed(0)} ms (budget 50 ms on this machine; it runs after a drag, not during)`, per < 50, per);
}

console.log(`THE SHARED SPATIAL ENGINE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
