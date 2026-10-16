"use client";

import { useSyncExternalStore } from "react";
import { isUuid } from "./uuid";

// THE TICKETS THIS PHONE HOLDS (2026-10-13, R3b of the customer audit — board 09). A guest's order is theirs by its
// ticket alone (0395): the link the confirmation gives them. The phone keeps the last few, so the link is not lost with
// the sheet or the tab — /order without one lists them. Two days, five at most; nothing else about the order is kept.

export type HeldTicket = { t: string; no: string; at: number };
const KEY = "gt3-tickets";
const KEEP_MS = 48 * 3600 * 1000;

/** Is this a ticket's shape (a uuid)? The view is asked only for one that is. */
export const isTicket = (t: unknown): t is string => isUuid(t);

/** The order's page, by its ticket. */
export const ticketPath = (t: string): string => `/order?t=${encodeURIComponent(t)}`;

/** The order's shared link (0413): a view of the order — where it is, its drinks, what is due — that changes nothing. */
export const sharePath = (s: string): string => `/order?s=${encodeURIComponent(s)}`;

/** The tickets this phone holds, newest first: two days back, five at most. */
export function heldTickets(now = Date.now()): HeldTicket[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    return (Array.isArray(raw) ? raw : [])
      .filter((x): x is HeldTicket => !!x && isTicket(x.t) && typeof x.no === "string" && typeof x.at === "number" && now - x.at < KEEP_MS)
      .slice(0, 5);
  } catch { return []; }
}

/** Keep one (again: it moves to the front). A phone that keeps nothing still has the link on its screen. */
export function holdTicket(t: string, no: string, now = Date.now()): void {
  if (!isTicket(t)) return;
  try {
    const rest = heldTickets(now).filter((x) => x.t !== t);
    localStorage.setItem(KEY, JSON.stringify([{ t, no, at: now }, ...rest].slice(0, 5)));
  } catch { /* private mode or full: the link is on the screen */ }
}

// The list as a store the page reads (no state set in an effect — scripts/render.audit.mjs): the same array until what is
// stored changes, so React sees one value per change; nothing on the server, where there is no phone.
let cache: { raw: string | null; list: HeldTicket[] } | null = null;
function snapshot(): HeldTicket[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* none */ }
  if (!cache || cache.raw !== raw) cache = { raw, list: heldTickets() };
  return cache.list;
}
const subscribe = (cb: () => void) => { window.addEventListener("storage", cb); return () => window.removeEventListener("storage", cb); };
/** The tickets this phone holds, for a page: null while it is drawn on the server. */
export function useHeldTickets(): HeldTicket[] | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

// A CHARGE THAT DIDN'T RECORD KEEPS ITS REFERENCE (2026-10-15, R7 of the customer re-audit). When the card is charged and
// the order is not saved, the server alerts the crew and the confirmation says "show this ref at the window" — and the
// reference went with the sheet. The phone keeps it for the day: the order bar says it on every page until the person
// says the crew has it. Only the reference and what was charged are kept.
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
