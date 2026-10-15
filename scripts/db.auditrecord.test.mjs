// A WEEK'S AUDIT IS A RECORD — 0405, run in Postgres (Release 3 of the Today, Command, Audit & Catalog audit; the first of
// the crew's database rules).
//
// The findings, as sentences: an audit was filed under the phone's day, so a Monday audit and a Tuesday fix were two rows
// and the two-week rule counted two weeks; it saved in two writes; a second save overwrote a colleague's without a word;
// any owner or admin could rewrite any week; and removing a stream deleted its history. What is run here is the whole
// schema up to 0404, a history written the old way, then 0405 — twice — and the Monday audit's one writer, its lock, its
// week, its eight weeks and its reminder, as the roles that call them.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL405 = readFileSync(join(ROOT, "supabase/migrations/0405_a_weeks_audit_is_a_record.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c405000-0000-4000-8000-0000000000c1";
const ADMIN = "0c405000-0000-4000-8000-0000000000c2";
const SERVER = "0c405000-0000-4000-8000-0000000000c3";
const A = "0c405000-0000-4000-8000-0000000000a1";   // active, audited twice in one week the old way
const B = "0c405000-0000-4000-8000-0000000000b1";   // active, audited on a Tuesday the old way
const C = "0c405000-0000-4000-8000-0000000000d1";   // parked
const D = "0c405000-0000-4000-8000-0000000000e1";   // active, never audited — removable

