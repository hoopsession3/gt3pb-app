"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { authedFetch } from "@/lib/authedFetch";
import { PAY_DEADLINE_MS } from "@/lib/deadline";
import { squareClientReady } from "@/lib/square";
import PaymentCard, { type PaymentCardHandle } from "@/components/PaymentCard";
import EditableCopy from "@/components/EditableCopy";
import Icon from "@/components/Icon";
import { useSiteCopy, fillCopy } from "@/lib/copy";
import { money } from "@/lib/money";
import { useIdemKey } from "./useIdemKey";
import { payErrorText } from "@/lib/idempotency";
import { US_STATES } from "@/lib/usAddress";
import { variantLabel, type CartLine } from "@/lib/shopCart";
import type { ShopReceipt } from "@/lib/receipt";
import { useCustomerKnown, useKnownField, invalidateCustomerKnown } from "./useCustomerKnown";
import { haptic } from "@/lib/haptics";
import AddressField from "@/components/AddressField";

// The held-payment notice loads when something is held (components/HeldNotice) — a moment few customers see.
const HeldNotice = dynamic(() => import("./HeldNotice"), { ssr: false });

// THE MERCH CHECKOUT — the cart, where it ships, and the card (0273). Moved out of components/Shop.tsx
// on 2026-10-04 and loaded only when a shopper opens it (Shop warms it as soon as the cart has
// something in it): the product grid is what most visitors download, and this screen — the card
// form's wiring, the address, the fifty states — rode in that first load for everyone.

