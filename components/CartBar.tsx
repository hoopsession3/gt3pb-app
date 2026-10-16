"use client";

import { useMemo } from "react";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { money } from "@/lib/money";
import { authedFetch } from "@/lib/authedFetch";
import { useAsyncData } from "@/lib/useAsyncData";

// Persistent DRINKS cart bar — always visible (above the nav) whenever the drink order has
// something in it, on every screen. Hidden when empty, and hidden while ANY checkout is on screen.
//
// It used to hide for coOpen alone, which is the drinks sheet. The shop has its own checkout view
// and its own cart, so this bar floated across the bottom of it reading "Review 1 drink · $10" on
// top of a "PAY $32" button for a cap. Two carts on one screen, each quoting the other's total.
//
// A MEMBER'S PRICE, HERE TOO (2026-10-15, R7 of the customer re-audit). The bar added up the menu's prices, and checkout
// priced the same cart with a member's perks (/api/checkout/quote, C2): a founding member read one total here and a
// lower one a tap later. For someone signed in the bar asks the same quote, and shows the menu's sum only until it
// answers — a guest has no perks, and the menu's prices are theirs. When the server can't say a member's price just now,
// the bar says no number rather than the menu's: checkout says why, and checks before the card is charged.
export default function CartBar() {
  const { cart, cartCount, openCheckout, coOpen, payOpen, priceCents } = useApp();
  const { user } = useAuth();
  const items = useMemo(() => Object.entries(cart).flatMap(([id, q]) => Array<string>(q).fill(id)).join(","), [cart]);
  const quoted = useAsyncData<{ items: string; cents: number } | null>(async () => {
    if (!user || !items) return null;
    const r = await authedFetch("/api/checkout/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: items.split(",") }) });
    const d = r.ok ? await r.json() : null;
    if (!d || typeof d.subtotalCents !== "number") throw new Error("The price couldn't be checked just now.");
    return { items, cents: d.subtotalCents };
  }, [user?.id, items]);
  if (cartCount === 0 || coOpen || payOpen) return null;
  const menuCents = Object.entries(cart).reduce((s, [id, q]) => s + priceCents(id) * q, 0);
  const cents = quoted.data && quoted.data.items === items ? quoted.data.cents : user && quoted.error ? null : menuCents;
  return (
    <button
      className="cartbar"
      onClick={openCheckout}
      aria-label={`Review order, ${cartCount} ${cartCount === 1 ? "item" : "items"}${cents !== null ? `, ${money(cents)}` : ""}`}
    >
      <span className="cartbar-l">Review <b>{cartCount}</b> drink{cartCount === 1 ? "" : "s"}</span>
      {cents !== null && <span className="cartbar-p">{money(cents)}</span>}
    </button>
  );
}
