// 0380 — THE ESCALATION FINDS THE ALERT PUSH BY WHAT IT CALLS (2026-10-11), executed from its file against the whole
// schema (every migration before it, in order: scripts/fixtures/schema.full.mjs).
//
// The finding, as a sentence: 0373 made its escalation trigger from 0157's fan-out, found by name (alerts_push_fanout),
// and production's fan-out is a dashboard Database Webhook called push_alerts_insert. So on production 0373 made no
// trigger, and its cron job marks a critical nobody picks up as escalated with no way to send it — once, for good.
//
// The world is first made to look like production as measured after the apply (names only: alerts_fold_repeats,
// push_alerts_insert, stamp_tenant_tg, no alerts_push_escalation), the defect shown in it, then 0380 applied.
// Pushes are counted at the one door they all go through, supabase_functions.http_request: PGlite has no pg_net, so
// the stand-in records each call (the alert, INSERT or UPDATE, and which trigger) instead of making it.
// NOT MODELED: pg_cron (each run is the function called by hand), the push function (scripts/push.policy.test.mjs).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F373 = "0373_a_critical_nobody_picks_up_rings_the_owners_again.sql";
const F380 = "0380_the_escalation_finds_the_alert_push_by_what_it_calls.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const SUBJ = (n) => `0e5c0000-0000-4000-8000-00000000000${n}`;

