"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { useSheetDrag } from "@/lib/useSheetDrag";
import { useAvailability } from "@/lib/availability";
import { useOrderingOpen } from "./useOrderingOpen";
import { DRINKS } from "@/lib/menu";

const PILLAR: Record<"BEFORE" | "DURING" | "AFTER", string> = {
  BEFORE: "Activation · Before the work",
  DURING: "Hydration · During the work",
  AFTER: "Fuel · After the work",
};

export default function DrinkSheet() {
  const { openId, closeDrink, isInCart, bump, toast } = useApp();
  const { soldOut } = useAvailability();
  const router = useRouter();
  // Ordering is gated at the FIRST touchpoint, not just checkout: outside the truck's window the
  // add button routes to the pack reserve instead (same rule as checkout + /api/checkout).
  const ordering = useOrderingOpen(!!openId);
  const d = openId ? DRINKS[openId] : null;
  const on = openId ? isInCart(openId) : false;
  const out = openId ? soldOut.has(openId) : false;
  const { sheetRef, handlers } = useSheetDrag(closeDrink);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Focus management + Escape-to-close while the dialog is open.
  useEffect(() => {
    if (!openId) return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrink();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [openId, closeDrink]);

  return (
    <>
      <div className={`scrim${openId ? " open" : ""}`} onClick={closeDrink} aria-hidden="true" />
      <div
        className={`sheet paper${openId ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drink-sheet-title"
        aria-hidden={openId ? undefined : true}
        tabIndex={-1}
        ref={sheetRef}
      >
        <button type="button" className="grab" aria-label="Close" onClick={closeDrink} {...handlers} />
        <div className="sin">
          {d && openId && (
            <>
              <div className="sheet-pillar">{PILLAR[d.when]}</div>
              <div className="sheet-mark">
                <span className="sheet-dot" style={{ background: d.dot }} />
                <span className="sheet-name" id="drink-sheet-title">{d.n}</span>
                <span className="sheet-px">{d.px}</span>
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
        </div>
      </div>
    </>
  );
}
