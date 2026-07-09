"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { subscribePush } from "@/lib/push";
import { DRINKS, type DrinkId } from "@/lib/menu";
import { useAvailability } from "@/lib/availability";
import { saveAmount, PRICING } from "@/lib/orderAhead";
import { useOrderingOpen } from "./useOrderingOpen";
import { usePayAtPickup } from "./usePayAtPickup";
import { SQUARE_APP_ID, SQUARE_LOCATION_ID, squareClientReady, squareWebSdkUrl } from "@/lib/square";
import { useSheetDrag } from "@/lib/useSheetDrag";
import Skeleton from "./Skeleton";

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

export default function Checkout() {
  const { cart, inc, dec, toast, checkout, coOpen: open, closeCheckout: onClose } = useApp();
  const { sheetRef, handlers } = useSheetDrag(onClose);
  const router = useRouter();
  const [doneView, setDoneView] = useState(false); // post-pay subscription upsell
  useEffect(() => { if (!open) setDoneView(false); }, [open]);
  const { user, profile } = useAuth();
  const [prices, setPrices] = useState<Record<string, number>>({});
  // Prices for the displayed total (the actual charge is computed server-side).
  useEffect(() => {
    fetch("/api/menu").then((r) => r.json()).then((d) => setPrices(d.prices || {})).catch(() => {});
  }, []);
  const cardRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // "Ready in ~8 min" is only true when there's a truck to make it. One shared rule
  // (useOrderingOpen → lib/orderAhead.preorderWindow, operator-adjustable lead, also enforced in
  // /api/checkout): outside the window the sheet offers the pack reserve instead.
  const ordering = useOrderingOpen(open);
  // Operator's pay-later switch (Money section). Governs whether the "pay at the truck" pre-order
  // path is offered — on its own when Square is off, or alongside the card when Square is on.
  const payLater = usePayAtPickup(open);

  const lines = Object.entries(cart) as [DrinkId, number][];
  const items = lines.flatMap(([id, q]) => Array(q).fill(id)) as DrinkId[]; // flat list for the charge + order record
  const priceOf = (id: DrinkId) => prices?.[id] ?? Math.round(parseFloat(DRINKS[id].px.replace("$", "")) * 100);
  const totalCents = items.reduce((s, id) => s + priceOf(id), 0);
  // A cart line that sold out mid-order blocks submission (the server refuses it anyway — this is
  // the polite version: name the item, let them remove it, keep the rest of the order alive).
  const { soldOut } = useAvailability();
  const blocked86 = lines.filter(([id]) => soldOut.has(id)).map(([id]) => DRINKS[id].n);
  // A name is required so the operator can call the order at pickup. Prefilled from
  // the member's profile when the sheet opens; guests must type one.
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName((n) => n || profile?.display_name || ""); }, [open, profile?.display_name]);
  const customer = name.trim();

  // Tip (card path only; pre-orders tip in person). Default to NO tip so selecting card never
  // silently marks the price up — the guest opts in.
  const [tipPct, setTipPct] = useState(0);
  const tipCents = Math.round(totalCents * tipPct);
  const grandCents = totalCents + tipCents;
  const total = (grandCents / 100).toFixed(2);

  // Enable order-status alerts (must run inside a click — a user gesture).
  const enableAlerts = async () => {
    try {
      if (typeof Notification !== "undefined") {
        if (Notification.permission === "default") await Notification.requestPermission();
        if (Notification.permission === "granted") subscribePush(user?.id ?? null, !!profile?.is_admin);
      }
    } catch { /* */ }
  };
  // Pre-orders (pay at the truck) go through /api/checkout now too (no sourceId = pay-at-pickup) —
  // same availability + ordering-window checks the paid path always had, instead of inserting
  // directly from the client. `orders` no longer has a client write door at all.
  const recordPreOrder = async (): Promise<{ error: { message: string } | null }> => {
    try {
      const accessToken = (await supabase?.auth.getSession())?.data.session?.access_token;
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ items, customer }),
      });
      const data = await res.json();
      if (!res.ok) return { error: { message: data?.error || "That didn't go through — try again." } };
      return { error: null };
    } catch {
      return { error: { message: "We're offline right now — try again in a moment." } };
    }
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
      if (cardRef.current && document.querySelector("#sq-card iframe")) { setReady(true); clearInterval(iv); }
    }, 250);
    return () => clearInterval(iv);
  }, [open]);

  // Pay-at-pickup: record the order UNPAID and hand off — the guest pays at the truck. Shared by the
  // standalone pickup button and the "or pay at pickup" secondary action when card is also offered.
  const sendPreOrder = async () => {
    if (blocked86.length > 0) { toast("Remove the sold-out items first", "error"); return; }
    if (!customer) { toast("Add a name for pickup", "error"); return; }
    if (items.length === 0) return;
    await enableAlerts();
    const { error } = await recordPreOrder();
    if (error) { toast("That didn't go through — give it another tap", "error"); return; }
    toast(`${items.length} drink${items.length === 1 ? "" : "s"} pre-ordered — ready in ~8 min`);
    checkout(); onClose();
  };

  const pay = async () => {
    setErr("");
    if (!customer) { setErr("Add a name for pickup"); return; }
    if (!cardRef.current) return;
    setBusy(true);
    try {
      await enableAlerts();
      const result = await cardRef.current.tokenize();
      if (result.status !== "OK") {
        setErr("Card details look off — check and retry.");
        setBusy(false);
        return;
      }
      const accessToken = (await supabase?.auth.getSession())?.data.session?.access_token;
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ sourceId: result.token, items, tipCents, customer }),
      });
      const data = await res.json();
      setBusy(false);
      if (!res.ok) { setErr(data.error || "Payment failed"); return; }
      toast(data.warn || `Paid $${total} — order in. Ready in ~8 min.`);
      checkout(); // clears cart
      setDoneView(true); // show the subscription upsell instead of closing
    } catch {
      setBusy(false);
      setErr("Payment failed — nothing was charged. Try again.");
    }
  };

  return (
    <>
      <div className={`scrim${open ? " open" : ""}`} onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} className={`sheet paper${open ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Checkout">
        <button type="button" className="grab" aria-label="Close" onClick={onClose} {...handlers} />
        <div className="sin">
          {open && doneView ? (
            <div className="co-done">
              <div className="co-done-check" aria-hidden="true">✓</div>
              <div className="co-done-conf">Order in — ready in ~8 min</div>
              <h3>Skip the line next time?</h3>
              <p>Reserve a Saturday drop — brewed to order, ready when you reach the window.</p>
              <button type="button" className="subpitch-cta" onClick={() => { onClose(); router.push("/reserve"); }}>Reserve a drop</button>
              <button type="button" className="sub-link" onClick={onClose}>Not now</button>
            </div>
          ) : open ? (
            <>
              <div className="spec-label">Name for pickup</div>
              <input
                className="co-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Who's this order for?"
                maxLength={40}
                aria-label="Name for pickup"
                autoComplete="name"
                enterKeyHint="done"
              />
              <div className="spec-label" style={{ marginTop: 16 }}>Your pre-order</div>
              {lines.map(([id, q]) => (
                <div className="co-line" key={id}>
                  <span className="co-qty">
                    <button type="button" className="co-step" aria-label={`Remove one ${DRINKS[id].n}`} onClick={() => dec(id)}>−</button>
                    <b>{q}</b>
                    <button type="button" className="co-step" aria-label={`Add one ${DRINKS[id].n}`} onClick={() => inc(id)}>+</button>
                    {DRINKS[id].n}
                  </span>
                  <span>${((priceOf(id) * q) / 100).toFixed(2)}</span>
                </div>
              ))}

              {/* One quiet line — the closed state and the post-pay screen own the full pack pitch
                  in their moments; while paying, the cart is the hero. */}
              {ordering.open && (
                <button type="button" className="co-upsell-line" onClick={() => router.push("/reserve")}>
                  Bottles for your week? <b>Reserve a Saturday pack ›</b>
                </button>
              )}

              {!ordering.open ? (
                <div className="co-closed">
                  <div className="co-closed-t">☕ The truck isn&apos;t pouring right now</div>
                  <p className="co-closed-s">
                    Cup pre-orders open <b>closer to service</b> — that&apos;s how &ldquo;ready in ~8 minutes&rdquo; stays true.
                    {ordering.nextAt ? <> Next stop: <b>{new Date(ordering.nextAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{ordering.nextName ? ` · ${ordering.nextName}` : ""}</b>.</> : <> Nothing&apos;s on the schedule yet — check the truck page for the next stop.</>}
                  </p>
                  <p className="co-closed-s">Want it locked in anyway? A <b>pack reserve</b> is brewed to your order and waiting at the next drop.</p>
                  <button type="button" className="handle" onClick={() => { onClose(); router.push("/reserve"); }}><span>Reserve a pack instead</span></button>
                  <div className="signoff">Your cart stays right here for when we&apos;re pouring.</div>
                </div>
              ) : squareClientReady ? (
                <>
                  <div className="co-line"><span>Subtotal</span><span>${(totalCents / 100).toFixed(2)}</span></div>
                  <div className="spec-label" style={{ marginTop: 16 }}>Add a tip</div>
                  <div className="tip-row">
                    {[0, 0.15, 0.2, 0.25].map((p) => (
                      <button key={p} type="button" className={`tip-opt${tipPct === p ? " on" : ""}`} onClick={() => setTipPct(p)}>
                        {p === 0 ? "No tip" : `${Math.round(p * 100)}%`}
                      </button>
                    ))}
                  </div>
                  <div className="spec-label" style={{ marginTop: 16 }}>Card</div>
                  <div className="sq-wrap">
                    <div id="sq-card" className="sq-card" />
                    {!ready && <div className="sk sq-sk-bar" />}
                  </div>
                  {err && <div className="auth-err">{err}</div>}
                  <div className="co-foot">
                    {blocked86.length > 0 && <div className="co-86">{blocked86.join(" · ")} just sold out — remove {blocked86.length === 1 ? "it" : "them"} with the − button to continue.</div>}
                    <div className="co-line co-total"><span>Total</span><span>${total}</span></div>
                    <button className="handle" onClick={pay} disabled={!ready || busy || items.length === 0 || !customer || blocked86.length > 0}>
                      <span>{busy ? "Charging…" : blocked86.length > 0 ? "Remove sold-out items" : !customer ? "Add a name above" : ready ? `Pay $${total}` : "Loading card…"}</span>
                    </button>
                    {/* Card is primary; pay-at-pickup is the secondary path when the operator allows it. */}
                    {payLater.on && (
                      <button type="button" className="co-paylater" onClick={sendPreOrder} disabled={busy || items.length === 0 || !customer || blocked86.length > 0}>
                        or <b>pay at the truck</b> — send pre-order
                      </button>
                    )}
                    <div className="signoff">Secured by Square · skip the line at pickup.</div>
                  </div>
                </>
              ) : payLater.on ? (
                <>
                  {blocked86.length > 0 && <div className="co-86">{blocked86.join(" · ")} just sold out — remove {blocked86.length === 1 ? "it" : "them"} with the − button to continue.</div>}
                  <div className="co-line co-total"><span>Total</span><span>${(totalCents / 100).toFixed(2)}</span></div>
                  <div className="honest" style={{ marginTop: 16 }}>
                    This is a <b>pre-order</b> — we&apos;ll have it ready and you pay at the truck.
                  </div>
                  <button className="handle" onClick={sendPreOrder} disabled={!customer || items.length === 0 || blocked86.length > 0}>
                    <span>{blocked86.length > 0 ? "Remove sold-out items" : "Send pre-order"}</span>
                  </button>
                </>
              ) : (
                <div className="co-closed">
                  <div className="co-closed-t">Checkout isn&apos;t switched on yet</div>
                  <p className="co-closed-s">Card payments arrive with the Square keys, and pay-at-the-truck is turned off right now. Come see us at the window.</p>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
