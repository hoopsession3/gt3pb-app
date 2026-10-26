// THE ROOM, BUSY (R52 — Ryan, 2026-10-25: "allow real animation automation to take over. Showing the flow of traffic
// and flow state."). Guests come in the door, wait their turn at the counter, pick up at the taps, and sit or take a
// bottle and go — walking around what's in the room, never through it. Where they walk and wait is kept as heat: the
// spots people crowd, a layout's bottleneck, before a dollar is spent building it. Pure and step-driven (step(sim, dt)),
// so the plan, the 3D view and the tests run the same simulation.
import { footprint, kindOf, type Item, type Layout } from "./vision";

export const CELL = 6;                 // inches: the walking grid
const BODY = 9;                        // a person's half-width: how close to a thing a centre can pass
const WALK = 52;                       // inches per second — about 3 mph
const HEAT = 24;                       // inches: the heat map's square

export type Pt = { x: number; y: number };
type Grid = { cols: number; rows: number; free: Uint8Array };

/** The walking grid: a cell is free when a person's centre fits there — clear of every thing (but a door) and the walls. */
export function grid(layout: Pick<Layout, "width_in" | "depth_in" | "items">): Grid {
  const cols = Math.ceil(layout.width_in / CELL), rows = Math.ceil(layout.depth_in / CELL);
  const free = new Uint8Array(cols * rows).fill(1);
  const doors = layout.items.filter((i) => i.kind === "door").map(footprint);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * CELL + CELL / 2, y = r * CELL + CELL / 2;
    const atDoor = doors.some((b) => x > b.x0 - 2 && x < b.x1 + 2 && y > b.y0 - BODY * 2 && y < b.y1 + BODY * 2);
    if (!atDoor && (x < BODY || y < BODY || x > layout.width_in - BODY || y > layout.depth_in - BODY)) free[r * cols + c] = 0;
  }
  for (const it of layout.items) {
    if (it.kind === "door" || it.kind === "mobility" || it.h_in < 6) continue;
    const b = footprint(it);
    const c0 = Math.max(0, Math.floor((b.x0 - BODY) / CELL)), c1 = Math.min(cols - 1, Math.floor((b.x1 + BODY) / CELL));
    const r0 = Math.max(0, Math.floor((b.y0 - BODY) / CELL)), r1 = Math.min(rows - 1, Math.floor((b.y1 + BODY) / CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) free[r * cols + c] = 0;
  }
  return { cols, rows, free };
}

const cellOf = (g: Grid, p: Pt) => ({ c: Math.min(g.cols - 1, Math.max(0, Math.floor(p.x / CELL))), r: Math.min(g.rows - 1, Math.max(0, Math.floor(p.y / CELL))) });
const centre = (c: number, r: number): Pt => ({ x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 });

/** The nearest free cell to a point (a ring search), or null when the room has no floor left. */
export function nearestFree(g: Grid, p: Pt): Pt | null {
  const { c, r } = cellOf(g, p);
  for (let d = 0; d < Math.max(g.cols, g.rows); d++) {
    let best: Pt | null = null, bestD = Infinity;
    for (let rr = r - d; rr <= r + d; rr++) for (let cc = c - d; cc <= c + d; cc++) {
      if (Math.max(Math.abs(rr - r), Math.abs(cc - c)) !== d || rr < 0 || cc < 0 || rr >= g.rows || cc >= g.cols || !g.free[rr * g.cols + cc]) continue;
      const q = centre(cc, rr), dd = Math.hypot(q.x - p.x, q.y - p.y);
      if (dd < bestD) { bestD = dd; best = q; }
    }
    if (best) return best;
  }
  return null;
}

