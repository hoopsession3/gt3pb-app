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

// The one rule for when a pack's drop closes lives in ./packClose (R7b): lib/orderAhead, which every page loads with the
// drink sheet, needs the rule and not these words — nor the two date formats they build as the module loads.
export { PACK_LEAD_MS, PICKUP_STOPS_READ, packClosesAt, packIsOpen, type PackStop } from "./packClose";

/** When a drop closes, in words: "Fri 7:00am" (Eastern). */
const CLOSE_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });
export function closesWords(at: Date): string {
  const p = Object.fromEntries(CLOSE_FMT.formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.hour}:${p.minute}${String(p.dayPeriod ?? "").toLowerCase()}`;
}
