// R61 — THE PLAN'S CASE IN WORDS (0454), IN POSTGRES. The schema to 0453, then 0454 twice: three empty words on the
// plans; risks with their ratings and status, RLS on, in the history; the crew read, owners write; a link shows the risks
// only with the case an owner chose; a plan taken out takes its risks.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M454 = readFileSync(join(ROOT, "supabase/migrations/0454_the_plans_case_in_words.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c461000-0000-4000-8000-0000000000a1", CREW = "0c461000-0000-4000-8000-0000000000b2";
const db = await fullSchema({ before: "0454" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
for (const [id, role] of [[OWNER, "owner"], [CREW, "server"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
await db.exec(M454); await db.exec(M454);
ok("0454 twice: recorded", (await q1(`select applied_count::int n from public.schema_migrations where version like '0454%'`)).n === 2);
const trig = (await q(`select tgname from pg_trigger where tgrelid = 'public.vision_plan_risks'::regclass and not tgisinternal`)).map((r) => r.tgname);
ok("risks: RLS on, stamped, in the history", (await q1(`select relrowsecurity r from pg_class where oid = 'public.vision_plan_risks'::regclass`)).r && trig.includes("stamp_tenant_tg") && trig.includes("admin_audit_vision_plan_risks"));
const plans = await q(`select id from public.vision_plans order by phase`);
const gym = plans[0].id;
const as = async (who, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
ok("an owner writes who it's for", (await as(OWNER, `update public.vision_plans set customer = 'Members who train before work' where id = $1 returning customer`, [gym]))[0]?.customer === "Members who train before work");
const r = await as(OWNER, `insert into public.vision_plan_risks (plan_id, kind, words, likelihood, impact) values ($1, 'risk', 'The gym ends the deal', 'medium', 'high') returning id, status`, [gym]);
ok("…and a risk — open by default", r[0]?.status === "open", r);
ok("a rating outside low, medium, high is refused", !!(await as(OWNER, `insert into public.vision_plan_risks (plan_id, words, likelihood) values ($1, 'x', 'huge')`, [gym])).error);
ok("the crew read the risks, and can't write them", (await as(CREW, `select count(*)::int n from public.vision_plan_risks`))[0]?.n === 1 && !!(await as(CREW, `insert into public.vision_plan_risks (plan_id, words) values ($1, 'x')`, [gym])).error);
await q(`update public.vision_plans set shareable = true`);
const link = await q1(`insert into public.vision_shares (label) values ('x') returning id, token`);
const door = async () => { await db.exec(`set role anon;`); try { return (await db.query(`select public.vision_shared($1) v`, [link.token])).rows[0].v; } finally { await db.exec(`reset role;`); } };
let v = await door();
ok("a link shows who it's for with the plan — but no risks without the case", v.plans.find((p) => p.id === gym).customer === "Members who train before work" && v.plans.find((p) => p.id === gym).risks == null);
await q(`update public.vision_shares set money_plans = array[$1::uuid] where id = $2`, [gym, link.id]);
v = await door();
ok("…and its risks once an owner chose to show its case", v.plans.find((p) => p.id === gym).risks?.[0]?.words === "The gym ends the deal");
await q(`delete from public.vision_plans where id = $1`, [gym]);
ok("a plan taken out takes its risks", (await q1(`select count(*)::int n from public.vision_plan_risks`)).n === 0);
console.log(`R61 — THE CASE IN WORDS (0454, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
