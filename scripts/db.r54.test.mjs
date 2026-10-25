// R54 — THE MONEY, PLAN BY PLAN (0449), IN POSTGRES (2026-10-25 — phase B of the investor-ready vision).
//
// The whole schema to 0448 is loaded; then 0449, twice. What is read: the table with RLS, the tenant stamp and the
// history, no grant to anon, nothing seeded; one row a plan; a structure must say its kind, from the five; an owner
// writes and reads it; the crew — who read the plans — can't read their money; a member sees nothing; a link's door
// (vision_shared) says nothing of it; a plan taken out takes its money with it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M449 = readFileSync(join(ROOT, "supabase/migrations/0449_the_money_plan_by_plan.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c454000-0000-4000-8000-0000000000a1";
const CREW = "0c454000-0000-4000-8000-0000000000b2";
const MEMBER = "0c454000-0000-4000-8000-0000000000c3";

const db = await fullSchema({ before: "0449" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
for (const [id, role] of [[OWNER, "owner"], [CREW, "server"], [MEMBER, "member"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
await db.exec(M449);
await db.exec(M449);
ok("0449 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0449%'`)).n === 2);
const rls = (await q1(`select relrowsecurity r from pg_class where oid = 'public.vision_plan_money'::regclass`)).r;
const trig = (await q(`select tgname from pg_trigger where tgrelid = 'public.vision_plan_money'::regclass and not tgisinternal order by 1`)).map((r) => r.tgname);
ok("RLS on, stamped, in the history, nothing for anon", rls && trig.includes("stamp_tenant_tg") && trig.includes("admin_audit_vision_plan_money")
  && !(await q1(`select has_table_privilege('anon', 'public.vision_plan_money', 'select') a`)).a, { rls, trig });
ok("nothing seeded — the numbers are Ryan's", (await q1(`select count(*)::int n from public.vision_plan_money`)).n === 0);

const plans = await q(`select id from public.vision_plans order by phase`);
const as = async (who, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const scen = JSON.stringify({ base: { ordersPerDay: 120, avgOrderCents: 900, uses: [{ label: "Bar", kind: "equipment", cents: 1200000 }] } });
const w = await as(OWNER, `insert into public.vision_plan_money (plan_id, scenarios, structure) values ($1, $2::jsonb, '{"kind":"rev_share","amountCents":5000000,"sharePct":6,"capMultiple":1.5}'::jsonb) returning id`, [plans[0].id, scen]);
ok("an owner saves a plan's money", Array.isArray(w) && w.length === 1, w);
ok("…and reads it back whole", (await as(OWNER, `select scenarios->'base'->>'ordersPerDay' o, structure->>'kind' k from public.vision_plan_money`))[0]?.o === "120");
const twice = await as(OWNER, `insert into public.vision_plan_money (plan_id) values ($1)`, [plans[0].id]);
ok("one row a plan", !!twice.error, twice);
const badKind = await as(OWNER, `insert into public.vision_plan_money (plan_id, structure) values ($1, '{"kind":"grant"}'::jsonb)`, [plans[1].id]);
ok("a structure names one of the five kinds", !!badKind.error, badKind);
const noKind = await as(OWNER, `insert into public.vision_plan_money (plan_id, structure) values ($1, '{}'::jsonb)`, [plans[1].id]);
ok("…and must name one", !!noKind.error, noKind);
ok("the crew read the plans, not their money", (await as(CREW, `select count(*)::int n from public.vision_plans`))[0]?.n === 3 && (await as(CREW, `select count(*)::int n from public.vision_plan_money`))[0]?.n === 0);
ok("…and can't write it", (await as(CREW, `insert into public.vision_plan_money (plan_id) values ($1)`, [plans[2].id])).error !== undefined);
ok("a member sees none", (await as(MEMBER, `select count(*)::int n from public.vision_plan_money`))[0]?.n === 0);
// The baseline: an owner approves it (stamped when and by whom); an admin can't; restoring is a copy, not a loss.
const ADMIN = "0c454000-0000-4000-8000-0000000000d4";
await q(`insert into auth.users (id, email) values ($1, 'admin@example.test')`, [ADMIN]);
await q(`update public.profiles set role = 'admin', tenant_id = $2 where id = $1`, [ADMIN, T1]);
const approve = await as(OWNER, `update public.vision_plan_money set baseline = jsonb_build_object('scenarios', scenarios, 'structure', structure) where plan_id = $1 returning baseline_by, baseline_at is not null stamped`, [plans[0].id]);
ok("an owner approves a baseline — stamped with who and when", approve[0]?.baseline_by === OWNER && approve[0]?.stamped === true, approve);
const adminTry = await as(ADMIN, `update public.vision_plan_money set baseline = null where plan_id = $1`, [plans[0].id]);
ok("an admin can't clear or set it (PT403)", adminTry.code === "PT403", adminTry);
const adminWork = await as(ADMIN, `update public.vision_plan_money set scenarios = jsonb_set(scenarios, '{base,ordersPerDay}', '200') where plan_id = $1 returning scenarios->'base'->>'ordersPerDay' o, baseline->'scenarios'->'base'->>'ordersPerDay' b`, [plans[0].id]);
ok("…but works the what-ifs: the working numbers move, the baseline doesn't", adminWork[0]?.o === "200" && adminWork[0]?.b === "120", adminWork);
const restore = await as(OWNER, `update public.vision_plan_money set scenarios = baseline->'scenarios', structure = baseline->'structure' where plan_id = $1 returning scenarios->'base'->>'ordersPerDay' o`, [plans[0].id]);
ok("back to baseline: the working numbers are the approved ones again", restore[0]?.o === "120", restore);
ok("the history has the owner's saves", (await q1(`select count(*)::int n from public.admin_audit where table_name = 'vision_plan_money' and actor = $1`, [OWNER])).n >= 1);
await q(`update public.vision_plans set shareable = true`);
const link = await q1(`insert into public.vision_shares (label) values ('x') returning token`);
await db.exec(`set role anon;`);
const v = (await db.query(`select public.vision_shared($1) v`, [link.token])).rows[0].v;
await db.exec(`reset role;`);
ok("a link's door says nothing of the money", !JSON.stringify(v).includes("ordersPerDay") && !JSON.stringify(v).includes("capMultiple") && v.plans.length === 3);
await q(`delete from public.vision_plans where id = $1`, [plans[0].id]);
ok("a plan taken out takes its money with it", (await q1(`select count(*)::int n from public.vision_plan_money`)).n === 0);

console.log(`R54 — THE MONEY, PLAN BY PLAN (0449, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
