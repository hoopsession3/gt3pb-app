"use client";

import { useCallback, useRef } from "react";
import { EMPTY_IDEM, nextIdem, type IdemState } from "@/lib/idempotency";

// ONE IDEMPOTENCY KEY HOLDER for every card checkout in this app.
//
// The rule it enforces, and why it is a hook rather than a note in a comment, is in
// lib/idempotency.ts: the card nonce is part of the request Square compares, and a key derived
// only from the ORDER strands the customer permanently on their second attempt. Three of the four
// payment paths here had that defect. Passing the nonce is not optional in this signature.
//
// `persist` writes through sessionStorage, which the pack reserve flow needs because its checkout
// survives a route change. It is best-effort by design — a private window that throws on
// sessionStorage must still be able to buy something, and the fallback (an in-memory key) is
// correct, just less able to dedupe across a reload.

export type UseIdemKey = (sourceId: string | null | undefined, details: unknown) => string;

export function useIdemKey(persist?: string): UseIdemKey {
  const ref = useRef<IdemState | null>(null);
  if (ref.current === null) {
    ref.current = EMPTY_IDEM;
    if (persist && typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem(persist);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.sig === "string" && typeof parsed.key === "string") ref.current = parsed;
        }
      } catch { /* a blocked or cleared store is not a reason to fail a checkout */ }
    }
  }
  // Stable identity: a caller that wraps its pay handler in useCallback can list this in its deps
  // without re-creating the handler every render. All the state lives in the ref.
  return useCallback<UseIdemKey>((sourceId, details) => {
    const next = nextIdem(ref.current, sourceId, details);
    if (next !== ref.current) {
      ref.current = next;
      if (persist && typeof window !== "undefined") {
        try { sessionStorage.setItem(persist, JSON.stringify(next)); } catch { /* ignore */ }
      }
    }
    return next.key;
  }, [persist]);
}
