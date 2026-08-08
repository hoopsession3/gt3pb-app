"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import { authedFetch } from "@/lib/authedFetch";
import { squareClientReady } from "@/lib/square";
import PaymentCard, { type PaymentCardHandle } from "@/components/PaymentCard";
import AccountPill from "@/components/AccountPill";
import Watermark from "@/components/Watermark";
import Icon from "@/components/Icon";
import { Masthead, ClosingBeat } from "@/components/kit";

// THE SHOP (0273) — GT3 merch on the 0271 storefront spine. Reads published merch through RLS, a simple
// cart in memory, and the shared Square card mount + /api/shop/checkout for a real one-time charge that
// records a shop_orders row and hands print-on-demand to Apliiq. Same paper-editorial checkout language
// as the rest of the storefront. No browser storage — the cart lives in React state for the session.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Variant = { size?: string; color?: string; sku?: string; apliiq_variant_id?: string; [k: string]: unknown };
type Product = { id: string; title: string; blurb: string | null; price_cents: number; image_url: string | null; images: string[]; variants: Variant[]; public_title: string | null };
type CartLine = { product: Product; variant: Variant | null; qty: number };

const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
const variantLabel = (v: Variant | null) => (v ? [v.size, v.color].filter(Boolean).join(" · ") : "");
const newKey = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function Shop() {
  const { user } = useAuth();
  const [view, setView] = useState<"grid" | "product" | "checkout" | "done">("grid");
  const [active, setActive] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [doneRef, setDoneRef] = useState<{ warn?: string } | null>(null);

  const loader = useCallback(async (): Promise<Product[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("shop_products")
      .select("id, title, blurb, price_cents, image_url, images, variants, public_title")
      .eq("kind", "merch").not("published_at", "is", null).is("archived_at", null).order("sort");
    if (error) throw new Error(error.message);
    return ((data as any[]) ?? []).map((p) => ({ ...p, images: Array.isArray(p.images) ? p.images : [], variants: Array.isArray(p.variants) ? p.variants : [] }));
  }, []);
  const board = useAsyncData<Product[]>(loader, []);
  const products = board.data ?? [];

  const count = cart.reduce((n, l) => n + l.qty, 0);
  const total = cart.reduce((n, l) => n + l.product.price_cents * l.qty, 0);

  const addToCart = (product: Product, variant: Variant | null, qty: number) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === product.id && variantLabel(l.variant) === variantLabel(variant));
      if (i >= 0) { const next = [...c]; next[i] = { ...next[i], qty: next[i].qty + qty }; return next; }
      return [...c, { product, variant, qty }];
    });
  };
  const setQty = (idx: number, qty: number) => setCart((c) => (qty <= 0 ? c.filter((_, i) => i !== idx) : c.map((l, i) => (i === idx ? { ...l, qty } : l))));

  return (
    <section className="screen shop" id="s-shop">
      <Watermark variant="menu" />
      <Masthead tone="light" eyebrow="The Shop" right={<AccountPill />} />

      {view === "grid" && (
        <>
          <p className="shop-stmt">Wear the standard. Printed on demand, shipped to you — the same no-shortcuts ethos as the cup.</p>
          {board.status === "loading" && <div className="shop-note">Loading the shop…</div>}
          {board.status === "error" && <div className="shop-note err">Couldn’t load the shop. Try again in a moment.</div>}
          {board.status === "ready" && products.length === 0 && <div className="shop-note">New drops are on the way — check back soon.</div>}
          <div className="shop-grid">
            {products.map((p) => (
              <button type="button" key={p.id} className="shop-card" onClick={() => { setActive(p); setView("product"); }}>
                <div className="shop-thumb">{p.image_url ? <img src={p.image_url} alt={p.title} loading="lazy" /> : <span className="shop-thumb-ph"><Icon name="package" /></span>}</div>
                <div className="shop-card-b">
                  <span className="shop-card-t">{p.public_title || p.title}</span>
                  <span className="shop-card-px">{money(p.price_cents)}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {view === "product" && active && (
        <ProductDetail product={active} onBack={() => setView("grid")} onAdd={(v, q) => { addToCart(active, v, q); setView("grid"); }} />
      )}

      {view === "checkout" && (
        <CheckoutView cart={cart} total={total} isMember={!!user} setQty={setQty}
          onBack={() => setView("grid")} onDone={(warn) => { setDoneRef({ warn }); setCart([]); setView("done"); }} />
      )}

      {view === "done" && (
        <div className="shop-done">
          <span className="shop-done-ic"><Icon name="check" /></span>
          <h1 className="shop-h1">Order <i>in</i></h1>
          <p className="shop-lede">{doneRef?.warn || "Thanks — we’ve got it. You’ll get an email now, and tracking the moment it ships."}</p>
          <button type="button" className="btn-sec" onClick={() => setView("grid")}>Keep shopping</button>
        </div>
      )}

      {/* sticky cart bar */}
      {count > 0 && view !== "done" && view !== "checkout" && (
        <button type="button" className="shop-cartbar" onClick={() => setView("checkout")}>
          <span className="shop-cartbar-n">{count} item{count > 1 ? "s" : ""}</span>
          <span className="shop-cartbar-go">Checkout · {money(total)} <Icon name="arrowRight" size={15} /></span>
        </button>
      )}

      {view === "grid" && <ClosingBeat />}
    </section>
  );
}

function ProductDetail({ product, onBack, onAdd }: { product: Product; onBack: () => void; onAdd: (v: Variant | null, qty: number) => void }) {
  const [vi, setVi] = useState(0);
  const [qty, setQty] = useState(1);
  const hasVariants = product.variants.length > 0;
  const variant = hasVariants ? product.variants[vi] : null;
  return (
    <div className="shop-detail">
      <button type="button" className="btn-ter shop-back" onClick={onBack}><b style={{ transform: "rotate(180deg)", display: "inline-flex" }}><Icon name="arrowRight" size={14} /></b> Shop</button>
      <div className="shop-hero">{product.image_url ? <img src={product.image_url} alt={product.title} /> : <span className="shop-thumb-ph lg"><Icon name="package" /></span>}</div>
      <h1 className="shop-h1 sm">{product.title}</h1>
      <div className="shop-detail-px">{money(product.price_cents)}</div>
      {product.blurb && <p className="shop-blurb">{product.blurb}</p>}
      {hasVariants && (
        <label className="shop-vari">
          <span>Options</span>
          <select value={vi} onChange={(e) => setVi(Number(e.target.value))}>
            {product.variants.map((v, i) => <option key={i} value={i}>{variantLabel(v) || v.sku || `Option ${i + 1}`}</option>)}
          </select>
        </label>
      )}
      <div className="shop-qty">
        <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Fewer">–</button>
        <span>{qty}</span>
        <button type="button" onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="More">+</button>
      </div>
      <button type="button" className="mpack-cta" onClick={() => onAdd(variant, qty)}>Add to cart · {money(product.price_cents * qty)}</button>
    </div>
  );
}

function CheckoutView({ cart, total, isMember, setQty, onBack, onDone }: {
  cart: CartLine[]; total: number; isMember: boolean; setQty: (idx: number, qty: number) => void; onBack: () => void; onDone: (warn?: string) => void;
}) {
  const payRef = useRef<PaymentCardHandle>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ship, setShip] = useState({ name: "", street: "", city: "", state: "", zip: "", email: "" });
  const idem = useMemo(newKey, [cart]);
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
          sourceId: res.token, idempotencyKey: idem,
          items: cart.map((l) => ({ product_id: l.product.id, variant: l.variant, qty: l.qty })),
          ship,
        }),
      });
      const data = await r.json();
      if (!r.ok) { setErr(data.error || "Payment failed."); setBusy(false); return; }
      onDone(data.warn);
    } catch { setErr("Something went wrong — you were not charged twice; check your email or try again."); setBusy(false); }
  };

  return (
    <div className="shop-checkout">
      <button type="button" className="btn-ter shop-back" onClick={onBack}><b style={{ transform: "rotate(180deg)", display: "inline-flex" }}><Icon name="arrowRight" size={14} /></b> Shop</button>
      <h1 className="shop-h1 sm">Checkout</h1>

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
        <div className="shop-total"><span>Total</span><b>{money(total)}</b></div>
      </div>

      <div className="shop-ship">
        <div className="shop-ship-n">Ship to</div>
        <input placeholder="Full name" value={ship.name} onChange={(e) => setShip({ ...ship, name: e.target.value })} autoComplete="name" />
        <input placeholder="Street address" value={ship.street} onChange={(e) => setShip({ ...ship, street: e.target.value })} autoComplete="address-line1" />
        <div className="shop-ship-row">
          <input placeholder="City" value={ship.city} onChange={(e) => setShip({ ...ship, city: e.target.value })} autoComplete="address-level2" />
          <input placeholder="State" value={ship.state} onChange={(e) => setShip({ ...ship, state: e.target.value })} autoComplete="address-level1" style={{ maxWidth: 90 }} />
          <input placeholder="ZIP" value={ship.zip} onChange={(e) => setShip({ ...ship, zip: e.target.value })} autoComplete="postal-code" style={{ maxWidth: 100 }} />
        </div>
        {!isMember && <input placeholder="Email (for your receipt + tracking)" value={ship.email} onChange={(e) => setShip({ ...ship, email: e.target.value })} autoComplete="email" type="email" />}
      </div>

      <div className="shop-pay">
        <div className="shop-ship-n">Payment</div>
        {squareClientReady ? (
          <>
            <PaymentCard ref={payRef} tone="paper" onReady={setReady} onError={(m) => setErr(m)} />
            {err && <div className="shop-err">{err}</div>}
            <button type="button" className="mpack-cta" onClick={pay} disabled={!canPay}>{busy ? "Charging…" : `Pay ${money(total)}`}</button>
            <p className="shop-fine">Printed on demand and shipped to you. You’ll get tracking by email when it ships.</p>
          </>
        ) : (
          <div className="shop-note err">Card checkout isn’t switched on yet.</div>
        )}
      </div>
    </div>
  );
}
