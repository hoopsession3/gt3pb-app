// 0384 — THE MONEY NUMBERS ARE HONEST, executed from its file against the whole schema (every migration before it, in
// order: scripts/fixtures/schema.full.mjs), acting as each kind of person the way PostgREST does.
//
// Each finding is shown first on the schema as production has it, then closed, then what must keep working is run:
//   1. A shop payment was a walk-up and joined the live event. After: every payment in exactly one channel — a walk-up,
//      a cup order, a shop order, and a subscription's payment (which nothing stored can tell from a walk-up, shown
//      here as the schema's own columns) — and the channels sum to the distinct payments; the shop joins no event;
//      each channel counts its own orders.
//   2. The margin says what it rests on (cogs_basis), and an event says whether its costs were saved.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F384 = "0384_the_money_numbers_are_honest.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const u = (n) => `3e9e0000-0000-4000-8000-0000000000${n}`;
const OWNER = u("a1"), MEMBER = u("a5");

const t0 = Date.now();
const db = await fullSchema({ before: "0384" });
console.log(`the schema before 0384 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
// As a person, through PostgREST's roles: { rows, error }. role "service_role" acts as the server.
const as = async (uid, sql, params, role) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${role ?? (uid ? "authenticated" : "anon")};`);
  try { return { rows: (await db.query(sql, params)).rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
const report = async (uid, sql) => { const r = await as(uid, `select ${sql} r`); return r.error ? { error: r.error } : r.rows[0]?.r; };

await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
`);
for (const [id, role, tenant] of [[OWNER, "owner", T1], [MEMBER, "member", T1]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, tenant, `Made-up ${role}`]);
}

// ── THE FIXTURE ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Four Square payments in business A, each mirrored into event_sales the way the webhook does it — three of them while a
// made-up market day was the live event: a walk-up at the window, a cup ordered in the app, a cap from the shop; and a
// subscription's invoice, billed overnight with nothing live.
const E1 = (await q(`insert into public.events (title, day, tenant_id) values ('Made-up market day', current_date, $1) returning id`, [T1]))[0].id;
const PAY = { walkup: 500, cup: 900, shop: 3200, subscription: 3600 };
for (const [id, cents, event] of [["sq-made-up-walkup", PAY.walkup, E1], ["sq-made-up-cup", PAY.cup, E1], ["sq-made-up-shop", PAY.shop, E1], ["sq-made-up-subscription", PAY.subscription, null]]) {
  await q(`insert into public.event_sales (square_payment_id, amount_cents, event_id, source, tenant_id) values ($1, $2, $3, 'square', $4)`, [id, cents, event, T1]);
}
await q(`insert into public.orders (items, total_cents, paid, payment_id, tenant_id) values ('{rise}', $1, true, 'sq-made-up-cup', $2)`, [PAY.cup, T1]);
await q(`insert into public.shop_orders (email, payment_id, subtotal_cents, total_cents, status, ship_name, tenant_id)
         values ('made-up-buyer@example.test', 'sq-made-up-shop', $1, $1, 'needs_fulfillment', 'Made-up Buyer', $2)`, [PAY.shop, T1]);
await q(`insert into public.subscriptions (user_id, plan, status, square_subscription_id, tenant_id) values ($1, 'coffee_6', 'active', 'sub-made-up-a', $2)`, [MEMBER, T1]);
const distinctPayments = Number((await q(`select coalesce(sum(amount_cents), 0) n from public.event_sales where tenant_id = $1`, [T1]))[0].n);
ok("the fixture: business A's Square payments are the four made up here, once each", distinctPayments === PAY.walkup + PAY.cup + PAY.shop + PAY.subscription, distinctPayments);

// ── BEFORE 0384 ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const s = await report(OWNER, `public.report_sales(7)`);
  ok("before 0384: the shop's payment is filed as a walk-up (walk-ups = the walk-up + the cap + the subscription)",
    s?.by_channel?.square_walkup === PAY.walkup + PAY.shop + PAY.subscription && s?.by_channel?.shop === undefined, s?.by_channel);
  const day = (s?.by_event ?? []).find((e) => e.event === "Made-up market day");
  ok("before 0384: …and joins the live event's takings in Revenue by event", day?.cents === PAY.walkup + PAY.cup + PAY.shop, s?.by_event);
  const ev = await report(OWNER, `public.report_events()`);
  ok("before 0384: …and the per-event P&L", (Array.isArray(ev) ? ev : []).find((r) => r.id === E1)?.actual_cents === PAY.walkup + PAY.cup + PAY.shop, ev);
  ok("before 0384: Sales' one order count is cup orders alone — the average divided all revenue by it",
    s?.order_count === 1 && s?.revenue_cents === distinctPayments && s?.orders_by_channel === undefined, { n: s?.order_count, rev: s?.revenue_cents });
}

// ── 0384 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(MIG(F384));

// 1 · every payment in exactly one channel, and the shop joins no event
{
  const s = await report(OWNER, `public.report_sales(7)`);
  const ch = s?.by_channel ?? {};
  ok("1 · a walk-up is a walk-up, a cup a cup, the cap the shop's — and the subscription's payment, which nothing can tell from a walk-up, stays one",
    ch.square_walkup === PAY.walkup + PAY.subscription && ch.cup === PAY.cup && ch.shop === PAY.shop && ch.packs === 0 && ch.delivery === 0 && ch.office === 0, ch);
  const sum = Object.values(ch).reduce((a, n) => a + Number(n), 0);
  ok("1 · the channels sum to the distinct payments, and so does revenue", sum === distinctPayments && s?.revenue_cents === distinctPayments, { sum, rev: s?.revenue_cents, distinctPayments });
  const days = (s?.by_day ?? []).reduce((a, d) => a + Number(d.cents), 0);
  ok("1 · …and the days sum to revenue", days === s?.revenue_cents, { days, rev: s?.revenue_cents });
  ok("1 · each channel counts its own orders — what an average is divided by",
    JSON.stringify(s?.orders_by_channel) === JSON.stringify({ cup: 1, shop: 1, packs: 0, office: 0, delivery: 0, square_walkup: 2 }), s?.orders_by_channel);
  const day = (s?.by_event ?? []).find((e) => e.event === "Made-up market day");
  ok("1 · the cap joins no event: the market day took the walk-up and the cup", day?.cents === PAY.walkup + PAY.cup, s?.by_event);
  const ev = await report(OWNER, `public.report_events()`);
  ok("1 · …in the per-event P&L too", (Array.isArray(ev) ? ev : []).find((r) => r.id === E1)?.actual_cents === PAY.walkup + PAY.cup, ev);
  // What a subscription's payment would need, said as the schema: nothing on either side ties the two together.
  const cols = async (t) => (await q(`select column_name c from information_schema.columns where table_schema = 'public' and table_name = $1`, [t])).map((r) => r.c);
  const es = await cols("event_sales"), subs = await cols("subscriptions");
  ok("1 · why the subscription stays a walk-up: event_sales keeps no Square order or customer, subscriptions no payment, invoice or order",
    !es.some((c) => /order|customer/.test(c)) && !subs.some((c) => /payment|invoice|order/.test(c)) && es.includes("square_payment_id") && subs.includes("square_subscription_id"), { es, subs });
  // A refund comes off the shop's line, and a cancelled order's payment counts nowhere — as a voided cup's doesn't.
  await q(`update public.shop_orders set refund_amount_cents = 1200 where payment_id = 'sq-made-up-shop'`);
  const r2 = await report(OWNER, `public.report_sales(7)`);
  ok("1 · a refund recorded on the shop order comes off the shop's line", r2?.by_channel?.shop === PAY.shop - 1200 && r2?.by_channel?.square_walkup === PAY.walkup + PAY.subscription, r2?.by_channel);
  await q(`update public.shop_orders set refund_amount_cents = null where payment_id = 'sq-made-up-shop'`);
}

// 2 · estimates say what they rest on
{
  const menu = Number((await q(`select count(*) n from public.products where active and price_cents > 0 and tenant_id = $1`, [T1]))[0].n);
  const s0 = await report(OWNER, `public.report_sales(7)`);
  ok("2 · with no recipe anywhere the margin's 30% is said to be assumed", s0?.cogs_pct === 0.3 && JSON.stringify(s0?.cogs_basis) === JSON.stringify({ costed: 0, assumed: true, products: menu }), { pct: s0?.cogs_pct, basis: s0?.cogs_basis, menu });
  // One drink with every ingredient costed, one with an ingredient nobody has priced.
  const [p1, p2] = (await q(`select id from public.products where active and price_cents > 0 and tenant_id = $1 order by sort, id limit 2`, [T1])).map((r) => r.id);
  const priced = (await q(`insert into public.inventory_items (name, qty, unit_cost, status, tenant_id) values ('Made-up cold brew', 5, 1.50, 'On Hand', $1) returning id`, [T1]))[0].id;
  const unpriced = (await q(`insert into public.inventory_items (name, qty, status, tenant_id) values ('Made-up maple', 5, 'On Hand', $1) returning id`, [T1]))[0].id;
  await q(`insert into public.product_components (product_id, inventory_item_id, qty_per_serving, tenant_id) values ($1, $3, 1, $4), ($2, $3, 1, $4), ($2, $5, 1, $4)`, [p1, p2, priced, T1, unpriced]);
  const s1 = await report(OWNER, `public.report_sales(7)`);
  ok("2 · with recipes it is an estimate, and says one of the menu is fully costed — not the drink missing an ingredient's price",
    s1?.cogs_pct !== 0.3 && JSON.stringify(s1?.cogs_basis) === JSON.stringify({ costed: 1, assumed: false, products: menu }), { pct: s1?.cogs_pct, basis: s1?.cogs_basis });
  const ev = await report(OWNER, `public.report_events()`);
  const row = () => (Array.isArray(ev) ? ev : []).find((r) => r.id === E1);
  ok("2 · an event with no saved costs says so (its net is the blend and nothing else)", row()?.costs_saved === false && row()?.fixed_cents === 0, row());
  await q(`insert into public.event_economics (event_id, booth_cents, tenant_id) values ($1, 4000, $2)`, [E1, T1]);
  const ev2 = await report(OWNER, `public.report_events()`);
  const saved = (Array.isArray(ev2) ? ev2 : []).find((r) => r.id === E1);
  ok("2 · …and one with costs saved says that, with them in", saved?.costs_saved === true && saved?.fixed_cents === 4000, saved);
}

// ── WHAT MUST KEEP WORKING ─────────────────────────────────────────────────────────────────────────────────────────
{
  // The home's three numbers (components/HomeNumbers): the 14- and 7-day reports and the P&L, as the owner.
  const [r14, r7, ev] = [await report(OWNER, `public.report_sales(14)`), await report(OWNER, `public.report_sales(7)`), await report(OWNER, `public.report_events()`)];
  const keys = ["days", "revenue_basis", "revenue_cents", "by_channel", "order_count", "cogs_pct", "by_product", "by_event", "by_day"];
  ok("the home's numbers still read: every key report_sales had is there, and the P&L is a list",
    keys.every((k) => k in (r14 ?? {}) && k in (r7 ?? {})) && ["square_walkup", "cup", "packs", "delivery", "office"].every((k) => k in r7.by_channel) && Array.isArray(ev), { r14: Object.keys(r14 ?? {}), ev: ev?.error });
}

// ── A SECOND RUN, AND THE LEDGER ───────────────────────────────────────────────────────────────────────────────────
{
  ok("0384 run twice: no error", await db.exec(MIG(F384)).then(() => true, (e) => { console.log(e.message); return false; }));
  ok("0384 run twice: one changelog entry", Number((await q(`select count(*) n from public.changelog where title = 'The money numbers say what they are'`))[0].n) === 1);
  ok("0384 records itself by its own name",
    (await q(`select 1 from public.schema_migrations where version = '0384_the_money_numbers_are_honest'`)).length === 1);
}

console.log(`0384 (the money numbers are honest): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
