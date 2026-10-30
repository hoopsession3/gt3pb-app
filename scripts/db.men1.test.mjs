// 0460 — WHAT WE SELL AND WHAT IT EARNS, IN POSTGRES (MEN1, 2026-10-30).
//
// The schema to 0459, then 0460 twice. What is read: the catalog stays public.products and gains its selling size (said
// as actual, estimated or scenario); a serving's other costs are owners' and admins' only, each number with its basis and
// a source; what a product needs is a fixed list of capabilities; a location's assortment starts planned, and only an
// owner approves it or calls it ready — stamped by the database; unavailable or retired says why; the Standard can judge
// a product; another tenant reads nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = readFileSync(join(ROOT, "supabase/migrations/0460_what_we_sell_and_what_it_earns.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001", T2 = "00000000-0000-0000-0000-000000000002";
const OWNER = "0f460000-0000-4000-8000-0000000000a1", ADMIN = "0f460000-0000-4000-8000-0000000000d4", STAFF = "0f460000-0000-4000-8000-0000000000e5", OTHER = "0f460000-0000-4000-8000-0000000000f7";
const db = await fullSchema({ before: "0460" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'other-bar', 'Another Bar') on conflict do nothing; commit;`);
for (const [id, role, t] of [[OWNER, "owner", T1], [ADMIN, "admin", T1], [STAFF, "operator", T1], [OTHER, "owner", T2]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id.slice(-4)}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, t]);
}
await db.exec(M); await db.exec(M);
ok("0460 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0460%'`)).n === 2);
const as = async (who, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const refused = (r, code) => r && r.error && (!code || r.code === code);
const anon = async (sql) => { await db.exec(`set role anon;`); try { return (await db.query(sql)).rows; } catch (e) { return { error: e.message }; } finally { await db.exec(`reset role;`); } };

// ── the one catalog ────────────────────────────────────────────────────────────────────────────────────────────────
const [p] = await q(`insert into public.products (slug, name, price_cents, line) values ('men1-rise', 'TEST RISE', 1000, 'Activation') returning id`);
const [p2] = await q(`insert into public.products (slug, name, price_cents, line) values ('men1-tide', 'TEST TIDE', 1200, 'Hydration') returning id`);
ok("a selling size starts unknown", (await q1(`select serving_oz from public.products where id = $1`, [p.id])).serving_oz === null);
ok("a selling size is between 1 and 64 oz", refused(await as(ADMIN, `update public.products set serving_oz = 80 where id = $1`, [p.id])));
const sized = await as(ADMIN, `update public.products set serving_oz = 16, serving_basis = 'actual' where id = $1 returning serving_oz`, [p.id]);
ok("an admin says it, and whether it's actual", Number(sized[0]?.serving_oz) === 16, sized);

// ── a serving's other costs: owners and admins, each number with its basis and a source ──────────────────────────────
ok("a number without its basis is refused", refused(await as(ADMIN, `insert into public.product_unit_assumptions (product_id, packaging_cents, source) values ($1, 60, 'quote')`, [p.id])));
ok("a number without a source is refused", refused(await as(ADMIN, `insert into public.product_unit_assumptions (product_id, packaging_cents, packaging_basis) values ($1, 60, 'estimated')`, [p.id])));
ok("a service time's basis is measured, estimated or unvalidated", refused(await as(ADMIN, `insert into public.product_unit_assumptions (product_id, service_seconds, service_basis, source) values ($1, 60, 'actual', 'stopwatch')`, [p.id])));
const [ua] = await as(ADMIN, `insert into public.product_unit_assumptions (product_id, packaging_cents, packaging_basis, waste_pct, waste_basis, service_seconds, service_basis, source, as_of) values ($1, 60, 'estimated', 8, 'estimated', 75, 'unvalidated', 'owner estimate, to be measured', '2026-10-30') returning updated_by, tenant_id`, [p.id]);
ok("an admin writes them; the database stamps who", ua?.updated_by === ADMIN && ua.tenant_id === T1, ua);
const staffRead = await as(STAFF, `select count(*)::int n from public.product_unit_assumptions`);
ok("the crew reads no costs", Array.isArray(staffRead) ? staffRead[0].n === 0 : refused(staffRead), staffRead);
ok("nobody signed out reads them", refused(await anon(`select * from public.product_unit_assumptions`)));
ok("another tenant reads nothing", (await as(OTHER, `select count(*)::int n from public.product_unit_assumptions`))[0]?.n === 0);

// ── what a product needs ────────────────────────────────────────────────────────────────────────────────────────────
ok("a capability is one of the fixed list (never an object's name)", refused(await as(ADMIN, `insert into public.product_requirements (product_id, capability) values ($1, 'Cold-brew & nitro taps')`, [p.id])));
await as(ADMIN, `insert into public.product_requirements (product_id, capability) values ($1, 'cold_dispense'), ($1, 'cold_storage')`, [p.id]);
ok("the crew can read what a product needs", (await as(STAFF, `select count(*)::int n from public.product_requirements where product_id = $1`, [p.id]))[0]?.n === 2);
ok("…but can't change it", refused(await as(STAFF, `insert into public.product_requirements (product_id, capability) values ($1, 'ice')`, [p.id])) || (await q1(`select count(*)::int n from public.product_requirements where product_id = $1 and capability = 'ice'`, [p.id])).n === 0);

// ── a location's assortment ─────────────────────────────────────────────────────────────────────────────────────────
const plan = await q1(`select id from public.vision_plans order by created_at limit 1`);
const [la] = await as(ADMIN, `insert into public.location_assortments (plan_id, product_id) values ($1, $2) returning state, decided_by`, [plan.id, p.id]);
ok("an admin plans an offering: planned, nobody's decision yet", la?.state === "planned" && la.decided_by === null, la);
ok("an admin can't approve it (an owner's word)", refused(await as(ADMIN, `update public.location_assortments set state = 'approved' where plan_id = $1 and product_id = $2`, [plan.id, p.id]), "PT403"));
ok("…nor plan it straight in as ready", refused(await as(ADMIN, `insert into public.location_assortments (plan_id, product_id, state) values ($1, $2, 'ready')`, [plan.id, p2.id]), "PT403"));
const appr = await as(OWNER, `update public.location_assortments set state = 'approved' where plan_id = $1 and product_id = $2 returning state, decided_by, decided_at`, [plan.id, p.id]);
ok("an owner approves it; the database stamps who and when", appr[0]?.state === "approved" && appr[0].decided_by === OWNER && !!appr[0].decided_at, appr);
ok("nobody writes who decided by hand", refused(await as(OWNER, `update public.location_assortments set decided_by = $3 where plan_id = $1 and product_id = $2`, [plan.id, p.id, ADMIN]), "PT409"));
ok("unavailable says why", refused(await as(ADMIN, `update public.location_assortments set state = 'unavailable' where plan_id = $1 and product_id = $2`, [plan.id, p.id])));
const un = await as(ADMIN, `update public.location_assortments set state = 'unavailable', reason = 'the reach-in is out for repair' where plan_id = $1 and product_id = $2 returning state`, [plan.id, p.id]);
ok("…and with a reason, an admin can mark it (taking it off is not approving it)", un[0]?.state === "unavailable", un);
ok("one row a product a location", refused(await as(ADMIN, `insert into public.location_assortments (plan_id, product_id) values ($1, $2)`, [plan.id, p.id])));
ok("the crew reads no assortment plans", (await as(STAFF, `select count(*)::int n from public.location_assortments`))[0]?.n === 0);

// ── the Standard can judge a product ───────────────────────────────────────────────────────────────────────────────
ok("std_subject_ok knows a product", (await q1(`select public.std_subject_ok('product', $1, $2) ok`, [p.id, T1])).ok === true);
ok("…not another tenant's", (await q1(`select public.std_subject_ok('product', $1, $2) ok`, [p.id, T2])).ok === false);
const [ver] = await as(OWNER, `insert into public.std_versions (label, summary) values ('v-men1', 'test') returning id`);
const cr = await as(OWNER, `insert into public.std_criteria (version_id, pillar, code, title, requirement, applies_to, severity) values ($1, 'fuel', 'FUEL-P1', 'Ingredients named', 'Every ingredient is named with its source', 'product', 'high') returning id, applies_to`, [ver.id]);
ok("a Fuel criterion can apply to a product", cr[0]?.applies_to === "product", cr);
const evd = await as(ADMIN, `insert into public.std_evidence (subject_type, subject_id, kind, summary) values ('product', $1, 'declared', 'Supplier spec sheet') returning subject_type`, [p.id]);
ok("evidence can be about a product", evd[0]?.subject_type === "product", evd);
ok("a product of another tenant can't carry evidence", refused(await as(OTHER, `insert into public.std_evidence (subject_type, subject_id, kind, summary) values ('product', $1, 'declared', 'x')`, [p.id])));
ok("the old subject types still stand", (await q1(`select count(*)::int n from pg_constraint where conname = 'std_evidence_subject_type_check' and pg_get_constraintdef(oid) like '%room%object%material%product%'`)).n === 1);

console.log(`0460 — WHAT WE SELL AND WHAT IT EARNS (in Postgres): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
