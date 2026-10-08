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
// Full iPhone haptics need the app wrapped as a native app. The iPhone app (2026-10-06) is that: the
// vocabulary was the seam, each feel's UIKit form is in the table below its pattern (THE IPHONE APP
// FEELS THEM ALL), and no call site changed. Which phone is an iPhone: lib/ios, its one home.

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
  medium: 12,                    // something added or moved — into the cart, an order's status; a row's menu risen under a long press
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

// THE IPHONE APP FEELS THEM ALL (2026-10-06, the iPhone round). Inside the app the phone's own haptic
// engine is a call away, so every feel plays as UIKit's impact, selection or notification feedback —
// the seam this file was written to leave. Each feel's iPhone form is in the one table below, beside
// its vibration pattern above; components/NativeBridge (in the app build only) hands this file the
// player for one step when the app starts. The web never has a player, and nothing changes for it.

/** One step of a feel on an iPhone, `after` ms after the step before it. */
export type UIKitStep =
  | { kind: "selection"; after?: number }
  | { kind: "impact"; style: "LIGHT" | "MEDIUM" | "HEAVY"; after?: number }
  | { kind: "notification"; type: "SUCCESS" | "WARNING" | "ERROR"; after?: number };

const UIKIT_STEPS: Record<Feel, readonly UIKitStep[]> = {
  selection: [{ kind: "selection" }],
  light: [{ kind: "impact", style: "LIGHT" }],
  medium: [{ kind: "impact", style: "MEDIUM" }],
  heavy: [{ kind: "impact", style: "HEAVY" }],
  success: [{ kind: "notification", type: "SUCCESS" }],
  warning: [{ kind: "notification", type: "WARNING" }],
  error: [{ kind: "notification", type: "ERROR" }],
  threshold: [{ kind: "selection" }],
  release: [{ kind: "selection" }],
  boundary: [{ kind: "impact", style: "MEDIUM" }],
  toggleOn: [{ kind: "impact", style: "LIGHT" }],
  toggleOff: [{ kind: "selection" }],
  increase: [{ kind: "impact", style: "LIGHT" }],
  decrease: [{ kind: "selection" }],
  start: [{ kind: "impact", style: "MEDIUM" }, { kind: "impact", style: "LIGHT", after: 90 }],
  live: [{ kind: "impact", style: "MEDIUM" }, { kind: "impact", style: "MEDIUM", after: 110 }, { kind: "impact", style: "HEAVY", after: 110 }],
  paid: [{ kind: "notification", type: "SUCCESS" }],
  alert: [{ kind: "notification", type: "WARNING" }, { kind: "notification", type: "WARNING", after: 300 }],
};

/** The iPhone table, read-only, for the tests. */
export const HAPTIC_UIKIT: Readonly<Record<Feel, readonly UIKitStep[]>> = UIKIT_STEPS;

type StepPlayer = (step: UIKitStep) => void;
let nativePlayer: StepPlayer | null = null;

/** The app's own haptic engine, one step at a time (components/NativeBridge). Null: the web path. */
export function setNativeHaptics(play: StepPlayer | null): void {
  nativePlayer = play;
}

function playNative(play: StepPlayer, feel: Feel): void {
  let at = 0;
  for (const step of UIKIT_STEPS[feel]) {
    at += step.after ?? 0;
    if (at === 0) play(step);
    else setTimeout(() => { try { play(step); } catch { /* never worth an error */ } }, at);
  }
}

export function haptic(feel: Feel): void {
  if (nativePlayer) {
    try { playNative(nativePlayer, feel); } catch { /* a feel is never worth an error */ }
    return;
  }
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
