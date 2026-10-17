// ONE CHARGE PER CHECKOUT — every branch, against a mocked Square and a mocked claims table (0371, 2026-10-11).
//
// The audit's finding, as a sentence: every tap of Pay asked the card form for a new token, the idempotency key
// was signed over the token, and so a retry after a lost answer reached Square as a payment it had never seen and
// was charged again. Section 12 below reproduces exactly that with the page as it was; everything else is the
// fix holding — one key per checkout, claimed before Square is called, every retry of it answered without a
// second call to Square — on each failure branch: the first try, a lost answer retried with the same token and
// with a new one, two requests at once, a decline and the new key after it, an order that will not save after
// the charge, a request that dies half way, pay at pickup sent twice, a cart that changes, and Square's own
// answers that do not say.
//
// What is real is compiled from lib/: chargeOnce (the decisions), squareServer.chargeCard (the request Square is
// sent, and what its answer is taken to mean), idempotency (the page's key rules). What is stood in for is in
// scripts/fixtures/chargeonce.mjs, and scripts/db.chargeonce.test.mjs runs the same branches against 0371 itself.
// Nothing here talks to Square or Supabase; every key, token and id is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { libLoader, fakeSquare, memoryClaims, branches, clock } from "./fixtures/chargeonce.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const load = libLoader();
const C = load("lib/chargeOnce.ts"), SQ = load("lib/squareServer.ts"), I = load("lib/idempotency.ts");
ok("compiled: lib/chargeOnce, lib/squareServer, lib/idempotency", typeof C.chargeOnce === "function" && typeof SQ.chargeCard === "function" && typeof I.attemptFor === "function");
const realFetch = globalThis.fetch;

// ── what Square's answer is taken to mean (lib/squareServer.chargeVerdict) ─────────────────────────
{
  const v = (status, code, detail) => SQ.chargeVerdict(status, code || detail ? { errors: [{ code, detail }] } : {});
  ok("verdict: 2xx is charged", v(200) === "charged" && v(201) === "charged");
  ok("verdict: a card decline is declined (400 and 402)", v(400, "GENERIC_DECLINE", "Card declined.") === "declined" && v(402, "CARD_DECLINED_VERIFICATION_REQUIRED") === "declined");
  ok("verdict: a used or expired token is declined — nothing was charged by THIS request", v(400, "CARD_TOKEN_USED") === "declined" && v(400, "CARD_TOKEN_EXPIRED") === "declined");
  ok("verdict: a reused key is unknown — an earlier attempt under it reached Square",
    v(400, "IDEMPOTENCY_KEY_REUSED") === "unknown" && v(400, undefined, "Different request parameters used for the same idempotency_key: dcbb7295") === "unknown");
  ok("verdict: 5xx, 408 and 409 are unknown (Square: TEMPORARY_ERROR is \"safe to retry with the same key\")",
    ["500", "502", "503", "504", "408", "409"].every((s) => v(Number(s), "TEMPORARY_ERROR") === "unknown"));
  ok("verdict: a 429 is a refusal, not a charge", v(429, "RATE_LIMITED") === "declined");
  ok("verdict: Square's documented reuse wording is unknown without its code, and a 4xx that merely names the key is not",
    v(400, undefined, "The idempotency key can only be retried with the same request data.") === "unknown"
    && v(400, "INVALID_VALUE", "Field must not be blank: idempotency_key") === "declined");
}

