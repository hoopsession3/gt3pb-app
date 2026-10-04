import { dayFromKey } from "./dates";

// THE CONSOLE'S WORDS FOR A DAY — how late something is, and which part of the day it is.
//
// Why these are not in lib/dates, where they would otherwise belong: lib/dates rides in the shared
// chunk EVERY page loads, guest pages included, and the bundler keeps a shared module whole. Put
// there, these three cost every public route 151 bytes gzipped (measured 2026-10-04, both builds,
// every route: /reserve 298 402 → 298 553) for words only the crew console says. Here they ride in
// the console's own chunk. lib/dates stays the one answer to "what day is it"; this is the one
// answer to "how do we say it" on My Day — and it builds on dayFromKey rather than copying it.

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

// ── THE PART OF THE DAY, AS A GREETING (2026-10-04) ───────────────────────────────────────────
// Ryan's My Day at 10:13 PM read "evening, Ryan." — the Design System pass of 2026-07-15 trimmed
// "Good evening" to its last word and never gave it back its capital, so since then the greeting
// has been a lowercase fragment. It also said "morning" at 1 AM, an hour after an event closed;
// the small hours belong to the evening before.
/** "Morning" 5:00–11:59 · "Afternoon" 12:00–16:59 · "Evening" 17:00 until 4:59 the next morning. */
export function partOfDay(hour: number): "Morning" | "Afternoon" | "Evening" {
  if (hour >= 5 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 17) return "Afternoon";
  return "Evening";
}