/** The shortest walk between two points on the grid (A*, eight ways, no corner-cutting), smoothed to its turns. */
export function path(g: Grid, from: Pt, to: Pt): Pt[] | null {
  const s = cellOf(g, from), t = cellOf(g, to);
  const si = s.r * g.cols + s.c, ti = t.r * g.cols + t.c;
  if (!g.free[si] || !g.free[ti]) return null;
  const n = g.cols * g.rows;
  const gs = new Float32Array(n).fill(Infinity), came = new Int32Array(n).fill(-1), shut = new Uint8Array(n);
  const h = (i: number) => { const c = i % g.cols, r = (i / g.cols) | 0; const dx = Math.abs(c - t.c), dy = Math.abs(r - t.r); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const open: number[] = [si]; const fs = new Float32Array(n).fill(Infinity);
  gs[si] = 0; fs[si] = h(si);
  while (open.length) {
    let bi = 0; for (let k = 1; k < open.length; k++) if (fs[open[k]] < fs[open[bi]]) bi = k;
    const cur = open[bi]; open.splice(bi, 1);
    if (cur === ti) break;
    if (shut[cur]) continue;
    shut[cur] = 1;
    const cc = cur % g.cols, cr = (cur / g.cols) | 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const ni = nr * g.cols + nc;
      if (!g.free[ni] || shut[ni]) continue;
      if (dr && dc && (!g.free[cr * g.cols + nc] || !g.free[nr * g.cols + cc])) continue;
      const cost = gs[cur] + (dr && dc ? 1.414 : 1);
      if (cost < gs[ni]) { gs[ni] = cost; came[ni] = cur; fs[ni] = cost + h(ni); open.push(ni); }
    }
  }
  if (came[ti] === -1 && si !== ti) return null;
  const cells: number[] = [];
  for (let i = ti; i !== -1; i = came[i]) { cells.push(i); if (i === si) break; }
  cells.reverse();
  // Keep the turns: a straight run is one segment.
  const pts = cells.map((i) => centre(i % g.cols, (i / g.cols) | 0));
  const out: Pt[] = [pts[0]];
  for (let k = 1; k < pts.length - 1; k++) {
    const a = out[out.length - 1], b = pts[k], c = pts[k + 1];
    if ((b.x - a.x) * (c.y - b.y) !== (b.y - a.y) * (c.x - b.x)) out.push(b);
  }
  if (pts.length > 1) out.push(pts[pts.length - 1]);
  out[out.length - 1] = to;
  return out;
}

/** Where a person stands to use a thing: in front of the side it faces (the plan's dark edge), a step back. */
export function standAt(it: Item, step = 18): Pt {
  const b = footprint(it);
  const n = it.rot === 0 ? { x: 0, y: 1 } : it.rot === 180 ? { x: 0, y: -1 } : it.rot === 90 ? { x: -1, y: 0 } : { x: 1, y: 0 };
  const hw = (b.x1 - b.x0) / 2, hd = (b.y1 - b.y0) / 2;
  return { x: it.x_in + n.x * (hw + step), y: it.y_in + n.y * (hd + step) };
}

/** The door's inside: a step into the room from whichever wall the door is on. */
export function doorIn(layout: Pick<Layout, "width_in" | "depth_in">, door: Item): Pt {
  const d = { left: door.x_in, right: layout.width_in - door.x_in, top: door.y_in, bottom: layout.depth_in - door.y_in };
  const wall = (Object.entries(d) as [keyof typeof d, number][]).sort((a, b) => a[1] - b[1])[0][0];
  return wall === "bottom" ? { x: door.x_in, y: layout.depth_in - 24 } : wall === "top" ? { x: door.x_in, y: 24 } : wall === "left" ? { x: 24, y: door.y_in } : { x: layout.width_in - 24, y: door.y_in };
}

// ── the simulation ──────────────────────────────────────────────────────────────────────────────────────────────────
export type Phase = "in" | "queue" | "order" | "pickup" | "toSeat" | "seated" | "grab" | "out";
export type Guest = { id: number; at: Pt; route: Pt[]; phase: Phase; until: number; born: number; seat: string | null; grabAndGo: boolean };
export type Settings = { perHour: number; serveSec: number; pickupSec: number; staySec: [number, number]; stayShare: number; grabShare: number };
export const DEFAULTS: Settings = { perHour: 60, serveSec: 45, pickupSec: 90, staySec: [600, 1800], stayShare: 0.5, grabShare: 0.2 };

