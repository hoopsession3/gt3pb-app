// THE SHOP'S CHECKOUT, RUN (R16, 2026-10-17 — the 10/10 audit, operations F13 and API F7).
//
// /api/shop/checkout — merch, paid by card, sent to the printer — compiled from its own TypeScript and called with a
// Request, as Next calls it. Real: the route, lib/chargeOnce, lib/checkoutClaims, lib/squareServer.chargeCard,
// lib/rateLimit, lib/apiAuth, lib/apliiqOrder (the SKU for a size), lib/usAddress, lib/shownTotal, lib/receipt and
// lib/customerMessage (the receipt, written down as sent). Stood in for: the database (scripts/fixtures/moneyWorld),
// Square's Payments API (scripts/fixtures/chargeonce fakeSquare), Apliiq's order call (a recorder that answers as
// lib/apliiq's three answers do: taken, refused, no clear answer), the email provider and the alert writer. Every
// name, card, address and SKU is made up.
//
// What it holds the route to: the card is charged only for a cart the printer can make, at the price the button
// showed, to an address the printer can read — and once per key; the order and its lines written once; the order at
// the printer once, or said to the crew with what to do; the receipt sent, or the crew told it wasn't.
import { routeLoader, moneyWorld, NextResponseShim } from "./fixtures/moneyWorld.mjs";
import { fakeSquare } from "./fixtures/chargeonce.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };

process.env.SQUARE_ACCESS_TOKEN = "made-up-square-access-token";
process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID = "L-MADE-UP-LOCATION";
delete process.env.GT3_INTEGRATION_TENANT_ID;
const TENANT = "00000000-0000-0000-0000-000000000001";   // lib/tenantScope FOUNDING_TENANT

const TEE = "7ee00000-0000-4000-8000-000000000001", CAP = "ca900000-0000-4000-8000-000000000002";
const GONE = "90e00000-0000-4000-8000-000000000003", OLD = "01d00000-0000-4000-8000-000000000004";
const FREE = "f4ee0000-0000-4000-8000-000000000005", BARE = "ba4e0000-0000-4000-8000-000000000006";
const SAM = "0c416000-0000-4000-8000-0000000000a1", SAM_TOKEN = "made-up-session-token-sam";
const LATER = "2026-01-01T00:00:00.000Z";

