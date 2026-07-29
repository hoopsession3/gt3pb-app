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
// Normalizes a crew-typed time string to lowercase "6:30pm" / "6pm" style. Events' start_time/
// end_time are free text the crew types by hand (no input format enforced) — arrives as either a
// bare 24h "H:MM" (the derived/label path always produces this) or already-12h text in any
// casing/spacing the crew happened to type ("6:00PM", "6:00 pm", …). Moved here (2026-07-29,
// formerly private to FindUs.tsx) after the identical inconsistency turned up a second place: an
// event's list-row time read "6:00PM" raw while the stop row right next to it went through this and
// read "6:00pm" — same bug the hero section already fixed once (reported live, 2026-07-19), just
// not everywhere yet. Anywhere an event's time sits next to a stop's (or another event's) on the
// same screen should run both through this — not one raw, one derived — or the drift comes back.
export function fmt12(v?: string | null): string | null {
  if (!v) return v ?? null;
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(v.trim());
  if (!m) return v;
  const h = Number(m[1]);
  const explicitPeriod = m[3]?.toLowerCase();
  if (explicitPeriod) {
    // Already has a period — normalize casing/spacing only; don't reinterpret the hour as typed.
    return h === 0 || h > 12 ? v : `${h}:${m[2]}${explicitPeriod}`;
  }
  if (h > 23) return v;
  return `${h % 12 || 12}:${m[2]}${h >= 12 ? "pm" : "am"}`;
}

// ── Event-row formatters (moved from components/RsvpRow.tsx, 2026-07-29) ──
// Pure string/date logic with a bug history (the "Jul 31" vs "8/1" drift; the "6:00PM" casing bug,
// twice), so they live HERE — a zero-dependency module the smoke harness compiles and asserts on
// every CI run. The shape is structural (EventRow satisfies it) so this file keeps zero imports.
export type EvLike = { day?: string | null; day_label?: string | null; start_time?: string | null; end_time?: string | null };

// Both times through the ONE normalizer — an event's list-row time read "6:00PM" raw while the
// stop row next to it read "6:00pm" (2026-07-29 audit; same class as the 2026-07-19 hero fix).
export function evTime(ev: EvLike) {
  const start = fmt12(ev.start_time) ?? "";
  const end = fmt12(ev.end_time) ?? "";
  return end ? `${start}–${end}` : start;
}
// "Fri, Jul 31" from events.day — parsed as local calendar parts, NOT new Date(iso),
// which reads as UTC midnight and shows yesterday for evening viewers.
export function evDate(ev: EvLike) {
  if (!ev.day) return null;
  const [y, m, d] = ev.day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
export function evLeadDay(ev: EvLike) {
  if (ev.day_label?.trim()) return ev.day_label;
  if (!ev.day) return "";
  const [y, m, d] = ev.day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}
// Numeric M/D — matches the stop rows' and hero's convention. This rendered "Jul 31" next to a
// stop's "8/1" until 2026-07-29 (Ryan: "they need to be cohesive"); the smoke test pins it now.
export function evLeadDate(ev: EvLike) {
  if (!ev.day) return "";
  const [, m, d] = ev.day.split("-").map(Number);
  return `${m}/${d}`;
}

// Next date on/after `now` matching tpl's weekday, at tpl's own time-of-day — operator-local wall
// clock, same convention as localToday. Used by "Stop here again" to prefill a repeat visit
// (2026-07-29); `now` is a parameter so the smoke harness can pin it.
export function nextWeekdayAt(tpl: Date, now: Date = new Date()): Date {
  const result = new Date(now);
  result.setHours(tpl.getHours(), tpl.getMinutes(), 0, 0);
  let diff = (tpl.getDay() - now.getDay() + 7) % 7;
  if (diff === 0 && result <= now) diff = 7; // today's weekday, but that time already passed
  result.setDate(result.getDate() + diff);
  return result;
}

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
