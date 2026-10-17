// THE MONEY ROUTES, RUN (R16, 2026-10-17 — the 10/10 audit, operations F13).
//
// /api/checkout — the cup checkout, card and pay at pickup — compiled from its own TypeScript and called with a Request,
// as Next calls it: the real route, and under it the real lib/chargeOnce, lib/checkoutClaims, lib/squareServer.chargeCard,
// lib/rateLimit, lib/orderingRead, lib/drinksRead, lib/cupPrice, lib/catalog and lib/apiAuth. Stood in for: the database
// (scripts/fixtures/moneyWorld — tables, unique keys, rpc, auth), Square's Payments API (scripts/fixtures/chargeonce
// fakeSquare, as its documentation describes it), and the alert and email senders (recorders). Every name, card token
// and key is made up.
//
// What it holds the route to: a charge only after every check has said yes and the key is claimed; one charge per key,
// however many times it is sent; nothing charged when a check refuses — the amount, the stock, the truck, the sign-in,
// the limit, the claims table; the order written once, paid, with its payment; and a payment that could not be recorded,
// or an answer Square never gave, said to the crew.
import { routeLoader, moneyWorld, NextResponseShim } from "./fixtures/moneyWorld.mjs";
import { fakeSquare } from "./fixtures/chargeonce.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };

process.env.SQUARE_ACCESS_TOKEN = "made-up-square-access-token";
process.env.NEXT_PUBLIC_SQUARE_APP_ID = "sandbox-sq0idb-made-up";
process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID = "L-MADE-UP-LOCATION";

const STOP = "5d000000-0000-4000-8000-000000000001";
const SAM = "0c416000-0000-4000-8000-0000000000a1";
const SAM_TOKEN = "made-up-session-token-sam";
const H = 3600_000;

// ── the world under the route ──────────────────────────────────────────────────────────────────────────────────────
let w, sq, alerts, mails;
function fresh({ live = true, soldOut = false, out86 = [], sessions = {}, startsInH = -1 } = {}) {
  const now = Date.now();
  w = moneyWorld({
    tables: {
      products: [
        { slug: "cold-brew", name: "Cold Brew", line: "brew", price_cents: 600, sort: 1, active: true, cup_orderable: true, sold_out: soldOut },
        { slug: "nitro", name: "Nitro", line: "brew", price_cents: 700, sort: 2, active: true, cup_orderable: true, sold_out: false },
      ],
      product_86: out86.map((slug) => ({ market: "greenville", slug })),
      market_live: [{ market: "greenville", is_live: live, preorder_lead_h: 4, pre_launch: false, held_closed: false }],
      live_status: [{ id: 1, is_live: live, preorder_lead_h: 4, current_stop_id: live ? STOP : null, pay_at_pickup: true }],
      stops: [{ id: STOP, name: "Made-up Market", market: "greenville", starts_at: new Date(now + startsInH * H).toISOString(), ends_at: new Date(now + (startsInH + 4) * H).toISOString(),
        archived_at: null, status: "live", completed_at: null, location_text: "Made-up Market, Main St", address: "1 Main St", lat: null, lng: null,
        order_ahead_enabled: true, order_ahead_lead_min: null, pickup_enabled: true }],
      orders: [], checkout_claims: [], customers: [], member_benefits: [],
    },
    unique: { orders: ["id", "payment_id"], checkout_claims: ["idempotency_key"] },
    rpc: {
      rate_limit_hit: () => true,
      stop_menu: () => null,
      resolve_customer: () => "c0000000-0000-4000-8000-0000000000c1",
    },
    sessions: { [SAM_TOKEN]: { id: SAM, email: "sam@example.test" }, ...sessions },
    embed: {
      // readCityOut: product_86 joined to products, this market's, these slugs — as PostgREST's inner join answers it.
      product_86: ({ ops, rows }) => {
        const market = ops.find((o) => o[0] === "eq" && o[1] === "market")?.[2];
        const slugs = ops.find((o) => o[0] === "in" && o[1] === "products.slug")?.[2] ?? null;
        return rows.filter((r) => r.market === market && (!slugs || slugs.includes(r.slug))).map((r) => ({ products: { slug: r.slug } }));
      },
    },
  });
  sq = fakeSquare();
  globalThis.fetch = (url, init) => sq.fetch(url, init);
  alerts = []; mails = [];
}
const db = { get supabaseAdmin() { return w; } };
const shims = {
  "next/server": { NextResponse: NextResponseShim },
  "@/lib/supabaseAdmin": db,
  "@supabase/supabase-js": { createClient: () => w },
  "@/lib/serverAlerts": { raiseAlert: async (a) => { alerts.push(a); }, raiseAlertOnce: async (a) => { alerts.push(a); return true; } },
  "@/lib/notify": { notifyCustomer: async (m) => { mails.push(m); return true; }, accountEmail: async () => "sam@example.test" },
};
fresh();
const route = routeLoader(shims)("app/api/checkout/route.ts");

