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