// ── the request Square is sent (lib/squareServer.chargeCard) ──────────────────────────────────────
{
  const sq = fakeSquare();
  globalThis.fetch = sq.fetch;
  const base = { token: "sq-test-access-token", locationId: "LOC-TEST", amountCents: 1000, note: "GT3PB pre-order", buyerEmail: null };
  const key36 = "11111111-2222-4333-8444-555555555555";
  const r = await SQ.chargeCard({ ...base, sourceId: "cnon:TEST-1", idempotencyKey: key36 });
  ok("chargeCard: charged — the payment id comes back", r.ok === true && r.paymentId === sq.payments[0].id, r);
  ok("chargeCard: the key goes as the idempotency key AND as the payment's reference_id",
    sq.calls[0].idempotency_key === key36 && sq.calls[0].reference_id === key36 && sq.payments[0].reference_id === key36, sq.calls[0]);
  const key45 = "k".repeat(45);
  await SQ.chargeCard({ ...base, sourceId: "cnon:TEST-2", idempotencyKey: key45 });
  ok("chargeCard: a key longer than Square's 40 for reference_id is still the idempotency key, and no reference_id is sent",
    sq.calls[1].idempotency_key === key45 && !("reference_id" in sq.calls[1]), sq.calls[1]);
  sq.script.push("decline");
  const d = await SQ.chargeCard({ ...base, sourceId: "cnon:TEST-3", idempotencyKey: "decline-key-0003" });
  // R9: one sentence for every card's refusal — never Square's reason (what a script running stolen cards reads for).
  ok("chargeCard: a decline is returned, in one sentence — never Square's reason", d.ok === false && d.error === SQ.DECLINE_WORDS && !/GENERIC_DECLINE|Card declined\./.test(d.error), d);
  ok("chargeCard: a refusal that isn't the card's is not called a decline — payments aren't working; an expired card entry asks for the card again",
    SQ.refusalWords(401, { errors: [{ category: "AUTHENTICATION_ERROR", code: "UNAUTHORIZED", detail: "token" }] }) === SQ.SQUARE_DOWN_WORDS
    && SQ.refusalWords(404, { errors: [{ category: "INVALID_REQUEST_ERROR", code: "NOT_FOUND", detail: "location" }] }) === SQ.SQUARE_DOWN_WORDS
    && SQ.refusalWords(400, { errors: [{ category: "INVALID_REQUEST_ERROR", code: "CARD_TOKEN_EXPIRED" }] }) === SQ.CARD_ENTRY_WORDS
    && SQ.refusalWords(402, { errors: [{ category: "PAYMENT_METHOD_ERROR", code: "CVV_FAILURE", detail: "Authorization error: 'CVV_FAILURE'" }] }) === SQ.DECLINE_WORDS);
  const throwsUnknown = async (f) => { try { await f(); return null; } catch (e) { return e; } };
  sq.script.push("503");
  const e503 = await throwsUnknown(() => SQ.chargeCard({ ...base, sourceId: "cnon:TEST-4", idempotencyKey: "unknown-key-0004" }));
  ok("chargeCard: a 503 is thrown, not returned as a decline", e503 instanceof SQ.ChargeUnknown && /503/.test(e503.message) && /TEMPORARY_ERROR/.test(e503.message), String(e503));
  const eReused = await throwsUnknown(() => SQ.chargeCard({ ...base, sourceId: "cnon:TEST-5", idempotencyKey: key36 }));
  ok("chargeCard: the same key with a new token is thrown as unknown (IDEMPOTENCY_KEY_REUSED)", eReused instanceof SQ.ChargeUnknown && /IDEMPOTENCY_KEY_REUSED/.test(eReused.message), String(eReused));
  const replay = await SQ.chargeCard({ ...base, sourceId: "cnon:TEST-1", idempotencyKey: key36 });
  ok("chargeCard: the same key with the same token is Square's replay — the first payment, not a second", replay.ok === true && replay.paymentId === sq.payments[0].id && sq.payments.length === 2, replay);
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError("Unexpected token '<'"); } });
  const eHtml = await throwsUnknown(() => SQ.chargeCard({ ...base, sourceId: "cnon:TEST-6", idempotencyKey: "html-key-00006" }));
  ok("chargeCard: a gateway's HTML page (no JSON) is thrown — still \"may have been charged\"", eHtml instanceof SyntaxError, String(eHtml));
  globalThis.fetch = realFetch;
}

