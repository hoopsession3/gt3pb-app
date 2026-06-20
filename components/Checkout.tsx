"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { subscribePush } from "@/lib/push";
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

export default function Checkout({ open, onClose, prices }: { open: boolean; onClose: () => void; prices?: Record<string, number> }) {
  const { cart, toast, checkout } = useApp();
  const { user, profile } = useAuth();
  const cardRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const items = [...cart] as DrinkId[];
  const priceOf = (id: DrinkId) => prices?.[id] ?? Math.round(parseFloat(DRINKS[id].px.replace("$", "")) * 100);
  const totalCents = items.reduce((s, id) => s + priceOf(id), 0);
  const total = (totalCents / 100).toFixed(2);
  const customer = profile?.display_name || (user?.email ? user.email.split("@")[0] : "Guest");

  // Record the order for the kitchen (back-of-house) regardless of paid/pre-order.
  const recordOrder = async (paid: boolean, paymentId?: string, amountCents?: number) => {
    // Enable order-status alerts (this runs in the pay/pre-order click — a user gesture).
    try {
      if (typeof Notification !== "undefined") {
        if (Notification.permission === "default") await Notification.requestPermission();
        if (Notification.permission === "granted") subscribePush(user?.id ?? null, !!profile?.is_admin);
      }
    } catch { /* */ }
    if (!supabase) return;
    await supabase.from("orders").insert({
      items,
      total_cents: amountCents ?? totalCents,
      paid,
      payment_id: paymentId ?? null,
      customer,
      user_id: user?.id ?? null,
      status: "new",
    });
  };

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

  // Robust readiness: enable Pay once the card field is actually visible (survives
  // dev StrictMode double-mount and any attach-timing races).
  useEffect(() => {
    if (!open || !squareClientReady) return;
    const iv = setInterval(() => {
      if (document.querySelector("#sq-card iframe")) { setReady(true); clearInterval(iv); }
    }, 250);
    return () => clearInterval(iv);
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
      await recordOrder(true, data.paymentId, data.amount);
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
                <div className="co-line" key={id}><span>{DRINKS[id].n}</span><span>${(priceOf(id) / 100).toFixed(2)}</span></div>
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
                  <button className="handle" onClick={async () => { await recordOrder(false); toast(`${items.length} drinks pre-ordered — ready in ~8 min`); checkout(); onClose(); }}>
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
