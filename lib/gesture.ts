// THE GESTURE RULES (2026-10-05). Ryan: "audit for 10 out of 10 … swipe down to close out a thing,
// swipe left to move forward to the next tab … right now it feels 2 out of 10. Example, I have to hit
// the X button to get out of here."
//
// Every swipe in the app decides with these numbers, so a sheet pulled down, a tab paged, an inbox row
// swiped, the edge swipe back and the pull to refresh agree with each other — and with the phone they
// run on. The constants are UIKit's own where UIKit has one (the scroll view's deceleration, its rubber
// band). Pure: components/useGesture measures the finger; this decides what the finger meant.

export type Axis = "x" | "y";

/** A touch has an axis once it has moved this far — before that it is a tap, or a scroll that has not
 *  shown its direction yet, and nothing may take it. Under the browser's own scroll slop, so a touch
 *  this module gives up on can still scroll. */
export const SLOP = 6;

/** The axis a touch has shown, or null while it is still under the slop. `bias` > 1 asks a sideways
 *  move to be that many times wider than it is tall before it counts as sideways: a thumb scrolling
 *  down a list in an arc is a scroll, not a page turn — ambiguity goes to the scroll. */
export function axisOf(dx: number, dy: number, slop = SLOP, bias = 1): Axis | null {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < slop) return null;
  return ax > ay * bias ? "x" : "y";
}

export type Sample = { t: number; x: number; y: number };

/** How fast the finger was going when it let go, in px per ms, over the last `span` ms of its path.
 *  A finger that stopped before lifting (`still` ms with no movement) let go at rest: 0. */
export function velocity(samples: readonly Sample[], at: number, span = 100, still = 80): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const last = samples[samples.length - 1];
  if (at - last.t > still) return { vx: 0, vy: 0 };
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > span) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

/** Where a flick would carry a thing that keeps sliding and slows the way an iPhone scroll does —
 *  UIKit's projection at UIScrollView's normal deceleration (0.998 per ms). `v` in px/ms, out in px. */
export const project = (v: number, rate = 0.998): number => (v * rate) / (1 - rate);

/** The rubber band: dragged `x` px past where something can go, it moves this much — UIScrollView's
 *  curve, which gives less and less the further it is pulled and never reaches `dim`. */
export function rubber(x: number, dim: number, c = 0.55): number {
  if (!x || dim <= 0) return 0;
  const a = Math.abs(x);
  return Math.sign(x) * (1 - 1 / ((a * c) / dim + 1)) * dim;
}

// ── a sheet pulled down ─────────────────────────────────────────────────────────────────────────
/** Under `min` px a pull is the finger settling, not a pull; past half the sheet's height (or `cap`
 *  px, for a sheet taller than a thumb's reach) — counting where a flick would carry it — it closes;
 *  a finger heading back up when it lets go changed its mind. */
export const SHEET = { min: 16, half: 0.5, cap: 260, back: -0.1 } as const;

export function sheetCloses(pulled: number, v: number, height: number): boolean {
  if (pulled < SHEET.min) return false;
  if (v < SHEET.back) return false;
  return pulled + project(Math.max(0, v)) > Math.min(height * SHEET.half, SHEET.cap);
}

// ── a full-screen viewer pulled down (a product's photos) ───────────────────────────────────────
/** Photos-style: the picture follows the finger; a short pull (`go` px) or a flick down closes it. */
export const VIEWER = { go: 90, flick: 0.35 } as const;

export const viewerCloses = (pulled: number, v: number): boolean =>
  pulled >= VIEWER.go || (pulled >= SHEET.min && v > VIEWER.flick);

// ── a page swiped sideways ──────────────────────────────────────────────────────────────────────
/** A third of the width turns the page; so does a flick the same way (`flick` px/ms) once it has
 *  moved `min` px. A flick back the other way keeps the page. */
export const PAGE = { min: 24, third: 1 / 3, flick: 0.3 } as const;

/** Let go of a page dragged `dx` px (finger right is +) at `v` px/ms: the page to go to — 1 (the next,
 *  finger went left), -1 (the one before) or 0 (stay). */
export function pageTurn(dx: number, v: number, width: number): -1 | 0 | 1 {
  if (Math.abs(dx) < PAGE.min) return 0;
  const dir = dx < 0 ? 1 : -1;
  if (v * dx < 0 && Math.abs(v) > 0.1) return 0;
  return Math.abs(dx) > width * PAGE.third || (Math.abs(v) > PAGE.flick && v * dx > 0) ? dir : 0;
}

export type PageLevel = { keys: readonly string[]; current: string; depth: number };

/** Which row of tabs a swipe moves, and to which tab: the innermost row (deepest) that has a tab that
 *  way — Plan's Calendar → Events — and at its end, the row around it — Plan's last tab → the lane's
 *  next section. Null: nothing that way, the content bands back. */
export function pageStep(levels: readonly PageLevel[], dir: 1 | -1): { level: number; to: string } | null {
  const order = levels.map((l, i) => ({ l, i })).sort((a, b) => b.l.depth - a.l.depth || b.i - a.i);
  for (const { l, i } of order) {
    const at = l.keys.indexOf(l.current);
    if (at < 0) continue;
    const to = l.keys[at + dir];
    if (to !== undefined) return { level: i, to };
  }
  return null;
}

