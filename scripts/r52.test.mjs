// R52 — THE VISION (2026-10-25 — Ryan: "Allow me a place to interactively build my roadmap… design a brick-and-mortar 3D
// design place: things, items, place it in certain places, explain why it's there… almost like a light version of
// AutoCAD"; "espresso is not a part of the brand standard… stillness, light, fuel, movement"; "allow real animation
// automation to take over. Showing the flow of traffic and flow state").
//
//   1 · lib/vision: the four pillars, the catalog (no espresso), a plan's geometry and what a reviewer circles, feet and
//       inches both ways, the money's totals, the board, the months in words. The first draft (0447) has no problems.
//   2 · lib/vision3d: a point in front of the camera lands on the canvas, one behind it doesn't; the floor is painted
//       first; a tap picks the nearest thing; guests stand in the room.
//   3 · lib/visionFlow: a walk goes around things, never through them; guests arrive at the rate asked; the line forms at
//       the counter; seats fill and empty; heat builds where people walk; a room without a door or a counter says so.
//   4 · The wiring: /vision for the crew, /present for a link (its token in the fragment, never sent to a server), the
//       titles, the palette, the Command door, Flow in the designer and in Present.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// The first draft's room, read from 0447 itself — the test and the migration can't drift apart.
const SQL = read("supabase/migrations/0447_the_plan_people_can_see.sql");
const SEED = [...SQL.matchAll(/\(lay, '(\w+)',\s*'([^']*)',\s*(-?\d+),\s*(-?\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*'((?:[^']|'')*)', '\{([^}]*)\}', (\d+)\)/g)]
  .map((m, i) => ({ id: `i${i + 1}`, kind: m[1], label: m[2], x_in: +m[3], y_in: +m[4], rot: +m[5], w_in: +m[6], d_in: +m[7], h_in: +m[8], why: m[9], pillars: m[10] ? m[10].split(",") : [], sort: +m[11] }));
const ROOM = { id: "r", name: "The first store (draft)", width_in: 360, depth_in: 480, ceiling_in: 132, notes: null, items: SEED };

// ── 1 · lib/vision ──────────────────────────────────────────────────────────────────────────────────────────────────
const V = loadTs("lib/vision.ts");
{
  ok("the four pillars, in order", JSON.stringify(V.PILLARS) === JSON.stringify(["stillness", "light", "fuel", "movement"]));
  ok("the seed parsed: 19 things", SEED.length === 19, SEED.length);
  ok("the catalog: no espresso — not a kind, not a name", V.CATALOG.every((c) => !/espresso/i.test(c.kind) && !/espresso/i.test(c.name)));
  ok("…and an espresso machine can't be added", !V.allowedKind("espresso_machine") && V.allowedKind("tap_tower") && V.allowedKind("broth_station"));
  ok("every catalog kind's pillars are among the four", V.CATALOG.every((c) => c.pillars.every((p) => V.PILLARS.includes(p))));
  ok("every thing in the draft is a catalog kind", SEED.every((i) => V.CATALOG.some((c) => c.kind === i.kind)), SEED.filter((i) => !V.CATALOG.some((c) => c.kind === i.kind)).map((i) => i.kind));
  const found = V.issues(ROOM);
  ok("the first draft has nothing a plan reviewer would circle", found.length === 0, found);
  // A footprint turns with the thing.
  const f0 = V.footprint({ x_in: 100, y_in: 100, rot: 0, w_in: 60, d_in: 20 }), f90 = V.footprint({ x_in: 100, y_in: 100, rot: 90, w_in: 60, d_in: 20 });
  ok("a footprint: 60 × 20, turned 90°, is 20 × 60", f0.x1 - f0.x0 === 60 && f0.y1 - f0.y0 === 20 && f90.x1 - f90.x0 === 20 && f90.y1 - f90.y0 === 60, { f0, f90 });
  ok("a 6-inch snap", V.snap(14) === 12 && V.snap(15) === 18 && V.snap(-2) === 0);
  const pushed = V.clampInside({ ...SEED[2], x_in: 5, y_in: 1000 }, ROOM);
  ok("a thing dragged past the walls stops at them", pushed.x_in === 72 && pushed.y_in === 480 - 15, pushed);
  const two = { ...ROOM, items: [{ ...SEED[2], id: "a" }, { ...SEED[2], id: "b", x_in: SEED[2].x_in + 10 }] };
  ok("two things in one place: an error, naming both", V.issues(two).some((i) => i.level === "error" && i.ids.includes("a") && i.ids.includes("b")), V.issues(two));
  const tight = { ...ROOM, items: [{ ...SEED[2], id: "a", x_in: 100, y_in: 200 }, { ...SEED[2], id: "b", x_in: 100, y_in: 250 }] };
  ok("an aisle under 36 inches: a warning, with the inches", V.issues(tight).some((i) => i.level === "warn" && /36/.test(i.words)), V.issues(tight));
  const out = { ...ROOM, items: [{ ...SEED[2], id: "a", x_in: 350 }] };
  ok("a thing past a wall: an error", V.issues(out).some((i) => i.level === "error"), V.issues(out));
  ok("feet and inches, written", V.ftIn(74) === "6′ 2″" && V.ftIn(72) === "6′" && V.ftIn(8) === "8″", [V.ftIn(74), V.ftIn(72), V.ftIn(8)]);
  ok("…and read, however it's typed", V.parseFtIn("6′ 2″") === 74 && V.parseFtIn("6 2") === 74 && V.parseFtIn("74") === 74 && V.parseFtIn("6'") === 72 && V.parseFtIn("abc") === null,
    ["6′ 2″", "6 2", "74", "6'", "abc"].map(V.parseFtIn));
  const st = V.roomStats(ROOM);
  ok("the room's numbers: 1,200 sq ft, 15 seats, 19 things", st.sqft === 1200 && st.seats === 15 && st.items === 19, st);
  const t = V.askTotals([{ amount_cents: 5000000, state: "open" }, { amount_cents: 2000000, state: "committed" }, { amount_cents: 0, state: "open" }]);
  ok("the asks: totals by state, an unset amount counted as unset", t.total === 7000000 && t.open === 5000000 && t.committed === 2000000 && t.unset === 1, t);
  ok("money, short — exact under $100K, then $350K, $1.2M", V.shortMoney(5000000) === "$50,000" && V.shortMoney(35000000) === "$350K" && V.shortMoney(120000000) === "$1.2M",
    [V.shortMoney(5000000), V.shortMoney(35000000), V.shortMoney(120000000)]);
  const b = V.board([{ id: "1", title: "c", horizon: "later", sort: 1 }, { id: "2", title: "b", horizon: "now", sort: 2 }, { id: "3", title: "a", horizon: "now", sort: 1 }]);
  ok("the board: Now, Next, Later — each in its order", b.now.map((p) => p.id).join() === "3,2" && b.next.length === 0 && b.later[0].id === "1", b);
  ok("months in words — quarters, never a false day", V.whenWords("2027-03-01", "2027-09-01") === "Q1 2027 – Q3 2027" && V.whenWords(null, "2027-05-01") === "By Q2 2027" && V.whenWords(null, null) === null,
    [V.whenWords("2027-03-01", "2027-09-01"), V.whenWords(null, "2027-05-01")]);
}

// ── 2 · lib/vision3d ────────────────────────────────────────────────────────────────────────────────────────────────
const D = loadTs("lib/vision3d.ts");
{
  const cam = D.homeCamera(ROOM, 0.75, 402 / 300);
  const project = D.projector(cam, 402, 300);
  const centre = project([180, 0, 240]);
  ok("the room's middle lands in the middle of the canvas", centre && Math.abs(centre[0] - 201) < 2 && Math.abs(centre[1] - 150) < 2, centre);
  const eye = D.eyeOf(cam);
  ok("a point behind the eye isn't drawn", project([eye[0] + (eye[0] - 180), eye[1], eye[2] + (eye[2] - 240)]) === null);
  const faces = D.sceneFaces(ROOM, SEED, cam, 402, 300, null, { figures: [{ x: 180, y: 300, color: "#3a6ea5" }], heat: [{ x: 168, y: 288, size: 24, v: 1 }] });
  const firstItem = faces.findIndex((f) => f.id);
  ok("the floor and its heat are painted before anything that stands on it", faces.slice(0, firstItem).every((f) => f.id === null) && faces.findIndex((f) => f.fill === "#b82420") < firstItem);
  ok("a guest stands in the room (a body and a head)", faces.filter((f) => f.fill === D.shade("#e8c9a6", 0.62 + 0.45 * 0.85) || /rgb/.test(f.fill)).length > 0);
  const counter = SEED.find((i) => i.kind === "order_counter");
  // A tap on any visible part of the counter picks it (the taps stand in front of its middle from this corner, and a tap
  // there rightly picks the taps).
  const centres = faces.filter((f) => f.id === counter.id).flatMap((f) => {
    const cx = f.pts.reduce((s, p) => s + p[0], 0) / f.pts.length, cy = f.pts.reduce((s, p) => s + p[1], 0) / f.pts.length;
    return [[cx, cy], ...f.pts.map(([x, y]) => [cx + (x - cx) * 0.8, cy + (y - cy) * 0.8])];
  });
  const picks = centres.map(([x, y]) => D.pick(faces, x, y));
  ok("a tap on the counter picks the counter", picks.includes(counter.id) && picks.every((p) => p !== null), picks);
  ok("a tap on nothing picks nothing", D.pick(faces, 1, 1) === null);
  const tall = D.homeCamera(ROOM, 0.75, 0.5), wide = D.homeCamera(ROOM, 0.75, 1.6);
  ok("a phone held upright stands farther back than a laptop", tall.dist > wide.dist, { tall: tall.dist, wide: wide.dist });
}

// ── 3 · lib/visionFlow ──────────────────────────────────────────────────────────────────────────────────────────────
const F = loadTs("lib/visionFlow.ts");
{
  const g = F.grid(ROOM);
  const blocked = (p) => !g.free[Math.floor(p.y / F.CELL) * g.cols + Math.floor(p.x / F.CELL)];
  const counter = SEED.find((i) => i.kind === "order_counter");
  const door = SEED.find((i) => i.kind === "door");
  ok("the counter itself isn't floor", blocked({ x: counter.x_in, y: counter.y_in }));
  const from = F.nearestFree(g, F.doorIn(ROOM, door)), to = F.nearestFree(g, F.standAt(counter, 20));
  ok("the door's inside and the counter's front are floor", from && to && !blocked(from) && !blocked(to), { from, to });
  ok("you stand at the counter on the side it faces (toward the door)", F.standAt(counter, 20).y > counter.y_in);
  const walk = F.path(g, from, to);
  // Every step of the walk, sampled each inch, is on floor.
  let through = 0;
  for (let k = 1; k < (walk?.length ?? 0); k++) {
    const a = walk[k - 1], b = walk[k], n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
    for (let s = 0; s <= n; s++) { const p = { x: a.x + ((b.x - a.x) * s) / Math.max(1, n), y: a.y + ((b.y - a.y) * s) / Math.max(1, n) }; if (blocked(p)) through++; }
  }
  ok("a walk from the door to the counter goes around things, never through them", walk && walk.length >= 2 && through === 0, { len: walk?.length, through });
  ok("…smoothed to its turns (not a step per square)", walk.length < 12, walk.length);

  const sim = F.makeSim(ROOM, { ...F.DEFAULTS, perHour: 60 }, 7);
  ok("the draft can run: no problem", sim.problem === null, sim.problem);
  ok("…its seats, from the catalog: 15", sim.seats.reduce((n, s) => n + s.cap, 0) === 15);
  let maxIn = 0, sawSeat = false, sawLine = 0;
  for (let k = 0; k < 4 * 3600; k++) {
    F.step(sim, 0.25);
    maxIn = Math.max(maxIn, sim.guests.length);
    sawSeat ||= sim.guests.some((x) => x.phase === "seated");
    sawLine = Math.max(sawLine, sim.queue.length);
  }
  const s = F.flowStats(sim, SEED);
  ok("an hour at 60 an hour: about 60 served (45–75)", s.servedPerHour >= 45 && s.servedPerHour <= 75, s);
  ok("guests sat, and stood in line", sawSeat && sawLine >= 1, { sawSeat, sawLine });
  ok("never more seated than seats", s.seated <= s.seats && sim.seats.every((x) => x.used <= x.cap && x.used >= 0), sim.seats);
  ok("a visit: minutes, not seconds or hours (2–40)", s.avgVisitMin >= 2 && s.avgVisitMin <= 40, s.avgVisitMin);
  ok("the busiest square is named by what's beside it", s.hot && typeof s.hot.near === "string" && s.hot.near.length > 0, s.hot);
  ok("heat squares: 0 to 1, the hottest 1", (() => { const h = F.heatSquares(sim); return h.length > 0 && h.every((x) => x.v > 0 && x.v <= 1) && h.some((x) => x.v === 1); })());
  ok("the counter's pace: about 80 an hour at 45 seconds each", s.counterPerHour === 80, s.counterPerHour);
  ok("the room keeps up at 60 an hour, and says so", /keeps up|line reached/.test(F.flowWords(s, 60)), F.flowWords(s, 60));
  ok("…and at 150 an hour it says the counter can't, and what would carry it", /More guests than the counter can serve.*Another register or a walk-up window/.test(F.flowWords(s, 150))   /* R55: every register serves one line */, F.flowWords(s, 150));

  // The same seed, the same morning: a simulation is reproducible (a test, a screenshot, a tour all agree).
  const a = F.makeSim(ROOM, F.DEFAULTS, 3), b2 = F.makeSim(ROOM, F.DEFAULTS, 3);
  for (let k = 0; k < 2400; k++) { F.step(a, 0.25); F.step(b2, 0.25); }
  ok("the same seed is the same morning", JSON.stringify(a.guests.map((x) => [x.id, Math.round(x.at.x), Math.round(x.at.y)])) === JSON.stringify(b2.guests.map((x) => [x.id, Math.round(x.at.x), Math.round(x.at.y)])));

  const noDoor = F.makeSim({ ...ROOM, items: SEED.filter((i) => i.kind !== "door") });
  ok("no door: it says so, and nothing moves", /No door/.test(noDoor.problem ?? "") && (F.step(noDoor, 10), noDoor.guests.length === 0), noDoor.problem);
  const noCounter = F.makeSim({ ...ROOM, items: SEED.filter((i) => i.kind !== "order_counter") });
  ok("no counter: it says so", /No order counter/.test(noCounter.problem ?? ""), noCounter.problem);
  const wall = { id: "w", kind: "partition", label: null, x_in: 180, y_in: 400, rot: 0, w_in: 360, d_in: 6, h_in: 96, why: null, pillars: [], sort: 99 };
  const walled = F.makeSim({ ...ROOM, items: [...SEED, wall] });
  ok("a wall across the room, between the door and the counter: no way in, said plainly", /no way from the door to the counter/.test(walled.problem ?? ""), walled.problem);
}

// ── 4 · the wiring ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const surfaces = read("lib/surfaces.ts"), titles = read("lib/routeTitles.ts"), palette = read("components/CommandPalette.tsx"), crew = read("app/crew/page.tsx");
  ok("/vision is a crew surface; /present is a share", /"\/vision"/.test(surfaces) && /p === "\/present"/.test(surfaces));
  ok("their titles: The vision, The plan", /vision: "The vision"/.test(titles) && /present: "The plan"/.test(titles));
  ok("the palette finds it by what people ask: what's next, the store, investors", /act:vision/.test(palette) && /what's next/.test(palette) && /investors/.test(palette));
  ok("the Command door on the crew page", /href="\/vision"/.test(crew));
  const vlayout = read("app/vision/page.tsx") + read("app/vision/layout.tsx");
  ok("/vision: the crew gate; editing is for admins", /staffAccess/.test(vlayout) && /canOf\(profile\)\.admin/.test(vlayout), vlayout.slice(0, 300));
  const shares = read("components/vision/Shares.tsx"), present = read("app/present/page.tsx");
  ok("a link's token rides in the fragment (#), which a browser never sends to a server", /\/present#\$\{token\}/.test(shares) && /location\.hash/.test(present));
  ok("a link reads through vision_shared alone", /rpc\("vision_shared"/.test(read("lib/visionRead.ts")));
  const designer = read("components/vision/StoreDesigner.tsx"), pres = read("components/vision/Present.tsx");
  ok("Flow in the designer: the plan's guests and heat, the 3D's figures", /useFlow\(/.test(designer) && /className="guest"/.test(designer) && /className="heat"/.test(designer) && /figures=\{figures\}/.test(designer));
  ok("Flow in Present's store tour", /useFlow\(/.test(pres) && /<FlowBar compact/.test(pres));
  ok("the presenter's stage centres without cutting off a tall slide's top", /\.vp-slide\{[^}]*margin-block:auto/.test(read("components/vision/vision.css")) && !/\.vp-stage\{[^}]*align-items:center/.test(read("components/vision/vision.css")));
  const flowHook = read("components/vision/useFlow.ts");
  ok("Flow opens a room already in use (a warmed-up morning), and a drag restarts it without a stutter", /WARM_SEC = 900/.test(flowHook) && /step\(sim, 1\)/.test(flowHook));
}

console.log(`R52 — THE VISION: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
