// THE PACK CHECKOUT, RUN (R16, 2026-10-17 — the 10/10 audit, operations F13).
//
// /api/reserve — a pack reserved for a pickup day, by card or to pay at pickup — compiled from its own TypeScript and
// called with a Request, as Next calls it. Real: the route, lib/packOrder (the pick, the day, the price), lib/benefits
// (a member's perks and a code, read from their tables), lib/packRoad (the cities taking packs), lib/packClose (when a
// drop closes), lib/chargeOnce, lib/checkoutClaims, lib/squareServer.chargeCard, lib/cardGuard, lib/apiAuth,
// lib/shownTotal. Stood in for: the database (scripts/fixtures/moneyWorld), Square (scripts/fixtures/chargeonce
// fakeSquare), the customer's messages and the alert writer (recorders). Every name, phone and card is made up.
//
// What it holds the route to: a pack is taken only from a member, for a day a stop still takes packs, in a city taking
// orders, at the server's price with the member's own perks — charged once per key, or, at pickup, only while the owner
// offers it and the member has fewer than three waiting; a pack on us is never sent to Square; one row per key.
import { routeLoader, moneyWorld, NextResponseShim } from "./fixtures/moneyWorld.mjs";
import { fakeSquare } from "./fixtures/chargeonce.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };

process.env.SQUARE_ACCESS_TOKEN = "made-up-square-access-token";
process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID = "L-MADE-UP-LOCATION";
delete process.env.NEXT_PUBLIC_TEXTS_ON;

const SAM = "0c416000-0000-4000-8000-0000000000a1", SAM_TOKEN = "made-up-session-token-sam", DOWN_TOKEN = "made-up-session-token-down";
const STOP = "5d000000-0000-4000-8000-0000000000b1", SOON = "5d000000-0000-4000-8000-0000000000b2", ATL = "5d000000-0000-4000-8000-0000000000b3";
const H = 3600_000;

