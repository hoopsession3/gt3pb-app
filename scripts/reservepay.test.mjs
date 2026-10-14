// A LIMITED RESERVE IS PAID TO HOLD — every branch of lib/reservePay, against a mocked Square, a mocked claims table
// (lib/chargeOnce's ClaimStore) and mocked database steps (0400's functions as lib/reserveSteps calls them).
//
// The finding, as a sentence (R5 of the customer audit): a reserve was a 48-hour hold paid at the truck — nothing said
// where or when to come, the hold ran out on its own clock, and the crew had no list of who was owed a bottle. It is
// paid for now, like a pack, and is the member's until it is handed over; a cancel before the pickup closes refunds it.
//
// What is real is compiled from lib/: reservePay (the decisions), reservePickup (the pickup's words and its close),
// chargeOnce (the key), squareServer.chargeCard and refundPayment (the requests Square is sent, and what its answers are
// taken to mean). What is stood in for: Square's payments (scripts/fixtures/chargeonce.mjs) and its refunds (below, as
// its documentation describes them: the same key with the same request replays the first answer; the same key with a
// different request is IDEMPOTENCY_KEY_REUSED), the claims table, and 0400's functions — which
// scripts/db.reservepaid.test.mjs runs for real. Nothing here talks to Square or Supabase; every id is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { libLoader, fakeSquare, memoryClaims, clock } from "./fixtures/chargeonce.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const load = libLoader();
const R = load("lib/reservePay.ts"), RP = load("lib/reservePickup.ts"), SQ = load("lib/squareServer.ts"), C = load("lib/chargeOnce.ts");
ok("compiled: lib/reservePay, lib/reservePickup, lib/squareServer", typeof R.payReserve === "function" && typeof R.cancelReserve === "function" && typeof RP.reservePickupWords === "function");

// ── the pickup: its words, and when it closes (lib/reservePickup) ─────────────────────────────────────────────────
const STOP = { name: "WineXpress", starts_at: "2026-10-17T15:00:00Z", ends_at: "2026-10-17T18:00:00Z", canceled_at: null };
ok("pickup: in words — the day, the hours, the place (Eastern)", RP.reservePickupWords(STOP) === "Sat, Oct 17 · 11:00am–2:00pm at WineXpress", RP.reservePickupWords(STOP));
ok("pickup: as much as the stop says — no end, no name; nothing with no stop",
  RP.reservePickupWords({ starts_at: STOP.starts_at }) === "Sat, Oct 17 · 11:00am" && RP.reservePickupWords(null) === "" && RP.reservePickupWords({ starts_at: null }) === "");
ok("pickup: the crew's list — 'Sat, Oct 17 · WineXpress', a stop with no name the truck's",
  RP.reserveStopLabel(STOP) === "Sat, Oct 17 · WineXpress" && RP.reserveStopLabel({ starts_at: STOP.starts_at, name: " " }) === "Sat, Oct 17 · Truck stop" && RP.reserveStopLabel(null) === "");
ok("pickup: closes 24 hours before the stop — the pack rule", RP.reserveClosesAt(STOP)?.toISOString() === "2026-10-16T15:00:00.000Z");
ok("pickup: no stop, or one called off, never opens — it cannot be paid for",
  RP.reserveClosesAt(null) === null && RP.reserveClosesAt({ ...STOP, canceled_at: "2026-10-15T12:00:00Z" }) === null
  && !RP.reserveOpen(null, Date.parse("2026-10-14T00:00:00Z")) && !RP.reserveOpen({ ...STOP, canceled_at: "x" }, Date.parse("2026-10-14T00:00:00Z")));
ok("pickup: open until the moment it closes", RP.reserveOpen(STOP, Date.parse("2026-10-16T14:59:59Z")) && !RP.reserveOpen(STOP, Date.parse("2026-10-16T15:00:00Z")));

// ── the stand-ins ──────────────────────────────────────────────────────────────────────────────────────────────────
const SAM = "5a1a0000-0000-4000-8000-000000000001", ALEX = "5a1a0000-0000-4000-8000-000000000002";
const RES = "4e5e0000-0000-4000-8000-000000000001", FREE = "4e5e0000-0000-4000-8000-000000000002";

