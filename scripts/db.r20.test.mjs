// R20 — AN EVENT'S TAKINGS ARE COUNTED WHERE THEY ARE, RUN IN POSTGRES (2026-10-17; Ryan: "Keep working to improve to a
// 10").
//
//   0426  public.event_totals(event) — the live-event instrument's three numbers (performance F6).
//
// The whole schema is loaded, an event's orders and Square sales are made up (an order paid by card that Square mirrored
// too, a walk-up sale, an unpaid ticket, another event's sale), and the database's answer is held to lib/eventTotals'
// own rule run on the same rows — as the crew, and refused to a caller with no session. Every row is made up.
import { fullSchema } from "./fixtures/schema.full.mjs";
import { routeLoader } from "./fixtures/moneyWorld.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const CREW = "0c425000-0000-4000-8000-0000000000c2", SAM = "0c425000-0000-4000-8000-0000000000a1";

const t0 = Date.now();
const db = await fullSchema();
console.log(`the whole schema loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);`);
const as = async (who, sql, params) => {
  const role = who ? "authenticated" : "anon";
  await db.exec(`select set_config('request.jwt.claim.sub', '${who ?? ""}', false); select set_config('request.jwt.claim.role', '${role}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e).split("\n")[0], code: e.code ?? null }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated;`);
for (const [id, role, name] of [[CREW, "operator", "Kim Lee"], [SAM, "member", "Sam Ito"]]) {
  await q(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${name.split(" ")[0].toLowerCase()}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, T1, name]);
}

const ev = (await q1(`insert into public.events (title, day, is_live, tenant_id) values ('Made-up Market', current_date, true, $1) returning id`, [T1])).id;
const other = (await q1(`insert into public.events (title, day, tenant_id) values ('Another day', current_date + 3, $1) returning id`, [T1])).id;
// Orders: a card order Square also mirrored, a cash order paid at the window, an unpaid ticket, a paid ticket voided —
// and one at another event.
await q(`insert into public.orders (items, total_cents, paid, payment_id, status, event_id, tenant_id, created_at) values
  ('{rise}', 900, true, 'sq-pay-card-1', 'done', $1, $3, now() - interval '50 minutes'),
  ('{flow}', 700, true, null, 'done', $1, $3, now() - interval '40 minutes'),
  ('{rise}', 900, false, null, 'new', $1, $3, now() - interval '10 minutes'),
  ('{rise}', 800, true, 'sq-pay-void', 'void', $1, $3, now() - interval '70 minutes'),
  ('{rise}', 900, true, 'sq-pay-elsewhere', 'done', $2, $3, now() - interval '5 minutes')`, [ev, other, T1]);
// Other app payments taken while the event was live, which the Square webhook files against it (the R20 review): a pack's
// and the shop's.
await q(`insert into public.drop_orders (name, size, glass, total_cents, paid, payment_id, drop_date, tenant_id) values ('Made-up Pack', 6, 'new', 2400, true, 'sq-pay-pack', current_date + 2, $1)`, [T1]);
await q(`insert into public.shop_orders (email, subtotal_cents, total_cents, status, payment_id, tenant_id) values ('kim@example.test', 3500, 3500, 'paid', 'sq-pay-shop', $1)`, [T1]);
// Square's mirror: the card order's own payment (counted once, as the order), the voided ticket's, a walk-up sale, a
// manual entry with no payment id, the pack's and the shop's payments, and a sale at another event.
await q(`insert into public.event_sales (event_id, square_payment_id, source, amount_cents, created_at, tenant_id) values
  ($1, 'sq-pay-card-1', 'square', 900, now() - interval '50 minutes', $3),
  ($1, 'sq-pay-void', 'square', 800, now() - interval '70 minutes', $3),
  ($1, 'sq-pay-walkup', 'square', 1200, now() - interval '55 minutes', $3),
  ($1, null, 'manual', 500, now() - interval '30 minutes', $3),
  ($1, 'sq-pay-pack', 'square', 2400, now() - interval '20 minutes', $3),
  ($1, 'sq-pay-shop', 'square', 3500, now() - interval '15 minutes', $3),
  ($2, 'sq-pay-other', 'square', 4000, now() - interval '2 minutes', $3)`, [ev, other, T1]);
// And what went back: $2 of the walk-up, $3 of the card order (a cup's refund, within its drinks).
await q(`insert into public.square_refunds (id, payment_id, amount_cents, status, tenant_id) values
  ('sq-refund-walkup', 'sq-pay-walkup', 200, 'COMPLETED', $1), ('sq-refund-card', 'sq-pay-card-1', 300, 'COMPLETED', $1),
  ('sq-refund-failed', 'sq-pay-walkup', 1200, 'FAILED', $1)`, [T1]);

