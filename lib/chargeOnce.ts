// ONE CHARGE PER CHECKOUT (0371, 2026-10-11) — the key a cup checkout is claimed under before Square
// is asked for money.
//
// ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────────────────
// The idempotency key is what stops Square charging a card twice for one checkout: the same key again
// and Square replays the first result. But the cup checkout asked the card form for a NEW token on
// every tap of Pay and derived the key from that token, so a retry after a lost answer (the request
// reached Square, the answer never reached the phone) went out under a new key — a request Square had
// never seen — and the card was charged again. Pay at pickup sent no key at all, so a retry after
// "we're offline" put a second unpaid order on the pass.
//
// ── WHAT THIS IS ───────────────────────────────────────────────────────────────────────────────
// The page keeps ONE key per checkout (components/useIdemKey). /api/checkout claims it here — one row
// in public.checkout_claims, unique on the key (lib/checkoutClaims) — after the order has passed every
// check and BEFORE Square is called. A request whose key is already claimed never reaches Square:
//
//   done      it gets the first request's own answer again, word for word — "order in", "declined",
//             "paid, and the crew is adding your order";
//   started   (Square is being asked) or charged (the order is being written): "still confirming";
//   unknown   (Square's answer never came, or did not say): "we couldn't confirm it — the crew has
//             been told", and nothing more, ever, under that key.
//
// A claim left in started or charged for longer than any request lives belonged to a request that
// died (a timeout, a crash) before it could answer or tell anybody. The first retry after that moves
// it on — once, by a conditional write — and is the one that tells the crew.
//
// Pay at pickup claims the same way, so a retry is given the first order's answer instead of making
// a second order. Its claim is released when the insert fails: nothing was placed under the key.
//
// ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────────────────────────
// It never asks Square again under a claimed key — not even the identical request Square documents
// as safe to replay. So an unknown outcome stays "we couldn't confirm" until a person settles it: the
// alert names the key, and the payment carries it as its reference_id (lib/squareServer.chargeCard).
// Settling it automatically means reading Square's payments over a time window and matching that
// reference_id (ListPayments cannot filter on it). Not built here.
//
// No clock but the one handed in, no database but the ClaimStore handed in, no Square but the charge
// handed in: scripts/chargeonce.test.mjs drives every branch against a mocked Square and a mocked
// store, and scripts/db.chargeonce.test.mjs drives them against 0371 itself in a real Postgres.

import { errorMessage } from "./errorMessage";

/** How long a claim may sit in "started" or "charged" before its request is taken to have died. */
export const IN_FLIGHT_MS = 120_000;

export type ClaimState = "started" | "charged" | "done" | "unknown";

/** One claimed key, as the store reads it back. */
export type Claim = {
  state: ClaimState;
  card: boolean;
  amount_cents: number | null;
  payment_id: string | null;
  status: number | null;
  answer: Record<string, unknown> | null;
  /** Why it moved where it did, when that is not the answer: Square's words, or "its request stopped". */
  note: string | null;
  updated_at: string;
};

/** What the route says — and says again, word for word, to every retry of the same key. */
export type Answer = { status: number; body: Record<string, unknown> };

/** A store call that could not be made: the table is not there yet (0371 unpasted), or it failed. */
export type StoreFailure = { ok: false; missing: boolean; error: string };

export type ClaimRow = { channel: string; card: boolean; amountCents: number };
export type ClaimMove = { state: ClaimState; paymentId?: string | null; answer?: Answer; note?: string };

/** public.checkout_claims (lib/checkoutClaims), or a test's stand-in with the same rules. */
export type ClaimStore = {
  read(key: string): Promise<{ ok: true; claim: Claim | null } | StoreFailure>;
  /** Insert the claim. claimed: false — the unique key says somebody holds it already. */
  claim(key: string, row: ClaimRow, at: string): Promise<{ ok: true; claimed: boolean } | StoreFailure>;
  /**
   * Move a claim on. With `from`, only while it is still exactly as it was read (its state and its
   * updated_at) — so two retries cannot both move it. True when this call moved it.
   */
  move(key: string, to: ClaimMove, at: string, from?: Pick<Claim, "state" | "updated_at">): Promise<boolean>;
  /** Give the key back: nothing was done under it. Only a claim still 'started' goes. */
  release(key: string): Promise<void>;
};

