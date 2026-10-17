// A RESERVED PACK CHANGED IN PLACE, RUN (R18, 2026-10-17 — the 10/10 audit, operations F13).
//
// /api/reserve/change compiled from its own TypeScript and called with a Request, as Next calls it. Real: the route,
// lib/packChange (the change, step by step), lib/packChangeStore (0388's functions called by name with the arguments
// 0388 declares), lib/packOrder (the pick, the day, the price), lib/benefits, lib/packRoad, lib/pickupDay,
// lib/squareServer (chargeCard, refundPayment), lib/cardGuard, lib/apiAuth. Stood in for: the database
// (scripts/fixtures/moneyWorld), with 0388's pack_change_begin, _moved, _end, _apply, _refunded, _answer, pack_snapshot and
// pack_change_funding written out below as the migration says them; Square (fakeSquare for a charge, a desk below for a
// refund); the customer's messages and the alert writer (recorders). Every name, phone and card is made up.
//
// What it holds the route to: a pack is changed only by its member, only while its drop is open and the crew have not
// started it, at the server's price; only the difference moves — charged once under the page's key, refunded to the
// card that paid — and never one the page wasn't shown; an answer that doesn't say is said to the crew; the same key
// again is answered from the change it began.
import { routeLoader, moneyWorld, NextResponseShim } from "./fixtures/moneyWorld.mjs";
import { fakeSquare } from "./fixtures/chargeonce.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };

process.env.SQUARE_ACCESS_TOKEN = "made-up-square-access-token";
process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID = "L-MADE-UP-LOCATION";
delete process.env.NEXT_PUBLIC_TEXTS_ON;

