// A PACK IS CHANGED IN PLACE (0388, 2026-10-12 — C5 of the customer frontend audit; the owner approved it as decision 4).
//
// ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────────────────────────────────────
// "Change the pack" placed a second reservation and canceled the first. A paid pack was charged again in full, the
// first payment waited on a crew alert to be refunded by hand, and the customer was told only "Pack updated."
//
// ── WHAT THIS IS ───────────────────────────────────────────────────────────────────────────────────────────────────
// One change, under the page's key (components/useIdemKey), moves in this order — and a retry of the key is answered
// from wherever it got to, never by doing a step twice:
//
//   begin    public.pack_change_begin holds the pack for this key (one change at a time per pack) and decides the
//            money under the pack's lock: a paid pack moves the difference, a pay-at-pickup pack moves nothing unless
//            it is paid now. The page was quoted the same rule (diffFor) and sends what it was shown; any other
//            answer refuses before anything moves ("repriced").
//   money    more: the difference is charged to the card, under the key. Less: it is refunded to the payments that
//            funded the pack, newest first (refundPlan), each under its own key derived from this one. A refund
//            Square refuses, or does not confirm, is the crew's to send by hand — the pack still changes: the
//            customer asked for less and is owed the difference either way. A charge Square does not confirm is
//            the opposite: the pack stays as it was and the crew is told, because the customer may not have paid.
//   apply    public.pack_change_apply changes the pack in place, if it is still what the change found. If it is not
//            (the crew started brewing it, it was canceled), a charge is given back in full and a refund goes to
//            the crew.
//
// A change whose request died is finished by whoever comes next: after the money, by applying it; before the
// answer from Square, by telling the crew (a charge or refund may have happened) — the way lib/chargeOnce does.
//
// No clock but the one handed in, no database but the store, no Square but the money: scripts/db.packchange.test.mjs
// drives every branch against 0388 itself in Postgres, with Square stood in for.

import { money } from "./money";
import { errorMessage } from "./errorMessage";

/** How long a change may sit in "started" before its request is taken to have died (as lib/chargeOnce). */
export const IN_FLIGHT_MS = 120_000;

export type ChangeState = "started" | "moved" | "done" | "refused" | "unknown" | "void" | "stale";

/** The pack as a change compares it (public.pack_snapshot). */
export type PackShape = {
  size: number; glass: string; mix: Record<string, number>; drop_date: string; total_cents: number;
  paid?: boolean; payment_id?: string | null;
};
/** What the pack becomes, as the change keeps it. No name or phone: they go straight onto the pack (0388), so an erased
 *  account leaves nothing of the person in the change log. */
export type After = PackShape & { benefit_code: string | null };
/** Who the pack is for, as the request names them. */
export type Who = { name: string; phone: string };
export type RefundRow = { payment_id: string; refund_id: string | null; cents: number; status: string };
/** The payments that fund a pack, newest first, with what is left to refund on each (public.pack_change_funding). */
export type Funding = { payment_id: string; left: number }[];

export type Change = {
  key: string; drop_order_id: string; user_id: string | null; state: ChangeState; card: boolean;
  before: PackShape; after: After; diff_cents: number;
  charge_payment_id: string | null; refunds: RefundRow[]; by_hand_cents: number;
  status: number | null; answer: Record<string, unknown> | null; outcome: string | null; updated_at: string;
};

export type Refusal = "key" | "not_found" | "canceled" | "in_motion" | "collected" | "repriced";
export type Begin =
  | { change: Change; again?: boolean; age_ms?: number; funding?: Funding }
  | { refused: Refusal; diff?: number; was?: number; paid?: boolean }
  | { held: Change; age_ms: number };

/** public.pack_change_* (lib/packChangeStore), or a test's stand-in. Each call is one transaction. */
export type PackChangeStore = {
  begin(a: { key: string; order: string; user: string; after: After; newTotal: number; payNow: boolean; expectedDiff: number }): Promise<Begin>;
  moved(key: string, m: { chargePaymentId: string | null; refunds: RefundRow[]; byHand: number; outcome: string | null }): Promise<boolean>;
  end(key: string, state: "refused" | "unknown" | "void", outcome: string): Promise<boolean>;
  /** Apply a moved change. `who`: the request's name and phone; none when a later request finishes it. Gives back the
   *  pack's name and phone, for the words. */
  apply(key: string, who?: Who): Promise<{ state: ChangeState | "missing"; change?: Change; name?: string | null; phone?: string | null }>;
  refunded(key: string, r: RefundRow): Promise<boolean>;
  answer(key: string, a: Answer): Promise<void>;
};

