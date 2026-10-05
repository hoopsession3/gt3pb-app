import { dayFromKey } from "./dates";

// THE CONSOLE'S WORDS FOR A DAY — how late something is.
//
// Why these are not in lib/dates, where they would otherwise belong: lib/dates rides in the shared
// chunk EVERY page loads, guest pages included, and the bundler keeps a shared module whole. Put
// there, these (with a greeting helper since retired, see below) cost every public route 151 bytes
// gzipped (measured 2026-10-04, both builds, every route: /reserve 298 402 → 298 553) for words only
// the crew console says. Here they ride in the console's own chunk. lib/dates stays the one answer
// to "what day is it"; this is the one answer to "how late is it" on My Day, and "how long since" on
// Plan — and it builds on dayFromKey rather than copying it.

// ── HOW LATE, SAID ONE WAY (2026-10-04) ───────────────────────────────────────────────────────
// Needs-you said "94 days late" with a private helper; My Day's top three said nothing at all, so
// three items marked critical gave no hint whether they were due today or a month ago. One rule.
/** Whole calendar days from one day key to another — positive when `to` is later. DST-proof. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayFromKey(to).getTime() - dayFromKey(from).getTime()) / 864e5);
}

/** "3 days late" · "1 day late" · "due today" · "in 4 days". `daysOut` is the due day minus today. */
export function dueWord(daysOut: number): string {
  const n = Math.abs(daysOut);
  if (daysOut < 0) return `${n} day${n === 1 ? "" : "s"} late`;
  if (daysOut === 0) return "due today";
  return `in ${n} day${n === 1 ? "" : "s"}`;
}

// ── HOW LONG SINCE, FOR SOMETHING THAT SHOULD RECUR (2026-10-05) ─────────────────────────────
// The weekly operating review read "Latest: Aug 2" on Oct 5 — nine weeks, said as a date, so a
// weekly ritual that had stopped looked like one that had just happened. Weeks from two on, because
// that is the unit the ritual is counted in; days below that. A day ahead of today has no "ago".
/** "today" · "yesterday" · "5 days ago" · "9 weeks ago" · "" (not yet). `daysAgo` is today minus the day. */
export function agoWord(daysAgo: number): string {
  if (!Number.isFinite(daysAgo) || daysAgo < 0) return "";
  if (daysAgo === 0) return "today";
  if (daysAgo === 1) return "yesterday";
  if (daysAgo < 14) return `${daysAgo} days ago`;
  return `${Math.floor(daysAgo / 7)} weeks ago`;
}

// ── partOfDay, retired the same day ───────────────────────────────────────────────────────────
// It gave My Day's greeting its capital back ("Evening, Ryan."); hours later Ryan asked what on
// the app was unnecessary, and a 30px greeting ahead of today's op was the first answer. It went,
// and so did this.