const t0 = Date.now();
const db = await fullSchema({ before: "0405" });
console.log(`the schema to 0404 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const n = async (s, p) => Number((await q1(s, p)).n);
const raises = async (s, p) => { try { await q(s, p); return null; } catch (e) { return String(e.message || e); } };
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};

for (const [id, email, role] of [[OWNER, "owner@example.test", "owner"], [ADMIN, "admin@example.test", "admin"], [SERVER, "server@example.test", "server"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
// The portfolio's own streams (0264 seeds them) are parked here, so the week's count is these four's alone.
await q(`update public.os_workstreams set status = 'parked'`);
await q(`insert into public.os_workstreams (id, name, owner, status, health, sort) values
  ($1, 'Test · route ops', 'Ryan', 'active', 7, 101), ($2, 'Test · accounts', 'Kayla', 'active', 9, 102),
  ($3, 'Test · franchise kit', 'Ryan', 'parked', 0, 103), ($4, 'Test · pop-ups', 'Ryan', 'active', 0, 104)`, [A, B, C, D]);
// The old way: filed under the day. A: Monday Sep 28, then Wednesday Sep 30 (the same week); B: Tuesday Oct 6.
await q(`insert into public.workstream_audits (workstream_id, week_of, c_owner, c_next, c_blockers, c_artifacts, c_signal, total, note, created_at) values
  ($1, '2026-09-28', 1, 1, 1, 1, 1, 5, 'monday', '2026-09-28T14:00:00Z'),
  ($1, '2026-09-30', 2, 2, 1, 1, 1, 7, 'wednesday fix', '2026-09-30T14:00:00Z'),
  ($2, '2026-10-06', 2, 2, 2, 2, 1, 9, null, '2026-10-06T14:00:00Z')`, [A, B]);

// ── 0405, and 0405 again ──
await db.exec(SQL405);
ok("re-filed: no audit is filed under a day that is not its week's Monday", await n(`select count(*) n from public.workstream_audits where week_of <> public.audit_week(week_of)`) === 0);
const a = await q(`select week_of::text w, total, note from public.workstream_audits where workstream_id = $1`, [A]);
ok("a week audited twice the old way is one week's audit — the later one, under its Monday", a.length === 1 && a[0].w === "2026-09-28" && a[0].total === 7 && a[0].note === "wednesday fix", a);
const sup = await q(`select week_of::text w, total, note from public.workstream_audit_superseded where workstream_id = $1`, [A]);
ok("the earlier one is kept, as it was, under the day it was filed — not lost", sup.length === 1 && sup[0].w === "2026-09-28" && sup[0].total === 5 && sup[0].note === "monday", sup);
const b = await q(`select week_of::text w, total from public.workstream_audits where workstream_id = $1`, [B]);
ok("a Tuesday audit is filed under that week's Monday", b.length === 1 && b[0].w === "2026-10-05" && b[0].total === 9, b);
const counted = async () => [await n(`select count(*) n from public.workstream_audits`), await n(`select count(*) n from public.workstream_audit_superseded`)].join("/");
const once = await counted();
await db.exec(SQL405);
ok("a second run changes nothing", await counted() === once
  && await n(`select count(*) n from cron.job where jobname = 'monday-audit-reminder'`) === 1 && await n(`select count(*) n from public.changelog where title = 'A week''s audit is a record'`) === 1);
ok("audit_week: Thursday Oct 15 and Sunday Oct 18 are the week of Monday Oct 12; a Monday is its own", (await q1(`select public.audit_week('2026-10-15')::text a, public.audit_week('2026-10-18')::text b, public.audit_week('2026-10-12')::text c, public.audit_week('2026-10-19')::text d`)).a === "2026-10-12"
  && (await q1(`select public.audit_week('2026-10-18')::text b`)).b === "2026-10-12" && (await q1(`select public.audit_week('2026-10-19')::text d`)).d === "2026-10-19");

// ── a week that has ended cannot change, whoever asks ──
const wk = (await q1(`select public.audit_week()::text w`)).w;
ok("the database itself cannot rewrite a week that has ended", /week_closed/.test(await raises(`update public.workstream_audits set total = 10 where workstream_id = $1`, [A]) ?? ""));
ok("…nor delete one", /week_closed/.test(await raises(`delete from public.workstream_audits where workstream_id = $1`, [A]) ?? ""));
ok("…nor file one under a week that has ended", /week_closed/.test(await raises(`insert into public.workstream_audits (workstream_id, week_of, total) values ($1, '2026-09-21', 5)`, [D]) ?? ""));
ok("…nor file one under a day that is not a Monday", /not_a_week/.test(await raises(`insert into public.workstream_audits (workstream_id, week_of, total) values ($1, (public.audit_week() + 2), 5)`, [D]) ?? ""));
const direct = await as(ADMIN, `insert into public.workstream_audits (workstream_id, week_of, total) values ($1, public.audit_week(), 5)`, [D]);
ok("an admin writes no audit row directly — the one writer is save_workstream_audit", !!direct.error && /permission denied|row-level security/i.test(direct.error), direct.error);
const read = await as(SERVER, `select count(*) n from public.workstream_audits`);
ok("all staff still read the history", !read.error && Number(read.rows[0].n) === await n(`select count(*) n from public.workstream_audits`) && Number(read.rows[0].n) >= 2, read);

// ── the one writer ──
const seen = async (id) => (await q1(`select updated_at from public.os_workstreams where id = $1`, [id])).updated_at;
const details = (o = {}) => JSON.stringify({ name: "Test · route ops", owner: "Ryan", owner_user_id: OWNER, status: "active", next_action: "Route the Sunday run", due: "2026-10-20", blocker: "", ...o });
const scores = (o = {}) => JSON.stringify({ c_owner: 2, c_next: 2, c_blockers: 1, c_artifacts: 2, c_signal: 1, ...o });
const save = (who, id, s, d, sc, note) => as(who, `select public.save_workstream_audit($1, $2, $3::jsonb, $4::jsonb, $5) as r`, [id, s, d, sc, note]);

const srv = await save(SERVER, A, await seen(A), details(), scores(), null);
ok("a server cannot save an audit", !!srv.error && /not_allowed/.test(srv.error), srv.error);
const stale = await save(ADMIN, A, "2026-01-01T00:00:00Z", details(), scores(), null);
ok("a save over a change the caller has not seen is refused, in words, and writes nothing", !stale.error && stale.rows[0].r.ok === false && stale.rows[0].r.code === "changed" && /Someone saved this stream/.test(stale.rows[0].r.words)
  && await n(`select count(*) n from public.workstream_audits where workstream_id = $1 and week_of = public.audit_week()`, [A]) === 0, stale);

const s1 = await save(ADMIN, A, await seen(A), details(), scores(), "  steady week  ");
const r1 = s1.rows[0]?.r;
const row1 = await q1(`select week_of::text w, total, note, audited_by from public.workstream_audits where workstream_id = $1 and week_of = public.audit_week()`, [A]);
const st1 = await q1(`select health, last_audited::text l, next_action, due::text due, owner_user_id from public.os_workstreams where id = $1`, [A]);
ok("all five scored: this week's audit, under this week's Monday, by who saved it, with the note", r1?.ok === true && r1.week_of === wk && r1.total === 8
  && row1?.w === wk && row1.total === 8 && row1.note === "steady week" && row1.audited_by === ADMIN, { r1, row1 });
ok("…and the stream, in the same breath: its health, the day it was audited, its details", st1.health === 8 && st1.l === (await q1(`select public.business_day()::text d`)).d
  && st1.next_action === "Route the Sunday run" && st1.due === "2026-10-20" && st1.owner_user_id === OWNER, st1);

const s2 = await save(OWNER, A, await seen(A), details(), scores({ c_signal: 2 }), null);
ok("a second save this week, over what the saver has seen, is this week's audit again — one row a week", s2.rows[0]?.r.ok === true
  && await n(`select count(*) n from public.workstream_audits where workstream_id = $1 and week_of = public.audit_week()`, [A]) === 1
  && (await q1(`select total from public.workstream_audits where workstream_id = $1 and week_of = public.audit_week()`, [A])).total === 9, s2);
const late = await save(ADMIN, A, r1.updated_at, details(), scores({ c_signal: 0 }), null);
ok("the colleague still holding the first version is told, not allowed to overwrite the owner's save", late.rows[0]?.r.code === "changed"
  && (await q1(`select total from public.workstream_audits where workstream_id = $1 and week_of = public.audit_week()`, [A])).total === 9, late.rows[0]?.r);

const before = await q1(`select health, last_audited::text l from public.os_workstreams where id = $1`, [B]);
const det = await save(ADMIN, B, await seen(B), details({ name: "Test · accounts", owner: "Kayla", owner_user_id: null, blocker: "Waiting on the printer" }), null, "not saved without scores");
const afterB = await q1(`select health, last_audited::text l, blocker from public.os_workstreams where id = $1`, [B]);
ok("details alone: the stream's details change, its health and audit day do not, and no audit row is written", det.rows[0]?.r.ok === true && det.rows[0].r.total === null
  && afterB.health === before.health && afterB.l === before.l && afterB.blocker === "Waiting on the printer"
  && await n(`select count(*) n from public.workstream_audits where workstream_id = $1 and week_of = public.audit_week()`, [B]) === 0, { det: det.rows[0]?.r, afterB });

const four = await save(ADMIN, D, await seen(D), details({ name: "Test · pop-ups" }), JSON.stringify({ c_owner: 2, c_next: 2, c_blockers: 2, c_artifacts: 2 }), null);
const three = await save(ADMIN, D, await seen(D), details({ name: "Test · pop-ups" }), scores({ c_owner: 3 }), null);
ok("four scores, or a score of 3, is refused in words, and writes nothing", four.rows[0]?.r.code === "bad_scores" && three.rows[0]?.r.code === "bad_scores"
  && await n(`select count(*) n from public.workstream_audits where workstream_id = $1`, [D]) === 0 && (await q1(`select name from public.os_workstreams where id = $1`, [D])).name === "Test · pop-ups", [four.rows[0]?.r, three.rows[0]?.r]);
const noName = await save(ADMIN, D, await seen(D), details({ name: "  " }), scores(), null);
const badStatus = await save(ADMIN, D, await seen(D), details({ name: "Test · pop-ups", status: "done" }), scores(), null);
ok("a stream with no name, or a status it cannot have, is refused, and writes nothing", noName.rows[0]?.r.code === "bad_details" && badStatus.rows[0]?.r.code === "bad_details"
  && await n(`select count(*) n from public.workstream_audits where workstream_id = $1`, [D]) === 0);
const ghost = await save(ADMIN, D, await seen(D), details({ name: "Test · pop-ups", owner_user_id: "0c405000-0000-4000-8000-00000000dead" }), scores(), null);
ok("both or neither: when the stream cannot be written (an owner who is not a person here), the audit row is not written either", !!ghost.error
  && await n(`select count(*) n from public.workstream_audits where workstream_id = $1`, [D]) === 0, ghost.error);

// ── a stream with a record is parked, not deleted ──
ok("a stream with audit history cannot be deleted — park it", /foreign key|violates/i.test(await raises(`delete from public.os_workstreams where id = $1`, [A]) ?? ""));
const gone = await as(ADMIN, `delete from public.os_workstreams where id = $1`, [D]);
ok("one with no history still can be", !gone.error && await n(`select count(*) n from public.os_workstreams where id = $1`, [D]) === 0, gone.error);

// ── eight weeks a stream ──
await q(`alter table public.workstream_audits disable trigger workstream_audit_week_is_closed`);
for (let i = 1; i <= 10; i++) await q(`insert into public.workstream_audits (workstream_id, week_of, total) values ($1, public.audit_week() - ($2::int * 7), $3) on conflict do nothing`, [B, i, i % 11]);
await q(`alter table public.workstream_audits enable trigger workstream_audit_week_is_closed`);
const weeks = await as(SERVER, `select week_of::text w from public.v_workstream_weeks where workstream_id = $1`, [B]);
ok("v_workstream_weeks: a stream's last eight weeks, newest first, for anyone on staff", !weeks.error && weeks.rows.length === 8 && weeks.rows[0].w > weeks.rows[7].w, weeks.rows.length);
ok("the guest key reads none of it", !!(await as(null, `select count(*) from public.v_workstream_weeks`)).error);

// ── the Monday reminder ──
const open = async () => q(`select target_user_id t, title from public.alerts where kind = 'monday_audit_due' and ack_at is null order by target_user_id`);
ok("away from Monday's 9 am, the reminder does nothing on its own", Number((await q1(`select public.monday_audit_reminder() as n`)).n) === 0 || new Date().getUTCDay() === 1);
await q(`insert into public.alerts (severity, category, kind, subject_id, title, target_user_id, tenant_id, created_at) values ('important', 'task', 'monday_audit_due', $1, 'Monday audit: 4 streams to score', $1, $2, now() - interval '9 days')`, [OWNER, T1]);
const raised = Number((await q1(`select public.monday_audit_reminder(true) as n`)).n);
const o1 = await open();
ok("Monday: one reminder each for the owner and the admin, none for the server — last week's, left open, cleared for this week's", raised === 2 && o1.length === 2
  && o1.every((x) => [OWNER, ADMIN].includes(x.t)) && o1.every((x) => /^Monday audit: 1 stream to score$/.test(x.title)), o1);
await q(`select public.monday_audit_reminder(true)`);
ok("raised again, each is counted on the open one, not sent twice", (await open()).length === 2);
const last = await save(ADMIN, B, await seen(B), details({ name: "Test · accounts", owner: "Kayla", owner_user_id: null }), scores(), null);
ok("the last active stream scored clears every reminder of the week", last.rows[0]?.r.ok === true && (await open()).length === 0, await open());
ok("a parked stream is never due", Number((await q1(`select public.monday_audit_reminder(true) as n`)).n) === 0);

console.log(`AUDIT RECORD (0405): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
