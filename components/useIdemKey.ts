"use client";

import { useMemo, useRef, useState } from "react";
import type { PayAttempt } from "@/lib/idempotency";
import { DURABLE_KEY_MS } from "@/lib/payHold";

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
// charging it again. `durable` writes it through localStorage instead, beside the cart (below).
// Best-effort by design — a private window that throws on either store must still be able to buy
// something, and the fallback (an in-memory key) is correct, just unable to survive a reload.

export type Tokenize = () => Promise<{ status: string; token?: string }>;

/** One send: the key, and the card token that goes with it (null for a pay-later send). `retry`: the same key and token
 *  again, because the last answer never came — the first send may have been charged. */
export type Attempt = { key: string; token: string | null; cardRefused?: boolean; retry?: boolean };

export type CheckoutKey = {
  /** `was`: what this checkout was signed as before its signature changed shape (lib/idempotency attemptFor). */
  begin: (details: unknown, tokenize?: Tokenize, was?: readonly unknown[]) => Promise<Attempt>;
  settle: (key: string, status: number | null, body: unknown) => void;
  /** Whether the last answer under the held key never came — it may have been charged (R7): the cart holds still. */
  isOpen: () => boolean;
  /** Let the held key go, by the customer's own choice, once the crew has said the first payment did not go through. */
  forget: () => void;
  /** The send is about to leave (R7b): the key is held open until its answer, so an app closed mid-payment reopens
   *  holding it — not as a fresh cart whose next change is a second charge. `card`: a card send, or a pre-order's. */
  sent: (key: string, card: boolean) => void;
  /** The key being held, and whether its send was a card's — what "Check on my payment" asks about (R7b). */
  heldKey: () => string;
  heldCard: () => boolean;
  /** What the held key was signed over — the order itself — while its answer never came, else null (R8): a page holds
   *  that order still (how many, the total) when what it reads moves under it, so the next tap is the same request. */
  heldDetails: () => unknown;
};

// DURABLE (2026-10-12, C7 of the customer audit, approved): the cart survives the app being closed — it is kept in
// localStorage — and the key that stops a double charge did not: sessionStorage goes with the app's process. Pay, the
// answer lost, the app closed, the cart still there, Pay again: a new key, and Square charged the card again. A checkout
// whose server claims its key (the cup checkout, lib/chargeOnce) keeps the key where the cart is, so a retry after a
// restart is answered from the first request. A durable key is forgotten after two hours (lib/payHold DURABLE_KEY_MS): a
// lost answer is retried in minutes, and the same cart much later is a new order — the claim would answer it with the old
// one's "order in".
//
// OPEN (2026-10-15, R7 of the customer re-audit): the record says whether the last answer under the key never came, so a
// restart knows the cart is waiting on a payment (lib/payHold) — and the page knows to hold the cart and tip still.
// FROM THE SEND (R7b, 2026-10-16): open is written as the send leaves, not when its answer is found lost — an app swiped
// away mid-payment never finds out, and reopened as a fresh cart whose next change went out under a new key. The answer
// closes it again; the two hours count from the last send; and the record says whether the send was a card's.
const storage = (durable: boolean): Storage | null => {
  try { return durable ? window.localStorage : window.sessionStorage; } catch { return null; }
};

type Held = { attempt: PayAttempt; open: boolean; at: number | null; card: boolean };
const NOTHING: Held = { attempt: EMPTY, open: false, at: null, card: true };

/** The key a reload (or, durable, a restart) left behind, if any. Never a card token: those are not written anywhere. */
function stored(persist?: string, durable = false): Held {
  if (!persist || typeof window === "undefined") return NOTHING;
  try {
    const st = storage(durable);
    const parsed = JSON.parse(st?.getItem(persist) ?? "null");
    if (parsed && typeof parsed.sig === "string" && typeof parsed.key === "string") {
      if (durable && !(typeof parsed.at === "number" && Date.now() - parsed.at < DURABLE_KEY_MS)) { st?.removeItem(persist); return NOTHING; }
      return { attempt: { sig: parsed.sig, key: parsed.key, token: null }, open: parsed.open === true, at: typeof parsed.at === "number" ? parsed.at : null, card: parsed.card !== false };
    }
  } catch { /* a blocked or cleared store is not a reason to fail a checkout */ }
  return NOTHING;
}

