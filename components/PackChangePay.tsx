"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import PaymentCard, { type PaymentCardHandle } from "./PaymentCard";
import { useIdemKey, type Attempt } from "./useIdemKey";
import { authedFetch } from "@/lib/authedFetch";
import { squareClientReady } from "@/lib/square";
import { haptic } from "@/lib/haptics";
import { money } from "@/lib/money";

// THE PAY STEP OF A PACK CHANGED IN PLACE (0388, 2026-10-12 — C5 of the customer audit, approved). Loaded only when a
// member changes a pack (components/OrderFunnel, next/dynamic): every visitor to /reserve and /delivery used to carry it
// for a path few take.
//
// What the server says the change moves is asked before Pay (/api/reserve/change, quote), so the button names the
// amount that moves: a paid pack moves the difference — charged to a card, or refunded to the card that paid — and a
// pay-at-pickup pack moves nothing unless it is paid now. The change is sent with the difference it was shown; a
// different one is refused before anything moves, and asked again.

export type ChangeBody = {
  id: string; name: string; phone: string; size: number; glass: "return" | "new";
  mix: { RISE: number; FLOW: number; DUSK: number }; dropDate: string; code?: string;
};
export type ChangeDone = { total: number; paid: boolean; ref: string; warn?: string; change: { charged: number; refunded: number; pending: number } };
type ChangeQuote = { paid: boolean; wasCents: number; newCents: number; diffCents: number };

/** What a change moves, in one line under its quote. */
function ChangeLine({ q }: { q: ChangeQuote }) {
  if (!q.paid) return <>New total <b>{money(q.newCents)}</b> · pay now or at pickup</>;
  if (q.diffCents > 0) return <>Pay the difference <b>{money(q.diffCents)}</b></>;
  if (q.diffCents < 0) return <>Back to your card <b>{money(-q.diffCents)}</b></>;
  return <>Same price — <b>nothing to pay</b></>;
}

