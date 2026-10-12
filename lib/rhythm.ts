import { etAt } from "./etDay";

// THE OPERATING RHYTHM'S CLOCK (2026-10-12) — the rules the weekly review, the strategy session, the transcript that
// files a session, and the card on Plan that opens them all keep, written once. Each of the four had answered its
// own questions about time for itself, and they disagreed; the routes (app/api/agents/weekreview, stratsession,
// session-extract) and the card (components/OperatingRhythm) read these instead. Pure, so scripts/smoke.cjs holds
// each rule to its answers.

// ── WHEN A FOLLOW-UP IS DUE ───────────────────────────────────────────────────────────────────────────────────────
// A transcript's open item that names a day is due at the end of the working day, 5pm on the truck's clock. It was
// written `${day}T17:00:00-04:00`, which is 5pm only while Eastern Daylight Time lasts: from the first Sunday of
// November to the second Sunday of March every follow-up a session filed came due at 4pm, an hour before the
// session had said. lib/etDay.etAt finds the offset the day actually has.
/** The hour, on the truck's clock, a follow-up with a day falls due. */
export const FOLLOW_UP_HOUR = 17;
/** When a follow-up named for `day` (YYYY-MM-DD) is due: 5pm Eastern on that day, in July and in January. */
export const followUpDueAt = (day: string): string => etAt(day, FOLLOW_UP_HOUR).toISOString();
