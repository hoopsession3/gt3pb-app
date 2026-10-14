import { chargeOnce, claimKey, declined, placeOnce, seenBefore, IN_FLIGHT_MS, type Answer, type ChargeResult, type Claim, type ClaimStore, type Say, type Stopped } from "./chargeOnce";
import { REFERENCE_MAX } from "./squareServer";
import { aboveShown, shownCents } from "./shownTotal";
import { money } from "./money";
import { errorMessage } from "./errorMessage";
import { closesWords } from "./pickupDay";
import { reserveClosesAt, reserveOpen, reservePickupWords, type ReserveStop } from "./reservePickup";

// A LIMITED RESERVE IS PAID TO HOLD (0400, 2026-10-14 — R5 of the customer audit; decided 2026-10-13: charged like
// packs, no timer, a full refund on a cancel before the cutoff).
//
// ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────────────────────────────────────
// A reserve was a hold: a tap took a bottle off the shelf for 48 hours and the member paid at the truck. Nothing said
// where or when to come, the hold ran out on its own clock, and on the day the crew had no list of who was owed one.
//
// ── WHAT THIS IS ───────────────────────────────────────────────────────────────────────────────────────────────────
// The money path of /api/reserves/pay, /api/reserves/cancel and /api/reserves/settle, with nothing in it but the
// decisions: the database is ReserveSteps (lib/reserveSteps: hold_reserve, settle_reserve, release_reserve), the
// checkout key is lib/chargeOnce's ClaimStore, Square is the `charge` and `refund` handed in, and the people told are
// Tell. scripts/reservepay.test.mjs drives every branch against a mocked Square and mocked steps;
// scripts/db.reservepaid.test.mjs drives 0400 itself.
//
// PAY, in this order — the pack checkout's (app/api/reserve):
//   1. a claim already paid under this key is this checkout, paid: said again, before anything is asked;
//   2. a key the checkout claims have seen gets its first request's answer (lib/chargeOnce.seenBefore);
//   3. the reserve's checks — how many, on offer, its pickup set, not called off, not closed, the total no more than
//      the page showed, a card when there is something to pay;
//   4. the key is claimed (lib/chargeOnce.claimKey) — the last step before the bottles and the money;
//   5. the bottles come off the shelf as a pending claim (hold_reserve) — refused: the key is given back;
//   6. the card is charged once (lib/chargeOnce.chargeOnce): declined, the bottles go back; charged, the claim is paid
//      and the member and the crew are told; no answer, the claim stays pending — the crew settle it by hand
//      (/api/reserves/settle) with Square's payment in front of them.
// A reserve that costs nothing is placed instead of charged (lib/chargeOnce.placeOnce).
//
// CANCEL: the member's own, until the pickup closes (24 hours before the stop; any time when it was called off); an
// owner's or an admin's, any time. The money goes back to the card first, under a key of the claim's own — refused or
// unknown, the claim stands and the crew are told — then the bottles go back on the shelf.

export const MAX_QTY = 12;
/** Where the crew see a reserve's claims (app/crew, Money → Reserve drops). */
export const RESERVES_LINK = "/crew?s=money&a=resv";
/**
 * Square's refund for a canceled claim: the claim (its id, dashes dropped) and what it had refunded before this one. A
 * cancel sent twice asks again under the same key, so Square refunds it once. A cancel after a part refund made in
 * Square asks for the rest under a new key — the old key with a new amount is a request Square refuses
 * (IDEMPOTENCY_KEY_REUSED), and the claim would stand unrefunded for good. 45 characters at most, Square's limit:
 * "rsvx-" and 32 and "-" leave seven digits — $99,999.99 refunded.
 */
export const refundKey = (claimId: string, refundedCents: number): string =>
  `rsvx-${claimId.replace(/-/g, "")}-${Math.max(0, Math.round(refundedCents || 0))}`.slice(0, 45);
export const REFUND_REASON = "Limited Reserve canceled";

export type ClaimState = "held" | "pending" | "paid" | "collected" | "expired" | "cancelled";