// ── what an answer means to the page (lib/idempotency.attemptVerdict / afterAttempt) ──────────────
{
  const V = I.attemptVerdict;
  ok("page: no answer at all is unknown", V(null, null) === "unknown" && V(undefined, undefined) === "unknown");
  ok("page: paid is settled", V(200, { ok: true }) === "settled");
  ok("page: Square's decline is settled — a new card is a new key", V(400, { error: "Card declined.", declined: true }) === "settled");
  ok("page: \"still confirming\" is unknown, whatever its status", V(409, { pending: true }) === "unknown" && V(502, { pending: true }) === "unknown");
  ok("page: a 5xx is unknown", V(500, { ok: false }) === "unknown" && V(503, {}) === "unknown");
  ok("page: turned away before the money (sold out, closed, too many tries) is refused", V(409, { error: "RISE just sold out" }) === "refused" && V(429, { error: "Too many attempts" }) === "refused" && V(400, { error: "Add a name for pickup" }) === "refused");
  // R7b: a server error that says nothing was charged — the menu or the truck's hours unread, the claims store down — is
  // turned away, not a lost answer: nothing is held for it. Without the word, a 5xx may have charged.
  ok("page: a 5xx that says charged: false is refused — and the claims store's own refusal says it (R7b)",
    V(503, { error: "We couldn't check the truck's schedule", charged: false }) === "refused" && V(500, { charged: false }) === "refused"
    && C.cannotStart(true).body.charged === false && C.cannotStart(false).body.charged === false && V(503, C.cannotStart(true).body) === "refused");
  const a = { sig: "s", key: "k-0000001", token: "cnon:TEST-1" };
  ok("page: settled forgets the key and the token", I.afterAttempt(a, "settled") === I.NO_ATTEMPT);
  ok("page: unknown keeps both", I.afterAttempt(a, "unknown") === a);
  ok("page: refused keeps the key and drops the token", I.afterAttempt(a, "refused").key === "k-0000001" && I.afterAttempt(a, "refused").token === null);
  let n = 0;
  const mint = () => `key-${++n}-0000`;
  const first = I.attemptFor(I.NO_ATTEMPT, { items: ["rise"], tipCents: 0 }, mint);
  ok("page: the same cart keeps the same attempt — key and token", I.attemptFor({ ...first, token: "cnon:TEST-9" }, { items: ["rise"], tipCents: 0 }, mint).token === "cnon:TEST-9"
    && I.attemptFor(first, { items: ["rise"], tipCents: 0 }, mint) === first);
  ok("page: a different cart is a new key with no token", (() => { const b = I.attemptFor({ ...first, token: "cnon:TEST-9" }, { items: ["flow"], tipCents: 0 }, mint); return b.key !== first.key && b.token === null; })());
  ok("page: nothing about the card is in the signature", !/cnon/.test(I.attemptFor({ ...first, token: "cnon:TEST-9" }, { items: ["rise"], tipCents: 0 }, mint).sig));
}

// ── record is handed the charge's own answer (R3b, 0395: the card it was paid with, for the receipt) ────
{
  let got = null;
  const card = { brand: "Visa", last4: "4242" };
  const a = await C.chargeOnce({ claims: memoryClaims(), key: "k-record-0001", now: () => 0,
    charge: async () => ({ ok: true, paymentId: "pay-1", card }),
    record: async (paymentId, charged) => { got = { paymentId, charged }; return { status: 200, body: { ok: true } }; },
    unknown: async () => ({ status: 502, body: {} }) });
  ok("chargeOnce: record gets the payment id and the charge's whole answer — the card with it, nothing re-asked of Square",
    a.status === 200 && got?.paymentId === "pay-1" && got?.charged?.card === card && got?.charged?.ok === true, got);
  let called = false;
  await C.chargeOnce({ claims: memoryClaims(), key: "k-record-0002", now: () => 0,
    charge: async () => ({ ok: false, error: "Card declined." }),
    record: async () => { called = true; return { status: 200, body: {} }; },
    unknown: async () => ({ status: 502, body: {} }) });
  ok("chargeOnce: a decline is never recorded", called === false);
}

