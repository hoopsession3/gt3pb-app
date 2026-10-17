// A LIMITED RESERVE, PAID TO HOLD, RUN (R16, 2026-10-17 — the 10/10 audit, operations F13) — and since R18 its other two
// doors, /api/reserves/cancel (the money back, the bottles back) and /api/reserves/settle (a payment whose answer was lost,
// settled by an owner with Square asked first), run the same way against the same database and a Square that also
// answers refunds, a payment by its id and a window's payments.
//
// /api/reserves/pay compiled from its own TypeScript and called with a Request, as Next calls it. Real: the route,
// lib/reservePay (the decisions, in the pack checkout's order), lib/reserveSteps (the database steps — 0400's functions
// called by name with the arguments 0400 declares), lib/reservePickup and lib/packClose (when a pickup closes),
// lib/refusal (the database's own sentence and its status), lib/chargeOnce, lib/checkoutClaims, lib/squareServer
// .chargeCard, lib/cardGuard, lib/apiAuth. Stood in for: the database (scripts/fixtures/moneyWorld) with 0400's
// hold_reserve, settle_reserve and release_reserve written out below as the migration says them; Square (fakeSquare);
// the customer's email and the alert writer (recorders). Every name and card is made up.
//
// What it holds the route to: bottles come off the shelf only as a hold under this checkout's key, the card is charged
// once for what the hold priced and never above the button, a refusal of any kind puts the bottles back and the key with
// them, a payment that could not be marked is said to the crew, and a key paid under is answered as paid.
import { routeLoader, moneyWorld, NextResponseShim } from "./fixtures/moneyWorld.mjs";
import { fakeSquare } from "./fixtures/chargeonce.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };

process.env.SQUARE_ACCESS_TOKEN = "made-up-square-access-token";
process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID = "L-MADE-UP-LOCATION";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.example.test";       // the caller's own client (lib/apiAuth callerClient) —
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "made-up-public-key";         // made up; the client is stood in for below
const SAM = "0c416000-0000-4000-8000-0000000000a1", SAM_TOKEN = "made-up-session-token-sam";
const BEA = "0c416000-0000-4000-8000-0000000000a2", BEA_TOKEN = "made-up-session-token-bea";   // another member
const ANA = "0c416000-0000-4000-8000-0000000000a3", ANA_TOKEN = "made-up-session-token-ana";   // an admin: is_admin() says so
const ADMIN_TOKENS = new Set([ANA_TOKEN]);
const RES = "a5000000-0000-4000-8000-000000000001", STOP = "5d000000-0000-4000-8000-0000000000c1";
const H = 3600_000;
const raise = (code, message) => ({ error: { code, message } });