export type ChargeResult = { ok: true; paymentId: string | null } | { ok: false; error: string };

/** A claim whose request died, for the route to tell the crew about — once, from the retry that found it. */
export type Stopped = { key: string; claim: Claim };

const iso = (ms: number) => new Date(ms).toISOString();

// ── what a customer is told ──────────────────────────────────────────────────────────────────────
// `pending: true` is the page's cue (lib/idempotency.attemptVerdict) to keep this key and this card
// token: the next tap asks again about the same checkout instead of starting a new one.

/** The first request with this key is still going. */
export function stillConfirming(card: boolean): Answer {
  return { status: 409, body: { pending: true, error: card
    ? "Still confirming your payment — give it a few seconds, then tap Pay to check. You won't be charged twice."
    : "Still sending your order — give it a few seconds, then tap again to check." } };
}

/** This key's charge has no answer, and never will from here. The crew has been told. */
export function couldNotConfirm(card: boolean): Answer {
  return { status: 409, body: { pending: true, error: card
    ? "We couldn't confirm your payment, and the crew has been told. Don't pay again — show this at the window and they'll check it."
    : "We couldn't confirm your order went in, and the crew has been told. Check with them at the window before ordering again." } };
}

/** The claim could not be read or written, so nothing is charged or placed. Safe to tap again. */
export function cannotStart(card: boolean): Answer {
  return { status: 503, body: { error: card
    ? "We couldn't start the payment — nothing was charged. Give it another tap in a moment."
    : "That didn't go through — give it another tap" } };
}

/** Square refused the card. A definitive no: the page starts over with a new key. */
export function declined(error: string): Answer {
  return { status: 400, body: { error, declined: true } };
}

/**
 * What a channel says when Square took the money and the order was not written. The cups say it at the window (the
 * default below); a delivery or a shop order is not collected at a window, so its route says its own (R5, 2026-10-13:
 * the pack, delivery and shop checkouts claim their keys too).
 */
export type Say = {
  paidNotRecorded?: (claim: Pick<Claim, "payment_id" | "amount_cents">) => Answer;
  /** "We couldn't confirm" in the channel's words — the cups send the customer to the window. */
  couldNotConfirm?: (card: boolean) => Answer;
};

/** Square took the money and the request that took it stopped before the order was written. */
export function paidNotRecorded(claim: Pick<Claim, "payment_id" | "amount_cents">): Answer {
  const ref = (claim.payment_id || "").slice(-6).toUpperCase();
  return { status: 200, body: {
    ok: true, paid: true, paymentId: claim.payment_id, amount: claim.amount_cents, recorded: false, ref,
    warn: `Payment received${ref ? ` — ref ${ref}` : ""}. We've alerted the crew to add your order; show this ref at the window.`,
  } };
}

// ── the decisions ───────────────────────────────────────────────────────────────────────────────

/** What to say to a request carrying a key that has been claimed. Moves a dead request's claim on. */
export async function answerFor(
  store: ClaimStore, key: string, claim: Claim, now: () => number, stopped: (s: Stopped) => Promise<void>, say: Say = {},
): Promise<Answer> {
  if (claim.state === "done" && claim.answer && typeof claim.status === "number") return { status: claim.status, body: claim.answer };
  if (claim.state === "unknown" || claim.state === "done") return (say.couldNotConfirm ?? couldNotConfirm)(claim.card);
  const age = now() - Date.parse(claim.updated_at);
  if (!(age > IN_FLIGHT_MS)) return stillConfirming(claim.card);

  // Its request died before it answered. Charged: the money is Square's record, the order may not be
  // written — answer as the request would have, and keep that answer for the next retry. Started: it
  // died while Square was being asked, so nobody knows; it is unknown from here on.
  if (claim.state === "charged") {
    const answer = (say.paidNotRecorded ?? paidNotRecorded)(claim);
    const moved = await store.move(key, { state: "done", answer, paymentId: claim.payment_id, note: "its request stopped after the charge" }, iso(now()), claim);
    if (!moved) return stillConfirming(claim.card);
    await stopped({ key, claim });
    return answer;
  }
  const moved = await store.move(key, { state: "unknown", note: "its request stopped before Square answered" }, iso(now()), claim);
  if (moved) await stopped({ key, claim });
  return (say.couldNotConfirm ?? couldNotConfirm)(claim.card);
}

