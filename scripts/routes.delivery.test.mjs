// SUNDAY DELIVERY'S CHECKOUT, RUN (R16, 2026-10-17 — the 10/10 audit, operations F13 and API F8).
//
// /api/delivery/checkout compiled from its own TypeScript and called with a Request, as Next calls it. Real: the route,
// lib/delivery (the quote, the zone, the Sundays on offer), lib/chargeOnce, lib/checkoutClaims, lib/squareServer
// .chargeCard, lib/cardGuard and lib/rateLimit, lib/packRoad.cityHolds, lib/apiAuth, lib/shownTotal. Stood in for: the
// database (scripts/fixtures/moneyWorld), Square (scripts/fixtures/chargeonce fakeSquare), the customer's messages and
// the alert writer (recorders). Every name, phone, card and street is made up.
//
// What it holds the route to: a delivery is charged only to a member, in the zone, for a pack that adds up, at the
// server's price and never above the button, for a Sunday still on offer in a city taking orders, with premium
// bottles only while their own rows offer them — once per key; then written once, with what was charged.
import { routeLoader, moneyWorld, NextResponseShim } from "./fixtures/moneyWorld.mjs";
import { fakeSquare } from "./fixtures/chargeonce.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };

process.env.SQUARE_ACCESS_TOKEN = "made-up-square-access-token";
process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID = "L-MADE-UP-LOCATION";
delete process.env.NEXT_PUBLIC_TEXTS_ON;

const SAM = "0c416000-0000-4000-8000-0000000000a1", SAM_TOKEN = "made-up-session-token-sam";
const DOWN_TOKEN = "made-up-session-token-down";

let w, sq, alerts, told, yeses, blockedBuckets;
function fresh({ market = { market: "greenville", pre_launch: false, opens_on: null, held_closed: false }, products = [] } = {}) {
  w = moneyWorld({
    tables: {
      market_live: market ? [market] : [],
      products: [
        { slug: "salted-latte", active: true, sold_out: false, bulk_orderable: true, bulk_tier: "premium" },
        { slug: "unflagged-latte", active: true, sold_out: false, bulk_orderable: false, bulk_tier: "premium" },
        { slug: "sold-latte", active: true, sold_out: true, bulk_orderable: true, bulk_tier: "premium" },
        { slug: "plain-cold-brew", active: true, sold_out: false, bulk_orderable: true, bulk_tier: "standard" },
        ...products,
      ],
      delivery_orders: [], checkout_claims: [],
    },
    unique: { delivery_orders: ["payment_id"], checkout_claims: ["idempotency_key"] },
    rpc: {
      rate_limit_hit: ({ p_bucket }) => !blockedBuckets.includes(p_bucket),
      resolve_customer: () => "c0000000-0000-4000-8000-0000000000c1",
    },
    sessions: { [SAM_TOKEN]: { id: SAM, email: "sam@example.test" }, [DOWN_TOKEN]: "down" },
  });
  sq = fakeSquare();
  globalThis.fetch = (url, init) => sq.fetch(url, init);
  alerts = []; told = []; yeses = []; blockedBuckets = [];
}
const db = { get supabaseAdmin() { return w; } };
const shims = {
  "next/server": { NextResponse: NextResponseShim },
  "@/lib/supabaseAdmin": db,
  "@supabase/supabase-js": { createClient: () => w },
  "@/lib/serverAlerts": { raiseAlert: async (a) => { alerts.push(a); }, raiseAlertOnce: async (a) => { alerts.push(a); return true; } },
  "@/lib/notify": {
    accountEmail: async (id) => (id === SAM ? "sam@example.test" : null),
    whoAsked: async (b) => [b?.name, b?.phone].filter(Boolean).join(", ") || "a member",
    notifyCustomer: async (m) => { told.push(m); return { sms: "off", email: "sent" }; },
    sayTextYes: async (phone, source, userId) => { yeses.push({ phone, source, userId }); return { ok: true, standing: true }; },
  },
};
fresh();
const load = routeLoader(shims);
const route = load("app/api/delivery/checkout/route.ts");
const D = load("lib/delivery.ts");   // the same module the route reads: the Sundays on offer, from its clock

