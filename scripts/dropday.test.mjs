// THE PICKUP BOARD HOLDS ITS DROP FOR THE DAY (2026-10-11).
//
// The finding, as a sentence: the board asked for "the next stop starting after now", so the minute a drop's stop
// began it turned to the following one. Opened at 11:05 for an 11:00 drop, it showed next week's list, and the day's
// reservations sat under "Past drops" as no-shows with nothing to tap. With no stops on the route it used the ORDERING
// rule (lib/orderAhead nextDrop), which moves on to next Saturday at Wednesday's 6pm cutoff — while this Saturday's
// packs are still to brew and hand out.
//
// What is real is compiled from lib/ (dropDate, etDay, dates, orderAhead). The stops table is a stand-in that applies the
// filters the query sends (is, neq, not is null, gte, order, limit), so a wrong bound shows up as a wrong day.
// The clock is Eastern, as the truck's is.
process.env.TZ = "America/New_York";
import { libLoader } from "./fixtures/chargeonce.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const load = libLoader();
const D = load("lib/dropDate.ts"), T = load("lib/dates.ts"), E = load("lib/etDay.ts");
ok("compiled: lib/dropDate, lib/dates, lib/etDay", typeof D.nextDropDay === "function" && typeof E.etDayStart === "function");

function stopsTable(rows) {
  const sb = {
    bounds: [], fail: null,
    from(table) {
      if (table !== "stops") throw new Error(`stand-in: unexpected table ${table}`);
      const keep = []; let ord = null, lim = Infinity;
      const q = {
        select: () => q,
        is: (c, v) => { if (v !== null) throw new Error("stand-in: is() emulates null only"); keep.push((r) => r[c] == null); return q; },
        neq: (c, v) => { keep.push((r) => r[c] !== v); return q; },
        not: (c, op, v) => { if (op !== "is" || v !== null) throw new Error("stand-in: not() emulates is.null only"); keep.push((r) => r[c] != null); return q; },
        gte: (c, v) => { sb.bounds.push(v); keep.push((r) => r[c] != null && Date.parse(r[c]) >= Date.parse(v)); return q; },
        order: (c, o) => { ord = { c, asc: o?.ascending !== false }; return q; },
        limit: (n) => { lim = n; return q; },
        maybeSingle: async () => {
          if (sb.fail) return { data: null, error: { message: sb.fail } };
          let out = rows.filter((r) => keep.every((p) => p(r)));
          if (ord) out = [...out].sort((a, b) => (Date.parse(a[ord.c]) - Date.parse(b[ord.c])) * (ord.asc ? 1 : -1));
          return { data: out.slice(0, lim)[0] ?? null, error: null };
        },
      };
      return q;
    },
  };
  return sb;
}
const et = (s) => new Date(`${s}-04:00`);          // October: Eastern Daylight Time
const stop = (startsAt, extra = {}) => ({ starts_at: startsAt, status: "upcoming", archived_at: null, ...extra });
// Sunday Oct 11, 2026: WineXpress at 11:00am. Saturday Oct 17: the next stop.
const route = () => [stop("2026-10-11T15:00:00Z"), stop("2026-10-17T14:00:00Z")];
const day = async (rows, at) => (await D.nextDropDay(stopsTable(rows), at)).iso;

