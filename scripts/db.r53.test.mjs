// R53 — A PLAN FOR EVERY WAY IN (0448), IN POSTGRES (2026-10-25 — Ryan: "allow for the brick and mortar to have
// phases… a bar that's rented out from a gym… lease versus buy… partnering with a coffee shop… multiple plans built out
// and saved… each plan its own database record with its own requirements").
//
// The whole schema to 0447 is loaded; then 0448, twice. What is read: three tables with RLS, the tenant stamp and the
// history; the first draft — three plans in phases for the first store, 14 needs, the storefront waiting on the gym bar,
// the storefront's room the 0447 draft — once; a loop of waits refused (PT409), however far round; the crew read, an
// owner writes, a member sees nothing; a link shows only plans marked shareable, and their asks, needs and waits — never
// a need's owner or note; an expired link is PT404, the same as a wrong one.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M448 = readFileSync(join(ROOT, "supabase/migrations/0448_a_plan_for_every_way_in.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c453000-0000-4000-8000-0000000000a1";
const CREW = "0c453000-0000-4000-8000-0000000000b2";
const MEMBER = "0c453000-0000-4000-8000-0000000000c3";

const db = await fullSchema({ before: "0448" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
for (const [id, role] of [[OWNER, "owner"], [CREW, "server"], [MEMBER, "member"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
const storeAsksBefore = (await q1(`select count(*)::int n from public.vision_asks`)).n;

await db.exec(M448);
await db.exec(M448);
ok("0448 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0448%'`)).n === 2);

for (const t of ["vision_plans", "vision_plan_needs", "vision_plan_deps"]) {
  const rls = (await q1(`select relrowsecurity r from pg_class where oid = ('public.' || $1)::regclass`, [t])).r;
  const trig = (await q(`select tgname from pg_trigger where tgrelid = ('public.' || $1)::regclass and not tgisinternal order by 1`, [t])).map((r) => r.tgname);
  const anon = (await q1(`select has_table_privilege('anon', 'public.' || $1, 'select') a`, [t])).a;
  ok(`${t}: RLS on, stamped, in the history, nothing for anon`, rls && trig.includes("stamp_tenant_tg") && trig.includes(`admin_audit_${t}`) && !anon, { rls, trig, anon });
}

// ── the first draft ────────────────────────────────────────────────────────────────────────────────────────────────
const plans = await q(`select id, name, format, phase, sqft, deal, layout_id, shareable from public.vision_plans order by phase`);
ok("the first draft, once: three plans in phases — a gym bar, a partner café's menu, the storefront",
  plans.length === 3 && plans.map((p) => `${p.phase}:${p.format}`).join() === "1:gym_bar,2:partner_menu,3:storefront_lease", plans.map((p) => `${p.phase}:${p.format}`));
const lay = (await q1(`select layout_id from public.vision_programs where title = 'The first store'`)).layout_id;
ok("…the storefront is the 0447 room, 1,200 sq ft on a lease", plans[2].layout_id === lay && plans[2].sqft === 1200 && plans[2].deal === "lease");
ok("…every draft plan is private until marked to show", plans.every((p) => p.shareable === false));
ok("…14 needs, Ryan's six on the storefront", (await q1(`select count(*)::int n from public.vision_plan_needs`)).n === 14
  && (await q1(`select count(*)::int n from public.vision_plan_needs where plan_id = $1`, [plans[2].id])).n === 6);
ok("…the storefront waits on the gym bar", (await q1(`select count(*)::int n from public.vision_plan_deps where plan_id = $1 and needs_plan_id = $2`, [plans[2].id, plans[0].id])).n === 1);
ok("…no numbers invented: gates say what to set; the asks are untouched", (await q1(`select count(*)::int n from public.vision_plans where gate ~ '\\d{2,}'`)).n === 0
  && (await q1(`select count(*)::int n from public.vision_asks`)).n === storeAsksBefore);

// ── a loop is refused ──────────────────────────────────────────────────────────────────────────────────────────────
let loop = null;
try { await q(`insert into public.vision_plan_deps (plan_id, needs_plan_id) values ($1, $2)`, [plans[0].id, plans[2].id]); } catch (e) { loop = e; }
ok("a wait that closes a loop (the gym bar on the storefront): PT409, said plainly", loop?.code === "PT409" && /loop/.test(loop.message), loop?.message);
await q(`insert into public.vision_plan_deps (plan_id, needs_plan_id) values ($1, $2)`, [plans[1].id, plans[0].id]);
loop = null;
try { await q(`insert into public.vision_plan_deps (plan_id, needs_plan_id) values ($1, $2)`, [plans[0].id, plans[1].id]); } catch (e) { loop = e; }
ok("…and two steps round, too", loop?.code === "PT409", loop?.message);
loop = null;
try { await q(`insert into public.vision_plan_deps (plan_id, needs_plan_id) values ($1, $1)`, [plans[0].id]); } catch (e) { loop = e; }
ok("…and a plan on itself", !!loop);
let bad = null;
try { await q(`insert into public.vision_plans (program_id, name, format) select program_id, 'x', 'espresso_bar' from public.vision_plans limit 1`); } catch (e) { bad = e.message; }
ok("a format outside the list is refused", !!bad);

// ── who sees what ──────────────────────────────────────────────────────────────────────────────────────────────────
const as = async (who, sql, p) => {
  await db.exec(who ? `select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;` : `set role anon;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
ok("the crew read the plans", (await as(CREW, `select count(*)::int n from public.vision_plans`))[0]?.n === 3);
ok("…but don't change them", (await as(CREW, `update public.vision_plans set name = name || '!' returning id`)).length === 0);
ok("a member sees none", (await as(MEMBER, `select count(*)::int n from public.vision_plan_needs`))[0]?.n === 0);
const ow = await as(OWNER, `update public.vision_plan_needs set done_on = current_date, owner = 'Ryan', note = 'internal' where plan_id = $1 and kind = 'site' returning id`, [plans[0].id]);
ok("an owner marks a need done", Array.isArray(ow) && ow.length === 1, ow);

// ── a link ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const link = await q1(`insert into public.vision_shares (label) values ('For a partner') returning token, id`);
const v0 = (await as(null, `select public.vision_shared($1) v`, [link.token]))[0]?.v;
ok("a link shows no plan until one is marked to show", v0 && v0.plans.length === 0 && v0.programs.length === 7, v0 && v0.plans.length);
await q(`update public.vision_shares set show_asks = true where id = $1`, [link.id]);
await q(`insert into public.vision_asks (program_id, plan_id, label, amount_cents, state) select program_id, id, 'Gym bar equipment', 0, 'open' from public.vision_plans where phase = 1`);
await q(`insert into public.vision_asks (program_id, plan_id, label, amount_cents, state) select program_id, id, 'Storefront build-out', 0, 'open' from public.vision_plans where phase = 3`);
await q(`update public.vision_plans set shareable = true where phase in (1, 3)`);
const v1 = (await as(null, `select public.vision_shared($1) v`, [link.token]))[0]?.v;
const gym = v1?.plans.find((p) => p.phase === 1), shop = v1?.plans.find((p) => p.phase === 3);
ok("marked to show: the gym bar and the storefront, in phase order", v1 && v1.plans.map((p) => p.phase).join() === "1,3", v1?.plans.map((p) => p.phase));
ok("…their needs, but never who owns one or its note", gym && gym.needs.length === 5 && !JSON.stringify(v1.plans).includes("internal") && !JSON.stringify(v1.plans).includes("Ryan") && gym.needs.some((n) => n.done_on));
ok("…the storefront's wait on the gym bar (both shown)", shop && shop.waits_on.length === 1 && shop.waits_on[0] === gym.id, shop?.waits_on);
ok("…a hidden plan's asks stay hidden; a shown plan's show", v1.asks.some((a) => a.label === "Storefront build-out") && v1.asks.some((a) => a.label === "Gym bar equipment")
  && !v1.asks.some((a) => a.plan_id === plans[1].id));
await q(`update public.vision_plans set shareable = false where phase = 1`);
const v2 = (await as(null, `select public.vision_shared($1) v`, [link.token]))[0]?.v;
ok("a wait on a hidden plan isn't shown either", v2.plans.length === 1 && v2.plans[0].waits_on.length === 0 && !v2.asks.some((a) => a.label === "Gym bar equipment"), v2.plans);
await q(`update public.vision_shares set expires_at = now() + interval '7 days' where id = $1`, [link.id]);
ok("a link with an end date, before it: opens, and says when it ends", !!(await as(null, `select public.vision_shared($1) v`, [link.token]))[0]?.v?.expires_at);
await q(`update public.vision_shares set expires_at = now() - interval '1 minute' where id = $1`, [link.id]);
const gone = await as(null, `select public.vision_shared($1) v`, [link.token]);
ok("…after it: PT404, the same as a wrong link", gone.code === "PT404", gone);

console.log(`R53 — A PLAN FOR EVERY WAY IN (0448, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
