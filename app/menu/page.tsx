"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import AccountPill from "@/components/AccountPill";
import Watermark from "@/components/Watermark";
import Gt3Mark from "@/components/Gt3Mark";
import { useSiteCopy } from "@/lib/copy";
import { DRINKS, MENU, type DrinkId } from "@/lib/menu";
import { clickable } from "@/lib/a11y";

export default function MenuScreen() {
  const { openDrink, isInCart, cartCount, toast } = useApp();
  const t = useSiteCopy();
  const [prices, setPrices] = useState<Record<string, number>>({});
  // Prices come from Square Catalog (one source of truth across truck + app).
  useEffect(() => {
    fetch("/api/menu").then((r) => r.json()).then((d) => setPrices(d.prices || {})).catch(() => {});
  }, []);
  const priceLabel = (id: DrinkId) => (prices[id] != null ? `$${(prices[id] / 100).toFixed(0)}` : DRINKS[id].px);

  // Sticky category chips that scroll-spy the menu (jump + highlight current section).
  const [active, setActive] = useState<string>(MENU[0]?.name ?? "");
  const catRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    const root = document.getElementById("body");
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const cat = (vis?.target as HTMLElement | undefined)?.dataset.cat;
        if (cat) setActive(cat);
      },
      { root, rootMargin: "-12% 0px -75% 0px", threshold: [0, 0.5, 1] }
    );
    Object.values(catRefs.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);
  const jumpTo = (name: string) => catRefs.current[name]?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <section className="screen menu" id="s-menu">
      <Watermark variant="menu" />
      <div className="toprow">
        <div className="mast-brand">
          <Gt3Mark tone="ink" />
          <span className="pb">Performance Bar</span>
        </div>
        <AccountPill />
      </div>

      <p className="mast-stmt">{t("menu.statement")}</p>
      <div className="mast-order">{t("menu.order_line")}</div>

      <div className="menu-chips" role="tablist" aria-label="Menu categories">
        {MENU.map((cat, ci) => (
          <button key={cat.name} type="button" role="tab" aria-selected={active === cat.name} className={`menu-chip${active === cat.name ? " on" : ""}`} onClick={() => jumpTo(cat.name)}>{t(`menu.sec.${ci}.name`)}</button>
        ))}
      </div>

      {MENU.map((cat, ci) => (
        <div key={cat.name} ref={(el) => { catRefs.current[cat.name] = el; }} data-cat={cat.name}>
          <div className="chapter">
            <span className="chn">{t(`menu.sec.${ci}.name`)}</span>
            <span className="chw">{t(`menu.sec.${ci}.sub`)}</span>
          </div>
          <div className="chrule" />

          {cat.rows.map((id) => {
            const d = DRINKS[id];
            const on = isInCart(id);
            const name = t(`menu.${id}.name`);
            const tag = d.tag ? t(`menu.${id}.tag`) : "";
            return (
              <div
                className="entry"
                key={id}
                aria-label={`${name}, ${priceLabel(id)}, view details`}
                {...clickable(() => openDrink(id))}
              >
                <div className="entry-head">
                  <span className="entry-dot" style={{ background: d.dot }} />
                  <span className="entry-name">{name}</span>
                  {tag && <span className="entry-tag">{tag}</span>}
                  <span className="entry-gap" />
                  {on && <span className="entry-in" aria-label="in your order">✓</span>}
                  <span className="entry-px">{priceLabel(id)}</span>
                </div>
                <div className="entry-body">
                  {t(`menu.${id}.lines`).split("\n").filter(Boolean).map((l) => (
                    <div className="entry-ing" key={l}>{l}</div>
                  ))}
                  <div className="entry-why">{t(`menu.${id}.why`)}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <div className="menu-integrity">{t("menu.integrity")}</div>
      <div className="menu-mto">{t("menu.mto")}</div>

      {/* Empty-state hint only; once items are added the floating CartBar takes over. */}
      {cartCount === 0 && (
        <button className="order-bar" onClick={() => toast("Tap a drink to read it, then add to your order")}>
          Order here · tap a drink
        </button>
      )}
    </section>
  );
}
