"use client";

import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import AccountPill from "@/components/AccountPill";
import Checkout from "@/components/Checkout";
import { DRINKS, MENU } from "@/lib/menu";
import { clickable } from "@/lib/a11y";

export default function MenuScreen() {
  const { openDrink, qtyOf, cartCount, toast } = useApp();
  const [coOpen, setCoOpen] = useState(false);
  const coLbl = cartCount > 0 ? `Checkout · ${cartCount}` : "Pre-order for pickup";

  return (
    <section className="screen" id="s-menu">
      <div className="toprow">
        <div className="eyb">The NET+ Menu</div>
        <AccountPill />
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
            const q = qtyOf(row.id);
            return (
              <div className="drink" key={row.id} aria-label={`${d.n}, ${d.px}${q > 0 ? `, ${q} in order` : ""}, view details`} {...clickable(() => openDrink(row.id))}>
                <div className="sw" style={{ background: d.grad }}>{d.n}</div>
                <div className="dm"><b>{d.n}</b><span>{row.blurb}</span></div>
                <div className="rt">
                  <span className="px">{d.px}</span>
                  <div className={`plus${q > 0 ? " on" : ""}`}>{q > 0 ? q : "+"}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <button className="handle" onClick={() => (cartCount === 0 ? toast("Tap + on a drink to build your order") : setCoOpen(true))}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M5 12l5 5L20 7" /></svg>
        <span>{coLbl}</span>
      </button>

      <Checkout open={coOpen} onClose={() => setCoOpen(false)} />
    </section>
  );
}
