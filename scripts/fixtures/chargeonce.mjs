// ONE CHARGE PER CHECKOUT — the pieces two suites share (2026-10-11, 0371).
//
//   scripts/chargeonce.test.mjs     every branch, against a mocked Square and a mocked claims table
//   scripts/db.chargeonce.test.mjs  the same branches against 0371 in a real Postgres, through lib/checkoutClaims
//
// Nothing here talks to Square or Supabase. What is real is the code under test: lib/chargeOnce,
// lib/squareServer.chargeCard, lib/idempotency's attempt rules and lib/checkoutClaims are compiled from
// their TypeScript, not restated. What is stood in for:
//
//   · Square's Payments API, as its documentation describes it (developer.squareup.com, read 2026-10-11):
//     the same idempotency key with the same request data answers with the first result; the same key with
//     different data is 400 IDEMPOTENCY_KEY_REUSED; a card token is single use (CARD_TOKEN_USED); and
//     503 TEMPORARY_ERROR is "safe to retry with the same key". Plus the network, which the documentation
//     does not promise anything about — each call can be scripted to be declined, to fail before Square
//     sees it, or to be processed with its answer lost on the way back.
//   · /api/checkout's money path, in the route's own order (scripts/chargeonce.test.mjs reads the route to
//     hold it to that order): seenBefore → the route's checks → claimKey → chargeOnce (card) or placeOnce
//     (pay at pickup). The orders table is a list with 0238's unique payment_id, and `record` does what the
//     route's does: payment_id dedupe, the insert tried twice, the crew told when it will not save.
//   · The page: components/useIdemKey's begin/settle over lib/idempotency's attempt — a card form that hands
//     out a new token every time it is asked, and a reload that keeps the key and loses the token.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const nodeRequire = createRequire(import.meta.url);

/** lib/<name>.ts, compiled. Relative imports resolve inside lib/, and Node's own modules (node:crypto — lib/appleKey,
 *  lib/appleSignIn) are Node's; anything else is a test that needs fixing. */
export function libLoader() {
  const cache = new Map();
  const load = (rel) => {
    if (cache.has(rel)) return cache.get(rel).exports;
    const mod = { exports: {} };
    cache.set(rel, mod);
    const out = ts.transpileModule(readFileSync(join(ROOT, rel), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    new Function("module", "exports", "require", out)(mod, mod.exports, (spec) => {
      if (spec.startsWith("./")) return load(`lib/${spec.slice(2)}.ts`);
      if (spec.startsWith("node:")) return nodeRequire(spec);
      throw new Error(`unexpected import ${spec} in ${rel}`);
    });
    return mod.exports;
  };
  return load;
}

const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });

/**
 * Square's POST /v2/payments. Install with `globalThis.fetch = sq.fetch`. `sq.script` is consumed one entry per
 * call: "ok" (the default), "decline", "503" (Square did not process it), "lose" (processed, the answer never
 * arrives), "drop" (never reached Square). `sq.hold` (a promise) keeps a call inside Square until it settles.
 */
export function fakeSquare() {
  const keys = new Map();       // idempotency_key → { data, res }
  const tokens = new Set();     // card tokens Square has consumed
  const sq = {
    calls: [], payments: [], script: [], hold: null,
    async fetch(url, init) {
      if (!String(url).endsWith("/v2/payments")) throw new Error(`fake Square: unexpected ${url}`);
      const req = JSON.parse(init.body);
      sq.calls.push(req);
      const step = sq.script.length ? sq.script.shift() : "ok";
      if (sq.hold) await sq.hold;
      if (step === "drop") throw new TypeError("fetch failed");
      if (step === "503") return answer(503, { errors: [{ category: "API_ERROR", code: "TEMPORARY_ERROR", detail: "A temporary internal error occurred. You can safely retry your call using the same idempotency key." }] });
      const { idempotency_key: key, ...rest } = req;
      const data = JSON.stringify(rest);
      let res;
      const seen = keys.get(key);
      if (seen) {
        res = seen.data === data ? seen.res
          : { status: 400, body: { errors: [{ category: "INVALID_REQUEST_ERROR", code: "IDEMPOTENCY_KEY_REUSED", detail: "The idempotency key can only be retried with the same request data." }] } };
      } else {
        if (tokens.has(req.source_id)) res = { status: 400, body: { errors: [{ category: "INVALID_REQUEST_ERROR", code: "CARD_TOKEN_USED", detail: "The provided card token (nonce) was already used to process the payment or refund." }] } };
        else if (step === "decline") res = { status: 400, body: { errors: [{ category: "PAYMENT_METHOD_ERROR", code: "GENERIC_DECLINE", detail: "Card declined." }] } };
        else {
          const payment = { id: `pay_TEST${String(sq.payments.length + 1).padStart(6, "0")}`, status: "COMPLETED", amount_money: req.amount_money, reference_id: req.reference_id ?? null };
          sq.payments.push({ ...payment, idempotency_key: key, source_id: req.source_id });
          res = { status: 200, body: { payment } };
        }
        tokens.add(req.source_id);
        keys.set(key, { data, res });
      }
      if (step === "lose") throw new TypeError("fetch failed: other side closed");
      return answer(res.status, res.body);
    },
  };
  return sq;
}