let w, sq, alerts, mails, printer, printerSays, mailSays, seq = 0;
const uuid = () => `5b000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
function fresh({ limitOk = true, claimSays = "ok", sessions = {} } = {}) {
  const product = (id, title, price, extra = {}) => ({ id, tenant_id: TENANT, title, price_cents: price, cost_cents: Math.round(price / 3), apliiq_product_id: `aq-${title}`,
    variants: null, kind: "merch", published_at: LATER, archived_at: null, ...extra });
  w = moneyWorld({
    tables: {
      shop_products: [
        product(TEE, "Made-up Tee", 2800, { variants: [{ size: "S", sku: "APQ-101S1A1" }, { size: "M", sku: "APQ-101S2A1" }, { size: "L", sku: "APQ-101S3A1" }] }),
        product(CAP, "Made-up Cap", 2400, { variants: [{ size: "adjustable", sku: "APQ-202S9A1" }] }),
        product(GONE, "Unlisted Mug", 1800, { published_at: null }),
        product(OLD, "Retired Hoodie", 5200, { archived_at: LATER }),
        product(FREE, "Unpriced Sticker", 0),
        product(BARE, "Made-up Tote", 2000),                      // no SKU yet: charged, and the crew sends it
        { ...product("0d000000-0000-4000-8000-000000000007", "Bottle", 900), kind: "bottle" },
      ],
      shop_orders: [], shop_order_items: [], checkout_claims: [], customer_messages: [],
    },
    unique: { shop_orders: ["id", "payment_id"], checkout_claims: ["idempotency_key"] },
    defaults: { shop_orders: () => ({ id: uuid(), tenant_id: TENANT, apliiq_order_id: null, apliiq_submit_started_at: null, apliiq_submit_unknown_at: null }) },
    rpc: {
      rate_limit_hit: () => limitOk,
      resolve_customer: () => "c0000000-0000-4000-8000-0000000000c1",
      // 0335/0417's claim, as the database answers it: an order not at the printer and not being sent is claimed.
      claim_shop_order_for_submit: ({ p_order }, world) => {
        const o = world.tables.shop_orders.find((r) => r.id === p_order);
        if (claimSays !== "ok") return claimSays;
        if (!o || o.apliiq_order_id || o.apliiq_submit_started_at) return "busy";
        o.apliiq_submit_started_at = new Date().toISOString();
        return "ok";
      },
    },
    sessions: { [SAM_TOKEN]: { id: SAM, email: "sam@example.test" }, ...sessions },
  });
  sq = fakeSquare();
  globalThis.fetch = (url, init) => sq.fetch(url, init);
  alerts = []; mails = []; printer = []; printerSays = []; mailSays = [];
}
const db = { get supabaseAdmin() { return w; } };
const shims = {
  "next/server": { NextResponse: NextResponseShim },
  "@/lib/supabaseAdmin": db,
  "@supabase/supabase-js": { createClient: () => w },
  "@/lib/serverAlerts": { raiseAlert: async (a) => { alerts.push(a); }, raiseAlertOnce: async (a) => { alerts.push(a); return true; } },
  "@/lib/notify": {
    accountEmail: async (id) => (id === SAM ? "sam@example.test" : null),
    notifyCustomer: async (m) => { mails.push(m); const said = mailSays.shift() ?? "sent"; return { sms: "no-address", email: said, ...(said === "sent" ? { emailId: `re_made_up_${mails.length}` } : { emailDetail: "the mailbox said no" }) }; },
  },
  "@/lib/apliiq": { submitOrderToApliiq: async (order) => { printer.push(JSON.parse(JSON.stringify(order))); return printerSays.shift() ?? { ok: true, apliiqOrderId: `AQ-${1000 + printer.length}` }; } },
};
fresh();
const route = routeLoader(shims)("app/api/shop/checkout/route.ts");

let n = 0;
const key = () => `made-up-shop-key-${String(++n).padStart(4, "0")}-${Math.random().toString(36).slice(2, 10)}`;
const card = () => `cnon:made-up-${Math.random().toString(36).slice(2, 12)}`;
const SHIP = { name: "Dee Example", street: "1 Made-up Way", city: "Greenville", state: "south carolina", zip: "29601", email: "dee@example.test" };
const CART = [{ product_id: TEE, variant: { size: "L" }, qty: 2 }, { product_id: CAP, qty: 1 }];   // $56 + $24
async function post(body, { token = null, ip = "203.0.113.9" } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": ip };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await route.POST(new Request("https://app.example.test/api/shop/checkout", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const orders = () => w.tables.shop_orders;
const lines = () => w.tables.shop_order_items;
const claim = (k) => w.tables.checkout_claims.find((c) => c.idempotency_key === k);
const nothingTaken = () => sq.calls.length === 0 && orders().length === 0 && printer.length === 0;

// ── a guest's cart: charged once, written once, at the printer once, the receipt sent ─────────────────────────────
{
  fresh();
  const k = key(), t = card();
  const r = await post({ sourceId: t, idempotencyKey: k, items: CART, ship: SHIP, expectedCents: 8000 });
  ok("shop: a tee ×2 and a cap — 200, paid, recorded, emailed, the total the button showed", r.status === 200 && r.json?.ok && r.json.paid === true && r.json.recorded === true
    && r.json.emailed === true && r.json.totalCents === 8000 && typeof r.json.id === "string", r);
  ok("shop: Square was asked once, for $80.00, under the page's key, the receipt to the guest's address", sq.calls.length === 1 && sq.calls[0].amount_money.amount === 8000
    && sq.calls[0].idempotency_key === k && sq.calls[0].source_id === t && sq.calls[0].buyer_email_address === "dee@example.test", sq.calls);
  const o = orders()[0];
  ok("shop: one order, carrying Square's payment, the subtotal and total, the state as the printer reads it (SC)",
    orders().length === 1 && o.payment_id === sq.payments[0].id && o.total_cents === 8000 && o.subtotal_cents === 8000 && o.ship_address.state === "SC" && o.ship_address.zip === "29601"
      && o.email === "dee@example.test" && o.user_id === null, o);
  ok("shop: its two lines, priced from the catalog, the size kept on the tee's", lines().length === 2 && lines().every((l) => l.order_id === o.id)
    && lines().some((l) => l.product_id === TEE && l.qty === 2 && l.unit_cents === 2800 && l.variant?.size === "L")
    && lines().some((l) => l.product_id === CAP && l.qty === 1 && l.unit_cents === 2400), lines());
  ok("shop: at the printer once — every line, each with the SKU for what was chosen (the tee's L, the cap's one)",
    printer.length === 1 && printer[0].id === o.id && printer[0].items.length === 2 && printer[0].items.find((i) => i.id === TEE)?.sku === "APQ-101S3A1"
      && printer[0].items.find((i) => i.id === CAP)?.sku === "APQ-202S9A1" && printer[0].ship.state === "SC", printer);
  ok("shop: marked sent — Apliiq's order id on it, status submitted, no 'no clear answer' left on it",
    o.apliiq_order_id === "AQ-1001" && o.status === "submitted" && o.apliiq_submit_unknown_at === null, o);
  ok("shop: the receipt sent once, to the guest, and written down as sent", mails.length === 1 && mails[0].email === "dee@example.test"
    && w.tables.customer_messages.length === 1 && w.tables.customer_messages[0].status === "sent" && w.tables.customer_messages[0].kind === "receipt", { mails, log: w.tables.customer_messages });
  ok("shop: the crew hears one thing — a new order (fyi), no alarm", alerts.length === 1 && alerts[0].kind === "shop_order_new" && alerts[0].severity === "fyi", alerts);
  ok("shop: the claim is settled with the answer the page heard", claim(k) && claim(k).state !== "started" && claim(k).payment_id === sq.payments[0].id, claim(k));
  ok("shop: the page is shown the receipt — the lines as priced and the total charged", r.json.receipt && JSON.stringify(r.json.receipt).includes("Made-up Tee"), r.json.receipt);

  const again = await post({ sourceId: t, idempotencyKey: k, items: CART, ship: SHIP, expectedCents: 8000 });
  ok("shop: the same checkout sent again is answered from its claim — no second charge, order, print or receipt",
    again.status === 200 && again.json?.paid === true && sq.calls.length === 1 && orders().length === 1 && printer.length === 1 && mails.length === 1,
    { again, calls: sq.calls.length, orders: orders().length, printer: printer.length, mails: mails.length });
}

// ── a member: their account's address, their account on the order ──────────────────────────────────────────────────
{
  fresh();
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: [{ product_id: CAP }], ship: { ...SHIP, email: "typed@example.test" }, expectedCents: 2400 }, { token: SAM_TOKEN });
  ok("member: the order is theirs, and the receipt goes to their account's address, not one typed in",
    r.status === 200 && orders()[0]?.user_id === SAM && orders()[0]?.email === "sam@example.test" && mails[0]?.email === "sam@example.test" && sq.calls[0]?.buyer_email_address === "sam@example.test", { r, o: orders()[0], mails });
}

// ── refused before the card: nothing charged, nothing claimed, nothing written ─────────────────────────────────────
const refusals = [
  ["an item no longer listed", { items: [{ product_id: GONE }], expectedCents: 1800 }, 409, /no longer available/],
  ["an item retired", { items: [{ product_id: OLD }], expectedCents: 5200 }, 409, /no longer available/],
  ["an item with no price", { items: [{ product_id: FREE }], expectedCents: 0 }, 409, /isn't priced yet/],
  ["a size the printer doesn't make", { items: [{ product_id: TEE, variant: { size: "XXXL" } }], expectedCents: 2800 }, 409, /isn't one we make/],
  ["a size made up as an object the shape of nothing", { items: [{ product_id: TEE, variant: { weight: "heavy" } }], expectedCents: 2800 }, 409, /isn't one we make/],
  ["only items from another shelf (a bottle is not merch)", { items: [{ product_id: "0d000000-0000-4000-8000-000000000007" }], expectedCents: 900 }, 409, /Nothing in your cart is available/],
  ["an empty cart", { items: [], expectedCents: 0 }, 400, /cart is empty/],
  ["a state outside the US", { ship: { ...SHIP, state: "Ontario" } }, 400, /state to ship to/],
  ["a ZIP of three digits", { ship: { ...SHIP, zip: "296" } }, 400, /ZIP/],
  ["an email that can't take mail", { ship: { ...SHIP, email: "dee at example" } }, 400, /Check the email/],
  ["no name to ship to", { ship: { ...SHIP, name: "   " } }, 400, /full shipping name/],
  ["no card", { sourceId: "" }, 400, /card is required/],
];
for (const [what, change, status, words] of refusals) {
  fresh();
  const k = key();
  const r = await post({ sourceId: card(), idempotencyKey: k, items: CART, ship: SHIP, expectedCents: 8000, ...change });
  ok(`refused, ${what}: ${status}, said plainly — and nothing charged, claimed or written`, r.status === status && words.test(r.json?.error ?? "") && nothingTaken() && !claim(k), { r, calls: sq.calls.length, claim: claim(k) });
}
{
  fresh();
  const k = key();
  const r = await post({ sourceId: card(), idempotencyKey: k, items: CART, ship: SHIP, expectedCents: 7000 });
  ok("price raised while the cart sat: 409 with the total it is now — never charged above the button", r.status === 409 && r.json?.totalChanged === true && r.json.totalCents === 8000 && nothingTaken() && !claim(k), r);
}
{
  fresh();
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: CART, ship: SHIP, expectedCents: 9000 });
  ok("a button that said more ($90) is charged the catalog's $80.00 — the page's number only ever refuses, never prices",
    r.status === 200 && sq.calls[0]?.amount_money.amount === 8000 && orders()[0]?.total_cents === 8000, { r, calls: sq.calls });
}
{
  fresh();
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: [{ product_id: TEE, variant: { size: "M" }, qty: 99 }], ship: SHIP, expectedCents: 56000 });
  ok("a quantity of 99 is twenty — the line, the charge and the order agree", r.status === 200 && sq.calls[0]?.amount_money.amount === 56000 && lines()[0]?.qty === 20 && orders()[0]?.total_cents === 56000, { r, line: lines()[0] });
}
{
  fresh();
  const many = Array.from({ length: 60 }, () => ({ product_id: CAP }));
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: many, ship: SHIP, expectedCents: 40 * 2400 });
  ok("a cart of 60 lines is read as its first 40 — no more is priced, charged or written", r.status === 200 && lines().length === 40 && sq.calls[0]?.amount_money.amount === 96000, { status: r.status, lines: lines().length });
}
{
  fresh({ sessions: { "made-up-session-token-down": "down" } });
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: CART, ship: SHIP, expectedCents: 8000 }, { token: "made-up-session-token-down" });
  ok("a sign-in that couldn't be checked: 503, 'nothing was charged' — never treated as a guest", r.status === 503 && /nothing was charged/.test(r.json?.error ?? "") && nothingTaken(), r);
}
{
  fresh({ limitOk: false });
  const k = key();
  const r = await post({ sourceId: card(), idempotencyKey: k, items: CART, ship: SHIP, expectedCents: 8000 });
  ok("past the limit: 429, nothing charged or claimed", r.status === 429 && nothingTaken() && !claim(k), r);
}
{
  fresh();
  w.fail.shop_products = { select: { code: "57014", message: "canceling statement due to statement timeout" } };
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: CART, ship: SHIP, expectedCents: 8000 });
  ok("the catalog couldn't be read: refused ('couldn't price your cart'), nothing charged", r.status === 500 && /Couldn't price/.test(r.json?.error ?? "") && nothingTaken(), r);
}
{
  fresh();
  for (const body of ["null", "[]", "not json"]) {
    const r = await post(body);
    ok(`a body of ${body}: 400, nothing charged`, r.status === 400 && nothingTaken(), r);
  }
}
{
  fresh();
  const saved = process.env.SQUARE_ACCESS_TOKEN;
  delete process.env.SQUARE_ACCESS_TOKEN;
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: CART, ship: SHIP, expectedCents: 8000 });
  process.env.SQUARE_ACCESS_TOKEN = saved;
  ok("card checkout not switched on: 503, said, nothing charged", r.status === 503 && /isn't switched on/.test(r.json?.error ?? "") && nothingTaken(), r);
}

// ── the card's answers ──────────────────────────────────────────────────────────────────────────────────────────────
{
  fresh();
  sq.script.push("decline");
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: CART, ship: SHIP, expectedCents: 8000 });
  ok("a decline: the one sentence for a refused card, no order, nothing at the printer", r.status >= 400 && r.status < 500 && /declined/i.test(r.json?.error ?? "")
    && sq.payments.length === 0 && orders().length === 0 && printer.length === 0, r);
}
{
  fresh();
  const k = key(), t = card();
  sq.script.push("lose");
  const r = await post({ sourceId: t, idempotencyKey: k, items: CART, ship: SHIP, expectedCents: 8000 });
  ok("Square's answer lost: 'we couldn't confirm — don't pay again' (409, pending); the crew told (critical, money)",
    r.status === 409 && r.json?.pending === true && /Don't pay again/.test(r.json?.error ?? "") && alerts.some((a) => a.severity === "critical" && a.category === "money" && /status unknown/i.test(a.title)), { r, alerts });
  ok("…and no order written on a guess, nothing sent to the printer", sq.payments.length === 1 && orders().length === 0 && printer.length === 0);
  const again = await post({ sourceId: t, idempotencyKey: k, items: CART, ship: SHIP, expectedCents: 8000 });
  ok("…the same key again is not sent to Square again — one charge however many taps", sq.calls.length === 1 && again.status === 409 && again.json?.pending === true, { again, calls: sq.calls.length });
}

// ── after the money: every way the rest can go, said ───────────────────────────────────────────────────────────────
{
  fresh();
  printerSays.push({ ok: false, error: "Apliiq 422: the SKU is not on file" });
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: CART, ship: SHIP, expectedCents: 8000 });
  const o = orders()[0];
  ok("the printer refused: the customer is paid and recorded; the order waits for the crew, not marked sending",
    r.status === 200 && r.json?.recorded === true && o.status === "needs_fulfillment" && o.apliiq_order_id === null && o.apliiq_submit_started_at === null && o.apliiq_submit_unknown_at === null, { r, o });
  ok("…and the crew is told what Apliiq said and that nothing reached it", alerts.some((a) => a.kind === "fulfillment" && /needs sending to the printer/.test(a.title) && /SKU is not on file/.test(a.body) && a.subjectId === o.id), alerts);
}
{
  fresh();
  printerSays.push({ ok: false, unclear: true, error: "no answer from Apliiq — timeout" });
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: CART, ship: SHIP, expectedCents: 8000 });
  const o = orders()[0];
  ok("no clear answer from the printer: the order reads 'no clear answer', so Send to printer can't print a second",
    r.status === 200 && o.apliiq_submit_unknown_at !== null && o.apliiq_submit_started_at === null && o.apliiq_order_id === null, o);
  ok("…and the crew is told to look in Apliiq before sending it again", alerts.some((a) => a.kind === "printer_unclear" && /Look in Apliiq/.test(a.body)), alerts);
}
{
  fresh({ claimSays: "busy" });
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: CART, ship: SHIP, expectedCents: 8000 });
  ok("the order couldn't be claimed for sending: not sent, and the crew told to send it from the order",
    r.status === 200 && r.json?.recorded === true && printer.length === 0 && alerts.some((a) => /needs sending to the printer/.test(a.title) && /busy/.test(a.body)), { r, alerts });
}
{
  fresh();
  w.fail.shop_order_items = { insert: { error: { code: "XX000", message: "the disk said no" }, sticky: true } };
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: CART, ship: SHIP, expectedCents: 8000 });
  ok("the lines didn't save (twice): the crew is told what they were (critical) — the customer still paid and recorded",
    r.status === 200 && r.json?.recorded === true && lines().length === 0
      && alerts.some((a) => a.severity === "critical" && /saved without its items/.test(a.title) && /2× Made-up Tee \(L\)/.test(a.body)), { r, alerts: alerts.map((a) => a.title) });
}
{
  fresh();
  w.fail.shop_orders = { insert: { error: { code: "XX000", message: "the disk said no" }, sticky: true } };
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: CART, ship: SHIP, expectedCents: 8000 });
  ok("the order didn't save (twice): 'paid — ref …, we've alerted the crew' — never a failed checkout", r.status === 200 && r.json?.paid === true && r.json.recorded === false
    && typeof r.json.ref === "string" && r.json.ref.length === 6 && /alerted the crew/.test(r.json.warn ?? ""), r);
  ok("…the crew told (critical, money) with the payment to find; nothing sent to the printer, no receipt",
    alerts.some((a) => a.severity === "critical" && a.category === "money" && /didn't record/.test(a.title) && a.body.includes(sq.payments[0].id)) && printer.length === 0 && mails.length === 0, alerts);
}
{
  fresh();
  mailSays.push("failed");
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: CART, ship: SHIP, expectedCents: 8000 });
  ok("the receipt didn't send: the page doesn't promise one, the crew is told, and it's written down as failed",
    r.status === 200 && r.json?.emailed === false && alerts.some((a) => /receipt didn't send/.test(a.title) && /the mailbox said no/.test(a.body))
      && w.tables.customer_messages[0]?.status === "failed", { r, alerts: alerts.map((a) => a.title) });
}
{
  fresh();
  const r = await post({ sourceId: card(), idempotencyKey: key(), items: [{ product_id: BARE }], ship: SHIP, expectedCents: 2000 });
  ok("a product with no SKU yet: charged and recorded; sent to the printer as it is, which says why it can't be made",
    r.status === 200 && r.json?.recorded === true && printer.length === 1 && printer[0].items?.length === 1 && printer[0].items[0].sku === null, { r, printer });
}

console.log(`\nTHE SHOP'S CHECKOUT, RUN (app/api/shop/checkout): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
