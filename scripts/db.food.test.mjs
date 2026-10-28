// 0459 — FOOD IS PLANNED BEFORE IT IS SOLD, IN POSTGRES (2026-10-28 — Primal Food, step 1).
//
// The schema to 0458, then 0459 twice. What is read: a food item starts as a concept or a proposal and never reaches the
// menu's table on its own; only an owner approves it or takes it live, and live needs a menu product; a target price says
// where it came from; allergens are the nine major ones; a recipe is owners' and admins' only, starts as a draft, and an
// approved version is never changed; a temperature is kept as taken, and one out of rule says what was done; only an
// owner approves a supplier; the crew logs temperatures but reads no recipe; another tenant reads nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = readFileSync(join(ROOT, "supabase/migrations/0459_food_is_planned_before_it_is_sold.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001", T2 = "00000000-0000-0000-0000-000000000002";
const OWNER = "0f459000-0000-4000-8000-0000000000a1", ADMIN = "0f459000-0000-4000-8000-0000000000d4", STAFF = "0f459000-0000-4000-8000-0000000000e5", OTHER = "0f459000-0000-4000-8000-0000000000f7";
const db = await fullSchema({ before: "0459" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'other-bar', 'Another Bar') on conflict do nothing; commit;`);
for (const [id, role, t] of [[OWNER, "owner", T1], [ADMIN, "admin", T1], [STAFF, "operator", T1], [OTHER, "owner", T2]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id.slice(-4)}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, t]);
}
const before = await q1(`select count(*)::int n from public.products`);
await db.exec(M); await db.exec(M);
ok("0459 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0459%'`)).n === 2);
const as = async (who, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const refused = (r, code) => r && r.error && (!code || r.code === code);

// ── a food item: planned, not sold ──────────────────────────────────────────────────────────────────────────────────
const [bowl] = await as(ADMIN, `insert into public.food_items (name, status, allergens) values ('Primal Beef & Sweet Potato Bowl', 'proposed', array['sesame']) returning id, status, product_id`);
ok("an admin proposes a food item", bowl?.status === "proposed" && bowl.product_id === null, bowl);
ok("…and the menu's table doesn't change", (await q1(`select count(*)::int n from public.products`)).n === before.n);
ok("a food item can't arrive approved", refused(await as(OWNER, `insert into public.food_items (name, status) values ('X', 'approved')`), "PT409"));
ok("an allergen that isn't one of the nine is refused", refused(await as(ADMIN, `insert into public.food_items (name, allergens) values ('Y', array['gluten-ish'])`)));
ok("a target price says where it came from", refused(await as(ADMIN, `update public.food_items set target_price_cents = 1400 where id = $1`, [bowl.id])));
ok("…with its source, it's kept", Array.isArray(await as(ADMIN, `update public.food_items set target_price_cents = 1400, price_source = 'Owner''s working assumption — not tested' where id = $1 returning id`, [bowl.id])));
ok("an admin can't approve it (PT403)", refused(await as(ADMIN, `update public.food_items set status = 'approved' where id = $1`, [bowl.id]), "PT403"));
{ const r = await as(OWNER, `update public.food_items set status = 'approved' where id = $1 returning approved_by`, [bowl.id]); ok("an owner approves it — in their name", Array.isArray(r) && r[0].approved_by === OWNER, r); }
ok("live needs a menu product (it can't go live on its own)", refused(await as(OWNER, `update public.food_items set status = 'live' where id = $1`, [bowl.id])));
ok("an approved item isn't deleted", refused(await as(OWNER, `delete from public.food_items where id = $1`, [bowl.id]), "PT409"));

// ── the recipe ──────────────────────────────────────────────────────────────────────────────────────────────────────
const comps = JSON.stringify([{ name: "Ground beef", raw_g: 170 }, { name: "Sweet potato", raw_g: 200 }]);
const [r1] = await as(ADMIN, `insert into public.food_recipes (food_item_id, version, portion_g, cook_loss_pct, components, method) values ($1, 1, 320, 15, $2, 'Draft method') returning id, status`, [bowl.id, comps]);
ok("a recipe starts as a draft", r1?.status === "draft");
ok("a recipe can't arrive approved", refused(await as(OWNER, `insert into public.food_recipes (food_item_id, version, portion_g, status) values ($1, 2, 300, 'approved')`, [bowl.id]), "PT409"));
ok("an admin can't approve a recipe (PT403)", refused(await as(ADMIN, `update public.food_recipes set status = 'approved' where id = $1`, [r1.id]), "PT403"));
ok("an owner approves it", Array.isArray(await as(OWNER, `update public.food_recipes set status = 'approved' where id = $1 returning id`, [r1.id])));
ok("an approved recipe is never changed", refused(await as(OWNER, `update public.food_recipes set portion_g = 300 where id = $1`, [r1.id]), "PT409"));
ok("…nor deleted", refused(await as(OWNER, `delete from public.food_recipes where id = $1`, [r1.id]), "PT409"));
ok("…a new version is how it changes", Array.isArray(await as(ADMIN, `insert into public.food_recipes (food_item_id, version, portion_g, components) values ($1, 2, 300, $2) returning id`, [bowl.id, comps])));
ok("the crew can't read a recipe", (await as(STAFF, `select count(*)::int n from public.food_recipes`))[0]?.n === 0);
ok("…nor the food plan", (await as(STAFF, `select count(*)::int n from public.food_items`))[0]?.n === 0);
ok("signed out reaches neither", await (async () => { await db.exec(`set role anon;`); try { await db.query(`select 1 from public.food_recipes`); return false; } catch { return true; } finally { await db.exec(`reset role;`); } })());

// ── temperatures ────────────────────────────────────────────────────────────────────────────────────────────────────
const [t1] = await as(STAFF, `insert into public.food_temp_logs (kind, reading_f, what, within_rule) values ('cold_hold', 38, 'Walk-in, beef lot', true) returning id, logged_by`);
ok("the crew logs a temperature — in their own name", t1?.logged_by === STAFF, t1);
ok("an out-of-rule reading needs what was done", refused(await as(STAFF, `insert into public.food_temp_logs (kind, reading_f, what, within_rule) values ('hot_hold', 120, 'Bowl line', false)`)));
ok("…said, it's kept", Array.isArray(await as(STAFF, `insert into public.food_temp_logs (kind, reading_f, what, within_rule, corrective_action) values ('hot_hold', 120, 'Bowl line', false, 'Discarded the pan; reheated a fresh one') returning id`)));
{ const r = await as(OWNER, `update public.food_temp_logs set reading_f = 40 where id = $1 returning id`, [t1.id]); ok("a reading is kept as taken — nobody signed in can edit it", (refused(r) || (Array.isArray(r) && r.length === 0)) && Number((await q1(`select reading_f from public.food_temp_logs where id = $1`, [t1.id])).reading_f) === 38, r); }
ok("…not even the service role (PT409)", await q(`update public.food_temp_logs set reading_f = 40 where id = $1`, [t1.id]).then(() => false, (e) => e.code === "PT409"));
ok("…and it isn't deleted", await q(`delete from public.food_temp_logs where id = $1`, [t1.id]).then(() => false, (e) => e.code === "PT409"));

// ── suppliers, lots ─────────────────────────────────────────────────────────────────────────────────────────────────
const v = await q1(`insert into public.vendors (name, kind) values ('Upstate Grass Beef', 'supplier') returning id, approval_status`);
ok("a supplier starts unreviewed", v.approval_status === "unreviewed");
ok("an admin can't approve a supplier (PT403)", refused(await as(ADMIN, `update public.vendors set approval_status = 'approved' where id = $1`, [v.id]), "PT403"));
{ const r = await as(OWNER, `update public.vendors set approval_status = 'conditional', approval_note = 'Waiting on their inspection report' where id = $1 returning approved_by`, [v.id]); ok("an owner decides — in their name", Array.isArray(r) && r[0].approved_by === OWNER, r); }
ok("an admin still edits a supplier's other details", Array.isArray(await as(ADMIN, `update public.vendors set notes = 'Delivers Tuesdays' where id = $1 returning id`, [v.id])));
ok("a lot carries a use-by and its allergens (the nine)", (await q1(`select count(*)::int n from information_schema.columns where table_name = 'inventory_lots' and column_name in ('use_by','allergens')`)).n === 2);

// ── another tenant ──────────────────────────────────────────────────────────────────────────────────────────────────
const o = await as(OTHER, `select (select count(*) from public.food_items)::int i, (select count(*) from public.food_recipes)::int r, (select count(*) from public.food_temp_logs)::int t`);
ok("another tenant's owner reads none of it", Array.isArray(o) && o[0].i === 0 && o[0].r === 0 && o[0].t === 0, o);

console.log(`0459 — FOOD IS PLANNED BEFORE IT IS SOLD (in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
