// R57 — THE INVESTOR CASE (0451), IN POSTGRES (2026-10-25 — phase E of the investor-ready vision).
//
// The whole schema to 0450 is loaded; then 0451, twice. What is read: a link shows nothing of the money by default; only
// an owner can choose a plan's case for a link (an admin is refused, PT403); a chosen plan shows its approved baseline
// — never the working numbers — and only its accepted research; a plan without a baseline shows none; an expired link
// shows nothing at all.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M451 = readFileSync(join(ROOT, "supabase/migrations/0451_the_investor_case.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c457000-0000-4000-8000-0000000000a1";
const ADMIN = "0c457000-0000-4000-8000-0000000000d4";

const db = await fullSchema({ before: "0451" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
for (const [id, role] of [[OWNER, "owner"], [ADMIN, "admin"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
await db.exec(M451);
await db.exec(M451);
ok("0451 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0451%'`)).n === 2);

const plans = await q(`select id from public.vision_plans order by phase`);
const [gym, cafe] = [plans[0].id, plans[1].id];
await q(`update public.vision_plans set shareable = true`);
// The gym bar: approved baseline 120 a day; working numbers since moved to 200. Research: one accepted, one proposed.
await q(`insert into public.vision_plan_money (plan_id, scenarios, structure, baseline) values ($1, '{"base":{"ordersPerDay":200}}', '{"kind":"none"}', '{"scenarios":{"base":{"ordersPerDay":120}},"structure":{"kind":"none"}}')`, [gym]);
await q(`insert into public.vision_research (plan_id, topic, claim, source_url, status) values ($1, 'demand', 'Accepted claim.', 'https://a.example', 'accepted'), ($1, 'demand', 'Proposed claim.', 'https://p.example', 'proposed')`, [gym]);
const as = async (who, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const link = await q1(`insert into public.vision_shares (label) values ('Investors') returning id, token`);
const door = async (token) => { await db.exec(`set role anon;`); try { return (await db.query(`select public.vision_shared($1) v`, [token])).rows[0].v; } catch (e) { return { error: e.message }; } finally { await db.exec(`reset role;`); } };
const v0 = await door(link.token);
ok("by default a link shows no plan's money or research", v0.plans.length === 3 && v0.plans.every((p) => p.money == null && p.research == null), v0.plans.map((p) => [p.money, p.research]));
const adminTry = await as(ADMIN, `update public.vision_shares set money_plans = array[$1::uuid] where id = $2`, [gym, link.id]);
ok("an admin can't choose what a link shows of the money (PT403)", adminTry.code === "PT403", adminTry);
const ownerSet = await as(OWNER, `update public.vision_shares set money_plans = array[$1::uuid, $2::uuid], research_plans = array[$1::uuid] where id = $3 returning id`, [gym, cafe, link.id]);
ok("an owner can", Array.isArray(ownerSet) && ownerSet.length === 1, ownerSet);
ok("…and an admin still turns the link off, as before", Array.isArray(await as(ADMIN, `update public.vision_shares set label = 'Investors, Oct' where id = $1 returning id`, [link.id])));
const v1 = await door(link.token);
const g = v1.plans.find((p) => p.id === gym), c = v1.plans.find((p) => p.id === cafe);
ok("the chosen plan shows its approved baseline — 120, not the working 200", g.money?.baseline?.scenarios?.base?.ordersPerDay === 120 && !JSON.stringify(g).includes("200"), g.money);
ok("…and its accepted research only", g.research?.length === 1 && g.research[0].claim === "Accepted claim.", g.research);
ok("a chosen plan with no approved baseline shows none", c.money == null && c.research == null);
await q(`update public.vision_shares set expires_at = now() - interval '1 minute' where id = $1`, [link.id]);
ok("an expired link shows nothing at all", !!(await door(link.token)).error);
const ownerInsert = await as(OWNER, `insert into public.vision_shares (label, money_plans) values ('x', array[$1::uuid]) returning id`, [gym]);
const adminInsert = await as(ADMIN, `insert into public.vision_shares (label, money_plans) values ('y', array[$1::uuid]) returning id`, [gym]);
ok("making a link with the money: an owner may, an admin may not", Array.isArray(ownerInsert) && adminInsert.code === "PT403", { ownerInsert, adminInsert });

console.log(`R57 — THE INVESTOR CASE (0451, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
