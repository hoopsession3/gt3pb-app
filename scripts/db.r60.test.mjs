// R60 — RESEARCH ON A SCHEDULE (0453), IN POSTGRES. The schema to 0452, then 0453 twice: every plan starts at "never";
// 30, 60 or 90 days only; an owner sets it, the crew can't.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M453 = readFileSync(join(ROOT, "supabase/migrations/0453_research_on_a_schedule.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c460000-0000-4000-8000-0000000000a1", CREW = "0c460000-0000-4000-8000-0000000000b2";
const db = await fullSchema({ before: "0453" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
for (const [id, role] of [[OWNER, "owner"], [CREW, "server"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
await db.exec(M453); await db.exec(M453);
ok("0453 twice: recorded", (await q1(`select applied_count::int n from public.schema_migrations where version like '0453%'`)).n === 2);
ok("every plan starts at never", (await q1(`select count(*)::int n from public.vision_plans where research_every_days <> 0`)).n === 0);
const plan = (await q1(`select id from public.vision_plans order by phase limit 1`)).id;
const as = async (who, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
ok("an owner sets every 30 days", (await as(OWNER, `update public.vision_plans set research_every_days = 30, research_by = $2 where id = $1 returning research_every_days`, [plan, OWNER]))[0]?.research_every_days === 30);
ok("…not every 7", !!(await as(OWNER, `update public.vision_plans set research_every_days = 7 where id = $1`, [plan])).error);
const crew = await as(CREW, `update public.vision_plans set research_every_days = 90 where id = $1 returning id`, [plan]);
ok("the crew can't", Array.isArray(crew) ? crew.length === 0 : !!crew.error, crew);
console.log(`R60 — RESEARCH ON A SCHEDULE (0453, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
