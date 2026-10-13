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