const ET = routeLoader()("lib/eventTotals.ts");
const rows = async (event) => ({
  orders: await q(`select total_cents, paid, status, payment_id, created_at::text from public.orders where event_id = $1`, [event]),
  sales: await q(`select amount_cents, square_payment_id, created_at::text from public.event_sales where event_id = $1`, [event]),
  // what only the database sees whole: every other app payment, and the event's refunds as the books count them
  notOwn: new Set((await q(`select payment_id p from public.orders union select payment_id from public.drop_orders union select payment_id from public.delivery_orders
      union select payment_id from public.business_orders union select payment_id from public.shop_orders union select payment_id from public.reserve_claims
      union select charge_payment_id from public.drop_order_changes where state = 'done'`)).map((r) => r.p).filter(Boolean)),
});
const iso = (t) => (t ? new Date(t).toISOString() : null);

{
  const r = await as(CREW, `select public.event_totals($1) t`, [ev]);
  const t = r.rows[0]?.t;
  ok("0426: the crew is answered the event's three numbers", !r.error && t && typeof t === "object", r.error ?? t);
  ok("0426 (review): what was taken — paid orders not voided and Square's own sales, the card order counted once, a pack's and the shop's payment left out, less the refunds ($9 + $7 + $12 + $5 − $2 − $3)",
    Number(t?.cents) === 2800, t);
  ok("0426: how many sales — three orders (the voided one not among them) and the two sales that are no app payment's", Number(t?.orders) === 5, t);
  const { orders, sales, notOwn } = await rows(ev);
  const mine = ET.totalsFromRows(orders, sales, { notOwn, refundedCents: 500 });
  ok("0426: the database's answer is lib/eventTotals' own rule on the same rows (the screen's until 0426 is pasted)",
    mine.cents === Number(t?.cents) && mine.orders === Number(t?.orders) && iso(mine.firstAt) === iso(t?.first_at), { db: t, lib: mine });
  ok("0426: the first sale is the earliest of the orders and the sales it counts (the walk-up, 55 minutes ago)",
    iso(t?.first_at) === iso((await q1(`select created_at from public.event_sales where square_payment_id = 'sq-pay-walkup'`)).created_at), t?.first_at);
  // A second refund of the card order, past its drinks: the books cap a cup's refunds together at what it cost (0417) —
  // the database's own count of what went back, on the same payments, is what the instrument takes off.
  await q(`insert into public.square_refunds (id, payment_id, amount_cents, status, tenant_id) values ('sq-refund-card-2', 'sq-pay-card-1', 800, 'COMPLETED', $1)`, [T1]);
  const capped = (await as(CREW, `select public.event_totals($1) t`, [ev])).rows[0]?.t;
  const books = Number((await q1(`select coalesce(sum(x.off_cents), 0)::int n from public.refunds_counted($1) x join public.square_refunds r on r.id::text = x.refund_id
    where x.channel in ('cup', 'walkup') and r.payment_id in ('sq-pay-card-1', 'sq-pay-walkup')`, [T1])).n);
  ok("0426 (review): a cup's refunds together never take off more than its drinks — the books' own count, on this event's payments only ($9 + $7 + $12 + $5 − $2 − $9)",
    Number(capped?.cents) === 2200 && books === 1100 && Number(capped?.cents) === 3300 - books, { capped, books });
  const none = await as(CREW, `select public.event_totals($1) t`, ["0c425000-0000-4000-8000-00000000dead"]);
  ok("0426: an event with nothing sold is nothing — 0, 0, none", Number(none.rows[0]?.t?.cents) === 0 && Number(none.rows[0]?.t?.orders) === 0 && none.rows[0]?.t?.first_at === null, none.rows[0]);
}
{
  const anon = await as(null, `select public.event_totals($1) t`, [ev]);
  ok("0426: a caller with no session may not ask", /permission denied/i.test(anon.error ?? ""), anon);
  const member = await as(SAM, `select public.event_totals($1) t`, [ev]);
  ok("0426 (review): a member may not ask — the takings are the crew's", member.code === "42501" && /the crew's/.test(member.error ?? ""), member);
  ok("0426 (review): run as its owner, so what it leaves out is read whole whoever asks — the crew's gate and their tenant its own",
    (await q1(`select prosecdef from pg_proc where proname = 'event_totals'`)).prosecdef === true
      && /if not public\.is_staff\(\) then/.test((await q1(`select prosrc from pg_proc where proname = 'event_totals'`)).prosrc));
  const lib = ET.totalsFromRows([{ total_cents: 900, paid: true, status: "void", payment_id: "p1" }], [{ amount_cents: 900, square_payment_id: "p1" }, { amount_cents: 100, square_payment_id: "p2" }], { notOwn: new Set(["p2"]) });
  ok("0426 (review): the screen's rule leaves out a voided ticket, its payment's mirror, and another app payment", lib.cents === 0 && lib.orders === 0, lib);
  ok("0426: recorded in the ledger, and one changelog line",
    Number((await q1(`select count(*)::int n from public.schema_migrations where version like '0426%'`)).n) === 1
      && Number((await q1(`select count(*)::int n from public.changelog where title = 'The live event adds up its own takings'`)).n) === 1);
}

console.log(`\nR20 — AN EVENT'S TAKINGS, COUNTED WHERE THEY ARE (0426): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
