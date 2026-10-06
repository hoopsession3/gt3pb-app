import { isIPhoneLike } from "./ios";

// Guarded haptic feedback — a quiet premium-PWA touch. Keep patterns short.
//
// ONE VOCABULARY (2026-10-05, the haptics round). A call site says what happened — a feel — and never
// a raw pattern. Every feel and its pattern live in the one table below. scripts/haptics.audit.mjs
// holds every haptic() in the app to a literal feel from it, and keeps navigator.vibrate in this file.
// A moment that needs a feel the table does not have adds one here, with a line saying when to use it.
//
// WHAT A PHONE FEELS (2026-10-05, the haptics round). Android (Chrome) vibrates every feel, pattern
// and all. The iPhone has no vibration API. Safari 17.4 gave the HTML switch (`<input type="checkbox"
// switch>`) the system's haptic when it flips, so the gesture round flipped a hidden one: switchTick.
// That tick still plays on iPhones before iOS 26.5. Since iOS 26.5, WebKit (bug 309082) plays a
// switch's haptic only when a finger flips it, so a switch flipped from code is silent there.
// switchTick stays for the older phones — one tick for any feel, and nothing else depends on it.
// Full iPhone haptics need the app wrapped as a native app, a decision pending with the owner. The
// vocabulary is the seam: a native adapter maps each feel to UIKit's impact, selection or
// notification feedback, and no call site changes. Which phone is an iPhone: lib/ios, its one home.

function switchTick() {
  if (typeof document === "undefined" || !document.body || !isIPhoneLike()) return;
  try {
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.appendChild(input);
    // The flip is ours, not the page's: nothing listening for clicks or changes hears it.
    for (const t of ["click", "input", "change"]) {
      label.addEventListener(t, (e) => e.stopPropagation());
      input.addEventListener(t, (e) => e.stopPropagation());
    }
    document.body.appendChild(label);
    label.click();
    label.remove();
  } catch { /* unsupported */ }
}

/** What happened, in the hand. Each one's pattern, and when to use it, is in PATTERN below. */
export type Feel = "selection" | "light" | "medium" | "heavy" | "success" | "warning" | "error" | "threshold" | "release" | "boundary" | "toggleOn" | "toggleOff" | "increase" | "decrease" | "start" | "live" | "paid" | "alert";

const PATTERN: Record<Feel, number | readonly number[]> = {
  selection: 6,                  // a choice changed — a tab, a page, a size, a mode
  light: 8,                      // a small tap that does something — flip a card, open a log, navigate
  medium: 12,                    // something added or moved — into the cart, an order's status
  heavy: 20,                     // a tap that commits money — Pay
  success: [14, 40, 14],         // it worked — saved, created, delivered, a code accepted
  warning: [24, 60, 24],         // stop and look — "Discard your changes?", a delivery held
  error: [36, 40, 36, 40, 36],   // it did not work — every error toast, a payment refused
  threshold: 6,                  // a swipe crossed the line where letting go acts
  release: 4,                    // the finger backed off that line
  boundary: 14,                  // nothing further that way — a stepper at zero, a sheet that is holding
  toggleOn: 10,                  // a switch turned on — an item 86'd counts as on
  toggleOff: 6,                  // a switch turned off
  increase: 8,                   // a stepper went up one
  decrease: 5,                   // a stepper went down one
  start: [12, 50, 20],           // something started running — a brew
  live: [16, 50, 16, 50, 26],    // going live: two beats, then the engine — once per go-live
  paid: [10, 30, 18],            // money settled — a payment through, a pack flips to paid in your hand
  alert: [200, 100, 200],        // look up now — a new order on the pass, a guest outside
};

/** The table, read-only, for the tests and the audit. Nothing in the app plays a pattern itself. */
export const HAPTIC_PATTERNS: Readonly<Record<Feel, number | readonly number[]>> = PATTERN;

export function haptic(feel: Feel): void {
  // Not before the person has touched the page: a browser refuses a buzz it did not see a tap for
  // (Chrome logs the refusal as an error), and a swipe's first move is not yet a tap.
  if (typeof navigator !== "undefined" && navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    // vibrate() is handed its own copy: the table is shared and read-only.
    const p = PATTERN[feel];
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function" && navigator.vibrate(typeof p === "number" ? p : [...p])) return;
  } catch { /* unsupported */ }
  switchTick();
}
