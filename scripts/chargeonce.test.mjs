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
import { libLoader, fakeSquare, memoryClaims, branches } from "./fixtures/chargeonce.mjs";

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
  ok("chargeCard: a decline is returned, with Square's words", d.ok === false && d.error === "Card declined.", d);
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

// ── the route still reads the way the suite drives it ────────────────────────────────────────────
// scripts/fixtures/chargeonce.mjs's cupsRoute is /api/checkout's money path in the route's order. These hold
// the route to that order, so the branches below are about the route and not about a story told of it.
{
  const code = (rel) => readFileSync(join(ROOT, rel), "utf8").split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
  const r = code("app/api/checkout/route.ts");
  const at = (s, from = 0) => r.indexOf(s, from);
  ok("route: the replay comes before the limiter, the stock and the truck's hours",
    at("seenBefore(") > 0 && at("seenBefore(") < at("rate_limit_hit") && at("seenBefore(") < at('.from("products")') && at("seenBefore(") < at("readOrdering("));
  const firstClaim = at("claimKey("), secondClaim = at("claimKey(", firstClaim + 1);
  ok("route: both claims come after every check and before the money",
    firstClaim > at("orderingNow(") && firstClaim > at("pay_at_pickup") && secondClaim > firstClaim && firstClaim < at("placeOnce(") && secondClaim < at("chargeOnce(") && at("claimKey(", secondClaim + 1) === -1);
  ok("route: pay at pickup's insert is placed under its claim", at("placeOnce(") < at("await insertOrder(orderRow)") && at("await insertOrder(orderRow)") < secondClaim);
  ok("route: Square is called in one place, inside chargeOnce", (r.match(/chargeCard\(/g) || []).length === 1 && /charge: \(\) => chargeCard\(/.test(r) && at("charge: () => chargeCard(") > at("chargeOnce("));
  ok("route: the store it claims in is the table's (lib/checkoutClaims), and the route says how it survives the table not being there yet",
    /seenBefore\(checkoutClaims\(supabaseAdmin\), idemKey, paying, now, stopped\)/.test(r) && /\/\/ arrives-with: 0371/.test(readFileSync(join(ROOT, "app/api/checkout/route.ts"), "utf8")));
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
    && /useIdemKey\("gt3-co-idem"\)/.test(co) && !/\.tokenize\(\)(?![^\n]*idem\.begin)/.test(co.replace(/idem\.begin\([^\n]*\.tokenize\(\)\)/g, "")));
  ok("page: Pay asks the card form for a token only through the key holder",
    /const attempt = await idem\.begin\(\{ items, tipCents \}, \(\) => paymentRef\.current!\.tokenize\(\)\);/.test(co));
}

// ── every branch ───────────────────────────────────────────────────────────────────────────────
await branches({ C, SQ, I, store: memoryClaims(), ok, memory: true });
globalThis.fetch = realFetch;

console.log(`ONE CHARGE PER CHECKOUT (lib/chargeOnce, mocked Square and claims): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