let w, sq, alerts, told, blocked, bump, refunds, refundCalls, refundScript, seq = 0;
const uuid = () => `c1000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
function fresh({ reserve = {}, stop = {}, customers = [] } = {}) {
  w = moneyWorld({
    tables: {
      reserves: [{ id: RES, tenant_id: "00000000-0000-0000-0000-000000000001", name: "Made-up Barrel Reserve", price_cents: 3500, status: "live", stock_remaining: 5, stock_total: 5,
        stop_id: STOP, per_member_limit: 2, member_only: false, ...reserve }],
      stops: [{ id: STOP, name: "Made-up Market", starts_at: new Date(Date.now() + 72 * H).toISOString(), ends_at: new Date(Date.now() + 76 * H).toISOString(), canceled_at: null, ...stop }],
      reserve_claims: [], checkout_claims: [], customers,
    },
    unique: { reserve_claims: ["id", "idempotency_key"], checkout_claims: ["idempotency_key"] },
    embed: {
      // a claim with its reserve and the reserve's pickup — `reserve:reserves(name, stop:stops(…))` and
      // `reserve:reserves(price_cents)` as PostgREST answers them (lib/reserveSteps.claim, app/api/reserves/settle).
      reserve_claims: ({ ops, rows }) => rows.filter((r) => ops.every((o) => o[0] !== "eq" || String(r[o[1]]) === String(o[2]))).map((r) => {
        const v = w.tables.reserves.find((x) => x.id === r.reserve_id);
        const s = v && w.tables.stops.find((x) => x.id === v.stop_id);
        return { ...r, reserve: v ? { name: v.name, price_cents: v.price_cents, stop: s ? { name: s.name, starts_at: s.starts_at, ends_at: s.ends_at, canceled_at: s.canceled_at } : null } : null };
      }),
      // reserves with its pickup — `stop:stops(name, starts_at, ends_at, canceled_at)` as PostgREST answers it.
      reserves: ({ ops, rows }) => {
        const id = ops.find((o) => o[0] === "eq" && o[1] === "id")?.[2];
        return rows.filter((r) => r.id === id).map((r) => {
          const s = w.tables.stops.find((x) => x.id === r.stop_id);
          return { ...r, stop: s ? { name: s.name, starts_at: s.starts_at, ends_at: s.ends_at, canceled_at: s.canceled_at } : null };
        });
      },
    },
    rpc: {
      rate_limit_hit: ({ p_bucket }) => !blocked.includes(p_bucket),
      // 0400's one rule for when a pickup closes: a day before the stop; never, once the stop was called off.
      reserve_closes_at: ({ p_reserve }, world) => {
        const r = world.tables.reserves.find((x) => x.id === p_reserve);
        const s = r && world.tables.stops.find((x) => x.id === r.stop_id);
        return !s || s.canceled_at ? null : new Date(Date.parse(s.starts_at) - 24 * H).toISOString();
      },
      // 0400's three, as the migration says them (supabase/migrations/0400_a_limited_reserve_is_paid_to_hold.sql).
      hold_reserve: ({ p_user, p_reserve, p_qty, p_key }, world) => {
        if (!p_user || !p_key || p_key.length < 8) return raise("22023", "A hold needs a member and a checkout key.");
        if (!Number.isInteger(p_qty) || p_qty < 1 || p_qty > 12) return raise("22023", "Pick how many — between 1 and 12.");
        const claims = world.tables.reserve_claims;
        const c = claims.find((x) => x.idempotency_key === p_key);
        if (c) {
          if (["pending", "paid", "collected"].includes(c.state)) {
            if (c.user_id !== p_user) return raise("42501", "That checkout is someone else's.");
            const r0 = world.tables.reserves.find((x) => x.id === c.reserve_id);
            return { id: c.id, state: c.state, qty: c.qty, again: true, amount_cents: c.paid_cents ?? c.qty * r0.price_cents };
          }
          c.idempotency_key = `${p_key}~${c.id.slice(0, 8)}`;
        }
        const r = world.tables.reserves.find((x) => x.id === p_reserve);
        if (!r || !["live", "sold_out"].includes(r.status) || !r.stop_id) return raise("PT404", "That reserve isn't on offer right now.");
        const s = world.tables.stops.find((x) => x.id === r.stop_id);
        if (s.canceled_at) return raise("PT409", "Its pickup was called off — check back for the new one.");
        if (Date.now() >= Date.parse(s.starts_at) - 24 * H) return raise("PT409", "Reserves for that pickup have closed.");
        if (r.member_only && (world.tables.customers.find((x) => x.user_id === p_user)?.tier ?? "guest") === "guest") return raise("42501", "This reserve is for members.");
        const have = claims.filter((x) => x.reserve_id === r.id && x.user_id === p_user && ["held", "pending", "paid", "collected"].includes(x.state)).reduce((a, x) => a + x.qty, 0);
        if (have + p_qty > r.per_member_limit) return raise("PT409", "That is more than one member may reserve.");
        if (r.stock_remaining < p_qty) return r.stock_remaining > 0 ? raise("PT409", `Only ${r.stock_remaining} left.`) : raise("PT409", "Sold out.");
        if (bump) { r.price_cents += bump; bump = 0; }   // the price raised while the page sat — read by the hold, not the page
        r.stock_remaining -= p_qty;
        if (r.stock_remaining === 0) r.status = "sold_out";
        const made = { id: uuid(), reserve_id: r.id, user_id: p_user, qty: p_qty, state: "pending", idempotency_key: p_key, payment_id: null, paid_cents: null, refunded_cents: 0,
          created_at: new Date().toISOString() };
        claims.push(made);
        return { id: made.id, state: "pending", qty: p_qty, again: false, amount_cents: p_qty * r.price_cents };
      },
      settle_reserve: ({ p_claim, p_payment_id, p_paid_cents }, world) => {
        const c = world.tables.reserve_claims.find((x) => x.id === p_claim);
        if (!c) return raise("PT404", "That claim is gone.");
        if (["paid", "collected"].includes(c.state) && c.payment_id === p_payment_id) return { id: c.id, state: c.state, again: true };
        if (c.state !== "pending") return raise("PT409", `That claim is ${c.state}, not waiting on its payment.`);
        Object.assign(c, { state: "paid", payment_id: p_payment_id, paid_cents: Math.max(p_paid_cents ?? 0, 0) });
        return { id: c.id, state: "paid", again: false };
      },
      release_reserve: ({ p_claim, p_reason, p_refunded_cents }, world) => {
        const c = world.tables.reserve_claims.find((x) => x.id === p_claim);
        if (!c) return raise("PT404", "That claim is gone.");
        if (["cancelled", "expired"].includes(c.state)) return { id: c.id, state: c.state, again: true };
        if (!["held", "pending", "paid"].includes(c.state)) return raise("PT409", "That claim was handed over — its bottles are not ours to put back.");
        Object.assign(c, { state: "cancelled", cancel_reason: p_reason, refunded_cents: Math.min(c.paid_cents ?? 0, Math.max(p_refunded_cents ?? 0, 0)) });
        const r = world.tables.reserves.find((x) => x.id === c.reserve_id);
        r.stock_remaining = Math.min(r.stock_total, r.stock_remaining + c.qty);
        if (r.status === "sold_out") r.status = "live";
        return { id: c.id, state: "cancelled", again: false };
      },
    },
    sessions: { [SAM_TOKEN]: { id: SAM, email: "sam@example.test" }, [BEA_TOKEN]: { id: BEA, email: "bea@example.test" }, [ANA_TOKEN]: { id: ANA, email: "ana@example.test" } },
  });
  sq = fakeSquare();
  globalThis.fetch = squareDesk;
  alerts = []; told = []; blocked = []; bump = 0; refunds = []; refundCalls = []; refundScript = [];
}

// Square, past the charge (lib/squareServer): a refund (POST /v2/refunds — the same key twice is one refund), a payment by
// its id with what was refunded of it (GET /v2/payments/{id}), and a location's payments (GET /v2/payments?…). A charge is
// fakeSquare's. `refundScript`: "refuse" (a 400), "503" (an answer that doesn't say), "drop" (no answer).
async function squareDesk(url, init = {}) {
  const u = new URL(String(url));
  const method = (init.method ?? "GET").toUpperCase();
  const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (u.pathname === "/v2/payments" && method === "POST") return sq.fetch(url, init);
  const refundedOf = (id) => refunds.filter((r) => r.payment_id === id).reduce((a, r) => a + r.amount, 0);
  const shape = (p) => ({ id: p.id, status: p.status, amount_money: p.amount_money, reference_id: p.reference_id, refunded_money: { amount: refundedOf(p.id), currency: "USD" } });
  if (u.pathname.startsWith("/v2/payments/") && method === "GET") {
    const p = sq.payments.find((x) => x.id === decodeURIComponent(u.pathname.slice("/v2/payments/".length)));
    return p ? answer(200, { payment: shape(p) }) : answer(404, { errors: [{ category: "INVALID_REQUEST_ERROR", code: "NOT_FOUND", detail: "Could not find payment." }] });
  }
  if (u.pathname === "/v2/payments" && method === "GET") return answer(200, sq.payments.length ? { payments: sq.payments.map(shape) } : {});
  if (u.pathname === "/v2/refunds" && method === "POST") {
    const req = JSON.parse(init.body);
    refundCalls.push(req);
    const step = refundScript.length ? refundScript.shift() : "ok";
    if (step === "drop") throw new TypeError("fetch failed");
    if (step === "503") return answer(503, { errors: [{ category: "API_ERROR", code: "SERVICE_UNAVAILABLE", detail: "Square is unavailable." }] });
    if (step === "refuse") return answer(400, { errors: [{ category: "INVALID_REQUEST_ERROR", code: "REFUND_AMOUNT_INVALID", detail: "The refund amount is more than the payment's" }] });
    const seen = refunds.find((r) => r.key === req.idempotency_key);
    if (seen) return answer(200, { refund: { id: seen.id, status: "PENDING" } });
    const made = { id: `ref_TEST${String(refunds.length + 1).padStart(6, "0")}`, key: req.idempotency_key, payment_id: req.payment_id, amount: req.amount_money.amount };
    refunds.push(made);
    return answer(200, { refund: { id: made.id, status: "PENDING", amount_money: req.amount_money } });
  }
  throw new Error(`square desk: unexpected ${method} ${u.pathname}`);
}
const shims = {
  "next/server": { NextResponse: NextResponseShim },
  "@/lib/supabaseAdmin": { get supabaseAdmin() { return w; } },
  // The caller's own client (lib/apiAuth callerClient): is_admin() answered for the token it carries, as 0035's is_admin
  // decides for the signed-in caller; everything else is the database's.
  "@supabase/supabase-js": { createClient: (_url, _key, opts) => {
    const token = String(opts?.global?.headers?.Authorization ?? "").replace(/^Bearer /, "");
    return { from: (t) => w.from(t), auth: w.auth, rpc: async (fn, a) => (fn === "is_admin" ? { data: ADMIN_TOKENS.has(token), error: null, status: 200 } : w.rpc(fn, a)) };
  } },
  "@/lib/serverAlerts": { raiseAlert: async (a) => { alerts.push(a); }, raiseAlertOnce: async (a) => { alerts.push(a); return true; } },
  "@/lib/notify": {
    accountEmail: async (id) => (id === SAM ? "sam@example.test" : null),
    whoAsked: async () => "Sam, sam@example.test",
    notifyCustomer: async (m) => { told.push(m); return { sms: "no-address", email: "sent" }; },
  },
};
fresh();
const route = routeLoader(shims)("app/api/reserves/pay/route.ts");

let n = 0;
const key = () => `made-up-reserve-key-${String(++n).padStart(4, "0")}-${Math.random().toString(36).slice(2, 10)}`;
const card = () => `cnon:made-up-${Math.random().toString(36).slice(2, 12)}`;
async function post(body, { token = SAM_TOKEN, ip = "203.0.113.17" } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": ip };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await route.POST(new Request("https://app.example.test/api/reserves/pay", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const reserve = () => w.tables.reserves[0];
const claims = () => w.tables.reserve_claims;
const keyClaim = (k) => w.tables.checkout_claims.find((c) => c.idempotency_key === k);
const TWO = (extra = {}) => ({ reserveId: RES, qty: 2, expectedCents: 7000, sourceId: card(), idempotencyKey: key(), ...extra });

// ── two bottles by card: held, charged once, marked paid, said ─────────────────────────────────────────────────────
{
  fresh();
  const body = TWO();
  const r = await post(body);
  ok("reserve: two bottles — 200, paid, recorded, $70.00, the claim's id and Square's ref", r.status === 200 && r.json?.ok && r.json.paid === true && r.json.recorded === true
    && r.json.qty === 2 && r.json.totalCents === 7000 && r.json.id === claims()[0]?.id && typeof r.json.ref === "string", r);
  ok("reserve: Square asked once, for $70.00, under the checkout's key, the receipt to the account", sq.calls.length === 1 && sq.calls[0].amount_money.amount === 7000
    && sq.calls[0].idempotency_key === body.idempotencyKey && sq.calls[0].buyer_email_address === "sam@example.test", sq.calls);
  ok("reserve: one claim, the member's, paid with Square's payment — and two bottles off the shelf (5 → 3)", claims().length === 1 && claims()[0].state === "paid"
    && claims()[0].user_id === SAM && claims()[0].payment_id === sq.payments[0].id && claims()[0].paid_cents === 7000 && reserve().stock_remaining === 3, { claims: claims(), stock: reserve().stock_remaining });
  ok("reserve: the member told it's theirs and until when it can be canceled; the crew told it sold", told.length === 1 && /is yours — \$70 paid ✓/.test(told[0].message) && /Cancel for a full refund until/.test(told[0].message)
    && alerts.some((a) => a.kind === "reservation_new" && a.title === "Limited Reserve sold" && a.subjectId === claims()[0].id), { told, alerts });
  const again = await post({ ...body });
  ok("reserve: the same key again is answered as paid — no second charge, hold or message, the shelf unmoved", again.status === 200 && again.json?.paid === true
    && sq.calls.length === 1 && claims().length === 1 && reserve().stock_remaining === 3 && told.length === 1, { again, calls: sq.calls.length });
}

// ── refusals the database makes: the bottles and the key go back ─────────────────────────────────────────────────
for (const [what, setup, ask, status, words] of [
  ["more than one member may reserve (the limit is two)", {}, { qty: 3, expectedCents: 10500 }, 409, /more than one member may reserve/],
  ["only one left, two asked", { reserve: { stock_remaining: 1 } }, {}, 409, /Only 1 left/],
  ["a members-only reserve, and this member's tier is guest", { reserve: { member_only: true }, customers: [{ user_id: SAM, tier: "guest" }] }, {}, 400, /This reserve is for members/],
]) {
  fresh(setup);
  const before = reserve().stock_remaining;
  const body = TWO(ask);
  const r = await post(body);
  ok(`refused by the hold, ${what}: ${status}, the database's own sentence — nothing charged, no bottles held, the key given back`,
    r.status === status && words.test(r.json?.error ?? "") && sq.calls.length === 0 && claims().every((c) => c.state !== "pending") && reserve().stock_remaining === before && !keyClaim(body.idempotencyKey),
    { r, stock: reserve().stock_remaining, claim: keyClaim(body.idempotencyKey) });
}
{
  fresh({ reserve: { member_only: true }, customers: [{ user_id: SAM, tier: "founding" }] });
  const r = await post(TWO());
  ok("a members-only reserve for a member with a tier: taken", r.status === 200 && r.json?.paid === true, r);
}

