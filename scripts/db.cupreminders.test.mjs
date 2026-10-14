// 0394 — REMIND ME WHEN CUP ORDERS OPEN, executed from its file against the whole schema (every migration before it, in
// order: scripts/fixtures/schema.full.mjs), acting as each kind of person the way PostgREST does.
//
// The finding, as a sentence (R3 of the customer audit, board 04): with the truck off, Today now says when cup orders
// open — and "Remind me at 5:00am" needs something to send it at 5:00am. A stop's window opens by the clock, with
// nothing written anywhere, and the only customer push (the go-live ping, 0257) waits for the switch.
//
// The world is first made to look like production (the alert fan-out is a dashboard webhook called push_alerts_insert),
// so 0394 is seen to find its door by what it calls, not by a name. Pushes are counted at that door,
// supabase_functions.http_request: PGlite has no pg_net, so the stand-in records each call instead of making it.
// NOT MODELED: pg_cron (each run is the function called by hand), the push function (scripts/push.policy.test.mjs).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const F394 = "0394_remind_me_when_cup_orders_open.sql";
const SQL394 = readFileSync(join(ROOT, "supabase/migrations", F394), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const JORDAN = "0c394000-0000-4000-8000-0000000000a1", SAM = "0c394000-0000-4000-8000-0000000000a2";

const t0 = Date.now();
const db = await fullSchema({ before: "0394" });
console.log(`the schema before 0394 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  create table public.test_pushes (n bigserial primary key, tbl text, op text, trig text, row_id uuid, at timestamptz default now());
  create or replace function supabase_functions.http_request() returns trigger language plpgsql security definer as $$
  begin
    insert into public.test_pushes (tbl, op, trig, row_id) values (TG_TABLE_NAME, TG_OP, TG_NAME, new.id);
    return new;
  end $$;
`);
for (const [id, who] of [[JORDAN, "jordan"], [SAM, "sam"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${who}@example.test`]);
  await db.query(`update public.profiles set role = 'member', tenant_id = $2 where id = $1`, [id, T1]);
}
const stop = async (name, startsInH, extra = "") => (await q(`insert into public.stops (name, status, starts_at, ends_at)
  values ($1, 'upcoming', now() + interval '${startsInH} hours', now() + interval '${startsInH + 3} hours') returning id`, [name]))[0].id + extra;
const WX = await stop("WineXpress", 6), FF = await stop("Five Forks", 30), GONE = await stop("Archived", 6), OFF = await stop("Called off", 6);
await q(`update public.stops set archived_at = now() where id = $1`, [GONE]);
await q(`update public.stops set canceled_at = now(), archived_at = now(), cancel_reason = 'Rained out' where id = $1`, [OFF]);

// ── THE WORLD AS PRODUCTION HAS IT ───────────────────────────────────────────────────────────────────────────────────
const fanout = (await q(`select tgname from pg_trigger where tgrelid = 'public.alerts'::regclass and tgname in ('alerts_push_fanout', 'push_alerts_insert')`)).map((r) => r.tgname);
if (fanout.includes("alerts_push_fanout")) await db.exec(`alter trigger alerts_push_fanout on public.alerts rename to push_alerts_insert;`);
ok("production, as measured: the alert fan-out is push_alerts_insert", (await q(`select 1 from pg_trigger where tgname = 'push_alerts_insert'`)).length === 1);
ok("before 0394: there is nowhere to keep a reminder", /cup_reminders|keep_cup_reminder/.test((await as(JORDAN, `select public.keep_cup_reminder($1, now() + interval '1 hour')`, [WX])).error || ""));

await db.exec(SQL394);
const pushes = async () => (await q(`select tbl, op, trig from public.test_pushes where tbl = 'cup_reminders' order by n`));

// ── THE DOOR ─────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const t = await q(`select t.tgname, pg_get_triggerdef(t.oid) d from pg_trigger t where t.tgrelid = 'public.cup_reminders'::regclass and not t.tgisinternal`);
  const fan = await q1(`select pg_get_triggerdef(oid) d from pg_trigger where tgname = 'push_alerts_insert'`);
  const callOf = (d) => (/EXECUTE FUNCTION .*$/.exec(d ?? "") ?? [""])[0];
  // Names and booleans only in what this prints: a webhook's definition carries its address and its header.
  const facts = { one: t.length === 1, name: t[0]?.tgname === "cup_reminders_push", sameCall: callOf(t[0]?.d) === callOf(fan?.d) && callOf(fan?.d) !== "",
    onFired: /AFTER UPDATE OF fired_at/.test(t[0]?.d ?? ""), noAddressInFile: !/https?:\/\/|Bearer/i.test(SQL394.replace(/--.*$/gm, "")) };
  ok("the door is made from the fan-out's own call — the same function, the same arguments, no address or key in the file",
    Object.values(facts).every(Boolean), facts);
  ok("the minute's run is on the cron, every minute", (await q(`select schedule, command from cron.job where jobname = 'fire-cup-reminders'`)).map((r) => `${r.schedule}|${r.command}`).join() === "* * * * *|select public.fire_cup_reminders()");
}

// ── SET, READ, TAKE BACK ────────────────────────────────────────────────────────────────────────────────────────────
{
  const anon = await as(null, `select public.keep_cup_reminder($1, now() + interval '1 hour')`, [WX]);
  // 0394 revoked from public alone, and Supabase grants anon by name (scripts/fixtures/schema.full.mjs): so as 0394 left
  // it, the function's own check refuses the guest. 0401 takes the grant too (scripts/db.signedout.test.mjs).
  ok("a guest cannot keep one — it is a member's phone that is reminded",
    /permission denied|Sign in to be reminded/.test(anon.error || "") && !anon.rows.length, anon);
  const kept = await as(JORDAN, `select public.keep_cup_reminder($1, now() + interval '2 hours') t`, [WX]);
  ok("a member keeps one for a stop on the calendar, at the time its window opens", !kept.error && kept.rows[0]?.t instanceof Date, kept);
  const mine = await as(JORDAN, `select stop_id, fired_at from public.cup_reminders`);
  const theirs = await as(SAM, `select stop_id from public.cup_reminders`);
  ok("…and reads it back (the button says Reminder set); nobody else sees it", mine.rows.length === 1 && mine.rows[0].stop_id === WX && mine.rows[0].fired_at === null && theirs.rows.length === 0, { mine, theirs });
  const write = await as(JORDAN, `update public.cup_reminders set remind_at = now() where stop_id = $1`, [WX]);
  const ins = await as(JORDAN, `insert into public.cup_reminders (user_id, stop_id, remind_at) values ($1, $2, now())`, [JORDAN, FF]);
  ok("…but writes only through the functions that check the stop", /permission denied/.test(write.error || "") && /permission denied/.test(ins.error || ""), { write, ins });
  const archived = await as(JORDAN, `select public.keep_cup_reminder($1, now() + interval '1 hour')`, [GONE]);
  const called = await as(JORDAN, `select public.keep_cup_reminder($1, now() + interval '1 hour')`, [OFF]);
  ok("a stop archived or called off is refused, in words", /isn't on the calendar any more/.test(archived.error || "") && /isn't on the calendar any more/.test(called.error || ""), { archived, called });
  const late = await as(JORDAN, `select public.keep_cup_reminder($1, now() + interval '7 hours')`, [WX]);
  const past = await as(JORDAN, `select public.keep_cup_reminder($1, now() - interval '1 hour')`, [WX]);
  const far = await as(JORDAN, `select public.keep_cup_reminder($1, now() + interval '20 days')`, [FF]);
  ok("a time after the stop starts, an hour gone, or weeks out is refused — cup orders don't open then", [late, past, far].every((r) => /don't open then/.test(r.error || "")), { late, past, far });
  await as(JORDAN, `select public.keep_cup_reminder($1, now() + interval '25 hours')`, [FF]);
  const again = await as(JORDAN, `select public.keep_cup_reminder($1, now() + interval '3 hours') t`, [WX]);
  ok("keeping it again moves it — one reminder a stop, never two", !again.error && (await q(`select count(*)::int n from public.cup_reminders where user_id = $1`, [JORDAN]))[0].n === 2, again);
  const dropped = await as(JORDAN, `select public.drop_cup_reminder($1) d`, [FF]);
  const twice = await as(JORDAN, `select public.drop_cup_reminder($1) d`, [FF]);
  const notMine = await as(SAM, `select public.drop_cup_reminder($1) d`, [WX]);
  ok("taking it back removes it, says so once; nobody can take back someone else's", dropped.rows[0]?.d === true && twice.rows[0]?.d === false && notMine.rows[0]?.d === false
    && (await q(`select count(*)::int n from public.cup_reminders where user_id = $1`, [JORDAN]))[0].n === 1, { dropped, twice, notMine });
}

// ── THE MINUTE'S RUN ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const run = async () => Number((await q1(`select public.fire_cup_reminders() n`)).n);
  ok("nothing is due: nothing goes", (await run()) === 0 && (await pushes()).length === 0);
  // Jordan's WineXpress reminder comes due; Sam's for Five Forks was due 40 minutes ago (the cron was down); Sam's for
  // WineXpress is due, but the stop is then called off; an old one from last week.
  await q(`update public.cup_reminders set remind_at = now() - interval '1 minute' where user_id = $1 and stop_id = $2`, [JORDAN, WX]);
  await q(`insert into public.cup_reminders (user_id, stop_id, remind_at) values ($1, $2, now() - interval '40 minutes'), ($1, $3, now() - interval '1 minute')`, [SAM, FF, WX]);
  await q(`insert into public.cup_reminders (user_id, stop_id, remind_at, fired_at) values ($1, $2, now() - interval '8 days', now() - interval '8 days')`, [SAM, GONE]);
  const n = await run();
  const p = await pushes();
  ok("a reminder that has come due goes once, through the door — two today (Jordan's and Sam's for WineXpress)", n === 2 && p.length === 2 && p.every((x) => x.op === "UPDATE" && x.trig === "cup_reminders_push"), { n, p });
  ok("…one half an hour late is let go, not sent late", (await q1(`select fired_at from public.cup_reminders where user_id = $1 and stop_id = $2`, [SAM, FF])).fired_at === null);
  ok("…and a week-old one is cleared", (await q(`select 1 from public.cup_reminders where stop_id = $1`, [GONE])).length === 0);
  ok("the next minute sends nothing again", (await run()) === 0 && (await pushes()).length === 2);
  // A stop called off between the reminder and its time: not sent.
  await as(JORDAN, `select public.keep_cup_reminder($1, now() + interval '2 hours')`, [FF]);
  await q(`update public.cup_reminders set remind_at = now() - interval '1 minute' where user_id = $1 and stop_id = $2`, [JORDAN, FF]);
  await q(`update public.stops set canceled_at = now(), archived_at = now() where id = $1`, [FF]);
  ok("a stop called off after the reminder was set is not announced", (await run()) === 0 && (await pushes()).length === 2);
  const priv = await q(`select has_function_privilege('authenticated', 'public.fire_cup_reminders()', 'execute') a, has_function_privilege('anon', 'public.fire_cup_reminders()', 'execute') b`);
  ok("only the cron (and the owner's SQL editor) runs it — no app role", priv[0].a === false && priv[0].b === false, priv);
}

// ── A SECOND RUN ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  await db.exec(SQL394);
  ok("a second run changes nothing: one door, one job, one changelog line, rows kept",
    (await q(`select 1 from pg_trigger where tgname = 'cup_reminders_push'`)).length === 1 && (await q(`select 1 from cron.job where jobname = 'fire-cup-reminders'`)).length === 1
    && (await q(`select 1 from public.changelog where title = 'Today says what the truck is doing'`)).length === 1 && (await q(`select 1 from public.cup_reminders`)).length >= 2);
  ok("0394 is in the ledger", (await q(`select 1 from public.schema_migrations where version = '0394_remind_me_when_cup_orders_open'`)).length === 1);
}

// ── NO DOOR ──────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  await db.exec(`drop trigger cup_reminders_push on public.cup_reminders; drop trigger push_alerts_insert on public.alerts;`);
  let err = null;
  try { await db.exec(SQL394); } catch (e) { err = String(e.message || e); }
  ok("with no fan-out to copy, 0394 says so and makes no door — and fails nothing", err === null && (await q(`select 1 from pg_trigger where tgname = 'cup_reminders_push'`)).length === 0, err);
}

console.log(`\nREMIND ME WHEN CUP ORDERS OPEN (0394): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
