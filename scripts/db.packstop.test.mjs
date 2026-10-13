// 0397 — A PACK BELONGS TO ITS STOP, AND CLOSES WHEN ITS STOP SAYS. Executed from its file against the whole schema (every
// migration before it, in order: scripts/fixtures/schema.full.mjs), acting as a member and an owner the way PostgREST does.
//
// The finding, as a sentence (R5 of the customer audit): a pack recorded only its day, so its stop was guessed — Move and
// Change refused the customers a canceled stop's text told to move their pack, a rescheduled stop left its packs behind,
// and the member's own cancel had no time or stage check at all.
//
// What it proves: the backfill links each pack to its day's stop (the first on the schedule still taking packs, else
// its first, else the one called off — never one archived without being called off); a
// new pack and a moved one are linked by the trigger, and a pack that moves WITH its stop keeps it; pack_closes_at is the
// one rule (24 hours before the stop; never, for a stop called off; three days before at 6pm Eastern with no stop); the
// member's cancel refuses a closed or started pack and changes nothing, takes an open one, and raises the refund alert
// for a paid one as before; a stop moved to another day takes its packs and tells the crew; cancel_stop counts the stop's
// own packs; and a second run changes nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL397 = readFileSync(join(ROOT, "supabase/migrations/0397_a_pack_belongs_to_its_stop.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c397000-0000-4000-8000-0000000000c1", SAM = "0c397000-0000-4000-8000-0000000000a2";

