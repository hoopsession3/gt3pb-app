"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "./AppProvider";
import { DRINKS, type DrinkId } from "@/lib/menu";
import { SQUARE_APP_ID, SQUARE_LOCATION_ID, squareClientReady, squareWebSdkUrl } from "@/lib/square";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { Square?: any } }

function loadSquare(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (window.Square) return resolve(window.Square);
    const existing = document.querySelector<HTMLScriptElement>("script[data-square]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Square));
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.src = squareWebSdkUrl;
    s.async = true;
    s.dataset.square = "1";
    s.onload = () => resolve(window.Square);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export default function Checkout({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { cart, toast, checkout } = useApp();
  const cardRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const items = [...cart] as DrinkId[];
  const totalCents = items.reduce((s, id) => s + Math.round(parseFloat(DRINKS[id].px.replace("$", "")) * 100), 0);
  const total = (totalCents / 100).toFixed(2);

  // Mount the Square card form when the sheet opens (only if Square is configured).
  useEffect(() => {
    if (!open || !squareClientReady) return;
    let card: any;
    let cancelled = false;
    (async () => {
      try {
        const Square = await loadSquare();
        if (cancelled) return;
        const payments = Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
        card = await payments.card();
        await card.attach("#sq-card");
        cardRef.current = card;
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setErr("Couldn't load the card form. Try again.");
      }
    })();
    return () => {
      cancelled = true;
      setReady(false);
      cardRef.current?.destroy?.();
      cardRef.current = null;
    };
  }, [open]);

  const pay = async () => {
    setErr("");
    if (!cardRef.current) return;
    setBusy(true);
    try {
      const result = await cardRef.current.tokenize();
      if (result.status !== "OK") {
        setErr("Card details look off — check and retry.");
        setBusy(false);
        return;
      }
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: result.token, items }),
      });
      const data = await res.json();
      setBusy(false);
      if (!res.ok) { setErr(data.error || "Payment failed"); return; }
      toast(`Paid $${total} — order in. Ready in ~8 min.`);
      checkout(); // clears cart
      onClose();
    } catch {
      setBusy(false);
      setErr("Payment failed — nothing was charged. Try again.");
    }
  };

  return (
    <>
      <div className={`scrim${open ? " open" : ""}`} onClick={onClose} aria-hidden="true" />
      <div className={`sheet${open ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Checkout">
        <button type="button" className="grab" aria-label="Close" onClick={onClose} />
        <div className="sin">
          {open && (
            <>
              <div className="spec-label">Your pre-order</div>
              {items.map((id) => (
                <div className="co-line" key={id}><span>{DRINKS[id].n}</span><span>{DRINKS[id].px}</span></div>
              ))}
              <div className="co-line co-total"><span>Total</span><span>${total}</span></div>

              {squareClientReady ? (
                <>
                  <div className="spec-label" style={{ marginTop: 18 }}>Card</div>
                  <div id="sq-card" className="sq-card" />
                  {err && <div className="auth-err">{err}</div>}
                  <button className="handle" onClick={pay} disabled={!ready || busy || items.length === 0}>
                    <span>{busy ? "Charging…" : ready ? `Pay $${total}` : "Loading card…"}</span>
                  </button>
                  <div className="signoff">Secured by Square · skip the line at pickup.</div>
                </>
              ) : (
                <>
                  <div className="honest" style={{ marginTop: 16 }}>
                    Card checkout switches on soon. For now this is a <b>pre-order</b> — we&apos;ll have it ready and you pay at the truck.
                  </div>
                  <button className="handle" onClick={() => { toast(`${items.length} drinks pre-ordered — ready in ~8 min`); checkout(); onClose(); }}>
                    <span>Send pre-order</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
