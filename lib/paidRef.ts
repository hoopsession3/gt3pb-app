"use client";

import { useSyncExternalStore } from "react";

// A CHARGE THAT DIDN'T RECORD KEEPS ITS REFERENCE (2026-10-15, R7 of the customer re-audit). When the card is charged and
// the order is not saved, the server alerts the crew and the confirmation says "show this ref at the window" — and the
// reference went with the sheet. The phone keeps it for the day: the order bar says it on every page until the person
// says the crew has it. Only the reference and what was charged are kept. Its own file (R7b): the order bar on every
// page carries this and not the tickets, which ride with the order's page and the confirmation.
export type HeldRef = { ref: string; cents: number; at: number };
const REF_KEY = "gt3-paid-ref";
const REF_KEEP_MS = 12 * 3600 * 1000;
const REF_EVENT = "gt3-paid-ref";

/** The reference this phone holds, if any: the day after a charge that didn't record. */
export function heldRef(now = Date.now()): HeldRef | null {
  try {
    const x: unknown = JSON.parse(localStorage.getItem(REF_KEY) || "null");
    const r = x as Partial<HeldRef> | null;
    return r && typeof r.ref === "string" && typeof r.cents === "number" && typeof r.at === "number" && now - r.at < REF_KEEP_MS
      ? { ref: r.ref, cents: r.cents, at: r.at } : null;
  } catch { return null; }
}
/** Keep it (a ref of "" is a charge the server could not name: the bar still says it was paid). */
export function holdRef(ref: string, cents: number, now = Date.now()): void {
  try { localStorage.setItem(REF_KEY, JSON.stringify({ ref: ref.slice(0, 24), cents, at: now })); window.dispatchEvent(new Event(REF_EVENT)); }
  catch { /* private mode or full: the confirmation said it */ }
}
/** The person says the crew has it. */
export function forgetRef(): void {
  try { localStorage.removeItem(REF_KEY); window.dispatchEvent(new Event(REF_EVENT)); } catch { /* nothing kept */ }
}
let refCache: { raw: string | null; r: HeldRef | null } | null = null;
function refSnapshot(): HeldRef | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(REF_KEY); } catch { /* none */ }
  if (!refCache || refCache.raw !== raw) refCache = { raw, r: heldRef() };
  return refCache.r;
}
const refSubscribe = (cb: () => void) => {
  window.addEventListener("storage", cb); window.addEventListener(REF_EVENT, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(REF_EVENT, cb); };
};
/** The held reference, for the order bar: null on the server and when there is none. */
export function useHeldRef(): HeldRef | null {
  return useSyncExternalStore(refSubscribe, refSnapshot, () => null);
}
