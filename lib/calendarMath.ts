// ONE place for the calendar's trickiest math, shared by the Company + Brand calendars (which each
// re-derived it independently — the UTC-bounding bug had to be discovered twice; never again).
//
// timestamptz columns (scheduled_for / starts_at / due_at) must be bounded by the REAL UTC instants
// of the LOCAL day range — a naive "YYYY-MM-DDT00:00:00" string is read as UTC by PostgREST and
// silently drops items late on the last local day for behind-UTC (Eastern) zones. Plain date columns
// (day / due_on / brew_date...) key off the local calendar strings instead.
import { etInstantIso } from "./dates";

/** The instants a span of calendar days covers on the business's clock (R33 — the audit's FE11-06): from Eastern midnight
 *  of the first cell's date to Eastern midnight after the last's — the days the grid draws, read where the business is.
 *  Each cell is a calendar date (a Date at the phone's midnight, as the grid makes them); its date, not its instant. */
export function etDayBoundsISO(start: Date, end: Date): { fromISO: string; toISO: string } {
  const k = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const after = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  return { fromISO: etInstantIso(k(start), "00:00"), toISO: etInstantIso(k(after), "00:00") };
}

export function localDayBoundsISO(start: Date, end: Date): { fromISO: string; toISO: string } {
  return {
    fromISO: new Date(start.getFullYear(), start.getMonth(), start.getDate()).toISOString(),
    toISO: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).toISOString(),   // exclusive: midnight after the last local day
  };
}