export type Sim = {
  g: Grid; t: number; guests: Guest[]; next: number; nextId: number; seed: number;
  door: Pt | null; counter: Pt | null; pickup: Pt | null; cooler: Pt | null;
  seats: { id: string; at: Pt; cap: number; used: number }[];
  /** One line, any number of registers (R55): every order counter or walk-up window in the room is one, each serving the
   *  next guest in the one line when it is free. */
  queue: number[]; registers: { at: Pt; guest: number | null; end: number }[];
  heat: Float32Array; heatCols: number; heatRows: number;
  done: { visit: number }[]; served: number; maxQueue: number; problem: string | null; settings: Settings;
  /** The line's walk, counter → door, worked out once: where each guest in line stands. */
  line: Pt[];
};

const rand = (s: Sim) => { s.seed = (s.seed * 1664525 + 1013904223) >>> 0; return s.seed / 4294967296; };

/** A simulation for a room — or, when the room can't host one (no door, no counter, no way in), the reason why. */
export function makeSim(layout: Pick<Layout, "width_in" | "depth_in" | "items">, settings: Settings = DEFAULTS, seed = 7): Sim {
  const g = grid(layout);
  const first = (kinds: string[]) => layout.items.find((i) => kinds.includes(i.kind)) ?? null;
  const door = first(["door"]), counter = first(["order_counter", "walk_up"]);
  const counters = layout.items.filter((i) => i.kind === "order_counter" || i.kind === "walk_up");
  const pick = first(["tap_tower", "pickup_shelf"]) ?? counter, cooler = first(["bottle_cooler"]);
  const free = (p: Pt | null) => (p ? nearestFree(g, p) : null);
  const heatCols = Math.ceil(layout.width_in / HEAT), heatRows = Math.ceil(layout.depth_in / HEAT);
  const sim: Sim = {
    g, t: 0, guests: [], next: 0, nextId: 1, seed,
    door: door ? free(doorIn(layout, door)) : null, counter: free(counter ? standAt(counter, 20) : null), pickup: free(pick ? standAt(pick, 20) : null), cooler: free(cooler ? standAt(cooler, 18) : null),
    seats: layout.items.filter((i) => (kindOf(i.kind).seats ?? 0) > 0).map((i) => ({ id: i.id, at: free(standAt(i, 6)), cap: kindOf(i.kind).seats ?? 1, used: 0 })).filter((x): x is { id: string; at: Pt; cap: number; used: number } => !!x.at),
    queue: [], registers: counters.map((c) => free(standAt(c, 20))).filter((p): p is Pt => !!p).map((at) => ({ at, guest: null, end: 0 })),
    heat: new Float32Array(heatCols * heatRows), heatCols, heatRows,
    done: [], served: 0, maxQueue: 0, problem: null, settings: { ...settings }, line: [],
  };
  if (!door) sim.problem = "No door — add one so guests can come in.";
  else if (!counter) sim.problem = "No order counter — add one so guests can order.";
  else if (!sim.door || !sim.counter || !path(g, sim.door, sim.counter)) sim.problem = "There's no way from the door to the counter — something blocks the path.";
  else sim.line = path(g, sim.counter, sim.door) ?? [sim.counter];
  return sim;
}

const go = (s: Sim, gst: Guest, to: Pt | null) => { gst.route = to ? path(s.g, gst.at, to) ?? [to] : []; };
/** Where the nth guest in line stands: back from the counter toward the door, two feet apart. */
function queueSpot(s: Sim, n: number): Pt {
  if (!s.counter || !s.door) return s.counter ?? { x: 0, y: 0 };
  const line = s.line.length ? s.line : [s.counter];
  let need = n * 24;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (need <= len) return { x: a.x + ((b.x - a.x) * need) / len, y: a.y + ((b.y - a.y) * need) / len };
    need -= len;
  }
  return line[line.length - 1];
}

