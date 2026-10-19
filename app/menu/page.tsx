"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, useServerMenu } from "@/components/AppProvider";
import { useCartSaid } from "@/components/useCartSaid";
import AccountPill from "@/components/AccountPill";
import EditableCopy from "@/components/EditableCopy";
import Watermark from "@/components/Watermark";
import { Masthead, SectionHeader, ClosingBeat } from "@/components/kit";
import { useSiteCopy } from "@/lib/copy";
import { useCupAvailability } from "@/components/useCupAvailability";
import { useViewerMarket } from "@/components/useViewerMarket";
import { useOrderingOpen } from "@/components/useOrderingOpen";
import { closedWords, openWords } from "@/lib/ordering";
import { money } from "@/lib/money";
import { isSeedSlug, lineSubKey, menuOf, sectionsOf, shownCents } from "@/lib/drinks";
import { CUP_MARKETS } from "@/lib/markets";
import { PACK_SIZES, PACK_TAG, packTotal, dollars } from "@/lib/orderAhead";
import Icon from "@/components/Icon";
import { scrollMotion } from "@/lib/motion";
import Said from "@/components/Said";

export default function MenuScreen() {
  const router = useRouter();
  const { openDrink, qtyOf, bump, inc, dec, menu, menuRead, refreshMenu, priceCents } = useApp();
  // A drink added or taken out from its row is said, and focus stays in the row (R12 — the 10/10 audit, F2): the "+ $10"
  // pill becomes its counter and the counter's − at one becomes the pill again, so the button pressed is gone — focus
  // goes to the + that took its place, or back to the pill.
  const track = useCartSaid((id, _was, now) => document.querySelector(`[data-drink-row="${CSS.escape(id)}"]`)
    ?.querySelector<HTMLElement>(now === 0 ? '[data-cart-act="add"]' : '[data-cart-act="more"]'));
  const t = useSiteCopy();
  const { soldOut } = useCupAvailability();
  // IS THIS A MENU YOU CAN ORDER FROM RIGHT NOW? (2026-10-04) With the truck closed the page still
  // said "Order here, and it'll be waiting when you reach the window", every price wore the "+"
  // order pill, and the hint said "tap any drink to order it" — then every drink sheet said the
  // truck was closed. The page asks the rule the sheet asks (lib/ordering) and says the same thing
  // first. Until the read lands it is the menu it always was.
  const { market: viewerMarket } = useViewerMarket(CUP_MARKETS);
  const ordering = useOrderingOpen(true, viewerMarket);
  const o = ordering.ordering;
  const closed = o !== null && !o.open;
  const stateLine = o ? (closed ? closedWords(o, { closing: t("findus.cta_closed") }) : openWords(o)) : null;
  // THE MENU IS THE CATALOG (2026-10-13, R2 of the customer audit): the drinks, their words and their prices are the
  // Catalog's (AppProvider → /api/menu → lib/drinks), read again each time this page opens — a drink added in the Catalog
  // is here the next time the page opens; one taken off is gone. Until the read lands, and if it fails, the server's read
  // stands in (R42, below), else the code list's menu.
  // A MENU OPEN FOR A WHILE STAYS TRUE (R7, 2026-10-15). It was read when it opened, and never again while it stayed
  // open: a price the owner changed, a drink put on or taken off, reached it on the next visit. Read again every minute
  // while it is in front of someone, and on return to it — the Catalog's answer (86s come live, lib/availability).
  useEffect(() => {
    refreshMenu();
    const tick = () => { if (document.visibilityState === "visible") refreshMenu(); };
    const id = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [refreshMenu]);
  // THE CATALOG FROM THE FIRST PAINT (R42 — the standards' "Search and sharing"). Until this phone's own read lands, the
  // menu is the one the server read (app/menu/layout, components/AppProvider ServerMenu) — what search reads, and what a
  // guest sees first — at that read's prices (lib/drinks shownCents: AppProvider's own rule). With none (a CI or app
  // build, a read that failed), the code list's stand-in, as before. The phone's read, once it lands, is the menu.
  const server = useServerMenu();
  const fromServer = !menuRead && server !== null;
  const serverBy = useMemo(() => new Map((server ?? []).map((r) => [r.slug, r])), [server]);
  const shown = useMemo(() => (fromServer && server ? menuOf(server) : menu), [fromServer, server, menu]);
  const sections = sectionsOf(shown);
  const sectionsKey = sections.map((s) => s.line).join("|");
  // This line used to re-derive money()'s exact rule by hand — trim the cents when they are .00,
  // show them when they are not — in a ternary with a modulo, and its own comment said it "matches
  // the money() convention used elsewhere". It did. That is the problem: the convention has a
  // function, and a copy of a rule is a copy that can drift. The customer tapped "$10" here and
  // then read "$10.00" in the cart, the checkout and on the receipt, because those four screens
  // held four spellings of one number.
  const priceLabel = (id: string) => money(fromServer ? shownCents(serverBy.get(id), id) : priceCents(id));

  // Sticky category chips that scroll-spy the menu (jump + highlight current section).
  const [active, setActive] = useState<string>(sections[0]?.line ?? "");
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
  }, [sectionsKey]);
  const jumpTo = (name: string) => {
    const at = catRefs.current[name];
    at?.scrollIntoView({ behavior: scrollMotion(), block: "start" });
    const head = at?.querySelector<HTMLElement>("h2, h3");
    if (!head) return;
    if (!head.hasAttribute("tabindex")) head.setAttribute("tabindex", "-1");
    head.focus({ preventScroll: true });
  };

  return (
    <section className="screen menu" id="s-menu">
      <Watermark variant="menu" />
      {/* No EditCopyPill here (unlike Reserve/Craft/Truck/Member card): every key in the "Menu"
          group is now covered by inline EditableCopy on this page (plus the drink sheet, for
          menu.packs_cutoff) — 2026-07-17, Ryan: a pill that jumps away to Settings is a broken
          affordance, not just a redundant one, once the whole point is staying on the page. Turn
          on Edit mode from the float rail instead — it never leaves this screen. Re-add a pill here
          only if a new Menu-group key ships that ISN'T wired to EditableCopy somewhere in this flow. */}
      {/* ONE LINE, THEN THE CHOICES (2026-10-09, round 2 of the UX plan, step 2; Ryan, on this page:
          "This shit still cluttered"). Ten things stood between the tab and the first drink: an eyebrow
          repeating the tab ("THE MENU"), a three-line statement, the truck's state in capitals, three
          links — one of them Shop, already in the tab bar — the chips, and a hint to tap. Left: whether
          you can order now, in one line, then the three needs. The statement's message closes the page
          (menu.integrity says it); the chemistry and Primal follow the menu; a drink is one line. */}
      <Masthead tone="light" right={<AccountPill />} />
      {stateLine
        ? <Said className="mast-order mast-state" quietFirst>{stateLine}</Said>
        : <EditableCopy k="menu.order_line" value={t("menu.order_line")} as="div" className="mast-order" />}

      {/* JUMPS, NOT TABS (R12 — the 10/10 audit, F7): these scroll the one menu to a section — there is no panel for a
          tab to show — so they are a row of links-in-the-page, the one you are in marked current; and a jump takes focus to
          the section's heading, not only the eye. */}
      <nav className="menu-chips" aria-label="Menu categories">
        {sections.map((sec) => (
          <button key={sec.line} type="button" aria-current={active === sec.line ? "true" : undefined} className={`k-chip sm${active === sec.line ? " on" : ""}`} onClick={() => jumpTo(sec.line)}>{sec.line}</button>
        ))}
      </nav>

      {/* The Catalog answered and nothing is on sale: said, never a blank page. */}
      {(menuRead || fromServer) && sections.length === 0 && <EditableCopy k="menu.empty" value={t("menu.empty")} as="p" className="menu-integrity" />}
      {sections.map((sec) => (
        <div key={sec.line} ref={(el) => { catRefs.current[sec.line] = el; }} data-cat={sec.line}>
          {/* The section is the Catalog's line; its subtitle is page copy keyed by the line's name (menu.line.<name>.sub),
              so it follows the section wherever the Catalog puts it. */}
          <SectionHeader
            label={sec.line}
            annotation={t(lineSubKey(sec.line)) ? <EditableCopy k={lineSubKey(sec.line)} value={t(lineSubKey(sec.line))} /> : undefined}
          />

          {sec.drinks.map((d) => {
            const id = d.slug;
            const qty = qtyOf(id);
            const out = soldOut.has(id); // live (useAvailability, realtime) — the menu's read is up to a minute old
            // A stop with a menu set pours what it lists (stop_menu, 0393): the rest say so, and Pay refuses them too.
            const notHere = !out && !!ordering.stopMenu && !ordering.stopMenu.has(id);
            const off = out || notHere;
            // What the Catalog says about it, as the row's tags: caffeine or none, and what it contains — nothing guessed.
            const facts = [d.caffeine === true ? t("menu.caffeine") : d.caffeine === false ? t("menu.no_caffeine") : "", ...(d.contains ?? [])].filter(Boolean);
            // THE LINE THE CATALOG FILLS IN IS THERE FROM THE FIRST PAINT (2026-10-14). The facts are the Catalog's alone, and
            // the code list's menu that stands in until it answers says none — so about a second in every row grew a line of
            // tags and the menu under it jumped (verify:prod PAINTED, /menu: a layout shift of 0.10 against a gate of 0.04, in
            // every run since R2). Until the Catalog answers, a code-list drink keeps that line's room, empty and unread (the
            // ten all carry caffeine); a drink not at this stop keeps it too, hidden, so a stop's menu arriving moves no row.
            // The server's read says the facts from the first paint (R42): nothing to keep room for.
            const reserve = facts.length === 0 && !menuRead && !fromServer && isSeedSlug(id);
            const hideFacts = reserve || notHere;
            return (
              // THE PRICE ADDS IT; THE ROW OPENS IT (2026-10-13, R2 — the audit's menu, approved). The "+ $10" pill opened the
              // drink's sheet and adding took a second tap there. Now, while the truck takes orders, the pill adds the drink
              // and becomes its counter (− 1 · $10 +); the rest of the row opens the sheet. Two buttons side by side, never
              // one inside the other: the row's is stretched across it (.entry-open), the pill's sits above it.
              <div className={`entry relative${off ? " entry-86" : ""}`} key={id} data-drink-row={id}>
                <button type="button" className="entry-open absolute inset-0 cursor-pointer appearance-none border-0 bg-transparent p-0" onClick={() => openDrink(id)}
                  aria-label={`${d.name}, ${out ? "sold out today" : notHere ? "not at this stop" : priceLabel(id)}${qty ? `, ${qty} in your order` : ""}, view details`} />
                <div className="entry-head">
                  <span className="entry-dot" style={{ background: d.dot }} />
                  <span className="entry-name">{d.name}</span>
                  {out ? <span className="entry-out">{t("menu.sold_out")}</span> : d.tag ? <span className="entry-tag">{d.tag}</span> : null}
                  <span className="entry-gap" />
                  {/* With the truck not taking orders the price is a price, in the pill's own box (.shut), so the answer
                      arriving moves no row; off this stop's menu it says so in its place. */}
                  {notHere ? <span className="entry-out">{t("menu.not_here")}</span>
                    : off || closed ? <span className={`entry-px${off ? "" : " shut"}`}>{priceLabel(id)}</span>
                    : qty > 0 ? (
                      <span role="group" aria-label={`${d.name}: ${qty} in your order`}
                        className="entry-qty relative z-[1] inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-pill font-mono text-footnote font-semibold">
                        <button type="button" className="hit-44 px-2.5 py-1 cursor-pointer appearance-none border-0 bg-transparent text-inherit [font:inherit]" aria-label={`Remove one ${d.name}`} onClick={() => { track(id); dec(id); }}>−</button>
                        <span>{qty} · {priceLabel(id)}</span>
                        <button type="button" className="hit-44 px-2.5 py-1 cursor-pointer appearance-none border-0 bg-transparent text-inherit [font:inherit]" aria-label={`Add one more ${d.name}`} data-cart-act="more" onClick={() => { track(id); inc(id); }}>+</button>
                      </span>
                    )
                    : <button type="button" className="entry-px order hit-44 z-[1] cursor-pointer appearance-none bg-transparent" aria-label={`Add ${d.name}, ${priceLabel(id)}`} data-cart-act="add" onClick={() => { track(id); bump(id); }}>{priceLabel(id)}</button>}
                </div>
                {/* One line: why you would pick it, and the Catalog's facts. What is in it is the drink's own sheet. */}
                <div className="entry-body">
                  <div className="entry-why">{d.why || d.lines[0] || ""}</div>
                  {(facts.length > 0 || reserve) && (
                    <div className={`mt-1.5 flex flex-wrap gap-1.5${hideFacts ? " invisible" : ""}`} aria-hidden={hideFacts || undefined}>
                      {(reserve ? [t("menu.caffeine")] : facts).map((f) => <span key={f} className="entry-tag">{f}</span>)}
                    </div>
                  )}
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
        <Link href="/shop?tab=bottles" className="btn-pri btn-wide">{t("menu.reserve_pack")}</Link>
      </div>

      {/* Where the menu comes from, after the menu. Menu's categories (Activation/Hydration/…) already ARE
          Craft's three pillars; this names that connection. Plain text, not EditableCopy: same
          nested-interactive rule as craft.cta_menu/cta_reserve (a button, not a wrapped popover). */}
      <div className="flex flex-col items-start gap-2 mt-6">
        <button type="button" className="btn-ter text-left" onClick={() => router.push("/craft")}>
          {t("menu.craft_link")} <b><Icon name="arrowRight" /></b>
        </button>
        <button type="button" className="btn-ter text-left" onClick={() => router.push("/primal")}>
          {t("menu.nav_primal")} <b><Icon name="arrowRight" /></b>
        </button>
      </div>

      <EditableCopy k="menu.integrity" value={t("menu.integrity")} as="div" className="menu-integrity" />
      {/* menu.mto retired 2026-07-30 (redundancy audit): "Made to order" was the third telling of
          the same message on this one page — the hero already closes "every cup made the moment
          you order" and the integrity line above says it again. One message, one home. */}

      <ClosingBeat />
    </section>
  );
}
