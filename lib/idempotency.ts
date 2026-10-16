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
// ── WHAT THAT FIX COST, AND WHY THE CARD CHECKOUTS NO LONGER USE IT (2026-10-11) ───────────────
// This section used to say the ambiguous case — request sent, answer lost, customer taps again —
// "replays the SAME nonce, because no new tokenize() happened". It did not. Every tap of Pay called
// tokenize() (Checkout, OrderFunnel, ShopCheckout), so the retry carried a new nonce, therefore a new
// key, and Square — which dedupes only a key it has seen — charged the card a second time. Signing
// the nonce traded a permanent wall for a double charge.
//
// The card checkouts now hold ONE KEY PER CHECKOUT (attemptFor, below, through components/useIdemKey):
// signed over what is being bought and nothing about the card, kept for as long as the outcome is
// open, and sent with the SAME card token again while it is. A key changes only when the cart or
// the amount does, or once the checkout is settled — paid, or refused by Square. The wall cannot
// come back: after a decline the key is settled, so a new card goes out under a new key. And the cup
// checkout's server claims the key before it calls Square (lib/chargeOnce), so a retry that has to
// carry a new token — a reload drops it — is answered from the first request instead of charged.
//
// nextIdem/idemSignature stay as they were for the office sheets, whose "nonce" is a company or an
// order id: a stable scope, which is what this pair was always right for.

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

// ── ONE KEY PER CHECKOUT (2026-10-11) ──────────────────────────────────────────────────────────
// What a card checkout holds between taps: the key, what it was signed over, and the card token
// already sent under it. The token is kept in memory only (components/useIdemKey persists sig and
// key, never a card token), so it is null after a reload — which the cup checkout's server answers
// from its claim, and which Square refuses rather than charges anywhere else.

/** What one checkout holds between taps of Pay. */
export type PayAttempt = { sig: string; key: string; token: string | null };

export const NO_ATTEMPT: PayAttempt = { sig: "", key: "", token: null };

/**
 * The attempt for these details. The same cart and amount keep the same key — and the token
 * already sent under it — whatever happened to the card in between. Anything else is a new
 * checkout: a fresh key, and no token, so the card form is asked for one.
 *
 * `details` is what is being bought and what it costs, nothing about who or where: a name fixed
 * after a lost answer is the same checkout, and a new key there would be a second charge.
 *
 * `was` (2026-10-15, R7): what the same checkout was signed as before its signature changed shape. A key held
 * under one of those is the same checkout — kept, with its token, and signed anew — so a page that changed what
 * it signs never mints a second key for a payment whose answer it is still waiting on.
 */
export function attemptFor(
  prev: PayAttempt | null | undefined,
  details: unknown,
  mint: () => string = () => globalThis.crypto.randomUUID(),
  was: readonly unknown[] = [],
): PayAttempt {
  const sig = idemSignature(null, details);
  if (prev && prev.sig === sig && prev.key) return prev;
  if (prev && prev.key && was.some((d) => idemSignature(null, d) === prev.sig)) return { ...prev, sig };
  return { sig, key: mint(), token: null };
}

/**
 * What one answer says about the checkout's money.
 *
 *   settled  it is over: paid (2xx), or Square refused the card (`declined: true`). The next tap
 *            is a new checkout — a new key, and a new token from the card form.
 *   unknown  it may have been charged: no answer at all, a 5xx, or the server saying the first try
 *            is still being confirmed (`pending: true`). Same key, same token, until it settles.
 *   refused  turned away before any card was charged (sold out, closed, a name missing, too many
 *            tries). Same key — nothing was claimed or charged under it — and a fresh token, so a
 *            card that was changed meanwhile is the one sent.
 */
export type AttemptVerdict = "settled" | "unknown" | "refused";

export function attemptVerdict(status: number | null | undefined, body: unknown): AttemptVerdict {
  const b = (body && typeof body === "object" ? body : {}) as { pending?: unknown; declined?: unknown; charged?: unknown };
  if (typeof status !== "number" || !Number.isFinite(status)) return "unknown";
  if (b.pending === true) return "unknown";
  if (status >= 200 && status < 300) return "settled";
  if (b.declined === true) return "settled";
  // A server error that says nothing was charged (R7b: refused before the claim — the menu, the truck's hours, the claims
  // store unread) is a refusal, not a lost answer: nothing is held for it. Any other 5xx may have charged: it is unknown.
  if (b.charged === false) return "refused";
  if (status >= 500) return "unknown";
  return "refused";
}

/** The attempt after an answer: forgotten, kept whole, or kept without its token. */
export function afterAttempt(a: PayAttempt, verdict: AttemptVerdict): PayAttempt {
  if (verdict === "settled") return NO_ATTEMPT;
  if (verdict === "refused") return a.token === null ? a : { ...a, token: null };
  return a;
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
  // Square's decline codes all say "declin…" — CARD_DECLINED, its _CALL_ISSUER and _VERIFICATION_REQUIRED, GENERIC_DECLINE (R7b:
  // "Authorization error: 'GENERIC_DECLINE'" was passed through to the page as it came).
  if (/CARD_DECLINED|declin/i.test(s)) {
    return "Your card was declined — nothing was charged. Try another card.";
  }
  if (/CVV|cvv_failure/i.test(s)) return "The security code didn't match — check it and try again.";
  if (/ADDRESS_VERIFICATION|postal/i.test(s)) return "The billing ZIP didn't match your card — check it and try again.";
  if (/INSUFFICIENT_FUNDS/i.test(s)) return "The card came back with insufficient funds — nothing was charged.";
  if (/EXPIRATION|expired card/i.test(s)) return "That card has expired — try another one.";
  return s;
}
