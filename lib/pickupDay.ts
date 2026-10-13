import { etAt } from "./etDay";

// THE PICKUP DAY, IN WORDS (2026-10-13, R5 of the customer audit): "2026-10-17" → "Sat, Oct 17". A pack's pickup day is
// a date key (drop_orders.drop_date), and the texts and emails printed the key itself: "reserved for pickup
// 2026-10-17". Formatted at noon UTC, so the key's own day is the day named whatever the server's clock or zone. Its own
// small module, not lib/dates (which every page loads): the server's messages and the pack screens read it.
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

export function pickupDayWords(key: string | null | undefined): string {
  const k = String(key ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return String(key ?? "");
  return DAY.format(new Date(`${k}T12:00:00Z`));
}

// ── WHEN A PACK'S DROP CLOSES — THE ONE RULE (2026-10-13, R5, 0397 pack_closes_at) ─────────────────────────────────────
// Said in SQL for the database's own refusals (cancel_own_reservation) and here, the same way, for the routes and the
// screens: 24 hours before the pack's stop (the packs are brewed to order); a stop called off never closes it — moving
// it or canceling it is the customer's call then; with no stop, the Saturday rule: three days before, 6pm Eastern.
// It replaces three: the order rule (24 hours), Move's and Change's "three days before at 6pm" whenever the stop was
// gone from the schedule — which refused the customers a canceled stop's text had told to move their pack.
export const PACK_LEAD_MS = 24 * 60 * 60 * 1000;

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

/** When a drop closes, in words: "Fri 7:00am" (Eastern). */
const CLOSE_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });
export function closesWords(at: Date): string {
  const p = Object.fromEntries(CLOSE_FMT.formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.hour}:${p.minute}${String(p.dayPeriod ?? "").toLowerCase()}`;
}
