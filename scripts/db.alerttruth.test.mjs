// 0383 — THE ALERTS TELL THE TRUTH (2026-10-12, release 1), executed from its file against the whole schema (every
// migration before it, in order: scripts/fixtures/schema.full.mjs), acting as each kind of person the way PostgREST does.
//
//   1  a finished task's alerts clear themselves — done anywhere, deleted, given to someone else, its date pushed out —
//      and a late task shows one line, not its assigned line and its past-due line side by side
//   2  "Got it" on a team alert is a claim everyone who can see the alert sees ("<first name> has it"), the escalation
//      counts the claim and nothing else, and nobody's reads are shown to anybody
//
// Each defect is shown first on the schema as production has it, then fixed, then everything that must keep working is
// run. Pushes are counted at the one door they all go through: supabase_functions.http_request, the trigger function
// 0157 calls (and 0373 calls again). PGlite has no pg_net, so the stand-in records each call — the alert, INSERT or
// UPDATE, and which trigger — instead of making it.
//
// MODELED from production as measured: Supabase's default grants (every table in public to anon and authenticated —
// RLS is what stands between them and the rows — and every new function executable by both, 0366/0367), with 0378's
// column grant on alerts (a signed-in person may write ack_at and ack_by, nothing else).
// NOT MODELED: the push function itself (Deno, the network — scripts/push.policy.test.mjs); pg_cron (each run is the
// function called by hand); Realtime (it asks the same SELECT policies tested here).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F383 = "0383_the_alerts_tell_the_truth.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001", T2 = "0a1e7800-0000-4000-8000-0000000000f2";
const OWNER = "0a1e7800-0000-4000-8000-0000000000a1", MANAGER = "0a1e7800-0000-4000-8000-0000000000a3",
  SAM = "0a1e7800-0000-4000-8000-0000000000a4", BEA = "0a1e7800-0000-4000-8000-0000000000a5",
  MEMBER = "0a1e7800-0000-4000-8000-0000000000a6", OTHER = "0a1e7800-0000-4000-8000-0000000000b1";

const t0 = Date.now();
const db = await fullSchema({ before: "0383" });
console.log(`the schema before 0383 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const num = async (s, p) => Number(Object.values((await q1(s, p)) ?? { n: NaN })[0]);
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
// As a person, through PostgREST's roles: { rows, error, code }. role "service_role" acts as the server.
const as = async (uid, sql, params, role) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${role ?? (uid ? "authenticated" : "anon")};`);
  try { return { rows: (await db.query(sql, params)).rows, error: null, code: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null }; }
  finally { await root(); }
};

// ── the world ────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(`
  -- Supabase's own defaults, as production has them (0366/0367 measured the function half): RLS is the only guard.
  grant usage on schema public to anon, authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  -- 0378, as production has it: on alerts a signed-in person writes "Got it" (ack_at, ack_by) and nothing else.
  revoke update on table public.alerts from anon, authenticated;
  grant update (ack_at, ack_by) on table public.alerts to authenticated;

  -- The door every push goes through, recorded instead of called.
  create table public.test_pushes (n bigserial primary key, alert_id uuid, op text, trig text, at timestamptz default now());
  create or replace function supabase_functions.http_request() returns trigger language plpgsql security definer as $$
  begin
    if TG_TABLE_NAME = 'alerts' then insert into public.test_pushes (alert_id, op, trig) values (new.id, TG_OP, TG_NAME); end if;
    return new;
  end $$;
