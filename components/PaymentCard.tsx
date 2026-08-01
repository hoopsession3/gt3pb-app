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
// Square hosted-field theming per surface (2026-08-01, LV pass): the default iframe fields are a
// stark white block — fine as a defined field on the dark funnel, a visible seam on the paper
// checkout sheet. tone="paper" tints the inputs to the sheet's own cream so the card form reads
// as part of the page, not an embed. Keys are Square's documented card style surface.
const CARD_STYLE: Record<string, object> = {
  paper: {
    input: { backgroundColor: "#FBF8EF", color: "#221F18" },
    "input::placeholder": { color: "#9a8f7c" },
    ".input-container": { borderColor: "#D8CFBB", borderRadius: "10px" },
    ".input-container.is-focus": { borderColor: "#8a6f31" },
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

  useEffect(() => {
    if (!squareClientReady) return;
    let dead = false, polls = 0;
    let iv: ReturnType<typeof setInterval> | undefined;
    const tryMount = async (Square: any): Promise<boolean> => {
      if (dead || cardRef.current) return true;
      try {
        const payments = Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
        const style = tone ? CARD_STYLE[tone] : undefined;
        const card = await payments.card(style ? { style } : undefined);
        if (dead) { card.destroy?.(); return true; }
        await card.attach(`#${idRef.current}`);
        cardRef.current = card;
        onReadyRef.current?.(true); onErrorRef.current?.(null);
        return true;
      } catch (e) {
        // Transient failure (SDK init still settling, a slow/flaky resource load right after the
        // script tag fires, etc.) — the FIRST failure must not be treated as fatal. Return false so
        // the 300ms×25 retry loop below actually runs; only polls>=25 (every attempt exhausted)
        // surfaces a user-visible error. This was the real bug: every path here used to return
        // `true` unconditionally, including this catch — which skipped the retry loop entirely and
        // turned every transient hiccup into an immediate, permanent "Card form error," with the Pay
        // button stuck on "Loading card…" forever.
        console.warn("[PaymentCard] mount attempt failed, will retry:", e instanceof Error ? e.message : e);
        return false;
      }
    };
    (async () => {
      let Square: any;
      try { Square = await loadSquareSdk(); } catch { if (!dead) onErrorRef.current?.("Couldn't load the card form. Try again."); return; }
      if (dead) return;
      if (await tryMount(Square)) return;
      iv = setInterval(async () => {
        polls += 1;
        if (dead || cardRef.current) { if (iv) clearInterval(iv); return; }
        if (await tryMount(Square)) { if (iv) clearInterval(iv); return; }
        if (polls >= 25) { if (iv) clearInterval(iv); if (!cardRef.current) onErrorRef.current?.("Card form didn't load. Refresh and try again — if it keeps happening, tell us."); }
      }, 300);
    })();
    return () => { dead = true; if (iv) clearInterval(iv); cardRef.current?.destroy?.(); cardRef.current = null; onReadyRef.current?.(false); };
  }, [tone]);

  return <div id={idRef.current} className={className} />;
});

export default PaymentCard;