/** A reserve as the pay route reads it, with its pickup. No `stop_id` key at all: 0400 is not pasted yet. */
export type ReserveForPay = {
  id: string; name: string; price_cents: number; status: string; stock_remaining: number;
  stop_id?: string | null; stop?: ReserveStop;
};

/** One claim, as lib/reserveSteps reads it — with its reserve, its pickup, and when that closes (0400 reserve_closes_at). */
export type ReserveClaimRow = {
  id: string; reserve_id: string; user_id: string | null; qty: number; state: ClaimState;
  idempotency_key: string | null; payment_id: string | null; paid_cents: number | null; refunded_cents: number;
  created_at?: string | null;
  reserve?: { name: string; stop?: ReserveStop } | null;
  closes_at?: string | null;
};

export type Held =
  | { ok: true; id: string; qty: number; amountCents: number; again: boolean; state: ClaimState }
  | { ok: false; answer: Answer };
export type Done = { ok: true } | { ok: false; error: string };

/** The database, as these decisions need it (lib/reserveSteps; a test's stand-in with the same rules). */
export type ReserveSteps = {
  /** The claim made under this checkout key for this member, if any. */
  paidUnder(key: string, userId: string): Promise<ReserveClaimRow | null>;
  /** hold_reserve: the bottles off the shelf, as a pending claim under the key. A refusal is an answer. */
  hold(o: { userId: string; reserveId: string; qty: number; key: string }): Promise<Held>;
  /** settle_reserve: pending → paid. */
  settle(claimId: string, paymentId: string | null, paidCents: number): Promise<Done>;
  /** release_reserve: pending or paid → cancelled, the bottles back; `refundedCents` is the claim's refunds in all. */
  release(claimId: string, reason: string, refundedCents: number): Promise<Done>;
  /** One claim. Throws when it cannot be read (null: there is no such claim). */
  claim(claimId: string): Promise<ReserveClaimRow | null>;
};

export type CrewLine = {
  severity: "critical" | "important" | "fyi"; category: "money" | "order"; kind?: string;
  title: string; body: string; subjectId?: string; link?: string;
};
/** Who is told: the crew (an alert), the member (their email; a text where they said yes — lib/notify). Best-effort. */
export type Tell = {
  crew(a: CrewLine): Promise<void>;
  customer(c: { userId: string | null; subject: string; message: string }): Promise<void>;
};

export type RefundResult = { ok: true; refundId: string | null; status: string } | { ok: false; error: string };

const refuse = (status: number, error: string, extra: Record<string, unknown> = {}): Answer => ({ status, body: { error, ...extra } });
const refOf = (paymentId: string | null | undefined) => (paymentId || "").slice(-6).toUpperCase();
const what = (qty: number, name: string) => `${qty > 1 ? `${qty} × ` : ""}${name}`;

/** "Paid, not saved" and "couldn't confirm", in a reserve's words: it is handed over at its pickup, so that is where. */
export const reserveSay: Say = {
  paidNotRecorded: (c) => {
    const ref = refOf(c.payment_id);
    return { status: 200, body: { ok: true, paid: true, recorded: false, ref, totalCents: c.amount_cents,
      warn: `Paid${ref ? ` — ref ${ref}` : ""}. We've told the crew to mark your reserve paid — it's yours. Show this at pickup.` } };
  },
  couldNotConfirm: (card) => ({ status: 409, body: { pending: true, error: card
    ? "We couldn't confirm your payment, and the crew has been told. Don't pay again — check back in a few minutes, or show this at pickup."
    : "We couldn't confirm your reserve went in, and the crew has been told. Check back in a few minutes before reserving again." } }),
};

/** What a paid claim says, to the checkout that paid for it and to every retry of it. */
function paidAnswer(c: Pick<ReserveClaimRow, "id" | "qty" | "paid_cents">): Answer {
  return { status: 200, body: { ok: true, paid: true, recorded: true, id: c.id, qty: c.qty, totalCents: c.paid_cents ?? 0 } };
}

