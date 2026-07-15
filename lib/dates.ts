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

// Humanized, UNAMBIGUOUS relative day for the OPERATOR's local wall-clock (pairs with localToday).
// The crew Route board glued a static "next ·" label to a weekday, so "next · Sat Jul 18" misread as
// "next Saturday" when the visit was THIS Saturday. This returns a qualifier that can't be misread —
// "Today" / "Tomorrow" / "Yesterday" / "This Sat" / "Next Sat" / "3d ago" — and falls back to an
// absolute "Mon D" beyond two weeks. Callers append the absolute date for belt-and-suspenders clarity.
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
  if (diff >= 7 && diff < 14) return `Next ${wd}`;
  if (diff <= -2 && diff > -7) return `${-diff}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};
