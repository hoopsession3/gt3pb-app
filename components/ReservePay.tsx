"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Sheet from "./Sheet";
import PaymentCard, { type PaymentCardHandle } from "./PaymentCard";
import { useIdemKey, type Attempt } from "./useIdemKey";
import { authedFetch } from "@/lib/authedFetch";
import { PAY_DEADLINE_MS } from "@/lib/deadline";
import { squareClientReady } from "@/lib/square";
import { haptic } from "@/lib/haptics";
import { money } from "@/lib/money";
import { payErrorText } from "@/lib/idempotency";
import { closesWords } from "@/lib/pickupDay";

// The held-payment notice loads when something is held (components/HeldNotice) — a moment few customers see.
const HeldNotice = dynamic(() => import("./HeldNotice"), { ssr: false });

// PAY FOR A LIMITED RESERVE (0400, 2026-10-14 — R5 of the customer audit). Loaded with the first tap of "Reserve yours"
// (components/Reserves, next/dynamic). How many, where and when it is picked up, the total, the card — and the one key
// this checkout is paid under (components/useIdemKey, lib/idempotency): a retry after a lost answer is answered from the
// first request (app/api/reserves/pay → lib/reservePay), never charged twice. The total on the button is the most the
// server charges (lib/shownTotal): a price raised meanwhile is shown here and agreed to by the next tap.

/** The most one checkout reserves — lib/reservePay's MAX_QTY, said here so the server's money path is not loaded. */
const MAX_QTY = 12;

export type ReservePayDone = { qty: number; totalCents: number; warn?: string };

