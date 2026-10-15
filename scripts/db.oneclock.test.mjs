// ONE CLOCK — 0406, run in Postgres (Release 3 of the Today, Command, Audit & Catalog audit; the second of the crew's
// database rules).
//
// The finding, as a sentence: the screens count the business's day (Eastern), and two views counted the database's (UTC),
// so after 8 pm Eastern a to-do due today read "1 day late" in Needs you and a task due that evening was filed under
// tomorrow. What is run here is the whole schema with 0406, then 0406 again, and the two views read against the
// business's own day — the session set to UTC, as Supabase's is, and the moments chosen on both sides of 8 pm Eastern.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL406 = readFileSync(join(ROOT, "supabase/migrations/0406_one_clock_a_todo_due_today_is_due_today.sql"), "utf8");
const SQL330 = readFileSync(join(ROOT, "supabase/migrations/0330_the_money_leaves_in_square_and_nobody_hears.sql"), "utf8");
const SQL237 = readFileSync(join(ROOT, "supabase/migrations/0237_all_tasks_initiatives.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const SAM = "0c406000-0000-4000-8000-0000000000a1";

const t0 = Date.now();
const db = await fullSchema();
console.log(`the whole schema loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
await db.exec(`set timezone to 'UTC'`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];

await q(`insert into auth.users (id, email) values ($1, 'sam@example.test')`, [SAM]);
await q(`update public.profiles set role = 'server', tenant_id = $2, display_name = 'Sam' where id = $1`, [SAM, T1]);
const today = (await q1(`select public.business_day()::text d`)).d;

// ── the views, as 0406 writes them: everything but the clock is 0330's and 0237's ──
const viewText = (sql, start, end) => { const i = sql.indexOf(start); return sql.slice(i, sql.indexOf(end, i)); };
const was330 = viewText(SQL330, "create or replace view public.v_obligations as", "alter view public.v_obligations set (security_invoker = on);");
const now406 = viewText(SQL406, "create or replace view public.v_obligations as", "alter view public.v_obligations set (security_invoker = on);");
const back = now406
  .replace("coalesce(f.verified_on + 365, public.business_day())", "coalesce(f.verified_on + 365, current_date)")
  .replace("(c.expires_at at time zone 'America/New_York')::date", "c.expires_at::date")
  .replace("(t.due_at at time zone 'America/New_York')::date", "t.due_at::date")
  .replace("(r.due_on - public.business_day()) as days_out", "(r.due_on - current_date) as days_out")
  .replace("r.due_on <  public.business_day() then", "r.due_on <  current_date then")
  .replace("r.due_on <= public.business_day() + 14 then", "r.due_on <= current_date + 14 then")
  .replace("'/crew?s=money&a=pay',", "'/crew?s=money',").replace("'/crew?s=team&a=operators',", "'/crew?s=money',");
ok("v_obligations is 0330's, byte for byte, but for its clock — six places, each the business's day — and two routes that name their panel", was330.length > 1000 && back === was330);
const at237 = viewText(SQL237, "create or replace view public.all_tasks", "grant select on public.all_tasks to authenticated;");
const at406 = viewText(SQL406, "create or replace view public.all_tasks", "grant select on public.all_tasks to authenticated;");
ok("all_tasks is 0237's, byte for byte, but for an event task's due day", at237.length > 500 && at406.replace("(due_at at time zone 'America/New_York')::date as due", "due_at::date as due") === at237);
const def = (await q1(`select pg_get_viewdef('public.v_obligations'::regclass) d`)).d;
ok("the view in the database counts no day by UTC", !/CURRENT_DATE/i.test(def) && /business_day\(\)/.test(def));

// ── a to-do due today is due today until midnight Eastern ──
await q(`insert into public.todos (title, due_on, assignee, tenant_id) values ('Made-up: call the venue', $1::date, $3, $2), ('Made-up: order lids', $1::date - 1, $3, $2)`, [today, T1, SAM]);
const todos = await q(`select title, days_out, severity from public.v_obligations where source = 'todos' order by title`);
const call = todos.find((t) => /venue/.test(t.title)), lids = todos.find((t) => /lids/.test(t.title));
ok("a to-do due on the business's today is due today — 0 days, due soon, never a day late", call?.days_out === 0 && call.severity === "soon", call);
ok("one due yesterday is a day late", lids?.days_out === -1 && lids.severity === "overdue", lids);

// ── a certificate expiring tonight, and training due this evening, fall on today ──
const tonight = (d) => `${d}T23:30:00-04:00`;   // half past eleven at night, Eastern daylight time
await q(`insert into public.academy_certifications (user_id, cert_key, awarded_at, expires_at, tenant_id) values ($1, 'food-safety', now() - interval '300 days', $2::timestamptz, $3)`, [SAM, tonight(today), T1]);
const cert = await q1(`select due_on::text d from public.v_obligations where source = 'academy_certifications'`);
ok("a certificate expiring at 11:30 pm Eastern expires on that Eastern day, not the UTC day after", cert?.d === today, cert);

// ── a task due this evening is filed under today ──
const ev = (await q1(`insert into public.events (title, tenant_id) values ('Made-up market day', $1) returning id`, [T1])).id;
await q(`insert into public.event_tasks (event_id, label, kind, assignee, due_at, tenant_id) values ($1, 'Made-up: pack the cooler', 'task', $4, $2::timestamptz, $3)`, [ev, "2026-10-15T21:00:00-04:00", T1, SAM]);
const task = await q1(`select due::text d from public.all_tasks where title = 'Made-up: pack the cooler'`);
ok("a task due at 9 pm Eastern on the 15th is the 15th's — UTC calls it the 16th", task?.d === "2026-10-15", task);
const morning = await q(`insert into public.event_tasks (event_id, label, kind, assignee, due_at, tenant_id) values ($1, 'Made-up: ice', 'task', $3, '2026-10-16T09:00:00-04:00', $2) returning id`, [ev, T1, SAM]);
ok("and one due at 9 am on the 16th is still the 16th's", (await q1(`select due::text d from public.all_tasks where id = $1`, [morning[0].id])).d === "2026-10-16");

// ── a second run changes nothing ──
const before = JSON.stringify(await q(`select source, subject_id, due_on, days_out, severity from public.v_obligations order by source, subject_id`));
await db.exec(SQL406);
ok("a second run changes nothing", JSON.stringify(await q(`select source, subject_id, due_on, days_out, severity from public.v_obligations order by source, subject_id`)) === before
  && Number((await q1(`select count(*) n from public.changelog where title = 'A to-do due today is due today until midnight'`)).n) === 1);
ok("both views keep their readers: the signed-in read them, the guest key does not", (await q1(`select has_table_privilege('authenticated', 'public.v_obligations', 'select') a, has_table_privilege('anon', 'public.v_obligations', 'select') b, has_table_privilege('authenticated', 'public.all_tasks', 'select') c`)).a === true
  && (await q1(`select has_table_privilege('anon', 'public.v_obligations', 'select') b`)).b === false);

console.log(`ONE CLOCK (0406): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
