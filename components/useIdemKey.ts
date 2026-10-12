"use client";

import { useMemo, useRef } from "react";
import type { PayAttempt } from "@/lib/idempotency";

// THE RULES LOAD WITH THE FIRST TAP OF PAY (2026-10-11). The pack funnel draws on /shop's first paint
// (components/Shop → OrderFunnel), and this hook carried lib/idempotency into that page whole — the attempt
// rules and every word a declined card can be told — for a tap most visitors never make. begin() is already
// asynchronous; settle() hands its answer over once the module is in (the same promise, so a settle is
// applied before the begin that follows it).
const rules = () => import("@/lib/idempotency");
const EMPTY: PayAttempt = { sig: "", key: "", token: null };   // lib/idempotency's NO_ATTEMPT, without loading it

// ONE KEY PER CHECKOUT — the holder every card checkout in this app sends its idempotency key from.
//
// The key is what stops Square charging a card twice: the same key again and Square replays the first
// result. Until 2026-10-11 this hook signed the card token into the key, and every tap of Pay asked the
// card form for a new token — so a retry after a lost answer (the money went, the phone never heard)
// went out under a NEW key and was charged again. The rule now lives in lib/idempotency.ts (attemptFor,
// attemptVerdict, afterAttempt); this is only where it is kept:
//
//   begin(details, tokenize)   the key for what is being bought, and the card token to send with it —
//                              the one already sent under that key while its outcome is open, else a
//                              fresh one from the card form. No tokenize: a pay-later send, no card.
//   settle(key, status, body)  after the answer, or with status null when none came. Paid or declined
//                              forgets the key; "may have been charged" keeps the key and the token.
//
// `persist` writes the key — never the card token — through sessionStorage, so reloading the app keeps
// the checkout's key: the cup checkout's server answers it from its claim (lib/chargeOnce) instead of
// charging it again. Best-effort by design — a private window that throws on sessionStorage must still
// be able to buy something, and the fallback (an in-memory key) is correct, just unable to survive a
// reload.

export type Tokenize = () => Promise<{ status: string; token?: string }>;

/** One send: the key, and the card token that goes with it (null for a pay-later send). `retry`: the same key and token
 *  again, because the last answer never came — the first send may have been charged. */
export type Attempt = { key: string; token: string | null; cardRefused?: boolean; retry?: boolean };

export type CheckoutKey = {
  begin: (details: unknown, tokenize?: Tokenize) => Promise<Attempt>;
  settle: (key: string, status: number | null, body: unknown) => void;
};

/** The key a reload left behind, if any. Never a card token: those are not written anywhere. */
function stored(persist?: string): PayAttempt {
  if (!persist || typeof window === "undefined") return EMPTY;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(persist) ?? "null");
    if (parsed && typeof parsed.sig === "string" && typeof parsed.key === "string") return { sig: parsed.sig, key: parsed.key, token: null };
  } catch { /* a blocked or cleared store is not a reason to fail a checkout */ }
  return EMPTY;
}

export function useIdemKey(persist?: string): CheckoutKey {
  const ref = useRef<PayAttempt | null>(null);
  if (ref.current === null) ref.current = stored(persist);
  // Stable identity: a caller that wraps its pay handler in useCallback can list this in its deps
  // without re-creating the handler every render. All the state lives in the ref.
  return useMemo<CheckoutKey>(() => {
    const keep = (next: PayAttempt) => {
      const keyChanged = next.key !== ref.current?.key;
      ref.current = next;
      if (!keyChanged || !persist || typeof window === "undefined") return;
      try {
        if (next.key) sessionStorage.setItem(persist, JSON.stringify({ sig: next.sig, key: next.key }));
        else sessionStorage.removeItem(persist);
      } catch { /* ignore */ }
    };
    return {
      async begin(details, tokenize) {
        const { attemptFor } = await rules();
        const a = attemptFor(ref.current, details);
        if (a !== ref.current) keep(a);
        if (!tokenize) return { key: a.key, token: null };
        if (a.token) return { key: a.key, token: a.token, retry: true };
        const r = await tokenize();
        if (r.status !== "OK" || !r.token) return { key: a.key, token: null, cardRefused: true };
        // Held against THIS key only: if the cart changed while the card form was answering, the token
        // belongs to the send that asked for it and to nothing after it.
        if (ref.current?.key === a.key) ref.current = { ...ref.current, token: r.token };
        return { key: a.key, token: r.token };
      },
      settle(key, status, body) {
        const cur = ref.current;
        if (!cur || !cur.key || cur.key !== key) return;
        void rules().then(({ afterAttempt, attemptVerdict }) => {
          if (ref.current === cur) keep(afterAttempt(cur, attemptVerdict(status, body)));
        });
      },
    };
  }, [persist]);
}
