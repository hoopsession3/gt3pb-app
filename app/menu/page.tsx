"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import AccountPill from "@/components/AccountPill";
import { DRINKS, MENU, type DrinkId } from "@/lib/menu";
import { clickable } from "@/lib/a11y";

export default function MenuScreen() {
  const { openDrink, isInCart, cartCount, toast } = useApp();
  const [prices, setPrices] = useState<Record<string, number>>({});
  // Prices come from Square Catalog (one source of truth across truck + app).
  useEffect(() => {
    fetch("/api/menu").then((r) => r.json()).then((d) => setPrices(d.prices || {})).catch(() => {});
  }, []);
  const priceLabel = (id: DrinkId) => (prices[id] != null ? `$${(prices[id] / 100).toFixed(0)}` : DRINKS[id].px);

  return (
    <section className="screen menu" id="s-menu">
      <div className="toprow">
        <div className="mast-brand">
          <span className="g3">GT3</span>
          <span className="pb">Performance Bar</span>
        </div>
        <AccountPill />
      </div>

      <p className="mast-stmt">
        Cold-extracted coffee, whole-food hydration, and slow-simmered fuel&nbsp;— prepared to order.
      </p>
      <div className="mast-order">Order here — ready when you reach the truck.</div>

      {MENU.map((cat) => (
        <div key={cat.name}>
          <div className="chapter">
            <span className="chn">{cat.name}</span>
            <span className="chw">{cat.wn}</span>
          </div>
          <div className="chrule" />

          {cat.rows.map((id) => {
            const d = DRINKS[id];
            const on = isInCart(id);
            return (
              <div
                className="entry"
                key={id}
                aria-label={`${d.n}, ${priceLabel(id)}, view details`}
                {...clickable(() => openDrink(id))}
              >
                <div className="entry-head">
                  <span className="entry-dot" style={{ background: d.dot }} />
                  <span className="entry-name">{d.n}</span>
                  {d.tag && <span className="entry-tag">{d.tag}</span>}
                  <span className="entry-gap" />
                  {on && <span className="entry-in" aria-label="in your order">✓</span>}
                  <span className="entry-px">{priceLabel(id)}</span>
                </div>
                <div className="entry-body">
                  {d.lines.map((l) => (
                    <div className="entry-ing" key={l}>{l}</div>
                  ))}
                  <div className="entry-why">{d.why}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <div className="menu-integrity">No plastic contact · No powders · No artificial anything</div>
      <div className="menu-mto">Made to order</div>

      {/* Empty-state hint only; once items are added the floating CartBar takes over. */}
      {cartCount === 0 && (
        <button className="order-bar" onClick={() => toast("Tap a drink to read it, then add to your order")}>
          Order here · tap a drink
        </button>
      )}
    </section>
  );
}
