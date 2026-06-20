"use client";

import { useEffect, useRef } from "react";
import { useApp } from "./AppProvider";
import { DRINKS } from "@/lib/menu";

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
        className={`sheet${openId ? " open" : ""}`}
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
              <div className="sheet-hero" style={{ background: d.grad }}>
                <span className="px">{d.px}</span>
                <b id="drink-sheet-title">{d.n}</b>
              </div>
              <div className="spec-label">What&apos;s in it</div>
              <div className="chips">
                {d.has.map((x) => (
                  <span className="chip yes" key={x}>{x}</span>
                ))}
              </div>
              <div className="spec-label">What&apos;s not</div>
              <div className="chips">
                {d.no.map((x) => (
                  <span className="chip no" key={x}>{x}</span>
                ))}
              </div>
              <div className="when-card">
                <div className="stamp">{d.when}</div>
                <div>
                  <b>When to drink it</b>
                  <span>{d.whenT}</span>
                </div>
              </div>
              <button className="handle" onClick={() => bump(openId)}>
                <span>{on ? "Remove from order" : "Add to pre-order"}</span>
              </button>
              <div className="signoff">Nothing toxic. The standard you can taste.</div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
