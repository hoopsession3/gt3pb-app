"use client";

import { useApp } from "./AppProvider";
import { type DrinkId } from "@/lib/menu";
import { money } from "@/lib/money";

// Persistent DRINKS cart bar — always visible (above the nav) whenever the drink order has
// something in it, on every screen. Hidden when empty, and hidden while ANY checkout is on screen.
//
// It used to hide for coOpen alone, which is the drinks sheet. The shop has its own checkout view
// and its own cart, so this bar floated across the bottom of it reading "Review 1 drink · $10" on
// top of a "PAY $32" button for a cap. Two carts on one screen, each quoting the other's total.
export default function CartBar() {
  const { cart, cartCount, openCheckout, coOpen, payOpen, priceCents } = useApp();
  if (cartCount === 0 || coOpen || payOpen) return null;
  const cents = Object.entries(cart).reduce((s, [id, q]) => s + priceCents(id as DrinkId) * q, 0);
  return (
    <button
      className="cartbar"
      onClick={openCheckout}
      aria-label={`Review order, ${cartCount} ${cartCount === 1 ? "item" : "items"}, ${money(cents)}`}
    >
      <span className="cartbar-l">Review <b>{cartCount}</b> drink{cartCount === 1 ? "" : "s"}</span>
      <span className="cartbar-p">{money(cents)}</span>
    </button>
  );
}
