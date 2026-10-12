// 0382 — MERCH, RECIPES AND LESSONS ARE WRITTEN BY OWNERS AND ADMINS, executed from its file against the whole schema
// (every migration before it, in order: scripts/fixtures/schema.full.mjs), acting as each kind of person the way
// PostgREST does.
//
// The finding, as a sentence: 0352 said the Catalog's panels write "under the policies they had (0351: owner or admin)",
// but merch (shop_products), recipes (product_components) and lessons (primal_lessons) were writable by any staff role.
// Shown first on the schema as production has it, then closed, then everything that must keep working is run: owners
// and admins still write all three, every role still reads what it read, the crew's 86 (products.sold_out, 0351) still
// works for a server, and the tenant wall still holds.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F382 = "0382_merch_recipes_and_lessons_are_written_by_owners_and_admins.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001", T2 = "00000000-0000-0000-0000-000000000002";
const OWNER = "0c1b0000-0000-4000-8000-0000000000b1", ADMIN = "0c1b0000-0000-4000-8000-0000000000b2",
  SERVER = "0c1b0000-0000-4000-8000-0000000000b3", EVENTM = "0c1b0000-0000-4000-8000-0000000000b4",
  MEMBER = "0c1b0000-0000-4000-8000-0000000000b5", OTHER = "0c1b0000-0000-4000-8000-0000000000b6";

const t0 = Date.now();
const db = await fullSchema({ before: "0382" });
console.log(`the schema before 0382 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, n: r.affectedRows ?? r.rows.length, error: null }; }
  catch (e) { return { rows: [], n: 0, error: String(e.message || e) }; }
  finally { await root(); }
};
// Refused = an error (an insert's WITH CHECK) or nothing written (an update's or delete's USING hides the row).
const refused = (r) => !!r.error || r.n === 0;

await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
`);
// A second business, made deliberately (the guard_second_tenant way: one transaction, the setting on), so the
// tenant wall can be shown to still stand on top of the new policies.
await db.exec(`begin; set local gt3.allow_second_tenant = 'on';
  insert into public.tenants (id, slug, name) values ('${T2}', 'other-bar', 'Another Bar'); commit;`);
for (const [id, role, tenant] of [[OWNER, "owner", T1], [ADMIN, "admin", T1], [SERVER, "server", T1], [EVENTM, "event_manager", T1],
  [MEMBER, "member", T1], [OTHER, "owner", T2]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, tenant, `Made-up ${role}`]);
}

// One of each, made as the database itself (root), in the founding business.
const merch = (await q(`insert into public.shop_products (kind, title, price_cents, cost_cents, published_at, tenant_id)
  values ('merch', 'GT3 Tee', 3200, 1180, now(), $1) returning id`, [T1]))[0].id;
const drink = (await q(`select id from public.products where tenant_id = $1 order by slug limit 1`, [T1]))[0]?.id
  ?? (await q(`insert into public.products (slug, name, price_cents, tenant_id) values ('rise-test', 'RISE', 600, $1) returning id`, [T1]))[0].id;
const item = (await q(`insert into public.inventory_items (name, unit, tenant_id) values ('Oat milk', 'oz', $1) returning id`, [T1]))[0].id;
const part = (await q(`insert into public.product_components (product_id, inventory_item_id, qty_per_serving, unit, tenant_id)
  values ($1, $2, 2, 'oz', $3) returning id`, [drink, item, T1]))[0].id;
const pillar = (await q(`insert into public.primal_pillars (slug, title, published_at, tenant_id) values ('breath-test', 'Breath', now(), $1) returning id`, [T1]))[0].id;
const mod = (await q(`insert into public.primal_modules (pillar_id, slug, title, published_at, tenant_id) values ($1, 'box-test', 'Box', now(), $2) returning id`, [pillar, T1]))[0].id;
const lesson = (await q(`insert into public.primal_lessons (module_id, slug, title, published_at, tier, tenant_id)
  values ($1, 'box-breathing-test', 'Box breathing', now(), 'rookie', $2) returning id`, [mod, T1]))[0].id;

// Each attempt adds a line for its own fresh ingredient (a drink holds an ingredient once: a unique key), so a refusal is
// the policy's and never the key's.
let n = 0;
const freshItem = async () => (await q(`insert into public.inventory_items (name, unit, tenant_id) values ($1, 'oz', $2) returning id`, [`Ingredient ${++n}`, T1]))[0].id;
const writes = async (who) => { const fresh = await freshItem(); return Promise.all([
  as(who, `update public.shop_products set price_cents = price_cents + 100 where id = $1`, [merch]),
  as(who, `insert into public.product_components (product_id, inventory_item_id, qty_per_serving, unit, tenant_id) values ($1, $2, 1, 'oz', $3)`, [drink, fresh, T1]),
  as(who, `update public.product_components set qty_per_serving = 3 where id = $1`, [part]),
  as(who, `update public.primal_lessons set title = 'Box breathing, revised' where id = $1`, [lesson]),
]); };

