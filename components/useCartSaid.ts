"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { useApp } from "./AppProvider";
import { announce } from "./Announcer";
import { cartSaid } from "@/lib/cartSaid";

// A CHANGE TO THE ORDER, SAID — AND FOCUS KEPT (R12 — the 10/10 audit, F2). Call the returned `track(id)` just before a
// control changes the order (the menu row's "+ $10", a − or + in checkout). Once the order has changed, the change is said
// (lib/cartSaid, components/Announcer) and, when the control pressed is gone from the page — the menu's pill became its
// counter, a − took the last of a line out — focus goes to what `focusAfter` names in its place, never to the top of the
// page. A change the cart refused (the order is full, a payment is open) says nothing here: its own toast says why.
export function useCartSaid(focusAfter?: (id: string, was: number, now: number) => HTMLElement | null | undefined) {
  const { cart, cartCount, nameOf } = useApp();
  const pending = useRef<{ id: string; was: number } | null>(null);
  const then = useRef(focusAfter);
  useLayoutEffect(() => { then.current = focusAfter; });
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    const now = cart[p.id] ?? 0;
    if (now === p.was) return;
    pending.current = null;
    const lost = !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected;
    if (lost) then.current?.(p.id, p.was, now)?.focus({ preventScroll: true });
    announce(cartSaid(nameOf(p.id), p.was, now, cartCount));
  }, [cart, cartCount, nameOf]);
  return useCallback((id: string) => { pending.current = { id, was: cart[id] ?? 0 }; }, [cart]);
}
