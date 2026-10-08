// HOW A SHEET STANDS ON A PHONE (2026-10-08, the navigation round: redesign 3, approved by Ryan).
//
// THE PAGE STEPS BACK. Behind every iPhone sheet the page it was opened from shrinks a little and rounds its
// corners, so the sheet reads as a step in front of it, not a layer painted on it. Before, our page only
// dimmed. Now a sheet that stands three-fifths of the screen tall or more (RECEDE_AT: a drink, an account, a
// risen form) steps the page back: the shell gets .receded while one does, and the scrolling page (<main
// id="body">, components/AppShell) is drawn smaller beneath it. A short sheet — a question, a few buttons, a
// row's menu — leaves the page where it is, as iOS's action sheets do, and so does a form at half-height, as
// at iOS's medium detent. In the frame (a desktop, an iPad) a sheet is a centred card, and nothing steps back.
//
// A LONG FORM OPENS HALF-HEIGHT. A form longer than most of the screen (HALF_AT, with HALF_FIELDS fields or
// more) opens at half the screen — iOS's medium detent — with the page it belongs to still in sight above it,
// and rises to full the moment it is used: scrolled, a field tapped, its top pulled up. A sheet that is held
// (a payment running) or that says it opens full (the checkout, an order) never opens half.
//
// The decisions are here, apart from the DOM, so scripts/smoke.cjs holds them; components/Sheet applies them.

/** A sheet at least this much of the screen tall steps the page back. Under HALF_AT: a long form, once risen,
 *  always does. */
export const RECEDE_AT = 0.6;
/** A form at least this much of the screen long opens half-height… */
export const HALF_AT = 0.62;
/** …when it has at least this many fields to fill. */
export const HALF_FIELDS = 3;

/** The frame's own test (app/globals.css, app/tailwind.css `frame:`): a desktop or an iPad, not a phone. */
export const FRAME_QUERY = "(min-width: 520px) and (min-height: 640px)";

/** Does a sheet open half-height? `natural` is how tall its content would stand, `viewport` the screen's height. */
export function opensHalf(o: { natural: number; viewport: number; fields: number; phone: boolean; allowed: boolean }): boolean {
  return o.allowed && o.phone && o.viewport > 0 && o.fields >= HALF_FIELDS && o.natural >= o.viewport * HALF_AT;
}

/** Does a sheet this tall step the page back? */
export function recedes(o: { height: number; viewport: number; phone: boolean; half: boolean }): boolean {
  return o.phone && !o.half && o.viewport > 0 && o.height >= o.viewport * RECEDE_AT;
}

// The sheets stepping the page back right now: the shell is .receded while any is.
const stepping = new Set<symbol>();

/** This sheet steps the page back, or no longer does. */
export function stepBack(shell: HTMLElement, sheet: symbol, on: boolean): void {
  if (on) stepping.add(sheet); else stepping.delete(sheet);
  shell.classList.toggle("receded", stepping.size > 0);
  // The last one gone: whatever a pull left behind goes with it (the page is on its way back already).
  if (!stepping.size) { shell.classList.remove("pulling"); shell.style.removeProperty("--recede"); }
}

/** How far the page is stepped back, 1 to 0, while a sheet is being pulled down: it follows the finger.
 *  "let go" hands the motion back to the stylesheet where the page stands (the sheet is leaving: the page goes
 *  on home from there); null springs it back to fully stepped back (the sheet stays). */
export function stepBackBy(shell: HTMLElement | null | undefined, v: number | "let go" | null): void {
  if (!shell) return;
  if (v === "let go") { shell.classList.remove("pulling"); return; }
  if (v == null) { shell.classList.remove("pulling"); shell.style.removeProperty("--recede"); return; }
  shell.classList.add("pulling");
  shell.style.setProperty("--recede", String(Math.min(1, Math.max(0, v))));
}

/** The fields a person fills in a sheet: text, numbers, dates, choices — not a box to tick. */
export function fieldsIn(panel: HTMLElement): number {
  return panel.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="range"]), select, textarea').length;
}
