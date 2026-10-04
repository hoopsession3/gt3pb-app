// THE ROAD — which truck stops are over, which are still ahead, and when one is due (2026-10-04).
//
// One home for the stop-timing rules, kept dependency-light on purpose: the crew's Live truck
// instrument, its route list, PrepBoard, lib/readiness and the PUBLIC Find Us page all ask these,
// and a guest's bundle should carry the rule without the crew's gap vocabulary around it.
// lib/stopRecord re-exports everything here, so its callers did not move.

import { dayKey } from "./dates";

// ── when a stop is over ─────────────────────────────────────────────────────────────────────────
// A stop's status column is not the whole answer: one nobody remembered to close is still over once
// its start time is far enough behind us. "Far enough" was eight hours in THREE places:
//
//   app/crew/page.tsx        OWNERDET_STOP_GRACE_MS = 8 * 3600 * 1000  + its own derivedStopStatus
//   components/FieldOpSheet  STOP_GRACE_MS          = 8 * 3600 * 1000  + a line-identical copy
//   components/PrepBoard     STOP_GRACE_MS          = 8 * 3600 * 1000  + isStopPast, the same rule
//                                                                        written a third way
//
// The two derivedStopStatus copies were identical apart from the constant's name. lib/stopRecord's
// header explains why that matters — a second copy of whenLabel is how "16 Days Ago" comes back on
// one screen and not the other — and the argument is stronger here, because this decides whether a
// stop reads as DONE. Change the grace in one file and the same stop is finished on the detail
// sheet and still upcoming on the board.
//
// They HAD already drifted, in the smallest possible way: derivedStopStatus used `now - t > GRACE`,
// isStopPast used `t <= now - GRACE`, and those disagree at exactly the eight-hour mark. One
// instant, no practical consequence — and exactly the kind of divergence three copies produce for
// free. Strictly-greater wins, because that is what the status a person SEES was already using.
export const STOP_DONE_GRACE_MS = 8 * 3600 * 1000;

/** Has this stop's start slipped far enough behind us to count as over? */
export const isStopPast = (startsAt: string | null | undefined): boolean =>
  !!startsAt && Date.now() - new Date(startsAt).getTime() > STOP_DONE_GRACE_MS;

// ── the road ahead: one rule (2026-10-04) ───────────────────────────────────────────────────────
// Saturday, 9 PM. Ryan's Live Ops read "OFFLINE · next · Wine Express — Five Forks" over a red Go
// live button, and the public Find Us page, the same minute, read "Nothing scheduled yet". Both
// read the same stops. The crew instrument took `active[0]` — the first unarchived stop in `sort`
// order, a column most stops share at 0 — so "next" was whichever row Postgres returned first, and
// that was the visit already finished and waiting on its after-action note. Go live would have put
// the truck live there.
//
// The right rule existed twice already: LiveControl's own route list a hundred lines further down
// ("Mirrors /truck: 8h grace, done/completed visits excluded"), and FindUs, written another way.
// It lives here now, and the instrument, the route list and the public road all ask it.
export type RoadStop = {
  id: string; starts_at?: string | null; status?: string | null;
  completed_at?: string | null; archived_at?: string | null;
};

/**
 * Still on the road: not archived, not closed (done, or stamped complete), and not more than the
 * grace past its start. The live stop is on it however late it runs; an undated stop is on it
 * (somebody has to give it a date, and it should be in front of them while they do).
 */
export function isStopAhead(s: RoadStop, liveStopId?: string | null): boolean {
  if (s.archived_at || s.status === "done" || s.completed_at) return false;
  if (liveStopId && s.id === liveStopId) return true;
  return !isStopPast(s.starts_at);
}

const startMs = (s: RoadStop): number => {
  const t = s.starts_at ? new Date(s.starts_at).getTime() : NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

/** The road in the order the truck drives it: the live stop first, then by start, undated last. */
export function roadAhead<T extends RoadStop>(stops: readonly T[], liveStopId?: string | null): T[] {
  return stops.filter((s) => isStopAhead(s, liveStopId)).sort((a, b) => {
    const live = Number(!!liveStopId && b.id === liveStopId) - Number(!!liveStopId && a.id === liveStopId);
    if (live) return live;
    const ta = startMs(a), tb = startMs(b);
    return ta === tb ? 0 : ta < tb ? -1 : 1;
  });
}

/**
 * Is it time to go live here? Its start is on today's calendar day, or it has started and is still
 * inside the grace. Anything else — a stop next Saturday, a stop with no date — is not a one-tap
 * Go live; the instrument asks first. `now` is a parameter so the smoke harness can pin it.
 */
export function stopIsDue(startsAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!startsAt) return false;
  const t = new Date(startsAt);
  if (!Number.isFinite(t.getTime())) return false;
  if (dayKey(t) === dayKey(now)) return true;
  return t.getTime() <= now.getTime() && now.getTime() - t.getTime() <= STOP_DONE_GRACE_MS;
}