/** Square. Each THROWS when Square's answer does not say whether the money moved (lib/squareServer). */
export type Money = {
  charge(o: { amountCents: number; key: string; note: string }): Promise<{ ok: true; paymentId: string | null } | { ok: false; error: string }>;
  refund(o: { paymentId: string; amountCents: number; key: string; reason: string }): Promise<{ ok: true; refundId: string | null; status: string } | { ok: false; error: string }>;
};

export type CrewLine = { severity: "critical" | "important" | "fyi"; category: "order" | "money"; kind: string; title: string; body: string; subjectId: string };
export type Tell = { crew(a: CrewLine): Promise<void>; customer(c: Change, words: string, phone: string | null): Promise<void> };

/** What the route says — and says again, word for word, to every retry of the same key. */
export type Answer = { status: number; body: Record<string, unknown> };

// ── the rule the page is quoted (public.pack_change_begin decides it again, under the lock) ────────────────────────

/** The money a change moves: + charged, − refunded, 0 nothing. */
export function diffFor(pack: { paid: boolean; total_cents: number }, newTotal: number, payNow: boolean): number {
  return pack.paid ? newTotal - pack.total_cents : payNow ? newTotal : 0;
}

/** Take a refund from the payments that funded the pack, newest first. `short`: what no payment has left. */
export function refundPlan(funding: Funding, need: number): { parts: { payment_id: string; cents: number }[]; short: number } {
  const parts: { payment_id: string; cents: number }[] = [];
  let left = Math.max(0, Math.round(need));
  for (const f of funding) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, Math.floor(f.left)));
    if (take > 0) { parts.push({ payment_id: f.payment_id, cents: take }); left -= take; }
  }
  return { parts, short: left };
}

/** Square's keys are 45 characters at most; the change's key is the page's (8–45). */
export const refundKey = (key: string, i: number): string => `${key.slice(0, 41)}.r${i}`;
export const backKey = (key: string): string => `${key.slice(0, 41)}.bk`;

// ── what a customer is told ───────────────────────────────────────────────────────────────────────────────────────
// `pending: true` keeps the page's key and card token (lib/idempotency.attemptVerdict): the next tap asks about the
// same change. `declined: true` lets the key go: nothing more will happen under it, and the next tap starts over.

const ref = (key: string) => key.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();
const packWords = (a: PackShape) => `${a.size}-pack`;

export function stillConfirming(): Answer {
  return { status: 409, body: { pending: true, error: "Still confirming your change — give it a few seconds, then tap again to check. Nothing is charged twice." } };
}
export function anotherChange(): Answer {
  return { status: 409, body: { declined: true, error: "Another change to this pack is going through — give it a few seconds, then try again." } };
}
export function packMoved(): Answer {
  return { status: 409, body: { declined: true, refresh: true, error: "Your pack just changed — here it is as it stands now." } };
}
export function couldNotConfirm(c: Pick<Change, "diff_cents" | "key">): Answer {
  return { status: 409, body: { pending: true, ref: ref(c.key), error: c.diff_cents > 0
    ? `We couldn't confirm the ${money(c.diff_cents)} charge for your change, and the crew has been told. Your pack is unchanged — don't pay again.`
    : "We couldn't confirm your change went through, and the crew has been told. Check Your packs before changing it again." } };
}
export function declined(error: string): Answer {
  return { status: 400, body: { declined: true, error } };
}
export function refusal(b: { refused: Refusal; diff?: number; was?: number; paid?: boolean }): Answer {
  switch (b.refused) {
    case "not_found": return { status: 404, body: { error: "Order not found." } };
    case "canceled": return { status: 409, body: { declined: true, error: "That pack was canceled." } };
    case "in_motion": return { status: 409, body: { declined: true, error: "The crew already has this pack in motion — ask at the truck to change it." } };
    case "collected": return { status: 409, body: { declined: true, error: "This pack was paid at the window — the crew can change it." } };
    case "repriced": return { status: 409, body: { priceChanged: true, diffCents: b.diff ?? 0, wasCents: b.was ?? 0, paid: b.paid === true,
      error: "The difference for this change just moved — check it and confirm again." } };
    default: return { status: 409, body: { declined: true, error: "That change was started for another pack — start it again." } };
  }
}