const SAM = "0c416000-0000-4000-8000-0000000000a1", SAM_TOKEN = "made-up-session-token-sam";
const BEA = "0c416000-0000-4000-8000-0000000000a2", BEA_TOKEN = "made-up-session-token-bea";
const STOP = "5d000000-0000-4000-8000-0000000000b1", LATER = "5d000000-0000-4000-8000-0000000000b2";
const PACK = "d7000000-0000-4000-8000-000000000001";
const H = 3600_000;
const copy = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
// jsonb equality: by value, whatever the keys' order
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}` : JSON.stringify(v));

let w, sq, alerts, told, blocked, refunds, refundCalls, refundScript;

// ── 0388, as the migration says it ────────────────────────────────────────────────────────────────────────────────
const snapshot = (r) => ({ size: r.size, glass: r.glass, mix: r.mix, drop_date: r.drop_date, total_cents: r.total_cents, paid: r.paid, payment_id: r.payment_id });
const ageOf = (c) => Date.now() - Date.parse(c.updated_at);
function funding(world, order) {
  const r = world.tables.drop_orders.find((x) => x.id === order);
  const done = world.tables.drop_order_changes.filter((d) => d.drop_order_id === order && ["moved", "done", "stale"].includes(d.state))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const pays = [];
  if (r?.payment_id) {
    pays.push({ payment_id: r.payment_id, at: -Infinity,
      cents: done.find((d) => d.charge_payment_id === r.payment_id)?.diff_cents ?? (done[0] ? done[0].before.total_cents : r.total_cents) });
  }
  for (const d of done) if (d.charge_payment_id && d.charge_payment_id !== r?.payment_id) pays.push({ payment_id: d.charge_payment_id, cents: d.diff_cents, at: Date.parse(d.created_at) });
  const taken = {};
  for (const d of done) for (const x of d.refunds) taken[x.payment_id] = (taken[x.payment_id] ?? 0) + x.cents;
  return pays.sort((a, b) => b.at - a.at).map((p) => ({ payment_id: p.payment_id, left: Math.max(0, p.cents - (taken[p.payment_id] ?? 0)) }));
}
const PACK_CHANGE = {
  pack_change_begin: ({ p_key, p_order, p_user, p_after, p_new_total, p_pay_now, p_expected_diff }, world) => {
    const ch = world.tables.drop_order_changes;
    const c = ch.find((x) => x.key === p_key);
    if (c) {
      if (c.drop_order_id !== p_order || c.user_id !== p_user) return { refused: "key" };
      return { change: copy(c), again: true, age_ms: ageOf(c) };
    }
    const r = world.tables.drop_orders.find((x) => x.id === p_order);
    if (!r || r.user_id !== p_user) return { refused: "not_found" };
    if (r.canceled_at) return { refused: "canceled" };
    if (r.picked_up || r.stage !== "reserved") return { refused: "in_motion" };
    if (r.collected_at) return { refused: "collected" };
    const h = ch.find((x) => x.drop_order_id === p_order && ["started", "moved"].includes(x.state));
    if (h) return { held: copy(h), age_ms: ageOf(h) };
    const diff = r.paid ? p_new_total - r.total_cents : p_pay_now ? p_new_total : 0;
    if (p_expected_diff !== diff) return { refused: "repriced", diff, was: r.total_cents, paid: r.paid };
    const now = new Date().toISOString();
    const made = { key: p_key, drop_order_id: p_order, user_id: p_user, state: "started", card: diff > 0, before: copy(snapshot(r)), after: copy(p_after), diff_cents: diff,
      charge_payment_id: null, refunds: [], by_hand_cents: 0, status: null, answer: null, outcome: null, created_at: now, updated_at: now };
    ch.push(made);
    return { change: copy(made), funding: funding(world, p_order) };
  },
  pack_change_moved: ({ p_key, p_charge_payment_id, p_refunds, p_by_hand, p_outcome }, world) => {
    const c = world.tables.drop_order_changes.find((x) => x.key === p_key && x.state === "started");
    if (!c) return false;
    Object.assign(c, { state: "moved", charge_payment_id: p_charge_payment_id, refunds: copy(p_refunds) ?? [], by_hand_cents: Math.max(0, p_by_hand ?? 0), outcome: p_outcome, updated_at: new Date().toISOString() });
    return true;
  },
  pack_change_end: ({ p_key, p_state, p_outcome }, world) => {
    if (!["refused", "unknown", "void"].includes(p_state)) return { error: { code: "P0001", message: `pack_change_end: ${p_state} is not an end` } };
    const c = world.tables.drop_order_changes.find((x) => x.key === p_key && x.state === "started");
    if (!c) return false;
    Object.assign(c, { state: p_state, outcome: p_outcome, updated_at: new Date().toISOString() });
    return true;
  },
  pack_change_apply: ({ p_key, p_name, p_phone }, world) => {
    const c = world.tables.drop_order_changes.find((x) => x.key === p_key);
    if (!c) return { state: "missing" };
    const r = world.tables.drop_orders.find((x) => x.id === c.drop_order_id);
    if (c.state !== "moved") return { state: c.state, change: copy(c), name: r?.name ?? null, phone: r?.phone ?? null };
    if (!r || r.canceled_at || r.picked_up || r.stage !== "reserved" || r.collected_at || canon(snapshot(r)) !== canon(c.before)) {
      const v = c.charge_payment_id || c.refunds.length || c.by_hand_cents > 0 ? "stale" : "void";
      Object.assign(c, { state: v, outcome: `${c.outcome ? `${c.outcome} · ` : ""}the pack changed before this was applied`, updated_at: new Date().toISOString() });
      return { state: v, change: copy(c), name: r?.name ?? null, phone: r?.phone ?? null };
    }
    Object.assign(r, { size: c.after.size, glass: c.after.glass, mix: copy(c.after.mix), drop_date: c.after.drop_date, total_cents: c.after.total_cents,
      name: String(p_name ?? "").trim() || r.name, phone: String(p_phone ?? "").trim() || r.phone, benefit_code: c.after.benefit_code || null,
      paid: r.paid || c.charge_payment_id !== null, payment_id: !r.paid && c.charge_payment_id ? c.charge_payment_id : r.payment_id });
    Object.assign(c, { state: "done", updated_at: new Date().toISOString() });
    return { state: "done", change: copy(c), name: r.name, phone: r.phone };
  },
  pack_change_refunded: ({ p_key, p_refund }, world) => {
    const c = world.tables.drop_order_changes.find((x) => x.key === p_key && ["moved", "done", "stale"].includes(x.state));
    if (!c) return false;
    c.refunds.push(copy(p_refund));
    return true;
  },
  pack_change_answer: ({ p_key, p_status, p_answer }, world) => {
    const c = world.tables.drop_order_changes.find((x) => x.key === p_key);
    if (c) Object.assign(c, { status: p_status, answer: copy(p_answer) });
    return null;
  },
};

// A paid six to bring bottles back to: $42.00; new glass is six at $10, $60.00 (lib/bottlePricing).
function fresh({ pack = {}, stops = null, noPack = false } = {}) {
  const now = Date.now();
  const stop = (id, inH, market = "greenville") => ({ id, starts_at: new Date(now + inH * H).toISOString(), market, archived_at: null, canceled_at: null, status: "scheduled" });
  const theStops = stops ?? [stop(STOP, 72), stop(LATER, 168)];
  w = moneyWorld({
    tables: {
      stops: theStops,
      market_live: [{ market: "greenville", pre_launch: false, opens_on: null, held_closed: false }],
      live_status: [{ id: 1, pay_at_pickup: true }],
      customers: [], member_benefits: [], checkout_claims: [], drop_order_changes: [],
      drop_orders: noPack ? [] : [{ id: PACK, user_id: SAM, tenant_id: "00000000-0000-0000-0000-000000000001", name: "Dee Example", phone: "864-555-0142",
        size: 6, glass: "return", mix: { RISE: 3, FLOW: 3, DUSK: 0 }, drop_date: null, stop_id: STOP, total_cents: 4200, paid: true, payment_id: "pay_TESTRESERVE01",
        benefit_code: null, canceled_at: null, picked_up: false, stage: "reserved", collected_at: null, ...pack }],
    },
    unique: { drop_order_changes: ["key", "charge_payment_id"] },
    rpc: { rate_limit_hit: ({ p_bucket }) => !blocked.includes(p_bucket), ...PACK_CHANGE },
    sessions: { [SAM_TOKEN]: { id: SAM, email: "sam@example.test" }, [BEA_TOKEN]: { id: BEA, email: "bea@example.test" } },
  });
  if (!noPack && w.tables.drop_orders[0].drop_date === null) w.tables.drop_orders[0].drop_date = P.requestedDay(theStops.find((s) => s.id === (pack.stop_id ?? STOP))?.starts_at ?? theStops[0].starts_at);
  sq = fakeSquare();
  // the reservation's own payment, already in Square
  sq.payments.push({ id: "pay_TESTRESERVE01", status: "COMPLETED", amount_money: { amount: 4200, currency: "USD" }, reference_id: "made-up-reservation-key" });
  globalThis.fetch = squareDesk;
  alerts = []; told = []; blocked = []; refunds = []; refundCalls = []; refundScript = [];
}
async function squareDesk(url, init = {}) {
  const u = new URL(String(url));
  const method = (init.method ?? "GET").toUpperCase();
  const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (u.pathname === "/v2/payments" && method === "POST") return sq.fetch(url, init);
  if (u.pathname === "/v2/refunds" && method === "POST") {
    const req = JSON.parse(init.body);
    refundCalls.push(req);
    const step = refundScript.length ? refundScript.shift() : "ok";
    if (step === "drop") throw new TypeError("fetch failed");
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
  "@supabase/supabase-js": { createClient: () => w },
  "@/lib/serverAlerts": { raiseAlert: async (a) => { alerts.push(a); }, raiseAlertOnce: async (a) => { alerts.push(a); return true; } },
  "@/lib/notify": {
    accountEmail: async (id) => (id === SAM ? "sam@example.test" : null),
    whoAsked: async () => "Dee Example",
    notifyCustomer: async (m) => { told.push(m); return { sms: "off", email: "sent" }; },
  },
};
const load = routeLoader(shims);
const P = load("lib/packOrder.ts");
fresh();
const route = load("app/api/reserve/change/route.ts");

let n = 0;
const key = () => `made-up-change-key-${String(++n).padStart(4, "0")}-${Math.random().toString(36).slice(2, 8)}`;
const card = () => `cnon:made-up-${Math.random().toString(36).slice(2, 12)}`;
const dayOf = (id) => P.requestedDay(w.tables.stops.find((s) => s.id === id).starts_at);
const pack = () => w.tables.drop_orders[0];
const changes = () => w.tables.drop_order_changes;
// The pack as the page sends it back, changed.
const CHANGE = (extra = {}) => ({ id: PACK, name: "Dee Example", phone: "864-555-0142", size: 6, glass: "return", mix: { RISE: 3, FLOW: 3, DUSK: 0 }, dropDate: dayOf(STOP), ...extra });
async function post(body, { token = SAM_TOKEN, ip = "203.0.113.21" } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": ip };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await route.POST(new Request("https://app.example.test/api/reserve/change", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}

// ── the quote: what a change would move, nothing written ────────────────────────────────────────────────────────────
{
  fresh();
  const q = await post({ ...CHANGE({ glass: "new" }), quote: true });
  ok("quote: a paid $42 six to new glass — paid, was $42.00, now $60.00, the difference $18.00", q.status === 200 && q.json?.quote?.paid === true && q.json.quote.wasCents === 4200
    && q.json.quote.newCents === 6000 && q.json.quote.diffCents === 1800, q);
  ok("quote: …nothing written, nothing asked of Square", changes().length === 0 && sq.calls.length === 0 && pack().glass === "return", { changes: changes().length });
}

// ── more: the difference charged once, the pack changed in place ─────────────────────────────────────────────────────
{
  fresh();
  const k = key(), t = card();
  const r = await post({ ...CHANGE({ glass: "new" }), expectedDiffCents: 1800, sourceId: t, idempotencyKey: k });
  ok("more: 200 changed — $18.00 charged, the pack's new total $60.00, still paid", r.status === 200 && r.json?.ok && r.json.changed === true && r.json.chargedCents === 1800
    && r.json.totalCents === 6000 && r.json.paid === true, r);
  ok("more: Square asked once, for $18.00, under the page's key, the receipt to the account", sq.calls.length === 1 && sq.calls[0].amount_money.amount === 1800
    && sq.calls[0].idempotency_key === k && sq.calls[0].buyer_email_address === "sam@example.test", sq.calls);
  ok("more: the pack itself is changed — new glass, $60.00, the reservation's payment kept", pack().glass === "new" && pack().total_cents === 6000 && pack().payment_id === "pay_TESTRESERVE01" && pack().paid === true, pack());
  const c = changes()[0];
  ok("more: one change, done, with the charge's payment and the answer kept", changes().length === 1 && c.state === "done" && c.charge_payment_id === sq.payments.at(-1).id && c.status === 200, c);
  ok("more: the member told the difference was charged; the crew told the pack changed", /We charged the \$18(\.00)? difference/.test(told[0]?.message ?? "") && told[0].phone === "864-555-0142"
    && alerts.some((a) => a.kind === "reservation_changed" && a.subjectId === PACK && /Charged \$18(\.00)? more/.test(a.body)), { told, alerts });
  const again = await post({ ...CHANGE({ glass: "new" }), expectedDiffCents: 1800, sourceId: t, idempotencyKey: k });
  ok("more: the same key again — the kept answer, no second charge, no second message", again.status === 200 && again.json?.chargedCents === 1800 && sq.calls.length === 1 && told.length === 1, again);
}

// ── less: the difference back to the card that paid ─────────────────────────────────────────────────────────────────
{
  fresh({ pack: { glass: "new", total_cents: 6000 } });
  sq.payments[0].amount_money.amount = 6000;
  const k = key();
  const r = await post({ ...CHANGE({ glass: "return" }), expectedDiffCents: -1800, idempotencyKey: k });
  ok("less: 200 changed — $18.00 refunded, the pack's new total $42.00", r.status === 200 && r.json?.changed === true && r.json.refundedCents === 1800 && r.json.totalCents === 4200, r);
  ok("less: refunded from the reservation's payment, once, under the change's own refund key", refundCalls.length === 1 && refundCalls[0].payment_id === "pay_TESTRESERVE01"
    && refundCalls[0].amount_money.amount === 1800 && refundCalls[0].idempotency_key === `${k.slice(0, 41)}.r0` && sq.calls.length === 0, refundCalls);
  ok("less: the pack is $42.00 and back to bring-your-bottles, the change done with the refund on it", pack().glass === "return" && pack().total_cents === 4200 && changes()[0].state === "done"
    && changes()[0].refunds[0]?.cents === 1800, { pack: pack(), change: changes()[0] });
  ok("less: the member told the money is going back to the card they paid with", /\$18(\.00)? is going back to the card you paid with/.test(told[0]?.message ?? ""), told);
}
{
  fresh({ pack: { glass: "new", total_cents: 6000 } });
  refundScript.push("refuse");
  const r = await post({ ...CHANGE({ glass: "return" }), expectedDiffCents: -1800, idempotencyKey: key() });
  ok("less, Square refuses the refund: the pack still changes — 200, 'the crew is sending $18.00 back by hand'", r.status === 200 && r.json?.changed === true && r.json.refundPendingCents === 1800
    && /sending \$18(\.00)? back to your card by hand/.test(r.json.warn ?? "") && pack().total_cents === 4200, r);
  ok("less, refused: the crew told to refund it by hand (critical, money)", alerts.some((a) => a.severity === "critical" && a.category === "money" && a.kind === "pack_refund_by_hand" && /Refund \$18(\.00)? by hand/.test(a.title)), alerts.map((a) => a.title));
}

// ── the same price, and a new day ─────────────────────────────────────────────────────────────────────────────────
{
  fresh();
  const r = await post({ ...CHANGE({ mix: { RISE: 6, FLOW: 0, DUSK: 0 }, dropDate: dayOf(LATER) }), expectedDiffCents: 0, idempotencyKey: key() });
  ok("same price: a new mix and a later day — 200, nothing charged or refunded, the pack moved to the new day", r.status === 200 && r.json?.changed === true && !r.json.chargedCents && !r.json.refundedCents
    && sq.calls.length === 0 && refundCalls.length === 0 && pack().mix.RISE === 6 && pack().drop_date === dayOf(LATER), { r, pack: pack() });
  ok("same price: the member told 'Same price — nothing charged'", /Same price — nothing charged/.test(told[0]?.message ?? ""), told);
}

// ── refusals ───────────────────────────────────────────────────────────────────────────────────────────────────────
{
  fresh();
  const r = await post({ ...CHANGE({ glass: "new" }), expectedDiffCents: 600, sourceId: card(), idempotencyKey: key() });
  ok("repriced: the page was shown a different difference — 409 with the server's ($18.00), nothing charged, nothing kept", r.status === 409 && r.json?.priceChanged === true && r.json.diffCents === 1800
    && sq.calls.length === 0 && changes().length === 0 && pack().glass === "return", r);
  const noCard = await post({ ...CHANGE({ glass: "new" }), expectedDiffCents: 1800, idempotencyKey: key() });
  ok("more without a card: 400 'Add a card to pay the difference', nothing begun", noCard.status === 400 && /Add a card/.test(noCard.json?.error ?? "") && changes().length === 0, noCard);
  const noExpect = await post({ ...CHANGE({ glass: "new" }), sourceId: card(), idempotencyKey: key() });
  ok("no difference confirmed: 400 'Refresh and confirm the change again'", noExpect.status === 400 && /Refresh and confirm/.test(noExpect.json?.error ?? ""), noExpect);
  const asked = w.calls.length;
  const other = await post({ ...CHANGE(), expectedDiffCents: 0, idempotencyKey: key() }, { token: BEA_TOKEN });
  ok("another member's pack: 404 from the route's own check — 0388's begin is never asked", other.status === 404 && changes().length === 0
    && !w.calls.slice(asked).some((c) => c.rpc === "pack_change_begin"), other);
  const none = await post({ ...CHANGE(), expectedDiffCents: 0, idempotencyKey: key() }, { token: null });
  ok("no sign-in: 401", none.status === 401, none);
  const shapes = await Promise.all(["null", "[1]", "{}", JSON.stringify({ id: "not-a-pack" })].map((b) => post(b)));
  ok("a body that isn't one — null, a list, no id, an id that isn't one — 400 each", shapes.every((x) => x.status === 400), shapes.map((x) => x.status));
  const badPick = await post({ ...CHANGE({ mix: { RISE: 1, FLOW: 1, DUSK: 1 } }), expectedDiffCents: 0, idempotencyKey: key() });
  ok("flavors that don't add up to the pack: 400 in packPick's words", badPick.status === 400 && /add up to the pack size/.test(badPick.json?.error ?? ""), badPick);
  const offDay = await post({ ...CHANGE({ dropDate: "2099-12-31" }), expectedDiffCents: 0, idempotencyKey: key() });
  ok("a day no stop takes: 409 'That pickup day just changed'", offDay.status === 409 && /pickup day just changed/.test(offDay.json?.error ?? "") && changes().length === 0, offDay);
}
for (const [what, setup, status, words] of [
  ["canceled", { canceled_at: new Date().toISOString() }, 409, /was canceled/],
  ["paid at the window", { collected_at: new Date().toISOString() }, 409, /paid at the window/],
  ["already in motion with the crew", { stage: "brewing" }, 409, /in motion/],
  ["picked up", { picked_up: true }, 409, /in motion/],
]) {
  fresh({ pack: setup });
  const r = await post({ ...CHANGE(), expectedDiffCents: 0, idempotencyKey: key() });
  ok(`a pack ${what}: ${status}, nothing begun`, r.status === status && words.test(r.json?.error ?? "") && changes().length === 0, r);
}
{
  // Its own drop closed (the stop is ten hours off — a pack's drop closes well before), the next stop's still open.
  const now = Date.now();
  fresh({ stops: [{ id: STOP, starts_at: new Date(now + 10 * H).toISOString(), market: "greenville", archived_at: null, canceled_at: null, status: "scheduled" },
    { id: LATER, starts_at: new Date(now + 168 * H).toISOString(), market: "greenville", archived_at: null, canceled_at: null, status: "scheduled" }] });
  const r = await post({ ...CHANGE({ dropDate: dayOf(LATER) }), expectedDiffCents: 0, idempotencyKey: key() });
  ok("its drop closed: 409 'we may already be brewing it', nothing begun", r.status === 409 && /drop has closed/.test(r.json?.error ?? "") && changes().length === 0, r);
}
{
  fresh();
  blocked = [`card:u:${SAM}`];
  const r = await post({ ...CHANGE({ glass: "new" }), expectedDiffCents: 1800, sourceId: card(), idempotencyKey: key() });
  ok("past this person's card tries: 429, charged:false — before the pack is read", r.status === 429 && r.json?.charged === false && sq.calls.length === 0 && !w.calls.some((c) => c.table === "drop_orders"), r);
}
{
  fresh();
  w.fail.drop_order_changes = { select: { code: "57014", message: "canceling statement due to statement timeout" } };
  const r = await post({ ...CHANGE({ glass: "new" }), expectedDiffCents: 1800, sourceId: card(), idempotencyKey: key() });
  ok("the key's change couldn't be checked: 503 pending, 'nothing is charged twice' — never taken for a new change", r.status === 503 && r.json?.pending === true && sq.calls.length === 0, r);
}

// ── the card's answers ───────────────────────────────────────────────────────────────────────────────────────────
{
  fresh();
  sq.script.push("decline");
  const k = key();
  const r = await post({ ...CHANGE({ glass: "new" }), expectedDiffCents: 1800, sourceId: card(), idempotencyKey: k });
  ok("declined: 400 in the card's words, the pack as it was, the change ended refused", r.status === 400 && r.json?.declined === true && /declined/i.test(r.json.error ?? "")
    && pack().glass === "return" && pack().total_cents === 4200 && changes()[0]?.state === "refused", { r, change: changes()[0] });
}
{
  fresh();
  sq.script.push("lose");
  const k = key(), t = card();
  const r = await post({ ...CHANGE({ glass: "new" }), expectedDiffCents: 1800, sourceId: t, idempotencyKey: k });
  ok("Square's answer lost: 409 pending, the pack left as it was, the change unknown", r.status === 409 && r.json?.pending === true && pack().glass === "return" && changes()[0]?.state === "unknown", { r, change: changes()[0] });
  ok("…the crew told (critical, money) to look in Square for the payment under the key", alerts.some((a) => a.severity === "critical" && a.category === "money" && a.kind === "pack_change_unknown" && a.body.includes(k)), alerts.map((a) => a.title));
  const again = await post({ ...CHANGE({ glass: "new" }), expectedDiffCents: 1800, sourceId: t, idempotencyKey: k });
  ok("…the same key again isn't sent to Square again", again.status === 409 && sq.calls.length === 1, again);
}

console.log(`\nA RESERVED PACK CHANGED IN PLACE, RUN (app/api/reserve/change): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
