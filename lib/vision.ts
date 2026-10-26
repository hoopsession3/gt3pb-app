// THE VISION — the roadmap, the asks and the store designer's rules (R52, 0447). Pure: no React, no database, so every
// rule here is tested on its own (scripts/r52.test.mjs) and the console, the presenter and a shared link all agree.
//
// Ryan, 2026-10-25: "People are always asking, 'What are our plans? What's next?'… a place to interactively build my
// roadmap… design a brick-and-mortar… place items, explain why it's there… where investors may be needed… a light
// version of AutoCAD." And: espresso is not part of the brand — nothing that introduces toxicity to the body; everything
// abides by the four primal pillars: stillness, light, fuel, movement. The catalog below holds to that: cold extraction,
// nitro taps, bottles and broth — no espresso machine in it.

export const PILLARS = ["stillness", "light", "fuel", "movement"] as const;
export type Pillar = (typeof PILLARS)[number];
export const PILLAR_WORD: Record<Pillar, string> = { stillness: "Stillness", light: "Light", fuel: "Fuel", movement: "Movement" };

export const HORIZONS = ["now", "next", "later"] as const;
export type Horizon = (typeof HORIZONS)[number];
export const HORIZON_WORD: Record<Horizon, string> = { now: "Now", next: "Next", later: "Later" };
export const HORIZON_SUB: Record<Horizon, string> = { now: "Running today", next: "Being built or about to be", later: "Where we're headed" };