let n = 0;
const key = () => `made-up-key-${String(++n).padStart(4, "0")}-${Math.random().toString(36).slice(2, 10)}`;
const card = () => `cnon:made-up-${Math.random().toString(36).slice(2, 12)}`;
async function post(body, { token = null, ip = "203.0.113.7" } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": ip };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await route.POST(new Request("https://app.example.test/api/checkout", { method: "POST", headers, body: JSON.stringify(body) }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const orders = () => w.tables.orders;
const claim = (k) => w.tables.checkout_claims.find((c) => c.idempotency_key === k);

// ── a card checkout, and the same one sent again ──────────────────────────────────────────────────────────────────
{
  fresh();
  const k = key(), t = card();
  const r = await post({ sourceId: t, items: ["cold-brew", "nitro"], tipCents: 200, customer: "Dee", idempotencyKey: k, expectedCents: 1500 });
  ok("card: two drinks and a tip — 200, paid, recorded, the order's number said", r.status === 200 && r.json?.ok && r.json.paid === true && r.json.recorded === true && typeof r.json.no === "string", r);
  ok("card: Square was asked once, for the amount on the button ($13 + $2 tip), under the page's key", sq.calls.length === 1 && sq.calls[0].amount_money.amount === 1500
    && sq.calls[0].idempotency_key === k && sq.calls[0].source_id === t, sq.calls);
  const o = orders();
  ok("card: one order, paid, carrying Square's payment and the goods subtotal (the tip beside it)",
    o.length === 1 && o[0].paid === true && o[0].payment_id === sq.payments[0].id && o[0].total_cents === 1300 && o[0].tip_cents === 200 && o[0].stop_id === STOP, o);
  ok("card: the claim is kept, settled, with the answer the page heard", claim(k) && claim(k).state !== "started" && claim(k).payment_id === sq.payments[0].id, claim(k));
  const again = await post({ sourceId: t, items: ["cold-brew", "nitro"], tipCents: 200, customer: "Dee", idempotencyKey: k, expectedCents: 1500 });
  ok("card: the same checkout sent again is answered from its claim — no second call to Square, no second order",
    again.status === 200 && again.json?.paid === true && sq.calls.length === 1 && orders().length === 1, { again, calls: sq.calls.length, orders: orders().length });
  ok("card: a guest's order sends no email and raises no alert", mails.length === 0 && alerts.length === 0, { mails, alerts });
}

// ── the server's price, whatever the page said ─────────────────────────────────────────────────────────────────────
{
  fresh();
  const r = await post({ sourceId: card(), items: ["cold-brew", "nitro"], tipCents: 200, customer: "Dee", idempotencyKey: key(), expectedCents: 2000 });
  // The cup checkout asks for the number exactly (a lower one too): the page is told the real total and asked again. The
  // page's number is never what is charged — it only ever stops a charge.
  ok("a button that said more ($20): refused with the real total ($15: the menu's $13 and the $2 tip) — nothing charged at the page's number",
    r.status === 409 && r.json?.priceChanged === true && r.json.amountCents === 1500 && sq.calls.length === 0 && orders().length === 0, { r, calls: sq.calls });
}

// ── a member: the email, the account ───────────────────────────────────────────────────────────────────────────────
{
  fresh();
  const r = await post({ sourceId: card(), items: ["cold-brew"], customer: "Sam", idempotencyKey: key(), expectedCents: 600 }, { token: SAM_TOKEN });
  ok("member: the order is theirs — their account on it, and the 'order in' email to their account",
    r.status === 200 && orders()[0]?.user_id === SAM && mails.length === 1 && /order .+ is in/.test(mails[0].subject), { r, order: orders()[0], mails });
}

// ── a decline ───────────────────────────────────────────────────────────────────────────────────────────────────────
{
  fresh();
  const k = key();
  sq.script.push("decline");
  const r = await post({ sourceId: card(), items: ["cold-brew"], customer: "Dee", idempotencyKey: k, expectedCents: 600 });
  ok("decline: the card's refusal, nothing charged, no order", r.status >= 400 && r.status < 500 && /declined/i.test(r.json?.error ?? "") && orders().length === 0 && sq.payments.length === 0, r);
}

// ── Square's answer lost on the way back ────────────────────────────────────────────────────────────────────────────
{
  fresh();
  const k = key(), t = card();
  sq.script.push("lose");
  const r = await post({ sourceId: t, items: ["cold-brew"], customer: "Dee", idempotencyKey: k, expectedCents: 600 });
  ok("lost answer: 502 'may have been charged' — the page keeps the key; the crew told (critical, money)",
    r.status === 502 && r.json?.pending === true && alerts.some((a) => a.severity === "critical" && a.category === "money" && /status unknown/i.test(a.title)), { r, alerts });
  ok("lost answer: Square did take it — and no order was written on a guess", sq.payments.length === 1 && orders().length === 0);
  const again = await post({ sourceId: t, items: ["cold-brew"], customer: "Dee", idempotencyKey: k, expectedCents: 600 });
  ok("lost answer: the same key again is NOT sent to Square again (the claim says unknown) — one charge, however many taps",
    sq.calls.length === 1 && sq.payments.length === 1 && again.status >= 400, { again, calls: sq.calls.length });
}

// ── every refusal before the card: nothing claimed, nothing charged ─────────────────────────────────────────────────
{
  fresh();
  const k = key();
  const r = await post({ sourceId: card(), items: ["cold-brew"], customer: "Dee", idempotencyKey: k, expectedCents: 500 });
  ok("price changed: the amount on the button isn't what it costs now → 409 with the new amount; nothing claimed or charged",
    r.status === 409 && r.json?.priceChanged === true && r.json.amountCents === 600 && sq.calls.length === 0 && !claim(k), r);
}
{
  fresh({ soldOut: true });
  const r = await post({ sourceId: card(), items: ["cold-brew"], customer: "Dee", idempotencyKey: key(), expectedCents: 600 });
  ok("sold out everywhere → 409 naming it; nothing charged", r.status === 409 && /Cold Brew just sold out/.test(r.json?.error ?? "") && sq.calls.length === 0, r);
}
{
  fresh({ out86: ["nitro"] });
  const r = await post({ sourceId: card(), items: ["nitro"], customer: "Dee", idempotencyKey: key(), expectedCents: 700 });
  ok("86'd in this city by the Pass → 409; nothing charged", r.status === 409 && /Nitro just sold out/.test(r.json?.error ?? "") && sq.calls.length === 0, r);
}
{
  // Not live, and the next stop ten hours off — past its four-hour pre-order window. (A stop under way takes orders with
  // the switch off: lib/ordering's "started"; that is the rule, not this test's subject.)
  fresh({ live: false, startsInH: 10 });
  const r = await post({ sourceId: card(), items: ["cold-brew"], customer: "Dee", idempotencyKey: key(), expectedCents: 600 });
  ok("the truck isn't taking orders yet → 409 in the ordering's words; nothing charged", r.status === 409 && typeof r.json?.error === "string" && sq.calls.length === 0, r);
}
{
  fresh({ sessions: { "made-up-token-while-auth-is-down": "down" } });
  const k = key();
  const r = await post({ sourceId: card(), items: ["cold-brew"], customer: "Dee", idempotencyKey: k, expectedCents: 600 }, { token: "made-up-token-while-auth-is-down" });
  ok("sign-in couldn't be checked (the auth service down) → 503, never charged as a guest", r.status === 503 && /couldn't check your sign-in/i.test(r.json?.error ?? "") && sq.calls.length === 0 && !claim(k), r);
}
{
  fresh();
  w.rpcs.rate_limit_hit = () => false;
  const r = await post({ sourceId: card(), items: ["cold-brew"], customer: "Dee", idempotencyKey: key(), expectedCents: 600 });
  ok("over the card limit → 429; nothing charged", r.status === 429 && sq.calls.length === 0, r);
}
{
  fresh();
  w.fail.checkout_claims = { select: { error: { code: "PGRST205", message: "Could not find the table 'public.checkout_claims' in the schema cache" } } };
  const quiet = console.error; console.error = () => {};
  const r = await post({ sourceId: card(), items: ["cold-brew"], customer: "Dee", idempotencyKey: key(), expectedCents: 600 });
  console.error = quiet;
  await new Promise((res) => setTimeout(res, 20));   // the crew's alert is sent from a lazily loaded module
  ok("claims table missing → refused, nothing charged (R14: the guard fails closed) — and the crew told",
    r.status >= 500 && r.json?.charged === false && sq.calls.length === 0 && alerts.some((a) => /claims table/i.test(a.title)), { r, alerts });
}
{
  fresh();
  w.fail.products = { select: { error: { code: "57014", message: "canceling statement due to statement timeout" } } };
  const r = await post({ sourceId: card(), items: ["cold-brew"], customer: "Dee", idempotencyKey: key(), expectedCents: 600 });
  ok("the menu couldn't be read → 503, nothing charged (a failed read is not an empty menu)", r.status === 503 && r.json?.charged === false && sq.calls.length === 0, r);
}
{
  fresh();
  const r = await post({ sourceId: card(), items: ["made-up-drink"], customer: "Dee", idempotencyKey: key(), expectedCents: 600 });
  ok("a drink the Catalog doesn't have → 409 'isn't on the menu'; nothing charged", r.status === 409 && /isn't on the menu any more/.test(r.json?.error ?? "") && sq.calls.length === 0, r);
}

// ── paid, and the order wouldn't save ───────────────────────────────────────────────────────────────────────────────
{
  fresh();
  w.fail.orders = { insert: { sticky: true, error: { code: "P0001", message: "Cold Brew is sold out" } } };
  const r = await post({ sourceId: card(), items: ["cold-brew"], customer: "Dee", idempotencyKey: key(), expectedCents: 600 });
  const said = alerts.find((a) => /Paid order didn't record/.test(a.title));
  ok("paid, not recorded: the customer told the payment went through with a ref to show; the crew told, critical, with the payment and why",
    r.status === 200 && r.json?.paid === true && r.json.recorded === false && typeof r.json.ref === "string" && !!said && said.severity === "critical"
      && said.body.includes(sq.payments[0].id) && /sold out/.test(said.body), { r, said });
  ok("paid, not recorded: tried twice before saying so", w.calls.filter((c) => c.table === "orders" && c.op === "insert").length === 2);
}

// ── pay at pickup ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  fresh();
  const k = key();
  const r = await post({ items: ["cold-brew"], customer: "Dee", idempotencyKey: k, expectedCents: 600 });
  ok("pay at pickup: 200, unpaid, recorded — no call to Square", r.status === 200 && r.json?.paid === false && r.json.recorded === true && sq.calls.length === 0, r);
  ok("pay at pickup: one unpaid order, no payment", orders().length === 1 && orders()[0].paid === false && orders()[0].payment_id === null, orders());
  const again = await post({ items: ["cold-brew"], customer: "Dee", idempotencyKey: k, expectedCents: 600 });
  ok("pay at pickup: the same tap again is the same order, not a second ticket on the Pass", again.status === 200 && orders().length === 1, { again, n: orders().length });
  const nameless = await post({ items: ["cold-brew"], idempotencyKey: key(), expectedCents: 600 });
  ok("pay at pickup: a name is needed for the window", nameless.status === 400 && /name/i.test(nameless.json?.error ?? ""), nameless);
}
{
  fresh();
  w.tables.live_status[0].pay_at_pickup = false;
  const r = await post({ items: ["cold-brew"], customer: "Dee", idempotencyKey: key(), expectedCents: 600 });
  ok("pay at pickup switched off by the owner → 409, nothing written", r.status === 409 && orders().length === 0, r);
}

// ── the request itself ──────────────────────────────────────────────────────────────────────────────────────────────
{
  fresh();
  const empty = await post({ sourceId: card(), items: [], idempotencyKey: key() });
  const many = await post({ sourceId: card(), items: Array.from({ length: 30 }, () => "cold-brew"), idempotencyKey: key() });
  ok("an empty order and an order past the cap are refused before anything is read", empty.status === 400 && many.status === 400 && sq.calls.length === 0, { empty, many });
  const res = await route.POST(new Request("https://app.example.test/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: "null" }));
  ok("a body of null is a 400, not a crash", res.status === 400);
}

// ═══ /api/office — an office booking, made once (R15, 0422 — the 10/10 audit, API F25) ═══════════════════════════════
const office = routeLoader(shims)("app/api/office/route.ts");
const { randomUUID } = await import("node:crypto");
function officeWorld() {
  w = moneyWorld({
    tables: { live_status: [{ id: 1, office_price_cents: 4500, office_min_gallons: 3 }], business_accounts: [], business_orders: [] },
    unique: { business_orders: ["id", ["user_id", "idempotency_key"]] },
    defaults: { business_orders: () => ({ id: randomUUID() }), business_accounts: () => ({ id: randomUUID() }) },
    rpc: {
      rate_limit_hit: () => true,
      office_next_delivery: () => [{ delivery_date: "2026-10-19", cutoff_at: "2026-10-16T22:00:00Z", delivery_window: "mon_0500_0800" }],
    },
    sessions: { [SAM_TOKEN]: { id: SAM, email: "sam@example.test" } },
  });
  alerts = []; mails = [];
}
const booking = (extra = {}) => ({ company: "Acme Dental", contact: "Dee Ross", phone: "8645550100", street: "1 Main St", city: "Greenville", zip: "29601", gallons: 3, billing: "prepaid", ...extra });
async function book(body, token = SAM_TOKEN) {
  const headers = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await office.POST(new Request("https://app.example.test/api/office", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => null) };
}
const bookings = () => w.tables.business_orders;
const newOrderAlerts = () => alerts.filter((a) => a.kind === "office_order_new");
{
  officeWorld();
  const k = "0c422000-made-up-booking-key";
  const first = await book(booking({ key: k }));
  ok("office: a booking with its key — 200, one order carrying the key, one alert for the crew",
    first.status === 200 && first.json?.ok && bookings().length === 1 && bookings()[0].idempotency_key === k && newOrderAlerts().length === 1, { first, rows: bookings(), alerts });
  const again = await book(booking({ key: k }));
  ok("office: the same booking again (its answer lost, tapped again) → the FIRST booking, said again — no second order, no second alert",
    again.status === 200 && again.json?.id === first.json.id && again.json.again === true && bookings().length === 1 && newOrderAlerts().length === 1, { again, n: bookings().length });
  const other = await book(booking({ key: "0c422000-another-booking-key" }));
  ok("office: a new booking (a new key) is a new order", other.status === 200 && other.json.id !== first.json.id && bookings().length === 2);
  const old = await book(booking());
  ok("office: an app from before keys books as it always did", old.status === 200 && bookings().length === 3 && bookings()[2].idempotency_key === undefined, bookings()[2]);
  const odd = await book(booking({ key: "bad key with spaces" }));
  ok("office: a key that isn't one is no key (the booking is made, without it)", odd.status === 200 && bookings().length === 4 && bookings()[3].idempotency_key === undefined);
}
{
  // Before 0422 is pasted: the column isn't there, so PostgREST refuses the key — the booking is made without it.
  officeWorld();
  w.fail.business_orders = { insert: { error: { code: "PGRST204", message: "Could not find the 'idempotency_key' column of 'business_orders' in the schema cache" } } };
  const r = await book(booking({ key: "0c422000-before-the-paste" }));
  ok("office (before 0422): the key's column missing → booked without it, as before (arrives-with: 0422)",
    r.status === 200 && r.json?.ok && bookings().length === 1 && bookings()[0].idempotency_key === undefined, { r, rows: bookings() });
}
{
  officeWorld();
  const r = await book(booking({ key: "0c422000-made-up-booking-key" }), null);
  ok("office: no session → 401, nothing written", r.status === 401 && bookings().length === 0, r);
  const big = await book(booking({ gallons: 500, key: "0c422000-a-big-one-here" }));
  ok("office: more than 100 gallons → 400, nothing written", big.status === 400 && bookings().length === 0, big);
}

console.log(`\nTHE MONEY ROUTES, RUN — /api/checkout and /api/office: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