// ── a list row swiped for its actions (Mail's swipe) ────────────────────────────────────────────
/** Past `full` of the row's width the side's main action is armed — the button stretches across the
 *  row and the phone ticks — and letting go does it. Short of that, a row let go past half its buttons
 *  stays open on them; a flick back closes it. */
export const ROW = { full: 0.55, flick: 0.3 } as const;

export type RowEnd = "close" | "lead" | "trail" | "lead-full" | "trail-full";

export const rowArmed = (dx: number, width: number, full: boolean): boolean => full && Math.abs(dx) > width * ROW.full;

/** Let go of a row at `dx` px (finger right is +, the leading buttons showing) moving `v` px/ms.
 *  `lead` / `trail`: how wide each side's buttons are (0: nothing on that side); `fullLead` /
 *  `fullTrail`: whether a long swipe that way does that side's main action. */
export function rowSettle(dx: number, v: number, width: number, lead: number, trail: number, fullLead: boolean, fullTrail: boolean): RowEnd {
  if (!dx) return "close";
  const side = dx > 0 ? "lead" : "trail";
  const reveal = side === "lead" ? lead : trail;
  if (!reveal) return "close";
  if (rowArmed(dx, width, side === "lead" ? fullLead : fullTrail)) return `${side}-full`;
  if (v * dx < 0 && Math.abs(v) > ROW.flick) return "close";
  if (v * dx > 0 && Math.abs(v) > ROW.flick) return side;
  return Math.abs(dx) > reveal / 2 ? side : "close";
}

// ── the edge swipe back ─────────────────────────────────────────────────────────────────────────
/** A touch that starts within `edge` px of the left edge is the swipe back's; `go` px of travel — or a
 *  flick right after `flickMin` px — goes back. The chevron stops at `max`. */
export const BACK = { edge: 28, go: 72, flickMin: 24, flick: 0.35, max: 120 } as const;

export const backGoes = (dx: number, v: number): boolean => dx >= BACK.go || (dx >= BACK.flickMin && v > BACK.flick);

// ── pull to refresh ─────────────────────────────────────────────────────────────────────────────
/** The list follows a pull at the top with the rubber band's give (`give` px is the band's span);
 *  `arm` px of that and letting go refreshes, and the list rests `hold` px down while it does. */
export const PULL = { give: 560, arm: 64, hold: 52 } as const;

export const pullShown = (dy: number): number => (dy > 0 ? rubber(dy, PULL.give) : 0);

// ── what a touch lands on ───────────────────────────────────────────────────────────────────────
/** The parts of an element the walk below reads — a DOM Element has all of them; the smoke test hands
 *  in plain objects. */
export type Box = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  parentElement: Box | null;
  scrollTop?: number;
  scrollWidth?: number;
  clientWidth?: number;
  scrollHeight?: number;
  clientHeight?: number;
  getAttribute?: (name: string) => string | null;
};

const TYPED = new Set(["", "text", "search", "email", "tel", "url", "number", "password", "date", "time", "datetime-local", "month", "week"]);
const scrolls = (o: string | undefined) => o === "auto" || o === "scroll";

/** Why a touch that starts on `el` is not a gesture on `root` to take — or null when it is.
 *
 *  · "field": typing, choosing or sliding — a focused text box (an unfocused one is only something the
 *    finger landed on), any textarea, select, slider or editable text. Those are the field's own.
 *  · "own": a part that handles this swipe itself — `data-gesture="off"` (every swipe: a map),
 *    `data-gesture="x"` / `"y"` (that one), or a dialog open inside the element.
 *  · "scroller": sideways, a strip that scrolls sideways itself (chips, a wide table) keeps the swipe.
 *  · "scrolled": up and down, content scrolled away from its top scrolls before anything is pulled.
 *
 *  Walks from the element touched up to `root`, not past it: what is outside the gesture's element is
 *  not the gesture's business. */
export function heldBy(
  el: Box | null,
  root: Box,
  axis: Axis,
  overflowOf: (b: Box) => { x?: string; y?: string },
  focused: Box | null = null,
): "field" | "own" | "scroller" | "scrolled" | null {
  for (let n = el; n && n !== root; n = n.parentElement) {
    const tag = (n.tagName ?? "").toLowerCase();
    if (tag === "textarea" || tag === "select" || n.isContentEditable) return "field";
    if (tag === "input") {
      const type = (n.type ?? "").toLowerCase();
      if (type === "range" || (TYPED.has(type) && n === focused)) return "field";
    }
    const role = n.getAttribute?.("role");
    if (role === "slider" || role === "textbox") return "field";
    const own = n.getAttribute?.("data-gesture");
    // A dialog inside the gesture's element (the Pass, full screen over Live Ops) is its own surface.
    if (own === "off" || own === axis || role === "dialog") return "own";
    if (axis === "x" && (n.scrollWidth ?? 0) > (n.clientWidth ?? 0) + 1 && scrolls(overflowOf(n).x)) return "scroller";
    if (axis === "y" && (n.scrollTop ?? 0) > 0 && (n.scrollHeight ?? 0) > (n.clientHeight ?? 0) + 1 && scrolls(overflowOf(n).y)) return "scrolled";
  }
  return null;
}
