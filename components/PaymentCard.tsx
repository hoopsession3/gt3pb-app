"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { SQUARE_APP_ID, SQUARE_LOCATION_ID, squareClientReady, loadSquareSdk } from "@/lib/square";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PaymentCardHandle {
  tokenize: () => Promise<{ status: string; token?: string }>;
}

let seq = 0;

// THE Square card mount — one attach-with-retry lifecycle instead of three near-identical copies
// that grew independently in Checkout, OrderFunnel, and SubscriptionCard. The retry + hardError
// handling here is the exact pattern that fixed a live "Card form didn't load" bug in the order
// funnel earlier — every payment surface gets that robustness now, not just the one that happened
// to get patched. Mount/unmount (not a prop) drives the lifecycle: render this only where you want
// it live, same as the plain `<div id="…">` each surface used to hand-roll.
const PaymentCard = forwardRef<PaymentCardHandle, {
  className?: string;
  onReady?: (ready: boolean) => void;
  onError?: (message: string | null) => void;
}>(function PaymentCard({ className, onReady, onError }, ref) {
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

  useEffect(() => {
    if (!squareClientReady) return;
    let dead = false, hardError = false, polls = 0;
    let iv: ReturnType<typeof setInterval> | undefined;
    const tryMount = async (Square: any): Promise<boolean> => {
      if (dead || cardRef.current) return true;
      try {
        const payments = Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
        const card = await payments.card();
        if (dead) { card.destroy?.(); return true; }
        await card.attach(`#${idRef.current}`);
        cardRef.current = card;
        onReadyRef.current?.(true); onErrorRef.current?.(null);
        return true;
      } catch (e) {
        hardError = true;
        onErrorRef.current?.(`Card form error — ${e instanceof Error ? e.message : "Square rejected the request"}. Check the app is live, then refresh.`);
        return true;
      }
    };
    (async () => {
      let Square: any;
      try { Square = await loadSquareSdk(); } catch { if (!dead) onErrorRef.current?.("Couldn't load the card form. Try again."); return; }
      if (dead) return;
      if (await tryMount(Square)) return;
      iv = setInterval(async () => {
        polls += 1;
        if (dead || cardRef.current || hardError) { if (iv) clearInterval(iv); return; }
        if (await tryMount(Square)) { if (iv) clearInterval(iv); return; }
        if (polls >= 25) { if (iv) clearInterval(iv); if (!cardRef.current && !hardError) onErrorRef.current?.("Card form didn't load. Refresh and try again — if it keeps happening, tell us."); }
      }, 300);
    })();
    return () => { dead = true; if (iv) clearInterval(iv); cardRef.current?.destroy?.(); cardRef.current = null; onReadyRef.current?.(false); };
  }, []);

  return <div id={idRef.current} className={className} />;
});

export default PaymentCard;
