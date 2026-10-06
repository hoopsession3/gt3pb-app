"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { useCustomerKnown, useKnownField, invalidateCustomerKnown } from "./useCustomerKnown";
import { authedFetch } from "@/lib/authedFetch";
import { subscribePush } from "@/lib/push";
import { DRINKS, type DrinkId } from "@/lib/menu";
import { useAvailability } from "@/lib/availability";
import { perBottle, PRICING } from "@/lib/orderAhead";
import { useViewerMarket } from "@/components/useViewerMarket";
import { useOrderingOpen } from "./useOrderingOpen";
import { closedWords, confirmWords, pickupWords, readyWords } from "@/lib/ordering";
import { useSiteCopy } from "@/lib/copy";
import { usePayAtPickup } from "./usePayAtPickup";
import { squareClientReady } from "@/lib/square";
import { money } from "@/lib/money";
import { trackFunnel } from "@/lib/funnel";
import Sheet from "./Sheet";
import OrderConfirm from "./OrderConfirm";
import PaymentCard, { type PaymentCardHandle } from "./PaymentCard";
import Icon from "@/components/Icon";
import { useIdemKey } from "./useIdemKey";
import { payErrorText } from "@/lib/idempotency";
import { haptic } from "@/lib/haptics";
import { apiUrl } from "@/lib/native";