/** 0400's functions, as lib/reserveSteps calls them, over two maps. `fail` makes the next call of a kind go wrong. */
function memorySteps() {
  const reserves = new Map(), claims = new Map(), calls = [];
  const fail = { settle: 0, release: 0, hold: null, claimThrows: false };
  let n = 0;
  const ACTIVE = ["held", "pending", "paid", "collected"];
  const steps = {
    async paidUnder(key, userId) {
      calls.push(["paidUnder", key]);
      for (const c of claims.values()) if (c.idempotency_key === key && c.user_id === userId) return { ...c };
      return null;
    },
    async hold({ userId, reserveId, qty, key }) {
      calls.push(["hold", key, qty]);
      if (fail.hold) { const answer = fail.hold; fail.hold = null; return { ok: false, answer }; }
      for (const c of claims.values()) if (c.idempotency_key === key) {
        if (["pending", "paid", "collected"].includes(c.state)) return { ok: true, id: c.id, qty: c.qty, amountCents: c.paid_cents ?? c.qty * reserves.get(c.reserve_id).price_cents, again: true, state: c.state };
        c.idempotency_key = `${key}~${c.id.slice(0, 8)}`;
      }
      const r = reserves.get(reserveId);
      if (!r || !["live", "sold_out"].includes(r.status)) return { ok: false, answer: { status: 404, body: { error: "That reserve isn't on offer right now.", gone: true } } };
      const have = [...claims.values()].filter((c) => c.reserve_id === r.id && c.user_id === userId && ACTIVE.includes(c.state)).reduce((a, c) => a + c.qty, 0);
      if (have + qty > r.per_member_limit) return { ok: false, answer: { status: 409, body: { error: "That is more than one member may reserve." } } };
      if (r.stock_remaining < qty) return { ok: false, answer: { status: 409, body: { error: "Sold out." } } };
      r.stock_remaining -= qty;
      if (r.stock_remaining === 0) r.status = "sold_out";
      const id = `c1a10000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      claims.set(id, { id, reserve_id: r.id, user_id: userId, qty, state: "pending", idempotency_key: key, payment_id: null, paid_cents: null, refunded_cents: 0 });
      return { ok: true, id, qty, amountCents: qty * r.price_cents, again: false, state: "pending" };
    },
    async settle(id, paymentId, cents) {
      calls.push(["settle", id, paymentId, cents]);
      if (fail.settle > 0) { fail.settle--; return { ok: false, error: "the database didn't answer" }; }
      const c = claims.get(id);
      if (!c) return { ok: false, error: "That claim is gone." };
      if (["paid", "collected"].includes(c.state) && c.payment_id === paymentId) return { ok: true };
      if (c.state !== "pending") return { ok: false, error: `That claim is ${c.state}, not waiting on its payment.` };
      Object.assign(c, { state: "paid", payment_id: paymentId, paid_cents: cents });
      return { ok: true };
    },
    async release(id, reason, refunded) {
      calls.push(["release", id, reason, refunded]);
      if (fail.release > 0) { fail.release--; return { ok: false, error: "the database didn't answer" }; }
      const c = claims.get(id);
      if (!c) return { ok: false, error: "That claim is gone." };
      const keep = (x) => Math.max(c.refunded_cents, Math.min(c.paid_cents ?? 0, x));
      if (["cancelled", "expired"].includes(c.state)) { c.refunded_cents = keep(refunded); return { ok: true }; }
      if (!["held", "pending", "paid"].includes(c.state)) return { ok: false, error: "That claim was handed over." };
      Object.assign(c, { state: "cancelled", cancel_reason: reason, refunded_cents: keep(refunded) });
      const r = reserves.get(c.reserve_id);
      r.stock_remaining = Math.min(r.stock_total, r.stock_remaining + c.qty);
      if (r.status === "sold_out") r.status = "live";
      return { ok: true };
    },
    async claim(id) {
      calls.push(["claim", id]);
      if (fail.claimThrows) throw new Error("the database is down");
      const c = claims.get(id);
      if (!c) return null;
      const r = reserves.get(c.reserve_id);
      return { ...c, reserve: { name: r.name, stop: r.stop }, closes_at: RP.reserveClosesAt(r.stop)?.toISOString() ?? null };
    },
  };
  return { steps, reserves, claims, calls, fail };
}

/** Square's POST /v2/refunds, as documented: the same key and request replay the first answer; the same key and a
 *  different request is IDEMPOTENCY_KEY_REUSED. `script`: "ok" (default), "refuse", "lose" (made, answer lost). */
function fakeRefunds() {
  const keys = new Map();
  const rf = { calls: [], refunds: [], script: [],
    async fetch(url, init) {
      const req = JSON.parse(init.body);
      rf.calls.push(req);
      const step = rf.script.length ? rf.script.shift() : "ok";
      const { idempotency_key: key, ...rest } = req;
      const data = JSON.stringify(rest);
      let res = keys.get(key)?.data === data ? keys.get(key).res : null;
      if (!res && keys.has(key)) res = { status: 400, body: { errors: [{ code: "IDEMPOTENCY_KEY_REUSED", detail: "The idempotency key can only be retried with the same request data." }] } };
      if (!res) {
        if (step === "refuse") res = { status: 400, body: { errors: [{ code: "REFUND_AMOUNT_INVALID", detail: "The requested refund amount exceeds the amount available to refund." }] } };
        else {
          const refund = { id: `rf_TEST${String(rf.refunds.length + 1).padStart(4, "0")}`, status: "PENDING", payment_id: req.payment_id, amount_money: req.amount_money };
          rf.refunds.push({ ...refund, key, reason: req.reason });
          res = { status: 200, body: { refund } };
        }
        keys.set(key, { data, res });
      }
      if (step === "lose") throw new TypeError("fetch failed: other side closed");
      return { ok: res.status < 300, status: res.status, json: async () => JSON.parse(JSON.stringify(res.body)) };
    },
  };
  return rf;
}

// ── the world ──────────────────────────────────────────────────────────────────────────────────────────────────────
const now = clock("2026-10-14T15:00:00.000Z");
const sq = fakeSquare(), rf = fakeRefunds();
globalThis.fetch = (url, init) => (String(url).endsWith("/v2/refunds") ? rf.fetch(url, init) : sq.fetch(url, init));
const W = memorySteps();
const store = memoryClaims();
const told = { crew: [], customer: [] };
const tell = { crew: async (a) => { told.crew.push(a); }, customer: async (c) => { told.customer.push(c); } };
W.reserves.set(RES, { id: RES, name: "Barrel Rise", price_cents: 4000, status: "live", stock_total: 100, stock_remaining: 100, per_member_limit: 50, member_only: true, stop_id: "5709", stop: STOP });
W.reserves.set(FREE, { id: FREE, name: "Founders Pour", price_cents: 0, status: "live", stock_total: 5, stock_remaining: 5, per_member_limit: 1, member_only: true, stop_id: "5709", stop: STOP });
const forPay = (r) => ({ id: r.id, name: r.name, price_cents: r.price_cents, status: r.status, stock_remaining: r.stock_remaining, stop_id: r.stop_id, stop: r.stop });
let tok = 0;
const pay = (o) => {
  const token = o.token === undefined ? `cnon:RSV-${++tok}` : o.token;
  return R.payReserve({
    steps: W.steps, claims: store, tell, now, userId: o.user ?? SAM, who: "Sam Lee, sam@example.test", key: o.key,
    reserve: o.reserve === undefined ? forPay(W.reserves.get(o.res ?? RES)) : o.reserve,
    qty: o.qty ?? 1, expectedCents: o.expected, sourceId: token,
    charge: (amountCents, note) => SQ.chargeCard({ token: "sq-test-access-token", locationId: "LOC-TEST", sourceId: token, amountCents, note, idempotencyKey: o.key, buyerEmail: null }),
  });
};
const reset = () => { told.crew.length = 0; told.customer.length = 0; };

// ── 1 · a reserve, paid ────────────────────────────────────────────────────────────────────────────────────────────
{
  reset();
  const a = await pay({ key: "rsv-key-0000000001", qty: 2, expected: 8000 });
  const claim = [...W.claims.values()].find((c) => c.idempotency_key === "rsv-key-0000000001");
  ok("pay: 2 bottles at $40 — Square charged $80 once, under the checkout's key (its idempotency key and reference)",
    sq.calls.length === 1 && sq.calls[0].amount_money.amount === 8000 && sq.calls[0].idempotency_key === "rsv-key-0000000001" && sq.calls[0].reference_id === "rsv-key-0000000001", sq.calls[0]);
  ok("pay: the answer — yours, paid, recorded, the claim and the total", a.status === 200 && a.body.ok && a.body.paid && a.body.recorded && a.body.id === claim?.id && a.body.qty === 2 && a.body.totalCents === 8000, a);
  ok("pay: the claim is paid with Square's payment and what it took; the bottles left the shelf",
    claim?.state === "paid" && claim.payment_id === sq.payments[0].id && claim.paid_cents === 8000 && W.reserves.get(RES).stock_remaining === 98, claim);
  ok("pay: the member is told where, when, and until when a cancel is refunded",
    told.customer.length === 1 && /Barrel Rise is yours — \$80 paid ✓\. Pick it up Sat, Oct 17 · 11:00am–2:00pm at WineXpress\. Cancel for a full refund until Fri 11:00am\./.test(told.customer[0].message) && told.customer[0].userId === SAM, told.customer[0]);
  ok("pay: the crew are told — 'Limited Reserve sold', linked to Money → Reserve drops",
    told.crew.length === 1 && told.crew[0].title === "Limited Reserve sold" && told.crew[0].kind === "reservation_new" && told.crew[0].link === "/crew?s=money&a=resv" && /2 × Barrel Rise — \$80 paid/.test(told.crew[0].body), told.crew);
  const again = await pay({ key: "rsv-key-0000000001", qty: 2, expected: 8000, token: null });
  ok("pay: the same key again (a lost answer, a reload with no card) — yours, from the claim, and Square is not asked",
    again.status === 200 && again.body.paid && again.body.id === claim?.id && again.body.totalCents === 8000 && sq.calls.length === 1, again);
  ok("pay: and the claim answered first — before the checkout claims or the reserve are asked",
    W.calls.at(-1)[0] === "paidUnder");
}

// ── 2 · the reserve's checks, all before a key is claimed or a card asked ────────────────────────────────────────────
{
  reset();
  const before = { claims: store.rows.size, square: sq.calls.length, holds: W.calls.filter((c) => c[0] === "hold").length };
  const bad = await Promise.all([0, 13, 1.5, "two"].map((qty, i) => pay({ key: `rsv-qty-000000000${i}`, qty })));
  ok("checks: how many — between 1 and 12, whole", bad.every((a) => a.status === 400 && /between 1 and 12/.test(a.body.error)), bad.map((a) => a.body.error));
  const gone = await pay({ key: "rsv-gone-000000001", reserve: null });
  const draft = await pay({ key: "rsv-gone-000000002", reserve: { ...forPay(W.reserves.get(RES)), status: "draft" } });
  ok("checks: no such reserve, or not on offer — 404", gone.status === 404 && draft.status === 404 && gone.body.gone === true, [gone, draft]);
  const pre = await pay({ key: "rsv-pre-0000000001", reserve: { id: RES, name: "Barrel Rise", price_cents: 4000, status: "live", stock_remaining: 98 } });
  ok("checks: before 0400 (no pickup column) — reserving by card isn't switched on yet (503), nothing taken", pre.status === 503 && pre.body.off === true && /isn't switched on yet/.test(pre.body.error), pre);
  const soon = await pay({ key: "rsv-soon-000000001", reserve: { ...forPay(W.reserves.get(RES)), stop_id: null, stop: null } });
  ok("checks: no pickup named yet — opening soon, not payable", soon.status === 409 && /opens once its pickup is set/.test(soon.body.error), soon);
  const off = await pay({ key: "rsv-off-0000000001", reserve: { ...forPay(W.reserves.get(RES)), stop: { ...STOP, canceled_at: "2026-10-15T12:00:00Z" } } });
  ok("checks: its pickup called off — 409, check back for the new one", off.status === 409 && /called off/.test(off.body.error), off);
  now.advance(2 * 24 * 60 * 60 * 1000);   // Fri 11:00am Eastern and after
  const late = await pay({ key: "rsv-late-000000001" });
  now.advance(-2 * 24 * 60 * 60 * 1000);
  ok("checks: closed — 24 hours before its pickup", late.status === 409 && /have closed/.test(late.body.error), late);
  const sold = await pay({ key: "rsv-sold-000000001", reserve: { ...forPay(W.reserves.get(RES)), status: "sold_out", stock_remaining: 0 } });
  ok("checks: sold out — said before anything is claimed", sold.status === 409 && sold.body.error === "Sold out." && sold.body.soldOut === true, sold);
  const raised = await pay({ key: "rsv-shown-00000001", qty: 2, expected: 6000 });
  ok("checks: a total above the one the page showed is refused, with the total — the page shows it, the next tap agrees",
    raised.status === 409 && raised.body.totalChanged === true && raised.body.totalCents === 8000 && /\$80, not the \$60 shown/.test(raised.body.error), raised);
  const noCard = await pay({ key: "rsv-card-000000001", token: null });
  ok("checks: something to pay and no card — 400", noCard.status === 400 && /Add a card/.test(noCard.body.error), noCard);
  ok("checks: every one of them before a key was claimed, a bottle held or Square asked",
    store.rows.size === before.claims && sq.calls.length === before.square && W.calls.filter((c) => c[0] === "hold").length === before.holds);
}

// ── 3 · the hold refuses: the key is given back ──────────────────────────────────────────────────────────────────────
{
  reset();
  W.fail.hold = { status: 409, body: { error: "That is more than one member may reserve." } };
  const a = await pay({ key: "rsv-limit-00000001" });
  ok("hold refused (the member's limit) — the database's words, 409, and nothing charged", a.status === 409 && a.body.error === "That is more than one member may reserve." && sq.calls.length === 1, a);
  ok("hold refused — the checkout key is given back, so the same key can try again", !store.rows.has("rsv-limit-00000001"));
  const b = await pay({ key: "rsv-limit-00000001" });
  ok("hold refused, then the same key again — held and paid", b.status === 200 && b.body.paid === true && sq.calls.length === 2, b);
}

// ── 4 · declined: the bottles go back ─────────────────────────────────────────────────────────────────────────────────
{
  reset();
  const left = W.reserves.get(RES).stock_remaining;
  sq.script.push("decline");
  const a = await pay({ key: "rsv-decl-000000001" });
  const c = [...W.claims.values()].find((x) => x.idempotency_key === "rsv-decl-000000001");
  ok("declined: Square's words, declined — the page starts over with a new key", a.status === 400 && a.body.declined === true && /declined/i.test(a.body.error), a);
  ok("declined: the claim let go ('card declined') and its bottle back on the shelf", c?.state === "cancelled" && c.cancel_reason === "card declined" && W.reserves.get(RES).stock_remaining === left, c);
  const again = await pay({ key: "rsv-decl-000000001" });
  ok("declined: the same key again hears the same no — Square is not asked again", again.status === 400 && again.body.declined === true && sq.calls.filter((x) => x.idempotency_key === "rsv-decl-000000001").length === 1, again);
}

// ── 5 · Square's answer lost: the claim stays pending, nothing is charged twice ──────────────────────────────────────
{
  reset();
  sq.script.push("lose");
  const a = await pay({ key: "rsv-lost-000000001" });
  const c = [...W.claims.values()].find((x) => x.idempotency_key === "rsv-lost-000000001");
  ok("lost answer: 'we couldn't confirm' — pending, so the page keeps the key and the card", a.status === 409 && a.body.pending === true && /couldn't confirm your payment/.test(a.body.error), a);
  ok("lost answer: the claim stays pending — its bottle held until the crew settle it", c?.state === "pending", c);
  ok("lost answer: the crew are told — critical, with the key a payment would carry",
    told.crew.some((x) => x.severity === "critical" && x.title === "Reserve charge status unknown — check Square" && x.body.includes("rsv-lost-000000001")), told.crew);
  const again = await pay({ key: "rsv-lost-000000001" });
  ok("lost answer: a retry hears the same words, and Square is not asked again",
    again.status === 409 && again.body.pending === true && sq.calls.filter((x) => x.idempotency_key === "rsv-lost-000000001").length === 1, again);
}

// ── 6 · charged, and the claim would not move to paid ─────────────────────────────────────────────────────────────────
{
  reset();
  W.fail.settle = 1;
  const a = await pay({ key: "rsv-nosave-0000001" });
  ok("charged, not recorded: still yours — paid, with a ref to show at pickup", a.status === 200 && a.body.paid === true && a.body.recorded === false && a.body.ref?.length === 6 && /told the crew to mark your reserve paid/.test(a.body.warn), a);
  ok("charged, not recorded: the crew are told to mark it paid, with the payment",
    told.crew.some((x) => x.severity === "critical" && x.title === "Paid reserve didn't record — mark it paid" && x.body.includes(sq.payments.at(-1).id)), told.crew);
}

// ── 7 · a request that died half way, found by its retry ─────────────────────────────────────────────────────────────
{
  reset();
  const at = new Date(now() - C.IN_FLIGHT_MS - 1000).toISOString();
  store.rows.set("rsv-dead-charged01", { state: "charged", card: true, amount_cents: 4000, payment_id: "pay_TESTDEAD01", status: null, answer: null, note: null, updated_at: at });
  store.rows.set("rsv-dead-started01", { state: "started", card: true, amount_cents: 4000, payment_id: null, status: null, answer: null, note: null, updated_at: at });
  const charged = await pay({ key: "rsv-dead-charged01" });
  const started = await pay({ key: "rsv-dead-started01" });
  ok("died after the charge: paid, not recorded — and the crew told to check the claims",
    charged.status === 200 && charged.body.paid === true && charged.body.recorded === false && told.crew.some((x) => x.title === "Paid reserve may not have recorded — check the claims" && x.body.includes("pay_TESTDEAD01")), charged);
  ok("died while Square was asked: we couldn't confirm — the crew told, with the key",
    started.status === 409 && started.body.pending === true && told.crew.some((x) => x.title === "Reserve charge status unknown — check Square" && x.body.includes("rsv-dead-started01")), started);
}

// ── 8 · two taps at once: one charge ───────────────────────────────────────────────────────────────────────────────────
{
  reset();
  let release;
  sq.hold = new Promise((r) => { release = r; });
  const first = pay({ key: "rsv-twice-00000001" });
  await new Promise((r) => setTimeout(r, 10));
  const second = await pay({ key: "rsv-twice-00000001" });
  release(); sq.hold = null;
  const one = await first;
  ok("two taps at once: one charge — the second hears 'still confirming'",
    one.status === 200 && one.body.paid === true && second.status === 409 && second.body.pending === true && /Still confirming/.test(second.body.error)
    && sq.calls.filter((x) => x.idempotency_key === "rsv-twice-00000001").length === 1, [one, second]);
}

// ── 9 · a reserve that costs nothing is placed, not charged ──────────────────────────────────────────────────────────
{
  reset();
  const before = sq.calls.length;
  const a = await pay({ key: "rsv-free-000000001", res: FREE, token: null, expected: 0 });
  const c = [...W.claims.values()].find((x) => x.idempotency_key === "rsv-free-000000001");
  ok("free: placed — yours, no card, Square not asked", a.status === 200 && a.body.paid === true && a.body.totalCents === 0 && sq.calls.length === before && c?.state === "paid" && c.paid_cents === 0, a);
  ok("free: told as yours, with no charge named", /Founders Pour is yours\. Pick it up/.test(told.customer.at(-1)?.message ?? "") && /no charge/.test(told.crew.at(-1)?.body ?? ""), told);
  W.fail.settle = 1;
  const b = await pay({ key: "rsv-free-000000002", res: FREE, token: null, user: ALEX });
  const d = [...W.claims.values()].find((x) => x.idempotency_key === "rsv-free-000000002");
  ok("free, and it would not save: 503 — the claim let go, its bottle back, the key given back for a retry",
    b.status === 503 && d?.state === "cancelled" && !store.rows.has("rsv-free-000000002") && W.reserves.get(FREE).stock_remaining === 4, b);
}

// ── 10 · a price raised between the page and the hold ───────────────────────────────────────────────────────────────
{
  reset();
  W.reserves.get(RES).price_cents = 4500;   // the hold prices from the row it locks
  const a = await pay({ key: "rsv-price-00000001", reserve: { ...forPay(W.reserves.get(RES)), price_cents: 4000 }, expected: 4000 });
  W.reserves.get(RES).price_cents = 4000;
  const c = [...W.claims.values()].find((x) => x.idempotency_key === "rsv-price-00000001");
  ok("raised at the hold: refused with the new total — the hold let go, the key given back, nothing charged",
    a.status === 409 && a.body.totalChanged === true && a.body.totalCents === 4500 && c?.state === "cancelled" && !store.rows.has("rsv-price-00000001") && !sq.calls.some((x) => x.idempotency_key === "rsv-price-00000001"), a);
}

// ── 11 · cancel ──────────────────────────────────────────────────────────────────────────────────────────────────────
const cancel = (o) => R.cancelReserve({
  steps: W.steps, tell, now, claimId: o.id, by: o.crew ? { crew: true } : { userId: o.user ?? SAM }, who: "Sam Lee, sam@example.test",
  refund: o.noRefunds ? null : (r) => SQ.refundPayment({ token: "sq-test-access-token", paymentId: r.paymentId, amountCents: r.amountCents, idempotencyKey: r.key, reason: r.reason }),
});
const paidClaim = async (key, qty = 1, user = SAM) => {
  const a = await pay({ key, qty, user });
  if (a.status !== 200) throw new Error(`setup: ${JSON.stringify(a)}`);
  return W.claims.get(a.body.id);
};
{
  reset();
  const c = await paidClaim("rsv-cxl-0000000001", 2);
  const left = W.reserves.get(RES).stock_remaining;
  const a = await cancel({ id: c.id });
  ok("cancel: refunded in full to the card — Square asked once, under the claim's own key, with the reason",
    a.status === 200 && a.body.refundedCents === 8000 && rf.calls.length === 1 && rf.calls[0].idempotency_key === `rsvx-${c.id}` && rf.calls[0].payment_id === c.payment_id
    && rf.calls[0].amount_money.amount === 8000 && rf.calls[0].reason === "Limited Reserve canceled", [a, rf.calls[0]]);
  ok("cancel: the claim let go with its refund, the bottles back on the shelf", c.state === "cancelled" && c.refunded_cents === 8000 && W.reserves.get(RES).stock_remaining === left + 2, c);
  ok("cancel: the member told the money is on its way; the crew an fyi that the bottles are back",
    /is canceled — \$80 is on its way back to your card/.test(told.customer.at(-1)?.message ?? "") && told.crew.at(-1)?.severity === "fyi" && /back on the shelf/.test(told.crew.at(-1)?.body ?? ""), told);
  ok("cancel: refund keys fit Square's 45 characters", R.refundKey(c.id).length <= 45 && R.refundKey(c.id) === `rsvx-${c.id}`);
  const twice = await cancel({ id: c.id });
  ok("cancel twice: already — and Square is not asked again", twice.status === 200 && twice.body.already === true && rf.calls.length === 1, twice);
}
{
  reset();
  const c = await paidClaim("rsv-cxl-0000000002");
  const other = await cancel({ id: c.id, user: ALEX });
  ok("cancel: another member's reserve is not theirs to cancel — 404, nothing moves", other.status === 404 && c.state === "paid" && rf.calls.length === 1, other);
  now.advance(2 * 24 * 60 * 60 * 1000);
  const late = await cancel({ id: c.id });
  ok("cancel after its pickup closed: the member is sent to the crew, with when it closed", late.status === 409 && /Its pickup closed Fri 11:00am — ask the crew/.test(late.body.error) && c.state === "paid", late);
  const crew = await cancel({ id: c.id, crew: true });
  now.advance(-2 * 24 * 60 * 60 * 1000);
  ok("cancel after it closed, by the crew: refunded and let go", crew.status === 200 && crew.body.refundedCents === 4000 && c.state === "cancelled" && /Reserve refunded and canceled/.test(told.crew.at(-1)?.title ?? ""), crew);
}
{
  reset();
  const c = await paidClaim("rsv-cxl-0000000003");
  W.reserves.get(RES).stop = { ...STOP, canceled_at: "2026-10-15T12:00:00Z" };
  now.advance(2 * 24 * 60 * 60 * 1000);
  const a = await cancel({ id: c.id });
  now.advance(-2 * 24 * 60 * 60 * 1000);
  W.reserves.get(RES).stop = STOP;
  ok("cancel when its pickup was called off: the member may, any time — refunded", a.status === 200 && a.body.refundedCents === 4000 && c.state === "cancelled", a);
}
{
  reset();
  const c = await paidClaim("rsv-cxl-0000000004");
  const n0 = rf.refunds.length;
  rf.script.push("lose");
  const a = await cancel({ id: c.id });
  ok("refund answer lost: 'we couldn't confirm the refund' — the claim stands, the crew told (critical, with the payment)",
    a.status === 409 && a.body.pending === true && c.state === "paid" && told.crew.some((x) => x.severity === "critical" && x.title === "Reserve refund status unknown — check Square" && x.body.includes(c.payment_id)), a);
  const b = await cancel({ id: c.id });
  ok("refund answer lost, then the cancel again: the same key and request — Square replays its refund, made once",
    b.status === 200 && c.state === "cancelled" && rf.refunds.length === n0 + 1 && rf.calls.filter((x) => x.idempotency_key === `rsvx-${c.id}`).length === 2, b);
}
{
  reset();
  const c = await paidClaim("rsv-cxl-0000000005");
  rf.script.push("lose");
  await cancel({ id: c.id });                     // made, its answer lost
  c.refunded_cents = 1000;                        // a part refund made in Square meanwhile (0400: kept on the claim)
  const a = await cancel({ id: c.id });           // the same key, now asking for less — a different request
  ok("refund key reused with a different amount: Square says so, the answer is unknown — the claim stands",
    a.status === 409 && a.body.pending === true && c.state === "paid" && rf.calls.at(-1).amount_money.amount === 3000, a);
}
{
  reset();
  const c = await paidClaim("rsv-cxl-0000000006");
  rf.script.push("refuse");
  const a = await cancel({ id: c.id });
  ok("refund refused: said, and nothing canceled", a.status === 400 && /The refund didn't go through — The requested refund amount exceeds/.test(a.body.error) && c.state === "paid", a);
}
{
  reset();
  const c = await paidClaim("rsv-cxl-0000000007");
  W.fail.release = 1;
  const a = await cancel({ id: c.id });
  ok("refunded, and the claim would not let go: the crew told to cancel it by hand; the member that it is being finished",
    a.status === 200 && a.body.refundedCents === 4000 && /finishing the cancel/.test(a.body.warn) && told.crew.some((x) => x.title === "Refunded reserve didn't cancel — cancel it by hand"), a);
  const d = await paidClaim("rsv-cxl-0000000008");
  const orig = W.steps.release;
  W.steps.release = async (id, reason, refunded) => { await orig(id, reason, refunded); return { ok: false, error: "its answer was lost" }; };
  const crossed = told.crew.length;
  const b = await cancel({ id: d.id });
  W.steps.release = orig;
  ok("…but a release whose answer was lost, read again and found canceled, is no alarm", b.status === 200 && d.state === "cancelled" && !told.crew.slice(crossed).some((x) => x.severity === "critical"), b);
}
{
  reset();
  const c = await paidClaim("rsv-cxl-0000000009");
  c.state = "collected";
  const a = await cancel({ id: c.id });
  const p = await pay({ key: "rsv-cxl-pending-01" });
  sq.script.push("lose");
  const lost = await pay({ key: "rsv-cxl-pending-02", user: ALEX });
  const pend = [...W.claims.values()].find((x) => x.idempotency_key === "rsv-cxl-pending-02");
  const m = await cancel({ id: pend.id, user: ALEX });
  const k = await cancel({ id: pend.id, crew: true });
  ok("cancel: handed over — ask the crew; being paid — still confirming (the crew: settle it first)",
    a.status === 409 && /handed over/.test(a.body.error) && p.status === 200 && lost.status === 409 && m.status === 409 && /Still confirming/.test(m.body.error) && k.status === 409 && /Paid or Not charged/.test(k.body.error), [a, m, k]);
  const q = await paidClaim("rsv-cxl-0000000010", 1, ALEX);
  const off = await cancel({ id: q.id, user: ALEX, noRefunds: true });
  q.payment_id = null;
  const none = await cancel({ id: q.id, user: ALEX });
  ok("cancel: refunds not switched on — 503; a paid claim with no payment to refund — 409; nothing canceled",
    off.status === 503 && none.status === 409 && q.state === "paid", [off, none]);
  W.fail.claimThrows = true;
  const down = await cancel({ id: q.id, user: ALEX });
  W.fail.claimThrows = false;
  ok("cancel: the claim can't be read — 503, try again", down.status === 503, down);
}
{
  reset();
  const n0 = rf.calls.length;
  const free = await pay({ key: "rsv-cxl-free-00001", res: FREE, token: null, user: "5a1a0000-0000-4000-8000-000000000009" });
  const a = await cancel({ id: free.body.id, user: "5a1a0000-0000-4000-8000-000000000009" });
  ok("cancel a reserve that cost nothing: let go, nothing refunded, Square not asked", a.status === 200 && a.body.refundedCents === 0 && rf.calls.length === n0 && W.claims.get(free.body.id).state === "cancelled", a);
}

// ── 12 · settled by hand ──────────────────────────────────────────────────────────────────────────────────────────────
{
  reset();
  sq.script.push("lose");
  await pay({ key: "rsv-hand-000000001", user: "5a1a0000-0000-4000-8000-00000000000a" });
  sq.script.push("lose");
  await pay({ key: "rsv-hand-000000002", user: "5a1a0000-0000-4000-8000-00000000000b" });
  const one = [...W.claims.values()].find((x) => x.idempotency_key === "rsv-hand-000000001");
  const two = [...W.claims.values()].find((x) => x.idempotency_key === "rsv-hand-000000002");
  const noId = await R.settleByHand({ steps: W.steps, claimId: one.id, outcome: "paid", priceCents: 4000, paymentId: null });
  ok("by hand: Paid needs Square's payment id — its refund will need it", noId.status === 400 && /Paste the payment's ID from Square/.test(noId.body.error) && one.state === "pending", noId);
  const paid = await R.settleByHand({ steps: W.steps, claimId: one.id, outcome: "paid", priceCents: 4000, paymentId: "pay_FOUNDINSQ1" });
  ok("by hand: Paid — the claim paid with that payment and the amount", paid.status === 200 && one.state === "paid" && one.payment_id === "pay_FOUNDINSQ1" && one.paid_cents === 4000, one);
  const again = await R.settleByHand({ steps: W.steps, claimId: one.id, outcome: "paid", priceCents: 4000, paymentId: "pay_FOUNDINSQ1" });
  const left = W.reserves.get(RES).stock_remaining;
  const no = await R.settleByHand({ steps: W.steps, claimId: two.id, outcome: "not_charged", priceCents: 4000, paymentId: null });
  ok("by hand: Paid twice is already; Not charged lets the claim go and puts its bottle back",
    again.status === 200 && again.body.already === true && no.status === 200 && two.state === "cancelled" && two.cancel_reason === "not charged" && W.reserves.get(RES).stock_remaining === left + 1, [again, no]);
  const done = await R.settleByHand({ steps: W.steps, claimId: two.id, outcome: "paid", priceCents: 4000, paymentId: "pay_LATE00001" });
  ok("by hand: a claim no longer waiting on its payment is said so — 409", done.status === 409 && /isn't waiting on its payment/.test(done.body.error), done);
}

// ── 13 · the order of the money path, as written ────────────────────────────────────────────────────────────────────
{
  const src = readFileSync(join(ROOT, "lib/reservePay.ts"), "utf8");
  const body = src.slice(src.indexOf("export async function payReserve("), src.indexOf("// ── CANCEL"));
  const at = (s) => body.indexOf(s);
  ok("order: paid under the key → the checkout claims → the checks → the key claimed → the hold → the card",
    at("steps.paidUnder(") > 0 && at("steps.paidUnder(") < at("seenBefore(") && at("seenBefore(") < at("aboveShown(amount") && at("aboveShown(amount") < at("claimKey(")
    && at("claimKey(") < at("steps.hold(") && at("steps.hold(") < at("chargeOnce({"));
  const cx = src.slice(src.indexOf("export async function cancelReserve("), src.indexOf("// ── SETTLED BY HAND"));
  ok("order: a cancel refunds before it lets the bottles go", cx.indexOf("o.refund({") > 0 && cx.indexOf("o.refund({") < cx.indexOf("steps.release("));
  const route = readFileSync(join(ROOT, "app/api/reserves/pay/route.ts"), "utf8");
  ok("route: members only, the reserve read with its pickup (and without it until 0400), and the key on the card's charge",
    /if \(!user\) return NextResponse\.json\(\{ error: "Reserves are for members/.test(route) && /stop:stops\(name, starts_at, ends_at, canceled_at\)/.test(route)
    && /isMissingRelation\(withStop\.error\) \|\| isMissingColumn\(withStop\.error\)/.test(route) && /idempotencyKey: key, buyerEmail: email/.test(route));
}

console.log(`LIMITED RESERVE, PAID TO HOLD (lib/reservePay): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