/** One step of `dt` seconds of the room's time. */
export function step(s: Sim, dt: number): void {
  if (s.problem) return;
  s.t += dt;
  const st = s.settings;
  // Arrivals: a steady rate with the gaps of real life (exponential).
  while (s.t >= s.next) {
    const grab = !!s.cooler && rand(s) < st.grabShare;
    const g: Guest = { id: s.nextId++, at: { ...s.door! }, route: [], phase: grab ? "grab" : "in", until: 0, born: s.t, seat: null, grabAndGo: grab };
    go(s, g, grab ? s.cooler : queueSpot(s, s.queue.length));
    if (!grab) s.queue.push(g.id);
    s.guests.push(g);
    s.next += -Math.log(1 - rand(s)) * (3600 / Math.max(1, st.perHour));
  }
  s.maxQueue = Math.max(s.maxQueue, s.queue.length);
  // The registers: each free one takes the guest at the front of the one line, in the order they came.
  let moved = false;
  for (const r of s.registers) {
    if (r.guest != null && s.t >= r.end) {
      const g = s.guests.find((x) => x.id === r.guest);
      r.guest = null;
      if (g) { g.phase = "pickup"; g.until = s.t + st.pickupSec * (0.5 + rand(s)); go(s, g, g.grabAndGo ? s.door : s.pickup); if (g.grabAndGo) g.phase = "out"; }
    }
    if (r.guest == null && s.queue.length) {
      const head = s.guests.find((x) => x.id === s.queue[0]);
      if (head && head.route.length === 0) {
        s.queue.shift(); moved = true;
        r.guest = head.id; r.end = s.t + st.serveSec * (0.6 + rand(s) * 0.8); head.phase = "order"; go(s, head, r.at);
      }
    }
  }
  if (moved) s.queue.forEach((id, n) => { const q = s.guests.find((x) => x.id === id); if (q) go(s, q, queueSpot(s, n)); });
  for (const g of s.guests) {
    // Walk the route.
    let budget = WALK * dt;
    while (budget > 0 && g.route.length) {
      const to = g.route[0], dx = to.x - g.at.x, dy = to.y - g.at.y, d = Math.hypot(dx, dy);
      if (d <= budget) { g.at = { ...to }; g.route.shift(); budget -= d; } else { g.at = { x: g.at.x + (dx / d) * budget, y: g.at.y + (dy / d) * budget }; budget = 0; }
    }
    const hc = Math.min(s.heatCols - 1, Math.floor(g.at.x / HEAT)), hr = Math.min(s.heatRows - 1, Math.floor(g.at.y / HEAT));
    if (hc >= 0 && hr >= 0 && g.phase !== "seated") s.heat[hr * s.heatCols + hc] += dt;
    if (g.route.length) continue;
    // Arrived: what next.
    if (g.phase === "grab" && !g.until) { g.until = s.t + 20; }
    else if (g.phase === "grab" && s.t >= g.until) { g.phase = "queue"; s.queue.push(g.id); go(s, g, queueSpot(s, s.queue.length - 1)); }
    else if (g.phase === "pickup" && s.t >= g.until) {
      const seat = rand(s) < st.stayShare ? s.seats.find((x) => x.used < x.cap) : undefined;
      if (seat) {
        // Around the table, not on one spot: each guest takes the next place about it.
        const k = seat.used++, a = k * 2.4, r = k ? 12 : 0;
        g.seat = seat.id; g.phase = "toSeat"; go(s, g, nearestFree(s.g, { x: seat.at.x + Math.cos(a) * r, y: seat.at.y + Math.sin(a) * r }) ?? seat.at);
      }
      else { g.phase = "out"; go(s, g, s.door); }
    } else if (g.phase === "toSeat") { g.phase = "seated"; g.until = s.t + st.staySec[0] + rand(s) * (st.staySec[1] - st.staySec[0]); }
    else if (g.phase === "seated" && s.t >= g.until) { const seat = s.seats.find((x) => x.id === g.seat); if (seat) seat.used--; g.phase = "out"; go(s, g, s.door); }
    else if (g.phase === "out") { s.done.push({ visit: s.t - g.born }); s.served++; g.until = -1; }
  }
  s.guests = s.guests.filter((g) => g.until !== -1);
  if (s.done.length > 400) s.done.splice(0, s.done.length - 400);
}

