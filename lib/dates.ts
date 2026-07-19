// THE one answer to "what day is it?" — the calendar audit found 'today' computed three ways
// (UTC slice, operator-local, calendar-local), so after ~8pm ET every UTC surface flipped to
// tomorrow: My Day greeted you with tomorrow's event, the drop checklist unfolded a night early.
// Two deliberate flavors, chosen by what the date MEANS:
// - localToday()/dayKey(): the OPERATOR's wall-clock day — crew-facing "today".
// - etToday()/etDayKey(): the BUSINESS day, pinned to America/New_York — commerce keys
//   (drop_date, delivery_date) that must not drift with the viewer's device timezone.
//   Same lesson lib/delivery.ts already learned; this makes it importable everywhere.
const pad = (n: number) => String(n).padStart(2, "0");

export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localToday = () => dayKey(new Date());

// en-CA formats as YYYY-MM-DD; DST-correct, works in Node and every browser.
const ET_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export const etDayKey = (d: Date) => ET_FMT.format(d);
export const etToday = () => etDayKey(new Date());

// Humanized weekday + time, pinned to America/New_York regardless of where the code runs — a
// server-side route (Node on Vercel, UTC) calling toLocaleTimeString(undefined, ...) silently
// formats in the SERVER's timezone, not the business's. The concierge API told guests the next
// stop was hours off from its real time this way (2026-07-17) before this existed. Any surface
// that needs to say a stop/event time in words server-side should use this, not an unqualified
// toLocaleDateString/toLocaleTimeString — that's exactly how this class of bug keeps recurring
// (see this file's header comment re: the earlier 'today' audit).
const ET_WD_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });
const ET_TIME_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
export const etTimeLabel = (d: Date): string => `${ET_WD_FMT.format(d)} ${ET_TIME_FMT.format(d)}`;

// Humanized, UNAMBIGUOUS relative day for the OPERATOR's local wall-clock (pairs with localToday).
// The crew Route board glued a static "next ·" label to a weekday, so "next · Sat Jul 18" misread as
// "next Saturday" when the visit was THIS Saturday. This returns a qualifier that can't be misread —
// "Today" / "Tomorrow" / "Yesterday" / "This Sat" / "3d ago" — and falls back to an absolute "Mon D"
// for anything a week or more out. Callers append the absolute date for belt-and-suspenders clarity.
//
// Deliberately no "Next Sat" bucket: a former diff 7–13 bucket returned "Next {wd}" for events up to
// two weeks out, so a Friday 12 days away read as "Next Fri" — but the Friday a normal reader means by
// "next Friday" is the one 5–6 days out, which already prints as "This Fri" above. "Next Fri" on a
// 12-day-out date was reliably read as the wrong Friday (2026-07-19 report: an event dated Jul 31 read
// as "Next Fri" the same week Jul 24 — the actual next Friday — existed). Once a date is a week or more
// out, a plain "Mon D" is unambiguous; only "This"/"Today"/"Tomorrow" are close enough to earn a relative word.
export const relativeDay = (input: Date | string): string => {
  const d = typeof input === "string"
    ? new Date(input.length <= 10 ? `${input}T12:00:00` : input)
    : input;
  if (isNaN(d.getTime())) return "";
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  const wd = d.toLocaleDateString([], { weekday: "short" });
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return `This ${wd}`;
  if (diff <= -2 && diff > -7) return `${-diff}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};