export default function ReservePay({ reserve, pickup, closes, have, onClose, onDone }: {
  reserve: { id: string; name: string; price_cents: number; per_member_limit: number; stock_remaining: number };
  /** "Sat, Oct 17 · 11:00am–2:00pm at WineXpress" (lib/reservePickup). */
  pickup: string;
  /** When it can no longer be canceled for a refund (ISO), or null. */
  closes: string | null;
  /** Bottles this member already holds of it — their limit is the sum. */
  have: number;
  onClose: () => void;
  onDone: (d: ReservePayDone) => void;
}) {
  const idem = useIdemKey("gt3-rsv-idem");
  const paymentRef = useRef<PaymentCardHandle>(null);
  const [cardReady, setCardReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (err) haptic("error"); }, [err]);

  const max = Math.max(1, Math.min(MAX_QTY, reserve.per_member_limit - have, reserve.stock_remaining));
  const [qty, setQty] = useState(1);
  // A total the server raised for these bottles, agreed to by the next tap; anything else is priced as the page saw it.
  const [agreed, setAgreed] = useState<{ n: number; cents: number } | null>(null);
  // A PAYMENT WHOSE ANSWER NEVER CAME HOLDS ITS ORDER STILL (R8). The first request holds the bottles, so the stock and
  // the member's own count move under the page — and "how many" moved with them: 2 became 1, the key's signature changed,
  // and "Pay $40" was a second charge beside the first $80. While the answer is unknown, what was sent is what is shown
  // and sent again (the same key, answered from the first request); the count holds still until it is answered.
  const was = idem.heldDetails() as { reserve?: unknown; qty?: unknown; cents?: unknown } | null;
  const frozen = was && was.reserve === reserve.id && typeof was.qty === "number" && typeof was.cents === "number" ? { n: was.qty, cents: was.cents } : null;
  // Held for another reserve (the key is this phone's, across reserves): said, and Pay waits on Start over — a new key here
  // would let that payment go unasked.
  const heldElsewhere = idem.isOpen() && !frozen;
  const n = frozen ? frozen.n : Math.min(qty, max);
  const totalCents = frozen ? frozen.cents : agreed && agreed.n === n ? agreed.cents : n * reserve.price_cents;
  // Asking about a held payment, or making one — read when the button is tapped (the hold opens as the first send leaves).
  const [rechecking, setRechecking] = useState(false);

  const send = async (withCard: boolean) => {
    if (busy) return;
    setRechecking(!!frozen);
    setErr("");
    setBusy(true);
    // The key is signed over what is bought — the reserve, how many, the total — never the card.
    const sig = { reserve: reserve.id, qty: n, cents: totalCents };
    let attempt: Attempt;
    try {
      attempt = withCard ? await idem.begin(sig, () => paymentRef.current!.tokenize()) : await idem.begin(sig);
    } catch {
      setBusy(false);
      setErr("Payment failed — nothing was charged. Try again.");
      return;
    }
    if (withCard && !attempt.token) { setBusy(false); setErr("Card details look off — check and retry."); return; }
    idem.sent(attempt.key, withCard);   // held open from the send: what it bought holds still until it is answered
    try {
      const res = await authedFetch("/api/reserves/pay", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reserveId: reserve.id, qty: n, expectedCents: totalCents, sourceId: attempt.token ?? undefined, idempotencyKey: attempt.key }),
      }, { deadlineMs: PAY_DEADLINE_MS });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      idem.settle(attempt.key, res.status, data);
      if (!res.ok) {
        if (data.totalChanged && typeof data.totalCents === "number") setAgreed({ n, cents: data.totalCents });
        setErr(payErrorText(data.error));
        return;
      }
      haptic("success");
      onDone({ qty: Number(data.qty) || n, totalCents: Number(data.totalCents) || 0, warn: data.warn });
    } catch {
      setBusy(false);
      // The answer may have been lost after the card was charged: the key and the card token are kept, so the next tap
      // is answered from the first — nothing is charged twice.
      idem.settle(attempt.key, null, null);
      setErr("Couldn't confirm the payment — tap the button to check on it. Nothing is charged twice.");
    }
  };

  return (
    <Sheet open onClose={onClose} dismissible={!busy} labelledBy="rsv-pay-title">
      <div className="dl-step">
        <div className="oa-kicker">LIMITED RESERVE</div>
        <h2 className="dl-h" id="rsv-pay-title">{reserve.name}</h2>
        {max > 1 && (
          <div className="dl-ctr">
            <span className="dl-ctr-n">How many <em>Up to {max} for you</em></span>
            <div className="dl-ctr-b">
              <button type="button" onClick={() => setQty(Math.max(1, n - 1))} disabled={n <= 1 || busy || !!frozen} aria-label="One fewer">−</button>
              <b>{n}</b>
              <button type="button" onClick={() => setQty(Math.min(max, n + 1))} disabled={n >= max || busy || !!frozen} aria-label="One more">+</button>
            </div>
          </div>
        )}
        <div className="dl-quote">
          <span>{pickup ? `Pickup ${pickup}` : "Pickup to be named"}</span>
          <span className="dl-quote-t">total <b>{money(totalCents)}</b></span>
        </div>
        {(frozen || heldElsewhere) && !busy && (
          <HeldNotice buttonClass="co-paylater" what="Your last payment hasn’t been confirmed yet."
            line={frozen
              ? "Tap the button to check on it — you won’t be charged twice, and how many stays as it is until it’s answered."
              : "It was for a different reserve. Check your email for a receipt before paying again."}
            warning="Only start over if we’ve told you it didn’t go through — otherwise this would be a second payment."
            onStartOver={() => { idem.forget(); setErr(""); }} />
        )}
        {totalCents === 0 ? (
          <>
            {err && <p className="dl-err" role="alert">{err}</p>}
            <button type="button" className="btn-pri btn-wide" onClick={() => send(false)} disabled={busy || heldElsewhere}>{busy ? (rechecking ? "Checking…" : "Reserving…") : frozen ? "Check on my reservation" : "Reserve it — no charge"}</button>
          </>
        ) : squareClientReady ? (
          <>
            <PaymentCard ref={paymentRef} className="sq-card" onReady={setCardReady} onError={(m) => setErr(m ?? "")} />
            {err && <p className="dl-err" role="alert">{err}</p>}
            <button type="button" className="btn-pri btn-wide" disabled={!cardReady || busy || heldElsewhere} onClick={() => send(true)}>{busy ? (rechecking ? "Checking…" : "Charging…") : frozen ? "Check on my payment" : `Pay ${money(totalCents)}`}</button>
          </>
        ) : (
          <p className="dl-sub">Card payments aren&rsquo;t switched on yet — check back shortly.</p>
        )}
        <p className="dl-trust">{closes ? `Cancel for a full refund until ${closesWords(new Date(closes))}, 24 hours before pickup.` : "Cancel for a full refund until 24 hours before pickup."} No timer — it&rsquo;s yours once it&rsquo;s paid.</p>
      </div>
    </Sheet>
  );
}
