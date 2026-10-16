import { etAt } from "./etDay";

// ── WHEN A PACK'S DROP CLOSES — THE ONE RULE (2026-10-13, R5, 0397 pack_closes_at) ─────────────────────────────────────
// Said in SQL for the database's own refusals (cancel_own_reservation) and here, the same way, for the routes and the
// screens: 24 hours before the pack's stop (the packs are brewed to order); a stop called off never closes it — moving
// it or canceling it is the customer's call then; with no stop, the Saturday rule: three days before, 6pm Eastern.
// It replaces three: the order rule (24 hours), Move's and Change's "three days before at 6pm" whenever the stop was
// gone from the schedule — which refused the customers a canceled stop's text had told to move their pack.
export const PACK_LEAD_MS = 24 * 60 * 60 * 1000;

/** How many of the next stops the phone offers pickup days from and the server checks them against — one number (R7,
 *  2026-10-15): the phone read 8 and the server 6, so with two stops a day the phone offered a day the server never saw,
 *  and refused it with "That pickup day just changed". Canceled stops are on neither. */
export const PICKUP_STOPS_READ = 8;

export type PackStop = { starts_at: string | null; canceled_at?: string | null } | null | undefined;

/** When this pack's drop closes, or null when it does not (its stop was called off). */
export function packClosesAt(dropDate: string, stop: PackStop): Date | null {
  if (stop) {
    if (stop.canceled_at) return null;
    if (stop.starts_at) return new Date(Date.parse(stop.starts_at) - PACK_LEAD_MS);
  }
  const k = String(dropDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return null;
  const d = new Date(`${k}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 3);
  return etAt(d.toISOString().slice(0, 10), 18);
}

/** Is the pack's drop still open at `nowMs`? A closing time of null (a stop called off) is always open. */
export function packIsOpen(dropDate: string, stop: PackStop, nowMs: number = Date.now()): boolean {
  const at = packClosesAt(dropDate, stop);
  return at === null || nowMs < at.getTime();
}