let n = 0;
const key = () => `made-up-delivery-key-${String(++n).padStart(4, "0")}-${Math.random().toString(36).slice(2, 10)}`;
const card = () => `cnon:made-up-${Math.random().toString(36).slice(2, 12)}`;
const sunday = () => D.deliverySlotChoices(Date.now())[0];
// A dozen: six rise, six flow, four of them into rinsed empties. Known pair, by hand from lib/bottlePricing and
// lib/delivery's DELIVERY_PRICING: 4 × $8 + 8 × $10 + the $10 fee = $122.00.
const DOZEN = () => ({ name: "Dee Example", phone: "864-555-0142", addressStreet: "1 Made-up Way", addressCity: "Greenville", addressZip: "29601",
  packSize: 12, riseCount: 6, flowCount: 6, duskCount: 0, refillCount: 4, emptiesAck: true, expectedCents: 12200, deliveryDate: sunday().deliveryDateKey });
async function post(body, { token = SAM_TOKEN, ip = "203.0.113.11" } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": ip };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await route.POST(new Request("https://app.example.test/api/delivery/checkout", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const rows = () => w.tables.delivery_orders;
const claim = (k) => w.tables.checkout_claims.find((c) => c.idempotency_key === k);
const nothingTaken = () => sq.calls.length === 0 && rows().length === 0;

// ── a member's dozen for this Sunday: charged once, written once, said ─────────────────────────────────────────────
{
  fresh();
  const k = key(), t = card(), slot = sunday();
  const r = await post({ ...DOZEN(), sourceId: t, idempotencyKey: k, accessInstructions: "Gate code is made up" });
  ok("delivery: a dozen with four refills — 200, recorded, the Sunday it was booked for, $122.00", r.status === 200 && r.json?.ok && r.json.recorded === true
    && r.json.totalCents === 12200 && r.json.deliveryDateKey === slot.deliveryDateKey && r.json.paymentId === sq.payments[0]?.id, r);
  ok("delivery: Square was asked once, for $122.00, under the page's key, the receipt to the account's address",
    sq.calls.length === 1 && sq.calls[0].amount_money.amount === 12200 && sq.calls[0].idempotency_key === k && sq.calls[0].buyer_email_address === "sam@example.test", sq.calls);
  const o = rows()[0];
  ok("delivery: one row — the member's, paid by card, for that Sunday, the quote's own split (4 refill · 8 new · $10 fee)",
    rows().length === 1 && o.user_id === SAM && o.payment_status === "paid" && o.payment_method === "square" && o.payment_id === sq.payments[0].id
      && o.delivery_date === slot.deliveryDateKey && o.refill_count === 4 && o.new_count === 8 && o.delivery_fee_cents === 1000 && o.bottle_subtotal_cents === 11200
      && o.total_cents === 12200 && o.empties_expected === 4 && typeof o.empty_ack_at === "string" && o.access_instructions === "Gate code is made up", o);
  ok("delivery: the customer told once (the phone, the account's email), what was charged and when to set the empties out",
    told.length === 1 && told[0].phone === "864-555-0142" && told[0].email === "sam@example.test" && /\$122/.test(told[0].message) && /4 rinsed empties out by 5 AM/.test(told[0].message), told);
  ok("delivery: the crew hears one thing — a new Sunday delivery (important, a link to the console)", alerts.length === 1 && alerts[0].severity === "important" && /New Sunday delivery/.test(alerts[0].title) && alerts[0].link === "/crew?s=now", alerts);
  ok("delivery: no yes to texts asked for, none kept", yeses.length === 0);
  ok("delivery: the claim settled with the payment", claim(k) && claim(k).state !== "started" && claim(k).payment_id === sq.payments[0].id, claim(k));
  const again = await post({ ...DOZEN(), sourceId: t, idempotencyKey: k });
  ok("delivery: the same checkout again is answered from its claim — no second charge, row or message",
    again.status === 200 && again.json?.recorded === true && sq.calls.length === 1 && rows().length === 1 && told.length === 1, { again, calls: sq.calls.length, rows: rows().length });
}

// ── the server's price, whatever the page said ─────────────────────────────────────────────────────────────────────
{
  fresh();
  const r = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key(), expectedCents: 13000 });
  ok("a button that said more ($130) is charged the server's $122.00 — the page's number only ever refuses, never prices",
    r.status === 200 && sq.calls[0]?.amount_money.amount === 12200 && rows()[0]?.total_cents === 12200, { r, calls: sq.calls });
}

