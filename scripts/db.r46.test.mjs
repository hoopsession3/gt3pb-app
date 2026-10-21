// R46 — GT3 NUTRITION IS FOR SALE (0443), IN POSTGRES (2026-10-21 — Ryan: "One-time buy"; $47 the founding price).
//
// The whole schema to 0442 is loaded; then 0443, twice. What is read: one product — the course, $47, published, of kind
// program_tier, never on the merch shelf's read; a paid order as the checkout writes it (delivered, nothing to ship) and
// the access it grants, tied to it; that access opening every lesson (0442); a refund — and a cancel — taking back the
// access that order gave and nothing else; a move that isn't one changing nothing; nobody able to run the trigger's
// function.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M443 = readFileSync(join(ROOT, "supabase/migrations/0443_gt3_nutrition_is_for_sale.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const BUYER = "0c446000-0000-4000-8000-0000000000a1", OTHER = "0c446000-0000-4000-8000-0000000000a2", COMPED = "0c446000-0000-4000-8000-0000000000a3";

const t0 = Date.now();
const db = await fullSchema({ before: "0443" });
console.log(`the schema to 0442 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
`);
for (const id of [BUYER, OTHER, COMPED]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `m-${id.slice(-2)}@example.test`]);
  await q(`update public.profiles set role = 'member', tenant_id = $2 where id = $1`, [id, T1]);
}
const cust = async (uid) => (await q1(`select id from public.customers where user_id = $1`, [uid])).id;

// ── 0443, twice ──────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(M443);
await db.exec(M443);
ok("0443 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0443%'`)).n === 2);
const prods = await q(`select id, title, public_title, price_cents, published_at is not null as live from public.shop_products where kind = 'program_tier' and program_tier = 'pro' and archived_at is null`);
ok("one product, made once: GT3 Nutrition, $47, published", prods.length === 1 && prods[0].price_cents === 4700 && prods[0].live === true && prods[0].public_title === "GT3 Nutrition", prods);
const course = prods[0].id;
const shelf = await as(null, `select count(*)::int n from public.shop_products where kind = 'merch' and id = $1`, [course]);
const seen = await as(null, `select price_cents from public.shop_products where kind = 'program_tier' and program_tier = 'pro' and published_at is not null and archived_at is null`);
ok("…not on the merch shelf's read, and a stranger reads its price (the buy button's)", shelf.rows[0]?.n === 0 && seen.rows[0]?.price_cents === 4700, { shelf, seen });

// ── a purchase, as app/api/nutrition/checkout writes it ──────────────────────────────────────────────────────────────
const buy = async (uid, pay) => {
  const c = await cust(uid);
  const o = (await q1(`insert into public.shop_orders (customer_id, user_id, email, payment_id, subtotal_cents, total_cents, ship_name, ship_address, status, note, tenant_id)
    values ($1, $2, 'b@example.test', $3, 4700, 4700, null, null, 'delivered', 'GT3 Nutrition — the course', $4) returning id`, [c, uid, pay, T1])).id;
  await q(`insert into public.shop_order_items (order_id, product_id, title, qty, unit_cents) values ($1, $2, 'GT3 Nutrition · Return to Primal', 1, 4700)`, [o, course]);
  await q(`insert into public.program_access (customer_id, tier, source, order_id, revoked_at, granted_at, tenant_id) values ($1, 'pro', 'purchase', $2, null, now(), $3)
    on conflict (customer_id, tier) do update set source = excluded.source, order_id = excluded.order_id, revoked_at = null, granted_at = excluded.granted_at`, [c, o, T1]);
  return o;
};
let order = null, saveError = null;
try { order = await buy(BUYER, "sq-pay-1"); } catch (e) { saveError = String(e.message || e); }
const saved = order ? await q1(`select o.status, o.ship_address, (select count(*)::int from public.shop_order_items i where i.order_id = o.id) as lines from public.shop_orders o where o.id = $1`, [order]) : null;
ok("a paid course order saves as the checkout writes it — delivered, nothing to ship, its line, its access",
  saved?.status === "delivered" && saved?.ship_address === null && saved?.lines === 1, saveError ?? saved);
const lessons = async (uid) => (await as(uid, `select count(*)::int n from public.primal_lessons`)).rows[0]?.n;
ok("the access opens every live lesson (0442) — the buyer reads them, a member who hasn't bought reads none", (await lessons(BUYER)) === 3 && (await lessons(OTHER)) === 0, [await lessons(BUYER), await lessons(OTHER)]);
const acc = await as(BUYER, `select tier, source, order_id, revoked_at from public.program_access`);
ok("…and the buyer reads their own access, tied to the order that bought it", acc.rows.length === 1 && acc.rows[0].order_id === order && acc.rows[0].revoked_at === null, acc);

// a comp, from nowhere a refund can reach
await q(`insert into public.program_access (customer_id, tier, source, tenant_id) values ($1, 'pro', 'comp', $2)`, [await cust(COMPED), T1]);

// ── a refund takes it back ───────────────────────────────────────────────────────────────────────────────────────────
await q(`update public.shop_orders set note = 'looked at' where id = $1`, [order]);
ok("a change that isn't the status leaves the access alone", (await q1(`select revoked_at from public.program_access where order_id = $1`, [order])).revoked_at === null);
await q(`update public.shop_orders set status = 'refunded' where id = $1`, [order]);
ok("refunded: the access that order gave is revoked — and the buyer reads no lesson", (await q1(`select revoked_at from public.program_access where order_id = $1`, [order])).revoked_at !== null && (await lessons(BUYER)) === 0);
ok("…a comp nobody bought is untouched", (await q1(`select revoked_at from public.program_access where customer_id = $1`, [await cust(COMPED)])).revoked_at === null && (await lessons(COMPED)) === 3);

// bought again, then cancelled
const again = await buy(BUYER, "sq-pay-2");
ok("bought again: the same access row, live, tied to the new order", (await q1(`select order_id, revoked_at from public.program_access where customer_id = $1`, [await cust(BUYER)])).order_id === again && (await lessons(BUYER)) === 3);
await q(`update public.shop_orders set status = 'canceled' where id = $1`, [again]);
ok("cancelled: taken back the same way", (await q1(`select revoked_at from public.program_access where order_id = $1`, [again])).revoked_at !== null);
await q(`update public.shop_orders set status = 'refunded' where id = $1`, [order]);
ok("an old order refunded again touches nothing it no longer granted", (await q(`select count(*)::int n from public.program_access where revoked_at is null`))[0].n === 1);

ok("nobody may run the trigger's function", (await q1(`select has_function_privilege('anon', 'public.program_access_follows_its_order()', 'execute') a, has_function_privilege('authenticated', 'public.program_access_follows_its_order()', 'execute') b`)).a === false
  && (await q1(`select has_function_privilege('authenticated', 'public.program_access_follows_its_order()', 'execute') b`)).b === false);
ok("one trigger", (await q1(`select count(*)::int n from pg_trigger where tgname = 'program_access_follows_its_order_tg'`)).n === 1);

console.log(`R46 — GT3 NUTRITION IS FOR SALE (0443, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
