// R56 — WHAT THE MARKET SAYS (0450), IN POSTGRES (2026-10-25 — phase D of the investor-ready vision).
//
// The whole schema to 0449 is loaded; then 0450, twice. What is read: the table with RLS, the tenant stamp and the
// history, no grant to anon, nothing seeded; https sources only; the six topics; proposed by default; an owner writes,
// accepts and reads; the crew and a member see nothing; a link's door says nothing of it; a plan taken out takes it along.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M450 = readFileSync(join(ROOT, "supabase/migrations/0450_what_the_market_says.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c456000-0000-4000-8000-0000000000a1";
const CREW = "0c456000-0000-4000-8000-0000000000b2";
const MEMBER = "0c456000-0000-4000-8000-0000000000c3";

const db = await fullSchema({ before: "0450" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
for (const [id, role] of [[OWNER, "owner"], [CREW, "server"], [MEMBER, "member"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
await db.exec(M450);
await db.exec(M450);
ok("0450 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0450%'`)).n === 2);
const rls = (await q1(`select relrowsecurity r from pg_class where oid = 'public.vision_research'::regclass`)).r;
const trig = (await q(`select tgname from pg_trigger where tgrelid = 'public.vision_research'::regclass and not tgisinternal order by 1`)).map((r) => r.tgname);
ok("RLS on, stamped, in the history, nothing for anon", rls && trig.includes("stamp_tenant_tg") && trig.includes("admin_audit_vision_research")
  && !(await q1(`select has_table_privilege('anon', 'public.vision_research', 'select') a`)).a, { rls, trig });
ok("nothing seeded — research is run, never written in", (await q1(`select count(*)::int n from public.vision_research`)).n === 0);

const plans = await q(`select id from public.vision_plans order by phase`);
const as = async (who, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const ins = (who, topic, url, plan = plans[0].id) => as(who, `insert into public.vision_research (plan_id, topic, claim, source_url) values ($1, $2, 'The gym has 2,400 members.', $3) returning id, status`, [plan, topic, url]);
const w = await ins(OWNER, "demand", "https://gym.example/members");
ok("an owner stores a finding — proposed until accepted", Array.isArray(w) && w[0]?.status === "proposed", w);
ok("an http source is refused — https only", !!(await ins(OWNER, "demand", "http://gym.example/members")).error);
ok("a topic outside the six is refused", !!(await ins(OWNER, "vibes", "https://gym.example/members")).error);
ok("an empty claim is refused", !!(await as(OWNER, `insert into public.vision_research (plan_id, topic, claim, source_url) values ($1, 'demand', '', 'https://x.example')`, [plans[0].id])).error);
const acc = await as(OWNER, `update public.vision_research set status = 'accepted', reviewed_at = now() where id = $1 returning status`, [w[0].id]);
ok("…and accepts it", acc[0]?.status === "accepted", acc);
ok("accepting records which way it bears on the plan; a bearing outside the three is refused", (await as(OWNER, `update public.vision_research set bearing = 'for' where id = $1 returning bearing`, [w[0].id]))[0]?.bearing === "for" && !!(await as(OWNER, `update public.vision_research set bearing = 'maybe' where id = $1`, [w[0].id])).error);
ok("a status outside the three is refused", !!(await as(OWNER, `update public.vision_research set status = 'maybe' where id = $1`, [w[0].id])).error);
ok("the crew read the plans, not their research", (await as(CREW, `select count(*)::int n from public.vision_plans`))[0]?.n === 3 && (await as(CREW, `select count(*)::int n from public.vision_research`))[0]?.n === 0);
ok("…and can't write it", (await ins(CREW, "demand", "https://gym.example/x")).error !== undefined);
ok("a member sees none", (await as(MEMBER, `select count(*)::int n from public.vision_research`))[0]?.n === 0);
ok("the history has the owner's writes", (await q1(`select count(*)::int n from public.admin_audit where table_name = 'vision_research' and actor = $1`, [OWNER])).n >= 2);
await q(`update public.vision_plans set shareable = true`);
const link = await q1(`insert into public.vision_shares (label) values ('x') returning token`);
await db.exec(`set role anon;`);
const v = (await db.query(`select public.vision_shared($1) v`, [link.token])).rows[0].v;
await db.exec(`reset role;`);
ok("a link's door says nothing of the research", !JSON.stringify(v).includes("gym.example") && v.plans.length === 3);
await q(`delete from public.vision_plans where id = $1`, [plans[0].id]);
ok("a plan taken out takes its research with it", (await q1(`select count(*)::int n from public.vision_research`)).n === 0);

console.log(`R56 — WHAT THE MARKET SAYS (0450, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