// ── refusals before the hold ───────────────────────────────────────────────────────────────────────────────────────
for (const [what, setup, ask, status, words] of [
  ["sold out", { reserve: { status: "sold_out", stock_remaining: 0 } }, {}, 409, /Sold out/],
  ["a reserve not on offer (a draft)", { reserve: { status: "draft" } }, {}, 404, /isn't on offer/],
  ["no pickup set yet", { reserve: { stop_id: null } }, {}, 409, /opens once its pickup is set/],
  ["its pickup called off", { stop: { canceled_at: new Date().toISOString() } }, {}, 409, /called off/],
  ["its pickup ten hours off (closed a day before)", { stop: { starts_at: new Date(Date.now() + 10 * H).toISOString(), ends_at: new Date(Date.now() + 14 * H).toISOString() } }, {}, 409, /have closed/],
  ["the price raised while the page sat (the button said $60)", {}, { expectedCents: 6000 }, 409, /The total is \$70/],
  ["no card for bottles that cost money", {}, { sourceId: undefined }, 400, /Add a card/],
  ["none asked for", {}, { qty: 0 }, 400, /between 1 and 12/],
  ["thirteen asked for", {}, { qty: 13 }, 400, /between 1 and 12/],
  ["a count that isn't a number", {}, { qty: "two" }, 400, /between 1 and 12/],
]) {
  fresh(setup);
  const body = TWO(ask);
  const r = await post(body);
  ok(`refused, ${what}: ${status} — nothing charged, held or claimed`, r.status === status && words.test(r.json?.error ?? "") && sq.calls.length === 0 && claims().length === 0 && !keyClaim(body.idempotencyKey), r);
}
{
  fresh();
  const r = await post(TWO({ reserveId: "not-a-reserve" }));
  ok("a reserve id that isn't one: 400, nothing read", r.status === 400 && sq.calls.length === 0, r);
  const none = await post(TWO(), { token: null });
  ok("no sign-in: 401 'reserves are for members'", none.status === 401 && /for members/.test(none.json?.error ?? ""), none);
}
{
  fresh();
  w.fail.reserves = { select: { code: "57014", message: "canceling statement due to statement timeout" } };
  const r = await post(TWO());
  ok("the reserve couldn't be read: 503, nothing charged or held", r.status === 503 && sq.calls.length === 0 && claims().length === 0, r);
}
{
  fresh();
  blocked = [`card:u:${SAM}`];
  const r = await post(TWO());
  ok("past this person's card tries: 429, charged:false — before the reserve is read or a key claimed", r.status === 429 && r.json?.charged === false && sq.calls.length === 0
    && !w.calls.some((c) => c.table === "reserves") && w.tables.checkout_claims.length === 0, r);
}

// ── the price the hold read, not the page's ───────────────────────────────────────────────────────────────────────
{
  fresh();
  bump = 500;   // $35 → $40 a bottle between the page's draw and the hold
  const r = await post(TWO());
  ok("the price raised between the page and the hold: 409 with the new total — nothing charged, the bottles back on the shelf, the key given back",
    r.status === 409 && r.json?.totalCents === 8000 && sq.calls.length === 0 && claims()[0]?.state === "cancelled" && reserve().stock_remaining === 5 && w.tables.checkout_claims.length === 0,
    { r, claims: claims(), stock: reserve().stock_remaining });
}

// ── nothing to pay ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  fresh({ reserve: { price_cents: 0 } });
  const r = await post(TWO({ expectedCents: 0, sourceId: undefined }));
  ok("a reserve that costs nothing: taken with no card — never sent to Square — the claim settled at $0", r.status === 200 && r.json?.totalCents === 0 && sq.calls.length === 0
    && claims()[0]?.state === "paid" && claims()[0]?.paid_cents === 0 && !/paid ✓/.test(told[0]?.message ?? "x"), { r, claims: claims(), told });
}