/** public.checkout_claims as 0371 declares it, in a Map — and `failing` to stand in for a table PostgREST does not know ("missing") or a down one. */
export function memoryClaims() {
  const rows = new Map();
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const store = {
    rows, failing: null,
    async read(key) {
      if (store.failing) return { ok: false, missing: store.failing === "missing", error: store.failing };
      const r = rows.get(key);
      return { ok: true, claim: r ? copy(r) : null };
    },
    async claim(key, row, at) {
      if (store.failing) return { ok: false, missing: store.failing === "missing", error: store.failing };
      if (rows.has(key)) return { ok: true, claimed: false };
      rows.set(key, { state: "started", card: row.card, amount_cents: row.amountCents, payment_id: null, status: null, answer: null, note: null, updated_at: at });
      return { ok: true, claimed: true };
    },
    async move(key, to, at, from) {
      const r = rows.get(key);
      if (!r || store.failing) return false;
      if (from && (r.state !== from.state || r.updated_at !== from.updated_at)) return false;
      r.state = to.state; r.updated_at = at;
      if (to.paymentId !== undefined) r.payment_id = to.paymentId;
      if (to.answer) { r.status = to.answer.status; r.answer = copy(to.answer.body); }
      if (to.note !== undefined) r.note = to.note;
      return true;
    },
    async release(key) { if (rows.get(key)?.state === "started") rows.delete(key); },
  };
  return store;
}

