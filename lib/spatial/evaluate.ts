import { footprint, groupIssues, issues, kindOf, type Box, type Issue, type Item, type Layout } from "../vision";
import { doorIn, standAt } from "../visionFlow";
import { ftIn } from "../vision";
import type { Profile } from "./profiles";

// THE SHARED SPATIAL ENGINE (2026-10-26). One function for every operating model: evaluate(layout, profile). It reads
// only the saved geometry — sizes, places, turns — and returns findings a person can act on, each tagged:
//   detected   — geometry says so (two things overlap; a route narrows to 28 in)
//   site check — the drawing can't know (which way a door actually swings; a step; a slope)
// Routes are measured, not guessed: a fine grid of the floor, each point's distance to the nearest thing or wall, and
// the widest way from the door to where people need to be — its narrowest point is the route's true clear width. A
// correction to the geometry here reaches every model, because there is only one.
export type Finding = Issue & { check: "geometry" | "orientation" | "route" | "door" | "work_zone"; source: "detected" | "site_check"; path?: { x: number; y: number }[]; at?: { x: number; y: number } };

const STEP = 3;                    // inches: the clearance grid
/** Clearance is measured out to this far (in): a route this wide twice over is wider than any rule asks. */
const CAP = 60;
const blocks = (it: Item) => it.kind !== "door" && it.kind !== "mobility" && it.h_in >= 6;
const hits = (a: Box, b: Box) => a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
const name = (i: Item) => i.label || kindOf(i.kind).name;

/** Distance from a point to a box (0 inside). */
function toBox(x: number, y: number, b: Box) { const dx = Math.max(b.x0 - x, 0, x - b.x1), dy = Math.max(b.y0 - y, 0, y - b.y1); return Math.hypot(dx, dy); }

export type Clearance = { cols: number; rows: number; d: Float32Array };
/** Each grid point's distance (in) to the nearest thing that stands on the floor, or a wall — doors are openings. */
export function clearance(l: Pick<Layout, "width_in" | "depth_in" | "items">, cap = CAP): Clearance {
  const cols = Math.max(1, Math.round(l.width_in / STEP)), rows = Math.max(1, Math.round(l.depth_in / STEP));
  const doors = l.items.filter((i) => i.kind === "door").map(footprint);
  const d = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = (c + 0.5) * STEP, y = (r + 0.5) * STEP;
    let m = Math.min(cap, x, y, l.width_in - x, l.depth_in - y);
    // At a door the wall isn't there: measure past it.
    if (doors.some((b) => x >= b.x0 && x <= b.x1 && (y <= Math.max(b.y1, 24) || y >= Math.min(b.y0, l.depth_in - 24))) || doors.some((b) => y >= b.y0 && y <= b.y1 && (x <= Math.max(b.x1, 24) || x >= Math.min(b.x0, l.width_in - 24)))) m = Math.max(m, Math.min(cap, 24));
    d[r * cols + c] = m;
  }
  // Each thing lowers the points within `cap` of it — beyond that a route is wider than any rule asks (S1.1c: measured,
  // 100 things on every point cost 60 ms; on its own neighbourhood, a few).
  for (const b of l.items.filter(blocks).map(footprint)) {
    const c0 = Math.max(0, Math.floor((b.x0 - cap) / STEP)), c1 = Math.min(cols - 1, Math.floor((b.x1 + cap) / STEP));
    const r0 = Math.max(0, Math.floor((b.y0 - cap) / STEP)), r1 = Math.min(rows - 1, Math.floor((b.y1 + cap) / STEP));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const i = r * cols + c, t = toBox((c + 0.5) * STEP, (r + 0.5) * STEP, b); if (t < d[i]) d[i] = t; }
  }
  return { cols, rows, d };
}

const idx = (g: Clearance, p: { x: number; y: number }) => Math.min(g.rows - 1, Math.max(0, Math.floor(p.y / STEP))) * g.cols + Math.min(g.cols - 1, Math.max(0, Math.floor(p.x / STEP)));

/** The widest ways from one point to many: for each target, the largest clear width w such that a route exists where
 *  every point keeps w/2 from everything — and that route. Grid points are added widest first and joined (union–find);
 *  a target's width is the level at which it joins the start. The first and last steps are free: arriving at a counter
 *  means standing close to it, and that isn't a narrow route (`ends`: how far from each end that holds, in inches). */
