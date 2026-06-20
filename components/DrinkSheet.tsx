"use client";

import { useApp } from "./AppProvider";
import { DRINKS } from "@/lib/menu";

export default function DrinkSheet() {
  const { openId, closeDrink, isInCart, bump } = useApp();
  const d = openId ? DRINKS[openId] : null;
  const on = openId ? isInCart(openId) : false;

  return (
    <>
      <div className={`scrim${openId ? " open" : ""}`} onClick={closeDrink} />
      <div className={`sheet${openId ? " open" : ""}`} role="dialog" aria-modal="true">
        <div className="grab" />
        <div className="sin">
          {d && openId && (
            <>
              <div className="sheet-hero" style={{ background: d.grad }}>
                <span className="px">{d.px}</span>
                <b>{d.n}</b>
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
