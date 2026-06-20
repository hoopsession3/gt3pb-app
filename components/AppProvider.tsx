"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { DrinkId } from "@/lib/menu";

interface AppCtx {
  // toast
  toast: (msg: string) => void;
  toastMsg: string;
  toastShown: boolean;
  // cart (pre-order)
  cart: Set<DrinkId>;
  isInCart: (id: DrinkId) => boolean;
  bump: (id: DrinkId) => void;
  checkout: () => void;
  // drink sheet
  openId: DrinkId | null;
  openDrink: (id: DrinkId) => void;
  closeDrink: () => void;
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
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastShown(true);
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => setToastShown(false), 3000);
  }, []);

  const [cart, setCart] = useState<Set<DrinkId>>(new Set());
  const isInCart = useCallback((id: DrinkId) => cart.has(id), [cart]);

  const bump = useCallback((id: DrinkId) => {
    setCart((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const checkout = useCallback(() => {
    setCart((prev) => {
      if (prev.size === 0) {
        toast("Tap + on a drink to build your order");
        return prev;
      }
      toast(`${prev.size} drinks pre-ordered — ready in ~8 min`);
      return new Set();
    });
  }, [toast]);

  const [openId, setOpenId] = useState<DrinkId | null>(null);
  const openDrink = useCallback((id: DrinkId) => setOpenId(id), []);
  const closeDrink = useCallback(() => setOpenId(null), []);

  const value = useMemo<AppCtx>(
    () => ({ toast, toastMsg, toastShown, cart, isInCart, bump, checkout, openId, openDrink, closeDrink }),
    [toast, toastMsg, toastShown, cart, isInCart, bump, checkout, openId, openDrink, closeDrink]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