// ── the card's answers, and after the money ─────────────────────────────────────────────────────────────────────────
{
  fresh();
  sq.script.push("decline");
  const r = await post(TWO());
  ok("a decline: the card's one sentence, and the bottles back on the shelf (the claim let go: card declined)", r.status >= 400 && r.status < 500 && /declined/i.test(r.json?.error ?? "")
    && claims()[0]?.state === "cancelled" && claims()[0]?.cancel_reason === "card declined" && reserve().stock_remaining === 5, { r, claims: claims() });
}
{
  fresh();
  const body = TWO();
  sq.script.push("lose");
  const r = await post(body);
  ok("Square's answer lost: 409 pending, 'don't pay again' — the bottles stay held for the crew to settle, the crew told (critical, money)", r.status === 409 && r.json?.pending === true
    && claims()[0]?.state === "pending" && reserve().stock_remaining === 3 && alerts.some((a) => a.severity === "critical" && /status unknown/.test(a.title) && a.body.includes(body.idempotencyKey)), { r, alerts });
  const again = await post({ ...body });
  ok("…the same key again isn't sent to Square again, and holds no more bottles", sq.calls.length === 1 && claims().length === 1 && reserve().stock_remaining === 3 && again.status === 409, again);
}
{
  fresh();
  w.fail["rpc:settle_reserve"] = { call: { code: "XX000", message: "the disk said no" }, sticky: true };
  const r = await post(TWO());
  ok("charged and the claim couldn't be marked paid: 200, paid, not recorded — 'it's yours, show this at pickup' — never a failed checkout",
    r.status === 200 && r.json?.paid === true && r.json.recorded === false && /it's yours/.test(r.json.warn ?? ""), r);
  ok("…the crew told (critical, money) with the payment to mark it paid", alerts.some((a) => a.severity === "critical" && a.category === "money" && /didn't record/.test(a.title) && a.body.includes(sq.payments[0].id)), alerts);
}

// ── a body that isn't an object is the caller's mistake: a 400, not a 500 and a "route threw" alert (R18, API F14) ──────
{
  fresh();
  const before = { alerts: alerts.length, claims: claims().length, charges: w.charges?.length ?? 0 };
  const shapes = await Promise.all(["null", "42", "\"a string\"", "[1, 2]"].map((b) => post(b)));
  ok("pay: a literal null, a number, a string or a list as the body → 400 each, nothing held, charged or alerted",
    shapes.every((r) => r.status === 400) && claims().length === before.claims && alerts.length === before.alerts, shapes.map((r) => r.status));
}

// ═══ /api/reserves/cancel — the money back to the card, then the bottles back on the shelf (R18, operations F13) ═══════
const cancelRoute = routeLoader(shims)("app/api/reserves/cancel/route.ts");
const settleRoute = routeLoader(shims)("app/api/reserves/settle/route.ts");
async function ask(r, path, body, { token = SAM_TOKEN } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": "203.0.113.17" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await r.POST(new Request(`https://app.example.test/api/${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const cancel = (body, o) => ask(cancelRoute, "reserves/cancel", body, o);
const settle = (body, o) => ask(settleRoute, "reserves/settle", body, { token: ANA_TOKEN, ...o });
const keyOf = (id) => `rsvx-${id.replace(/-/g, "")}-0`;
// Two bottles bought and paid for (the pay door, run): the claim to cancel.
async function paidClaim(setup) { fresh(setup); const r = await post(TWO()); if (r.status !== 200) throw new Error(`paidClaim: ${JSON.stringify(r)}`); return claims()[0]; }

{
  const c = await paidClaim();
  const r = await cancel({ id: c.id });
  ok("cancel: the member's own, before its pickup closes — 200, $70.00 back, the key the claim's own", r.status === 200 && r.json?.ok === true && r.json.refundedCents === 7000
    && refundCalls.length === 1 && refundCalls[0].payment_id === sq.payments[0].id && refundCalls[0].amount_money.amount === 7000 && refundCalls[0].idempotency_key === keyOf(c.id), { r, refundCalls });
  ok("cancel: …then the bottles back on the shelf (3 → 5), the claim let go with what went back", c.state === "cancelled" && c.cancel_reason === "canceled by the member" && c.refunded_cents === 7000
    && reserve().stock_remaining === 5, { c, stock: reserve().stock_remaining });
  ok("cancel: the member told the money is on its way, the crew told (fyi) it was canceled", /reserve is canceled — \$70(\.00)? is on its way back to your card/.test(told.at(-1)?.message ?? "")
    && alerts.some((a) => a.severity === "fyi" && a.title === "A member canceled their reserve" && a.subjectId === c.id), { told: told.at(-1), alerts: alerts.map((a) => a.title) });
  const again = await cancel({ id: c.id });
  ok("cancel: sent twice — the second is 'already', and Square is not asked again", again.status === 200 && again.json?.already === true && refundCalls.length === 1, again);
}
{
  const c = await paidClaim();
  const other = await cancel({ id: c.id }, { token: BEA_TOKEN });
  ok("cancel: another member's claim — 404, nothing refunded, nothing let go", other.status === 404 && other.json?.gone === true && refundCalls.length === 0 && c.state === "paid", other);
  const none = await cancel({ id: c.id }, { token: null });
  ok("cancel: no sign-in — 401", none.status === 401 && refundCalls.length === 0, none);
  const asCrew = await cancel({ id: c.id, crew: true });
  ok("cancel: the crew's cancel by someone who isn't an owner or an admin — 403, nothing refunded", asCrew.status === 403 && refundCalls.length === 0 && c.state === "paid", asCrew);
  const byAdmin = await cancel({ id: c.id, crew: true }, { token: ANA_TOKEN });
  ok("cancel: an admin's, for the crew — refunded and canceled, said so to the crew", byAdmin.status === 200 && byAdmin.json?.refundedCents === 7000 && c.state === "cancelled"
    && c.cancel_reason === "canceled by the crew" && alerts.some((a) => a.title === "Reserve refunded and canceled"), { byAdmin, c });
  const shapes = await Promise.all(["null", "[1]", "{}", JSON.stringify({ id: "not-a-claim" })].map((b) => cancel(b)));
  ok("cancel: a body that isn't one — null, a list, no id, an id that isn't a uuid — 400 each", shapes.every((x) => x.status === 400), shapes.map((x) => x.status));
}
{
  const c = await paidClaim();
  w.tables.stops[0].starts_at = new Date(Date.now() + 10 * H).toISOString();   // the pickup is ten hours off: it closed two hours ago
  const late = await cancel({ id: c.id });
  ok("cancel: the member's, after its pickup closed — 409 'ask the crew', nothing refunded", late.status === 409 && /Its pickup closed/.test(late.json?.error ?? "") && refundCalls.length === 0 && c.state === "paid", late);
  const crew = await cancel({ id: c.id, crew: true }, { token: ANA_TOKEN });
  ok("cancel: …the crew's still goes through", crew.status === 200 && c.state === "cancelled" && refunds.length === 1, crew);
}
{
  const c = await paidClaim();
  refundScript.push("refuse");
  const r = await cancel({ id: c.id });
  ok("cancel: Square refuses the refund — 400 in its words, 'nothing was canceled': the claim stands, the bottles stay its", r.status === 400 && /The refund didn't go through — The refund amount is more than the payment's/.test(r.json?.error ?? "")
    && c.state === "paid" && reserve().stock_remaining === 3, { r, c });
}
for (const step of ["503", "drop"]) {
  const c = await paidClaim();
  refundScript.push(step);
  const r = await cancel({ id: c.id });
  ok(`cancel: Square's answer doesn't say (${step}) — 409 pending, the claim stands, the crew told (critical, money) with the payment`, r.status === 409 && r.json?.pending === true && c.state === "paid"
    && reserve().stock_remaining === 3 && alerts.some((a) => a.severity === "critical" && a.category === "money" && /refund status unknown/.test(a.title) && a.body.includes(sq.payments[0].id)), { r, alerts: alerts.map((a) => a.title) });
}
{
  const c = await paidClaim();
  delete process.env.SQUARE_ACCESS_TOKEN;
  const r = await cancel({ id: c.id });
  process.env.SQUARE_ACCESS_TOKEN = "made-up-square-access-token";
  ok("cancel: card refunds not switched on — 503, nothing let go", r.status === 503 && c.state === "paid" && refundCalls.length === 0, r);
}

// ═══ /api/reserves/settle — a payment whose answer was lost, settled with Square asked first (R18, operations F13) ═══
// A checkout whose answer from Square was lost: the claim pending, its bottles held; the checkout claim as it was left.
async function lostAnswer(step = "lose", { aged = true } = {}) {
  fresh();
  const body = TWO();
  sq.script.push(step);
  const r = await post(body);
  if (r.status !== 409 && r.status !== 502) throw new Error(`lostAnswer: ${JSON.stringify(r)}`);
  const c = claims()[0];
  if (aged) {   // three minutes on: its request is long over (lib/chargeOnce IN_FLIGHT_MS is two)
    const then = new Date(Date.now() - 3 * 60_000).toISOString();
    c.created_at = then;
    const k = keyClaim(body.idempotencyKey);
    if (k) { k.updated_at = then; k.created_at = then; }
  }
  return { c, key: body.idempotencyKey };
}
{
  const { c, key } = await lostAnswer();
  ok("settle: the setup — a payment Square made, its answer lost, the claim pending", c.state === "pending" && sq.payments.length === 1 && sq.payments[0].reference_id === key, { c, payments: sq.payments });
  const sam = await settle({ id: c.id, outcome: "paid" }, { token: SAM_TOKEN });
  const nobody = await settle({ id: c.id, outcome: "paid" }, { token: null });
  ok("settle: by someone who isn't an owner or an admin, or nobody — 403, nothing moved", sam.status === 403 && nobody.status === 403 && c.state === "pending", [sam.status, nobody.status]);
  const r = await settle({ id: c.id, outcome: "paid" });
  ok("settle: Paid, by an admin — Square's payment under the checkout's key found and taken: 200 paid, $70.00", r.status === 200 && r.json?.ok === true && r.json.state === "paid" && r.json.paidCents === 7000, r);
  ok("settle: …the claim paid with that payment, the bottles still its", c.state === "paid" && c.payment_id === sq.payments[0].id && c.paid_cents === 7000 && reserve().stock_remaining === 3, c);
  const k = keyClaim(key);
  ok("settle: …and the checkout's key says so — a retry from the member's page hears 'yours'", k?.state === "done" && k.payment_id === sq.payments[0].id, k);
  const again = await settle({ id: c.id, outcome: "paid" });
  ok("settle: Paid again — 'already', nothing asked twice", again.status === 200 && again.json?.already === true, again);
  const not = await settle({ id: c.id, outcome: "not_charged" });
  ok("settle: Not charged on a paid claim — 409, nothing let go", not.status === 409 && c.state === "paid", not);
}
{
  const { c } = await lostAnswer();
  const r = await settle({ id: c.id, outcome: "not_charged" });
  ok("settle: Not charged while Square holds the money — 409 'it was charged', the bottles stay held", r.status === 409 && r.json?.found === true && /it was charged/.test(r.json?.error ?? "") && c.state === "pending" && reserve().stock_remaining === 3, r);
}
{
  const { c, key } = await lostAnswer("drop");
  ok("settle: the setup — no answer, and Square made nothing", c.state === "pending" && sq.payments.length === 0, { c, payments: sq.payments });
  const paid = await settle({ id: c.id, outcome: "paid" });
  ok("settle: Paid with nothing in Square — 400 'mark it Not charged, or paste the ID'", paid.status === 400 && paid.json?.needsId === true && c.state === "pending", paid);
  const r = await settle({ id: c.id, outcome: "not_charged" });
  ok("settle: Not charged — the bottles back on the shelf (3 → 5), the claim let go as not charged", r.status === 200 && r.json?.state === "cancelled" && c.state === "cancelled" && c.cancel_reason === "not charged"
    && reserve().stock_remaining === 5, { r, c });
  ok("settle: …and the checkout's key says 'nothing was charged — tap Pay to try again'", keyClaim(key)?.state === "done", keyClaim(key));
}
{
  const { c } = await lostAnswer("lose", { aged: false });
  const r = await settle({ id: c.id, outcome: "paid" });
  ok("settle: while its checkout may still be going — 409 inFlight, nothing asked of Square", r.status === 409 && r.json?.inFlight === true && c.state === "pending", r);
}
{
  const { c } = await lostAnswer("drop");
  const typo = await settle({ id: c.id, outcome: "paid", paymentId: "pay id with spaces" });
  ok("settle: a pasted payment id that isn't the shape of one — 400 'copy it again'", typo.status === 400 && /doesn't look like a Square payment ID/.test(typo.json?.error ?? ""), typo);
  const unknown = await settle({ id: c.id, outcome: "paid", paymentId: "pay_NOTINSQUARE01" });
  ok("settle: a pasted payment id Square doesn't have — 400 'Square has no payment with that ID'", unknown.status === 400 && /Square has no payment with that ID/.test(unknown.json?.error ?? "") && c.state === "pending", unknown);
  const shapes = await Promise.all(["null", "[1]", JSON.stringify({ id: c.id }), JSON.stringify({ id: c.id, outcome: "refund" }), JSON.stringify({ id: "x", outcome: "paid" })].map((b) => settle(b)));
  ok("settle: a body that isn't one — null, a list, no outcome, an outcome it doesn't know, an id that isn't one — 400 each", shapes.every((x) => x.status === 400), shapes.map((x) => x.status));
  const gone = await settle({ id: "a5000000-0000-4000-8000-0000000000ff", outcome: "paid" });
  ok("settle: a claim that isn't here — 404 gone", gone.status === 404 && gone.json?.gone === true, gone);
  w.fail.reserve_claims = { select: { code: "57014", message: "canceling statement due to statement timeout" } };
  const down = await settle({ id: c.id, outcome: "not_charged" });
  ok("settle: the claim couldn't be read — 503 'try again', never 'isn't here', nothing let go", down.status === 503 && c.state === "pending", down);
}

console.log(`\nA LIMITED RESERVE — PAID TO HOLD, CANCELED, SETTLED BY HAND — RUN (app/api/reserves/pay, cancel, settle): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