`);
await db.exec(`begin; set local gt3.allow_second_tenant = 'on';
  insert into public.tenants (id, slug, name) values ('${T2}', 'other-bar', 'Another Bar'); commit;`);
for (const [id, role, tenant, name] of [[OWNER, "owner", T1, "Olive Owner"], [MANAGER, "event_manager", T1, "Max Manager"],
  [SAM, "server", T1, "Sam Server"], [BEA, "server", T1, "Bea Barista"], [MEMBER, "member", T1, "Mo Member"], [OTHER, "owner", T2, "Otto Other"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, tenant, name]);
}
const EVENT = (await q1(`insert into public.events (title, tenant_id) values ('Made-up market day', $1) returning id`, [T1])).id;

const pushes = () => num(`select count(*) n from public.test_pushes`);
// A task on the event's prep list, as the crew's screens write one.
const task = async (label, assignee, due = null) => (await q1(`insert into public.event_tasks (event_id, label, kind, assignee, due_at, tenant_id)
  values ($1, $2, 'task', $3, $4, $5) returning id`, [EVENT, label, assignee, due, T1])).id;
// "Assigned to you" as app/crew/page.tsx raises it: the assigner, signed in, through the API — critical, the task's id.
const assigned = async (taskId, to, by = MANAGER, title = "Max assigned you: made-up task") => {
  const r = await as(by, `insert into public.alerts (severity, category, kind, subject_id, title, target_user_id, created_by)
    values ('critical', 'task', 'task_assigned', $1, $2, $3, $4)`, [taskId, title, to, by]);
  if (r.error) throw new Error(`raising task_assigned: ${r.error}`);
};
const lines = (taskId) => q(`select id, kind, severity, target_user_id, ack_at, ack_by, occurrences, created_at
  from public.alerts where subject_id = $1 and kind in ('task_assigned', 'task_due') order by created_at, id`, [taskId]);
const open = async (taskId) => (await lines(taskId)).filter((l) => l.ack_at === null);
const openFor = async (taskId, who) => (await open(taskId)).filter((l) => l.target_user_id === who);
const sweep = () => db.exec(`select public.task_due_alerts()`);                 // the cron, every ten minutes
const byMechanism = (ls) => ls.length > 0 && ls.every((l) => l.ack_at !== null && l.ack_by === null);
const PAST = () => new Date(Date.now() - 2 * 3600_000).toISOString(), FUTURE = () => new Date(Date.now() + 2 * 86400_000).toISOString();

// A team critical as the server raises one (service role: no target, the business's own), each about its own subject.
const teamCritical = async (title = "Voided a PAID order — refund needed", kind = "refund_needed") =>
  (await q1(`insert into public.alerts (severity, category, kind, subject_id, title, link, tenant_id)
    values ('critical', 'money', $1, gen_random_uuid(), $2, '/crew', $3) returning id`, [kind, title, T1])).id;
// "Got it" on a team alert, as lib/useMyAlerts writes it: the person's own read. Taken back is its Undo.
const gotIt = (uid, id) => as(uid, `insert into public.alert_reads (alert_id, user_id) values ($1, $2) returning alert_id`, [id, uid]);
const takeBack = (uid, id) => as(uid, `delete from public.alert_reads where user_id = $1 and alert_id = $2 returning alert_id`, [uid, id]);
const age = (id, by) => db.query(`update public.alerts set created_at = created_at - $2::interval where id = $1`, [id, by]);
const esc = () => num(`select public.escalate_unacked_criticals() n`);                  // the cron, every minute
const escPushes = (id) => num(`select count(*) n from public.test_pushes where alert_id = $1 and op = 'UPDATE' and trig = 'alerts_push_escalation'`, [id]);
const claimOf = (id) => q1(`select claimed_by, claimed_at, escalated_at, ack_at from public.alerts where id = $1`, [id]);
const namesFor = (uid, ids) => as(uid, `select alert_id, first_name from public.alert_claimants($1::uuid[]) order by alert_id`, [ids]);

// ── BEFORE 0383: the defects, on the schema as production has it ─────────────────────────────────────────────────
const old = {};
{
  // Done elsewhere: Sam ticks it off on the prep list (or My Tasks, or the task sheet) — not from the alert.
  old.done = await task("Made-up: ice run", SAM);
  await assigned(old.done, SAM);
  const d = await as(SAM, `update public.event_tasks set done = true, done_by = $2, done_at = now() where id = $1 returning id`, [old.done, SAM]);
  ok("before 0383: Sam marks a task done from the prep list, through the API", !d.error && d.rows.length === 1, d.error);
  ok("before 0383: …and its \"assigned to you\" line stays open, critical, in Sam's inbox", (await openFor(old.done, SAM)).length === 1, await lines(old.done));

  // Deleted.
  old.gone = await task("Made-up: borrow the tent", SAM);
  await assigned(old.gone, SAM);
  const g = await as(OWNER, `delete from public.event_tasks where id = $1 returning id`, [old.gone]);
  ok("before 0383: the owner deletes a task (event_tasks delete is an admin's, 0025)", !g.error && g.rows.length === 1, g.error);
  ok("before 0383: …and its line stays open — about a task that no longer exists", (await openFor(old.gone, SAM)).length === 1);

  // Given to someone else.
  old.moved = await task("Made-up: call the county", SAM);
  await assigned(old.moved, SAM);
  await as(MANAGER, `update public.event_tasks set assignee = $2 where id = $1`, [old.moved, BEA]);
  await assigned(old.moved, BEA);
  ok("before 0383: a task given from Sam to Bea leaves Sam's line open beside Bea's",
    (await openFor(old.moved, SAM)).length === 1 && (await openFor(old.moved, BEA)).length === 1, await lines(old.moved));

  // Late: assigned, then past due — two lines for one task.
  old.late = await task("Made-up: order cups", SAM, PAST());
  await assigned(old.late, SAM);
  const p0 = await pushes();
  await sweep();
  const late = await openFor(old.late, SAM);
  ok("before 0383: a late task Sam was given shows two open lines in Sam's inbox — assigned and past due — and the bell counts both",
    late.length === 2 && late.map((l) => l.kind).sort().join() === "task_assigned,task_due", late);
  ok("before 0383: …the past-due line rang (an INSERT fans out, 0157)", (await pushes()) === p0 + 1, (await pushes()) - p0);

  // Pushed out: the date moved to next week, as the line asks ("Knock it out or push the date").
  old.pushed = await task("Made-up: renew the permit", SAM, PAST());
  await sweep();
  await as(SAM, `update public.event_tasks set due_at = $2 where id = $1`, [old.pushed, FUTURE()]);
  ok("before 0383: a late task's date pushed into next week leaves its past-due line open", (await openFor(old.pushed, SAM)).filter((l) => l.kind === "task_due").length === 1);

  // Still open and still true: a late task nobody has touched. Left alone by everything below.
  old.true = await task("Made-up: wash the jugs", BEA, PAST());
  await assigned(old.true, BEA);
}
{
  // A team critical Sam picks up. The owners are not paged — and nobody can see that it was Sam.
  old.samHas = await teamCritical();
  const g = await gotIt(SAM, old.samHas);
  ok("before 0383: Sam taps Got it on a team critical (his own read, 0157)", !g.error && g.rows.length === 1, g.error);
  await age(old.samHas, "11 minutes");
  ok("before 0383: eleven minutes on, the owners are not paged — the escalation counts Sam's read as somebody having it",
    (await esc()) === 0 && (await escPushes(old.samHas)) === 0);
  const ownerSees = await as(OWNER, `select id from public.alerts where id = $1 and ack_at is null`, [old.samHas]);
  const ownerReads = await as(OWNER, `select user_id from public.alert_reads where alert_id = $1`, [old.samHas]);
  ok("before 0383: …while the owner's inbox still lists it as nobody's, and nothing the owner can read says who has it",
    ownerSees.rows.length === 1 && !ownerReads.error && ownerReads.rows.length === 0
    && (await num(`select count(*) n from information_schema.columns where table_name = 'alerts' and column_name = 'claimed_by'`)) === 0, { ownerSees, ownerReads });

  // A customer's "read" of a team critical they cannot even see.
  old.memberRead = await teamCritical("A card dispute was opened", "chargeback_open");
  const sees = await as(MEMBER, `select id from public.alerts where id = $1`, [old.memberRead]);
  const r = await gotIt(MEMBER, old.memberRead);
  await age(old.memberRead, "11 minutes");
  ok("before 0383: a signed-in customer cannot see a team critical, yet may write a read of it by its id…", sees.rows.length === 0 && !r.error && r.rows.length === 1, { sees, r });
  ok("before 0383: …and that read keeps the owners from being paged, as a crew member's would", (await esc()) === 0 && (await escPushes(old.memberRead)) === 0);

  // Bea picked one up an hour ago, and Sam after her.
  old.beaHas = await teamCritical("A Square refund isn't recorded here", "refund_unrecorded");
  await gotIt(BEA, old.beaHas);
  await gotIt(SAM, old.beaHas);
  await db.query(`update public.alert_reads set read_at = read_at - interval '1 hour' where alert_id = $1 and user_id = $2`, [old.beaHas, BEA]);
  await age(old.beaHas, "11 minutes");
}

// ── 0383 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const p0 = await pushes();
  await sweep();   // the cron ran before the paste: Bea's late task has its past-due line
  const pPaste = await pushes();
  await db.exec(MIG(F383));
  // 0383 applies to the whole schema — a throw above fails this file; a milestone, not counted as a check (R14, F25).
  ok("0383: the lines already open — a task done, a task gone, Sam's line on Bea's task, a pushed-out date — are closed by the mechanism (ack_by null)",
    byMechanism(await lines(old.done)) && byMechanism(await lines(old.gone))
    && byMechanism((await lines(old.moved)).filter((l) => l.target_user_id === SAM))
    && byMechanism((await lines(old.pushed)).filter((l) => l.kind === "task_due")),
    { done: await lines(old.done), gone: await lines(old.gone), moved: await lines(old.moved), pushed: await lines(old.pushed) });
  ok("0383: …Bea's line on the task that is hers now stays open", (await openFor(old.moved, BEA)).length === 1);
  const late = await openFor(old.late, SAM);
  ok("0383: the late task Sam was given is one line now — its past-due line; the assigned line beside it closed by the mechanism",
    late.length === 1 && late[0].kind === "task_due" && byMechanism((await lines(old.late)).filter((l) => l.kind === "task_assigned")), await lines(old.late));
  ok("0383: a line still true is left alone — and so is the one-line rule's: Bea's late task shows its past-due line",
    (await openFor(old.true, BEA)).length === 1 && (await openFor(old.true, BEA))[0].kind === "task_due", await lines(old.true));
  ok("0383: applying it rang nobody — closing a line is an UPDATE, and an UPDATE does not fan out", (await pushes()) === pPaste, { before: p0, paste: pPaste, after: await pushes() });

  // The team alerts already picked up: claimed by the earliest read by someone who can see them.
  const sam = await claimOf(old.samHas), bea = await claimOf(old.beaHas), mem = await claimOf(old.memberRead);
  ok("0383: the team critical Sam picked up before the paste is his claim now — what the escalation already counted, made visible",
    sam.claimed_by === SAM && sam.claimed_at !== null, sam);
  ok("0383: …one two people picked up is the first one's (Bea's, an hour before Sam's)", bea.claimed_by === BEA, bea);
  ok("0383: …and the customer's read claimed nothing: they cannot see it", mem.claimed_by === null, mem);
  const n = await esc();
  ok("0383: the next escalation run sends the critical only the customer had \"read\" — once, through the door — and not the ones somebody has",
    n === 1 && (await escPushes(old.memberRead)) === 1 && (await escPushes(old.samHas)) === 0 && (await escPushes(old.beaHas)) === 0,
    { n, member: await escPushes(old.memberRead), sam: await escPushes(old.samHas), bea: await escPushes(old.beaHas) });
}

// ── AFTER 0383: a task tells its alerts ──────────────────────────────────────────────────────────────────────────────
{
  // Done anywhere: every open line about it, whoever it is addressed to — the team's "Flagged:" line too.
  const t = await task("Made-up: pick up the lids", SAM, PAST());
  await assigned(t, SAM);
  await sweep();
  const flag = await as(MANAGER, `insert into public.alerts (severity, category, kind, subject_id, title, target_user_id, created_by)
    values ('critical', 'task', 'task_assigned', $1, 'Flagged: pick up the lids', null, $2)`, [t, MANAGER]);
  ok("after 0383: a note's Flag on a task is still a team line, raised as before", flag.error === null && (await open(t)).some((l) => l.target_user_id === null), flag.error);
  const p = await pushes();
  const d = await as(BEA, `update public.event_tasks set done = true, done_by = $2, done_at = now() where id = $1 returning id`, [t, BEA]);
  ok("after 0383: Bea finishes Sam's task from the prep list — through the API, as a server", !d.error && d.rows.length === 1, d.error);
  ok("after 0383: …and every open line about it closes — Sam's, and the team's Flag — by the mechanism", (await open(t)).length === 0 && byMechanism(await lines(t)), await lines(t));
  ok("after 0383: …and nothing rang", (await pushes()) === p);
  const re = await as(SAM, `update public.event_tasks set done = false, done_by = null, done_at = null where id = $1 returning id`, [t]);
  ok("after 0383: reopened, nothing reopens by itself", !re.error && (await open(t)).length === 0, re.error);
  const p2 = await pushes();
  await sweep();
  ok("after 0383: …and the sweep, re-armed by 0104, says it is late again: one line, one ring",
    (await open(t)).length === 1 && (await open(t))[0].kind === "task_due" && (await pushes()) === p2 + 1, await lines(t));
}
{
  // Deleted.
  const t = await task("Made-up: rent the generator", SAM, PAST());
  await assigned(t, SAM);
  await sweep();
  const p = await pushes();
  const g = await as(OWNER, `delete from public.event_tasks where id = $1 returning id`, [t]);
  ok("after 0383: a deleted task's lines close — none left open about a task that is gone, nothing rang",
    !g.error && g.rows.length === 1 && (await open(t)).length === 0 && byMechanism(await lines(t)) && (await pushes()) === p, { error: g.error, lines: await lines(t) });
  const ev = (await q1(`insert into public.events (title, tenant_id) values ('Made-up pop-up', $1) returning id`, [T1])).id;
  const c = (await q1(`insert into public.event_tasks (event_id, label, kind, assignee, tenant_id) values ($1, 'Made-up: bring the sign', 'task', $2, $3) returning id`, [ev, SAM, T1])).id;
  await assigned(c, SAM);
  await q(`delete from public.events where id = $1`, [ev]);
  ok("after 0383: …and so do the lines of a task deleted with its event (a cascade is a delete too)", (await open(c)).length === 0 && byMechanism(await lines(c)), await lines(c));
}
{
  // Given to someone else, and to nobody.
  const t = await task("Made-up: count the cups", SAM, PAST());
  await assigned(t, SAM);
  await sweep();
  await as(MANAGER, `insert into public.alerts (severity, category, kind, subject_id, title, created_by)
    values ('critical', 'task', 'task_assigned', $1, 'Flagged: count the cups', $2)`, [t, MANAGER]);
  const p = await pushes();
  const r = await as(MANAGER, `update public.event_tasks set assignee = $2 where id = $1 returning id`, [t, BEA]);
  ok("after 0383: a task given from Sam to Bea closes Sam's lines — assigned and past due — by the mechanism",
    !r.error && (await openFor(t, SAM)).length === 0 && byMechanism((await lines(t)).filter((l) => l.target_user_id === SAM)), await lines(t));
  ok("after 0383: …the team's Flag stays open: the task is still to do", (await openFor(t, null)).length === 1);
  ok("after 0383: …and nothing rang for the change itself", (await pushes()) === p);
  await assigned(t, BEA);
  ok("after 0383: Bea's own line comes from the screen that assigned it, as before, and rings", (await openFor(t, BEA)).length === 1 && (await pushes()) === p + 1);
  await as(MANAGER, `update public.event_tasks set label = 'Made-up: count the cups twice' where id = $1`, [t]);
  ok("after 0383: renaming the task touches no line", (await openFor(t, BEA)).length === 1 && (await openFor(t, null)).length === 1);
  await as(MANAGER, `update public.event_tasks set assignee = null where id = $1`, [t]);
  ok("after 0383: given to nobody, Bea's line closes too; the team's Flag stays", (await openFor(t, BEA)).length === 0 && (await openFor(t, null)).length === 1, await lines(t));
}
{
  // Its date moved.
  const t = await task("Made-up: book the porta-john", SAM, PAST());
  await sweep();
  ok("after 0383: a late task has its past-due line", (await openFor(t, SAM)).length === 1);
  const p = await pushes();
  await as(SAM, `update public.event_tasks set due_at = $2 where id = $1`, [t, new Date(Date.now() - 30 * 60_000).toISOString()]);
  await sweep();
  const still = await openFor(t, SAM);
  ok("after 0383: its date moved later but still in the past — still late, so the line stays, and the sweep's raise folds into it instead of ringing",
    still.length === 1 && Number(still[0].occurrences) === 2 && (await pushes()) === p, { still, pushes: (await pushes()) - p });
  await as(SAM, `update public.event_tasks set due_at = $2 where id = $1`, [t, FUTURE()]);
  ok("after 0383: its date pushed into next week — the past-due line closes by the mechanism", (await open(t)).length === 0 && byMechanism(await lines(t)), await lines(t));
  await sweep();
  ok("after 0383: …and the sweep raises nothing while the new date is ahead", (await open(t)).length === 0 && (await pushes()) === p);
  await as(SAM, `update public.event_tasks set due_at = $2 where id = $1`, [t, new Date(Date.now() - 60_000).toISOString()]);
  await sweep();
  ok("after 0383: when the new date passes too, the sweep says so: a new line, and it rings", (await open(t)).length === 1 && (await pushes()) === p + 1, await lines(t));
  await as(SAM, `update public.event_tasks set due_at = null where id = $1`, [t]);
  ok("after 0383: its date taken off — the past-due line closes", (await open(t)).length === 0);
}
{
  // One task, one line: the sweep closes the assigned line as it raises the past-due line.
  const t = await task("Made-up: fetch the ice", BEA, PAST());
  await assigned(t, BEA);
  await as(MANAGER, `insert into public.alerts (severity, category, kind, subject_id, title, created_by)
    values ('critical', 'task', 'task_assigned', $1, 'Flagged: fetch the ice', $2)`, [t, MANAGER]);
  const p = await pushes();
  await sweep();
  const mine = await openFor(t, BEA);
  ok("after 0383: a late task Bea was given shows one line — the past-due line; her assigned line closed by the mechanism",
    mine.length === 1 && mine[0].kind === "task_due" && byMechanism((await lines(t)).filter((l) => l.kind === "task_assigned" && l.target_user_id === BEA)), await lines(t));
  ok("after 0383: …addressed to her, as before, and it rang once", mine[0].target_user_id === BEA && (await pushes()) === p + 1);
  ok("after 0383: …and a line addressed to someone else (the team's Flag) is not hers to close", (await openFor(t, null)).length === 1);
}
// ── AFTER 0383: "Got it" on a team alert is a claim everyone sees ────────────────────────────────────────────────────
{
  const w = await teamCritical();
  const p = await pushes();
  const g = await gotIt(MANAGER, w);
  const c = await claimOf(w);
  ok("after 0383: Max taps Got it on a team critical — the same write as before, his own read — and it is his claim",
    !g.error && c.claimed_by === MANAGER && c.claimed_at !== null, { g, c });
  ok("after 0383: …claiming rang nobody (an update of claimed_by, not of escalated_at)", (await pushes()) === p);
  const samRow = await as(SAM, `select claimed_by from public.alerts where id = $1`, [w]);
  const samName = await namesFor(SAM, [w]), ownerName = await namesFor(OWNER, [w]);
  ok("after 0383: Sam, a server — who may not read Max's profile — sees on the alert that Max has it: his first name, from the database",
    samRow.rows[0]?.claimed_by === MANAGER && !samName.error && samName.rows.length === 1 && samName.rows[0].first_name === "Max", { samRow, samName });
  ok("after 0383: …and so does the owner", ownerName.rows.length === 1 && ownerName.rows[0].first_name === "Max", ownerName);
  const otherName = await namesFor(OTHER, [w]), memberName = await namesFor(MEMBER, [w]), anonName = await namesFor(null, [w]);
  ok("after 0383: another business's owner and a customer are told nothing, and a guest may not ask",
    !otherName.error && otherName.rows.length === 0 && !memberName.error && memberName.rows.length === 0 && /permission denied/i.test(anonName.error ?? ""),
    { otherName, memberName, anonName });
  const reads = await as(OWNER, `select user_id from public.alert_reads where alert_id = $1`, [w]);
  ok("after 0383: nobody's reads are shown to anybody — the owner still reads none of Max's", !reads.error && reads.rows.length === 0, reads);

  await gotIt(SAM, w);
  ok("after 0383: Sam's Got it after Max's is Sam's own — the claim stays Max's", (await claimOf(w)).claimed_by === MANAGER);
  await age(w, "11 minutes");
  ok("after 0383: eleven minutes on, a claimed critical is not sent to the owners", (await esc()) === 0 && (await escPushes(w)) === 0);

  // Undo.
  const u1 = await takeBack(MANAGER, w);
  ok("after 0383: Max takes his Got it back (Undo) — the claim passes to the earliest Got it still standing: Sam's",
    !u1.error && u1.rows.length === 1 && (await claimOf(w)).claimed_by === SAM, await claimOf(w));
  const u2 = await takeBack(SAM, w);
  ok("after 0383: Sam takes his back too — nobody has it", !u2.error && (await claimOf(w)).claimed_by === null && (await claimOf(w)).claimed_at === null, await claimOf(w));
  ok("after 0383: …so the owners are paged: sent again once, through the door", (await esc()) === 1 && (await escPushes(w)) === 1);

  // The same thing raised again while it is open (0372) keeps its claim.
  const k = await teamCritical("A Square refund isn't recorded here", "refund_unrecorded");
  await gotIt(BEA, k);
  const subj = (await q1(`select subject_id from public.alerts where id = $1`, [k])).subject_id;
  const p2 = await pushes();
  await db.query(`insert into public.alerts (severity, category, kind, subject_id, title, body, tenant_id)
    values ('critical', 'money', 'refund_unrecorded', $1, 'A Square refund isn''t recorded here', 'the latest words', $2)`, [subj, T1]);
  const folded = await q1(`select claimed_by, occurrences, body from public.alerts where id = $1`, [k]);
  ok("after 0383: raised again while open, the line counts it (0372) and is still Bea's — no new line, no ring",
    folded.claimed_by === BEA && Number(folded.occurrences) === 2 && folded.body === "the latest words" && (await pushes()) === p2, folded);
}
{
  // Reads that claim nothing.
  const v = await teamCritical("A card dispute was opened", "chargeback_open");
  const byMember = await gotIt(MEMBER, v), byOther = await gotIt(OTHER, v);
  ok("after 0383: a customer's read and another business's owner's read of a team critical claim nothing",
    !byMember.error && !byOther.error && (await claimOf(v)).claimed_by === null, { byMember, byOther, claim: await claimOf(v) });
  await age(v, "11 minutes");
  ok("after 0383: …and stop nothing: the owners are paged", (await esc()) === 1 && (await escPushes(v)) === 1);
  const closed = await teamCritical();
  await db.query(`update public.alerts set ack_at = now() where id = $1`, [closed]);
  await gotIt(SAM, closed);
  ok("after 0383: a read of a team alert already closed claims nothing", (await claimOf(closed)).claimed_by === null);
  const forged = await as(MANAGER, `insert into public.alerts (severity, category, kind, subject_id, title, claimed_by, claimed_at)
    values ('critical', 'money', 'refund_needed', gen_random_uuid(), 'Made-up refund', $1, now()) returning id`, [OWNER]);
  ok("after 0383: an alert raised with a claim already on it is written as nobody's — \"<name> has it\" is only said of a Got it",
    !forged.error && (await claimOf(forged.rows[0]?.id)).claimed_by === null, { forged, claim: forged.rows[0] && await claimOf(forged.rows[0].id) });
  const write = await as(SAM, `update public.alerts set claimed_by = $2 where id = $1 returning id`, [v, SAM]);
  ok("after 0383: nobody writes a claim through the API — only Got it makes one (0378's column grant)", /permission denied/i.test(write.error ?? ""), write);
}
{
  // A personal alert works as before.
  const t = await task("Made-up: sign for the delivery", SAM);
  await assigned(t, SAM);
  const mine = (await openFor(t, SAM))[0];
  const read = await gotIt(SAM, mine.id);
  ok("after 0383: a read of a personal alert claims nothing — it is nobody's but its person's", !read.error && (await claimOf(mine.id)).claimed_by === null);
  const ack = await as(SAM, `update public.alerts set ack_at = now(), ack_by = $2 where id = $1 returning id`, [mine.id, SAM]);
  const after = await q1(`select ack_at, ack_by, claimed_by from public.alerts where id = $1`, [mine.id]);
  ok("after 0383: Got it on a personal alert still acknowledges the row — ack_at and ack_by, as lib/useMyAlerts writes them",
    !ack.error && ack.rows.length === 1 && after.ack_by === SAM && after.claimed_by === null, { ack, after });
  const undo = await as(SAM, `update public.alerts set ack_at = null, ack_by = null where id = $1 returning id`, [mine.id]);
  ok("after 0383: …and its Undo still works", !undo.error && undo.rows.length === 1 && (await claimOf(mine.id)).ack_at === null, undo);
}
{
  const g = await q1(`select has_function_privilege('anon', 'public.alert_claimants(uuid[])', 'execute') a,
                             has_function_privilege('authenticated', 'public.alert_claimants(uuid[])', 'execute') b,
                             (select prosecdef from pg_proc where proname = 'alert_claimants') d,
                             (select coalesce(proconfig::text, '') from pg_proc where proname = 'alert_claimants') c,
                             has_function_privilege('anon', 'public.team_alert_seen_by(uuid,uuid)', 'execute') e,
                             has_function_privilege('authenticated', 'public.team_alert_seen_by(uuid,uuid)', 'execute') f,
                             (select prosecdef from pg_proc where proname = 'team_alert_seen_by') h,
                             has_function_privilege('authenticated', 'public.alert_claim_on_read()', 'execute') i,
                             (select prosecdef from pg_proc where proname = 'alert_claim_on_read') j,
                             has_function_privilege('authenticated', 'public.alert_claim_starts_empty()', 'execute') k,
                             has_function_privilege('authenticated', 'public.escalate_unacked_criticals()', 'execute') l`);
  ok("0383: the claimant's name is the signed-in crew's to ask (definer, search_path pinned), a guest's to ask never; who-sees-what is nobody's to ask about someone else (invoker, closed); the triggers are nobody's to call; the escalation stays the cron's",
    !g.a && g.b && g.d === true && /search_path=public/.test(g.c) && !g.e && !g.f && g.h === false && !g.i && g.j === true && !g.k && !g.l, g);
  const probe = await as(SAM, `select public.team_alert_seen_by($1, $2) s`, [(await q1(`select id from public.alerts limit 1`)).id, OWNER]);
  ok("0383: …so a signed-in person cannot ask what someone else's role or business lets them see", /permission denied/i.test(probe.error ?? ""), probe);
}
{
  const g = await q1(`select has_function_privilege('anon', 'public.task_alerts_follow_the_task()', 'execute') a,
                             has_function_privilege('authenticated', 'public.task_alerts_follow_the_task()', 'execute') b,
                             (select prosecdef from pg_proc where proname = 'task_alerts_follow_the_task') d,
                             (select coalesce(proconfig::text, '') from pg_proc where proname = 'task_alerts_follow_the_task') c,
                             has_function_privilege('anon', 'public.task_due_alerts()', 'execute') e,
                             has_function_privilege('authenticated', 'public.task_due_alerts()', 'execute') f,
                             has_function_privilege('service_role', 'public.task_due_alerts()', 'execute') s`);
  ok("0383: the task's trigger is nobody's to call — definer, search_path pinned; the sweep stays the cron's and the server's (0381)",
    !g.a && !g.b && g.d === true && /search_path=public/.test(g.c) && !g.e && !g.f && g.s === true, g);
  const trig = await q1(`select pg_get_triggerdef(oid) d from pg_trigger where tgrelid = 'public.event_tasks'::regclass and tgname = 'event_tasks_alerts_follow'`);
  ok("0383: it fires after an update of done, assignee or due_at, and after a delete — row by row",
    /AFTER DELETE OR UPDATE OF done, assignee, due_at ON public\.event_tasks FOR EACH ROW/.test(trig?.d ?? ""), trig?.d);
  const mem = await as(MEMBER, `update public.event_tasks set done = true where event_id = $1 returning id`, [EVENT]);
  ok("0383: a customer still cannot touch a task (0025's staff rule is unchanged)", mem.error === null && mem.rows.length === 0, mem);
}

// ── A SECOND RUN, AND THE LEDGER ───────────────────────────────────────────────────────────────────────────────────
{
  const claims = `select count(*) n from public.alerts where claimed_by is not null`;
  const before = { rows: await num(`select count(*) n from public.alerts`), open: await num(`select count(*) n from public.alerts where ack_at is null`),
    claimed: await num(claims), pushes: await pushes() };
  let rerun = null;
  try { await db.exec(MIG(F383)); } catch (e) { rerun = String(e.message || e); }
  ok("0383 run twice: no error, no line closed or opened, no claim made or lost, nothing rang, each changelog line once",
    rerun === null && (await num(`select count(*) n from public.alerts`)) === before.rows && (await num(`select count(*) n from public.alerts where ack_at is null`)) === before.open
    && (await num(claims)) === before.claimed && (await pushes()) === before.pushes
    && (await num(`select count(*) n from public.changelog where title in ('A finished task''s alerts clear themselves', '"Got it" on a team alert shows who has it',
      'Muted categories and quiet hours stop the ping too')`)) === 3, rerun);
  ok("0383 run twice: one trigger each on event_tasks, alert_reads and alerts",
    (await num(`select count(*) n from pg_trigger where tgname in ('event_tasks_alerts_follow', 'alert_reads_claim', 'alerts_claim_starts_empty')`)) === 3);
  ok("0383 records itself by its own name, once per run",
    (await num(`select applied_count n from public.schema_migrations where version = '0383_the_alerts_tell_the_truth'`)) === 2);
}

console.log(`0383 (the alerts tell the truth): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
