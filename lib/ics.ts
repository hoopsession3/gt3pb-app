// Calendar export — pure, no deps. Turns an event/stop into a universal .ics file (Apple Calendar,
// Outlook, Google all import it) and a one-tap Google Calendar link. No auth, no shared mailbox:
// whoever's assigned taps "Add to calendar" and it lands in THEIR own calendar. A stable UID per
// event/stop means re-adding updates the same entry instead of duplicating.

export interface CalEvent {
  uid: string;            // stable id, e.g. "stop-<id>@gt3pb"
  title: string;
  start: Date;
  end?: Date | null;
  allDay?: boolean;       // true → date-only (no time landed)
  location?: string | null;
  description?: string | null;
  url?: string | null;
}

const p2 = (n: number) => String(n).padStart(2, "0");
// floating local wall-clock (no Z) so a 10am stop shows at 10am on the user's calendar
const localStamp = (d: Date) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}T${p2(d.getHours())}${p2(d.getMinutes())}00`;
const dateStamp = (d: Date) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
const utcStamp = (d: Date) => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const addDay = (d: Date) => new Date(d.getTime() + 86400000);
const addHrs = (d: Date, h: number) => new Date(d.getTime() + h * 3600000);

// Build a complete .ics document. `stamp` is "now" (passed in so the builder stays pure/testable).
export function buildIcs(ev: CalEvent, stamp: Date): string {
  const allDay = !!ev.allDay;
  const end = ev.end ?? (allDay ? addDay(ev.start) : addHrs(ev.start, 2));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GT3 Performance Bar//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${utcStamp(stamp)}`,
    allDay ? `DTSTART;VALUE=DATE:${dateStamp(ev.start)}` : `DTSTART:${localStamp(ev.start)}`,
    allDay ? `DTEND;VALUE=DATE:${dateStamp(end)}` : `DTEND:${localStamp(end)}`,
    `SUMMARY:${esc(ev.title)}`,
    ev.location ? `LOCATION:${esc(ev.location)}` : "",
    ev.description ? `DESCRIPTION:${esc(ev.description)}` : "",
    ev.url ? `URL:${esc(ev.url)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

const fmtClock = (d: Date) => { let h = d.getHours(); const m = d.getMinutes(); const ap = h < 12 ? "am" : "pm"; h = h % 12 || 12; return `${h}${m ? ":" + p2(m) : ""}${ap}`; };
const fmtMins = (n: number) => (n % 60 === 0 ? `${n / 60} hr` : n > 60 ? `${Math.floor(n / 60)} hr ${n % 60} min` : `${n} min`);
// Move the calendar block earlier by `minutes` (drive + setup buffer) while keeping the real service
// time in the notes. No-op for all-day entries. Pure.
export function withBuffer(ev: CalEvent, minutes: number): CalEvent {
  if (!minutes || ev.allDay) return ev;
  const start = new Date(ev.start.getTime() - minutes * 60000);
  const note = `Leave/setup buffer: ${fmtMins(minutes)} before ${fmtClock(ev.start)} service.`;
  return { ...ev, start, description: ev.description ? `${note}\n${ev.description}` : note };
}

// One-tap Google Calendar "add" link (uses UTC instants for timed events).
export function googleCalUrl(ev: CalEvent): string {
  const allDay = !!ev.allDay;
  const end = ev.end ?? (allDay ? addDay(ev.start) : addHrs(ev.start, 2));
  const dates = allDay ? `${dateStamp(ev.start)}/${dateStamp(end)}` : `${utcStamp(ev.start)}/${utcStamp(end)}`;
  const q = new URLSearchParams({ action: "TEMPLATE", text: ev.title, dates });
  if (ev.location) q.set("location", ev.location);
  if (ev.description) q.set("details", ev.description + (ev.url ? `\n\n${ev.url}` : ""));
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

// Parse a loose event clock string ("11AM", "2:30", "8", "14:00") → {h,m}. Returns null when it
// can't be trusted, so the caller falls back to an all-day entry rather than guessing the hour wrong.
export function parseClock(s: string | null | undefined): { h: number; m: number } | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3]?.toLowerCase();
  if (h > 23 || min > 59) return null;
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap) { if (h > 12) return { h, m: min }; return null; } // bare number is ambiguous → all-day
  return { h, m: min };
}

// Build a CalEvent from an EVENT row (day date + loose time strings).
export function calFromEvent(e: { id: string; title: string; day: string | null; start_time?: string | null; end_time?: string | null; location_text?: string | null; blurb?: string | null }, url?: string): CalEvent | null {
  if (!e.day) return null;
  const [y, mo, d] = e.day.split("-").map(Number);
  const sc = parseClock(e.start_time);
  const start = new Date(y, (mo || 1) - 1, d || 1, sc?.h ?? 0, sc?.m ?? 0);
  const ec = parseClock(e.end_time);
  const end = sc && ec ? new Date(y, (mo || 1) - 1, d || 1, ec.h, ec.m) : null;
  return { uid: `event-${e.id}@gt3pb`, title: e.title || "GT3 event", start, end, allDay: !sc, location: e.location_text, description: e.blurb, url };
}

// Build a CalEvent from a STOP row (proper starts_at/ends_at timestamps).
export function calFromStop(s: { id: string; name: string; starts_at?: string | null; ends_at?: string | null; location_text?: string | null; address?: string | null; notes?: string | null }, url?: string): CalEvent | null {
  if (!s.starts_at) return null;
  return {
    uid: `stop-${s.id}@gt3pb`, title: s.name || "GT3 truck stop",
    start: new Date(s.starts_at), end: s.ends_at ? new Date(s.ends_at) : null, allDay: false,
    location: s.address || s.location_text, description: s.notes, url,
  };
}
