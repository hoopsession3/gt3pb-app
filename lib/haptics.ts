// Guarded haptic feedback — a quiet premium-PWA touch. Keep patterns short.
//
// THE IPHONE TICKS TOO (2026-10-05, the gesture round). This was `navigator.vibrate` alone, and Safari
// has never had it: every haptic() in the app — going live, a pack paid, a swipe armed — buzzed on
// Android and did nothing at all on the phones the crew carry. Safari 17.4 gave the HTML switch
// (`<input type="checkbox" switch>`) the system's own selection tick when it flips, and clicking a
// label flips its switch, so a hidden one, flipped and removed, is a tick. One tick, not a pattern —
// a switch has one feel. A browser without either does nothing, as before. If WebKit ever stops
// ticking for a switch nobody can see, this goes quiet again; nothing else depends on it.
const iPhoneLike = () =>
  typeof navigator !== "undefined"
  && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform ?? "")));

function switchTick() {
  if (typeof document === "undefined" || !document.body || !iPhoneLike()) return;
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

export function haptic(pattern: number | number[] = 12) {
  // Not before the person has touched the page: a browser refuses a buzz it did not see a tap for
  // (Chrome logs the refusal as an error), and a swipe's first move is not yet a tap.
  if (typeof navigator !== "undefined" && navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function" && navigator.vibrate(pattern)) return;
  } catch { /* unsupported */ }
  switchTick();
}

export const HAPTIC = {
  tick: 6,          // a swipe crossing the line where letting go does something
  tap: 8,
  add: 12,
  success: [14, 40, 14] as number[],
  alert: [200, 100, 200] as number[],
  // rituals — one signature per moment, used once per moment
  arm: [16, 50, 16, 50, 26] as number[],   // going live: two beats, then the engine
  paid: [10, 30, 18] as number[],           // money settled (a pack flips to paid in your hand)
};