export function widestFrom(g: Clearance, a: { x: number; y: number }, targets: { x: number; y: number }[], ends = 18, needPath: (width: number) => boolean = () => true): ({ width: number; path: { x: number; y: number }[]; narrowest: { x: number; y: number } } | null)[] {
  const n = g.cols * g.rows, s = idx(g, a), ts = targets.map((t) => idx(g, t));
  const d = new Float32Array(g.d);
  const open = (p: { x: number; y: number }) => { const r0 = Math.floor((p.y - ends) / STEP), r1 = Math.floor((p.y + ends) / STEP), c0 = Math.floor((p.x - ends) / STEP), c1 = Math.floor((p.x + ends) / STEP);
    for (let r = Math.max(0, r0); r <= Math.min(g.rows - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(g.cols - 1, c1); c++) if (d[r * g.cols + c] > 0) d[r * g.cols + c] = 1e6; };
  open(a); targets.forEach(open);
  const order = Array.from({ length: n }, (_, i) => i).filter((i) => d[i] > 0).sort((p, q) => d[q] - d[p]);
  const parent = new Int32Array(n).fill(-1);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const level = ts.map(() => -1); let left = ts.length;
  for (const i of order) {
    parent[i] = i;
    const c = i % g.cols, r = (i / g.cols) | 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const j = nr * g.cols + nc;
      if (parent[j] !== -1) { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; }
    }
    if (parent[s] === -1) continue;
    const rs = find(s);
    for (let k = 0; k < ts.length; k++) if (level[k] < 0 && parent[ts[k]] !== -1 && find(ts[k]) === rs) { level[k] = d[i]; left--; }
    if (!left) break;
  }
  const pt = (i: number) => ({ x: ((i % g.cols) + 0.5) * STEP, y: (((i / g.cols) | 0) + 0.5) * STEP });
  return ts.map((t, k) => {
    const lv = level[k];
    if (lv <= 0) return null;
    if (!needPath(Math.round(lv * 2))) return { width: Math.min(9999, Math.round(lv * 2)), path: [], narrowest: pt(t) };
    const prev = new Int32Array(n).fill(-1), seen = new Uint8Array(n); const q = [s]; seen[s] = 1; let h = 0;
    while (h < q.length) { const i = q[h++]; if (i === t) break; const c = i % g.cols, r = (i / g.cols) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue; const j = nr * g.cols + nc; if (seen[j] || d[j] < lv) continue; seen[j] = 1; prev[j] = i; q.push(j); } }
    const cells: number[] = []; for (let i = t; i !== -1; i = prev[i]) { cells.push(i); if (i === s) break; }
    cells.reverse();
    let low = cells[0]; for (const i of cells) if (d[i] < d[low]) low = i;
    return { width: Math.min(9999, Math.round(lv * 2)), path: cells.filter((_, j) => j % 4 === 0 || j === cells.length - 1).map(pt), narrowest: pt(low) };
  });
}
/** One start, one end (widestFrom for a single target). */
export const widest = (g: Clearance, a: { x: number; y: number }, b: { x: number; y: number }, ends = 18) => widestFrom(g, a, [b], ends)[0];

/** What a door sweeps: a square as deep as the door is wide, on the room side of the wall it's in. */
export function doorSwing(l: Pick<Layout, "width_in" | "depth_in">, door: Item): Box {
  const b = footprint(door), w = door.w_in;
  const d = { left: b.x0, right: l.width_in - b.x1, top: b.y0, bottom: l.depth_in - b.y1 };
  const wall = (Object.entries(d) as [keyof typeof d, number][]).sort((p, q) => p[1] - q[1])[0][0];
  return wall === "bottom" ? { x0: b.x0, y0: b.y0 - w, x1: b.x1, y1: b.y0 } : wall === "top" ? { x0: b.x0, y0: b.y1, x1: b.x1, y1: b.y1 + w }
    : wall === "left" ? { x0: b.x1, y0: b.y0, x1: b.x1 + w, y1: b.y1 } : { x0: b.x0 - w, y0: b.y0, x1: b.x0, y1: b.y1 };
}

/** The crew's working zone in front of a thing they work at (the side it faces), `depth` deep. */
export function workZone(it: Item, depth: number): Box {
  const b = footprint(it);
  return it.rot === 0 ? { x0: b.x0, y0: b.y1, x1: b.x1, y1: b.y1 + depth } : it.rot === 180 ? { x0: b.x0, y0: b.y0 - depth, x1: b.x1, y1: b.y0 }
    : it.rot === 90 ? { x0: b.x0 - depth, y0: b.y0, x1: b.x0, y1: b.y1 } : { x0: b.x1, y0: b.y0, x1: b.x1 + depth, y1: b.y1 };
}