/** The pack changed. What moved, said once for the page and once for the text. */
export function doneAnswer(c: Change): Answer {
  const refunded = c.refunds.reduce((s, r) => s + r.cents, 0);
  const body: Record<string, unknown> = {
    ok: true, changed: true, id: c.drop_order_id, totalCents: c.after.total_cents, size: c.after.size, dropDate: c.after.drop_date,
    paid: c.before.paid === true || c.charge_payment_id !== null,
  };
  if (c.diff_cents > 0) body.chargedCents = c.diff_cents;
  if (refunded > 0) body.refundedCents = refunded;
  if (c.by_hand_cents > 0) {
    body.refundPendingCents = c.by_hand_cents;
    body.warn = `Your pack is changed. The crew is sending ${money(c.by_hand_cents)} back to your card by hand — you don't need to do anything.`;
  }
  return { status: 200, body };
}

export function customerWords(c: Change): string {
  const a = c.after;
  const head = `GT3: your pack is now a ${packWords(a)} for pickup ${a.drop_date}.`;
  const refunded = c.refunds.reduce((s, r) => s + r.cents, 0);
  if (c.diff_cents > 0) return c.before.paid ? `${head} We charged the ${money(c.diff_cents)} difference.` : `${head} Paid ✓ ${money(c.diff_cents)}.`;
  if (c.diff_cents < 0) {
    const back = refunded > 0 ? ` ${money(refunded)} is going back to the card you paid with.` : "";
    const hand = c.by_hand_cents > 0 ? ` The crew is sending ${refunded > 0 ? "the other " : ""}${money(c.by_hand_cents)} back by hand.` : "";
    return `${head}${back}${hand}`;
  }
  return c.before.paid ? `${head} Same price — nothing charged.` : `${head} ${money(a.total_cents)} at pickup.`;
}

function crewChanged(c: Change, name: string): CrewLine {
  const b = c.before, a = c.after;
  const moved = c.diff_cents > 0 ? `charged ${money(c.diff_cents)}${b.paid ? " more" : " — paid now"}`
    : c.diff_cents < 0 ? `refunded ${money(-c.diff_cents)}${c.by_hand_cents > 0 ? ` (${money(c.by_hand_cents)} of it is yours to send by hand)` : ""}`
    : b.paid ? "same price" : "still pay at pickup";
  const day = a.drop_date !== b.drop_date ? `, ${b.drop_date} → ${a.drop_date}` : `, ${a.drop_date}`;
  return { severity: "important", category: "order", kind: "reservation_changed", subjectId: c.drop_order_id,
    title: "Pack changed", body: `${name} changed their pack: ${packWords(b)} → ${packWords(a)}${day}. ${moved[0].toUpperCase()}${moved.slice(1)}.` };
}

function crewByHand(c: Change, name: string): CrewLine {
  return { severity: "critical", category: "money", kind: "pack_refund_by_hand", subjectId: c.drop_order_id,
    title: `Refund ${money(c.by_hand_cents)} by hand — a pack change couldn't`,
    body: `${name} changed their pack to a ${packWords(c.after)} and is owed ${money(c.by_hand_cents)} back. Square didn't take the refund (${c.outcome || "no payment left to refund"}). Check the payment in Square first — if a refund for this amount is already there, it went out. Ref ${ref(c.key)}.` };
}

// ── the steps ─────────────────────────────────────────────────────────────────────────────────────────────────────

type Run = {
  store: PackChangeStore; money: Money | null; tell: Tell; now: () => number;
  key: string; order: string; user: string; after: After; who: Who; newTotal: number; payNow: boolean; expectedDiff: number;
};

/** A change, from the page's tap to its answer. */
export async function changePack(o: Run): Promise<Answer> {
  const args = { key: o.key, order: o.order, user: o.user, after: o.after, newTotal: o.newTotal, payNow: o.payNow, expectedDiff: o.expectedDiff };
  let b = await o.store.begin(args);
  if ("held" in b) {
    // Another key holds the pack. Moved: its money is done and it was never applied — finish it, and this request
    // sees the pack as it now is. Dead: stop it, once, and begin again. Alive: wait for it.
    if (b.held.state === "moved") { await finish(o, b.held); return packMoved(); }   // its request's name and phone went with it
    if (b.age_ms <= IN_FLIGHT_MS) return anotherChange();
    await stop(o, b.held);
    b = await o.store.begin(args);
    if ("held" in b) return anotherChange();
  }
  if ("refused" in b) return refusal(b);
  if (b.again) return again(o, b.change, b.age_ms ?? 0);
  return move(o, b.change, b.funding ?? []);
}

