// A CANCELED STOP'S LINE (2026-10-12, H5 of the customer frontend audit; split out 2026-10-13, R3b). What Find Us shows
// in a canceled stop's place, and the day and the reason every word about a canceled stop is built from. Its own module
// so Find Us carries this line and nothing else: the texts, the crew's toast and its refund list (lib/stopCancel) are
// the crew's and the server's, and they rode in Find Us's bundle while they shared a file with it.

export type CanceledStop = { name: string | null; starts_at: string | null; cancel_reason: string | null };

/** "Sat 10/17" in the stop's own clock (stops are Eastern). */
export function stopDay(startsAt: string | null): string {
  if (!startsAt) return "its day";
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return "its day";
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
  const md = d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "America/New_York" });
  return `${wd} ${md}`;
}

/** " — Rained out", or nothing when no reason was given. */
export const stopWhy = (s: CanceledStop) => (s.cancel_reason?.trim() ? ` — ${s.cancel_reason.trim()}` : "");
/** The stop's name, or "the truck's stop". */
export const stopWhere = (s: CanceledStop) => s.name?.trim() || "the truck's stop";

/** Find Us, in the stop's place: "Canceled · WineXpress · Sat 10/17 — Rained out". */
export function canceledLine(s: CanceledStop): string {
  return `${stopWhere(s)} · ${stopDay(s.starts_at)}${stopWhy(s)}`;
}