// ── the premium bottle: charged at $14 only while its own row offers it ────────────────────────────────────────────
{
  fresh();
  // Six: four rise, two salted lattes. $10 × 4 + $14 × 2 + the $10 fee = $78.00 (known pair).
  const r = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key(), packSize: 6, riseCount: 4, flowCount: 0, perfMix: { "salted-latte": 2 }, refillCount: 0, emptiesAck: false, expectedCents: 7800 });
  ok("premium: two salted lattes in a six — $78.00, the bottles named on the row, always fresh", r.status === 200 && sq.calls[0]?.amount_money.amount === 7800
    && rows()[0]?.performance_count === 2 && rows()[0]?.performance_mix?.["salted-latte"] === 2 && rows()[0]?.refill_count === 0, { r, row: rows()[0] });
}
for (const [what, slug] of [["one the owner unflagged while the page sat open", "unflagged-latte"], ["one sold out", "sold-latte"],
  ["one not of the premium tier", "plain-cold-brew"], ["a slug with no row at all", "made-up-latte"]]) {
  fresh();
  const r = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key(), packSize: 6, riseCount: 5, flowCount: 0, perfMix: { [slug]: 1 }, refillCount: 0, emptiesAck: false, expectedCents: 7400 });
  ok(`premium refused, ${what}: 409 naming it, charged:false, nothing written`, r.status === 409 && r.json?.charged === false && r.json.error.includes(slug) && nothingTaken(), r);
}
{
  fresh();
  w.fail.products = { select: { code: "57014", message: "canceling statement due to statement timeout" } };
  const r = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key(), packSize: 6, riseCount: 4, flowCount: 0, perfMix: { "salted-latte": 2 }, refillCount: 0, emptiesAck: false, expectedCents: 7800 });
  ok("premium: the bottles couldn't be read — 503, 'nothing was charged' (fails closed, not open)", r.status === 503 && r.json?.charged === false && /Nothing was charged/.test(r.json.error) && nothingTaken(), r);
}

// ── refused before the card ─────────────────────────────────────────────────────────────────────────────────────────
const refusals = [
  ["a ZIP outside the zone", { addressZip: "90210" }, 400, /isn't in the delivery zone/],
  ["a phone of only spaces", { phone: "   " }, 400, /a phone the driver can call/],
  ["no street", { addressStreet: "" }, 400, /Missing delivery details/],
  ["no card", { sourceId: "" }, 400, /Missing delivery details/],
  ["a pack of seven", { packSize: 7, riseCount: 7, flowCount: 0 }, 400, /Pick a pack size/],
  ["picks that don't add up to the pack", { riseCount: 5 }, 400, /don't add up to 12/],
  ["a negative count, read as none", { riseCount: -6, flowCount: 18 }, 400, /don't add up to 12/],
  ["more refills than bottles", { refillCount: 13 }, 400, /Too many refills/],
  ["refills without the empties promise", { emptiesAck: false }, 400, /empties out by 5 AM/],
  ["a Sunday no longer on offer", { deliveryDate: "2020-01-05" }, 409, /That Sunday just closed/],
  ["a price raised while the page sat (the button said $100)", { expectedCents: 10000 }, 409, /The total is \$122/],
];
for (const [what, change, status, words] of refusals) {
  fresh();
  const k = key();
  const r = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: k, ...change });
  ok(`refused, ${what}: ${status}, said — nothing charged, claimed or written`, r.status === status && words.test(r.json?.error ?? "") && nothingTaken() && !claim(k), { r, calls: sq.calls.length });
}
{
  fresh();
  const r = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key(), deliveryDate: "2020-01-05" });
  ok("a closed Sunday is answered with the two on offer now, so the page can show them", r.json?.slotClosed === true && Array.isArray(r.json.choices) && r.json.choices.length === 2
    && r.json.choices[0].deliveryDateKey === sunday().deliveryDateKey, r.json);
}
{
  fresh();
  const r = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key() }, { token: null });
  ok("a guest: 401 'sign in to order delivery', nothing charged", r.status === 401 && /Sign in/.test(r.json?.error ?? "") && nothingTaken(), r);
  const down = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key() }, { token: DOWN_TOKEN });
  ok("a sign-in that couldn't be checked: 503 'nothing was charged' — not 'sign in'", down.status === 503 && /nothing was charged/.test(down.json?.error ?? "") && nothingTaken(), down);
}
for (const [what, market, status] of [
  ["the city held closed", { market: "greenville", pre_launch: false, opens_on: null, held_closed: true }, 409],
  ["the city not open yet, with no day said", { market: "greenville", pre_launch: true, opens_on: null, held_closed: false }, 409],
  ["the city opening after that Sunday", { market: "greenville", pre_launch: true, opens_on: "2099-01-01", held_closed: false }, 409],
]) {
  fresh({ market });
  const k = key();
  const r = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: k });
  ok(`refused, ${what}: ${status}, 'nothing was charged'`, r.status === status && /Nothing was charged/.test(r.json?.error ?? "") && nothingTaken() && !claim(k), r);
}
{
  fresh({ market: { market: "greenville", pre_launch: true, opens_on: "2000-01-01", held_closed: false } });
  const r = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key() });
  ok("a city whose opening day is behind that Sunday takes the order", r.status === 200 && rows().length === 1, r);
}
{
  fresh();
  w.fail.market_live = { select: { code: "57014", message: "canceling statement due to statement timeout" } };
  const r = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key() });
  ok("the city couldn't be read: 503 'nothing was charged' — no answer is not a yes", r.status === 503 && r.json?.charged === false && nothingTaken(), r);
}
{
  fresh();
  blockedBuckets = [`card:u:${SAM}`];
  const k = key();
  const r = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: k });
  ok("past this person's card tries: 429, charged:false, nothing claimed", r.status === 429 && r.json?.charged === false && nothingTaken() && !claim(k), r);
}
{
  fresh();
  for (const body of ["null", "not json"]) {
    const r = await post(body);
    ok(`a body of ${body}: 400, nothing charged`, r.status === 400 && nothingTaken(), r);
  }
}

