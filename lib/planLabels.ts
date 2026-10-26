// THE PLAN'S WORDS, PLACED (S1.1b, 2026-10-26 — Ryan: "do not render all object numbers as large circles over the floor
// plan… use collision-aware labels… a proper annotation layout strategy, including offset placement, leader lines where
// useful, and prioritization"). Pure geometry, in room inches, so it's tested by hand and holds at any zoom.
//
//   A word is a box: its centre, its width (an estimate from the font size and the number of letters) and its height.
//   Placing one tries its candidate spots in order and takes the first that stays inside the bounds and touches nothing
//   already there — the room's things (except the one it names) and every word placed before it. A word with no clear
//   spot isn't drawn: a label lying on top of a fixture is worse than none, and the fixture still names itself to a
//   screen reader, in its tooltip and in the Schedule.

export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type Placed = { x: number; y: number; box: Rect; leader: [number, number, number, number] | null };

/** A line of text's box, centred on (x, y). The width is an estimate: 0.58 of the size per letter, plus a little air. */
export function textBox(x: number, y: number, size: number, text: string): Rect {
  const w = size * (0.58 * text.length + 0.6), h = size * 1.25;
  return { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
}

export const hits = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
export const inside = (a: Rect, b: Rect) => a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1;

/** The first candidate that stays inside `bounds` and clears every obstacle, or null. */
export function placeFirst(cands: { x: number; y: number; leader?: [number, number, number, number] | null }[], size: number, text: string, obstacles: readonly Rect[], bounds: Rect): Placed | null {
  for (const c0 of cands) {
    // Slid inside the view if it spills over an edge (a thing by the wall still gets its word), then judged.
    let c = c0;
    const raw = textBox(c.x, c.y, size, text);
    const dx = raw.x0 < bounds.x0 ? bounds.x0 - raw.x0 : raw.x1 > bounds.x1 ? bounds.x1 - raw.x1 : 0;
    const dy = raw.y0 < bounds.y0 ? bounds.y0 - raw.y0 : raw.y1 > bounds.y1 ? bounds.y1 - raw.y1 : 0;
    if (dx || dy) c = { ...c0, x: c0.x + dx, y: c0.y + dy, leader: c0.leader ?? null };
    const box = textBox(c.x, c.y, size, text);
    if (!inside(box, bounds)) continue;
    if (obstacles.some((o) => hits(box, o))) continue;
    return { x: c.x, y: c.y, box, leader: c.leader ?? null };
  }
  return null;
}

/** Where a thing's name may go when it doesn't fit inside the thing: just above, below, right, left — then a little
 *  further out on a short leader line from its edge. `gap` is the air between the thing and the word. */
export function nameSpots(b: Rect, size: number, text: string, gap: number) {
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const half = textBox(0, 0, size, text);
  const hw = half.x1, hh = half.y1;
  const near = [
    { x: cx, y: b.y0 - gap - hh }, { x: cx, y: b.y1 + gap + hh },
    { x: b.x1 + gap + hw, y: cy }, { x: b.x0 - gap - hw, y: cy },
  ];
  const far = gap * 4;
  const out = [
    { x: cx, y: b.y0 - far - hh, leader: [cx, b.y0, cx, b.y0 - far + gap] as [number, number, number, number] },
    { x: cx, y: b.y1 + far + hh, leader: [cx, b.y1, cx, b.y1 + far - gap] as [number, number, number, number] },
    { x: b.x1 + far + hw, y: cy, leader: [b.x1, cy, b.x1 + far - gap, cy] as [number, number, number, number] },
    { x: b.x0 - far - hw, y: cy, leader: [b.x0, cy, b.x0 - far + gap, cy] as [number, number, number, number] },
  ];
  return [...near, ...out];
}

/** A distance line's label: at its middle, above or below (beside, for an upright line), then towards either end. */
export function dimSpots(x1: number, y1: number, x2: number, y2: number, size: number, gap: number) {
  const horizontal = Math.abs(y2 - y1) < Math.abs(x2 - x1);
  const along = [0.5, 0.3, 0.7];
  const out: { x: number; y: number }[] = [];
  for (const t of along) {
    const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
    if (horizontal) out.push({ x, y: y - gap - size * 0.6 }, { x, y: y + gap + size * 0.6 });
    else out.push({ x: x + gap + size * 2.2, y }, { x: x - gap - size * 2.2, y });
  }
  return out;
}

/** The distances drawn for a picked thing: from each side to the wall it faces, the shortest first (the one most likely
 *  to matter — an aisle, a clearance). Zero-length gaps (a thing against a wall) aren't drawn. */
export function wallGaps(b: Rect, room: { width_in: number; depth_in: number }) {
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  return ([
    { side: "left", x1: b.x0, y1: cy, x2: 0, y2: cy, len: b.x0 },
    { side: "right", x1: b.x1, y1: cy, x2: room.width_in, y2: cy, len: room.width_in - b.x1 },
    { side: "top", x1: cx, y1: b.y0, x2: cx, y2: 0, len: b.y0 },
    { side: "bottom", x1: cx, y1: b.y1, x2: cx, y2: room.depth_in, len: room.depth_in - b.y1 },
  ] as const).filter((g) => g.len > 3).slice().sort((a, b2) => a.len - b2.len);
}