const t0 = Date.now();
const db = await fullSchema({ before: "0397" });
console.log(`the schema before 0397 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role; grant select on all tables in schema public to anon, authenticated;`);
for (const [id, role] of [[OWNER, "owner"], [SAM, "member"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}

// A made-up week, relative to now: day D (five days out) has two stops — WineXpress 7am, Five Forks 1pm; D+1 has one;
// D-1 had one that was called off; D+3 has none. And a stop ten hours from now, inside its 24-hour close.
const D = `(date_trunc('day', now() at time zone 'America/New_York') + interval '5 days')`;
const at = (plusDays, h) => `((${D} + interval '${plusDays} days' + interval '${h} hours') at time zone 'America/New_York')`;
const stop = async (name, plusDays, h) => (await q1(`insert into public.stops (name, status, starts_at, ends_at)
  values ($1, 'upcoming', ${at(plusDays, h)}, ${at(plusDays, h + 3)}) returning id`, [name])).id;
const WX = await stop("WineXpress", 0, 7), FF = await stop("Five Forks", 0, 13), NEXT = await stop("Next day", 1, 9), OFF = await stop("Called off", -1, 9);
await q(`update public.stops set canceled_at = now(), archived_at = now() where id = $1`, [OFF]);
const SOON = (await q1(`insert into public.stops (name, status, starts_at, ends_at) values ('Soon', 'upcoming', now() + interval '10 hours', now() + interval '13 hours') returning id`)).id;
const dayOf = async (id) => (await q1(`select to_char((starts_at at time zone 'America/New_York')::date, 'YYYY-MM-DD') d from public.stops where id = $1`, [id])).d;
const pack = async (day, extra = {}) => (await q1(`insert into public.drop_orders (user_id, name, size, glass, mix, total_cents, drop_date, paid, stage)
  values ($1, 'Sam Lee', 6, 'return', '{"RISE":6}', $3, $2::date, $4, $5) returning id`, [SAM, day, extra.cents ?? 3000, extra.paid ?? false, extra.stage ?? "reserved"])).id;
const DAY0 = await dayOf(WX), DAY1 = await dayOf(NEXT), DAYOFF = await dayOf(OFF), DAYSOON = await dayOf(SOON);
const DAY3 = (await q1(`select to_char((${D} + interval '3 days')::date, 'YYYY-MM-DD') d`)).d;
const P0 = await pack(DAY0), POFF = await pack(DAYOFF), P3 = await pack(DAY3);
// A stop the crew took off the schedule without calling it off (LiveControl's Archive) is no pack's stop: a day with one
// such stop and one on the schedule, and a day with only the archived one.
const ARCH = await stop("Archived, not called off", 6, 9), KEPT = await stop("On the schedule", 6, 11), ARCHONLY = await stop("Only archived", 7, 9);
await q(`update public.stops set archived_at = now() where id = any($1::uuid[])`, [[ARCH, ARCHONLY]]);
const PARCH = await pack(await dayOf(ARCH)), PARCHONLY = await pack(await dayOf(ARCHONLY));
// A day whose first stop has closed and whose second still takes packs: tomorrow (Eastern), one stop halfway between its
// midnight and this time tomorrow (closed — under 24 hours away), one halfway between this time tomorrow and its end.
const TW = await q1(`select to_char(x.d, 'YYYY-MM-DD') d, (y.m + (x.t - y.m) / 2)::text t1, (x.t + (y.e - x.t) / 2)::text t2
  from (select ((now() + interval '24 hours') at time zone 'America/New_York')::date d, now() + interval '24 hours' t) x,
  lateral (select (x.d::timestamp at time zone 'America/New_York') m, ((x.d + 1)::timestamp at time zone 'America/New_York') e) y`);
const stopAt = async (name, at) => (await q1(`insert into public.stops (name, status, starts_at, ends_at) values ($1, 'upcoming', $2::timestamptz, $2::timestamptz + interval '1 hour') returning id`, [name, at])).id;
const SHUT = await stopAt("Closed first", TW.t1), TAKING = await stopAt("Still taking packs", TW.t2);
const PTW = await pack(TW.d);
const stopOf = async (id) => (await q1(`select stop_id from public.drop_orders where id = $1`, [id])).stop_id;

ok("before 0397: a pack has no stop", (await q(`select 1 from information_schema.columns where table_name = 'drop_orders' and column_name = 'stop_id'`)).length === 0);
await db.exec(SQL397);

// ── the link ───────────────────────────────────────────────────────────────────────────────────────────────────────
ok("backfill: a pack is linked to its day's first stop not called off", (await stopOf(P0)) === WX);
ok("backfill: a day whose only stop was called off keeps that stop — so the pack knows it was called off", (await stopOf(POFF)) === OFF);
ok("backfill: a day with no stop leaves none", (await stopOf(P3)) === null);
ok("backfill: a stop archived without being called off is never a pack's — the day's stop on the schedule is",
  (await stopOf(PARCH)) === KEPT && (await stopOf(PARCHONLY)) === null, [await stopOf(PARCH), await stopOf(PARCHONLY)]);
ok("backfill: a day whose first stop has closed links the stop still taking packs", (await stopOf(PTW)) === TAKING, [TW, await stopOf(PTW)]);
ok("a new pack for that day, no stop named (an app from before R5), takes the stop still taking packs — not the closed one",
  (await stopOf(await pack(TW.d))) === TAKING && SHUT !== TAKING);
const PNEW = await pack(DAY1);
ok("a new pack with no stop named takes its day's first open stop", (await stopOf(PNEW)) === NEXT);
await q(`update public.drop_orders set drop_date = $2::date where id = $1`, [P0, DAY1]);
ok("a pack moved to a day its stop is not on is relinked to that day's stop", (await stopOf(P0)) === NEXT);
await q(`update public.drop_orders set drop_date = $2::date, stop_id = $3 where id = $1`, [P0, DAY0, FF]);
ok("…and a writer that names the stop keeps the one it named (Five Forks, not the day's first)", (await stopOf(P0)) === FF);

// ── THE rule ───────────────────────────────────────────────────────────────────────────────────────────────────────
const closes = async (day, stopId) => (await q1(`select public.pack_closes_at($1::date, $2) c`, [day, stopId])).c;
const wxStart = (await q1(`select starts_at from public.stops where id = $1`, [WX])).starts_at;
ok("pack_closes_at: 24 hours before its stop", new Date(await closes(DAY0, WX)).getTime() === new Date(wxStart).getTime() - 24 * 3600e3);
ok("pack_closes_at: a stop called off never closes it", (await closes(DAYOFF, OFF)) === null);
const sat = await closes(DAY3, null), expect = (await q1(`select ((($1::date - 3)::timestamp + time '18:00') at time zone 'America/New_York') e`, [DAY3])).e;
ok("pack_closes_at: no stop — three days before at 6pm Eastern", new Date(sat).getTime() === new Date(expect).getTime() && new Date(sat).toISOString().endsWith(":00:00.000Z"), [sat, expect]);
ok("pack_closes_at: a member may ask it; anon may not", (await as(SAM, `select public.pack_closes_at($1::date, $2) c`, [DAY0, WX])).error === null
  && /permission denied/.test((await as(null, `select public.pack_closes_at($1::date, $2) c`, [DAY0, WX])).error || ""));

// ── a member's own cancel ──────────────────────────────────────────────────────────────────────────────────────────
const cancel = async (id) => (await as(SAM, `select public.cancel_own_reservation($1) r`, [id])).rows[0]?.r;
const canceled = async (id) => (await q1(`select canceled_at from public.drop_orders where id = $1`, [id])).canceled_at !== null;
const PSOON = await pack(DAYSOON); await q(`update public.drop_orders set stop_id = $2 where id = $1`, [PSOON, SOON]);
ok("cancel: a pack whose stop is ten hours away is closed — refused, and nothing changes", (await cancel(PSOON)) === false && !(await canceled(PSOON)));
const PPREP = await pack(DAY1, { stage: "preparing" });
ok("cancel: a pack the crew is preparing is theirs — refused, and nothing changes", (await cancel(PPREP)) === false && !(await canceled(PPREP)));
ok("cancel: a pack for a stop called off stays open — taken", (await cancel(POFF)) === true && (await canceled(POFF)));
const SOONOFF = (await q1(`insert into public.stops (name, status, starts_at, ends_at, canceled_at, archived_at) values ('Soon, called off', 'upcoming', now() + interval '10 hours', now() + interval '13 hours', now(), now()) returning id`)).id;
const PSOONOFF = await pack(DAYSOON); await q(`update public.drop_orders set stop_id = $2 where id = $1`, [PSOONOFF, SOONOFF]);
ok("cancel: …even ten hours before it would have started — the truck isn't coming, so it never closed", (await cancel(PSOONOFF)) === true && (await canceled(PSOONOFF)));
const PAID = await pack(DAY1, { paid: true, cents: 4200 });
const before = (await q1(`select count(*)::int n from public.alerts where title = 'Member canceled a PAID reservation — refund needed'`)).n;
ok("cancel: an open, paid pack is canceled and the crew are told to refund it, as before",
  (await cancel(PAID)) === true && (await q1(`select count(*)::int n from public.alerts where title = 'Member canceled a PAID reservation — refund needed'`)).n === before + 1);
ok("cancel: a second cancel says no", (await cancel(PAID)) === false);

// ── a stop moved to another day takes its packs ────────────────────────────────────────────────────────────────────
const PN2 = await pack(DAY1);
await q(`update public.stops set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = $1`, [NEXT]);
const DAY2 = await dayOf(NEXT);
const moved = await q1(`select to_char(drop_date, 'YYYY-MM-DD') d, stop_id from public.drop_orders where id = $1`, [PN2]);
ok("a stop moved to another day takes its packs, still linked to it", moved.d === DAY2 && moved.stop_id === NEXT, moved);
ok("…a canceled or prepared pack keeps its day", (await q1(`select to_char(drop_date, 'YYYY-MM-DD') d from public.drop_orders where id = $1`, [PAID])).d === DAY1);
ok("…and the crew hear how many moved", (await q(`select body from public.alerts where title = 'Packs moved with their stop'`)).some((a) => /^\d+ packs? for Next day moved from /.test(a.body)));

// ── a stop called off counts its own packs ─────────────────────────────────────────────────────────────────────────
const PFF = await pack(DAY0); await q(`update public.drop_orders set stop_id = $2 where id = $1`, [PFF, FF]);
const ff = (await as(OWNER, `select public.cancel_stop($1, 'Rained out') c`, [FF])).rows[0]?.c;
ok("cancel_stop: Five Forks counts its own packs, not WineXpress's that day", ff?.packs === 2 && ff.other_stop_that_day === true, ff);

// ── a second run ───────────────────────────────────────────────────────────────────────────────────────────────────
const links = await q(`select id, stop_id from public.drop_orders order by id`);
await db.exec(SQL397);
const again = await q(`select id, stop_id from public.drop_orders order by id`);
ok("a second run changes nothing: the links stay, one changelog entry, one ledger row",
  JSON.stringify(links) === JSON.stringify(again)
  && (await q1(`select count(*)::int n from public.changelog where title = 'A pack knows its stop'`)).n === 1
  && (await q1(`select count(*)::int n from public.schema_migrations where version = '0397_a_pack_belongs_to_its_stop'`)).n === 1);

console.log(`A PACK BELONGS TO ITS STOP (0397): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
