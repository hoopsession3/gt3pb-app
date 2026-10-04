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

// ── WORKING WITH A DAY KEY ─────────────────────────────────────────────────────────────────────
// Everything below takes and returns a YYYY-MM-DD key rather than a Date, on purpose. A Date is an
// instant and carries a time zone question with it everywhere it goes; a key is a calendar day and
// has already answered that question. The three functions here are what the app kept writing by
// hand because they had no name.

/**
 * A Date anchored at LOCAL NOON of that calendar day.
 *
 * `new Date("2026-07-18")` parses as midnight UTC, which is the 17th in every US time zone — so
 * `.getDay()` and `.toLocaleDateString()` on it can both be a day early. Noon is far enough from
 * either midnight that no offset on earth and no DST shift can move the date. Four files had
 * already worked this out and written `new Date(\`${key}T12:00:00\`)` inline, each with its own
 * comment explaining it. This is that trick with a name.
 */
export function dayFromKey(key: string): Date {
  return new Date(`${String(key).slice(0, 10)}T12:00:00`);
}

/**
 * A day key N days away. Negative goes back.
 *
 * Done through dayFromKey, so a span crossing a DST boundary still lands on the calendar day a
 * person would name — `Date.now() + n * 864e5` is off by an hour twice a year and off by a whole
 * day whenever that hour crosses midnight.
 */
export function addDays(key: string, n: number): string {
  const d = dayFromKey(key);
  if (Number.isNaN(d.getTime())) return key;
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** The weekday a key falls on. Takes a key, not a Date, so there is no time zone to get wrong. */
const WD_LONG = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const WD_SHORT = new Intl.DateTimeFormat("en-US", { weekday: "short" });
export function weekdayOf(key: string, style: "long" | "short" = "long"): string {
  const d = dayFromKey(key);
  return Number.isNaN(d.getTime()) ? "" : (style === "short" ? WD_SHORT : WD_LONG).format(d);
}

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

// ── Clock times from a timestamp (moved from components/FindUs.tsx) ──
// fmt12 above normalizes a TIME STRING an operator typed ("6:00PM" → "6:00pm"). These do the other
// half: a timestamptz — which is what a stop carries — rendered in the SAME convention, so a stop's
// time and an event's time sitting on one row cannot read differently. That drift has been fixed
// three times on this codebase (the hero, 2026-07-19; the event/stop list rows, 2026-07-29; the
// stop lead reading "7AM" beside an event's "6:00pm", 2026-07-30), each time by copying the
// formatter rather than moving it. This is the move: FindUs' whenTime was the third copy and the
// company calendar was about to be the fourth.
//
// Minutes are always kept — "7:00am", never "7am" — because the event rows beside these always
// carry them.
export function clockTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // PINNED TO ET, and that is a correction rather than a preference. The version this replaced —
  // moved verbatim out of FindUs — used toLocaleTimeString(undefined, …), the VIEWER's timezone.
  // A stop happens where the truck is, which is Eastern; a crew member opening this in Denver, or
  // a customer checking Find Us from California, would have been shown a time shifted by hours for
  // an event that has one real start. This file's own header records the same bug reaching
  // production once already, from the server side, which is why ET_TIME_FMT exists. Same fact,
  // same formatter now.
  //
  // Caught while checking the agenda against the database: a stop reading 7:00am on screen and
  // 11:00 in a SQL editor is the same instant seen from two timezones, and the only way to know
  // which one a person is looking at is to pin it.
  return ET_TIME_FMT.format(d).replace(" ", "").toLowerCase();
}

/** "11:00am–2:00pm", or just the start when there is no end (or the end matches it). */
export function timeRange(startIso?: string | null, endIso?: string | null): string {
  const start = clockTime(startIso);
  if (!start) return "";
  const end = clockTime(endIso);
  return end && end !== start ? `${start}\u2013${end}` : start;
}

// \u2500\u2500 A PROMISE'S "WHEN", THE SAME ON THE SERVER AND THE PHONE (2026-10-04) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// "We make it when we open \u2014 Sat at 11:00am." That sentence is written twice for every pre-order:
// on the confirmation screen (the phone) and in the confirmation email (/api/checkout, on a UTC
// server). relativeDay above answers in the VIEWER's day, which is right for the crew's own lists
// and wrong for a promise both ends must word identically \u2014 so this one is pinned to the business
// day (ET) for the day AND the clock, like etDayKey and clockTime beside it.
//
//   same ET day \u2192 "today at 11:00am"   next \u2192 "tomorrow at 11:00am"
//   2\u20136 days    \u2192 "Sat at 11:00am"     a week or more \u2192 "Sat, Oct 10 at 11:00am"
//
// No "This Sat": inside a sentence that already says when, the weekday alone reads right, and the
// date joins it from a week out \u2014 the same line relativeDay draws. `nowMs` is a parameter so the
// smoke harness can pin it.
const ET_WDMD_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
export function etWhen(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diff = Math.round((dayFromKey(etDayKey(d)).getTime() - dayFromKey(etDayKey(new Date(nowMs))).getTime()) / 864e5);
  const at = clockTime(iso);
  if (diff === 0) return `today at ${at}`;
  if (diff === 1) return `tomorrow at ${at}`;
  if (diff > 1 && diff < 7) return `${ET_WD_FMT.format(d)} at ${at}`;
  return `${ET_WDMD_FMT.format(d)} at ${at}`;
}