// ── PAY ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function payReserve(o: {
  steps: ReserveSteps; claims: ClaimStore; tell: Tell; now: () => number;
  userId: string;
  /** Who, for the crew: the member's name or email (the route reads it). */
  who: string;
  key: string;
  /** The reserve, with its pickup — null when there is no such reserve. */
  reserve: ReserveForPay | null;
  qty: unknown; expectedCents: unknown;
  /** The card token; null when nothing is to be charged (or none was sent). */
  sourceId: string | null;
  /** Charge the card: lib/squareServer.chargeCard under this checkout's key. Throws when Square's answer does not say. */
  charge: (amountCents: number, note: string) => Promise<ChargeResult>;
}): Promise<Answer> {
  const { steps, tell, now } = o;

  // 1 · Paid under this key already: this checkout, paid. Said before the reserve is asked again — a retry after a lost
  //     answer must hear "yours", not "sold out" because its own bottles left the shelf.
  const prior = await steps.paidUnder(o.key, o.userId).catch(() => null);
  if (prior && (prior.state === "paid" || prior.state === "collected")) return paidAnswer(prior);

  // 2 · A key the checkout claims have seen.
  const stopped = async ({ key, claim }: Stopped) => {
    if (claim.card && claim.state === "charged") {
      await tell.crew({ severity: "critical", category: "money", kind: "ops_incident", link: RESERVES_LINK,
        title: "Paid reserve may not have recorded — check the claims",
        body: `A card payment went through (${claim.payment_id ?? "no payment id"}, ${money(claim.amount_cents ?? 0)}) and the reserve checkout stopped before its claim was marked paid (${o.who}). Mark it paid, or refund it.` });
    } else if (claim.card) {
      await tell.crew({ severity: "critical", category: "money", kind: "ops_incident", link: RESERVES_LINK,
        title: "Reserve charge status unknown — check Square",
        body: `A reserve checkout stopped while Square was being asked to charge ${money(claim.amount_cents ?? 0)} (${o.who}). A payment, if there is one, carries the reference ${key}.` });
    } else {
      await tell.crew({ severity: "important", category: "order", kind: "ops_incident", link: RESERVES_LINK,
        title: "A reserve may not have saved — check the claims",
        body: `A reserve that cost nothing stopped while it was being saved (${o.who}). Check the reserve's claims for it.` });
    }
  };
  const seen = await seenBefore(o.claims, o.key, !!o.sourceId, now, stopped, reserveSay);
  if ("answer" in seen) return seen.answer;

  // 3 · The reserve's checks.
  const qty = Number(o.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return refuse(400, `Pick how many — between 1 and ${MAX_QTY}.`);
  const r = o.reserve;
  if (r && !("stop_id" in r)) return refuse(503, "Reserving with a card isn't switched on yet — check back shortly.", { off: true });
  if (!r || (r.status !== "live" && r.status !== "sold_out")) return refuse(404, "That reserve isn't on offer right now.", { gone: true });
  if (!r.stop_id || !r.stop) return refuse(409, "This reserve opens once its pickup is set — check back soon.");
  if (r.stop.canceled_at) return refuse(409, "Its pickup was called off — check back for the new one.");
  if (!reserveOpen(r.stop, now())) return refuse(409, "Reserves for that pickup have closed.");
  if (r.status === "sold_out" || r.stock_remaining <= 0) return refuse(409, "Sold out.", { soldOut: true });
  const shown = shownCents(o.expectedCents);
  const amount = qty * Math.max(0, Math.round(r.price_cents));
  const raised = aboveShown(amount, shown);
  if (raised) return { status: 409, body: raised };
  if (amount > 0 && !o.sourceId) return refuse(400, "Add a card to pay for it.");

  // 4 · The key — the last step before the bottles and the money.
  const claimed = await claimKey(seen.claims, o.key, { channel: "reserves", card: amount > 0, amountCents: amount }, now, stopped, reserveSay);
  if ("answer" in claimed) return claimed.answer;

  // 5 · The bottles, off the shelf as a pending claim. Refused (sold out in between, the member's limit, closed): the key
  //     is given back — nothing was taken under it.
  const hold = await steps.hold({ userId: o.userId, reserveId: r.id, qty, key: o.key });
  if (!hold.ok) {
    await claimed.claims?.release(o.key);
    return hold.answer;
  }
  // The hold prices the bottles from the reserve it locked. A price raised since the page drew it is not charged.
  const charge = hold.amountCents;
  const raisedNow = aboveShown(charge, shown);
  if (raisedNow) {
    if (!hold.again) await steps.release(hold.id, "price changed", 0);
    await claimed.claims?.release(o.key);
    return { status: 409, body: raisedNow };
  }

  const pickup = reservePickupWords(r.stop);
  const closes = reserveClosesAt(r.stop);
  const told = async (paid: number) => {
    await tell.customer({ userId: o.userId, subject: `GT3 — ${r.name} is yours`,
      message: `GT3: ${what(hold.qty, r.name)} is yours${paid > 0 ? ` — ${money(paid)} paid ✓` : ""}. Pick it up ${pickup}.${closes ? ` Cancel for a full refund until ${closesWords(closes)}.` : ""}` });
    await tell.crew({ severity: "important", category: "order", kind: "reservation_new", subjectId: hold.id, link: RESERVES_LINK,
      title: "Limited Reserve sold", body: `${what(hold.qty, r.name)} — ${paid > 0 ? `${money(paid)} paid` : "no charge"}, for pickup ${pickup} (${o.who}).` });
  };
  const yours = (paymentId: string | null, paid: number): Answer =>
    ({ status: 200, body: { ok: true, paid: true, recorded: true, id: hold.id, qty: hold.qty, totalCents: paid, ...(paymentId ? { ref: refOf(paymentId) } : {}) } });

  // 6a · Nothing to pay: placed, once. A claim that will not settle goes back, and so does the key.
  if (charge === 0) {
    return placeOnce({ claims: claimed.claims, key: o.key, now, place: async () => {
      const s = await steps.settle(hold.id, null, 0);
      if (!s.ok) {
        await steps.release(hold.id, "didn't save", 0);
        return refuse(503, "That didn't go through — nothing was charged. Try again in a moment.");
      }
      await told(0);
      return yours(null, 0);
    } });
  }

  // 6b · The card, once.
  return chargeOnce({
    claims: claimed.claims, key: o.key, now,
    charge: async () => {
      const said = await o.charge(charge, `GT3PB Limited Reserve · ${what(hold.qty, r.name)}`.slice(0, 120));
      if (!said.ok) {
        // Declined: nothing was charged, so the bottles go back on the shelf.
        const back = await steps.release(hold.id, "card declined", 0);
        if (!back.ok) {
          await tell.crew({ severity: "important", category: "order", kind: "ops_incident", subjectId: hold.id, link: RESERVES_LINK,
            title: "A declined reserve kept its bottles — release them",
            body: `A card was declined for ${what(hold.qty, r.name)} (${o.who}) and its pending claim did not go back on the shelf (${back.error}). Mark it Not charged.` });
        }
      }
      return said;
    },
    record: async (paymentId) => {
      const s = await steps.settle(hold.id, paymentId, charge);
      if (!s.ok) {
        await tell.crew({ severity: "critical", category: "money", kind: "ops_incident", subjectId: hold.id, link: RESERVES_LINK,
          title: "Paid reserve didn't record — mark it paid",
          body: `A card payment went through (${paymentId ?? "no payment id"}, ${money(charge)}) for ${what(hold.qty, r.name)} (${o.who}), and its claim was not marked paid (${s.error}). Mark it paid under Money → Reserve drops.` });
        const ref = refOf(paymentId);
        return { status: 200, body: { ok: true, paid: true, recorded: false, id: hold.id, qty: hold.qty, totalCents: charge, ref,
          warn: `Paid${ref ? ` — ref ${ref}` : ""}. We've told the crew to mark your reserve paid — it's yours. Show this at pickup.` } };
      }
      await told(charge);
      return yours(paymentId, charge);
    },
    // Square's answer never came, or did not say. The claim stays pending — its bottles held — until the crew settle it
    // with the payment in front of them (Paid, or Not charged); every retry of this key hears the same words.
    unknown: async (e) => {
      await tell.crew({ severity: "critical", category: "money", kind: "ops_incident", subjectId: hold.id, link: RESERVES_LINK,
        title: "Reserve charge status unknown — check Square",
        body: `A card charge of ${money(charge)} for ${what(hold.qty, r.name)} (${o.who}) may or may not have gone through (${errorMessage(e, 120)}). A payment, if there is one, carries the reference ${o.key}. Settle the claim: Paid, or Not charged.` });
      return reserveSay.couldNotConfirm!(true);
    },
  });
}

// ── CANCEL ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Can the member still cancel this claim for a refund at `nowMs`? Until its pickup closes; any time once the pickup was
 *  called off or taken away (0400 reserve_closes_at is null then). */
export function memberMayCancel(c: Pick<ReserveClaimRow, "closes_at">, nowMs: number): boolean {
  if (!c.closes_at) return true;
  return nowMs < Date.parse(c.closes_at);
}

export async function cancelReserve(o: {
  steps: ReserveSteps; tell: Tell; now: () => number;
  claimId: string;
  /** The member themselves (their account), or the crew — an owner or an admin (app/api/reserves/cancel). */
  by: { userId: string } | { crew: true };
  /** Who, for the crew's line. */
  who: string;
  /** Square's refund (lib/squareServer.refundPayment); null when card payments are not switched on. Throws when the
   *  answer does not say whether the money went back (RefundUnknown, a dropped connection). */
  refund: ((o: { paymentId: string; amountCents: number; key: string; reason: string }) => Promise<RefundResult>) | null;
}): Promise<Answer> {
  const { steps, tell } = o;
  const crew = "crew" in o.by;
  let c: ReserveClaimRow | null;
  try { c = await steps.claim(o.claimId); } catch { return refuse(503, "Couldn't read that reserve just now — try again."); }
  if (!c || (!crew && c.user_id !== (o.by as { userId: string }).userId)) return refuse(404, "That reserve isn't here — it may have been canceled already.", { gone: true });
  const name = c.reserve?.name ?? "Limited Reserve";

  if (c.state === "cancelled" || c.state === "expired") return { status: 200, body: { ok: true, already: true, refundedCents: c.refunded_cents } };
  if (c.state === "collected") return refuse(409, crew ? "Those bottles were handed over — refund it in Square if it's owed." : "That reserve was handed over — ask the crew.");
  if (c.state === "pending") return refuse(409, crew ? "Its payment isn't settled yet — mark it Paid or Not charged first." : "Still confirming your payment — give it a minute, then try again.");
  if (!crew && !memberMayCancel(c, o.now())) {
    const at = c.closes_at ? new Date(c.closes_at) : null;
    return refuse(409, `Its pickup closed${at ? ` ${closesWords(at)}` : ""} — ask the crew at the truck.`);
  }

  // The money first. A refund refused or unknown leaves the claim standing: the bottles are still theirs until it is
  // settled, and the crew are told.
  const due = Math.max(0, (c.paid_cents ?? 0) - (c.refunded_cents ?? 0));
  if (due > 0) {
    if (!c.payment_id) return refuse(409, "There's no card payment on this reserve to refund — the crew can refund it in Square.");
    if (!o.refund) return refuse(503, "Card refunds aren't switched on here yet — the crew can refund it in Square.");
    let back: RefundResult;
    try {
      back = await o.refund({ paymentId: c.payment_id, amountCents: due, key: refundKey(c.id, c.refunded_cents ?? 0), reason: REFUND_REASON });
    } catch (e) {
      await tell.crew({ severity: "critical", category: "money", kind: "ops_incident", subjectId: c.id, link: RESERVES_LINK,
        title: "Reserve refund status unknown — check Square",
        body: `A refund of ${money(due)} for ${what(c.qty, name)} (${o.who}) was asked of Square and its answer did not say (${errorMessage(e, 120)}). Its payment is ${c.payment_id}; the claim still stands. Check Square, then refund it there or try the cancel again.` });
      return { status: 409, body: { pending: true, error: "We couldn't confirm the refund — the crew has been told and will check it. Your reserve stands until they do." } };
    }
    if (!back.ok) return refuse(400, `The refund didn't go through — ${back.error}. Nothing was canceled.`);
  }

  const released = await steps.release(c.id, crew ? "canceled by the crew" : "canceled by the member", (c.refunded_cents ?? 0) + due);
  if (!released.ok) {
    // A refund made and the claim not let go: read it again — a cancel that crossed this one may have let it go already.
    const again = await steps.claim(c.id).catch(() => null);
    if (again?.state !== "cancelled") {
      await tell.crew({ severity: "critical", category: "money", kind: "ops_incident", subjectId: c.id, link: RESERVES_LINK,
        title: "Refunded reserve didn't cancel — cancel it by hand",
        body: `${due > 0 ? `${money(due)} went back to the card for` : "Canceling"} ${what(c.qty, name)} (${o.who}), and its claim did not let go of its bottles (${released.error}). Cancel it under Money → Reserve drops.` });
      return { status: 200, body: { ok: true, refundedCents: due, warn: `${due > 0 ? `${money(due)} is on its way back to your card. ` : ""}The crew is finishing the cancel.` } };
    }
  }

  await tell.customer({ userId: c.user_id, subject: `GT3 — your ${name} reserve is canceled`,
    message: `GT3: your ${what(c.qty, name)} reserve is canceled${due > 0 ? ` — ${money(due)} is on its way back to your card` : ""}.` });
  await tell.crew({ severity: "fyi", category: "order", subjectId: c.id, link: RESERVES_LINK,
    title: crew ? "Reserve refunded and canceled" : "A member canceled their reserve",
    body: `${what(c.qty, name)} (${o.who}) — ${due > 0 ? `${money(due)} refunded` : "nothing to refund"}; the bottles are back on the shelf.` });
  return { status: 200, body: { ok: true, refundedCents: due } };
}

// ── SETTLED BY HAND ─────────────────────────────────────────────────────────────────────────────────────────────────
// A claim left pending — Square's answer never came, or its request stopped before it was saved — is settled by an
// owner or an admin (app/api/reserves/settle): Paid, or Not charged (the bottles back on the shelf). Neither is taken
// on trust:
//   · not while its checkout may still be going: its checkout claim moved under two minutes ago and not finished
//     (lib/chargeOnce IN_FLIGHT_MS — the pay route itself is cut off at a minute, app/api/reserves/pay maxDuration) is a
//     request that may yet answer for itself, or a payment Square may not list yet;
//   · Square is asked first, about this checkout's payment: the one the checkout heard of; else one pasted, held to
//     this checkout (completed, made under this claim's key — chargeCard sets the key as the payment's reference); else
//     the one Square has under the key, found among the payments made while the checkout ran (findPaymentByReference —
//     ListPayments cannot filter on a reference). What counts is what Square still holds of it, its refunds taken off: a
//     refunded payment stays COMPLETED in Square.
//   · Not charged is refused while Square holds money for it — mark it Paid, or refund it in Square first; refunded in
//     full, it is let go. Paid records what Square still holds; refunded in full, there is nothing to mark paid. A
//     reserve that cost nothing was never charged: Paid with no payment at all.
// Once settled, the checkout's key says so: a retry from the member's page hears "yours" or "nothing is charged — tap Pay
// to try again", not "we couldn't confirm" for ever.

/** Square's record of one payment (lib/squareServer.getPayment). */
export type PaymentSeen =
  | { ok: true; status: string; referenceId: string | null; amountCents: number; refundedCents: number }
  | { ok: false; notFound: boolean; error: string };
type SquarePayment = { id: string; status: string; amountCents: number; refundedCents: number };
/** A payment looked for by the key it was made under (lib/squareServer.findPaymentByReference). */
export type PaymentFound = { ok: true; payment: SquarePayment | null } | { ok: false; error: string };

/** How long before and after its checkout began a payment can have been made: the key is claimed the moment before the
 *  hold and the charge, and a request lives a minute at most — the rest is room for clocks that disagree. */
export const SEARCH_BEFORE_MS = 5 * 60_000;
export const SEARCH_AFTER_MS = 15 * 60_000;
const TOOK = new Set(["COMPLETED", "APPROVED", "PENDING"]);

export async function settleByHand(o: {
  steps: ReserveSteps;
  /** The checkout claims (lib/checkoutClaims), to say the key is settled; null before 0371. */
  claims: ClaimStore | null;
  now: () => number;
  claimId: string; outcome: "paid" | "not_charged";
  /** The checkout claim under the claim's key, as read just now (with when it was claimed) — null when there is none. */
  checkout: (Pick<Claim, "state" | "amount_cents" | "payment_id" | "updated_at"> & { created_at?: string | null }) | null;
  /** The bottles at the reserve's price — what a checkout with no amount of its own was charging. */
  priceCents: number;
  /** A payment id pasted from Square, already shaped (letters, digits, - and _); null when none was. */
  typedPaymentId: string | null;
  /** Square, asked about one payment (lib/squareServer.getPayment); null when card payments are not switched on.
   *  Throws when Square cannot be asked. */
  lookup: ((paymentId: string) => Promise<PaymentSeen>) | null;
  /** Square's payments between two times, searched for one made under a key (lib/squareServer.findPaymentByReference);
   *  null when card payments are not switched on. Throws when Square cannot be asked. */
  search: ((reference: string, fromIso: string, toIso: string) => Promise<PaymentFound>) | null;
}): Promise<Answer> {
  let c: ReserveClaimRow | null;
  try { c = await o.steps.claim(o.claimId); } catch { return refuse(503, "Couldn't read that claim just now — try again."); }
  if (!c) return refuse(404, "That claim isn't here.", { gone: true });
  if (c.state !== "pending") {
    if ((c.state === "paid" || c.state === "collected") && o.outcome === "paid") return { status: 200, body: { ok: true, already: true, state: c.state } };
    return refuse(409, `That claim is ${c.state} — it isn't waiting on its payment any more.`);
  }
  const k = o.checkout;
  // Still going? Its checkout claim (or, with none to read, the hold) moved under two minutes ago and has not finished.
  const since = k ? k.updated_at : c.created_at ?? null;
  if ((!k || k.state !== "done") && since && !(o.now() - Date.parse(since) > IN_FLIGHT_MS)) {
    return refuse(409, "Its checkout may still be going — give it two minutes, then settle it.", { inFlight: true });
  }
  const key = c.idempotency_key;
  const expected = Math.max(0, Math.round(k?.amount_cents ?? o.priceCents));
  // The key, settled: what every retry of it hears from now on. Moved from the claim as it was read; moved on since — a
  // retry found its request dead (started → unknown) — it is moved from where it is now, unless its own request finished.
  const keyHears = async (answer: Answer, paymentId: string | null) => {
    if (!o.claims || !key || !k || k.state === "done") return;
    const to = { state: "done" as const, answer, paymentId, note: "settled by hand" }, at = new Date(o.now()).toISOString();
    if (await o.claims.move(key, to, at, k)) return;
    const fresh = await o.claims.read(key);
    if (fresh.ok && fresh.claim && fresh.claim.state !== "done") await o.claims.move(key, to, at, fresh.claim);
  };

  // ── What Square has for this checkout ──
  const asked = async (paymentId: string, ours: boolean): Promise<{ answer: Answer } | { payment: SquarePayment }> => {
    let seen: PaymentSeen;
    try { seen = await o.lookup!(paymentId); } catch { return { answer: refuse(503, "Couldn't reach Square to check that payment — try again.") }; }
    if (!seen.ok) {
      return { answer: seen.notFound
        ? refuse(400, "Square has no payment with that ID — copy it again from the payment's page.")
        : refuse(503, `Square didn't answer about that payment (${seen.error}) — try again.`) };
    }
    if (ours && key && key.length <= REFERENCE_MAX && seen.referenceId !== key) {
      return { answer: refuse(409, "That payment was made for another checkout — its reference isn't this claim's. Check the ID.") };
    }
    return { payment: { id: paymentId, status: seen.status, amountCents: seen.amountCents, refundedCents: seen.refundedCents } };
  };
  let found: SquarePayment | null = null;
  if (k?.payment_id) {
    // Square's own answer named it: that is the payment, and a different one pasted is a mistake to say.
    if (o.outcome === "paid" && o.typedPaymentId && o.typedPaymentId !== k.payment_id) {
      return refuse(409, `Square's answer named another payment (ref ${refOf(k.payment_id)}) — check the ID, or leave it empty.`);
    }
    if (o.lookup) {
      const r = await asked(k.payment_id, false);
      if ("answer" in r) return r.answer;
      found = r.payment;
    } else {
      found = { id: k.payment_id, status: "COMPLETED", amountCents: expected, refundedCents: 0 };   // the checkout's word alone
    }
  } else if (o.outcome === "paid" && o.typedPaymentId) {
    if (!o.lookup) return refuse(503, "Card payments aren't switched on here, so that payment can't be checked with Square.");
    const r = await asked(o.typedPaymentId, true);
    if ("answer" in r) return r.answer;
    found = r.payment;
  } else {
    // Searched for by its key — when there was money to take and the key went on the payment (one too long did not).
    const began = Date.parse(k?.created_at ?? c.created_at ?? "");
    if (expected > 0 && o.search && key && key.length <= REFERENCE_MAX && Number.isFinite(began)) {
      let r: PaymentFound;
      try {
        r = await o.search(key, new Date(began - SEARCH_BEFORE_MS).toISOString(), new Date(Math.min(o.now(), began + SEARCH_AFTER_MS)).toISOString());
      } catch { return refuse(503, "Couldn't ask Square about its payment — try again in a moment."); }
      if (!r.ok) return refuse(503, `Square didn't answer about its payment (${r.error}) — try again in a moment.`);
      found = r.payment;
    } else if (expected > 0 && o.outcome === "paid") {
      return refuse(400, "Paste the payment's ID from Square — its refund needs it.", { needsId: true });
    }
  }
  // What Square still holds of it, its refunds taken off.
  const still = found ? Math.max(0, found.amountCents - found.refundedCents) : 0;
  const took = !!found && TOOK.has(found.status);

  if (o.outcome === "not_charged") {
    if (found && took && still > 0) {
      return refuse(409, `Square took ${money(still)} for this one (ref ${refOf(found.id)}) — it was charged. Mark it Paid, or refund it in Square first.`, { found: true });
    }
    const refunded = !!found && took;   // charged, and all of it went back in Square
    const s = await o.steps.release(c.id, refunded ? "refunded in Square" : "not charged", 0);
    if (!s.ok) return refuse(409, s.error);
    await keyHears(declined(refunded
      ? "That payment was refunded — nothing is charged. Tap Pay to reserve it again."
      : "That payment didn't go through — nothing was charged. Tap Pay to try again."), null);
    return { status: 200, body: { ok: true, state: "cancelled" } };
  }

  if (!found) {
    if (expected > 0) return refuse(400, "Square has no payment under this checkout — mark it Not charged, or paste the payment's ID if you found one.", { needsId: true });
    // Nothing to charge, nothing charged: theirs.
    const s = await o.steps.settle(c.id, null, 0);
    if (!s.ok) return refuse(409, s.error);
    await keyHears(paidAnswer({ id: c.id, qty: c.qty, paid_cents: 0 }), null);
    return { status: 200, body: { ok: true, state: "paid", paidCents: 0 } };
  }
  if (found.status !== "COMPLETED") {
    return refuse(409, `Square shows that payment as ${found.status ? found.status.toLowerCase() : "unfinished"}, not completed — settle it once it completes, or mark it Not charged if it failed.`);
  }
  if (still <= 0) return refuse(409, "Square shows that payment refunded in full — there is nothing to mark paid. Mark it Not charged.");
  const s = await o.steps.settle(c.id, found.id, still);
  if (!s.ok) return refuse(409, s.error);
  await keyHears(paidAnswer({ id: c.id, qty: c.qty, paid_cents: still }), found.id);
  return { status: 200, body: { ok: true, state: "paid", paidCents: still, ref: refOf(found.id) } };
}