const t0 = Date.now();
const db = await fullSchema({ before: "0380" });
console.log(`the schema before 0380 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const num = async (s, p) => Number(Object.values((await q1(s, p)) ?? { n: NaN })[0]);

await db.exec(`
  create table public.test_pushes (n bigserial primary key, alert_id uuid, op text, trig text, at timestamptz default now());
  create or replace function supabase_functions.http_request() returns trigger language plpgsql security definer as $$
  begin
    if TG_TABLE_NAME = 'alerts' then insert into public.test_pushes (alert_id, op, trig) values (new.id, TG_OP, TG_NAME); end if;
    return new;
  end $$;
`);

const triggers = () => q(`select tgname, pg_get_triggerdef(oid) d from pg_trigger
  where tgrelid = 'public.alerts'::regclass and not tgisinternal and tgname in ('alerts_push_fanout', 'push_alerts_insert', 'alerts_push_escalation') order by tgname`);
const callOf = (d) => (/EXECUTE FUNCTION .*$/.exec(d ?? "") ?? [""])[0];
const raise = async (n, extra = "") => (await q1(`insert into public.alerts (severity, category, kind, subject_id, title, body, link, tenant_id)
  values ('critical', 'order', 'refund_needed', $1, $2, 'made-up body', '/crew', '${T1}') returning id`, [SUBJ(n), `Made-up critical ${n}${extra}`])).id;
const row = (id) => q1(`select escalated_at, ack_at, created_at from public.alerts where id = $1`, [id]);
const esc = () => num(`select public.escalate_unacked_criticals() n`);
const escPushes = (id) => num(`select count(*) n from public.test_pushes where alert_id = $1 and op = 'UPDATE' and trig = 'alerts_push_escalation'`, [id]);

// ── THE WORLD AS PRODUCTION HAS IT ───────────────────────────────────────────────────────────────────────────────────
ok("built from the migrations, 0373 made its trigger from 0157's fan-out", (await triggers()).map((t) => t.tgname).join() === "alerts_push_escalation,alerts_push_fanout");
await db.exec(`drop trigger alerts_push_escalation on public.alerts;
               alter trigger alerts_push_fanout on public.alerts rename to push_alerts_insert;`);
ok("production, as measured: the fan-out is push_alerts_insert, and there is no escalation trigger", (await triggers()).map((t) => t.tgname).join() === "push_alerts_insert");
await db.exec(MIG(F373));
ok("the defect: 0373 run again there finds no alerts_push_fanout and makes nothing", (await triggers()).map((t) => t.tgname).join() === "push_alerts_insert");

const since = (await q1(`select applied_at from public.schema_migrations where version = '0373_a_critical_nobody_picks_up_rings_the_owners_again'`)).applied_at;
ok("0373 is in the ledger, with the time it was recorded", since instanceof Date, since);

// A: a team critical nobody has picked up, fifteen minutes old — marked by the cron with no door.
const A = await raise(1);
await db.query(`update public.alerts set created_at = now() - interval '15 minutes' where id = $1`, [A]);
const marked = await esc();
ok("the defect: the cron marks it escalated…", marked === 1 && (await row(A)).escalated_at !== null, marked);
ok("…and nothing is sent: there is no door", (await escPushes(A)) === 0);
ok("…and it is never marked again", (await esc()) === 0 && (await escPushes(A)) === 0);
// B: marked, then acknowledged. C: marked, but raised thirteen hours ago (outside 0373's window). D: marked before 0373.
const B = await raise(2);
await db.query(`update public.alerts set created_at = now() - interval '20 minutes', escalated_at = now(), ack_at = now() where id = $1`, [B]);
const C = await raise(3);
await db.query(`update public.alerts set created_at = now() - interval '13 hours', escalated_at = now() where id = $1`, [C]);
const D = await raise(4);
await db.query(`update public.alerts set created_at = now() - interval '2 hours', escalated_at = $2::timestamptz - interval '1 minute' where id = $1`, [D, since]);
const before = { B: await row(B), C: await row(C), D: await row(D) };

// ── 0380 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(MIG(F380));
{
  const t = await triggers();
  const door = t.find((x) => x.tgname === "push_alerts_insert"), escT = t.find((x) => x.tgname === "alerts_push_escalation");
  ok("0380: an escalation trigger now exists", Boolean(escT), t.map((x) => x.tgname));
  ok("0380: …calling exactly what push_alerts_insert calls — the same function, the same arguments, read from the database",
    callOf(escT?.d) !== "" && callOf(escT?.d) === callOf(door?.d));
  ok("0380: …on an update of escalated_at, from nothing to a time, of an unacknowledged critical that is not a device test",
    /AFTER UPDATE OF escalated_at ON public\.alerts FOR EACH ROW WHEN \(\(\(old\.escalated_at IS NULL\) AND \(new\.escalated_at IS NOT NULL\) AND \(new\.severity = 'critical'::text\) AND \(new\.ack_at IS NULL\) AND \(new\.kind IS DISTINCT FROM 'device_test'::text\)\)\)/.test(escT?.d ?? ""), escT?.d);
}
ok("0380: the critical marked with no door is unmarked, so the next run sends it", (await row(A)).escalated_at === null);
ok("0380: …but not one already acknowledged", String((await row(B)).escalated_at) === String(before.B.escalated_at));
ok("0380: …nor one raised more than twelve hours ago", String((await row(C)).escalated_at) === String(before.C.escalated_at));
ok("0380: …nor one marked before 0373 existed", String((await row(D)).escalated_at) === String(before.D.escalated_at));
{
  const n = await esc();
  ok("the next run marks it again — and this time it is sent, once, through the door", n === 1 && (await escPushes(A)) === 1, { n, pushes: await escPushes(A) });
  ok("…and never again", (await esc()) === 0 && (await escPushes(A)) === 1);
}
{
  const p = await num(`select count(*) n from public.test_pushes`);
  await db.exec(MIG(F380));
  const t = await triggers();
  ok("0380 run twice: still one escalation trigger, still the same call", t.filter((x) => x.tgname === "alerts_push_escalation").length === 1
    && callOf(t.find((x) => x.tgname === "alerts_push_escalation")?.d) === callOf(t.find((x) => x.tgname === "push_alerts_insert")?.d));
  ok("0380 run twice: nothing is unmarked the second time, and nothing is sent", (await row(A)).escalated_at !== null && (await num(`select count(*) n from public.test_pushes`)) === p);
}

// ── WHERE BOTH NAMES EXIST, 0157'S IS THE DOOR ─────────────────────────────────────────────────────────────────────
await db.query(`update public.alerts set ack_at = now() where id = $1`, [A]);
await db.exec(`drop trigger alerts_push_escalation on public.alerts;
  alter trigger push_alerts_insert on public.alerts rename to alerts_push_fanout;
  create trigger push_alerts_insert after insert on public.alerts for each row
    execute function supabase_functions.http_request('https://made-up.example.test/other', 'POST', '{}', '{}', '1000');`);
await db.exec(MIG(F380));
{
  const t = await triggers();
  ok("with alerts_push_fanout and another webhook both on alerts, the escalation copies 0157's",
    callOf(t.find((x) => x.tgname === "alerts_push_escalation")?.d) === callOf(t.find((x) => x.tgname === "alerts_push_fanout")?.d)
    && callOf(t.find((x) => x.tgname === "alerts_push_escalation")?.d) !== callOf(t.find((x) => x.tgname === "push_alerts_insert")?.d), t.map((x) => x.tgname));
}

// ── NO DOOR AT ALL ─────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(`drop trigger alerts_push_escalation on public.alerts; drop trigger alerts_push_fanout on public.alerts; drop trigger push_alerts_insert on public.alerts;`);
ok("with nothing handing alerts to the push function, 0380 runs without error…", await db.exec(MIG(F380)).then(() => true, () => false));
ok("…and makes nothing", (await triggers()).length === 0);

ok("0380 records itself by its own name",
  (await q(`select 1 from public.schema_migrations where version = '0380_the_escalation_finds_the_alert_push_by_what_it_calls'`)).length === 1);

console.log(`0380 (the escalation's door): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
