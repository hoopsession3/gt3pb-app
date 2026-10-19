// A SLOT THAT HOLDS ITS PLACE (R38, 2026-10-19 — the fresh audit's PERF11-06). Two things exist only some of the time
// and are known only once the browser has read them: the announcement bar above every page (components/BroadcastBanner)
// and the Limited Reserve cards on /reserve and in Shop's Bottles aisle (components/Reserves). Each drew nothing until
// its read landed, then pushed everything under it down — the whole page, by the bar's 50-odd pixels, on every route
// while an announcement ran (a shift of about 0.06, over the app's own 0.04), and /reserve's order form by a card's 250.
//
// What each measured last time is kept on the phone, and app/layout's head script — before the first paint, as it marks
// the viewer — holds that height on the html element (data-hold-<name>, --hold-<name>). The slot is drawn empty on the
// server and holds the height while it is empty (app/globals.css .hold-slot); its content takes the place it held. Read
// as none, the slot lets go at once and the height is forgotten; a read that failed lets go and keeps it (unknown is not
// none). A first visit has no height kept: nothing is held, as before.
//
// Pure but for localStorage and the html element, each in a try: a phone that refuses storage holds nothing. No "use
// client": app/layout (a server component) reads HOLD_SCRIPT as text.

export type HoldName = "bcast" | "rsv";

const KEY = "gt3-holds";
/** The tallest height kept: anything taller is a measurement gone wrong, and is not held. */
export const HOLD_MAX_PX = 600;

/** The height a slot's content measured, kept for the next first paint; 0 forgets it. */
export function keepHold(name: HoldName, px: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, unknown>;
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(all)) if (typeof v === "number" && k !== name) next[k] = v;
    if (px > 0 && px <= HOLD_MAX_PX) next[name] = Math.round(px);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* storage refused: nothing is held next time */ }
}

/** The slot stops holding its place now: its content was read as none, or couldn't be read. */
export function letGo(name: HoldName): void {
  try {
    const d = document.documentElement;
    d.removeAttribute(`data-hold-${name}`);
    d.style.removeProperty(`--hold-${name}`);
  } catch { /* no document */ }
}

/** The height a slot's content takes: its first child's top to its last child's bottom (a slot draws no box of its own) —
 *  `only`: the children that are its content (a sheet drawn inside it is not). */
export function heldHeight(slot: HTMLElement | null, only?: string): number {
  if (!slot) return 0;
  const kids = only ? Array.from(slot.querySelectorAll(only)) : Array.from(slot.children);
  if (!kids.length) return 0;
  const top = kids[0].getBoundingClientRect().top, bottom = kids[kids.length - 1].getBoundingClientRect().bottom;
  return Math.max(0, Math.round(bottom - top));
}

/** app/layout's head script, as text: the heights kept, held on the html element before the first paint. Names are
 *  letters only, heights whole pixels up to HOLD_MAX_PX — anything else in storage is ignored. */
export const HOLD_SCRIPT = `try{var h=JSON.parse(localStorage.getItem("${KEY}")||"{}"),d=document.documentElement;for(var k in h){var v=h[k];if(/^[a-z]+$/.test(k)&&typeof v==="number"&&v>0&&v<=${HOLD_MAX_PX}){d.style.setProperty("--hold-"+k,Math.round(v)+"px");d.setAttribute("data-hold-"+k,"")}}}catch(e){}`;