// ── the yes to texts ────────────────────────────────────────────────────────────────────────────────────────────────
{
  fresh();
  await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key(), textOptIn: true });
  ok("a ticked yes to texts while texts are off: not kept — texts aren't on, so there is nothing to say yes to", yeses.length === 0 && rows().length === 1, yeses);
  process.env.NEXT_PUBLIC_TEXTS_ON = "1";
  fresh();
  await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key(), textOptIn: true });
  ok("a ticked yes with texts on: kept, for this delivery's number, from the delivery checkout, as this member's",
    yeses.length === 1 && yeses[0].phone === "864-555-0142" && yeses[0].source === "delivery_checkout" && yeses[0].userId === SAM, yeses);
  fresh();
  await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key() });
  ok("no tick, texts on: no yes kept", yeses.length === 0);
  delete process.env.NEXT_PUBLIC_TEXTS_ON;
}

// ── the card's answers, and after the money ─────────────────────────────────────────────────────────────────────────
{
  fresh();
  sq.script.push("decline");
  const r = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key() });
  ok("a decline: the card's one sentence, nothing written", r.status >= 400 && r.status < 500 && /declined/i.test(r.json?.error ?? "") && rows().length === 0 && sq.payments.length === 0, r);
}
{
  fresh();
  const k = key(), t = card();
  sq.script.push("lose");
  const r = await post({ ...DOZEN(), sourceId: t, idempotencyKey: k });
  ok("Square's answer lost: 409 pending, 'don't pay again'; the crew told (critical, money)", r.status === 409 && r.json?.pending === true
    && alerts.some((a) => a.severity === "critical" && a.category === "money" && /status unknown/i.test(a.title)) && rows().length === 0, { r, alerts });
  const again = await post({ ...DOZEN(), sourceId: t, idempotencyKey: k });
  ok("…the same key again isn't sent to Square again", sq.calls.length === 1 && again.status === 409, { again, calls: sq.calls.length });
}
{
  fresh();
  w.fail.delivery_orders = { insert: { error: { code: "XX000", message: "the disk said no" }, sticky: true } };
  const r = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key() });
  ok("the row didn't save (twice): 'payment received — ref …, we've alerted the crew', never a failed checkout", r.status === 200 && r.json?.recorded === false && typeof r.json.ref === "string" && r.json.ref.length === 6, r);
  ok("…the crew told (critical, money) with the payment and the address to add it by hand", alerts.some((a) => a.severity === "critical" && a.category === "money"
    && /didn't record/.test(a.title) && a.body.includes(sq.payments[0].id) && a.body.includes("1 Made-up Way")), alerts);
}
{
  fresh();
  w.tables.delivery_orders.push({ id: "d0000000-0000-4000-8000-000000000001", payment_id: "pay_TEST000001" });
  const r = await post({ ...DOZEN(), sourceId: card(), idempotencyKey: key() });
  ok("a row already carrying this payment: answered as recorded, no second row (the order-row backstop)", r.status === 200 && r.json?.recorded === true && rows().length === 1 && alerts.length === 0, { r, rows: rows().length });
}

console.log(`\nSUNDAY DELIVERY'S CHECKOUT, RUN (app/api/delivery/checkout): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
