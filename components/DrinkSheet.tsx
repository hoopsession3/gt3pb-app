"use client";

import { useEffect, useRef } from "react";
import { useApp } from "./AppProvider";
import { DRINKS } from "@/lib/menu";

const PILLAR: Record<"BEFORE" | "DURING" | "AFTER", string> = {
  BEFORE: "Activation · Before the work",
  DURING: "Hydration · During the work",
  AFTER: "Fuel · After the work",
};

export default function DrinkSheet() {
  const { openId, closeDrink, isInCart, bump } = useApp();
  const d = openId ? DRINKS[openId] : null;
  const on = openId ? isInCart(openId) : false;
  const sheetRef = useRef<HTMLDivElement>(null);
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
        <button type="button" className="grab" aria-label="Close" onClick={closeDrink} />
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

              <div className="sheet-sec">In the cup</div>
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

              <button className="order-bar" onClick={() => bump(openId)}>
                {on ? "Remove from order" : "Add to order"}
              </button>
              <div className="sheet-signoff">Made to order. The standard you can taste.</div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