/** A clock the suite moves by hand. */
export function clock(start = "2026-10-11T15:00:00.000Z") {
  let t = Date.parse(start);
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

/**
 * /api/checkout's money path, in the route's order. `checks(req)` stands for everything the route asks between
 * the replay and the claim (the limiter, the stock, the truck's hours): null to go on, an answer to refuse.
 */
export function cupsRoute(C, SQ, { store, now, checks = async () => null }) {
  const orders = [], alerts = [];
  const failInserts = { n: 0, why: "" };
  const insert = (row) => {
    if (failInserts.n > 0) { failInserts.n--; return { error: { code: "P0001", message: failInserts.why } }; }
    if (row.payment_id && orders.some((o) => o.payment_id === row.payment_id)) return { error: { code: "23505", message: "duplicate key value violates unique constraint \"orders_payment_id_uniq\"" } };
    orders.push(row);
    return { error: null };
  };
  const stopped = async ({ key, claim }) => { alerts.push({ kind: "stopped", key, was: claim.state, card: claim.card, payment: claim.payment_id }); };
  const paid = (paymentId, amount, extra = {}) => ({ status: 200, body: { ok: true, paid: true, paymentId, amount, recorded: true, ...extra } });

  async function serve(req) {
    const seen = await C.seenBefore(store, req.key, !!req.token, now, stopped);
    if ("answer" in seen) return seen.answer;
    const refused = await checks(req);
    if (refused) return refused;
    if (!req.token) {
      const held = await C.claimKey(seen.claims, req.key, { channel: "cups", card: false, amountCents: req.amount }, now, stopped);
      if ("answer" in held) return held.answer;
      return C.placeOnce({ claims: held.claims, key: req.key, now, place: async () => {
        const { error } = insert({ items: req.items, paid: false, payment_id: null, key: req.key });
        if (error) return { status: 500, body: { error: "That didn't go through — give it another tap" } };
        return { status: 200, body: { ok: true, paid: false, amount: req.amount, recorded: true } };
      } });
    }
    const held = await C.claimKey(seen.claims, req.key, { channel: "cups", card: true, amountCents: req.amount }, now, stopped);
    if ("answer" in held) return held.answer;
    return C.chargeOnce({
      claims: held.claims, key: req.key, now,
      charge: () => SQ.chargeCard({ token: "sq-test-access-token", locationId: "LOC-TEST", sourceId: req.token, amountCents: req.amount, note: "GT3PB pre-order", idempotencyKey: req.key, buyerEmail: null }),
      record: async (paymentId) => {
        if (req.recordThrows) throw new Error("the function stopped while writing the order");
        if (paymentId && orders.some((o) => o.payment_id === paymentId)) return paid(paymentId, req.amount);
        let { error } = insert({ items: req.items, paid: true, payment_id: paymentId, key: req.key });
        if (error) ({ error } = insert({ items: req.items, paid: true, payment_id: paymentId, key: req.key }));
        if (error) {
          if (error.code === "23505" && paymentId && orders.some((o) => o.payment_id === paymentId)) return paid(paymentId, req.amount);
          const ref = (paymentId || "").slice(-6).toUpperCase();
          alerts.push({ kind: "unrecorded", payment: paymentId, amount: req.amount, why: error.message });
          return paid(paymentId, req.amount, { recorded: false, ref, warn: `Payment received — ref ${ref}. We've alerted the crew to add your order; show this ref at the window.` });
        }
        return paid(paymentId, req.amount);
      },
      unknown: async (e) => {
        alerts.push({ kind: "unknown", key: req.key, error: String(e instanceof Error ? e.message : e) });
        return { status: 502, body: { ...C.couldNotConfirm(true).body } };
      },
    });
  }
  return { serve, orders, alerts, failInserts };
}

/** The page: what components/useIdemKey keeps, over lib/idempotency's attempt. `old: true` is the page before 0371. */
let tokenSerial = 0;   // every token the card forms hand out in a run is a different token, as Square's are
export function cardPage(I, { old = false } = {}) {
  let tokens = 0, state = I.NO_ATTEMPT, prev = I.EMPTY_IDEM;
  const fresh = () => { tokens++; return `cnon:TEST-${++tokenSerial}`; };
  return {
    get state() { return state; },
    get tokensMinted() { return tokens; },
    /** A reload: sessionStorage gives the key back; a card token is never written anywhere. */
    reload() { state = { ...state, token: null }; },
    /** The app closed and opened again (C7, 2026-10-12): sessionStorage went with its process, localStorage did not —
     *  so a durable key comes back (components/useIdemKey `durable`) and a session key does not. Never a card token. */
    restart({ durable }) { state = durable ? { ...state, token: null } : I.NO_ATTEMPT; },
    begin(details, card = true, was = []) {
      if (old) {
        // Before 2026-10-11: a new token on every tap, and the key signed over it (Checkout.tsx's idemKeyFor).
        const token = card ? fresh() : null;
        prev = I.nextIdem(prev, token, details);
        return { key: prev.key, token };
      }
      state = I.attemptFor(state, details, randomUUID, was);
      if (!card) return { key: state.key, token: null };
      if (!state.token) state = { ...state, token: fresh() };
      return { key: state.key, token: state.token };
    },
    settle(key, status, body) { if (!old && state.key === key) state = I.afterAttempt(state, I.attemptVerdict(status, body)); },
  };
}

/** What the cup checkout signs its key with (components/Checkout): the drinks and the tip the customer chose — "15%",
 *  not its cents (R7, 2026-10-15). `cents`: the page before R7, which signed the tip's cents, and so moved with the price. */
export const signOf = (cart, { cents = false } = {}) =>
  (cents ? { items: cart.items, tipCents: Math.round((cart.amount ?? 0) * (cart.pct ?? 0) / (1 + (cart.pct ?? 0))) } : { items: cart.items, tip: cart.pct ?? 0 });

/** One tap: begin → the route → settle. `lose`: the route answers, and the page never hears it. */
export async function tap(page, route, cart, { card = true, lose = false, recordThrows = false, cents = false } = {}) {
  const a = page.begin(signOf(cart, { cents }), card);
  const served = await route.serve({ key: a.key, token: a.token, items: cart.items, amount: cart.amount, recordThrows });
  if (lose) { page.settle(a.key, null, null); return { key: a.key, token: a.token, status: null, body: null, served }; }
  page.settle(a.key, served.status, served.body);
  return { key: a.key, token: a.token, status: served.status, body: served.body, served };
}

const CART = { items: ["rise", "flow"], amount: 2000 };
const CART_B = { items: ["rise"], amount: 1000 };
const detailsOf = (cart) => signOf(cart);
// The same JSON, whatever order its keys come back in — jsonb keeps its own order, and a replayed answer is the
// same answer if every key says the same thing.
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const same = (a, b) => canon(a) === canon(b);
const until = async (cond) => { for (let i = 0; i < 1000 && !cond(); i++) await new Promise((r) => setImmediate(r)); return cond(); };

/**
 * Every branch, against whichever claims table the suite hands in. `memory` adds the ones only a stand-in can
 * stage: the table not pasted yet, the database not answering, and the page as it was before this fix.
 */
export async function branches({ C, SQ, I, store, ok, memory = false }) {
  const fresh = (opts = {}) => {
    const sq = fakeSquare();
    globalThis.fetch = sq.fetch;
    const now = clock();
    const route = cupsRoute(C, SQ, { store, now, ...opts });
    return { sq, now, route, page: cardPage(I) };
  };
  const claimOf = async (key) => (await store.read(key)).claim;

  // ── 1 · the first try goes through ───────────────────────────────────────────────────────────
  {
    const { sq, route, page } = fresh();
    const t = await tap(page, route, CART);
    ok("1 · first try: paid, and the order is in", t.status === 200 && t.body.ok === true && t.body.paid === true && t.body.recorded === true, t.body);
    ok("1 · first try: one call to Square, one payment, one order", sq.calls.length === 1 && sq.payments.length === 1 && route.orders.length === 1);
    ok("1 · first try: Square is sent the checkout's key, and the same key as the payment's reference_id",
      sq.calls[0].idempotency_key === t.key && sq.calls[0].reference_id === t.key, sq.calls[0]);
    const c = await claimOf(t.key);
    ok("1 · first try: the claim is done, with the payment and the answer it gave", c?.state === "done" && c.status === 200 && c.payment_id === sq.payments[0].id && same(c.answer, t.body), c);
    ok("1 · first try: the page lets the key go — the next checkout is a new one", page.state.key === "" && page.state.token === null, page.state);
  }

  // ── 2 · the answer is lost; the retry sends the same card token ──────────────────────────────
  {
    const { sq, route, page } = fresh();
    const first = await tap(page, route, CART, { lose: true });
    ok("2 · lost answer: the page keeps the key and the card token", page.state.key === first.key && page.state.token === first.token, page.state);
    const retry = await tap(page, route, CART);
    ok("2 · lost answer: the retry sends the same key with the same token — the card form is not asked again",
      retry.key === first.key && retry.token === first.token && page.tokensMinted === 1);
    ok("2 · lost answer: the retry hears the first request's answer, word for word", retry.status === 200 && same(retry.body, first.served.body), retry.body);
    ok("2 · lost answer: Square is not asked again — one call, one payment, one order", sq.calls.length === 1 && sq.payments.length === 1 && route.orders.length === 1);
  }

  // ── 3 · the answer is lost; the app reloads, so the retry carries a NEW token ────────────────
  {
    const { sq, route, page } = fresh();
    const first = await tap(page, route, CART, { lose: true });
    page.reload();
    const retry = await tap(page, route, CART);
    ok("3 · reload: the key survives it and the token does not (sessionStorage keeps keys, never card tokens)", retry.key === first.key && retry.token !== first.token);
    ok("3 · reload: the new token is answered from the claim — the first answer, no second charge",
      retry.status === 200 && same(retry.body, first.served.body) && sq.calls.length === 1 && sq.payments.length === 1 && route.orders.length === 1, { calls: sq.calls.length, payments: sq.payments.length });
  }

  // ── 4 · two requests with one key at once ────────────────────────────────────────────────────
  {
    // Both pass the replay check before either claims: the unique key decides between them.
    let arrived = 0, go;
    const both = new Promise((r) => (go = r));
    const { sq, route, page } = fresh({ checks: async () => { if (++arrived === 2) go(); await both; return null; } });
    const a = page.begin(detailsOf(CART));
    const [x, y] = await Promise.all([
      route.serve({ key: a.key, token: a.token, items: CART.items, amount: CART.amount }),
      route.serve({ key: a.key, token: "cnon:TEST-second-tap", items: CART.items, amount: CART.amount }),
    ]);
    const won = [x, y].filter((r) => r.status === 200), waiting = [x, y].filter((r) => r.status === 409 && r.body.pending === true);
    ok("4 · two at once, both past the replay check: one is charged, the other is told it is still confirming", won.length === 1 && waiting.length === 1, [x, y]);
    ok("4 · two at once: Square is asked once — one payment, one order", sq.calls.length === 1 && sq.payments.length === 1 && route.orders.length === 1);
    const after = await route.serve({ key: a.key, token: "cnon:TEST-later", items: CART.items, amount: CART.amount });
    ok("4 · two at once: the one that waited, asking again, hears the paid answer", after.status === 200 && same(after.body, won[0]?.body));
  }
  {
    // The second arrives while the first is inside Square.
    const { sq, route, page } = fresh();
    let open;
    sq.hold = new Promise((r) => (open = r));
    const a = page.begin(detailsOf(CART));
    const firstP = route.serve({ key: a.key, token: a.token, items: CART.items, amount: CART.amount });
    await until(() => sq.calls.length === 1);
    const second = await route.serve({ key: a.key, token: "cnon:TEST-other-tab", items: CART.items, amount: CART.amount });
    ok("4 · a retry while the first is inside Square: \"still confirming\", and it keeps its key", second.status === 409 && second.body.pending === true && /Still confirming your payment/.test(second.body.error), second.body);
    open(); sq.hold = null;
    const first = await firstP;
    ok("4 · …and the first finishes, charged once", first.status === 200 && sq.calls.length === 1 && sq.payments.length === 1, first.body);
  }

  // ── 5 · Square declines the card; the next tap is a new checkout ─────────────────────────────
  {
    const { sq, route, page } = fresh();
    sq.script.push("decline");
    const d = await tap(page, route, CART);
    ok("5 · decline: a 400 that says so, flagged declined — in one sentence, never Square's reason (R9)", d.status === 400 && d.body.declined === true && /^Your card was declined — nothing was charged\./.test(d.body.error ?? ""), d.body);
    ok("5 · decline: the page lets the key and the token go", page.state.key === "" && page.state.token === null);
    const c = await claimOf(d.key);
    ok("5 · decline: the claim is done with the decline", c?.state === "done" && c.status === 400 && c.answer?.declined === true, c);
    const again = await tap(page, route, CART);
    ok("5 · decline: the next tap has a new key and a new token, and is charged", again.key !== d.key && again.token !== d.token && again.status === 200, again.body);
    ok("5 · decline: one payment in all", sq.payments.length === 1 && sq.calls.length === 2);
    const stale = await route.serve({ key: d.key, token: "cnon:TEST-stale-bundle", items: CART.items, amount: CART.amount });
    ok("5 · decline: a page that sends the declined key again hears the decline again — Square is not asked", stale.status === 400 && stale.body.declined === true && sq.calls.length === 2);
  }

  // ── 6 · the charge goes through and the order will not save ──────────────────────────────────
  {
    const { sq, route, page } = fresh();
    route.failInserts.n = 2;
    route.failInserts.why = "RISE just sold out — remove it and try again.";
    const t = await tap(page, route, CART);
    const pay = sq.payments[0];
    ok("6 · insert fails after the charge: paid, not recorded, with a ref to show at the window",
      t.status === 200 && t.body.paid === true && t.body.recorded === false && t.body.ref === pay.id.slice(-6).toUpperCase() && /alerted the crew/.test(t.body.warn), t.body);
    const told = route.alerts.filter((a) => a.kind === "unrecorded");
    ok("6 · insert fails after the charge: the crew is told once, with the payment, the amount and why", told.length === 1 && told[0].payment === pay.id && told[0].amount === 2000 && /sold out/.test(told[0].why), told);
    ok("6 · insert fails after the charge: one payment, no order", sq.payments.length === 1 && route.orders.length === 0);
    const again = await route.serve({ key: t.key, token: "cnon:TEST-after-reload", items: CART.items, amount: CART.amount });
    ok("6 · …and a retry hears the same answer: no second charge, no second alert",
      same(again.body, t.body) && sq.calls.length === 1 && route.alerts.filter((a) => a.kind === "unrecorded").length === 1);
  }
  {
    // The request dies between the charge and the order (a function timeout): it never answers, never alerts.
    const { sq, route, page, now } = fresh();
    const a = page.begin(detailsOf(CART));
    let threw = false;
    try { await route.serve({ key: a.key, token: a.token, items: CART.items, amount: CART.amount, recordThrows: true }); } catch { threw = true; }
    const c = await claimOf(a.key);
    ok("6 · dies after the charge: the claim says charged, with the payment", threw && c?.state === "charged" && c.payment_id === sq.payments[0]?.id, c);
    const soon = await route.serve({ key: a.key, token: a.token, items: CART.items, amount: CART.amount });
    ok("6 · dies after the charge: a retry within a request's life is told it is still confirming", soon.status === 409 && soon.body.pending === true, soon.body);
    now.advance(C.IN_FLIGHT_MS + 1000);
    const late = await route.serve({ key: a.key, token: a.token, items: CART.items, amount: CART.amount });
    ok("6 · dies after the charge: past it, the retry answers paid — and the crew is told to check the pass, once",
      late.status === 200 && late.body.paid === true && late.body.recorded === false && late.body.paymentId === sq.payments[0].id
      && route.alerts.filter((x) => x.kind === "stopped").length === 1 && route.alerts.find((x) => x.kind === "stopped").was === "charged", { late: late.body, alerts: route.alerts });
    const later = await route.serve({ key: a.key, token: "cnon:TEST-again", items: CART.items, amount: CART.amount });
    ok("6 · …and every retry after that hears it again, with no second alert and no second charge",
      same(later.body, late.body) && route.alerts.filter((x) => x.kind === "stopped").length === 1 && sq.calls.length === 1);
  }

  // ── 7 · pay at pickup, sent twice ────────────────────────────────────────────────────────────
  {
    const { sq, route, page } = fresh();
    const first = await tap(page, route, CART, { card: false, lose: true });
    ok("7 · pay at pickup: the first send places the order (and its answer is lost)", first.served.status === 200 && first.served.body.paid === false && route.orders.length === 1);
    const retry = await tap(page, route, CART, { card: false });
    ok("7 · pay at pickup: the retry carries the same key and hears the first order — no second order",
      retry.key === first.key && retry.status === 200 && same(retry.body, first.served.body) && route.orders.length === 1 && sq.calls.length === 0, retry.body);
  }
  {
    const { route, page } = fresh();
    route.failInserts.n = 1;
    route.failInserts.why = "FLOW just sold out — remove it and try again.";
    const refused = await tap(page, route, CART_B, { card: false });
    ok("7 · pay at pickup: an insert the table refuses gives the key back", refused.status === 500 && (await claimOf(refused.key)) === null, refused.body);
    const placed = await tap(page, route, CART_B, { card: false });
    ok("7 · …so the next tap, with the same key, places it", placed.key === refused.key && placed.status === 200 && route.orders.length === 1);
  }
  {
    // One key covers both buttons: a card payment whose answer is unknown is not followed by a second order.
    const { sq, route, page } = fresh();
    sq.script.push("lose");
    const card = await tap(page, route, CART);
    ok("7 · card first, its answer lost at the server: \"may have been charged\", and the crew told", card.status === 502 && card.body.pending === true && route.alerts.some((a) => a.kind === "unknown") && sq.payments.length === 1);
    const pickup = await tap(page, route, CART, { card: false });
    ok("7 · …then \"pay at the truck\": the same key, so no unpaid second order on the pass", pickup.key === card.key && pickup.status === 409 && pickup.body.pending === true && route.orders.length === 0, pickup.body);
  }
  {
    // The other way: a pre-order went in and its answer was lost; Pay is tapped next.
    const { sq, route, page } = fresh();
    const pre = await tap(page, route, CART, { card: false, lose: true });
    const pay = await tap(page, route, CART);
    ok("7 · pre-order in, its answer lost, then Pay: the pre-order is the answer — paid: false — and no card is charged",
      pay.key === pre.key && pay.status === 200 && pay.body.paid === false && sq.calls.length === 0 && route.orders.length === 1, pay.body);
  }

  // ── 8 · the cart changes, so the key changes ─────────────────────────────────────────────────
  {
    const { sq, route, page } = fresh();
    const first = await tap(page, route, CART, { lose: true });
    const changed = await tap(page, route, CART_B);
    ok("8 · a different cart is a new key and a new token", changed.key !== first.key && changed.token !== first.token && changed.status === 200);
    ok("8 · …and a new checkout, charged on its own — a different order, by design", sq.payments.length === 2 && route.orders.length === 2);
    const p2 = cardPage(I);
    const k1 = p2.begin({ items: CART.items, tip: 0 }).key, k1again = p2.begin({ items: CART.items, tip: 0 }).key, k2 = p2.begin({ items: CART.items, tip: 0.15 }).key;
    ok("8 · the same cart and tip keep the key; a different tip — a different amount — is a new one", k1 === k1again && k2 !== k1);
  }
  {
    // Turned away before any charge (sold out, closed): the key is kept and the token is not.
    let refuse = true;
    const { sq, route, page } = fresh({ checks: async () => (refuse ? { status: 409, body: { error: "RISE just sold out — remove it and try again." } } : null) });
    const r = await tap(page, route, CART);
    ok("8 · refused before the money: the page keeps the key, and drops the token so a changed card is read again",
      r.status === 409 && page.state.key === r.key && page.state.token === null && sq.calls.length === 0 && (await claimOf(r.key)) === null, page.state);
    refuse = false;
    const r2 = await tap(page, route, CART);
    ok("8 · …and the next tap is the same checkout, with a fresh token, charged once", r2.key === r.key && r2.token !== r.token && r2.status === 200 && sq.payments.length === 1);
  }

  // ── 9 · Square's answer does not say ─────────────────────────────────────────────────────────
  {
    const { sq, route, page } = fresh();
    sq.script.push("503");
    const t = await tap(page, route, CART);
    const c = await claimOf(t.key);
    ok("9 · Square 503: \"may have been charged\" (502, pending), not a decline", t.status === 502 && t.body.pending === true && t.body.declined === undefined, t.body);
    ok("9 · Square 503: the claim is unknown, saying why, and the crew is told", c?.state === "unknown" && /503/.test(c.note ?? "") && route.alerts.filter((a) => a.kind === "unknown").length === 1, c);
    ok("9 · Square 503: the page keeps the key and the token", page.state.key === t.key && page.state.token === t.token);
    const again = await tap(page, route, CART);
    ok("9 · …and the retry is told it couldn't be confirmed — Square is not asked again", again.status === 409 && again.body.pending === true && /couldn't confirm your payment/.test(again.body.error) && sq.calls.length === 1, again.body);
  }
  {
    const { sq, route, page } = fresh();
    sq.script.push("lose");
    await tap(page, route, CART);
    await tap(page, route, CART);
    await tap(page, route, CART);
    ok("9 · Square charged and its answer was lost on the way to the server: three taps, one payment", sq.payments.length === 1 && sq.calls.length === 1);
  }
  {
    // The request dies while Square is being asked: no answer, no alert, a claim left started.
    const { sq, route, page, now } = fresh();
    const a = page.begin(detailsOf(CART));
    await C.claimKey(store, a.key, { channel: "cups", card: true, amountCents: CART.amount }, now, async () => {});
    const soon = await route.serve({ key: a.key, token: a.token, items: CART.items, amount: CART.amount });
    ok("9 · dies while Square is asked: within a request's life, \"still confirming\"", soon.status === 409 && /Still confirming/.test(soon.body.error));
    now.advance(C.IN_FLIGHT_MS + 1);
    const late = await route.serve({ key: a.key, token: a.token, items: CART.items, amount: CART.amount });
    ok("9 · …past it: unknown, and the crew told once by the retry that found it",
      late.status === 409 && /couldn't confirm your payment/.test(late.body.error) && route.alerts.filter((x) => x.kind === "stopped" && x.was === "started").length === 1, { late: late.body, alerts: route.alerts });
    const later = await route.serve({ key: a.key, token: a.token, items: CART.items, amount: CART.amount });
    ok("9 · …and not told again; Square never asked", /couldn't confirm/.test(later.body.error) && route.alerts.filter((x) => x.kind === "stopped").length === 1 && sq.calls.length === 0);
  }

  // ── 13 · the answer is lost; the app is closed and opened again (C7 of the customer audit, 2026-10-12) ─────
  // The cart survives a restart (localStorage) and a session key did not: the retry was a new checkout. The cup
  // checkout keeps its key beside the cart now, and the tip that is half its signature (components/Checkout).
  {
    const TIPPED = { ...CART, pct: 0.15, amount: 2300 };
    {
      const { sq, route, page } = fresh();
      const first = await tap(page, route, TIPPED, { lose: true });
      page.restart({ durable: false });
      const retry = await tap(page, route, TIPPED);
      ok("13 · restart, the key in sessionStorage: a new key, and the card charged twice — the bug, reproduced",
        retry.key !== first.key && sq.payments.length === 2 && route.orders.length === 2, { payments: sq.payments.length });
    }
    {
      const { sq, route, page } = fresh();
      const first = await tap(page, route, TIPPED, { lose: true });
      page.restart({ durable: true });
      const retry = await tap(page, route, TIPPED);
      ok("13 · restart, the key kept beside the cart and the tip with it: the same key, answered from the claim — one payment",
        retry.key === first.key && retry.token !== first.token && retry.status === 200 && same(retry.body, first.served.body)
          && sq.calls.length === 1 && sq.payments.length === 1 && route.orders.length === 1, { payments: sq.payments.length, body: retry.body });
    }
    {
      const { sq, route, page } = fresh();
      const first = await tap(page, route, TIPPED, { lose: true });
      page.restart({ durable: true });
      const retry = await tap(page, route, { ...CART, pct: 0, amount: 2000 });
      ok("13 · …why the tip is kept: back at \"No tip\" the signature is new, so the key is — and the card is charged again",
        retry.key !== first.key && sq.payments.length === 2, { payments: sq.payments.length });
    }
  }

  // ── 14 · the answer is lost; after a restart Pay is tapped before the server's price answers (R7, 2026-10-15) ───────
  // The quote prices a member's cups below the menu's, and the tip's cents move with the price. Signed with those cents,
  // the retry at the menu's price was a new key, refused for its amount (expectedCents); the page took the new price, and
  // the next tap — signed with the member's cents again, but its key long since replaced — was a third key, and charged.
  // Signed with the tip the customer chose, every one of those taps is the first key, answered from its claim.
  {
    const MEMBER = { ...CART, pct: 0.15, amount: 2300 };   // what the first tap paid: the member's price, and 15%
    const MENU = { ...CART, pct: 0.15, amount: 2645 };     // the menu's price, before the quote answers
    const priced = async (req) => (req.token && req.amount !== MEMBER.amount ? { status: 409, body: { error: "The price changed", priceChanged: true } } : null);
    {
      const { sq, route, page } = fresh({ checks: priced });
      const first = await tap(page, route, MEMBER, { lose: true, cents: true });
      page.restart({ durable: true });
      const early = await tap(page, route, MENU, { cents: true });
      const again = await tap(page, route, MEMBER, { cents: true });
      ok("14 · signed with the tip's cents: Pay before the price answers is a new key, refused — and the next tap a third key, charged again (the bug, reproduced)",
        early.key !== first.key && early.status === 409 && again.key !== first.key && again.key !== early.key && sq.payments.length === 2, { payments: sq.payments.length });
    }
    {
      const { sq, route, page } = fresh({ checks: priced });
      const first = await tap(page, route, MEMBER, { lose: true });
      page.restart({ durable: true });
      const early = await tap(page, route, MENU);
      ok("14 · signed with the tip the customer chose: Pay at the menu's price is the first key, answered from its claim — one payment",
        early.key === first.key && early.status === 200 && same(early.body, first.served.body)
          && sq.calls.length === 1 && sq.payments.length === 1 && route.orders.length === 1, { payments: sq.payments.length, early: early.status });
    }
    {
      // A key held from before R7 is signed with the cents: the page lists what it was signed as (attemptFor's `was`), so
      // the deploy itself never mints a second key for a payment whose answer is still out.
      const { sq, route, page } = fresh();
      const first = await tap(page, route, MEMBER, { lose: true, cents: true });
      page.restart({ durable: true });
      const a = page.begin(signOf(MEMBER), true, [signOf(MEMBER, { cents: true })]);
      const served = await route.serve({ key: a.key, token: a.token, items: MEMBER.items, amount: MEMBER.amount });
      ok("14 · a key held from before R7 — signed with the cents — is kept by the new page: answered from its claim, one payment",
        a.key === first.key && served.status === 200 && sq.payments.length === 1 && route.orders.length === 1, { payments: sq.payments.length });
    }
  }

  if (!memory) return;

  // ── 10 · the claims table missing — a restore, a branch, a stale schema cache (R14) ─────────
  // Until 0371 was pasted, a missing table ran the checkout without claims (Square's replay of its key the only dedupe —
  // and the old page, with a new token after a reload, was charged twice: the bug 0371 fixed). 0371 is applied, so a
  // missing table is refused like a table that is down: nothing is charged, whichever page asks.
  {
    store.failing = "missing";
    try {
      const { sq, route, page } = fresh();
      const t = await tap(page, route, CART);
      ok("10 · claims table missing: refused, nothing charged, and safe to tap again — never charged without its claim",
        t.status === 503 && /nothing was charged/.test(t.body.error) && sq.calls.length === 0 && page.state.key === t.key, t.body);
      const old = cardPage(I, { old: true });
      const o = await tap(old, route, CART);
      ok("10 · …the page from before 0371 too", o.status === 503 && sq.calls.length === 0 && route.orders.length === 0, o.body);
    } finally { store.failing = null; }
  }

  // ── 11 · the claims table is there and not answering ─────────────────────────────────────────
  {
    store.failing = "down";
    try {
      const { sq, route, page } = fresh();
      const t = await tap(page, route, CART);
      ok("11 · claims unreadable: refused, nothing charged, and safe to tap again", t.status === 503 && /nothing was charged/.test(t.body.error) && sq.calls.length === 0 && page.state.key === t.key, t.body);
    } finally { store.failing = null; }
  }
}
