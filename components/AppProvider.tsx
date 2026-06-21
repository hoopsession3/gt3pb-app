"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { DrinkId } from "@/lib/menu";

type ToastVariant = "success" | "error" | "info";

interface AppCtx {
  // toast
  toast: (msg: string, variant?: ToastVariant) => void;
  toastMsg: string;
  toastShown: boolean;
  toastVariant: ToastVariant;
  // cart (pre-order) — quantity per drink
  cart: Record<string, number>;
  cartCount: number;
  isInCart: (id: DrinkId) => boolean;
  qtyOf: (id: DrinkId) => number;
  bump: (id: DrinkId) => void;
  inc: (id: DrinkId) => void;
  dec: (id: DrinkId) => void;
  checkout: () => void;
  // drink sheet
  openId: DrinkId | null;
  openDrink: (id: DrinkId) => void;
  closeDrink: () => void;
  // checkout sheet
  coOpen: boolean;
  openCheckout: () => void;
  closeCheckout: () => void;
  // one-tap reorder: replace the cart with a past order and open checkout
  reorder: (items: DrinkId[]) => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within AppProvider");
  return v;
}

export default function AppProvider({ children }: { children: React.ReactNode }) {
  const [toastMsg, setToastMsg] = useState("");
  const [toastShown, setToastShown] = useState(false);
  const [toastVariant, setToastVariant] = useState<ToastVariant>("success");
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string, variant: ToastVariant = "success") => {
    setToastMsg(msg);
    setToastVariant(variant);
    setToastShown(true);
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => setToastShown(false), variant === "error" ? 4200 : 3000);
  }, []);

  const [cart, setCart] = useState<Record<string, number>>({});
  const cartCount = Object.values(cart).reduce((s, n) => s + n, 0);
  const isInCart = useCallback((id: DrinkId) => (cart[id] ?? 0) > 0, [cart]);
  const qtyOf = useCallback((id: DrinkId) => cart[id] ?? 0, [cart]);

  // bump = toggle in/out (menu tap); inc/dec adjust quantity (checkout / detail).
  const bump = useCallback((id: DrinkId) => {
    setCart((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = 1;
      return next;
    });
  }, []);
  const inc = useCallback((id: DrinkId) => setCart((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 })), []);
  const dec = useCallback((id: DrinkId) => setCart((prev) => {
    const next = { ...prev };
    const q = (next[id] ?? 0) - 1;
    if (q <= 0) delete next[id];
    else next[id] = q;
    return next;
  }), []);

  const checkout = useCallback(() => {
    const count = Object.values(cart).reduce((s, n) => s + n, 0);
    if (count === 0) {
      toast("Tap + on a drink to build your order");
      return;
    }
    toast(`${count} drinks pre-ordered — ready in ~8 min`);
    setCart({});
  }, [cart, toast]);

  const [openId, setOpenId] = useState<DrinkId | null>(null);
  const openDrink = useCallback((id: DrinkId) => setOpenId(id), []);
  const closeDrink = useCallback(() => setOpenId(null), []);

  const [coOpen, setCoOpen] = useState(false);
  const openCheckout = useCallback(() => setCoOpen(true), []);
  const closeCheckout = useCallback(() => setCoOpen(false), []);
  // Merge the past order into the current cart (don't clobber a build-in-progress).
  // Only auto-open checkout when the cart was empty; otherwise toast so it's not jarring.
  const reorder = useCallback((items: DrinkId[]) => {
    setCart((prev) => {
      const wasEmpty = Object.keys(prev).length === 0;
      const next = { ...prev };
      items.forEach((id) => { next[id] = (next[id] ?? 0) + 1; });
      if (wasEmpty) setCoOpen(true);
      else toast(`Added ${items.length} to your order`, "success");
      return next;
    });
  }, [toast]);

  const value = useMemo<AppCtx>(
    () => ({ toast, toastMsg, toastShown, toastVariant, cart, cartCount, isInCart, qtyOf, bump, inc, dec, checkout, openId, openDrink, closeDrink, coOpen, openCheckout, closeCheckout, reorder }),
    [toast, toastMsg, toastShown, toastVariant, cart, cartCount, isInCart, qtyOf, bump, inc, dec, checkout, openId, openDrink, closeDrink, coOpen, openCheckout, closeCheckout, reorder]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
