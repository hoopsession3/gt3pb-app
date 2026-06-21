"use client";

import { useApp } from "./AppProvider";
import { DRINKS, type DrinkId } from "@/lib/menu";

// Persistent cart/checkout bar — always visible (above the nav) whenever the order
// has something in it, on every screen. Hidden when empty or when checkout is open.
export default function CartBar() {
  const { cart, cartCount, openCheckout, coOpen } = useApp();
  if (cartCount === 0 || coOpen) return null;
  const cents = Object.entries(cart).reduce(
    (s, [id, q]) => s + Math.round(parseFloat(DRINKS[id as DrinkId].px.replace("$", "")) * 100) * q,
    0
  );
  return (
    <button
      className="cartbar"
      onClick={openCheckout}
      aria-label={`Review order, ${cartCount} ${cartCount === 1 ? "item" : "items"}, $${(cents / 100).toFixed(2)}`}
    >
      <span className="cartbar-n">{cartCount}</span>
      <span className="cartbar-l">Review order</span>
      <span className="cartbar-p">${(cents / 100).toFixed(2)}</span>
    </button>
  );
}