export type FlowStats = { inside: number; inLine: number; maxLine: number; seated: number; seats: number; servedPerHour: number; avgVisitMin: number; counterPerHour: number; hot: { x: number; y: number; near: string } | null };
/** The numbers over the room: who's in, the line, the seats, the pace, the average visit — and where it's hottest. */
export function flowStats(s: Sim, items: readonly Item[]): FlowStats {
  let hi = -1, hv = 0;
  for (let k = 0; k < s.heat.length; k++) if (s.heat[k] > hv) { hv = s.heat[k]; hi = k; }
  const hot = hi < 0 ? null : (() => {
    const x = (hi % s.heatCols) * HEAT + HEAT / 2, y = ((hi / s.heatCols) | 0) * HEAT + HEAT / 2;
    const near = [...items].sort((a, b) => Math.hypot(a.x_in - x, a.y_in - y) - Math.hypot(b.x_in - x, b.y_in - y))[0];
    return { x, y, near: near ? near.label || kindOf(near.kind).name : "the floor" };
  })();
  const hours = Math.max(1 / 60, s.t / 3600);   // a rate over at least a minute, so the first guest isn't "3,600 an hour"
  return {
    inside: s.guests.length, inLine: s.queue.length, maxLine: s.maxQueue,
    seated: s.guests.filter((g) => g.phase === "seated").length, seats: s.seats.reduce((n, x) => n + x.cap, 0),
    servedPerHour: Math.round(s.served / hours),
    counterPerHour: Math.round((3600 / Math.max(1, s.settings.serveSec)) * Math.max(1, s.registers.length)),
    avgVisitMin: s.done.length ? Math.round((s.done.reduce((n, d) => n + d.visit, 0) / s.done.length / 60) * 10) / 10 : 0,
    hot,
  };
}

/** What the numbers say, in a sentence: the counter's limit first (it sets the pace of the whole room), then the line,
 *  then the seats — or that the room is keeping up. */
export function flowWords(st: FlowStats, perHour: number): string {
  if (perHour > st.counterPerHour) return `More guests than the counter can serve — about ${st.counterPerHour} an hour, so the line keeps growing. Another register or a walk-up window would carry it.`;
  if (st.maxLine >= 6) return `The line reached ${st.maxLine} at its longest${st.hot ? `, and it's busiest by the ${st.hot.near}` : ""}.`;
  if (st.seats && st.seated >= st.seats) return "Every seat is taken — guests who'd stay are leaving with it to go.";
  return `The room keeps up${st.hot ? ` — busiest by the ${st.hot.near}` : ""}.`;
}

/** The heat as squares: where people walked and waited, 0 (cool) to 1 (the hottest square). */
export function heatSquares(s: Sim): { x: number; y: number; size: number; v: number }[] {
  let max = 0; for (const v of s.heat) max = Math.max(max, v);
  if (!max) return [];
  const out: { x: number; y: number; size: number; v: number }[] = [];
  // A square root, so the walk from the door shows beside the line, which would otherwise outshine everything.
  for (let k = 0; k < s.heat.length; k++) { const v = Math.sqrt(s.heat[k] / max); if (v > 0.12) out.push({ x: (k % s.heatCols) * HEAT, y: ((k / s.heatCols) | 0) * HEAT, size: HEAT, v }); }
  return out;
}
export const PHASE_COLOR: Record<Phase, string> = { in: "#3a6ea5", queue: "#d18a2b", order: "#b82420", pickup: "#c8a661", toSeat: "#457a32", seated: "#457a32", grab: "#7a5aa5", out: "#6b6b6b" };