export default function Checkout() {
  const { cart, inc, dec, toast, checkout, coOpen: open, closeCheckout: onClose } = useApp();
  const router = useRouter();
  // The confirmation moment — same shape as pickup/delivery's OrderConfirm. Lines/name are captured
  // at success time because checkout() clears the cart right after (lines would otherwise read empty
  // by the time the confirm screen renders).
  // readyFrom/pickup are the SERVER's promise (/api/checkout answers with what it recorded), so the
  // screen says what the order says — not what this sheet last read, which can be a minute old.
  const [done, setDone] = useState<{ paid: boolean; total: number; lines: [DrinkId, number][]; name: string; warn?: string; ref?: string; readyFrom: string | null; pickup: string } | null>(null);
  useEffect(() => { if (!open) setDone(null); else trackFunnel("order", "open"); }, [open]);
  const { user, profile } = useAuth();
  const [prices, setPrices] = useState<Record<string, number>>({});
  // Prices for the displayed total (the actual charge is computed server-side).
  useEffect(() => {
    fetch(apiUrl("/api/menu")).then((r) => r.json()).then((d) => setPrices(d.prices || {})).catch(() => {});
  }, []);
  const paymentRef = useRef<PaymentCardHandle>(null);
  // A Square idempotency key that stays stable across "Try again" taps for the SAME order, so an
  // ambiguous failure (card captured but the response was lost) dedupes at Square on resubmit instead
  // of charging twice. It regenerates when the order itself changes (items/tip/name) — OR when the
  // card nonce does (2026-07-30, Ryan's live test: a nonce is single-use, so retrying with a fresh
  // card mints a fresh nonce; reusing the old key with new params is Square's "Different request
  // parameters used for the same idempotency_key" wall). The ambiguous-network case still dedupes:
  // a true resubmit replays the SAME nonce, so the signature — and the key — hold still.
  const idemKeyFor = useIdemKey();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // A PAYMENT THAT DID NOT GO THROUGH IS FELT (2026-10-05, the haptics round). The card's own errors
  // and the charge's are said here, inline, not in a toast — so they buzz from here, once each time
  // one appears. What this sheet says with toast() already buzzes from AppProvider.
  useEffect(() => { if (err) haptic("error"); }, [err]);

  // "Ready in ~8 min" is only true when there's a truck to make it. One shared rule (useOrderingOpen
  // → lib/ordering, on the read /api/checkout makes too): outside the window the sheet offers the
  // pack reserve instead, and inside it the sheet says where to pick up and when it will be made.
  const { market: viewerMarket } = useViewerMarket();
  const ordering = useOrderingOpen(open, viewerMarket);
  const o = ordering.ordering;
  const t = useSiteCopy();
  // Before the first read lands nothing is claimed; the server's answer fills the confirmation.
  const promised = (data: { readyFrom?: string | null; pickup?: string } | null) => ({
    readyFrom: data && "readyFrom" in data ? data.readyFrom ?? null : o?.readyFrom ?? null,
    pickup: data?.pickup ?? (o ? pickupWords(o) : "At the truck"),
  });
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
  // A name is required so the operator can call the order at pickup. It starts from what we know
  // (lib/customerKnown: what they asked to be called, else the name on their record or their last
  // order — not only display_name, which is often empty) and is theirs the moment they type. A guest
  // types one; the field says it is a name, so the phone's own autofill offers it.
  const known = useCustomerKnown(open);
  const [name, setName] = useKnownField(known?.callName || profile?.display_name);
  const customer = name.trim();

  // Tip (card path only; pre-orders tip in person). Default to NO tip so selecting card never
  // silently marks the price up — the guest opts in.
  const [tipPct, setTipPct] = useState(0);
  const tipCents = Math.round(totalCents * tipPct);
  const grandCents = totalCents + tipCents;
  // The string three places below print. It was "19.99" with a "$" glued on at each site, which is
  // how the same total could read one way here and another on the receipt.
  const total = money(grandCents);

  // The upsell line's numbers come straight from the pricing grid (lib/orderAhead) — the 6-pack
  // bring-back per-bottle price against the $10 cup at the truck, % rounded down. Nothing is
  // hardcoded here, so a grid change updates the copy on its own; if the math ever can't produce
  // a sane pair, `null` quietly falls back to the original line.
  const packUpsell = (() => {
    try {
      const size = 6;
      const per = perBottle(size, "return");
      const cup = PRICING.walkup.single;
      if (!Number.isFinite(per) || !Number.isFinite(cup) || per <= 0 || per >= cup) return null;
      const pct = Math.floor(((cup - per) / cup) * 100);
      if (pct < 1) return null;
      return { size, per: `$${per.toFixed(2)}`, pct };
    } catch {
      return null;
    }
  })();

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
  const recordPreOrder = async (): Promise<{ error: { message: string } | null; data?: { readyFrom?: string | null; pickup?: string } }> => {
    try {
      const res = await authedFetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, customer, market: viewerMarket }),
      });
      const data = await res.json();
      if (!res.ok) return { error: { message: data?.error || "That didn't go through — try again." } };
      return { error: null, data };
    } catch {
      return { error: { message: "We're offline right now — try again in a moment." } };
    }
  };

  // Pay-at-pickup: record the order UNPAID and hand off — the guest pays at the truck. Shared by the
  // standalone pickup button and the "or pay at pickup" secondary action when card is also offered.
  // Used to just toast-and-close with no confirmation screen at all; now shows the same OrderConfirm
  // the paid path gets.
  const sendPreOrder = async () => {
    if (busy) return; // guard against a double-tap firing two pre-orders the kitchen makes
    if (blocked86.length > 0) { toast("Remove the sold-out items first", "error"); return; }
    if (!customer) { toast("Add a name for pickup", "error"); return; }
    if (items.length === 0) return;
    setBusy(true);
    await enableAlerts();
    const { error, data } = await recordPreOrder();
    // The server's own words when it refused (the truck closed between the read and the tap — it
    // says when it opens); the generic retry only when there are none.
    if (error) { toast(error.message || "That didn't go through — give it another tap", "error"); setBusy(false); return; }
    const capturedLines = [...lines], capturedName = customer, capturedTotal = totalCents;
    const p = promised(data ?? null);
    trackFunnel("order", "pickup");
    haptic("success");
    toast(`${items.length} drink${items.length === 1 ? "" : "s"} pre-ordered — ${p.readyFrom ? "made when we open" : "ready in ~8 min"}`);
    checkout({ silentToast: true }); // clears cart — this toast already fired above
    setDone({ paid: false, total: capturedTotal, lines: capturedLines, name: capturedName, ...p });
    invalidateCustomerKnown();   // the next form starts from this order
    setBusy(false);
  };

  const pay = async () => {
    if (busy) return; // guard a fast double-tap before the button's disabled attribute takes effect
    setErr("");
    if (!customer) { setErr("Add a name for pickup"); return; }
    if (!ready) return;
    // The weight of committing money — felt once the tap is going to charge, not on a tap the guards
    // turned away (a missing name buzzes as the error it is).
    haptic("heavy");
    setBusy(true);
    try {
      await enableAlerts();
      const result = await paymentRef.current!.tokenize();
      if (result.status !== "OK") {
        setErr("Card details look off — check and retry.");
        setBusy(false);
        return;
      }
      trackFunnel("order", "pay_start");
      const res = await authedFetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: result.token, items, tipCents, customer, market: viewerMarket, idempotencyKey: idemKeyFor(result.token, { items, tipCents, customer }) }),
      });
      const data = await res.json();
      setBusy(false);
      if (!res.ok) { setErr(payErrorText(data.error)); return; }
      trackFunnel("order", "paid");
      haptic("paid");
      const capturedLines = [...lines], capturedName = customer;
      const p = promised(data);
      toast(data.warn || `Paid ${total} — order in. ${p.readyFrom ? readyWords({ state: "ahead", readyFrom: p.readyFrom }) : "Ready in ~8 min."}`);
      checkout({ silentToast: true }); // clears cart — this toast already fired above
      // data.warn/data.ref carry the "charged but not yet recorded" fallback (server alerted the
      // crew and generated a reference code) — capture them into `done` so the PERSISTENT confirm
      // screen shows it, not just a toast that auto-dismisses in a few seconds. Previously this was
      // dropped entirely: the toast above never even rendered (React batches it with checkout()'s own
      // toast and only the last one shows), and `done` had nowhere to put it even if it had.
      setDone({ paid: true, total: grandCents, lines: capturedLines, name: capturedName, warn: data.warn, ref: data.ref, ...p });
      invalidateCustomerKnown();
    } catch {
      setBusy(false);
      // We can't tell whether the card was captured before the connection dropped, but the idempotency
      // key is stable — tapping Pay again replays the SAME charge, so Square won't double-charge.
      setErr("Couldn't confirm the payment — tap Pay to retry. You won't be charged twice.");
    }
  };

  return (
    // Held while the card is being charged (2026-10-05): every way out of the sheet — the pull, a tap
    // outside, Escape — gives and stays put until the charge answers. A do-nothing onClose used to stand
    // in for this, and a tap outside then faded the sheet out for good — "Order in." with it.
    <Sheet open={open} onClose={onClose} dismissible={!busy} className="paper" labelledBy="checkout-title"
      header={<div className="oa-kicker" id="checkout-title">Checkout</div>}>
      {done ? (
        <OrderConfirm
          title="Order in."
          sub={confirmWords(done.readyFrom, done.paid)}
          totalCents={done.total}
          totalLabel={done.paid ? "paid" : "due at the truck"}
          warn={done.warn}
          rows={[
            ...done.lines.map(([id, q]) => ({ label: DRINKS[id].n, value: `${q}×` })),
            { label: "For", value: done.name },
            { label: "Pickup", value: done.pickup },
            ...(done.ref ? [{ label: "Ref", value: `#${done.ref}` }] : []),
            { label: done.paid ? "Paid" : "Pay at pickup", value: money(done.total) },
          ]}
          ctaLabel="Reserve a Saturday pack →"
          onCta={() => { onClose(); router.push("/reserve"); }}
          secondaryLabel="Not now"
          onSecondary={onClose}
        />
      ) : (
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
                    <button type="button" className="co-step" aria-label={`Remove one ${DRINKS[id].n}`} onClick={() => dec(id)} disabled={busy}>−</button>
                    <b>{q}</b>
                    <button type="button" className="co-step" aria-label={`Add one ${DRINKS[id].n}`} onClick={() => inc(id)} disabled={busy}>+</button>
                    {DRINKS[id].n}
                  </span>
                  <span>{money(priceOf(id) * q)}</span>
                </div>
              ))}

              {/* One quiet line — the closed state and the post-pay screen own the full pack pitch
                  in their moments; while paying, the cart is the hero. */}
              {ordering.open && (
                <button type="button" className="co-upsell-line" onClick={() => router.push("/reserve")}>
                  {packUpsell ? (
                    <>Bottles for your week? <b>Reserve a Saturday {packUpsell.size}-pack — bottles from {packUpsell.per}, save {packUpsell.pct}% ›</b></>
                  ) : (
                    <>Bottles for your week? <b>Reserve a Saturday pack ›</b></>
                  )}
                </button>
              )}

              {/* WHERE AND WHEN, before the money (2026-10-04). The sheet said neither: an order placed
                  at 7am for an 11am stop read "Pay $10" here and "Ready in ~8 min" after it. */}
              {o?.open && (
                <div className="co-pickup">
                  <Icon name="pin" /> <b>{pickupWords(o)}</b>
                  <span className="co-pickup-when">{readyWords(o)}{o.stop?.pickup ? " Skip the line at pickup." : ""}</span>
                </div>
              )}

              {!ordering.open ? (
                <div className="co-closed">
                  <div className="co-closed-t"><Icon name="coffee" /> The truck isn&apos;t taking online orders right now</div>
                  {o && <p className="co-closed-s">{closedWords(o, { closing: t("findus.cta_closed") })}</p>}
                  <p className="co-closed-s">Want it locked in anyway? A <b>pack reserve</b> is brewed to your order and waiting at the next drop.</p>
                  <button type="button" className="handle" onClick={() => { onClose(); router.push("/reserve"); }}><span>Reserve a pack instead</span></button>
                  <div className="signoff">Your cart stays right here for when we&apos;re pouring.</div>
                </div>
              ) : squareClientReady ? (
                <>
                  <div className="co-line"><span>Subtotal</span><span>{money(totalCents)}</span></div>
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
                    <PaymentCard ref={paymentRef} className="sq-card" tone="paper" onReady={setReady} onError={(m) => setErr(m ?? "")} />
                    {!ready && <div className="sk sq-sk-bar" />}
                  </div>
                  {err && <div className="auth-err">{err}</div>}
                  <div className="co-foot">
                    {blocked86.length > 0 && <div className="co-86">{blocked86.join(" · ")} just sold out — remove {blocked86.length === 1 ? "it" : "them"} with the − button to continue.</div>}
                    <div className="co-line co-total"><span>Total</span><span>{total}</span></div>
                    <button className="handle" onClick={pay} disabled={!ready || busy || items.length === 0 || !customer || blocked86.length > 0}>
                      <span>{busy ? "Charging…" : blocked86.length > 0 ? "Remove sold-out items" : !customer ? "Add a name above" : ready ? `Pay ${total}` : "Loading card…"}</span>
                    </button>
                    {/* Card is primary; pay-at-pickup is the secondary path when the operator allows it. */}
                    {payLater.on && (
                      <button type="button" className="co-paylater" onClick={sendPreOrder} disabled={busy || items.length === 0 || !customer || blocked86.length > 0}>
                        or <b>pay at the truck</b> — send pre-order
                      </button>
                    )}
                    <div className="signoff">Secured by Square · skip the line at pickup.<br />Your card is never stored here — Square handles it. The charge shows as <b>GT3 Performance Bar</b>.</div>
                  </div>
                </>
              ) : payLater.on ? (
                <>
                  {blocked86.length > 0 && <div className="co-86">{blocked86.join(" · ")} just sold out — remove {blocked86.length === 1 ? "it" : "them"} with the − button to continue.</div>}
                  <div className="co-line co-total"><span>Total</span><span>{money(totalCents)}</span></div>
                  <div className="honest" style={{ marginTop: 16 }}>
                    This is a <b>pre-order</b>{" "}— we&apos;ll have it ready and you pay at the truck.
                  </div>
                  <button className="handle" onClick={sendPreOrder} disabled={busy || !customer || items.length === 0 || blocked86.length > 0}>
                    <span>{busy ? "Sending…" : blocked86.length > 0 ? "Remove sold-out items" : "Send pre-order"}</span>
                  </button>
                </>
              ) : (
                <div className="co-closed">
                  <div className="co-closed-t">Checkout isn&apos;t switched on yet</div>
                  <p className="co-closed-s">Card payments arrive with the Square keys, and pay-at-the-truck is turned off right now. Come see us at the window.</p>
                </div>
              )}
            </>
      )}
    </Sheet>
  );
}
