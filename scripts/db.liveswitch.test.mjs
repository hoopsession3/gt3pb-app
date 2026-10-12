// 0386 — A SWITCH WITH NO TRUCK BEHIND IT IS OFF, executed from its file against the whole schema (every migration before
// it, in order: scripts/fixtures/schema.full.mjs).
//
// The finding, as a sentence (C1 of the customer frontend audit): the live switch (live_status) names the stop the truck
// went live at, and only stamping that stop complete turned the switch off (0125) — archiving it or marking it done left
// the switch on with no stop behind it, and the app opened cup orders on it. Shown first on the schema as production
// has it. Then 0386: a switch already on at a closed-out stop goes off, once, and the crew's offline alert says so; the
// live stop leaving the road — archived, marked done, or stamped complete — takes the switch with it; any other stop's
// change leaves it alone; and a second run changes nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F386 = "0386_a_switch_with_no_truck_behind_it_is_off.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const t0 = Date.now();
const db = await fullSchema({ before: "0386" });
console.log(`the schema before 0386 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;

// Six made-up stops of the founding business, all on today's road.
const S = (n) => `0c386000-0000-4000-8000-00000000000${n}`;
for (let n = 1; n <= 6; n++) {
  await q(`insert into public.stops (id, name, starts_at, status) values ($1, $2, now() - interval '1 hour', 'upcoming')`, [S(n), `Made-up stop ${n}`]);
}
const goLive = async (stop) => {
  await q(`insert into public.live_status (id, is_live, current_stop_id) values (1, true, $1)
           on conflict (id) do update set is_live = true, current_stop_id = excluded.current_stop_id`, [stop]);
};
const sw = async () => (await q(`select is_live, current_stop_id from public.live_status where id = 1`))[0];
const offline = async () => (await q(`select count(*)::int n from public.alerts where title = 'Truck went offline'`))[0].n;

// ── BEFORE 0386: archiving or marking done leaves the switch on ─────────────────────────────────
{
  await goLive(S(1));
  await q(`update public.stops set archived_at = now() where id = $1`, [S(1)]);
  const a = await sw();
  ok("before 0386: archiving the live stop leaves the switch on, naming it", a.is_live === true && a.current_stop_id === S(1), a);
  await goLive(S(2));
  await q(`update public.stops set status = 'done' where id = $1`, [S(2)]);
  const d = await sw();
  ok("before 0386: marking it done leaves the switch on too", d.is_live === true && d.current_stop_id === S(2), d);
  await goLive(S(1));   // the state production can be in: on, at a stop archived outside Live Ops
}

// ── 0386 ───────────────────────────────────────────────────────────────────────────────────────
const alertsBefore = await offline();
await db.exec(MIG(F386));
{
  const a = await sw();
  ok("0386: a switch on at a stop already archived is turned off, its stop cleared", a.is_live === false && a.current_stop_id === null, a);
  ok("0386: the crew's offline alert says so, once (0052)", (await offline()) === alertsBefore + 1, await offline());
}

// After 0386 — the live stop leaving the road takes the switch with it, however it left.
for (const [stop, how, sql] of [
  [S(3), "archived", `update public.stops set archived_at = now() where id = $1`],
  [S(4), "marked done", `update public.stops set status = 'done' where id = $1`],
  [S(5), "stamped complete", `update public.stops set completed_at = now() where id = $1`],
]) {
  await goLive(stop);
  const before = await offline();
  await q(sql, [stop]);
  const a = await sw();
  ok(`after 0386: the live stop ${how} turns the switch off and clears its stop`, a.is_live === false && a.current_stop_id === null, a);
  ok(`after 0386: …and the offline alert fires for it (${how})`, (await offline()) === before + 1, await offline());
}
{
  const st = (await q(`select status from public.stops where id = $1`, [S(5)]))[0].status;
  ok("after 0386: completing a stop still marks it done, as 0125 did", st === "done", st);
}

// Anything else leaves the switch alone.
{
  await goLive(S(6));
  await q(`update public.stops set archived_at = now() where id = $1`, [S(2)]);   // another stop, closed out
  await q(`update public.stops set name = 'Made-up stop 6, renamed' where id = $1`, [S(6)]);   // the live one, edited
  const a = await sw();
  ok("after 0386: closing out another stop, or editing the live one, leaves the switch on", a.is_live === true && a.current_stop_id === S(6), a);
}

// A second run, the ledger.
{
  const before = await offline();
  await db.exec(MIG(F386));
  const a = await sw();
  ok("a second run changes nothing: the switch at an open stop stays on, and no alert", a.is_live === true && a.current_stop_id === S(6) && (await offline()) === before, { a, alerts: await offline() });
  const line = (await q(`select count(*)::int n from public.changelog where title = 'The truck reads live only while it is there'`))[0].n;
  ok("its changelog line is written once", line === 1, line);
  const rec = (await q(`select count(*)::int n from public.schema_migrations where version = '0386_a_switch_with_no_truck_behind_it_is_off'`))[0].n;
  ok("0386 records itself in the ledger", rec >= 1, rec);
  const trig = (await q(`select count(*)::int n from pg_trigger where tgname = 'stops_completion_sync' and not tgisinternal`))[0].n;
  ok("the trigger is the one 0125 made — one of it", trig === 1, trig);
}

console.log(`db.liveswitch: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
