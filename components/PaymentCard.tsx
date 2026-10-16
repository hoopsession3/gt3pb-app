"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { SQUARE_APP_ID, SQUARE_LOCATION_ID, squareClientReady, loadSquareSdk } from "@/lib/square";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PaymentCardHandle {
  tokenize: () => Promise<{ status: string; token?: string }>;
}

let seq = 0;
// Mounting Square's card form: up to MOUNT_TRIES attempts, MOUNT_GAP_MS apart, one at a time.
const MOUNT_TRIES = 25, MOUNT_GAP_MS = 300;
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// THE Square card mount — one attach-with-retry lifecycle instead of three near-identical copies
// that grew independently in Checkout, OrderFunnel, and SubscriptionCard. The retry + hardError
// handling here is the exact pattern that fixed a live "Card form didn't load" bug in the order
// funnel earlier — every payment surface gets that robustness now, not just the one that happened
// to get patched. Mount/unmount (not a prop) drives the lifecycle: render this only where you want
// it live, same as the plain `<div id="…">` each surface used to hand-roll.
// Square hosted-field theming per surface (2026-08-01, LV pass): the default iframe fields are a
// stark white block — fine as a defined field on the dark funnel, a visible seam on the paper
// checkout sheet. tone="paper" tints the inputs to the sheet's own cream so the card form reads
// as part of the page, not an embed. Keys are Square's documented card style surface.
// ONE LIGHT PALETTE (2026-10-14, R6): Square's fields live in its own frame and cannot read the page's tokens, so they
// are the palette's values written out — the field white (--field), the ink (--cream), the focus gold (--gold2) — and
// the card form matches the name field above it again.
const CARD_STYLE: Record<string, object> = {
  paper: {
    input: { backgroundColor: "#FFFFFF", color: "#221F18" },
    // The placeholders ("Card number", "MM/YY", "CVV", "ZIP") are this form's only visible labels: #6c6256, the paper's
    // --muted2-onLight, 5.9:1 on the white field (R12 — the 10/10 audit, F6; #9a8f7c was 3.2:1).
    "input::placeholder": { color: "#6c6256" },
    ".input-container": { borderColor: "#D8CFBB", borderRadius: "10px" },
    ".input-container.is-focus": { borderColor: "#6e4c1e" },
  },
};
const PaymentCard = forwardRef<PaymentCardHandle, {
  className?: string;
  tone?: "paper" | "dark";
  onReady?: (ready: boolean) => void;
  onError?: (message: string | null) => void;
}>(function PaymentCard({ className, tone, onReady, onError }, ref) {
  const idRef = useRef(`pay-card-${++seq}`);
  const cardRef = useRef<{ tokenize: () => Promise<{ status: string; token?: string }>; destroy?: () => void } | null>(null);
  // Latest-callback refs — onReady/onError are inline arrows at every call site, so a new function
  // identity lands on every parent re-render. Reading through a ref (not the effect's own closure)
  // keeps the mount effect running exactly once instead of tearing down and re-attaching the card
  // on, say, every keystroke in a name field above it.
  const onReadyRef = useRef(onReady); onReadyRef.current = onReady;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;

  useImperativeHandle(ref, () => ({
    tokenize: async () => (cardRef.current ? cardRef.current.tokenize() : { status: "NOT_READY" }),
  }), []);

  // TRY AGAIN, HERE (R11, 2026-10-16 — the 10/10 audit). "Couldn't load the card form. Try again." had nothing to try
  // again with: closing and reopening the sheet mounted into the same failed load (lib/square forgets one now), so the
  // card form stayed gone until a reload. A failure now leaves a Try again under the form, and it starts over.
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retry = () => { setFailed(false); onErrorRef.current?.(null); setAttempt((n) => n + 1); };

  useEffect(() => {
    if (!squareClientReady) return;
    let dead = false;
    const fail = (message: string) => { if (dead) return; setFailed(true); onErrorRef.current?.(message); };
    const tryMount = async (Square: any): Promise<boolean> => {
      if (dead || cardRef.current) return true;
      let card: any = null;
      try {
        const payments = Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
        const style = tone ? CARD_STYLE[tone] : undefined;
        card = await payments.card(style ? { style } : undefined);
        // Read again after every wait (R11): the sheet may have closed while Square answered, and the form it made then
        // was attached anyway — a second card in the page, and one that was never destroyed.
        if (dead || cardRef.current) { card.destroy?.(); return true; }
        await card.attach(`#${idRef.current}`);
        if (dead || cardRef.current) { card.destroy?.(); return true; }
        cardRef.current = card;
        onReadyRef.current?.(true); onErrorRef.current?.(null);
        return true;
      } catch (e) {
        try { card?.destroy?.(); } catch { /* it was never whole */ }
        // Transient failure (SDK init still settling, a slow/flaky resource load right after the
        // script tag fires, etc.) — the FIRST failure must not be treated as fatal. Return false so
        // the retry loop below actually runs; only the last attempt surfaces a user-visible error.
        // This was the real bug: every path here used to return `true` unconditionally, including
        // this catch — which skipped the retry loop entirely and turned every transient hiccup into
        // an immediate, permanent "Card form error," with the Pay button stuck on "Loading card…" forever.
        console.warn("[PaymentCard] mount attempt failed, will retry:", e instanceof Error ? e.message : e);
        return false;
      }
    };
    (async () => {
      let Square: any;
      try { Square = await loadSquareSdk(); } catch { fail("Couldn't load the card form — check your signal, then Try again."); return; }
      // ONE ATTEMPT AT A TIME (R11): the retries ran on a 300 ms interval, and an attempt takes longer than that on a phone,
      // so they overlapped — two forms could attach. Now each waits for the last.
      for (let i = 0; i < MOUNT_TRIES; i++) {
        if (dead || cardRef.current) return;
        if (await tryMount(Square)) return;
        await pause(MOUNT_GAP_MS);
      }
      if (!cardRef.current) fail("The card form didn't load. Try again — if it keeps happening, tell us.");
    })();
    return () => { dead = true; cardRef.current?.destroy?.(); cardRef.current = null; onReadyRef.current?.(false); };
  }, [tone, attempt]);

  return (
    <>
      <div id={idRef.current} className={className} />
      {failed && <button type="button" className="btn-sec btn-sm" onClick={retry}>Try again</button>}
    </>
  );
});

export default PaymentCard;
