// 0390 — A REFUND TAKES ITS STAMPS BACK, AND A CUP KEEPS ITS TIP, executed from its file against the whole schema
// (every migration before it, in order: scripts/fixtures/schema.full.mjs), with refunds written the way the Square
// webhook writes them — by the service role, an upsert on Square's own refund id.
//
// The finding, as a sentence (H9 of the customer frontend audit): a refund issued in Square was matched to shop orders
// only, so a cup, a pack or a delivery refunded in full kept the stamps it earned; and a cup's tip was kept nowhere.
// After 0390 every refund is matched to its order by its payment, and when an order's money is all back its stamps
// come off, once — a partial refund keeps them, and refunds from before are matched, not acted on.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F390 = "0390_a_refund_takes_its_stamps_back.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const JORDAN = "0c390000-0000-4000-8000-0000000000c1";

const t0 = Date.now();
const db = await fullSchema({ before: "0390" });
console.log(`the schema before 0390 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to service_role;   -- Supabase's default for the service role
  alter role service_role bypassrls;                            -- …and it passes RLS, as Supabase's does
`);
await db.query(`insert into auth.users (id, email) values ($1, 'member-c1@example.test')`, [JORDAN]);
await db.query(`update public.profiles set role = 'member', tenant_id = $2, display_name = 'Made-up member' where id = $1`, [JORDAN, T1]);
const pts = async () => (await q(`select coalesce(points, 0)::int p from public.profiles where id = $1`, [JORDAN]))[0].p;
// The webhook's write, as the service role: an upsert on Square's refund id (app/api/square/webhook, 0330).
const refund = async (id, paymentId, cents, status = "COMPLETED") => {
  await db.exec(`set role service_role;`);
  try {
    await db.query(`insert into public.square_refunds (id, payment_id, amount_cents, status, updated_at) values ($1, $2, $3, $4, now())
      on conflict (id) do update set payment_id = excluded.payment_id, amount_cents = excluded.amount_cents, status = excluded.status, updated_at = excluded.updated_at`,
      [id, paymentId, cents, status]);
    return null;
  } catch (e) { return String(e.message || e); } finally { await db.exec(`reset role;`); }
};
// Made-up orders, each paid by its own made-up payment, each done so its stamps are on the card.
const cup = async (pay, items, total) => {
  const id = (await q(`insert into public.orders (user_id, customer, items, total_cents, paid, payment_id, status) values ($1, 'Jordan', $2, $3, true, $4, 'new') returning id`, [JORDAN, items, total, pay]))[0].id;
  await q(`update public.orders set status = 'done' where id = $1`, [id]);
  return id;
};
const C0 = await cup("pay_OLD", ["rise"], 1000);
await q(`insert into public.square_refunds (id, payment_id, amount_cents, status) values ('ref_OLD', 'pay_OLD', 1000, 'COMPLETED')`);

// ── BEFORE 0390 ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const C1 = await cup("pay_B1", ["rise", "flow"], 2000);
  const before = await pts();
  const err = await refund("ref_B1", "pay_B1", 2000);
  ok("before 0390: a cup refunded in full in Square keeps its two stamps", err === null && (await pts()) === before, { err, p: await pts(), before });
  const cols = (await q(`select count(*)::int n from information_schema.columns where table_name = 'orders' and column_name = 'tip_cents'`))[0].n;
  ok("before 0390: a cup's tip is kept nowhere", cols === 0);
  void C1;
}

const ptsAtPaste = await pts();
await db.exec(MIG(F390));

// ── the refunds already kept: matched, nothing taken ───────────────────────────────────────────────────────────
{
  const old = (await q(`select channel, channel_order_id from public.square_refunds where id = 'ref_OLD'`))[0];
  ok("0390: a refund already kept is matched to its cup", old.channel === "cup" && old.channel_order_id === C0, old);
  ok("…and no balance moves for the past", (await pts()) === ptsAtPaste, { now: await pts(), ptsAtPaste });
  ok("orders.tip_cents: there, 0 for every order before", (await q(`select count(*)::int n from public.orders where tip_cents <> 0`))[0].n === 0);
}

// ── a cup ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const C2 = await cup("pay_C2", ["rise", "flow"], 2000);
  await q(`update public.orders set tip_cents = 300 where id = $1`, [C2]);
  const p0 = await pts();
  ok("a cup's two stamps are on the card", p0 === ptsAtPaste + 2, { p0, ptsAtPaste });
  await refund("ref_C2a", "pay_C2", 1000);
  const r = (await q(`select channel, channel_order_id from public.square_refunds where id = 'ref_C2a'`))[0];
  ok("a refund is matched to its cup by the payment, as the webhook writes it", r.channel === "cup" && r.channel_order_id === C2, r);
  ok("…half the drinks back: the stamps stay", (await pts()) === p0);
  await refund("ref_C2b", "pay_C2", 1000, "PENDING");
  ok("…the rest refunded, still PENDING: the stamps stay", (await pts()) === p0);
  await refund("ref_C2b", "pay_C2", 1000, "COMPLETED");
  ok("…it completes: the drinks are all back, and both stamps come off", (await pts()) === p0 - 2, { now: await pts(), p0 });
  const claw = await q(`select points, note from public.loyalty_ledger where order_id = $1 and kind = 'clawback'`, [C2]);
  ok("…one clawback of −2, saying why", claw.length === 1 && claw[0].points === -2 && claw[0].note === "refunded in Square", claw);
  await refund("ref_C2b", "pay_C2", 1000, "COMPLETED");
  await refund("ref_C2c", "pay_C2", 300);
  ok("a replay of the webhook, and the tip refunded after: nothing more comes off", (await pts()) === p0 - 2
    && (await q(`select count(*)::int n from public.loyalty_ledger where order_id = $1 and kind = 'clawback'`, [C2]))[0].n === 1);
}

