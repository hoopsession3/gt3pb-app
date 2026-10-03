import { isStopPast } from "./stopRecord";

// WHAT COUNTS AS PREP — one rule (2026-10-03).
//
// Ryan's Readiness screen read "32 open prep tasks · 15 critical open · 10 events on the books",
// and under it, first in the prep list, two events from July and August — "Not started". The
// tiles counted every open task in the table and every event ever entered; the list sorted the
// past to the top. None of it was wrong as a count, and none of it was readiness: a task for an
// event that happened two months ago is not something to get ready for, it is something somebody
// never closed out. Three readers — the tiles (components/CrewKpis.tsx), the board
// (components/PrepBoard.tsx) and the prep list (app/crew/page.tsx) — each decided for themselves
// what was current, which is how the tiles and the list stopped agreeing. This file decides.
//
//   current  — the target is still ahead (or has no date, or the task has no target): prep.
//   past     — the target's day has gone, or it was closed (stage done, status done, archived):
//              still real, still shown, but LAST, and named for what it is — left open.
//
// A stop's "past" is lib/stopRecord's rule (8 h past its start), the same one Route uses; an event's
// is its day against the operator's calendar day — the one-clock spine, never a UTC cast.

export type EventState = { day?: string | null; archived_at?: string | null; stage?: string | null } | null | undefined;
export type StopState = { starts_at?: string | null; archived_at?: string | null; status?: string | null } | null | undefined;

/** An event whose day is before `today` (YYYY-MM-DD keys, so string order is date order). */
export const eventIsPast = (day: string | null | undefined, today: string): boolean => !!day && day < today;

/** Closed by a person: done, or archived. */
export const eventIsClosed = (e: EventState): boolean => !!e && (!!e.archived_at || e.stage === "done");
export const stopIsClosed = (s: StopState): boolean => !!s && (!!s.archived_at || s.status === "done");

/** Is this target still something to get ready for? */
export function targetIsCurrent(e: EventState, s: StopState, today: string): boolean {
  if (e) return !eventIsClosed(e) && !eventIsPast(e.day, today);
  if (s) return !stopIsClosed(s) && !isStopPast(s.starts_at);
  return true;   // no target: a general task is always current
}

/** The same question, asked of a task row with its target embedded. */
export function taskIsCurrent(t: { events?: EventState; stops?: StopState; event_id?: string | null; stop_id?: string | null }, today: string): boolean {
  // A task bound to an event the query could not embed (deleted, or out of scope) is bound to
  // nothing current — it is not general, it is orphaned, and it goes with the past.
  if (t.event_id && !t.events) return false;
  if (t.stop_id && !t.stops) return false;
  return targetIsCurrent(t.events ?? null, t.stops ?? null, today);
}

/** "By date / when" bucket for a prep card. Past comes LAST, named for what it is. */
export function prepBucket(day: string | null | undefined, today: string): { key: number; label: string } {
  if (!day) return { key: 4, label: "Unscheduled" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { key: 4, label: "Unscheduled" };
  if (day < today) return { key: 5, label: "Past · not closed out" };
  if (day === today) return { key: 1, label: "Today" };
  const d = new Date(`${day}T00:00:00`), t = new Date(`${today}T00:00:00`);
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (diff <= 7) return { key: 2, label: "This week" };
  return { key: 3, label: "Later" };
}
