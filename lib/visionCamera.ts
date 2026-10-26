// THE PLAN'S CAMERA (S1.1) — what part of the room the plan shows, and how big. Pure maths, tested by itself
// (scripts/s11.test.mjs); components/vision/PlanView drives it with fingers, a wheel and keys.
//
// A camera is a window onto the room, in the room's own inches: its left and top edge and its width and height. It always
// has the canvas's own shape, so the drawing is never stretched and nothing is letterboxed: an SVG drawn with
// viewBox = the camera fills its pane exactly. Fit puts the whole room (and its rulers) in view, centred, as large as the
// pane allows; zoom keeps the point under the fingers where it was; pan slides; and the camera never wanders so far that
// the room is lost — a sliver of it always stays on screen. S2's walls and drawn plans hand `fit` any outline's bounds.
export type Cam = { x: number; y: number; w: number; h: number };
export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Size = { w: number; h: number };

/** The closest the plan comes: a foot and a half across the narrower side of the canvas. */
export const MIN_SPAN_IN = 18;
/** The farthest: four times the room's fitted view. */
export const MAX_OUT = 4;

const finite = (n: number) => Number.isFinite(n);
const okSize = (s: Size) => finite(s.w) && finite(s.h) && s.w > 0 && s.h > 0;

/** The whole of `b`, with `pad` inches around it, centred in a canvas of `view` pixels — the canvas's own shape. */
export function fit(b: Box, view: Size, pad = 0): Cam {
  const bw = Math.max(1, b.x1 - b.x0 + pad * 2), bh = Math.max(1, b.y1 - b.y0 + pad * 2);
  if (!okSize(view)) return { x: b.x0 - pad, y: b.y0 - pad, w: bw, h: bh };
  const aspect = view.w / view.h;
  // Wider canvas than the room: the room's height sets the scale; else its width does.
  const w = bw / bh < aspect ? bh * aspect : bw;
  const h = w / aspect;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Pixels per inch: how large the room is drawn. */
export const scaleOf = (c: Cam, view: Size): number => (okSize(view) && c.w > 0 ? view.w / c.w : 1);

/** A point on the canvas (pixels from its top left) as a point in the room (inches). */
export const toRoom = (c: Cam, view: Size, px: number, py: number) => ({ x: c.x + (px / view.w) * c.w, y: c.y + (py / view.h) * c.h });
/** A point in the room as a point on the canvas. */
export const toScreen = (c: Cam, view: Size, x: number, y: number) => ({ x: ((x - c.x) / c.w) * view.w, y: ((y - c.y) / c.h) * view.h });

/** Closer by `k` (more than 1: closer; less: farther), the room point `at` staying under the fingers. Limited: never
 *  closer than MIN_SPAN_IN across, never farther than MAX_OUT times the fitted view `home`. */
export function zoomAt(c: Cam, k: number, at: { x: number; y: number }, home: Cam): Cam {
  if (!finite(k) || k <= 0) return c;
  const minW = Math.min(home.w, MIN_SPAN_IN * Math.max(1, c.w / c.h));
  const maxW = home.w * MAX_OUT;
  const w = Math.min(maxW, Math.max(minW, c.w / k));
  const r = w / c.w;
  const h = c.h * r;
  return { x: at.x - (at.x - c.x) * r, y: at.y - (at.y - c.y) * r, w, h };
}

/** Slid by (dx, dy) inches. */
export const pan = (c: Cam, dx: number, dy: number): Cam => ({ ...c, x: c.x + dx, y: c.y + dy });

/** Kept in reach of the room: at least `keep` of the camera's own span (a fifth) overlaps the room on each axis. */
export function keepNear(c: Cam, room: Box, keep = 0.2): Cam {
  const kx = c.w * keep, ky = c.h * keep;
  const x = Math.min(room.x1 - kx, Math.max(room.x0 + kx - c.w, c.x));
  const y = Math.min(room.y1 - ky, Math.max(room.y0 + ky - c.h, c.y));
  return { ...c, x, y };
}

/** The camera after the canvas changed size: the same centre and the same scale — the room doesn't jump. */
export function resized(c: Cam, from: Size, to: Size): Cam {
  if (!okSize(from) || !okSize(to)) return c;
  const s = from.w / c.w;
  const w = to.w / s, h = to.h / s;
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Close enough to the fitted view to call it "fitted" (the Fit button then says so). */
export const isFitted = (c: Cam, home: Cam): boolean =>
  Math.abs(c.w - home.w) < home.w * 0.01 && Math.abs(c.x - home.x) < home.w * 0.01 && Math.abs(c.y - home.y) < home.h * 0.01;