/** Whether a checkout's key is being held — what the page restores alongside it (the cup checkout's tip). */
export function holdsKey(persist: string, durable = false): boolean {
  return stored(persist, durable).attempt.key !== "";
}

export function useIdemKey(persist?: string, durable = false): CheckoutKey {
  // Everything this checkout holds, read once from the store (a reload's, or — durable — a restart's key).
  const held = useRef<Held | null>(null);
  if (held.current === null) held.current = stored(persist, durable);
  // The page draws the hold (the cart and the tip still) from isOpen(); this re-renders it when the answer turns.
  const [, setOpen] = useState(false);
  // Stable identity: a caller that wraps its pay handler in useCallback can list this in its deps
  // without re-creating the handler every render. All the state lives in the ref.
  return useMemo<CheckoutKey>(() => {
    const now = (): Held => held.current ?? NOTHING;
    const write = (h: Held) => {
      if (!persist || typeof window === "undefined") return;
      try {
        const st = storage(durable);
        const a = h.attempt;
        if (a.key) st?.setItem(persist, JSON.stringify(durable ? { sig: a.sig, key: a.key, at: h.at ?? Date.now(), open: h.open, card: h.card } : { sig: a.sig, key: a.key, open: h.open, card: h.card }));
        else st?.removeItem(persist);
      } catch { /* ignore */ }
    };
    const keep = (next: PayAttempt, open: boolean) => {
      const cur = now();
      const keyChanged = next.key !== cur.attempt.key;
      const changed = keyChanged || next.sig !== cur.attempt.sig || open !== cur.open;
      const at = keyChanged ? (next.key ? Date.now() : null) : cur.at;
      held.current = { attempt: next, open, at, card: keyChanged ? true : cur.card };
      setOpen(open);
      if (changed) write(held.current);
    };
    return {
      async begin(details, tokenize, was) {
        const { attemptFor } = await rules();
        const cur = now();
        const a = attemptFor(cur.attempt, details, undefined, was);
        // A new key is a new checkout: nothing is waiting on it yet.
        if (a !== cur.attempt) keep(a, a.key === cur.attempt.key && cur.open);
        if (!tokenize) return { key: a.key, token: null };
        if (a.token) return { key: a.key, token: a.token, retry: true };
        const r = await tokenize();
        if (r.status !== "OK" || !r.token) return { key: a.key, token: null, cardRefused: true };
        // Held against THIS key only: if the cart changed while the card form was answering, the token
        // belongs to the send that asked for it and to nothing after it.
        const after = now();
        if (after.attempt.key === a.key) held.current = { ...after, attempt: { ...after.attempt, token: r.token } };
        return { key: a.key, token: r.token };
      },
      settle(key, status, body) {
        const cur = now().attempt;
        if (!cur.key || cur.key !== key) return;
        void rules().then(({ afterAttempt, attemptVerdict }) => {
          if (now().attempt !== cur) return;
          const verdict = attemptVerdict(status, body);
          keep(afterAttempt(cur, verdict), verdict === "unknown");
        });
      },
      isOpen: () => now().open && now().attempt.key !== "",
      forget() { keep(EMPTY, false); },
      sent(key, card) {
        const cur = now();
        if (!cur.attempt.key || cur.attempt.key !== key) return;
        held.current = { ...cur, open: true, at: Date.now(), card };
        setOpen(true);
        write(held.current);
      },
      heldKey: () => now().attempt.key,
      heldCard: () => now().card,
      heldDetails: () => {
        const c = now();
        if (!c.open || !c.attempt.key) return null;
        // lib/idempotency idemSignature: the nonce, a NUL, then the details as JSON.
        const at = c.attempt.sig.indexOf("\u0000");
        try { return at >= 0 ? JSON.parse(c.attempt.sig.slice(at + 1)) : null; } catch { return null; }
      },
    };
  }, [persist, durable]);
}
