"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import AccountPill from "@/components/AccountPill";
import EditableCopy from "@/components/EditableCopy";
import Watermark from "@/components/Watermark";
import { Masthead, SectionHeader, ClosingBeat } from "@/components/kit";
import { useSiteCopy } from "@/lib/copy";
import { useAvailability } from "@/lib/availability";
import { DRINKS, MENU, type DrinkId } from "@/lib/menu";
import { PACK_SIZES, PACK_TAG, packTotal, dollars } from "@/lib/orderAhead";
import { clickable } from "@/lib/a11y";
import Icon from "@/components/Icon";

export default function MenuScreen() {
  const router = useRouter();
  const { openDrink, isInCart } = useApp();
  const t = useSiteCopy();
  const { soldOut } = useAvailability();
  const [prices, setPrices] = useState<Record<string, number>>({});
  // Prices come from Square Catalog (one source of truth across truck + app).
  useEffect(() => {
    fetch("/api/menu").then((r) => r.json()).then((d) => setPrices(d.prices || {})).catch(() => {});
  }, []);
  // Cents-aware: a flat .toFixed(0) rounded every live price to a whole dollar for display while
  // checkout charges the exact cents (e.g. a $7.50 reprice via Money > Menu would show "$8" here
  // but charge $7.50) — matches the dollars()/money() convention used elsewhere (OrderFunnel, Office).
  const priceLabel = (id: DrinkId) => (prices[id] != null ? `$${(prices[id] / 100).toFixed(prices[id] % 100 === 0 ? 0 : 2)}` : DRINKS[id].px);

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
      {/* No EditCopyPill here (unlike Reserve/Craft/Truck/Member card): every key in the "Menu"
          group is now covered by inline EditableCopy on this page (plus the drink sheet, for
          menu.packs_cutoff) — 2026-07-17, Ryan: a pill that jumps away to Settings is a broken
          affordance, not just a redundant one, once the whole point is staying on the page. Turn
          on Edit mode from the float rail instead — it never leaves this screen. Re-add a pill here
          only if a new Menu-group key ships that ISN'T wired to EditableCopy somewhere in this flow. */}
      <Masthead tone="light" eyebrow={<EditableCopy k="masthead.menu" value={t("masthead.menu")} />} right={<AccountPill />} />

      <EditableCopy k="menu.statement" value={t("menu.statement")} as="p" className="mast-stmt" multiline />
      <EditableCopy k="menu.order_line" value={t("menu.order_line")} as="div" className="mast-order" />

      {/* Menu's own categories below (Activation/Hydration/…) already ARE Craft's three pillars —
          this just names that connection for the customer. Plain text, not EditableCopy: same
          nested-interactive rule as craft.cta_menu/cta_reserve (button, not a wrapped popover). */}
      <button type="button" className="btn-ter" onClick={() => router.push("/craft")}>
        {t("menu.craft_link")} <b><Icon name="arrowRight" /></b>
      </button>
      <button type="button" className="btn-ter" onClick={() => router.push("/primal")} style={{ marginLeft: 18 }}>
        {t("menu.nav_primal")} <b><Icon name="arrowRight" /></b>
      </button>
      <button type="button" className="btn-ter" onClick={() => router.push("/shop")} style={{ marginLeft: 18 }}>
        {t("menu.nav_shop")} <b><Icon name="arrowRight" /></b>
      </button>

      <div className="menu-chips" role="tablist" aria-label="Menu categories">
        {MENU.map((cat, ci) => (
          <button key={cat.name} type="button" role="tab" aria-selected={active === cat.name} className={`menu-chip${active === cat.name ? " on" : ""}`} onClick={() => jumpTo(cat.name)}>{t(`menu.sec.${ci}.name`)}</button>
        ))}
      </div>
      <EditableCopy k="menu.taphint" value={t("menu.taphint")} as="div" className="menu-taphint" />

      {MENU.map((cat, ci) => (
        <div key={cat.name} ref={(el) => { catRefs.current[cat.name] = el; }} data-cat={cat.name}>
          <SectionHeader
            label={<EditableCopy k={`menu.sec.${ci}.name`} value={t(`menu.sec.${ci}.name`)} />}
            annotation={t(`menu.sec.${ci}.sub`) ? <EditableCopy k={`menu.sec.${ci}.sub`} value={t(`menu.sec.${ci}.sub`)} /> : undefined}
          />

          {cat.rows.map((id) => {
            const d = DRINKS[id];
            const on = isInCart(id);
            const out = soldOut.has(id);
            const name = t(`menu.${id}.name`);
            const tag = d.tag ? t(`menu.${id}.tag`) : "";
            return (
              <div
                className={`entry${out ? " entry-86" : ""}`}
                key={id}
                aria-label={`${name}, ${out ? "sold out today" : priceLabel(id)}, view details`}
                {...clickable(() => openDrink(id))}
              >
                <div className="entry-head">
                  <span className="entry-dot" style={{ background: d.dot }} />
                  <span className="entry-name">{name}</span>
                  {out ? <span className="entry-out">{t("menu.sold_out")}</span> : tag ? <span className="entry-tag">{tag}</span> : null}
                  <span className="entry-gap" />
                  {on && !out && <span className="entry-in" aria-label="in your order"><Icon name="check" /></span>}
                  {/* the price is the order affordance (2026-08-01 audit: rows read as a printed
                      menu). A styled pill — not a nested <button>; the whole row is already the
                      tap target (clickable above), same a11y rule as the category chips. */}
                  <span className={`entry-px${out ? "" : " order"}`}>{priceLabel(id)}</span>
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

      {/* Pack upsell — the take-home path. Prices come from the order-ahead grid (lib/orderAhead),
          both glass paths shown honestly; the bring-back-or-new choice itself is made in Reserve. */}
      <SectionHeader
        label={<EditableCopy k="menu.packs_title" value={t("menu.packs_title")} />}
        annotation={t("menu.packs_sub") ? <EditableCopy k="menu.packs_sub" value={t("menu.packs_sub")} /> : undefined}
      />
      <div className="mpack">
        {PACK_SIZES.map((s) => (
          <div className="mpack-row" key={s}>
            <span className="mpack-n"><b>{s}</b> bottles{PACK_TAG[s] ? <em className="mpack-tag">{PACK_TAG[s]}</em> : null}</span>
            <span className="mpack-px"><b>{dollars(packTotal(s, "return"))}</b> bring-back</span>
          </div>
        ))}
        <EditableCopy k="menu.packs_note" value={t("menu.packs_note")} as="div" className="mpack-note" multiline />
        <Link href="/reserve" className="mpack-cta">{t("menu.reserve_pack")}</Link>
      </div>

      <EditableCopy k="menu.integrity" value={t("menu.integrity")} as="div" className="menu-integrity" />
      {/* menu.mto retired 2026-07-30 (redundancy audit): "Made to order" was the third telling of
          the same message on this one page — the hero already closes "every cup made the moment
          you order" and the integrity line above says it again. One message, one home. */}

      <ClosingBeat />
    </section>
  );
}
