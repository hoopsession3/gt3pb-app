import { dayFromKey } from "./dates";

// THE CONSOLE'S WORDS FOR A DAY — how late something is.
//
// Why these are not in lib/dates, where they would otherwise belong: lib/dates rides in the shared
// chunk EVERY page loads, guest pages included, and the bundler keeps a shared module whole. Put
// there, these (with a greeting helper since retired, see below) cost every public route 151 bytes
// gzipped (measured 2026-10-04, both builds, every route: /reserve 298 402 → 298 553) for words only
// the crew console says. Here they ride in the console's own chunk. lib/dates stays the one answer
// to "what day is it"; this is the one answer to "how late is it" on My Day — and it builds on
// dayFromKey rather than copying it.

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

// ── partOfDay, retired the same day ───────────────────────────────────────────────────────────
// It gave My Day's greeting its capital back ("Evening, Ryan."); hours later Ryan asked what on
// the app was unnecessary, and a 30px greeting ahead of today's op was the first answer. It went,
// and so did this.
