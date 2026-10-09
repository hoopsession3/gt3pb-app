"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { useAvailability } from "@/lib/availability";
import { useViewerMarket } from "@/components/useViewerMarket";
import { useOrderingOpen } from "./useOrderingOpen";
import { DRINKS } from "@/lib/menu";
import { packDropFrom } from "@/lib/orderAhead";
import { closedWords, readyWords } from "@/lib/ordering";
import { useSiteCopy, fillCopy } from "@/lib/copy";
import Sheet from "@/components/Sheet";
import EditableCopy from "@/components/EditableCopy";
import { money } from "@/lib/money";

// Pillar tag per drink timing — copy keys now (sheet.pillar_*), resolved via t() at render since the
// key→text map lives in site_copy. The d.when → key mapping itself is menu data, not copy.
const PILLAR: Record<"BEFORE" | "DURING" | "AFTER", string> = {
  BEFORE: "sheet.pillar_before",
  DURING: "sheet.pillar_during",
  AFTER: "sheet.pillar_after",
};

export default function DrinkSheet() {
  const { openId, closeDrink, isInCart, bump, toast, priceCents } = useApp();
  const { soldOut } = useAvailability();
  const router = useRouter();
  const t = useSiteCopy();
  // Ordering is gated at the FIRST touchpoint, not just checkout: outside the truck's window the
  // add button routes to the pack reserve instead (same rule as checkout + /api/checkout).
  const { market: viewerMarket } = useViewerMarket();
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
  const d = openId ? DRINKS[openId] : null;
  const on = openId ? isInCart(openId) : false;
  const out = openId ? soldOut.has(openId) : false;
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
          <div className="sheet-pillar">{t(PILLAR[d.when])}</div>
          <div className="sheet-mark">
            <span className="sheet-dot" style={{ background: d.dot }} />
            {/* Name / lines / why read the SAME menu.<id>.* copy keys the /menu list uses
                (app/menu/page.tsx), not the frozen lib/menu.ts d.n/d.lines/d.why — so an owner's
                menu edits show in BOTH the list and this popup instead of drifting apart. The
                in-the-bottle (d.has) / never (d.no) lists stay on lib/menu.ts for now. */}
            <span className="sheet-name" id="drink-sheet-title">{t(`menu.${openId}.name`)}</span>
            {/* Live price (products.price_cents via AppProvider), not the frozen lib/menu.ts value —
                so the very first price a customer sees always matches what checkout charges. */}
            <span className="sheet-px">{money(priceCents(openId))}</span>
          </div>

          <div className="sheet-lines">
            {t(`menu.${openId}.lines`).split("\n").filter(Boolean).map((l) => (
              <div className="sheet-line" key={l}>{l}</div>
            ))}
          </div>
          <p className="sheet-why">{t(`menu.${openId}.why`)}</p>

          <div className="sheet-rule" />

          <EditableCopy k="sheet.in_bottle" value={t("sheet.in_bottle")} as="div" className="sheet-sec" />
          <ul className="sheet-list">
            {d.has.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>

          <EditableCopy k="sheet.never" value={t("sheet.never")} as="div" className="sheet-sec" />
          <ul className="sheet-list no">
            {d.no.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>

          <div className="sheet-when">
            <EditableCopy k="sheet.when_label" value={t("sheet.when_label")} as="span" className="sheet-when-k" />
            <span className="sheet-when-v">{d.whenT}</span>
          </div>

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
              <button type="button" className="btn-pri btn-wide mt-4.5" disabled={out && !on} onClick={() => { if (out && !on) { toast("Sold out today — back on the next brew", "error"); return; } if (!on) toast("Added — keep building your order"); bump(openId); closeDrink(); }}>
                {on ? t("sheet.remove") : out ? t("sheet.soldout") : t("sheet.add")}
              </button>
              {/* Ordered ahead of a stop it is made when the truck opens — not "the moment you order". */}
              {o?.state === "ahead"
                ? <div className="sheet-signoff">{readyWords(o)}</div>
                : <EditableCopy k="sheet.made_moment" value={t("sheet.made_moment")} as="div" className="sheet-signoff" />}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