let w, sq, alerts, told, yeses, blocked, seq = 0;
const uuid = () => `d5000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
function fresh({ payAtPickup = true, holds = [], stops = null, customers = [], benefits = [], waiting = 0 } = {}) {
  const now = Date.now();
  const stop = (id, inH, market = "greenville") => ({ id, starts_at: new Date(now + inH * H).toISOString(), market, archived_at: null, canceled_at: null, status: "scheduled" });
  w = moneyWorld({
    tables: {
      stops: stops ?? [stop(STOP, 72)],
      market_live: [{ market: "greenville", pre_launch: false, opens_on: null, held_closed: false }, { market: "atlanta", pre_launch: false, opens_on: null, held_closed: false }]
        .map((m) => ({ ...m, ...(holds.find((h) => h.market === m.market) ?? {}) })),
      live_status: [{ id: 1, pay_at_pickup: payAtPickup }],
      customers, member_benefits: benefits,
      drop_orders: Array.from({ length: waiting }, (_, i) => ({ id: uuid(), user_id: SAM, paid: false, collected_at: null, canceled_at: null, picked_up: false, total_cents: 4200,
        drop_date: "2099-01-0" + (i + 1), idempotency_key: `made-up-earlier-${i}` })),
      checkout_claims: [],
    },
    unique: { drop_orders: ["id", "payment_id", "idempotency_key"], checkout_claims: ["idempotency_key"] },
    defaults: { drop_orders: () => ({ id: uuid(), picked_up: false, collected_at: null, canceled_at: null }) },
    rpc: {
      rate_limit_hit: ({ p_bucket }) => !blocked.includes(p_bucket),
      resolve_customer: () => "c0000000-0000-4000-8000-0000000000c1",
    },
    sessions: { [SAM_TOKEN]: { id: SAM, email: "sam@example.test" }, [DOWN_TOKEN]: "down" },
  });
  sq = fakeSquare();
  globalThis.fetch = (url, init) => sq.fetch(url, init);
  alerts = []; told = []; yeses = []; blocked = [];
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
const route = load("app/api/reserve/route.ts");
const P = load("lib/packOrder.ts");   // the route's own day rule

let n = 0;
const key = () => `made-up-pack-key-${String(++n).padStart(4, "0")}-${Math.random().toString(36).slice(2, 10)}`;
const card = () => `cnon:made-up-${Math.random().toString(36).slice(2, 12)}`;
const dayOf = (id) => P.requestedDay(w.tables.stops.find((s) => s.id === id).starts_at);
// A six to bring bottles back to: $42.00 (lib/bottlePricing PICKUP_PACK_BRING_BACK_DOLLARS, known pair); new glass is
// six at $10, $60.00.
const SIX = (extra = {}) => {
  const stopId = extra.stopId ?? STOP;
  return { name: "Dee Example", phone: "864-555-0142", size: 6, glass: "return", mix: { RISE: 3, FLOW: 3, DUSK: 0 }, stopId,
    dropDate: "dropDate" in extra ? extra.dropDate : dayOf(stopId), expectedCents: 4200, ...extra };
};
async function post(body, { token = SAM_TOKEN, ip = "203.0.113.13" } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": ip };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await route.POST(new Request("https://app.example.test/api/reserve", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const packs = () => w.tables.drop_orders.filter((r) => !String(r.idempotency_key).startsWith("made-up-earlier-"));
const claim = (k) => w.tables.checkout_claims.find((c) => c.idempotency_key === k);
const nothingTaken = () => sq.calls.length === 0 && packs().length === 0;

// ── by card: charged once, one pack, said ──────────────────────────────────────────────────────────────────────────
{
  fresh();
  const k = key(), t = card();
  const r = await post({ ...SIX(), sourceId: t, idempotencyKey: k });
  ok("card: a six to bring bottles back to — 200, paid, recorded, $42.00", r.status === 200 && r.json?.ok && r.json.paid === true && r.json.recorded === true && r.json.totalCents === 4200 && typeof r.json.id === "string", r);
  ok("card: Square asked once for $42.00 under the page's key, the receipt to the account", sq.calls.length === 1 && sq.calls[0].amount_money.amount === 4200 && sq.calls[0].idempotency_key === k
    && sq.calls[0].buyer_email_address === "sam@example.test", sq.calls);
  const p = packs()[0];
  ok("card: one pack — the member's, paid, with Square's payment, the key, the stop and the stop's day, the mix as picked",
    packs().length === 1 && p.user_id === SAM && p.paid === true && p.payment_id === sq.payments[0].id && p.idempotency_key === k && p.stop_id === STOP
      && p.drop_date === dayOf(STOP) && p.total_cents === 4200 && p.mix.RISE === 3 && p.mix.FLOW === 3 && p.mix.DUSK === 0 && p.glass === "return" && p.benefit_code === null, p);
  ok("card: the customer told once — what was paid, and to bring the empties", told.length === 1 && /\$42 paid ✓/.test(told[0].message) && /bring them along/.test(told[0].message) && told[0].phone === "864-555-0142", told);
  ok("card: the crew hears one new reservation (important), about this pack", alerts.length === 1 && alerts[0].kind === "reservation_new" && alerts[0].severity === "important" && alerts[0].subjectId === p.id, alerts);
  const again = await post({ ...SIX(), sourceId: t, idempotencyKey: k });
  ok("card: the same key again is answered from its pack — no second charge, pack or message",
    again.status === 200 && again.json?.id === p.id && again.json.paid === true && sq.calls.length === 1 && packs().length === 1 && told.length === 1, { again, calls: sq.calls.length });
  const otherDay = await post({ ...SIX({ dropDate: "2099-12-31" }), sourceId: t, idempotencyKey: k });
  ok("card: …even when the retry names a day that has since changed — a pack already made is never asked again", otherDay.status === 200 && otherDay.json?.id === p.id && sq.calls.length === 1, otherDay);
}
{
  fresh();
  const r = await post({ ...SIX({ glass: "new", expectedCents: 6000 }), sourceId: card(), idempotencyKey: key() });
  ok("card: new glass is six at $10 — $60.00, and no empties line", r.status === 200 && sq.calls[0]?.amount_money.amount === 6000 && packs()[0]?.glass === "new" && !/bring them along/.test(told[0]?.message ?? ""), { r, told });
}

// ── pay at pickup ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  fresh();
  const k = key();
  const r = await post({ ...SIX(), idempotencyKey: k });
  ok("pickup: no card — 200, reserved, not paid; nothing sent to Square", r.status === 200 && r.json?.paid === false && r.json.recorded === true && sq.calls.length === 0, r);
  ok("pickup: one pack, unpaid, no payment, $42.00 due — and the customer told it is due at pickup", packs().length === 1 && packs()[0].paid === false && packs()[0].payment_id === null
    && packs()[0].total_cents === 4200 && /\$42 at pickup/.test(told[0]?.message ?? ""), { p: packs()[0], told });
  ok("pickup: the crew's line says pay at pickup", /pay at pickup/.test(alerts[0]?.body ?? ""), alerts);
  const again = await post({ ...SIX(), idempotencyKey: k });
  ok("pickup: the same key again — the same pack, no second", again.status === 200 && again.json?.id === packs()[0].id && packs().length === 1 && told.length === 1, again);
}
{
  fresh({ payAtPickup: false });
  const k = key();
  const r = await post({ ...SIX(), idempotencyKey: k });
  ok("pickup switched off by the owner: 409 'pay by card instead' — nothing written, nothing claimed", r.status === 409 && /pay by card instead/.test(r.json?.error ?? "") && nothingTaken() && !claim(k), r);
}
{
  fresh({ waiting: 3 });
  const k = key();
  const r = await post({ ...SIX(), idempotencyKey: k });
  ok("three packs already waiting to be paid at pickup: a fourth is refused (409), charged:false — by card it would go", r.status === 409 && r.json?.charged === false && /3 packs waiting/.test(r.json.error) && nothingTaken() && !claim(k), r);
  const byCard = await post({ ...SIX(), sourceId: card(), idempotencyKey: key() });
  ok("…and the same pack by card goes through", byCard.status === 200 && byCard.json?.paid === true && packs().length === 1, byCard);
}
{
  fresh({ waiting: 2 });
  const r = await post({ ...SIX(), idempotencyKey: key() });
  ok("two waiting: a third to pay at pickup is taken", r.status === 200 && r.json?.paid === false && packs().length === 1, r);
}
{
  fresh();
  blocked = [`reserve-later:u:${SAM}`];
  const k = key();
  const r = await post({ ...SIX(), idempotencyKey: k });
  ok("past the member's pay-later count: 429, charged:false, nothing written", r.status === 429 && r.json?.charged === false && nothingTaken() && !claim(k), r);
}

// ── a member's perks, read from their tables ───────────────────────────────────────────────────────────────────────
{
  const founding = { customers: [{ user_id: SAM, tier: "founding", vip_verified: false }],
    benefits: [{ active: true, scope: "tier", tier: "founding", requires_vip: false, code: null, kind: "free_refill", target: "straight_brew", value_cents: null, percent: null, label: "Founding refills" }] };
  fresh(founding);
  const r = await post({ ...SIX(), sourceId: card(), idempotencyKey: key() });
  ok("on us: a founding member's bring-back six is $0 — never sent to Square (it refuses $0), reserved as nothing charged, not as paid",
    r.status === 200 && r.json?.totalCents === 0 && r.json.paid === false && sq.calls.length === 0 && packs()[0]?.total_cents === 0 && packs()[0]?.paid === false, { r, p: packs()[0] });
  ok("on us: the customer told 'on us ✓'", /on us ✓/.test(told[0]?.message ?? ""), told);
  fresh(founding);
  const nw = await post({ ...SIX({ glass: "new", expectedCents: 6000 }), sourceId: card(), idempotencyKey: key() });
  ok("on us applies to bring-back only: the same member's new glass is charged $60.00", nw.status === 200 && sq.calls[0]?.amount_money.amount === 6000, nw);
  fresh({ ...founding, payAtPickup: false });
  const free = await post({ ...SIX(), idempotencyKey: key() });
  ok("on us with pay at pickup switched off: still taken — nothing is due at the window", free.status === 200 && free.json?.totalCents === 0 && packs().length === 1, free);
}
{
  const code = { benefits: [{ active: true, scope: "code", tier: null, code: "MADEUP10", requires_vip: false, kind: "percent_off", target: null, value_cents: null, percent: 10, label: "Made-up 10%" }] };
  fresh(code);
  const r = await post({ ...SIX({ glass: "new", expectedCents: 6000, code: "madeup10" }), sourceId: card(), idempotencyKey: key() });
  ok("a code, typed in lower case: 10% off — $54.00 charged (less than the button: that goes through), and the code on the pack",
    r.status === 200 && sq.calls[0]?.amount_money.amount === 5400 && packs()[0]?.benefit_code === "MADEUP10" && r.json.totalCents === 5400, { r, p: packs()[0] });
  fresh(code);
  const wild = await post({ ...SIX({ glass: "new", expectedCents: 6000, code: "%" }), sourceId: card(), idempotencyKey: key() });
  ok("a code of '%' matches no code (the wildcard is escaped): full price, no code on the pack", wild.status === 200 && sq.calls[0]?.amount_money.amount === 6000 && packs()[0]?.benefit_code === null, { wild, p: packs()[0] });
  fresh({ benefits: [{ ...code.benefits[0], active: false }] });
  const off = await post({ ...SIX({ glass: "new", expectedCents: 6000, code: "MADEUP10" }), sourceId: card(), idempotencyKey: key() });
  ok("a code switched off: full price", off.status === 200 && sq.calls[0]?.amount_money.amount === 6000, off);
}

// ── refused before anything is charged or written ──────────────────────────────────────────────────────────────────
const refusals = [
  ["no name", { name: " " }, 400, /Add your name and phone/],
  ["no phone", { phone: "" }, 400, /Add your name and phone/],
  ["a pack of five", { size: 5, mix: { RISE: 5 } }, 400, /Pick a pack size/],
  ["picks that don't make the pack", { mix: { RISE: 2, FLOW: 2 } }, 400, /add up to the pack size/],
  ["a day no stop is on", { dropDate: "2099-12-31" }, 409, /pickup day just changed/],
  ["a price raised while the page sat (the button said $40)", { expectedCents: 4000 }, 409, /The total is \$42/],
];
for (const [what, change, status, words] of refusals) {
  for (const how of ["card", "pickup"]) {
    fresh();
    const k = key();
    const r = await post({ ...SIX(change), ...(how === "card" ? { sourceId: card() } : {}), idempotencyKey: k });
    ok(`refused (${how}), ${what}: ${status} — nothing charged, claimed or written`, r.status === status && words.test(r.json?.error ?? "") && nothingTaken() && !claim(k), r);
  }
}
{
  fresh({ stops: [{ id: SOON, starts_at: new Date(Date.now() + 10 * H).toISOString(), market: "greenville", archived_at: null, canceled_at: null, status: "scheduled" }] });
  const k = key();
  const r = await post({ ...SIX({ stopId: SOON, dropDate: dayOf(SOON) }), sourceId: card(), idempotencyKey: k });
  ok("a stop ten hours off: its drop closed a day before it — 400, nothing charged", r.status === 400 && /That drop has closed/.test(r.json?.error ?? "") && nothingTaken() && !claim(k), r);
}
{
  fresh({ holds: [{ market: "atlanta", held_closed: true }], stops: [
    { id: STOP, starts_at: new Date(Date.now() + 72 * H).toISOString(), market: "greenville", archived_at: null, canceled_at: null, status: "scheduled" },
    { id: ATL, starts_at: new Date(Date.now() + 96 * H).toISOString(), market: "atlanta", archived_at: null, canceled_at: null, status: "scheduled" }] });
  const r = await post({ ...SIX({ stopId: ATL, dropDate: dayOf(ATL) }), sourceId: card(), idempotencyKey: key() });
  ok("a stop in a city held closed: 409 'pick another pickup' — nothing charged", r.status === 409 && /isn't taking orders/.test(r.json?.error ?? "") && nothingTaken(), r);
  const gv = await post({ ...SIX(), sourceId: card(), idempotencyKey: key() });
  ok("…while a stop in a city taking orders is taken", gv.status === 200 && gv.json?.paid === true, gv);
}
{
  fresh({ holds: [{ market: "greenville", held_closed: true }] });
  const r = await post({ ...SIX(), sourceId: card(), idempotencyKey: key() });
  ok("the founding city held closed and no stop taking packs: 409 'not taking pack orders' — nothing charged", r.status === 409 && nothingTaken(), r);
}
{
  fresh();
  w.fail.market_live = { select: { code: "57014", message: "canceling statement due to statement timeout" } };
  const r = await post({ ...SIX(), sourceId: card(), idempotencyKey: key() });
  ok("the cities couldn't be read: 503 'nothing was charged', charged:false", r.status === 503 && r.json?.charged === false && /Nothing was charged/.test(r.json.error) && nothingTaken(), r);
}
{
  fresh();
  const guest = await post({ ...SIX(), sourceId: card(), idempotencyKey: key() }, { token: null });
  ok("a guest: 401 'order-ahead is for members' — nothing charged", guest.status === 401 && /for members/.test(guest.json?.error ?? "") && nothingTaken(), guest);
  const down = await post({ ...SIX(), sourceId: card(), idempotencyKey: key() }, { token: DOWN_TOKEN });
  ok("a sign-in that couldn't be checked: 503 'nothing was charged' — not 'sign in'", down.status === 503 && /nothing was charged/.test(down.json?.error ?? "") && nothingTaken(), down);
}
{
  fresh();
  blocked = [`card:u:${SAM}`];
  const k = key();
  const r = await post({ ...SIX(), sourceId: card(), idempotencyKey: k });
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
  await post({ ...SIX({ textOptIn: true }), sourceId: card(), idempotencyKey: key() });
  ok("a ticked yes while texts are off: not kept", yeses.length === 0 && packs().length === 1, yeses);
  process.env.NEXT_PUBLIC_TEXTS_ON = "1";
  fresh();
  await post({ ...SIX({ textOptIn: true }), sourceId: card(), idempotencyKey: key() });
  ok("a ticked yes with texts on: kept for this pack's number, from the pack checkout, as this member's", yeses.length === 1 && yeses[0].phone === "864-555-0142" && yeses[0].source === "pack_checkout" && yeses[0].userId === SAM, yeses);
  delete process.env.NEXT_PUBLIC_TEXTS_ON;
}

// ── the card's answers, and after the money ─────────────────────────────────────────────────────────────────────────
{
  fresh();
  sq.script.push("decline");
  const r = await post({ ...SIX(), sourceId: card(), idempotencyKey: key() });
  ok("a decline: the card's one sentence, no pack", r.status >= 400 && r.status < 500 && /declined/i.test(r.json?.error ?? "") && packs().length === 0 && sq.payments.length === 0, r);
}
{
  fresh();
  const k = key(), t = card();
  sq.script.push("lose");
  const r = await post({ ...SIX(), sourceId: t, idempotencyKey: k });
  ok("Square's answer lost: 409 pending, 'don't pay again'; the crew told (critical, money); no pack on a guess", r.status === 409 && r.json?.pending === true && /Don't pay again/.test(r.json.error)
    && alerts.some((a) => a.severity === "critical" && a.category === "money" && /status unknown/i.test(a.title)) && packs().length === 0, { r, alerts });
  const again = await post({ ...SIX(), sourceId: t, idempotencyKey: k });
  ok("…the same key again isn't sent to Square again", sq.calls.length === 1 && again.status === 409, { again, calls: sq.calls.length });
}
{
  fresh();
  w.fail.drop_orders = { insert: { error: { code: "XX000", message: "the disk said no" }, sticky: true } };
  const r = await post({ ...SIX(), sourceId: card(), idempotencyKey: key() });
  ok("the pack didn't save (twice), card: 'reserved — ref …, we've alerted the crew; show this at pickup'", r.status === 200 && r.json?.paid === true && r.json.recorded === false && r.json.ref?.length === 6, r);
  ok("…the crew told (critical, money) with the payment, the pack and the day", alerts.some((a) => a.severity === "critical" && a.category === "money" && /didn't record/.test(a.title)
    && a.body.includes(sq.payments[0].id) && /6-pack return/.test(a.body)), alerts);
  fresh();
  w.fail.drop_orders = { insert: { error: { code: "XX000", message: "the disk said no" }, sticky: true } };
  const later = await post({ ...SIX(), idempotencyKey: key() });
  ok("the pack didn't save (twice), pay at pickup: the crew told (critical, order) to add it to the drop", later.status === 200 && later.json?.recorded === false
    && alerts.some((a) => a.severity === "critical" && a.category === "order" && /Add it to the drop/.test(a.body)), { later, alerts });
}

console.log(`\nTHE PACK CHECKOUT, RUN (app/api/reserve): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
