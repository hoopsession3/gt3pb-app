import { addDays, etDayKey } from "./dates";
import { etAt, etDayStart } from "./etDay";
import { daysBetween } from "./dayWords";

// THE OPERATING RHYTHM'S CLOCK (2026-10-12) — the rules the weekly review, the strategy session, the transcript that
// files a session, and the card on Plan that opens them all keep, written once. Each of the four had answered its
// own questions about time for itself, and they disagreed; the routes (app/api/agents/weekreview, stratsession,
// session-extract) and the card (components/OperatingRhythm) read these instead. Pure, so scripts/smoke.cjs holds
// each rule to its answers.

// ── WHAT DAY IT IS, AND WHAT A WEEK IS ────────────────────────────────────────────────────────────────────────────
// The review and the session cut the day in UTC (`toISOString().slice(0, 10)`): from 8pm Eastern in summer and 7pm
// in winter a review or an agenda was dated tomorrow, counted tomorrow's milestones as overdue, and the agenda's
// one-a-day check let a second one through. The transcript cut it in Eastern; the card on Plan on the phone's own
// clock. All four read the business day now — lib/dates.etToday — and every window below is cut at Eastern
// midnight (lib/etDay.etDayStart), not at an instant some multiple of 24 hours ago.

/** Whole business days from the Eastern day an instant fell on to `today` (an ET day key): 0 on the same day. */
export function businessDaysSince(iso: string | null | undefined, today: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : daysBetween(etDayKey(d), today);
}

/** A rhythm's week, counted the way the founder digest and Home's numbers count one: the seven business days
 *  ending today (today and the six before it), and the seven before those. */
export type RhythmWeek = {
  today: string;
  /** This week's first day, and the instant it began. */
  from: string; fromAt: string;
  /** Tomorrow — the end (exclusive) of this week. */
  next: string;
  /** The week before: its first day, and its last (this week's first is where it ends, exclusive). */
  priorFrom: string; priorTo: string;
  /** Seven and fourteen days on, for what is coming. */
  ahead7: string; ahead14: string;
};
export function rhythmWeek(today: string): RhythmWeek {
  const from = addDays(today, -6);
  return {
    today, from, fromAt: etDayStart(from).toISOString(), next: addDays(today, 1),
    priorFrom: addDays(today, -13), priorTo: addDays(today, -7),
    ahead7: addDays(today, 7), ahead14: addDays(today, 14),
  };
}

/** The instant a business day began, as the ISO a timestamp column compares with. */
export const dayStartIso = (day: string): string => etDayStart(day).toISOString();

// ── WHEN A FOLLOW-UP IS DUE ───────────────────────────────────────────────────────────────────────────────────────
// A transcript's open item that names a day is due at the end of the working day, 5pm on the truck's clock. It was
// written `${day}T17:00:00-04:00`, which is 5pm only while Eastern Daylight Time lasts: from the first Sunday of
// November to the second Sunday of March every follow-up a session filed came due at 4pm, an hour before the
// session had said. lib/etDay.etAt finds the offset the day actually has.
/** The hour, on the truck's clock, a follow-up with a day falls due. */
export const FOLLOW_UP_HOUR = 17;
/** When a follow-up named for `day` (YYYY-MM-DD) is due: 5pm Eastern on that day, in July and in January. */
export const followUpDueAt = (day: string): string => etAt(day, FOLLOW_UP_HOUR).toISOString();
