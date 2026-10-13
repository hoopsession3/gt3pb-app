"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { useAvailability } from "@/lib/availability";
import { useViewerMarket } from "@/components/useViewerMarket";
import { useOrderingOpen } from "./useOrderingOpen";
import { lineSubKey, pillarOf } from "@/lib/drinks";
import { CUP_MARKETS } from "@/lib/markets";
import { packDropFrom } from "@/lib/orderAhead";
import { closedWords, readyWords } from "@/lib/ordering";
import { useSiteCopy, fillCopy } from "@/lib/copy";
import Sheet from "@/components/Sheet";
import EditableCopy from "@/components/EditableCopy";
import { money } from "@/lib/money";

// THE DRINK IS THE CATALOG'S (2026-10-13, R2 of the customer audit): its name, what it is, why, what's in it and what never
// is, when, caffeine and contains are its products row (lib/drinks, via AppProvider) — the same answer the menu row, the
// cart and Pay give. The pillar line is the drink's section and that section's subtitle. A stop that doesn't pour it says
// so here, at the first touch, the way Pay would.

export default function DrinkSheet() {
  const { openId, closeDrink, isInCart, bump, toast, priceCents, drinkOf } = useApp();
  const { soldOut } = useAvailability();
  const router = useRouter();
  const t = useSiteCopy();
  // Ordering is gated at the FIRST touchpoint, not just checkout: outside the truck's window the
  // add button routes to the pack reserve instead (same rule as checkout + /api/checkout).
  const { market: viewerMarket } = useViewerMarket(CUP_MARKETS);
  const ordering = useOrderingOpen(!!openId, viewerMarket);
  const o = ordering.ordering;
  // Packs are a SEPARATE product from cup pre-orders and were never gated by the truck's live
  // status — that part of the old copy ("brewed to order anytime") was true. What wasn't true: a
  // real cutoff always exists (lib/orderAhead — 24h before the next stop, or the weekly Wed-6pm
  // fallback), it just wasn't being shown. The drop is lib/orderAhead.packDropFrom's — the choice
  // /api/reserve offers (2026-10-04: this quoted the cup window's stop, which during a stop is the
  // one under way, so "reserve by" was a time already gone). No open drop → no dates to quote.
  const packsDrop = packDropFrom(ordering.stops.map((s) => s.starts_at));
  const packsDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const packsCutoffLine = packsDrop ? fillCopy(t("menu.packs_cutoff"), { cutoff: packsDay(packsDrop.cutoff), pickup: packsDay(packsDrop.sat) }) : null;
  const d = openId ? drinkOf(openId) : null;
  const on = openId ? isInCart(openId) : false;
  const out = openId ? soldOut.has(openId) : false; // live (realtime), not the menu's minute-old read
  // Not at this stop: the stop's menu is set and doesn't list it (stop_menu, 0393). Pay refuses it too.
  const notHere = !!openId && !out && !!ordering.stopMenu && !ordering.stopMenu.has(openId);
  const caffeine = d?.caffeine === true ? t("sheet.caffeine_yes") : d?.caffeine === false ? t("sheet.caffeine_no") : null;
  const contains = d?.contains?.length ? d.contains.join(" · ") : null;
  const restoreRef = useRef<HTMLElement | null>(null);

  // Restore focus to the launching control when the popout closes. Sheet owns Escape + swipe-to-dismiss.
  useEffect(() => {
    if (!openId) return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    return () => {
      restoreRef.current?.focus?.();
    };
  }, [openId]);

  return (
    <Sheet open={!!openId} onClose={closeDrink} className="paper" labelledBy="drink-sheet-title">
      {d && openId && (
        <>
          <div className="sheet-pillar">{pillarOf(d.line, t(lineSubKey(d.line)))}</div>
          <div className="sheet-mark">
            <span className="sheet-dot" style={{ background: d.dot }} />
            <span className="sheet-name" id="drink-sheet-title">{d.name}</span>
            {/* Live price (products.price_cents via AppProvider), not the frozen lib/menu.ts value —
                so the very first price a customer sees always matches what checkout charges. */}
            <span className="sheet-px">{money(priceCents(openId))}</span>
          </div>

          <div className="sheet-lines">
            {d.lines.map((l) => (
              <div className="sheet-line" key={l}>{l}</div>
            ))}
          </div>
          {d.why && <p className="sheet-why">{d.why}</p>}

          <div className="sheet-rule" />

          {/* A list the Catalog leaves empty is left out, heading and all — never a heading over nothing. */}
          {d.has.length > 0 && (
            <>
              <EditableCopy k="sheet.in_bottle" value={t("sheet.in_bottle")} as="div" className="sheet-sec" />
              <ul className="sheet-list">
                {d.has.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}

          {d.no.length > 0 && (
            <>
              <EditableCopy k="sheet.never" value={t("sheet.never")} as="div" className="sheet-sec" />
              <ul className="sheet-list no">
                {d.no.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}

          {d.whenText && (
            <div className="sheet-when">
              <EditableCopy k="sheet.when_label" value={t("sheet.when_label")} as="span" className="sheet-when-k" />
              <span className="sheet-when-v">{d.whenText}</span>
            </div>
          )}
          {/* Caffeine and contains, when the Catalog says — never guessed (0393). */}
          {caffeine && (
            <div className="sheet-when">
              <EditableCopy k="sheet.caffeine_label" value={t("sheet.caffeine_label")} as="span" className="sheet-when-k" />
              <span className="sheet-when-v">{caffeine}</span>
            </div>
          )}
          {contains && (
            <div className="sheet-when">
              <EditableCopy k="sheet.contains_label" value={t("sheet.contains_label")} as="span" className="sheet-when-k" />
              <span className="sheet-when-v">{contains}</span>
            </div>
          )}

          {!ordering.open && !on ? (
            <>
              {/* Closing is not closed: the truck is still pouring for the line, just not online. */}
              <button type="button" className="btn-pri btn-wide mt-4.5" onClick={() => { closeDrink(); router.push("/reserve"); }}>
                {o?.state === "closing" ? t("sheet.closing_cta") : t("sheet.closed_cta")}
              </button>
              {/* When cups open, said by lib/ordering — it used to print the STOP's start ("Cup orders
                  open closer to the next stop — Sat 11:00 AM"), which read as the opening time and was
                  four hours late. */}
              <div className="sheet-signoff">
                {o && closedWords(o, { closing: t("findus.cta_closed") })}{packsCutoffLine && <> <EditableCopy k="menu.packs_cutoff" value={t("menu.packs_cutoff")} displayValue={packsCutoffLine} multiline /></>}
              </div>
            </>
          ) : (
            <>
              <button type="button" className="btn-pri btn-wide mt-4.5" disabled={(out || notHere) && !on} onClick={() => { if (out && !on) { toast("Sold out today — back on the next brew", "error"); return; } if (notHere && !on) return; if (!on) toast("Added — keep building your order"); bump(openId); closeDrink(); }}>
                {on ? t("sheet.remove") : out ? t("sheet.soldout") : notHere ? t("sheet.not_here") : t("sheet.add")}
              </button>
              {/* Ordered ahead of a stop it is made when the truck opens — not "the moment you order". A stop that doesn't
                  pour it is named, so the customer knows it's this stop, not the drink. */}
              {notHere && !on
                ? <div className="sheet-signoff">{d.name} isn&apos;t poured at {o?.stop?.name || "this stop"}.</div>
                : o?.state === "ahead"
                ? <div className="sheet-signoff">{readyWords(o)}</div>
                : <EditableCopy k="sheet.made_moment" value={t("sheet.made_moment")} as="div" className="sheet-signoff" />}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
