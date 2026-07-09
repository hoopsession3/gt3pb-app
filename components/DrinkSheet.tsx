"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { useAvailability } from "@/lib/availability";
import { useOrderingOpen } from "./useOrderingOpen";
import { DRINKS } from "@/lib/menu";
import Sheet from "@/components/Sheet";

const PILLAR: Record<"BEFORE" | "DURING" | "AFTER", string> = {
  BEFORE: "Activation · Before the work",
  DURING: "Hydration · During the work",
  AFTER: "Fuel · After the work",
};

export default function DrinkSheet() {
  const { openId, closeDrink, isInCart, bump, toast, priceCents } = useApp();
  const { soldOut } = useAvailability();
  const router = useRouter();
  // Ordering is gated at the FIRST touchpoint, not just checkout: outside the truck's window the
  // add button routes to the pack reserve instead (same rule as checkout + /api/checkout).
  const ordering = useOrderingOpen(!!openId);
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
          <div className="sheet-pillar">{PILLAR[d.when]}</div>
          <div className="sheet-mark">
            <span className="sheet-dot" style={{ background: d.dot }} />
            <span className="sheet-name" id="drink-sheet-title">{d.n}</span>
            {/* Live price (products.price_cents via AppProvider), not the frozen lib/menu.ts value —
                so the very first price a customer sees always matches what checkout charges. */}
            <span className="sheet-px">${(priceCents(openId) / 100).toFixed(priceCents(openId) % 100 === 0 ? 0 : 2)}</span>
          </div>

          <div className="sheet-lines">
            {d.lines.map((l) => (
              <div className="sheet-line" key={l}>{l}</div>
            ))}
          </div>
          <p className="sheet-why">{d.why}</p>

          <div className="sheet-rule" />

          <div className="sheet-sec">In the bottle</div>
          <ul className="sheet-list">
            {d.has.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>

          <div className="sheet-sec">Never</div>
          <ul className="sheet-list no">
            {d.no.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>

          <div className="sheet-when">
            <span className="sheet-when-k">When</span>
            <span className="sheet-when-v">{d.whenT}</span>
          </div>

          {!ordering.open && !on ? (
            <>
              <button className="order-bar" onClick={() => { closeDrink(); router.push("/reserve"); }}>
                Truck&apos;s closed — reserve a pack ›
              </button>
              <div className="sheet-signoff">
                Cup orders open {ordering.nextAt ? <>closer to the next stop — <b>{new Date(ordering.nextAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}{ordering.nextName ? ` · ${ordering.nextName}` : ""}</b></> : "when the truck goes live"}. Packs are brewed to order anytime.
              </div>
            </>
          ) : (
            <>
              <button className={`order-bar${out && !on ? " order-bar-86" : ""}`} disabled={out && !on} onClick={() => { if (out && !on) { toast("Sold out today — back on the next brew", "error"); return; } if (!on) toast("Added — keep building your order"); bump(openId); closeDrink(); }}>
                {on ? "Remove from order" : out ? "Sold out today" : "Add to order"}
              </button>
              <div className="sheet-signoff">Made the moment you order, and you&apos;ll taste it.</div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
