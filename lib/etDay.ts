import { etDayKey } from "./dates";

// THE INSTANT AN ET BUSINESS DAY BEGINS (2026-10-11): "2026-10-11" is 04:00Z (EDT), "2026-12-01" is 05:00Z (EST).
// Midnight is never inside a clock change (those happen at 2am), so it is one of the two offsets, and the one that
// still reads as that ET day is the right one. The pickup board's "from the start of today" bound (lib/dropDate) and
// the crew page's turn of the day (lib/useEtDay). Its own module, not lib/dates: dates rides in the bundle every page
// shares, and this is the crew's alone.
export function etDayStart(key: string): Date {
  const k = String(key).slice(0, 10);
  const edt = new Date(`${k}T00:00:00-04:00`);
  return etDayKey(edt) === k ? edt : new Date(`${k}T00:00:00-05:00`);
}