// ── a pack: its every payment in, its changes' own refunds not counted as the pack coming back ─────────────────
{
  const P = (await q(`insert into public.drop_orders (user_id, name, size, glass, mix, total_cents, paid, payment_id, drop_date)
    values ($1, 'Jordan', 6, 'return', '{"RISE":6}', 3000, true, 'pay_P', (now() at time zone 'America/New_York')::date) returning id`, [JORDAN]))[0].id;
  // It was a 12-pack at $60: changed in place to a 6-pack, $30 refunded by the change (0388).
  await q(`insert into public.drop_order_changes (key, drop_order_id, user_id, state, before, after, diff_cents, refunds)
    values ('k-0390-change', $1, $2, 'done', '{"total_cents":6000}', '{"total_cents":3000}', -3000, '[{"payment_id":"pay_P","refund_id":"ref_P0","cents":3000,"status":"PENDING"}]')`, [P, JORDAN]);
  await q(`update public.drop_orders set stage = 'picked_up' where id = $1`, [P]);
  const p0 = await pts();
  ok("a picked-up 6-pack earns its six stamps", (await q(`select count(*)::int n from public.loyalty_ledger where order_id = $1 and kind = 'award'`, [P]))[0].n === 1);
  await refund("ref_P0", "pay_P", 3000);
  ok("the change's own $30 refund, completing: matched to the pack, and the stamps stay — the pack is still paid for",
    (await q(`select channel from public.square_refunds where id = 'ref_P0'`))[0].channel === "pickup" && (await pts()) === p0, await pts());
  ok("what the pack took in: the $30 it holds and the $30 its change refunded", (await q(`select public.pack_paid_in($1) n`, [P]))[0].n === 6000);
  await refund("ref_P1", "pay_P", 3000);
  ok("the rest refunded: all its money is back, and the six stamps come off", (await pts()) === p0 - 6, { now: await pts(), p0 });
  // A difference a change charged is the pack's too.
  await q(`insert into public.drop_order_changes (key, drop_order_id, user_id, state, before, after, diff_cents, charge_payment_id)
    values ('k-0390-up', $1, $2, 'stale', '{}', '{}', 1500, 'pay_P_UP')`, [P, JORDAN]);
  await refund("ref_UP", "pay_P_UP", 1500);
  ok("a refund of a change's charge is matched to its pack", (await q(`select channel, channel_order_id from public.square_refunds where id = 'ref_UP'`))[0].channel_order_id === P);
}

// ── a delivery, a shop order, and a payment nobody here knows ──────────────────────────────────────────────────
{
  const V = (await q(`insert into public.delivery_orders (user_id, name, phone, address_street, address_city, address_zip, pack_size, rise_count, flow_count, dusk_count,
      bottle_subtotal_cents, delivery_fee_cents, total_cents, delivery_date, payment_id)
    values ($1, 'Jordan', '+18645550100', '1 Made-up Way', 'Greenville', '29601', 12, 12, 0, 0, 6000, 500, 6500, (now() at time zone 'America/New_York')::date, 'pay_V') returning id`, [JORDAN]))[0].id;
  await q(`update public.delivery_orders set status = 'delivered' where id = $1`, [V]);
  const p0 = await pts();
  await refund("ref_V", "pay_V", 6500);
  ok("a delivery refunded in full gives its twelve stamps back", (await pts()) === p0 - 12, { now: await pts(), p0 });
  const S = (await q(`insert into public.shop_orders (user_id, payment_id, subtotal_cents, total_cents) values ($1, 'pay_S', 2500, 2500) returning id`, [JORDAN]))[0].id;
  const p1 = await pts();
  await refund("ref_S", "pay_S", 2500);
  ok("a shop refund is matched as shop, and moves no stamps", (await q(`select channel, channel_order_id from public.square_refunds where id = 'ref_S'`))[0].channel_order_id === S && (await pts()) === p1);
  await refund("ref_X", "pay_NOBODY", 999);
  ok("a payment no order here carries: kept, unmatched", (await q(`select channel from public.square_refunds where id = 'ref_X'`))[0].channel === null);
}

// ── who runs it, and a second run ──────────────────────────────────────────────────────────────────────────────
{
  const g = (await q(`select has_function_privilege('authenticated', 'public.refund_order_of(text)', 'execute') a,
    has_function_privilege('anon', 'public.pack_paid_in(uuid)', 'execute') b,
    (select count(*)::int from pg_trigger where tgname in ('square_refund_match_tg', 'square_refund_claws_tg')) t`))[0];
  ok("the helpers are the database's own — no execute for anon or a member — and both triggers are on", g.a === false && g.b === false && g.t === 2, g);
  const n = (await q(`select count(*)::int n from public.loyalty_ledger where kind = 'clawback'`))[0].n;
  await db.exec(MIG(F390));
  ok("a second run changes nothing: no stamps move, one changelog line, recorded",
    (await q(`select count(*)::int n from public.loyalty_ledger where kind = 'clawback'`))[0].n === n
    && (await q(`select count(*)::int n from public.changelog where title = 'A refund takes its stamps back'`))[0].n === 1
    && (await q(`select count(*)::int n from public.schema_migrations where version = '0390_a_refund_takes_its_stamps_back'`))[0].n >= 1);
}

console.log(`db.refundstamps: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