export const STATUSES = ["idea", "planned", "building", "live", "paused"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_WORD: Record<Status, string> = { idea: "Idea", planned: "Planned", building: "Building", live: "Live", paused: "Paused" };

export const ASK_STATES = ["open", "committed", "funded"] as const;
export type AskState = (typeof ASK_STATES)[number];
export const ASK_WORD: Record<AskState, string> = { open: "Open", committed: "Committed", funded: "Funded" };

export type Program = {
  id: string; lane: string; title: string; summary: string | null; why: string | null; pillars: Pillar[];
  horizon: Horizon; status: Status; start_on: string | null; target_on: string | null; emoji: string | null;
  layout_id: string | null; sort: number;
};
export type Ask = { id?: string; program_id: string; plan_id?: string | null; label: string; amount_cents: number; state: AskState; note: string | null; sort: number };
export type Item = {
  id: string; kind: string; label: string | null; x_in: number; y_in: number; rot: 0 | 90 | 180 | 270;
  w_in: number; d_in: number; h_in: number; why: string | null; pillars: Pillar[]; sort: number;
};
export type Layout = { id: string; name: string; width_in: number; depth_in: number; ceiling_in: number; notes: string | null; items: Item[] };

// ── the catalog ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Sizes are a start (inches): every one is changed in the inspector. `wall`: set against a wall (no aisle around it).
// `seats`: what it seats. Colours are the 3D view's — the brand's cream, charcoal, wood and gold.
export type Kind = { kind: string; name: string; group: "Front" | "Bar" | "Back" | "Seating" | "Room"; w: number; d: number; h: number;
  color: string; seats?: number; wall?: boolean; pillars: Pillar[]; why: string };
export const CATALOG: readonly Kind[] = [
  { kind: "door", name: "Door", group: "Room", w: 42, d: 6, h: 84, color: "#7a6a52", wall: true, pillars: ["movement"], why: "How people come in." },
  { kind: "window_wall", name: "Daylight window wall", group: "Room", w: 144, d: 6, h: 96, color: "#9fc3d1", wall: true, pillars: ["light"], why: "Daylight on the seats." },
  { kind: "walk_up", name: "Walk-up window", group: "Room", w: 48, d: 6, h: 48, color: "#9fc3d1", wall: true, pillars: ["movement"], why: "Order without coming in — for people mid-run." },
  { kind: "partition", name: "Wall / partition", group: "Room", w: 96, d: 6, h: 96, color: "#d8cdb8", wall: true, pillars: [], why: "Divides the room." },
  { kind: "column", name: "Column", group: "Room", w: 18, d: 18, h: 132, color: "#c9bea8", pillars: [], why: "Structure." },
  { kind: "restroom", name: "Restroom (accessible)", group: "Room", w: 60, d: 60, h: 96, color: "#d8cdb8", pillars: [], why: "Accessible, by code." },
  { kind: "plants", name: "Living wall / plants", group: "Room", w: 48, d: 12, h: 84, color: "#4f7a4a", wall: true, pillars: ["stillness", "light"], why: "Green and growing." },
  { kind: "order_counter", name: "Order counter", group: "Front", w: 120, d: 30, h: 42, color: "#2a2820", pillars: ["movement"], why: "Order and pay in one place." },
  { kind: "menu_board", name: "Menu board", group: "Front", w: 72, d: 4, h: 36, color: "#2a2820", wall: true, pillars: [], why: "What we pour, readable from the door." },
  { kind: "pickup_shelf", name: "Pickup shelf", group: "Front", w: 48, d: 14, h: 60, color: "#a8865a", wall: true, pillars: ["movement"], why: "Pre-orders and drops, picked up without a line." },
  { kind: "merch_wall", name: "Merch & library wall", group: "Front", w: 72, d: 14, h: 84, color: "#a8865a", wall: true, pillars: ["movement"], why: "Shirts, and the maps people take home." },
  { kind: "tap_tower", name: "Cold-brew & nitro taps", group: "Bar", w: 36, d: 30, h: 60, color: "#b8902f", pillars: ["fuel"], why: "Cold extracted, poured to order." },
  { kind: "bottle_cooler", name: "Grab-and-go bottle cooler", group: "Bar", w: 30, d: 30, h: 80, color: "#e9e2d3", pillars: ["fuel", "movement"], why: "Bottles for the road." },
  { kind: "broth_station", name: "Bone broth station", group: "Bar", w: 48, d: 30, h: 42, color: "#8a5a3a", pillars: ["fuel"], why: "Warm broth, sipped slow." },
  { kind: "brew_vessels", name: "Cold-extraction vessels", group: "Back", w: 60, d: 30, h: 72, color: "#c0c4c6", pillars: ["fuel"], why: "Where each batch steeps cold." },
  { kind: "prep_counter", name: "Prep counter", group: "Back", w: 96, d: 30, h: 36, color: "#c0c4c6", pillars: ["fuel"], why: "Prep behind the line." },
  { kind: "reach_in", name: "Reach-in fridge", group: "Back", w: 54, d: 30, h: 80, color: "#c0c4c6", pillars: ["fuel"], why: "Cold things, one step away." },
  { kind: "ice_machine", name: "Ice machine", group: "Back", w: 30, d: 30, h: 70, color: "#c0c4c6", pillars: [], why: "Ice for the taps and the bottles." },
  { kind: "three_sink", name: "Three-compartment sink", group: "Back", w: 72, d: 24, h: 40, color: "#c0c4c6", wall: true, pillars: [], why: "Required by code." },
  { kind: "hand_sink", name: "Hand sink", group: "Back", w: 18, d: 18, h: 40, color: "#c0c4c6", wall: true, pillars: [], why: "Hands washed first." },
  { kind: "storage", name: "Dry storage shelving", group: "Back", w: 48, d: 18, h: 84, color: "#a8865a", wall: true, pillars: [], why: "Bottles, lids and beans, off the floor." },
  { kind: "two_top", name: "Two-top table", group: "Seating", w: 30, d: 30, h: 30, color: "#a8865a", seats: 2, pillars: [], why: "For two." },
  { kind: "four_top", name: "Four-top table", group: "Seating", w: 36, d: 36, h: 30, color: "#a8865a", seats: 4, pillars: [], why: "For four." },
  { kind: "community", name: "Community table", group: "Seating", w: 96, d: 36, h: 30, color: "#a8865a", seats: 8, pillars: ["stillness"], why: "One long table people share." },
  { kind: "window_bar", name: "Standing window bar", group: "Seating", w: 96, d: 16, h: 42, color: "#a8865a", seats: 4, wall: true, pillars: ["light", "movement"], why: "Stand, sip, look out — no need to sit." },
  { kind: "lounge", name: "Lounge seating", group: "Seating", w: 72, d: 60, h: 32, color: "#6b5a4a", seats: 3, pillars: ["stillness"], why: "Soft seats for sitting still." },
  { kind: "bench", name: "Bench", group: "Seating", w: 72, d: 18, h: 18, color: "#a8865a", seats: 3, wall: true, pillars: ["stillness"], why: "A place to wait without a chair." },
  { kind: "mobility", name: "Mobility mat", group: "Seating", w: 72, d: 48, h: 1, color: "#4a5a4a", pillars: ["movement"], why: "Stretch while you wait — movement in the room." },
];
export const kindOf = (k: string): Kind => CATALOG.find((c) => c.kind === k) ?? { kind: k, name: k.replace(/_/g, " "), group: "Room", w: 36, d: 36, h: 36, color: "#c9bea8", pillars: [], why: "" };
// Nothing that puts toxicity in the body: an espresso machine (or anything named for one) is never offered or saved.
export const NOT_THE_BRAND = /espresso/i;
export const allowedKind = (k: string) => !NOT_THE_BRAND.test(k) && !NOT_THE_BRAND.test(kindOf(k).name);

// ── geometry (inches) ───────────────────────────────────────────────────────────────────────────────────────────────
export type Box = { x0: number; y0: number; x1: number; y1: number };
/** The item's footprint on the floor: turned a quarter, its width and depth swap. */
export function footprint(i: Pick<Item, "x_in" | "y_in" | "rot" | "w_in" | "d_in">): Box {
  const turned = i.rot === 90 || i.rot === 270;
  const w = turned ? i.d_in : i.w_in, d = turned ? i.w_in : i.d_in;
  return { x0: i.x_in - w / 2, y0: i.y_in - d / 2, x1: i.x_in + w / 2, y1: i.y_in + d / 2 };
}
export const snap = (v: number, step = 6) => Math.round(v / step) * step;
/** Kept inside the walls: the centre moved so the whole footprint is in the room. */
export function clampInside(i: Item, room: { width_in: number; depth_in: number }): Pick<Item, "x_in" | "y_in"> {
  const b = footprint(i), hw = (b.x1 - b.x0) / 2, hd = (b.y1 - b.y0) / 2;
  return { x_in: Math.min(Math.max(i.x_in, hw), room.width_in - hw), y_in: Math.min(Math.max(i.y_in, hd), room.depth_in - hd) };
}
/** The clear distance between two footprints (0 when they touch or overlap; negative-free). */
export function gap(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
  const dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
  return Math.hypot(dx, dy);
}
export const overlap = (a: Box, b: Box) => a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;

/** The aisle the ADA asks for between things people walk between: 36 inches. */
export const AISLE_IN = 36;
export type Issue = { ids: string[]; level: "error" | "warn"; words: string };
/**
 * What a plan reviewer would circle: something outside the walls, two things in the same place, an aisle under 36 in
 * between two things people walk between (a thing set against a wall, a mat or a thing under knee height is not one).
 */
export function issues(layout: Pick<Layout, "width_in" | "depth_in" | "items">): Issue[] {
  const out: Issue[] = [];
  const name = (i: Item) => i.label || kindOf(i.kind).name;
  for (const i of layout.items) {
    const b = footprint(i);
    if (b.x0 < -0.5 || b.y0 < -0.5 || b.x1 > layout.width_in + 0.5 || b.y1 > layout.depth_in + 0.5) out.push({ ids: [i.id], level: "error", words: `${name(i)} is outside the walls` });
  }
  const floor = layout.items.filter((i) => !kindOf(i.kind).wall && i.h_in >= 24);
  for (let a = 0; a < layout.items.length; a++) for (let c = a + 1; c < layout.items.length; c++) {
    const A = layout.items[a], C = layout.items[c];
    const ba = footprint(A), bc = footprint(C);
    if (overlap(ba, bc)) { out.push({ ids: [A.id, C.id], level: "error", words: `${name(A)} and ${name(C)} overlap` }); continue; }
    if (floor.includes(A) && floor.includes(C)) {
      const g = gap(ba, bc);
      if (g > 0.5 && g < AISLE_IN) out.push({ ids: [A.id, C.id], level: "warn", words: `${Math.round(g)} in between ${name(A)} and ${name(C)} — an aisle needs ${AISLE_IN}` });
    }
  }
  return out;
}

/** The findings as a person reads them (S1.1c, 2026-10-26 — Ryan: "eliminate excessive repeated overlays… grouped issue
 *  summaries"). An error stays its own line (an overlap, a thing outside the walls). Warnings that touch — a cluster of
 *  tables each closer than an aisle to the next — become ONE finding naming the group, not a line (and an outline) per
 *  pair. The ids are all there, so choosing the finding highlights the whole group. */
export function groupIssues(found: readonly Issue[]): Issue[] {
  const errors = found.filter((f) => f.level === "error");
  const warns = found.filter((f) => f.level !== "error");
  const parent = new Map<string, string>();
  const root = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
  for (const w of warns) for (const id of w.ids) if (!parent.has(id)) parent.set(id, id);
  for (const w of warns) for (let k = 1; k < w.ids.length; k++) parent.set(root(w.ids[k]), root(w.ids[0]));
  const groups = new Map<string, { ids: Set<string>; pairs: Issue[] }>();
  for (const w of warns) { const r = root(w.ids[0]); const g = groups.get(r) ?? { ids: new Set<string>(), pairs: [] }; w.ids.forEach((i) => g.ids.add(i)); g.pairs.push(w); groups.set(r, g); }
  const grouped: Issue[] = [...groups.values()].map((g) => g.pairs.length === 1 ? g.pairs[0]
    : { ids: [...g.ids], level: "warn", words: `${g.ids.size} things closer than ${AISLE_IN} in to each other in ${g.pairs.length} places — an aisle needs ${AISLE_IN}` });
  return [...errors, ...grouped];
}

export type RoomStats = { sqft: number; seats: number; items: number; pillars: Record<Pillar, number> };
export function roomStats(layout: Pick<Layout, "width_in" | "depth_in" | "items">): RoomStats {
  const pillars = { stillness: 0, light: 0, fuel: 0, movement: 0 } as Record<Pillar, number>;
  for (const i of layout.items) for (const p of i.pillars) if (p in pillars) pillars[p]++;
  return {
    sqft: Math.round((layout.width_in * layout.depth_in) / 144),
    seats: layout.items.reduce((s, i) => s + (kindOf(i.kind).seats ?? 0), 0),
    items: layout.items.length,
    pillars,
  };
}

/** 150 → 12′ 6″; 144 → 12′; 8 → 8″. */
export function ftIn(inches: number): string {
  const n = Math.round(inches);
  const ft = Math.floor(n / 12), inch = n % 12;
  return ft === 0 ? `${inch}″` : inch === 0 ? `${ft}′` : `${ft}′ ${inch}″`;
}
/** "12' 6"", "12 6", "150in", "12.5ft", "150" (inches) → inches, or null. */
export function parseFtIn(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  let m = /^(\d+(?:\.\d+)?)\s*(?:ft|')\s*(?:(\d+(?:\.\d+)?)\s*(?:in|")?)?$/.exec(t);
  if (m) return Math.round(Number(m[1]) * 12 + Number(m[2] ?? 0));
  m = /^(\d+)\s+(\d+(?:\.\d+)?)$/.exec(t);
  if (m) return Math.round(Number(m[1]) * 12 + Number(m[2]));
  m = /^(\d+(?:\.\d+)?)\s*(?:in|")?$/.exec(t);
  if (m) return Math.round(Number(m[1]));
  return null;
}

// ── the asks ────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Totals = { total: number; open: number; committed: number; funded: number; unset: number };
/** What a program (or the whole plan) asks for, by where each part stands. A $0 line is a line with no amount set yet. */
export function askTotals(asks: readonly Pick<Ask, "amount_cents" | "state">[]): Totals {
  const t: Totals = { total: 0, open: 0, committed: 0, funded: 0, unset: 0 };
  for (const a of asks) {
    if (!a.amount_cents) { t.unset++; continue; }
    t.total += a.amount_cents; t[a.state] += a.amount_cents;
  }
  return t;
}
/** "$350K", "$1.2M", "$9,500" — short enough for a card, exact enough to ask with. */
export function shortMoney(cents: number): string {
  const d = Math.round(cents / 100);
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(d % 1_000_000 === 0 ? 0 : 1)}M`;
  if (d >= 100_000) return `$${Math.round(d / 1000)}K`;
  return `$${d.toLocaleString("en-US")}`;
}

/** The board: each horizon's programs in their order. */
export function board(programs: readonly Program[]): Record<Horizon, Program[]> {
  const out = { now: [], next: [], later: [] } as Record<Horizon, Program[]>;
  for (const p of [...programs].sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))) out[p.horizon]?.push(p);
  return out;
}

/** "Spring 2027" / "Q3 2027" — a target said the way a roadmap says it, without a false day. */
export function whenWords(start: string | null, target: string | null): string | null {
  const q = (d: string) => `Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1} ${d.slice(0, 4)}`;
  if (start && target) return q(start) === q(target) ? q(target) : `${q(start)} – ${q(target)}`;
  if (target) return `By ${q(target)}`;
  if (start) return `From ${q(start)}`;
  return null;
}