// ── the route still reads the way the suite drives it ────────────────────────────────────────────
// scripts/fixtures/chargeonce.mjs's cupsRoute is /api/checkout's money path in the route's order. These hold
// the route to that order, so the branches below are about the route and not about a story told of it.
{
  const code = (rel) => readFileSync(join(ROOT, rel), "utf8").split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
  const r = code("app/api/checkout/route.ts");
  const at = (s, from = 0) => r.indexOf(s, from);
  ok("route: the replay comes before the limiter, the stock and the truck's hours",
    at("seenBefore(") > 0 && at("seenBefore(") < at("bucket: `checkout:${ip}`") && at("seenBefore(") < at("readMenuRows(", at("const seen = await seenBefore(")) && at("seenBefore(") < at("readOrdering(")
    && at("seenBefore(") < at("readStopMenu("));
  // R2 (2026-10-13): the stock is the menu's own read (lib/drinks readMenuRows), and a stop's menu is a check like the truck's
  // hours — both after the replay, both before the claim.
  const firstClaim = at("claimKey("), secondClaim = at("claimKey(", firstClaim + 1);
  ok("route: both claims come after every check and before the money",
    firstClaim > at("orderingNow(") && firstClaim > at("pay_at_pickup") && firstClaim > at("readStopMenu(") && secondClaim > firstClaim && firstClaim < at("placeOnce(") && secondClaim < at("chargeOnce(") && at("claimKey(", secondClaim + 1) === -1);
  ok("route: pay at pickup's insert is placed under its claim", at("placeOnce(") < at("await insertOrder(orderRow)") && at("await insertOrder(orderRow)") < secondClaim);
  ok("route: Square is called in one place, inside chargeOnce", (r.match(/chargeCard\(/g) || []).length === 1 && /charge: \(\) => chargeCard\(/.test(r) && at("charge: () => chargeCard(") > at("chargeOnce("));
  ok("route: the store it claims in is the table's (lib/checkoutClaims) — and a table that does not answer refuses, the missing one too (R14)",
    /seenBefore\(checkoutClaims\(supabaseAdmin\), idemKey, paying, now, stopped\)/.test(r) && !/arrives-with: 0371/.test(readFileSync(join(ROOT, "app/api/checkout/route.ts"), "utf8"))
    && /if \(!r\.ok\) return \{ answer: cannotStart\(card\) \};/.test(readFileSync(join(ROOT, "lib/chargeOnce.ts"), "utf8"))
    && /\[charge-once-off\]/.test(readFileSync(join(ROOT, "lib/checkoutClaims.ts"), "utf8")));
  ok("route: an unknown charge answers the page with \"pending\" and tells the crew, naming the key",
    /unknown: async \(e\) => \{[\s\S]*?title: "Checkout charge status unknown — check Square"[\s\S]*?\$\{idemKey\}[\s\S]*?status: 502, body: \{ \.\.\.couldNotConfirm\(true\)\.body \}/.test(r)
    && C.couldNotConfirm(true).body.pending === true);
  ok("route: an order that will not save after the charge names the payment, the amount and why, and says to refund it if it can't be made",
    /title: "Paid order didn't record — add it", body: `A card payment succeeded \(\$\{paymentId\}, \$\{money\(amount\)\}\) but the order didn't save\$\{why/.test(r) && /refund that payment in Square/.test(r));
  ok("route: every answer says whether it was paid, so a replay to the other button reads right",
    (r.match(/ok: true, paid: true,/g) || []).length === 5 && (r.match(/ok: true, paid: false,/g) || []).length === 1);
  const co = code("components/Checkout.tsx");
  ok("page: both of the cup checkout's sends carry the checkout's key and settle it with the answer",
    (co.match(/idempotencyKey: attempt\.key/g) || []).length === 2 && (co.match(/idem\.settle\(attempt\.key, res\.status, data\)/g) || []).length === 2
    && /useIdemKey\(CO_IDEM, true\)/.test(co) && /const CO_IDEM = "gt3-co-idem", CO_TIP = "gt3-co-tip";/.test(co)
    && !/\.tokenize\(\)(?![^\n]*idem\.begin)/.test(co.replace(/idem\.begin\([^\n]*\.tokenize\(\)[^\n]*\)/g, "")));
  // 2026-10-12 (C7): the key is kept beside the cart (localStorage), two hours at most, and the tip that signed it — kept
  // as the key is used — comes back with it, only while a key is held, so a new checkout still starts at "No tip";
  // placing the order forgets it.
  ok("page: the cup checkout's key survives a restart, and its tip with it — only while the key is held (C7)",
    /const \[tipPct, setTipPct\] = useState\(restoredTip\);/.test(co) && /if \(typeof window === "undefined" \|\| !holdsKey\(CO_IDEM, true\)\) return 0;/.test(co)
    && /const placed = \(data: Placed, byCard: boolean\) => \{\s*try \{ localStorage\.removeItem\(CO_TIP\); \}/.test(co)
    && /export const DURABLE_KEY_MS = 2 \* 60 \* 60 \* 1000;/.test(readFileSync(join(ROOT, "lib/payHold.ts"), "utf8"))
    && (co.match(/keepTip\(\);\s*const attempt = await idem\.begin\(signed, /g) || []).length === 2 && !/useEffect\(\(\) => \{ try \{ localStorage\.setItem\(CO_TIP/.test(co)
    && /durable \? window\.localStorage : window\.sessionStorage/.test(readFileSync(join(ROOT, "components/useIdemKey.ts"), "utf8")));
  ok("page: Pay asks the card form for a token only through the key holder",
    /const attempt = await idem\.begin\(signed, \(\) => paymentRef\.current!\.tokenize\(\), signedBefore\);/.test(co));
  // 2026-10-15 (R7): the key is signed with the tip the customer chose, not its cents — the cents move with the price;
  // a key held from before is kept (signedBefore); and while a payment's answer never came the drinks and tip hold still.
  ok("page: the key is signed with the tip's choice, a key held from before is kept, and an unconfirmed payment holds the cart (R7)",
    /const signed = \{ items, tip: tipPct \};/.test(co) && /const signedBefore = \[\{ items, tipCents \}, \{ items, tipCents: Math\.round\(totalCents \* tipPct\) \}\];/.test(co)
    && /const held = idem\.isOpen\(\);/.test(co) && (co.match(/disabled=\{busy \|\| held\}/g) || []).length === 3
    && /keep\(afterAttempt\(cur, verdict\), verdict === "unknown"\)/.test(readFileSync(join(ROOT, "components/useIdemKey.ts"), "utf8"))
    && /if \(payHeldOpen\(\)\) return;/.test(readFileSync(join(ROOT, "components/AppProvider.tsx"), "utf8")));
}

// ── "Check on my payment" (R7b, lib/chargeOnce.checkOnly) ─────────────────────────────────────────────────────────
// A payment whose answer never came holds the page; Check asks about that key alone — never Square, never an order.
{
  const now = clock();
  const store = memoryClaims();
  const told = [];
  const stopped = async (st) => { told.push(st.key); };
  const never = await C.checkOnly(store, "check-key-unseen-01", true, now, stopped);
  ok("check: a key never seen was never charged — said so, and the key closed",
    never.status === 200 && never.body.checked === true && never.body.charged === false && /never reached us — nothing was charged/.test(never.body.error)
      && store.rows.get("check-key-unseen-01")?.state === "done", never);
  const late = await C.seenBefore(store, "check-key-unseen-01", true, now, stopped);
  ok("…so the request it belonged to, arriving late, is answered that — not charged", "answer" in late && late.answer.body.checked === true && late.answer.body.charged === false, late);
  ok("…and checking again says the same", (await C.checkOnly(store, "check-key-unseen-01", true, now, stopped)).body.charged === false);
  const pre = await C.checkOnly(store, "check-key-unseen-02", false, now, stopped);
  ok("check: a pre-order's never reached us is said as an order, not a payment", /never reached us — nothing was placed/.test(pre.body.error) && pre.body.charged === false);
  store.rows.set("check-key-paid-0003", { state: "done", card: true, amount_cents: 1000, payment_id: "pay-3", status: 200, answer: { ok: true, paid: true, amount: 1000, no: "#AB12" }, note: null, updated_at: new Date(now()).toISOString() });
  const paid = await C.checkOnly(store, "check-key-paid-0003", true, now, stopped);
  ok("check: a payment that went through is answered with its order — the first answer, word for word", paid.status === 200 && paid.body.ok === true && paid.body.no === "#AB12", paid);
  store.rows.set("check-key-flight-04", { state: "started", card: true, amount_cents: 1000, payment_id: null, status: null, answer: null, note: null, updated_at: new Date(now()).toISOString() });
  const flight = await C.checkOnly(store, "check-key-flight-04", true, now, stopped);
  ok("check: one still being asked of Square is \"still confirming\" — held, not released", flight.body.pending === true && store.rows.get("check-key-flight-04").state === "started", flight);
  now.advance(C.IN_FLIGHT_MS + 1000);
  const dead = await C.checkOnly(store, "check-key-flight-04", true, now, stopped);
  ok("…one whose request died is \"we couldn't confirm\", and the crew is told once", dead.body.pending === true && /couldn't confirm/.test(dead.body.error) && told.filter((k) => k === "check-key-flight-04").length === 1, dead);
  store.failing = "missing";
  const noTable = await C.checkOnly(store, "check-key-missing-5", true, now, stopped);
  ok("check: with no claims to read (0371 not pasted) it can't say — the crew can", noTable.body.pending === true && /ask the crew/.test(noTable.body.error), noTable);
  store.failing = "boom";
  const down = await C.checkOnly(store, "check-key-down-0006", true, now, stopped);
  ok("check: a claims store that won't answer releases nothing — the page keeps holding, and is never told \"nothing was charged\" (R7b re-audit)",
    down.body.checked !== true && down.status === 503 && down.body.pending === true && !/nothing was charged/.test(down.body.error) && /couldn't check on that payment/.test(down.body.error), down);
  store.failing = null;
  // R7b re-audit: a payment still in flight is said as a check says it — Pay is waiting on this very check.
  store.rows.set("check-key-flight-07", { state: "charged", card: true, amount_cents: 1200, payment_id: "pay-7", status: null, answer: null, note: null, updated_at: new Date(now()).toISOString() });
  const flight7 = await C.checkOnly(store, "check-key-flight-07", true, now, stopped);
  ok("check: one still in flight says \"check again\", never \"tap Pay\"", flight7.body.pending === true && /check again in a minute/.test(flight7.body.error) && !/tap Pay/.test(flight7.body.error), flight7);
  // …and a paid one whose request died is found by the check: paid, not saved — the crew told once, by the check.
  now.advance(C.IN_FLIGHT_MS + 1000);
  const paidDead = await C.checkOnly(store, "check-key-flight-07", true, now, stopped);
  ok("check: a payment that went through and stopped before the order saved is answered paid-not-recorded, and the crew told once",
    paidDead.status === 200 && paidDead.body.ok === true && paidDead.body.recorded === false && paidDead.body.ref === "PAY-7"
      && told.filter((k) => k === "check-key-flight-07").length === 1 && store.rows.get("check-key-flight-07").state === "done", paidDead);
  // A decline is answered as the decline it was — the page lets the key go on it (Checkout's checkHeld).
  store.rows.set("check-key-decl-0008", { state: "done", card: true, amount_cents: 900, payment_id: null, status: 400, answer: { error: "Card declined.", declined: true }, note: null, updated_at: new Date(now()).toISOString() });
  const decl = await C.checkOnly(store, "check-key-decl-0008", true, now, stopped);
  ok("check: a declined payment is answered declined — a definitive no, settled by the page", decl.status === 400 && decl.body.declined === true && I.attemptVerdict(decl.status, decl.body) === "settled", decl);
  // A claim that can't be written is "we couldn't check" too, and nothing is left behind.
  const ws = memoryClaims();
  const wsClaim = ws.claim;
  ws.claim = async () => ({ ok: false, missing: false, error: "boom" });
  const nowrite = await C.checkOnly(ws, "check-key-nowrite-9", true, now, stopped);
  ok("check: a claim that can't be written keeps the page holding, in the check's words", nowrite.status === 503 && nowrite.body.pending === true && !ws.rows.has("check-key-nowrite-9"), nowrite);
  ws.claim = wsClaim;
  const wm = memoryClaims();
  wm.move = async () => false;
  const nomove = await C.checkOnly(wm, "check-key-nomove-10", true, now, stopped);
  ok("check: claimed but not closed gives the key back — no half claim to read later as a payment that stopped", nomove.status === 503 && nomove.body.pending === true && !wm.rows.has("check-key-nomove-10"), nomove);

  const r = readFileSync(join(ROOT, "app/api/checkout/route.ts"), "utf8");
  ok("route: a check is answered before anything else is read, by checkOnly alone, bounded per phone",
    r.indexOf("if (body.check === true)") > 0 && r.indexOf("if (body.check === true)") < r.indexOf("const { sourceId, items, tipCents } = body;")
      && /return reply\(await checkOnly\(checkoutClaims\(supabaseAdmin\), body\.idempotencyKey, card, \(\) => Date\.now\(\), stoppedAlert\(drinkList\(body\.items\), nameGiven\(body\.customer\), true\)\)\);/.test(r)
      && /bucket: `checkout-check:\$\{ip\}`/.test(r));
  // R7b re-audit: rate_limit_hit answers whether the caller is UNDER its cap (0154) — the check refused every normal tap with
  // `=== true`. Every route that asks it refuses on false, and none on true.
  {
    const { readdirSync, statSync } = await import("node:fs");
    const walk = (d) => readdirSync(d).flatMap((n) => { const f = join(d, n); return statSync(f).isDirectory() ? walk(f) : /\.tsx?$/.test(n) ? [f] : []; });
    const inverted = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))].filter((f) => {
      const src = readFileSync(f, "utf8");
      return /rate_limit_hit/.test(src) && /\b(?:ipHit|allHit|ipFits|allFits|mine|all|under|underCap|rowFits|alertFits)\.data === true|\.data === true \|\|/.test(src);
    }).map((f) => f.replace(ROOT + "/", ""));
    ok("limits: no route reads rate_limit_hit's true as \"too many\" — true is under the cap", inverted.length === 0, inverted);
    // R10: asked in order through lib/rateLimit.limitsFit, which refuses on the first false (scripts/smoke.cjs runs it).
    ok("route: the check's limiter refuses on false, as the Pay path's does",
      /if \(!\(await limitsFit\(supabaseAdmin, \[\s+\{ bucket: `checkout-check:\$\{ip\}`, windowMs: 60_000, max: 10 \},\s+\{ bucket: "checkout-check:global", windowMs: 60_000, max: 120 \},\s+\]\)\)\) return NextResponse\.json\(\{ error: "Too many tries — give it a minute\.", pending: true \}, \{ status: 429 \}\);/.test(r));
    ok("route: a check that finds a paid order that didn't save tells the crew so — with the drinks and the name the page still holds",
      /const stoppedAlert = \(items: string\[\] \| null, customer: string \| null, checked: boolean\) => async \(\{ key, claim \}: Stopped\) => \{/.test(r)
      && /if \(claim\.card && claim\.state === "charged"\) \{\s+await raiseAlert\(\{ severity: "critical", category: "money", title: "Paid order may not have recorded — check the pass"/.test(r)
      && /const stopped = stoppedAlert\(items\.map\(String\), customer, false\);/.test(r));
  }
  const co = readFileSync(join(ROOT, "components/Checkout.tsx"), "utf8");
  ok("page: a send is held open as it leaves, and Check asks about the held key (R7b)",
    /idem\.sent\(attempt\.key, true\);/.test(co) && /idem\.sent\(attempt\.key, false\);/.test(co)
      && /body: JSON\.stringify\(\{ check: true, idempotencyKey: idem\.heldKey\(\), card, items, customer: customer \|\| undefined \}\)/.test(co)
      && /if \(data\?\.checked === true && data\.charged === false\) \{/.test(co)
      // R7b re-audit: a decline found by a check lets the key go; an answer about a key let go meanwhile changes nothing;
      // nothing sends and nothing lets go while a check is out; and only `ok: true` is an order placed.
      && /if \(data\?\.declined === true\) \{[\s\S]{0,400}idem\.settle\(key, res\.status, data\); setLetGo\(false\);/.test(co)
      && /if \(idem\.heldKey\(\) !== key\) return;/.test(co)
      && /if \(busy \|\| sending\.current \|\| checkingNow\.current\) return;/.test(co)
      && (co.match(/disabled=\{checking\}/g) || []).length >= 3
      && /if \(!res\.ok \|\| data\?\.ok !== true\) \{/.test(co) && /if \(!res\.ok \|\| data\?\.ok !== true\) \{ repriced\(data\);/.test(co)
      && /disabled=\{held \|\| !ready \|\| busy/.test(co));
}

// ── every branch ───────────────────────────────────────────────────────────────────────────────
// ── each channel's own words (R5, 2026-10-13) ─────────────────────────────────────────────────────────
// The pack, delivery and shop checkouts claim their keys too. A delivery or a shop order is not collected at a window, so
// a route hands its own "paid, not saved" and "couldn't confirm" (lib/chargeOnce Say); with none, the cups' words stand.
{
  const store = (claim) => ({ read: async () => ({ ok: true, claim }), claim: async () => ({ ok: true, claimed: false }), move: async () => true, release: async () => {} });
  const old = new Date(Date.now() - 10 * 60_000).toISOString();
  const charged = { state: "charged", card: true, amount_cents: 2200, payment_id: "pay-XYZ123", status: null, answer: null, note: null, updated_at: old };
  const say = { paidNotRecorded: (c) => ({ status: 200, body: { mine: "paid", ref: c.payment_id } }), couldNotConfirm: () => ({ status: 409, body: { mine: "unknown", pending: true } }) };
  const quiet = async () => {};
  const a1 = await C.answerFor(store(charged), "key-0001aaaa", charged, () => Date.now(), quiet, say);
  ok("words: a request that died after the charge answers in the channel's words", a1.body.mine === "paid" && a1.body.ref === "pay-XYZ123", a1);
  const a2 = await C.answerFor(store(charged), "key-0001aaaa", charged, () => Date.now(), quiet);
  ok("words: without its own, the cups' — show this ref at the window", /show this ref at the window/.test(String(a2.body.warn)), a2);
  const unknown = { ...charged, state: "unknown" };
  ok("words: 'couldn't confirm' in the channel's words", (await C.answerFor(store(unknown), "key-0002aaaa", unknown, () => Date.now(), quiet, say)).body.mine === "unknown");
  ok("words: without its own, the cups' 'couldn't confirm'", /show this at the window/.test(String((await C.answerFor(store(unknown), "key-0002aaaa", unknown, () => Date.now(), quiet)).body.error)));
  let told = 0;
  const started = { ...charged, state: "started", payment_id: null };
  const a5 = await C.answerFor(store(started), "key-0003aaaa", started, () => Date.now(), async () => { told++; }, say);
  ok("words: a request that died before Square answered is 'couldn't confirm' in the channel's words, and the crew is told once", a5.body.mine === "unknown" && told === 1, a5);
  ok("words: seenBefore hands them on", (await C.seenBefore(store(unknown), "key-0004aaaa", true, () => Date.now(), quiet, say)).answer?.body.mine === "unknown");
  ok("words: claimKey hands them on", (await C.claimKey(store(unknown), "key-0005aaaa", { channel: "shop", card: true, amountCents: 100 }, () => Date.now(), quiet, say)).answer?.body.mine === "unknown");
}

// ── the pack, delivery and shop checkouts read the way the cups' does (R5) ────────────────────────────────────
// It was a bare 502 with nobody told when Square's answer was lost (packs, shop), or when a paid order failed to save
// after the charge (packs, shop: their catch-all said "service unavailable"). Each now asks its claim first, claims
// before the money, charges in one place inside chargeOnce, and answers in its own words.
{
  const code = (rel) => readFileSync(join(ROOT, rel), "utf8").split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
  for (const [rel, channel, priced] of [["app/api/reserve/route.ts", "packs", "offeredDays("], ["app/api/delivery/checkout/route.ts", "delivery", "zipInZone(zip)"], ["app/api/shop/checkout/route.ts", "shop", ".from(\"shop_products\")"]]) {
    const r = code(rel), at = (s, from = 0) => r.indexOf(s, from);
    const label = rel.replace("app/api/", "").replace("/route.ts", "");
    ok(`${label}: the replay comes before the order is checked or priced again`, at("seenBefore(checkoutClaims(supabaseAdmin), idemKey, ") > 0 && at("seenBefore(") < at(priced), [at("seenBefore("), at(priced)]);
    ok(`${label}: one claim, as "${channel}", after every check and before the money`, (r.match(/claimKey\(/g) || []).length === 1 && new RegExp(`claimKey\\(seen\\.claims, idemKey, \\{ channel: "${channel}", `).test(r) && at("claimKey(") < at("chargeOnce("));
    ok(`${label}: Square is called in one place, inside chargeOnce`, (r.match(/chargeCard\(/g) || []).length === 1 && at("charge: () => chargeCard(") > at("chargeOnce("));
    ok(`${label}: no catch-all that calls a charged order a failure`, !/service unavailable/.test(r) && /unknown: async \(e\) => \{\s*await raiseAlert\(\{ severity: "critical", category: "money"/.test(r));
    ok(`${label}: its own words for "paid, not saved" and "couldn't confirm"`, /const say: Say = \{\s*paidNotRecorded:/.test(r) && /couldNotConfirm: /.test(r) && /stopped, say\)/.test(r));
  }
  const rs = code("app/api/reserve/route.ts");
  ok("reserve: pay at pickup — or a pack on us, never sent to Square — is written under its claim, and a pack not written gives the key back (placeOnce)",
    /if \(!charging\) return reply\(await placeOnce\(\{ claims: held\.claims, key: idemKey, now, place: \(\) => recordPack\(null, false\) \}\)\);/.test(rs)
    && /const charging = wantsCharge && !free;/.test(rs) && /card: charging, amountCents: amount/.test(rs));
  for (const rel of ["app/api/delivery/checkout/route.ts", "app/api/shop/checkout/route.ts"]) {
    const sayBlock = (code(rel).match(/const say: Say = \{[\s\S]*?\n  \};/) || [""])[0];
    ok(`${rel.replace("app/api/", "").replace("/route.ts", "")}: nothing it says sends anyone to a window`, sayBlock.length > 0 && !/window/i.test(sayBlock), sayBlock.slice(0, 120));
  }
}

await branches({ C, SQ, I, store: memoryClaims(), ok, memory: true });
globalThis.fetch = realFetch;

console.log(`ONE CHARGE PER CHECKOUT (lib/chargeOnce, mocked Square and claims): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
