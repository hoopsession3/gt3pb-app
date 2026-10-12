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

// THE INSTANT THE TRUCK'S CLOCK READS hh:mm ON AN ET BUSINESS DAY (2026-10-12). A session transcript filed its
// follow-ups as due `${day}T17:00:00-04:00`: Eastern Daylight Time, so from the first Sunday of November to the second
// Sunday of March every one came due at 4pm. Same reasoning as etDayStart above: one of the two offsets is right, and
// the right one is the one that reads back as that hour on that day. A clock change happens at 2am, so an afternoon is
// never inside one; a time inside the spring-forward gap does not exist on the wall and comes back as the hour after.
const ET_CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
export function etAt(key: string, hour: number, minute = 0): Date {
  const k = String(key).slice(0, 10);
  const hm = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const edt = new Date(`${k}T${hm}:00-04:00`);
  return etDayKey(edt) === k && ET_CLOCK.format(edt) === hm ? edt : new Date(`${k}T${hm}:00-05:00`);
}