// ── BEFORE 0382: any staff role writes all three ─────────────────────────────────────────────────────
{
  const [m, pi, pu, l] = await writes(SERVER);
  ok("before 0382: a server can reprice merch", !refused(m), m);
  ok("before 0382: a server can add to a drink's recipe…", !refused(pi), pi);
  ok("…and change one", !refused(pu), pu);
  ok("before 0382: a server can rewrite a lesson", !refused(l), l);
  const [em] = await writes(EVENTM);
  ok("before 0382: so can an event manager (merch)", !refused(em), em);
}

// ── 0382 ────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(MIG(F382));

for (const [who, name] of [[SERVER, "a server"], [EVENTM, "an event manager"], [MEMBER, "a member"]]) {
  const [m, pi, pu, l] = await writes(who);
  ok(`after 0382: ${name} cannot reprice merch`, refused(m), m);
  ok(`after 0382: ${name} cannot add to a recipe — refused by the policy, not a key`, /row-level security/i.test(pi.error || ""), pi);
  ok(`after 0382: ${name} cannot change a recipe`, refused(pu), pu);
  ok(`after 0382: ${name} cannot rewrite a lesson`, refused(l), l);
}
{
  const a = await as(null, `update public.shop_products set price_cents = 1 where id = $1`, [merch]);
  ok("after 0382: anon cannot write merch either", refused(a), a);
}
for (const [who, name] of [[OWNER, "an owner"], [ADMIN, "an admin"]]) {
  const [m, pi, pu, l] = await writes(who);
  ok(`after 0382: ${name} still reprices merch`, !refused(m), m);
  ok(`after 0382: ${name} still adds to a recipe`, !refused(pi), pi);
  ok(`after 0382: ${name} still changes a recipe`, !refused(pu), pu);
  ok(`after 0382: ${name} still rewrites a lesson`, !refused(l), l);
  const line = (await q(`select id from public.product_components where product_id = $1 and qty_per_serving = 1 order by id limit 1`, [drink]))[0]?.id;
  const d = await as(who, `delete from public.product_components where id = $1`, [line]);
  ok(`after 0382: ${name} still removes a recipe line`, !refused(d), d);
}

// Reads are unchanged.
{
  const s = await as(SERVER, `select count(*)::int n from public.product_components where id = $1`, [part]);
  ok("after 0382: the crew still read recipes (Brew and Prep cost from them)", s.rows[0]?.n === 1, s);
  const m = await as(SERVER, `select count(*)::int n from public.shop_products where id = $1`, [merch]);
  ok("after 0382: the crew still read merch", m.rows[0]?.n === 1, m);
  const l = await as(MEMBER, `select count(*)::int n from public.primal_lessons where id = $1`, [lesson]);
  ok("after 0382: a member still reads a published rookie lesson", l.rows[0]?.n === 1, l);
  const pub = await as(null, `select count(*)::int n from public.shop_products where id = $1`, [merch]);
  ok("after 0382: the shop still shows published merch to anyone", pub.rows[0]?.n === 1, pub);
}

// The crew's 86 is another table and another rule (0351): untouched.
{
  const r = await as(SERVER, `update public.products set sold_out = true where id = $1`, [drink]);
  ok("after 0382: a server still 86es a drink (products.sold_out, 0351)", !refused(r), r);
  const back = await as(SERVER, `update public.products set sold_out = false where id = $1`, [drink]);
  ok("…and puts it back on", !refused(back), back);
}

// The tenant wall still holds on top: another business's owner writes none of ours.
{
  const [m, , pu, l] = await writes(OTHER);
  ok("after 0382: another business's owner cannot reprice our merch", refused(m), m);
  ok("after 0382: …nor change our recipe", refused(pu), pu);
  ok("after 0382: …nor rewrite our lesson", refused(l), l);
}

// The policies, by name, and a second run.
{
  const names = (await q(`select tablename || ': ' || policyname p from pg_policies
    where tablename in ('shop_products','product_components','primal_lessons') order by 1`)).map((r) => r.p);
  ok("the three staff write policies are gone", !names.some((n) => /staff write|primal lessons write$/.test(n)), names);
  ok("the three admin write policies stand", ["shop_products: shop products admin write", "product_components: pc admin write",
    "primal_lessons: primal lessons admin write"].every((n) => names.includes(n)), names);
  await db.exec(MIG(F382));
  const again = (await q(`select count(*)::int n from pg_policies where tablename in ('shop_products','product_components','primal_lessons')`))[0].n;
  ok("a second run changes nothing", again === names.length, { again, before: names.length });
  const rec = (await q(`select count(*)::int n from public.schema_migrations where version = '0382_merch_recipes_and_lessons_are_written_by_owners_and_admins'`))[0].n;
  ok("0382 records itself in the ledger", rec >= 1, rec);
}

console.log(`db.catalogwrites: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
