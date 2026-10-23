// R49 — EVERY LIST THE CONSOLE EDITS KEEPS ITS HISTORY (0446), IN POSTGRES (2026-10-23 — the console audit, point 8).
//
// The whole schema to 0445 is loaded; then 0446, twice. What is read: nine triggers, one each, named audit_<table>;
// none on customers or the bottle proofs (a person's rows stay out of a year-long trail); a prep task ticked done by the
// owner is a line in audit_log naming the owner, with the row before and after — and the owner reads it back under RLS,
// as Settings › Activity log does; a reader who isn't staff reads none of it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M446 = readFileSync(join(ROOT, "supabase/migrations/0446_every_list_the_console_edits_keeps_its_history.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c449000-0000-4000-8000-0000000000e1";
const GUEST = "0c449000-0000-4000-8000-0000000000e2";

const db = await fullSchema({ before: "0446" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
await q(`insert into auth.users (id, email) values ($1, 'owner49@example.test'), ($2, 'guest49@example.test')`, [OWNER, GUEST]);
await q(`update public.profiles set role = 'owner', tenant_id = $2 where id = $1`, [OWNER, T1]);
await q(`update public.profiles set role = 'member', tenant_id = $2 where id = $1`, [GUEST, T1]);

await db.exec(M446);
await db.exec(M446);
ok("0446 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0446%'`)).n === 2);
const NINE = ["broadcasts", "business_orders", "event_tasks", "events", "invoices", "shoots", "shots", "stops", "todos"];
const made = (await q(`select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
  where t.tgname = 'audit_' || c.relname and p.proname = 'audit_row' and c.relname = any($1) order by 1`, [NINE])).map((r) => r.relname);
ok("nine triggers, audit_<table>, on 0042's audit_row", JSON.stringify(made) === JSON.stringify(NINE), made);
const personal = (await q(`select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
  where c.relname in ('customers', 'vip_verifications') and p.proname = 'audit_row'`));
ok("none on customers or the bottle-owner proofs", personal.length === 0, personal);

const as = async (who, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const ev = await q1(`select id from public.events limit 1`);
const task = await q1(`insert into public.event_tasks (event_id, label, tenant_id) values ($1, 'Ice the cooler', $2) returning id`, [ev.id, T1]).catch((e) => ({ error: e.message }));
ok("a prep task can be made here (the fixture)", !task.error, task.error);
if (!task.error) {
  await as(OWNER, `update public.event_tasks set done = true, done_by = $2, done_at = now() where id = $1`, [task.id, OWNER]);
  const line = await q1(`select actor, op, old_data, new_data from public.audit_log where table_name = 'event_tasks' and row_id = $1 and upper(op) = 'UPDATE' order by id desc limit 1`, [task.id]);
  ok("the owner ticks a prep task: one line, who and the row before and after", line && line.actor === OWNER && line.old_data && line.new_data
    && line.old_data.done === false && line.new_data.done === true, line);
  const seen = await as(OWNER, `select count(*)::int n from public.audit_log where table_name = 'event_tasks' and row_id = $1`, [task.id]);
  ok("the owner reads it back, as the Activity log does (0042's staff read)", seen[0].n >= 1, seen);
  const guest = await as(GUEST, `select count(*)::int n from public.audit_log`);
  ok("a member reads none of the trail", guest[0].n === 0, guest);
}

console.log(`R49 — THE CONSOLE'S LISTS KEEP THEIR HISTORY (0446, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
