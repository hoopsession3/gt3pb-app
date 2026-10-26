// R58 — ACTUAL AGAINST THE PLAN (0452), IN POSTGRES. The schema to 0451, then 0452 twice: two empty columns on the
// plans; only the five order channels; an owner or admin sets them, the crew can't; nothing set by default.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M452 = readFileSync(join(ROOT, "supabase/migrations/0452_actual_against_the_plan.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c458000-0000-4000-8000-0000000000a1", CREW = "0c458000-0000-4000-8000-0000000000b2";
const db = await fullSchema({ before: "0452" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
for (const [id, role] of [[OWNER, "owner"], [CREW, "server"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
await db.exec(M452); await db.exec(M452);
ok("0452 twice: recorded", (await q1(`select applied_count::int n from public.schema_migrations where version like '0452%'`)).n === 2);
ok("nothing set by default", (await q1(`select count(*)::int n from public.vision_plans where opened_on is not null or actual_channel is not null`)).n === 0);
const plan = (await q1(`select id from public.vision_plans order by phase limit 1`)).id;
const as = async (who, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const set = await as(OWNER, `update public.vision_plans set opened_on = '2026-08-15', actual_channel = 'cup' where id = $1 returning actual_channel`, [plan]);
ok("an owner sets when it opened and its channel", set[0]?.actual_channel === "cup", set);
ok("a channel outside the five is refused", !!(await as(OWNER, `update public.vision_plans set actual_channel = 'vibes' where id = $1`, [plan])).error);
const crew = await as(CREW, `update public.vision_plans set opened_on = '2026-01-01' where id = $1 returning id`, [plan]);
ok("the crew can't", Array.isArray(crew) ? crew.length === 0 : !!crew.error, crew);
console.log(`R58 — ACTUAL AGAINST THE PLAN (0452, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