/** The same key again: answer from wherever the change got to. */
async function again(o: Run, c: Change, age: number): Promise<Answer> {
  if (c.state === "moved") return finish(o, c, o.who);
  if (c.state === "started") {
    if (age <= IN_FLIGHT_MS) return stillConfirming();
    return stop(o, c);
  }
  if (c.answer && typeof c.status === "number") return { status: c.status, body: c.answer };
  // Ended without an answer kept (its request stopped between the two writes): say what its state says.
  if (c.state === "done") return doneAnswer(c);
  if (c.state === "unknown") return couldNotConfirm(c);
  return packMoved();
}

/** A change whose request died before Square answered: unknown if money was to move, void if none was. */
async function stop(o: Run, c: Change): Promise<Answer> {
  const atStake = c.diff_cents !== 0;
  const ended = await o.store.end(c.key, atStake ? "unknown" : "void", "its request stopped before Square answered");
  const answer = atStake ? couldNotConfirm(c) : packMoved();
  if (!ended) return stillConfirming();
  await o.store.answer(c.key, answer);
  if (atStake) {
    await o.tell.crew({ severity: "critical", category: "money", kind: "pack_change_unknown", subjectId: c.drop_order_id,
      title: c.diff_cents > 0 ? `A pack change's ${money(c.diff_cents)} charge may have gone through` : `A pack change's ${money(-c.diff_cents)} refund may have gone out`,
      body: `A member's change to a ${packWords(c.after)} stopped before Square answered, and the pack was left as it was (${packWords(c.before)}). Look in Square for ${c.diff_cents > 0 ? `a ${money(c.diff_cents)} payment with reference ${c.key}` : `a ${money(-c.diff_cents)} refund on their pack payment`}: if it's there, change the pack by hand to match; if not, there's nothing to do. Ref ${ref(c.key)}.` });
  }
  return answer;
}

/** The money: the difference charged, or refunded, or nothing. Then apply. */
async function move(o: Run, c: Change, funding: Funding): Promise<Answer> {
  const reason = `GT3 pack change · ${packWords(c.before)} → ${packWords(c.after)} · pickup ${c.after.drop_date}`;
  let m: { chargePaymentId: string | null; refunds: RefundRow[]; byHand: number; outcome: string | null } = { chargePaymentId: null, refunds: [], byHand: 0, outcome: null };
  if (c.diff_cents > 0) {
    if (!o.money) {
      await o.store.end(c.key, "void", "card checkout isn't switched on");
      const a = { status: 503, body: { declined: true, error: "Card checkout isn't switched on yet." } };
      await o.store.answer(c.key, a);
      return a;
    }
    let r: Awaited<ReturnType<Money["charge"]>>;
    try {
      r = await o.money.charge({ amountCents: c.diff_cents, key: c.key, note: reason });
    } catch (e) {
      await o.store.end(c.key, "unknown", `Square did not say: ${errorMessage(e)}`);
      const a = couldNotConfirm(c);
      await o.store.answer(c.key, a);
      await o.tell.crew({ severity: "critical", category: "money", kind: "pack_change_unknown", subjectId: c.drop_order_id,
        title: `A pack change's ${money(c.diff_cents)} charge may have gone through`,
        body: `Square didn't say whether ${o.who.name}'s ${money(c.diff_cents)} was charged (${errorMessage(e)}), so the pack was left as it was (${packWords(c.before)}). Look in Square for a payment with reference ${c.key}: if it's there, change the pack by hand to a ${packWords(c.after)} for ${c.after.drop_date}; if not, there's nothing to do. Ref ${ref(c.key)}.` });
      return a;
    }
    if ("error" in r) {
      await o.store.end(c.key, "refused", r.error);
      const a = declined(r.error);
      await o.store.answer(c.key, a);
      return a;
    }
    m = { ...m, chargePaymentId: r.paymentId };
  } else if (c.diff_cents < 0) {
    const plan = refundPlan(funding, -c.diff_cents);
    const notes: string[] = [];
    let byHand = plan.short;
    if (plan.short > 0) notes.push(`no payment left to refund ${money(plan.short)} from`);
    for (const [i, part] of plan.parts.entries()) {
      if (!o.money) { byHand += part.cents; notes.push("card refunds aren't switched on"); continue; }
      try {
        const r = await o.money.refund({ paymentId: part.payment_id, amountCents: part.cents, key: refundKey(c.key, i), reason });
        if ("error" in r) { byHand += part.cents; notes.push(`Square refused ${money(part.cents)}: ${r.error}`); }
        else m.refunds.push({ payment_id: part.payment_id, refund_id: r.refundId, cents: part.cents, status: r.status });
      } catch (e) {
        byHand += part.cents; notes.push(`Square did not confirm ${money(part.cents)}: ${errorMessage(e)}`);
      }
    }
    m = { ...m, byHand, outcome: notes.length ? notes.join(" · ") : null };
  }
  const moved = await o.store.moved(c.key, m);
  if (!moved) {
    // Taken for dead while Square was answering — the next request marked it unknown and told the crew. The money
    // did what this says; say it to the crew too, with the payment, and leave the pack for them.
    if (m.chargePaymentId || m.refunds.length) {
      await o.tell.crew({ severity: "critical", category: "money", kind: "pack_change_unknown", subjectId: c.drop_order_id,
        title: "A slow pack change did move money",
        body: `${o.who.name}'s change (ref ${ref(c.key)}) was taken for stopped, but Square ${m.chargePaymentId ? `charged ${money(c.diff_cents)} (payment ${m.chargePaymentId})` : `refunded ${money(m.refunds.reduce((s, r) => s + r.cents, 0))}`}. The pack was left as a ${packWords(c.before)} — change it by hand to a ${packWords(c.after)}, or give the money back.` });
    }
    return couldNotConfirm(c);
  }
  return finish(o, c, o.who);
}