/** Local 24-hour "HH:MM", from EITHER a timestamp or a typed time string — the sort key that puts a
 *  day's items in the order they actually happen. An agenda listing 3:30pm above 11:00am is not an
 *  agenda; before this the calendar ordered each day by the order the queries happened to run in.
 *  Returns null for anything undated, so those sort last rather than to midnight. */
export function sortTime(v?: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  const typed = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(t);
  if (typed) {
    let h = Number(typed[1]);
    const period = typed[3]?.toLowerCase();
    if (period === "pm" && h < 12) h += 12;
    if (period === "am" && h === 12) h = 0;
    if (h > 23) return null;
    return `${String(h).padStart(2, "0")}:${typed[2]}`;
  }
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Comparator for a day's worth of anything carrying a sortTime key. Timed items first, in clock
 *  order; undated ones after, because "sometime Saturday" belongs below "Saturday at 2" and not at
 *  midnight. Array.prototype.sort is stable (ES2019), so equal keys keep their existing order. */
export const byClock = <T extends { at?: string | null }>(a: T, b: T): number => {
  if (a.at && b.at) return a.at.localeCompare(b.at);
  if (a.at) return -1;
  if (b.at) return 1;
  return 0;
};

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

// ── A DAY, SAID ONCE (2026-10-04) ─────────────────────────────────────────────────────────────
// Ryan's Live Ops, Saturday night: "PICKUP · RESERVES & PACKS   Oct 10 · Oct 10's drop". The
// caller contract above says pair relativeDay with the absolute date, so "This Sat" cannot misread
// as next Saturday — and five callers did, each its own way. Two of them (DropOps, the route rows in
// LiveControl) wrote `${relativeDay(x)} · ${Mon D}`, which is right inside the week and prints the
// date twice outside it, because outside the week relativeDay already IS the date. MyPacks and
// MemberInbox had the correct version, as two private copies. These are that version, once.
const RELATIVE_WORD = /^(Today|Tomorrow|Yesterday|This )/;
/** True when relativeDay answered with a word ("This Sat", "3d ago") rather than a date. */
const saidRelatively = (rel: string): boolean => RELATIVE_WORD.test(rel) || rel.endsWith("d ago");
const asDate = (input: Date | string): Date =>
  typeof input === "string" ? new Date(input.length <= 10 ? `${input}T12:00:00` : input) : input;

/** "This Sat" inside the week, "Sat, Oct 10" outside it. Empty for a date that is not one. */
export function nearDay(input: Date | string): string {
  const rel = relativeDay(input);
  if (!rel || saidRelatively(rel)) return rel;
  return asDate(input).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** "This Sat · Oct 10" inside the week, "Sat, Oct 10" outside it — the date never twice. */
export function dayWithDate(input: Date | string): string {
  const rel = relativeDay(input);
  if (!rel) return "";
  const d = asDate(input);
  if (saidRelatively(rel)) return `${rel} · ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

// How long ago a timestamp fired, at alert-card granularity (2026-07-30, Ryan: "put dates to
// these alerts, alerting system is not useful atp"). An alert with no age is a rumor — this is
// the one clock every alert surface renders. `now` is a parameter so the smoke harness can pin
// it. Buckets: seconds → "just now", minutes → "12m ago", hours → "3h ago", yesterday →
// "Yesterday 4:12 PM", inside a week → "Tue 4:12 PM", older → "Jul 12".
export function ageLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) {
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    if (d >= midnight) return `${Math.floor(mins / 60)}h ago`;
  }
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yStart = new Date(now); yStart.setHours(0, 0, 0, 0); yStart.setDate(yStart.getDate() - 1);
  const yEnd = new Date(now); yEnd.setHours(0, 0, 0, 0);
  if (d >= yStart && d < yEnd) return `Yesterday ${t}`;
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
  if (d >= weekAgo) return `${d.toLocaleDateString([], { weekday: "short" })} ${t}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
