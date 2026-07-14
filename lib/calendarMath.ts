// ONE place for the calendar's trickiest math, shared by the Company + Brand calendars (which each
// re-derived it independently — the UTC-bounding bug had to be discovered twice; never again).
//
// timestamptz columns (scheduled_for / starts_at / due_at) must be bounded by the REAL UTC instants
// of the LOCAL day range — a naive "YYYY-MM-DDT00:00:00" string is read as UTC by PostgREST and
// silently drops items late on the last local day for behind-UTC (Eastern) zones. Plain date columns
// (day / due_on / brew_date...) key off the local calendar strings instead.
export function localDayBoundsISO(start: Date, end: Date): { fromISO: string; toISO: string } {
  return {
    fromISO: new Date(start.getFullYear(), start.getMonth(), start.getDate()).toISOString(),
    toISO: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).toISOString(),   // exclusive: midnight after the last local day
  };
}
