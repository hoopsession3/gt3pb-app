"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DRINKS, type DrinkId } from "@/lib/menu";
import { useAvailability } from "@/lib/availability";

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
  checkout: (opts?: { silentToast?: boolean }) => void;
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
  // authoritative price (cents) for a drink — Square Catalog if configured, else catalog fallback
  priceCents: (id: DrinkId) => number;
}

// Catalog fallback price (cents) parsed from the bundled menu — used until /api/menu loads.
const fallbackCents = (id: DrinkId) => Math.round(parseFloat(DRINKS[id].px.replace("$", "")) * 100);

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

  // One source of truth for prices: Square Catalog via /api/menu (falls back to the
  // bundled catalog per-drink until it loads / when Square isn't configured). Shared so
  // the cart bar, the menu, and checkout can never show three different totals.
  const [prices, setPrices] = useState<Record<string, number>>({});
  useEffect(() => {
    let on = true;
    fetch("/api/menu").then((r) => (r.ok ? r.json() : null)).then((d) => { if (on && d) setPrices(d.prices || {}); }).catch(() => {});
    return () => { on = false; };
  }, []);
  const priceCents = useCallback((id: DrinkId) => prices[id] ?? fallbackCents(id), [prices]);

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

  const checkout = useCallback((opts?: { silentToast?: boolean }) => {
    const count = Object.values(cart).reduce((s, n) => s + n, 0);
    if (count === 0) {
      toast("Tap + on a drink to build your order");
      return;
    }
    // Callers that already showed their own (more specific, e.g. a payment reference code) toast
    // right before calling checkout() pass silentToast — otherwise this generic one and the caller's
    // fire in the same batched render pass, and only the LAST setState-triggered toast ever renders.
    // That used to silently swallow a customer's "show this ref at the window" fallback message.
    if (!opts?.silentToast) toast(`${count} drinks pre-ordered — ready in ~8 min`);
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
  // 86'd items are filtered here so one-tap reorder can never build a cart that dead-ends at
  // checkout — the customer is told what's out, and the rest of their usual carries on.
  const { soldOut } = useAvailability();
  const reorder = useCallback((items: DrinkId[]) => {
    const out = [...new Set(items.filter((id) => soldOut.has(id)))].map((id) => DRINKS[id]?.n ?? id);
    const ok = items.filter((id) => !soldOut.has(id) && DRINKS[id]); // drop unknown/legacy ids — Checkout reads DRINKS[id] unguarded
    if (out.length) toast(`${out.join(" · ")} ${out.length === 1 ? "is" : "are"} sold out today${ok.length ? " — added the rest" : ""}`, "error");
    if (ok.length === 0) return;
    setCart((prev) => {
      const wasEmpty = Object.keys(prev).length === 0;
      const next = { ...prev };
      ok.forEach((id) => { next[id] = (next[id] ?? 0) + 1; });
      if (wasEmpty) setCoOpen(true);
      else toast(`Added ${ok.length} to your order`, "success");
      return next;
    });
  }, [toast, soldOut]);

  const value = useMemo<AppCtx>(
    () => ({ toast, toastMsg, toastShown, toastVariant, cart, cartCount, isInCart, qtyOf, bump, inc, dec, checkout, openId, openDrink, closeDrink, coOpen, openCheckout, closeCheckout, reorder, priceCents }),
    [toast, toastMsg, toastShown, toastVariant, cart, cartCount, isInCart, qtyOf, bump, inc, dec, checkout, openId, openDrink, closeDrink, coOpen, openCheckout, closeCheckout, reorder, priceCents]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