export default function PackChangePay({ body, sig, bottles, dayLabel, codeBox, checkoutOff, onDone, onRefresh }: {
  body: ChangeBody;
  /** What the change's key is signed over (lib/idempotency): what is bought, never the card token. */
  sig: Record<string, unknown>;
  bottles: number; dayLabel: string;
  codeBox: ReactNode; checkoutOff: ReactNode;
  onDone: (d: ChangeDone) => void;
  /** The pack changed somewhere else first: show it as it stands. */
  onRefresh: (message: string) => void;
}) {
  // A change keeps its own key: a change and a new pack are two different things to be charged for.
  const idemChange = useIdemKey("gt3-of-idem-change");
  const paymentRef = useRef<PaymentCardHandle>(null);
  const [cardReady, setCardReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (err) haptic("error"); }, [err]);

  // The answer is kept with the question it answers: a different pack, code or retry is a new question.
  const [quoted, setQuoted] = useState<{ ask: string; quote: ChangeQuote | null; err: string } | null>(null);
  const [quoteTick, setQuoteTick] = useState(0);
  const quoteAsk = `${JSON.stringify(body)}#${quoteTick}`;
  const changeQuote = quoted && quoted.ask === quoteAsk ? quoted.quote : null;
  const quoteErr = quoted && quoted.ask === quoteAsk ? quoted.err : "";
  useEffect(() => {
    let live = true;
    const said = (quote: ChangeQuote | null, e: string) => { if (live) setQuoted({ ask: quoteAsk, quote, err: e }); };
    authedFetch("/api/reserve/change", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, quote: true }) })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.quote) said(d.quote as ChangeQuote, "");
        else said(null, d.error || "Couldn't work out the difference — try again.");
      })
      .catch(() => said(null, "Couldn't work out the difference — check your connection."));
    return () => { live = false; };
  }, [quoteAsk, body]);

  // `card` is the card send's attempt (payChangeCard); without one the change moves no card money — a refund, the same
  // price, or a pay-at-pickup pack staying so.
  const submitChange = useCallback(async (card: Attempt | null) => {
    if (busy || !changeQuote) return;
    setErr("");
    if (!body.name || !body.phone) { setErr("Add your name and phone — the crew uses them at pickup."); return; }
    setBusy(true);
    const expectedDiffCents = changeQuote.paid ? changeQuote.diffCents : card ? changeQuote.newCents : 0;
    const attempt = card ?? await idemChange.begin(sig);
    try {
      const res = await authedFetch("/api/reserve/change", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, expectedDiffCents, sourceId: attempt.token ?? undefined, idempotencyKey: attempt.key }),
      });
      const data = await res.json(); setBusy(false);
      idemChange.settle(attempt.key, res.status, data);
      if (!res.ok) {
        // The difference moved since it was shown: ask again, and say so. The pack changed elsewhere: show it as it is.
        if (data.priceChanged) setQuoteTick((n) => n + 1);
        if (data.refresh) { onRefresh(data.error || "Your pack just changed."); return; }
        setErr(data.error || "Something went wrong — try again.");
        return;
      }
      haptic("success");
      onDone({
        total: Number(data.totalCents) || changeQuote.newCents, paid: !!data.paid, ref: String(data.id || ""), warn: data.warn,
        change: { charged: Number(data.chargedCents) || 0, refunded: Number(data.refundedCents) || 0, pending: Number(data.refundPendingCents) || 0 },
      });
    } catch {
      setBusy(false);
      // As the reserve's own catch: the answer may have been lost after the money moved. The key (and a card token) are
      // kept, so the next tap is answered from the first — nothing moves twice.
      idemChange.settle(attempt.key, null, null);
      setErr("Couldn't confirm the change — safe to try again, nothing is charged twice.");
    }
  }, [busy, body, sig, changeQuote, idemChange, onDone, onRefresh]);
  const payChangeCard = async () => {
    if (busy) return;
    setErr("");
    if (!cardReady) return;
    setBusy(true);
    try {
      const attempt = await idemChange.begin(sig, () => paymentRef.current!.tokenize());
      if (!attempt.token) { setErr("Card details look off — check and retry."); setBusy(false); return; }
      await submitChange(attempt);
    } catch {
      setErr("Payment failed — nothing was charged. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="dl-step">
      <h2 className="dl-h">Change your pack</h2>
      <div className="dl-quote">
        <span>{bottles} bottles · pickup {dayLabel}</span>
        {changeQuote?.paid && <span>You paid <b>{money(changeQuote.wasCents)}</b> · the new pack is <b>{money(changeQuote.newCents)}</b></span>}
        <span className="dl-quote-t">{changeQuote ? <ChangeLine q={changeQuote} /> : (quoteErr || "Working out the difference…")}</span>
      </div>
      {codeBox}
      {err && <p className="dl-err" role="alert">{err}</p>}
      {!changeQuote && quoteErr && <button type="button" className="btn-sec" onClick={() => setQuoteTick((n) => n + 1)}>Try again</button>}
      {changeQuote && (changeQuote.paid && changeQuote.diffCents <= 0 ? (
        <button type="button" className="btn-pri btn-wide" onClick={() => submitChange(null)} disabled={busy}>
          {busy ? "Changing…" : changeQuote.diffCents < 0 ? `Change my pack — ${money(-changeQuote.diffCents)} back` : "Change my pack"}
        </button>
      ) : (
        <>
          {squareClientReady && (
            <>
              <PaymentCard ref={paymentRef} className="sq-card" onReady={setCardReady} onError={(m) => setErr(m ?? "")} />
              <button type="button" className="btn-pri btn-wide" disabled={!cardReady || busy} onClick={payChangeCard}>
                {busy ? "Charging…" : changeQuote.paid ? `Pay the ${money(changeQuote.diffCents)} difference` : `Pay ${money(changeQuote.newCents)} now`}
              </button>
            </>
          )}
          {!changeQuote.paid && (
            <button type="button" className={squareClientReady ? "oa-paylater" : "btn-pri btn-wide"} onClick={() => submitChange(null)} disabled={busy}>
              {busy ? "Changing…" : `Change it — ${money(changeQuote.newCents)} at pickup`}
            </button>
          )}
          {changeQuote.paid && !squareClientReady && checkoutOff}
        </>
      ))}
      <p className="dl-trust">Only the difference moves: a bigger pack charges it to a card, a smaller one sends it back to the card you paid with.</p>
    </div>
  );
}
