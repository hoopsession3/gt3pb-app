// THE IDEMPOTENCY KEY FOR A CARD CHARGE — one home, because three of four payment paths had it wrong.
//
// ── WHAT SQUARE ACTUALLY PROMISES ──────────────────────────────────────────────────────────────
// An idempotency key means "this is the same request as before". Send the same key with the same
// parameters and Square replays the first result instead of charging twice — which is the whole
// point, and why a key must be STABLE across a resubmit. Send the same key with DIFFERENT
// parameters and Square refuses the request outright:
//
//     Different request parameters used for the same idempotency_key: dcbb7295-…
//
// ── THE TRAP ───────────────────────────────────────────────────────────────────────────────────
// The card nonce is one of those parameters, and a nonce is SINGLE USE. Every tap of Pay calls
// tokenize() and gets a fresh one. So if the key is derived only from the order — items, address,
// total — then:
//
//     tap Pay  →  nonce A, key K  →  fails for any reason at all
//     fix it, tap Pay again  →  nonce B, key K  →  REFUSED, and refused forever
//
// The customer is now permanently stuck. Not declined — stuck. Nothing they can do on that screen
// works, because the only thing that would mint a new key is changing the order they already want.
//
// Ryan hit this live on 2026-07-30 in the drinks checkout. It was fixed there, and the reasoning
// was written down — as a comment, in that component. components/Shop.tsx was written afterwards
// with `useMemo(newKey, [cart])`, and both OrderFunnel paths signed everything about the order and
// nothing about the nonce. Three of the four payment paths in this app carried the same defect the
// comment describes, and the cap order Ryan tried to place on 2026-09-29 hit the wall.
//
// So the nonce is not something a caller passes inside a details blob and may forget. It is a
// REQUIRED, SEPARATE ARGUMENT. There is no way to call this and leave it out.
//
// ── WHAT STILL DEDUPES ─────────────────────────────────────────────────────────────────────────
// The ambiguous case — request sent, answer lost, customer taps again — replays the SAME nonce,
// because no new tokenize() happened. So the signature holds still, the key holds still, and
// Square replays rather than double-charging. The protection is intact; only the permanent wall
// is gone.

/** What a caller holds between attempts. Persist it or keep it in a ref — both are fine. */
export type IdemState = { sig: string; key: string };

export const EMPTY_IDEM: IdemState = { sig: "", key: "" };

/**
 * The signature of one payment attempt.
 *
 * `sourceId` is first and required so it cannot be omitted the way it was omitted three times.
 * A null/absent nonce is signed as the literal "none" rather than dropped, so a pay-later path
 * that has no card still gets a signature that changes when the order does.
 */
export function idemSignature(sourceId: string | null | undefined, details: unknown): string {
  const nonce = typeof sourceId === "string" && sourceId ? sourceId : "none";
  let body: string;
  try {
    body = JSON.stringify(details ?? null);
  } catch {
    // A details object with a cycle in it must not take down a checkout. An unserialisable
    // signature is treated as "something I cannot compare", which mints a fresh key — safe in the
    // direction that matters: a new key can never be refused, it can only miss a dedupe.
    body = `unserialisable:${Math.random()}`;
  }
  return `${nonce}\u0000${body}`;
}

/**
 * The next state for an attempt. Same signature → the same key, so a resubmit dedupes. Different
 * signature → a fresh key, so Square is never asked to accept new parameters under an old key.
 *
 * `mint` is injectable only so the tests can be deterministic; every caller uses the default.
 */
export function nextIdem(
  prev: IdemState | null | undefined,
  sourceId: string | null | undefined,
  details: unknown,
  mint: () => string = () => globalThis.crypto.randomUUID(),
): IdemState {
  const sig = idemSignature(sourceId, details);
  if (prev && prev.sig === sig && prev.key) return prev;
  return { sig, key: mint() };
}

/**
 * Square's own words, turned into something a customer can act on.
 *
 * The cap checkout printed `Different request parameters used for the same idempotency_key:
 * dcbb7295-d47f-40f3-9a1f-3d44366c5e35.` onto the page, above the Pay button, in a shop. That is a
 * developer's string. It tells the buyer nothing they can do and reads like the site is broken.
 *
 * Unrecognised text is passed through rather than replaced by a vague apology — an operator
 * reading a support email needs the real message, and inventing a friendlier wrong one is worse
 * than a blunt right one.
 */
export function payErrorText(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "Payment failed — nothing was charged. Try again.";
  if (/idempotency_key/i.test(s)) {
    return "That attempt expired. Tap Pay again — you have not been charged.";
  }
  if (/CARD_DECLINED|declined/i.test(s)) {
    return "Your card was declined — nothing was charged. Try another card.";
  }
  if (/CVV|cvv_failure/i.test(s)) return "The security code didn't match — check it and try again.";
  if (/ADDRESS_VERIFICATION|postal/i.test(s)) return "The billing ZIP didn't match your card — check it and try again.";
  if (/INSUFFICIENT_FUNDS/i.test(s)) return "The card came back with insufficient funds — nothing was charged.";
  if (/EXPIRATION|expired card/i.test(s)) return "That card has expired — try another one.";
  return s;
}
