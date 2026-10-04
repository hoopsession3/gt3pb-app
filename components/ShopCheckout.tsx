"use client";

import { useRef, useState } from "react";
import { authedFetch } from "@/lib/authedFetch";
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

// THE MERCH CHECKOUT — the cart, where it ships, and the card (0273). Moved out of components/Shop.tsx
// on 2026-10-04 and loaded only when a shopper opens it (Shop warms it as soon as the cart has
// something in it): the product grid is what most visitors download, and this screen — the card
// form's wiring, the address, the fifty states — rode in that first load for everyone.

export default function ShopCheckout({ cart, total, isMember, setQty, onBack, onDone }: {
  cart: CartLine[]; total: number; isMember: boolean; setQty: (idx: number, qty: number) => void; onBack: () => void; onDone: (warn?: string, emailed?: boolean) => void;
}) {
  const t = useSiteCopy();
  const payRef = useRef<PaymentCardHandle>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ship, setShip] = useState({ name: "", street: "", city: "", state: "", zip: "", email: "" });
  // Was useMemo(newKey, [cart]): stable across retries but blind to the card nonce, which is
  // single-use and fresh on every tap of Pay. The second attempt at Ryan's cap order was refused
  // by Square and every attempt after it would have been too. See lib/idempotency.ts.
  const idemKeyFor = useIdemKey();
  const canPay = ready && !busy && cart.length > 0 && ship.name && ship.street && ship.city && ship.state && ship.zip && (isMember || ship.email);

  const pay = async () => {
    if (!payRef.current) return;
    setBusy(true); setErr(null);
    const res = await payRef.current.tokenize();
    if (res.status !== "OK" || !res.token) { setErr("Card details look off — check and try again."); setBusy(false); return; }
    try {
      const r = await authedFetch("/api/shop/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: res.token, idempotencyKey: idemKeyFor(res.token, { cart, ship }),
          items: cart.map((l) => ({ product_id: l.product.id, variant: l.variant, qty: l.qty })),
          ship,
        }),
      });
      const data = await r.json();
      if (!r.ok) { setErr(payErrorText(data.error)); setBusy(false); return; }
      onDone(data.warn, data.emailed === true);
    } catch { setErr("Something went wrong — you were not charged twice; check your email or try again."); setBusy(false); }
  };

  return (
    <div className="shop-checkout">
      <button type="button" className="btn-ter shop-back" onClick={onBack}><b style={{ transform: "rotate(180deg)", display: "inline-flex" }}><Icon name="arrowRight" size={14} /></b> {t("shop.back")}</button>
      <EditableCopy k="checkout.title" value={t("checkout.title")} as="h1" className="shop-h1 sm" />

      <div className="shop-lines">
        {cart.map((l, i) => (
          <div className="shop-line" key={i}>
            <div className="shop-line-x">
              <span className="shop-line-t">{l.product.title}</span>
              {variantLabel(l.variant) && <span className="shop-line-v">{variantLabel(l.variant)}</span>}
            </div>
            <div className="shop-line-qty">
              <button type="button" onClick={() => setQty(i, l.qty - 1)} aria-label="Fewer">–</button>
              <span>{l.qty}</span>
              <button type="button" onClick={() => setQty(i, l.qty + 1)} aria-label="More">+</button>
            </div>
            <span className="shop-line-px">{money(l.product.price_cents * l.qty)}</span>
          </div>
        ))}
        <div className="shop-total"><span>{t("checkout.total")}</span><b>{money(total)}</b></div>
      </div>

      <div className="shop-ship">
        <EditableCopy k="checkout.ship_to" value={t("checkout.ship_to")} as="div" className="shop-ship-n" />
        <input placeholder={t("checkout.ph_name")} value={ship.name} onChange={(e) => setShip({ ...ship, name: e.target.value })} autoComplete="name" />
        <input placeholder={t("checkout.ph_street")} value={ship.street} onChange={(e) => setShip({ ...ship, street: e.target.value })} autoComplete="address-line1" />
        <input placeholder={t("checkout.ph_city")} value={ship.city} onChange={(e) => setShip({ ...ship, city: e.target.value })} autoComplete="address-level2" />
        {/* THE STATE IS A PICK (lib/usAddress). It was a 90px text box, and the printer was sent its
            first two letters: "New York" shipped as NE. The list keeps the code; a browser's saved
            address fills it by name or code alike. The city has its own line so the state's name fits. */}
        <div className="shop-ship-row">
          <select aria-label={t("checkout.ph_state")} value={ship.state} onChange={(e) => setShip({ ...ship, state: e.target.value })} autoComplete="address-level1" className={ship.state ? undefined : "ph"}>
            <option value="">{t("checkout.ph_state")}</option>
            {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
          <input placeholder={t("checkout.ph_zip")} value={ship.zip} onChange={(e) => setShip({ ...ship, zip: e.target.value })} autoComplete="postal-code" inputMode="numeric" maxLength={10} style={{ maxWidth: 120 }} />
        </div>
        {!isMember && <input placeholder={t("checkout.ph_email")} value={ship.email} onChange={(e) => setShip({ ...ship, email: e.target.value })} autoComplete="email" type="email" />}
      </div>

      <div className="shop-pay">
        <EditableCopy k="checkout.payment" value={t("checkout.payment")} as="div" className="shop-ship-n" />
        {squareClientReady ? (
          <>
            <PaymentCard ref={payRef} tone="paper" onReady={setReady} onError={(m) => setErr(m)} />
            {err && <div className="shop-err">{err}</div>}
            {/* Pay button + 'Charging…' loading label inside a <button> → plain t()/fillCopy. */}
            <button type="button" className="mpack-cta" onClick={pay} disabled={!canPay}>{busy ? "Charging…" : fillCopy(t("checkout.pay"), { total: money(total) })}</button>
            <EditableCopy k="checkout.fine" value={t("checkout.fine")} as="p" className="shop-fine" multiline />
          </>
        ) : (
          <EditableCopy k="checkout.off" value={t("checkout.off")} as="div" className="shop-note err" />
        )}
      </div>
    </div>
  );
}
