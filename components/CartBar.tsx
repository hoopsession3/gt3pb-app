"use client";

import { useApp } from "./AppProvider";
import { type DrinkId } from "@/lib/menu";

// Persistent cart/checkout bar — always visible (above the nav) whenever the order
// has something in it, on every screen. Hidden when empty or when checkout is open.
export default function CartBar() {
  const { cart, cartCount, openCheckout, coOpen, priceCents } = useApp();
  if (cartCount === 0 || coOpen) return null;
  const cents = Object.entries(cart).reduce((s, [id, q]) => s + priceCents(id as DrinkId) * q, 0);
  return (
    <button
      className="cartbar"
      onClick={openCheckout}
      aria-label={`Review order, ${cartCount} ${cartCount === 1 ? "item" : "items"}, $${(cents / 100).toFixed(2)}`}
    >
      <span className="cartbar-l">Review <b>{cartCount}</b> drink{cartCount === 1 ? "" : "s"}</span>
      <span className="cartbar-p">${(cents / 100).toFixed(2)}</span>
    </button>
  );
}