export default function ShopCheckout({ cart, total, isMember, setQty, onBack, onDone }: {
  cart: CartLine[]; total: number; isMember: boolean; setQty: (idx: number, qty: number) => void; onBack: () => void; onDone: (warn?: string, emailed?: boolean, receipt?: ShopReceipt) => void;
}) {
  const t = useSiteCopy();
  const payRef = useRef<PaymentCardHandle>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The card's errors and the charge's are said inline, under the card — and felt from here, once
  // each time one appears (2026-10-05, the haptics round). Nothing on this screen toasts.
  useEffect(() => { if (err) haptic("error"); }, [err]);
  // WHERE IT SHIPS STARTS FROM WHAT WE KNOW (lib/customerKnown, 2026-10-04): a member's last shipping
  // label, else the door their last delivery went to — the full name a parcel needs, not the first
  // name they signed up with. Each field is theirs the moment they type in it. A guest types it, and
  // every field says what it is, so the phone's own saved address fills it.
  const known = useCustomerKnown(isMember);
  const [name, setName] = useKnownField(known?.fullName);
  const [street, setStreet, fromLast] = useKnownField(known?.ship?.street);
  const [city, setCity] = useKnownField(known?.ship?.city);
  const [state, setShipState] = useKnownField(known?.ship?.state);
  const [zip, setZip] = useKnownField(known?.ship?.zip);
  const [email, setEmail] = useState("");
  const ship = { name, street, city, state, zip, email };
  // ONE KEY PER CHECKOUT (2026-10-11, lib/idempotency). It was signed over the card nonce, and every
  // tap of Pay asked the card form for a new one — so a retry after a lost answer went to Square under
  // a new key and charged again. The cart is the key's signature now (what is bought and what it costs;
  // an address fixed after a lost answer is the same order, not a second charge), it survives a
  // remount (sessionStorage), and while the last answer is unknown the same card token goes with it, so
  // Square replays the first payment and the route finds its order by payment_id. Paid, or refused by
  // Square, and the next tap is a new checkout.
  const idem = useIdemKey("gt3-shop-idem");
  // THE TOTAL ON PAY IS THE MOST IT CHARGES (R5, lib/shownTotal — as packs and delivery). It goes with the order; a server
  // total above it comes back refused, with that total, and is shown here for this cart — the next tap agrees to it. A
  // change to the cart (an item, a size, a quantity) takes it back to the cart's own number.
  const cartSig = JSON.stringify(cart.map((l) => [l.product.id, variantLabel(l.variant), l.qty]));
  const [agreed, setAgreed] = useState<{ sig: string; cents: number } | null>(null);
  // A PAYMENT WHOSE ANSWER NEVER CAME HOLDS ITS ORDER STILL (R8, as the cup checkout has since R7). The quantities and
  // Back stayed live after a lost answer while the page said "you were not charged twice": any change was a new key, and
  // the next Pay a second charge and a second order. While it is unknown the cart holds still and the next tap asks about
  // that payment (the same key, answered from the first request); a held payment for a different cart blocks Pay until
  // the shopper starts over. The key is signed over what is bought and what it costs — never the card, never the address.
  const held = idem.isOpen();
  const was = idem.heldDetails() as { cart?: unknown; cents?: unknown } | null;
  // Signed before R8 over the cart's own lines ({ cart }) — a payment held across the update: the same cart is the same
  // payment, at the cart's own total (what that Pay said), and its key is kept (begin's `was`, below).
  const before = held && Array.isArray(was?.cart) && JSON.stringify(was.cart) === JSON.stringify(cart);
  const frozen = held && was?.cart === cartSig && typeof was.cents === "number" ? { cents: was.cents } : before ? { cents: total } : null;
  const heldElsewhere = held && !frozen;
  // Asking about a held payment, or making one — read when Pay is tapped (the hold opens as the first send leaves).
  const [rechecking, setRechecking] = useState(false);
  const payCents = frozen ? frozen.cents : agreed && agreed.sig === cartSig ? agreed.cents : total;
  // WHAT'S MISSING, SAID ON THE BUTTON (R12 — the 10/10 audit, F9). Pay stayed "Pay $32.00" and dimmed until every field
  // was filled, and nothing said which one wasn't — VoiceOver heard "Pay $32, dimmed". It says the first missing field
  // now, the way the cup checkout says "Add a name above".
  const missing = !ship.name ? "Add your name above" : !ship.street ? "Add your street address above" : !ship.city ? "Add your city above"
    : !ship.state ? "Choose your state above" : !ship.zip ? "Add your ZIP above" : !isMember && !ship.email ? "Add your email above" : null;
  const canPay = ready && !busy && !heldElsewhere && cart.length > 0 && !missing;

  const pay = async () => {
    if (!payRef.current) return;
    setRechecking(!!frozen);
    setBusy(true); setErr(null);
    const card = payRef.current;
    const attempt = await idem.begin({ cart: cartSig, cents: payCents }, () => card.tokenize(), [{ cart }]);
    if (!attempt.token) { setErr("Card details look off — check and try again."); setBusy(false); return; }
    idem.sent(attempt.key, true);   // held open from the send: the cart holds still until it is answered
    try {
      const r = await authedFetch("/api/shop/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: attempt.token, idempotencyKey: attempt.key, expectedCents: payCents,
          items: cart.map((l) => ({ product_id: l.product.id, variant: l.variant, qty: l.qty })),
          ship,
        }),
      }, { deadlineMs: PAY_DEADLINE_MS });
      const data = await r.json();
      idem.settle(attempt.key, r.status, data);
      if (!r.ok) {
        if (data?.totalChanged === true && typeof data.totalCents === "number") setAgreed({ sig: cartSig, cents: data.totalCents });
        setErr(payErrorText(data.error)); setBusy(false); return;
      }
      haptic("paid");
      invalidateCustomerKnown();   // the next form starts from this order
      onDone(data.warn, data.emailed === true, data.receipt && typeof data.receipt === "object" ? (data.receipt as ShopReceipt) : undefined);
    } catch {
      idem.settle(attempt.key, null, null);
      setErr("We couldn't confirm the payment — tap the button to check on it. You won't be charged twice."); setBusy(false);
    }
  };

  return (
    <div className="shop-checkout">
      <button type="button" className="btn-ter shop-back" onClick={onBack} disabled={!!frozen}><b style={{ transform: "rotate(180deg)", display: "inline-flex" }}><Icon name="arrowRight" size={14} /></b> {t("shop.back")}</button>
      <EditableCopy k="checkout.title" value={t("checkout.title")} as="h1" className="shop-h1 sm" />

      <div className="shop-lines">
        {cart.map((l, i) => (
          <div className="shop-line" key={i}>
            <div className="shop-line-x">
              <span className="shop-line-t">{l.product.title}</span>
              {variantLabel(l.variant) && <span className="shop-line-v">{variantLabel(l.variant)}</span>}
            </div>
            <div className="shop-line-qty">
              <button type="button" className="hit-44 disabled:opacity-40" onClick={() => setQty(i, l.qty - 1)} disabled={!!frozen} aria-label={l.qty <= 1 ? `Remove ${l.product.title}` : `One fewer ${l.product.title}`}>–</button>
              <span aria-live="polite">{l.qty}</span>
              <button type="button" className="hit-44 disabled:opacity-40" onClick={() => setQty(i, l.qty + 1)} disabled={l.qty >= 20 || !!frozen} aria-label={`One more ${l.product.title}`}>+</button>
            </div>
            <span className="shop-line-px">{money(l.product.price_cents * l.qty)}</span>
          </div>
        ))}
        <div className="shop-total"><span>{t("checkout.total")}</span><b>{money(payCents)}</b></div>
      </div>

      {held && !busy && (
        <HeldNotice buttonClass="co-paylater" what="Your last payment hasn’t been confirmed yet."
          line={frozen
            ? "Tap the button below to check on it — you won’t be charged twice, and your cart stays as it is until it’s answered."
            : "It was for a different cart. Check your email for a receipt before paying again — or put that cart together again here to check on it."}
          warning="Only start over if we’ve told you it didn’t go through — otherwise this would be a second order."
          onStartOver={() => { idem.forget(); setErr(null); }} />
      )}

      <div className="shop-ship">
        <EditableCopy k="checkout.ship_to" value={t("checkout.ship_to")} as="div" className="shop-ship-n" />
        {fromLast && <p className="known-note">From your {known?.shipFrom === "shop" ? "last order" : "last delivery"} — change anything that&apos;s different.</p>}
        {/* LABELS YOU CAN SEE (R12 — the 10/10 audit, F9). These were placeholders and nothing else, and the fields are
            filled from the last order: a returning shopper saw "123 Main St" and "29601" with no word for either, and a
            screen reader heard the owner-editable placeholder copy as the field's name. Each field has its label above it
            now (the same words), and the browser's autofill knows they are the shipping address. */}
        <label className="fld-l block mt-0.5 mb-[5px]" htmlFor="ship-name">{t("checkout.ph_name")}</label>
        <input id="ship-name" value={ship.name} onChange={(e) => setName(e.target.value)} autoComplete="shipping name" />
        <label className="fld-l block mt-0.5 mb-[5px]" htmlFor="ship-street">{t("checkout.ph_street")}</label>
        <AddressField id="ship-street" autoComplete="shipping address-line1" label={t("checkout.ph_street")} value={ship.street} onChange={setStreet}
          onPick={(a) => { setStreet(a.street); if (a.city) setCity(a.city); if (US_STATES.some(([c]) => c === a.state)) setShipState(a.state); if (a.zip) setZip(a.zip); }} />
        <label className="fld-l block mt-0.5 mb-[5px]" htmlFor="ship-city">{t("checkout.ph_city")}</label>
        <input id="ship-city" value={ship.city} onChange={(e) => setCity(e.target.value)} autoComplete="shipping address-level2" />
        {/* THE STATE IS A PICK (lib/usAddress). It was a 90px text box, and the printer was sent its
            first two letters: "New York" shipped as NE. The list keeps the code; a browser's saved
            address fills it by name or code alike. The city has its own line so the state's name fits. */}
        <div className="shop-ship-row">
          <div className="flex-1 min-w-0 [&_select]:w-full">
            <label className="fld-l block mt-0.5 mb-[5px]" htmlFor="ship-state">{t("checkout.ph_state")}</label>
            <select id="ship-state" value={ship.state} onChange={(e) => setShipState(e.target.value)} autoComplete="shipping address-level1" className={ship.state ? undefined : "ph"}>
              <option value="">Choose…</option>
              {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </div>
          <div className="flex-[0_0_120px] min-w-0">
            <label className="fld-l block mt-0.5 mb-[5px]" htmlFor="ship-zip">{t("checkout.ph_zip")}</label>
            <input id="ship-zip" value={ship.zip} onChange={(e) => setZip(e.target.value)} autoComplete="shipping postal-code" inputMode="numeric" maxLength={10} />
          </div>
        </div>
        {!isMember && <>
          <label className="fld-l block mt-0.5 mb-[5px]" htmlFor="ship-email">{t("checkout.ph_email")}</label>
          <input id="ship-email" value={ship.email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" type="email" />
        </>}
      </div>

      <div className="shop-pay">
        <EditableCopy k="checkout.payment" value={t("checkout.payment")} as="div" className="shop-ship-n" />
        {squareClientReady ? (
          <>
            <PaymentCard ref={payRef} onReady={setReady} onError={(m) => setErr(m)} />
            {err && <div className="shop-err" role="alert">{err}</div>}
            {/* Pay button + 'Charging…' loading label inside a <button> → plain t()/fillCopy. */}
            <button type="button" className="btn-pri btn-wide mt-3.5" onClick={pay} disabled={!canPay}>{busy ? (rechecking ? "Checking…" : "Charging…") : frozen ? "Check on my payment" : missing ?? fillCopy(t("checkout.pay"), { total: money(payCents) })}</button>
            <EditableCopy k="checkout.fine" value={t("checkout.fine")} as="p" className="shop-fine" multiline />
          </>
        ) : (
          <EditableCopy k="checkout.off" value={t("checkout.off")} as="div" className="shop-note err" />
        )}
      </div>
    </div>
  );
}