/** What hangs on a wall above the floor (a menu board, a window): never in anyone's way. */
const HANGS = new Set(["menu_board", "window_wall", "walk_up"]);
/** Things used from one side (their front), so facing a wall is a drawing to check. */
const FACES = new Set(["order_counter", "pickup_shelf", "bottle_cooler", "prep_counter", "three_sink", "reach_in", "brew_vessels", "tap_tower", "broth_station", "lounge", "merch_wall"]);
const WORKED = new Set(["prep_counter", "three_sink", "hand_sink", "reach_in", "ice_machine", "brew_vessels", "tap_tower", "broth_station", "order_counter", "walk_up"]);
const PUBLIC_TARGETS = new Set(["order_counter", "pickup_shelf", "bottle_cooler", "community", "four_top", "two_top", "window_bar", "lounge", "bench", "restroom"]);
const CREW_TARGETS = new Set(["prep_counter", "three_sink", "reach_in", "walk_up", "order_counter", "brew_vessels", "tap_tower"]);

/** Every check, one profile. */
export function evaluate(l: Pick<Layout, "width_in" | "depth_in" | "items">, p: Profile): Finding[] {
  const out: Finding[] = groupIssues(issues(l)).map((f) => ({ ...f, check: "geometry", source: "detected" }));
  const door = l.items.find((i) => i.kind === "door");
  // Doors.
  if (p.doorSwing) for (const d of l.items.filter((i) => i.kind === "door")) {
    const sw = doorSwing(l, d);
    const inWay = l.items.filter((i) => i.id !== d.id && blocks(i) && hits(footprint(i), sw));
    if (inWay.length) out.push({ ids: [d.id, ...inWay.map((i) => i.id)], level: "warn", check: "door", source: "site_check",
      words: `${inWay.map(name).join(", ")} ${inWay.length === 1 ? "stands" : "stand"} where ${name(d)} would swing (${ftIn(d.w_in)}) — if it swings in, it can't open fully. Check which way it swings on site.` });
  }
  // The crew's working zones.
  for (const it of l.items.filter((i) => WORKED.has(i.kind) && i.kind !== "walk_up")) {
    const z = workZone(it, p.workZoneIn);
    const inWay = l.items.filter((o) => o.id !== it.id && blocks(o) && !HANGS.has(o.kind) && hits(footprint(o), z));
    if (inWay.length) out.push({ ids: [it.id, ...inWay.map((o) => o.id)], level: "warn", check: "work_zone", source: "detected",
      words: `${inWay.map(name).join(", ")} ${inWay.length === 1 ? "is" : "are"} inside the ${ftIn(p.workZoneIn)} in front of ${name(it)} where the crew works (a GT3 working default, not a code).` });
  }
  // Routes from the door.
  if (door) {
    const g = clearance(l), from = doorIn(l, door);
    const targets = l.items.filter((i) => (p.publicInside ? PUBLIC_TARGETS : CREW_TARGETS).has(i.kind));
    // Where a person stands to use each thing: in front of the side it faces — or, when that side is against a wall or
    // another thing (a shelf drawn facing the wall), the clearest side it has, and the drawing is flagged to check.
    const stands = targets.map((t) => {
      const b = footprint(t), front = standAt(t, 12);
      const sides = [front, { x: (b.x0 + b.x1) / 2, y: b.y0 - 12 }, { x: (b.x0 + b.x1) / 2, y: b.y1 + 12 }, { x: b.x0 - 12, y: (b.y0 + b.y1) / 2 }, { x: b.x1 + 12, y: (b.y0 + b.y1) / 2 }]
        .filter((q) => q.x > 0 && q.y > 0 && q.x < l.width_in && q.y < l.depth_in);
      const clear = (q: { x: number; y: number }) => g.d[idx(g, q)];
      const ok = sides[0] === front && clear(front) >= 6;
      const best = ok ? front : sides.slice().sort((q, r) => clear(r) - clear(q))[0] ?? front;
      const atWall = Math.min(front.x, front.y, l.width_in - front.x, l.depth_in - front.y) < 6;
      if (!ok && FACES.has(t.kind)) out.push({ ids: [t.id], level: "warn", check: "orientation", source: "site_check",
        words: `${name(t)} faces ${atWall ? "the wall" : "something right in front of it"} — its front (the dark edge on the plan) has no room to stand. Turn it, or check the drawing.` });
      return best;
    });
    const ways = widestFrom(g, from, stands, 18, (w) => w < p.routeIn);
    targets.forEach((t, k) => {
      const w = ways[k];
      if (!w) { out.push({ ids: [t.id], level: "error", check: "route", source: "detected", words: `No way through from ${name(door)} to ${name(t)}.` }); return; }
      if (w.width < p.routeIn) out.push({ ids: [t.id], level: "warn", check: "route", source: "detected", path: w.path, at: w.narrowest,
        words: `The way from ${name(door)} to ${name(t)} narrows to ${ftIn(w.width)} — under ${ftIn(p.routeIn)} (a GT3 working default, not a code).` });
    });
  }
  return out;
}
