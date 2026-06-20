"use client";

import Link from "next/link";
import { useApp } from "@/components/AppProvider";
import { DRINKS, MENU } from "@/lib/menu";
import { clickable } from "@/lib/a11y";

export default function MenuScreen() {
  const { openDrink, isInCart, cart, checkout } = useApp();
  const coLbl = cart.size > 0 ? `Pre-order ${cart.size} for pickup` : "Pre-order for pickup";

  return (
    <section className="screen" id="s-menu">
      <div className="toprow">
        <div className="eyb">The NET+ Menu</div>
        <Link className="pf" href="/3mpire">R</Link>
      </div>
      <div className="h-title">Built for the work.</div>
      <div className="h-sub">Whole-food functional beverages. Nothing toxic. Before, during &amp; after.</div>

      <div className="phaseflow">
        <div className="pf-step"><div className="s">S1</div><div className="n">ACTIVATE</div><div className="w">before</div></div>
        <div className="pf-step"><div className="s">S2</div><div className="n">HYDRATE</div><div className="w">during</div></div>
        <div className="pf-step"><div className="s">S3</div><div className="n">REBUILD</div><div className="w">after</div></div>
      </div>

      {MENU.map((cat) => (
        <div key={cat.sx}>
          <div className="menucat"><span className="sx">{cat.sx}</span>{cat.name}<span className="wn">{cat.wn}</span></div>
          {cat.rows.map((row) => {
            const d = DRINKS[row.id];
            const on = isInCart(row.id);
            return (
              <div className="drink" key={row.id} aria-label={`${d.n}, ${d.px}, view details`} {...clickable(() => openDrink(row.id))}>
                <div className="sw" style={{ background: d.grad }}>{d.n}</div>
                <div className="dm"><b>{d.n}</b><span>{row.blurb}</span></div>
                <div className="rt">
                  <span className="px">{d.px}</span>
                  <div className={`plus${on ? " on" : ""}`}>{on ? "✓" : "+"}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <button className="handle" onClick={checkout}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M5 12l5 5L20 7" /></svg>
        <span>{coLbl}</span>
      </button>
    </section>
  );
}
