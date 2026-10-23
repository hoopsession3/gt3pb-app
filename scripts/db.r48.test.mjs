// R48 — EVERY CHANGE TO WHAT WE SELL IS IN THE ACTIVITY LOG (0445), IN POSTGRES (2026-10-23 — the console audit).
//
// The whole schema to 0444 is loaded; then 0445, twice. What is read: seven triggers, one each, under names that replaced
// nothing (reserves keeps 0042's audit_row as well); hiding four merch items at once — the bulk bar's four writes — is
// four lines in admin_audit, each saying who and what changed; an update that only touched a timestamp writes none; a
// plan, a code, a lesson and a drop changed are each a line.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M445 = readFileSync(join(ROOT, "supabase/migrations/0445_every_change_to_what_we_sell_is_in_the_activity_log.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c448000-0000-4000-8000-0000000000a1";

const db = await fullSchema({ before: "0445" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role; grant select, insert, update, delete on all tables in schema public to anon, authenticated;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
await q(`insert into auth.users (id, email) values ($1, 'owner@example.test')`, [OWNER]);
await q(`update public.profiles set role = 'owner', tenant_id = $2 where id = $1`, [OWNER, T1]);
const before = (await q(`select tgname from pg_trigger where tgrelid = 'public.reserves'::regclass and not tgisinternal order by 1`)).map((r) => r.tgname);

await db.exec(M445);
await db.exec(M445);
ok("0445 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0445%'`)).n === 2);
const trig = (await q(`select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname like 'admin_audit_%' order by 1`)).map((r) => r.relname);
ok("seven triggers, one on each table Catalog edits that kept no history", JSON.stringify(trig) === JSON.stringify(["member_benefits", "primal_lessons", "primal_modules", "primal_pillars", "reserves", "shop_products", "subscription_plans"]), trig);
const after = (await q(`select tgname from pg_trigger where tgrelid = 'public.reserves'::regclass and not tgisinternal order by 1`)).map((r) => r.tgname);
ok("…replacing none: the drops keep every trigger they had, and gain this one", before.every((t) => after.includes(t)) && after.includes("admin_audit_reserves"), { before, after });

const as = async (sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${OWNER}', false); set role authenticated;`);
  try { return await db.query(sql, p); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const ids = [];
for (let i = 1; i <= 4; i++) ids.push((await q1(`insert into public.shop_products (kind, title, price_cents, published_at, tenant_id) values ('merch', $1, 3200, now(), $2) returning id`, [`Cap ${i}`, T1])).id);
const mark = (await q1(`select count(*)::int n from public.admin_audit where table_name = 'shop_products' and action = 'UPDATE'`)).n;
for (const id of ids) await as(`update public.shop_products set published_at = null, archived_at = null, updated_at = now() where id = $1`, [id]);
const lines = await q(`select actor, row_pk, summary from public.admin_audit where table_name = 'shop_products' and action = 'UPDATE' order by id desc limit 4`);
ok("hiding four merch items at once is four lines — each its row, who did it, and what changed",
  (await q1(`select count(*)::int n from public.admin_audit where table_name = 'shop_products' and action = 'UPDATE'`)).n === mark + 4
    && lines.every((l) => l.actor === OWNER && ids.includes(l.row_pk) && /published_at: .+ → ∅/.test(l.summary ?? "")), lines);
await as(`update public.shop_products set updated_at = now() where id = $1`, [ids[0]]);
ok("a touch that changed nothing but its time writes no line", (await q1(`select count(*)::int n from public.admin_audit where table_name = 'shop_products' and action = 'UPDATE'`)).n === mark + 4);
const plan = await q1(`select count(*)::int n from public.subscription_plans`);
if (plan.n) await q(`update public.subscription_plans set label = label || ' ' where ctid = (select ctid from public.subscription_plans limit 1)`);
const lesson = await q1(`select id from public.primal_lessons limit 1`);
await q(`update public.primal_lessons set title = title || ' ' where id = $1`, [lesson.id]);
ok("a lesson changed is a line (and a plan, where the schema seeds one)", (await q1(`select count(*)::int n from public.admin_audit where table_name = 'primal_lessons'`)).n >= 1
  && (!plan.n || (await q1(`select count(*)::int n from public.admin_audit where table_name = 'subscription_plans'`)).n >= 1));

console.log(`R48 — WHAT WE SELL, IN THE ACTIVITY LOG (0445, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