// ── the drop day itself ─────────────────────────────────────────────────────────────────────────
ok("before the stop starts, the board is today's drop", (await day(route(), et("2026-10-11T09:00:00"))) === "2026-10-11");
{
  const got = await day(route(), et("2026-10-11T11:30:00"));
  ok("half an hour into the stop, the board is STILL today's drop (it turned to Oct 17 the minute the stop began)", got === "2026-10-11", got);
}
{
  const got = await day(route(), et("2026-10-11T20:00:00"));
  ok("the evening after the stop, not marked done: still today's (no-shows to settle)", got === "2026-10-11", got);
}
{
  const got = await day(route(), et("2026-10-11T23:59:00"));
  ok("one minute before midnight: still today's", got === "2026-10-11", got);
}
ok("one minute after midnight: the next stop", (await day(route(), et("2026-10-12T00:01:00"))) === "2026-10-17");
ok("the next morning, yesterday's stop never marked done: the next stop",
  (await day(route(), et("2026-10-12T08:00:00"))) === "2026-10-17");
{
  const rows = route(); rows[0].status = "done";
  ok("today's stop marked done: the board moves on to the next one", (await day(rows, et("2026-10-11T14:00:00"))) === "2026-10-17");
}
{
  const rows = route(); rows[0].archived_at = "2026-10-11T16:00:00Z";
  ok("today's stop archived: the next one", (await day(rows, et("2026-10-11T12:00:00"))) === "2026-10-17");
}
{
  // 9pm ET is 1am UTC the next day: the drop is keyed by the ET day, never a UTC slice.
  const rows = [stop("2026-10-12T01:00:00Z"), stop("2026-10-17T14:00:00Z")];
  const got = await day(rows, et("2026-10-11T21:30:00"));
  ok("a 9pm stop, half an hour in: today's ET day, not tomorrow's UTC one", got === "2026-10-11", got);
}
{
  const sb = stopsTable(route());
  const r = await D.nextDropDay(sb, et("2026-10-11T11:30:00"));
  ok("from a stop: fromStop, its start as `at`, no error", r.fromStop === true && r.at.toISOString() === "2026-10-11T15:00:00.000Z" && r.error === null, r);
  ok("the query's lower bound is the start of today's ET day, not the clock",
    sb.bounds.length === 1 && sb.bounds[0] === "2026-10-11T04:00:00.000Z", sb.bounds);
}

// ── no stops on the route: this week's Saturday, today included ─────────────────────────────────
{
  const got = await day([], et("2026-10-15T12:00:00"));
  ok("Thursday after Wednesday's cutoff: THIS Saturday, whose packs are brewing (the ordering rule says next week's)", got === "2026-10-17", got);
}
{
  const got = await day([], et("2026-10-17T15:00:00"));
  ok("Saturday afternoon: today", got === "2026-10-17", got);
}
ok("Sunday: next Saturday", (await day([], et("2026-10-18T09:00:00"))) === "2026-10-24");
ok("Monday: this coming Saturday", (await day([], et("2026-10-12T09:00:00"))) === "2026-10-17");
{
  const r = await D.nextDropDay(stopsTable([]), et("2026-10-13T09:00:00"));
  ok("the cadence answer says it is not from a stop", r.fromStop === false && r.error === null, r);
}
{
  const sb = stopsTable(route()); sb.fail = "network down";
  const r = await D.nextDropDay(sb, et("2026-10-11T11:30:00"));
  ok("a failed read says so (the board keeps what it shows rather than switch to the cadence)", r.error === "network down" && r.fromStop === false, r);
}
ok("boardSaturday is today on a Saturday and never jumps a week", typeof D.boardSaturday === "function"
  && T.dayKey(D.boardSaturday(et("2026-10-17T23:00:00"))) === "2026-10-17"
  && T.dayKey(D.boardSaturday(et("2026-10-14T19:00:00"))) === "2026-10-17");

// ── the start of an ET day ──────────────────────────────────────────────────────────────────────
const starts = { "2026-10-11": "2026-10-11T04:00:00.000Z", "2026-12-01": "2026-12-01T05:00:00.000Z", "2026-03-08": "2026-03-08T05:00:00.000Z", "2026-11-01": "2026-11-01T04:00:00.000Z", "2027-01-01": "2027-01-01T05:00:00.000Z" };
for (const [k, want] of Object.entries(starts)) {
  const got = E.etDayStart(k);
  ok(`etDayStart ${k} is ${want}`, got.toISOString() === want, got.toISOString());
  ok(`etDayStart ${k} is that ET day, and a millisecond earlier is the day before`,
    T.etDayKey(got) === k && T.etDayKey(new Date(got.getTime() - 1)) === T.addDays(k, -1));
}

console.log(`dropday: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