/**
 * Asked first, before the truck's hours or the stock: has this key been here? A retry of an order
 * that went in must hear "order in", not "sold out" or "closed" because the world moved on while the
 * first answer was lost.
 *
 * `{ claims: null }` — 0371 is not pasted yet: the checkout runs without claims, as it did before.
 */
export async function seenBefore(
  store: ClaimStore, key: string, card: boolean, now: () => number, stopped: (s: Stopped) => Promise<void>, say: Say = {},
): Promise<{ answer: Answer } | { claims: ClaimStore | null }> {
  const r = await store.read(key);
  if (!r.ok) return r.missing ? { claims: null } : { answer: cannotStart(card) };
  if (!r.claim) return { claims: store };
  return { answer: await answerFor(store, key, r.claim, now, stopped, say) };
}

/** Claim the key — the last step before the money. The unique key decides between two taps. */
export async function claimKey(
  claims: ClaimStore | null, key: string, row: ClaimRow, now: () => number, stopped: (s: Stopped) => Promise<void>, say: Say = {},
): Promise<{ answer: Answer } | { claims: ClaimStore | null }> {
  if (!claims) return { claims: null };
  const c = await claims.claim(key, row, iso(now()));
  if (!c.ok) return c.missing ? { claims: null } : { answer: cannotStart(row.card) };
  if (c.claimed) return { claims };
  // Somebody holds it: the other tap of a double tap, most likely. Say what it would say.
  const r = await claims.read(key);
  if (!r.ok || !r.claim) return { answer: stillConfirming(row.card) };
  return { answer: await answerFor(claims, key, r.claim, now, stopped, say) };
}

/**
 * Charge a claimed key, once. `charge` THROWS when Square's answer does not say whether the card was
 * charged (lib/squareServer); `record` writes the order and answers, and does not throw; `unknown`
 * tells the crew and answers the page. With no claims (0371 not pasted) the same steps run unrecorded.
 * `record` is handed the charge's own answer beside its payment id — what else Square said about it (the
 * card it was paid with, for the receipt: R3b, 0395) — so nothing outside reaches into the charge for it.
 */
export async function chargeOnce<R extends ChargeResult = ChargeResult>(o: {
  claims: ClaimStore | null; key: string; now: () => number;
  charge: () => Promise<R>;
  record: (paymentId: string | null, charged: Extract<R, { ok: true }>) => Promise<Answer>;
  unknown: (e: unknown) => Promise<Answer>;
}): Promise<Answer> {
  let result: R;
  try {
    result = await o.charge();
  } catch (e) {
    await o.claims?.move(o.key, { state: "unknown", note: errorMessage(e, 300) }, iso(o.now()));
    return o.unknown(e);
  }
  const said: ChargeResult = result;
  if (!said.ok) {
    const answer = declined(said.error);
    await o.claims?.move(o.key, { state: "done", answer }, iso(o.now()));
    return answer;
  }
  // The money is taken. Said BEFORE the order is written, so a request that dies writing it leaves a
  // claim that says "paid" — and the retry that finds it answers paid, not "we couldn't confirm".
  await o.claims?.move(o.key, { state: "charged", paymentId: said.paymentId }, iso(o.now()));
  const answer = await o.record(said.paymentId, result as Extract<R, { ok: true }>);
  await o.claims?.move(o.key, { state: "done", answer, paymentId: said.paymentId }, iso(o.now()));
  return answer;
}

/** Place a pay-at-pickup order under a claimed key, once. A refused insert gives the key back. */
export async function placeOnce(o: {
  claims: ClaimStore | null; key: string; now: () => number;
  place: () => Promise<Answer>;
}): Promise<Answer> {
  const answer = await o.place();
  if (!o.claims) return answer;
  if (answer.status >= 200 && answer.status < 300) await o.claims.move(o.key, { state: "done", answer }, iso(o.now()));
  else await o.claims.release(o.key);
  return answer;
}
