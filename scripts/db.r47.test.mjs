// R47 — THE OWNER SEES WHO HAS THE COURSE, AND GIVES IT (0444), IN POSTGRES (2026-10-22 — Ryan: "can i give access in
// settings somewhere? how can i see the users… industry standard").
//
// The whole schema to 0443 is loaded, a buyer's order and access written as the checkout writes them; then 0444, twice.
// What is read: the owner gives the course (a comp, with its note and who gave it) and it opens the lessons; giving it
// twice is said, not doubled; a server on the crew and a member are refused; the students read says who has it, how they
// got it, what it cost and how far along — to the crew only; taking it back revokes it (and says who); a refund still
// reaches only what an order gave; every change is in the audit trail.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M444 = readFileSync(join(ROOT, "supabase/migrations/0444_the_owner_sees_who_has_the_course.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c447000-0000-4000-8000-0000000000a1", SERVER = "0c447000-0000-4000-8000-0000000000a2",
  BUYER = "0c447000-0000-4000-8000-0000000000a3", FRIEND = "0c447000-0000-4000-8000-0000000000a4";

const t0 = Date.now();
const db = await fullSchema({ before: "0444" });
console.log(`the schema to 0443 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
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
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
`);
for (const [id, role] of [[OWNER, "owner"], [SERVER, "server"], [BUYER, "member"], [FRIEND, "member"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
// the owner's two-step is on and given this session (0433: is_admin asks it)
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
const cust = async (uid) => (await q1(`select id from public.customers where user_id = $1`, [uid])).id;
const buyer = await cust(BUYER), friend = await cust(FRIEND);
const course = (await q1(`select id from public.shop_products where kind = 'program_tier' and program_tier = 'pro'`)).id;
const order = (await q1(`insert into public.shop_orders (customer_id, user_id, email, payment_id, subtotal_cents, total_cents, status, tenant_id)
  values ($1, $2, 'b@example.test', 'sq-1', 4700, 4700, 'delivered', $3) returning id`, [buyer, BUYER, T1])).id;
await q(`insert into public.shop_order_items (order_id, product_id, title, qty, unit_cents) values ($1, $2, 'GT3 Nutrition', 1, 4700)`, [order, course]);
await q(`insert into public.program_access (customer_id, tier, source, order_id, tenant_id) values ($1, 'pro', 'purchase', $2, $3)`, [buyer, order, T1]);
const firstLesson = (await q1(`select id from public.primal_lessons where published_at is not null order by sort limit 1`)).id;
await q(`insert into public.primal_progress (customer_id, lesson_id, status, completed_at, tenant_id) values ($1, $2, 'completed', now(), $3)`, [buyer, firstLesson, T1]);

// ── 0444, twice ──────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(M444);
await db.exec(M444);
ok("0444 twice: recorded (applied twice), one audit trigger", (await q1(`select applied_count::int n from public.schema_migrations where version like '0444%'`)).n === 2
  && (await q1(`select count(*)::int n from pg_trigger where tgname = 'audit_program_access'`)).n === 1);

const lessons = async (uid) => (await as(uid, `select count(*)::int n from public.primal_lessons`)).rows[0]?.n;
ok("before: the friend reads no lesson", (await lessons(FRIEND)) === 0);
const g = await as(OWNER, `select public.course_give($1, 'A gift — the launch') as r`, [friend]);
ok("the owner gives the course", !g.error && g.rows[0]?.r?.ok === true && g.rows[0]?.r?.already === false, g);
const row = await q1(`select source, order_id, note, granted_by, revoked_at from public.program_access where customer_id = $1`, [friend]);
ok("…a comp, no order, with its note and who gave it — and it opens the lessons", row.source === "comp" && row.order_id === null && row.note === "A gift — the launch" && row.granted_by === OWNER && row.revoked_at === null && (await lessons(FRIEND)) === 3, row);
ok("giving it again is said, not doubled", (await as(OWNER, `select public.course_give($1, null) as r`, [friend])).rows[0]?.r?.already === true
  && (await q1(`select count(*)::int n from public.program_access where customer_id = $1`, [friend])).n === 1);
const srv = await as(SERVER, `select public.course_give($1, null)`, [buyer]);
const mem = await as(FRIEND, `select public.course_take_back($1)`, [buyer]);
ok("a server on the crew can't give it; a member can't take someone's away", !!srv.error && /owner or an admin/.test(srv.error) && !!mem.error, { srv: srv.error, mem: mem.error });

// ── who has it ───────────────────────────────────────────────────────────────────────────────────────────────────────
const st = await as(OWNER, `select * from public.course_students()`);
const b = st.rows.find((r) => r.customer_id === buyer), f = st.rows.find((r) => r.customer_id === friend);
ok("the students read: both of them — the buyer's $47 and progress (1 of 3), the friend given with the note",
  st.rows.length === 2 && b?.source === "purchase" && b?.paid_cents === 4700 && b?.done === 1 && b?.total === 3 && b?.rookie_total === 3 && b?.last_done_at !== null
    && f?.source === "comp" && f?.paid_cents === null && f?.note === "A gift — the launch" && f?.done === 0, st.rows);
ok("…the crew's only: a server reads it, a member reads nothing, a stranger can't run it",
  (await as(SERVER, `select count(*)::int n from public.course_students()`)).rows[0]?.n === 2 && (await as(FRIEND, `select count(*)::int n from public.course_students()`)).rows[0]?.n === 0
    && !!(await as(null, `select * from public.course_students()`)).error);

// ── take it back ─────────────────────────────────────────────────────────────────────────────────────────────────────
const tb = await as(OWNER, `select public.course_take_back($1) as r`, [friend]);
const after = await q1(`select revoked_at, revoked_by from public.program_access where customer_id = $1`, [friend]);
ok("taken back: revoked, by whom — and the lessons close", tb.rows[0]?.r?.revoked === 1 && after.revoked_at !== null && after.revoked_by === OWNER && (await lessons(FRIEND)) === 0, { tb, after });
ok("…given again later, it opens again", (await as(OWNER, `select public.course_give($1, 'Back') as r`, [friend])).rows[0]?.r?.already === false && (await lessons(FRIEND)) === 3);
await q(`update public.shop_orders set status = 'refunded' where id = $1`, [order]);
ok("a refund reaches only what its order gave — the buyer's closes, the friend's comp stays",
  (await q1(`select revoked_at from public.program_access where customer_id = $1`, [buyer])).revoked_at !== null && (await lessons(FRIEND)) === 3);
// an account deleted (0353): the course and its note go with them; the sale stays in the books
await q(`update public.program_access set note = 'Bought for Ana by her sister' where customer_id = $1`, [buyer]);
await q(`select public.erase_account_data($1)`, [BUYER]);
ok("an account deleted: its course and its note go with it, and the sale stays in the books",
  (await q1(`select count(*)::int n from public.program_access where customer_id = $1`, [buyer])).n === 0
    && (await q1(`select count(*)::int n from public.shop_orders where id = $1`, [order])).n === 1);
const audit = await q1(`select count(*)::int n from public.admin_audit where table_name = 'program_access'`);
ok("every change is in the audit trail", audit.n >= 4, audit);

console.log(`R47 — THE OWNER SEES WHO HAS THE COURSE (0444, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