/** Apply a moved change. Done: say so. The pack changed underneath: give a charge back, tell the crew about a refund. */
async function finish(o: Run, c0: Change, who?: Who): Promise<Answer> {
  const a = await o.store.apply(c0.key, who);
  const c = a.change ?? c0;
  const name = a.name || "A member";
  if (a.state === "done") {
    const answer = doneAnswer(c);
    await o.store.answer(c.key, answer);
    await o.tell.customer(c, customerWords(c), a.phone ?? null);
    await o.tell.crew(crewChanged(c, name));
    if (c.by_hand_cents > 0) await o.tell.crew(crewByHand(c, name));
    return answer;
  }
  if (a.state === "stale") {
    let answer: Answer;
    if (c.charge_payment_id) {
      let back = false;
      if (o.money) {
        try {
          const r = await o.money.refund({ paymentId: c.charge_payment_id, amountCents: c.diff_cents, key: backKey(c.key), reason: "GT3 pack change undone — the pack changed first" });
          if (r.ok) { back = true; await o.store.refunded(c.key, { payment_id: c.charge_payment_id, refund_id: r.refundId, cents: c.diff_cents, status: r.status }); }
        } catch { /* told to the crew below */ }
      }
      answer = { status: 409, body: { declined: true, refresh: true, error: back
        ? `Your pack changed somewhere else while this went through, so this change was undone and the ${money(c.diff_cents)} charge refunded.`
        : `Your pack changed somewhere else while this went through, so this change was undone. The crew is refunding the ${money(c.diff_cents)} charge.` } };
      if (!back) await o.tell.crew({ severity: "critical", category: "money", kind: "pack_refund_by_hand", subjectId: c.drop_order_id,
        title: `Refund ${money(c.diff_cents)} by hand — a pack change was undone`,
        body: `${name} was charged ${money(c.diff_cents)} (payment ${c.charge_payment_id}) for a change that couldn't apply: the pack changed first. Square didn't take the refund back — refund it in Square. Ref ${ref(c.key)}.` });
    } else {
      const out = c.refunds.reduce((s, r) => s + r.cents, 0);
      answer = { status: 409, body: { declined: true, refresh: true,
        error: `Your pack changed somewhere else while this went through, so this change was undone. The crew has been told about the ${money(out + c.by_hand_cents)} refund.` } };
      await o.tell.crew({ severity: "critical", category: "money", kind: "pack_change_unknown", subjectId: c.drop_order_id,
        title: "A pack change refunded money and was undone",
        body: `${name}'s change to a ${packWords(c.after)} couldn't apply — the pack changed first — but ${out > 0 ? `${money(out)} was already refunded` : "nothing was refunded"}${c.by_hand_cents > 0 ? ` and ${money(c.by_hand_cents)} was marked to send by hand (don't send it)` : ""}. Check the pack with them: change it by hand, or charge the refund back. Ref ${ref(c.key)}.` });
    }
    await o.store.answer(c.key, answer);
    return answer;
  }
  if (a.state === "void") {
    const answer = packMoved();
    await o.store.answer(c.key, answer);
    return answer;
  }
  // Somebody else finished it first, or it ended: say what it says.
  if (c.answer && typeof c.status === "number") return { status: c.status, body: c.answer };
  return a.state === "unknown" ? couldNotConfirm(c) : packMoved();
}
