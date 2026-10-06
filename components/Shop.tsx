"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import AccountPill from "@/components/AccountPill";
import EditCopyPill from "@/components/EditCopyPill";
import EditableCopy from "@/components/EditableCopy";
import Watermark from "@/components/Watermark";
import Icon from "@/components/Icon";
import { Masthead, ClosingBeat } from "@/components/kit";
import { useSiteCopy } from "@/lib/copy";
import OrderFunnel from "@/components/OrderFunnel";
import Reserves from "@/components/Reserves";
import StorefrontStory from "@/components/StorefrontStory";
import { readMedia, coverOf, hasVideo, type MediaItem } from "@/lib/shopMedia";
import { money } from "@/lib/money";
import { useApp } from "@/components/AppProvider";
import { variantLabel, type Variant, type Product, type CartLine } from "@/lib/shopCart";
import SwipePager from "@/components/SwipePager";
import { haptic } from "@/lib/haptics";

// THE SHOP (0273) — GT3 merch on the 0271 storefront spine. Reads published merch through RLS, a simple
// cart in memory, and the shared Square card mount + /api/shop/checkout for a real one-time charge that
// records a shop_orders row and hands print-on-demand to Apliiq. Same paper-editorial checkout language
// as the rest of the storefront. No browser storage — the cart lives in React state for the session.
/* eslint-disable @typescript-eslint/no-explicit-any */

// The merch checkout loads when it is wanted (components/ShopCheckout, 2026-10-04) — see the warm-up
// in Shop below, which fetches it the moment the cart holds something.
const ShopCheckout = dynamic(() => import("./ShopCheckout"));
// The full-screen photos load the same way (2026-10-05): fetched once a product with a story is open
// (ProductDetail's warm-up), so the tap on its hero opens at once — and a guest browsing the aisles
// never downloads the viewer, nor the finger-following engine it rides.
const StoryViewer = dynamic(() => import("./StoryViewer"), { ssr: false });

// The shop's two aisles, in the order its row shows them — and the order a swipe turns through them.
type Aisle = "bottles" | "merch";
const SHOP_AISLES: readonly Aisle[] = ["bottles", "merch"];

export default function Shop() {
  const { user } = useAuth();
  const t = useSiteCopy();
  const [view, setView] = useState<"grid" | "product" | "checkout" | "done">("grid");
  const [active, setActive] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [doneRef, setDoneRef] = useState<{ warn?: string; emailed?: boolean } | null>(null);
  // Claim the screen for the whole PURCHASE, not just the form: the drinks CartBar was floating over
  // the Pay button on checkout, and then again under "Order in" on the confirmation, both times
  // quoting a different cart's total. Scoping this to the checkout view alone released it one screen
  // too early — the moment a customer is reading what they just bought is not the moment to offer
  // them a second, unrelated cart.
  const { setPayOpen } = useApp();
  const buying = view === "checkout" || view === "done";
  useEffect(() => { setPayOpen(buying); return () => setPayOpen(false); }, [buying, setPayOpen]);
  // Two aisles under one roof (2026-08): Bottles = the Saturday-drop pack reserve (the old /reserve
  // flow, embedded) · Merch = the capsule below. Default Bottles — the everyday take-home, and it
  // keeps continuity with the Reserve tab this replaced. ?tab=merch|bottles deep-links either aisle.
  const [section, setSection] = useState<Aisle>("bottles");
  useEffect(() => {
    try { const q = new URLSearchParams(window.location.search).get("tab"); if (q === "merch" || q === "bottles") setSection(q); } catch { /* ignore */ }
  }, []);

  const loader = useCallback(async (): Promise<Product[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("shop_products")
      .select("id, title, blurb, price_cents, image_url, images, variants, public_title, media")
      .eq("kind", "merch").not("published_at", "is", null).is("archived_at", null).order("sort");
    if (error) throw new Error(error.message);
    return ((data as any[]) ?? []).map((p) => ({ ...p, images: Array.isArray(p.images) ? p.images : [], variants: Array.isArray(p.variants) ? p.variants : [] }));
  }, []);
  const board = useAsyncData<Product[]>(loader, []);
  const products = board.data ?? [];

  const count = cart.reduce((n, l) => n + l.qty, 0);
  const total = cart.reduce((n, l) => n + l.product.price_cents * l.qty, 0);
  // Warm the checkout as soon as there is something to check out, so "Checkout" opens at once.
  const hasCart = count > 0;
  useEffect(() => { if (hasCart) void import("./ShopCheckout"); }, [hasCart]);

  const addToCart = (product: Product, variant: Variant | null, qty: number) => {
    haptic("medium");
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === product.id && variantLabel(l.variant) === variantLabel(variant));
      if (i >= 0) { const next = [...c]; next[i] = { ...next[i], qty: next[i].qty + qty }; return next; }
      return [...c, { product, variant, qty }];
    });
  };
  // Which way the line went is read from the cart on screen, before the update (the updater stays pure).
  const setQty = (idx: number, qty: number) => {
    if (qty > (cart[idx]?.qty ?? 0)) haptic("increase"); else haptic("decrease");
    setCart((c) => (qty <= 0 ? c.filter((_, i) => i !== idx) : c.map((l, i) => (i === idx ? { ...l, qty } : l))));
  };

  return (
    <section className="screen shop" id="s-shop">
      <Watermark variant="menu" />
      <Masthead tone="light" eyebrow={<EditableCopy k="shop.eyebrow" value={t("shop.eyebrow")} />} right={<div className="mast-right"><EditCopyPill group="Shop" /><AccountPill /></div>} />

      {/* One h1 per rendered state: the hub views (Bottles, or the Merch grid) get an sr-only h1;
          the Merch product/checkout/done views render their own visible <h1>. /shop stays in
          AppShell's H1_SKIP, so this is the page's only h1 at any moment. */}
      {(section === "bottles" || view === "grid") && <h1 className="sr-only">{t("nav.shop") || "Shop"}</h1>}

      {/* Two aisles: Bottles (pack reserve) · Merch (capsule). Hidden while inside a Merch sub-view
          (product/checkout/done) so those flows read as their own focused screen. */}
      {(section === "bottles" || view === "grid") && (
        <div className="menu-chips shop-sections" role="tablist" aria-label="Shop">
          <button type="button" role="tab" aria-selected={section === "bottles"} className={`menu-chip${section === "bottles" ? " on" : ""}`} onClick={() => setSection("bottles")}>{t("shop.sec_bottles")}</button>
          <button type="button" role="tab" aria-selected={section === "merch"} className={`menu-chip${section === "merch" ? " on" : ""}`} onClick={() => setSection("merch")}>{t("shop.sec_merch")}</button>
        </div>
      )}

      {/* The two aisles are pages: a sideways swipe on the shop turns from Bottles to Merch and back
          (components/SwipePager) — the tap on the aisle row, by the thumb. Inside a product, the cart or
          the receipt there is no row, and nothing turns. */}
      <SwipePager levels={[(section === "bottles" || view === "grid") && { keys: SHOP_AISLES, current: section, go: (k) => setSection(k as Aisle), depth: 0 }]}>
      {section === "bottles" && (
        <>
          <EditableCopy k="reserve.headline" value={t("reserve.headline")} as="p" className="shop-stmt" multiline />
          <Reserves />
          <OrderFunnel initialMode="pickup" syncUrl={false} />
          <StorefrontStory />
          <ClosingBeat />
        </>
      )}

      {section === "merch" && view === "grid" && (
        <>
          <EditableCopy k="shop.tagline" value={t("shop.tagline")} as="p" className="shop-stmt" multiline />
          {board.status === "loading" && <div className="shop-note">Loading the shop…</div>}
          {board.status === "error" && <div className="shop-note err">Couldn’t load the shop. Try again in a moment.</div>}
          {board.status === "ready" && products.length === 0 && <EditableCopy k="shop.empty" value={t("shop.empty")} as="div" className="shop-note" />}
          <div className="shop-grid">
            {products.map((p) => (
              <button type="button" key={p.id} className="shop-card" onClick={() => { setActive(p); setView("product"); }}>
                <div className="shop-thumb">{(() => { const m = readMedia(p); const cover = coverOf(m); return cover
                  ? <><img src={cover} alt={p.title} loading="lazy" />{m.length > 1 && <span className="shop-story-dot" aria-hidden>{hasVideo(m) ? "▶" : m.length}</span>}</>
                  : <span className="shop-thumb-ph"><Icon name="package" /></span>; })()}</div>
                <div className="shop-card-b">
                  <span className="shop-card-t">{p.public_title || p.title}</span>
                  <span className="shop-card-px">{money(p.price_cents)}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {section === "merch" && view === "product" && active && (
        <ProductDetail product={active} onBack={() => setView("grid")} onAdd={(v, q) => { addToCart(active, v, q); setView("grid"); }} />
      )}

      {section === "merch" && view === "checkout" && (
        <ShopCheckout cart={cart} total={total} isMember={!!user} setQty={setQty}
          onBack={() => setView("grid")} onDone={(warn, emailed) => { setDoneRef({ warn, emailed }); setCart([]); setView("done"); }} />
      )}

      {section === "merch" && view === "done" && (
        <div className="shop-done">
          <span className="shop-done-ic"><Icon name="check" /></span>
          <h1 className="shop-h1"><EditableCopy k="shop.done_title" value={t("shop.done_title")} /> <i><EditableCopy k="shop.done_title_em" value={t("shop.done_title_em")} /></i></h1>
          {/* The lede is editable copy and says "You'll get an email now". That was printed on
              2026-09-29 under an order whose receipt never sent, because nothing here asked. When
              the send did not happen the screen says what IS true instead — the order is real
              either way, and a customer who was promised an email and given none has no way to
              tell a silent provider from a lost order. */}
          {doneRef?.warn
            ? <p className="shop-lede">{doneRef.warn}</p>
            : doneRef?.emailed === false
            ? <p className="shop-lede">Your order is in — we have it. No email receipt went out, so keep this screen: we&apos;ll follow up by hand, and tracking still comes when it ships.</p>
            : <EditableCopy k="shop.done_lede" value={t("shop.done_lede")} as="p" className="shop-lede" multiline />}
          {/* "Keep shopping" is inside a <button> — plain t(), not EditableCopy (same nested-
              interactive rule as Craft's CTAs). Editable via Settings → the Shop group. */}
          <button type="button" className="btn-sec" onClick={() => setView("grid")}>{t("shop.keep")}</button>
        </div>
      )}

      {/* sticky cart bar */}
      {section === "merch" && count > 0 && view !== "done" && view !== "checkout" && (
        <button type="button" className="shop-cartbar" onClick={() => setView("checkout")}>
          <span className="shop-cartbar-n">{count} item{count > 1 ? "s" : ""}</span>
          <span className="shop-cartbar-go">{t("checkout.title")} · {money(total)} <Icon name="arrowRight" size={15} /></span>
        </button>
      )}

      {section === "merch" && view === "grid" && <ClosingBeat />}
      </SwipePager>
    </section>
  );
}

function ProductDetail({ product, onBack, onAdd }: { product: Product; onBack: () => void; onAdd: (v: Variant | null, qty: number) => void }) {
  const t = useSiteCopy();
  const [vi, setVi] = useState(0);
  const [qty, setQty] = useState(1);
  // The hero is the door into the story — one tap, full screen, tap through. A product with a
  // single photo has no story to tell, so the hero stays a plain image and nothing pretends.
  const media: MediaItem[] = readMedia(product);
  const cover = coverOf(media);
  const storyable = media.length > 1 || (media.length === 1 && media[0].kind === "video");
  const [storyAt, setStoryAt] = useState<number | null>(null);
  useEffect(() => { if (storyable) void import("./StoryViewer"); }, [storyable]);
  const hasVariants = product.variants.length > 0;
  const variant = hasVariants ? product.variants[vi] : null;
  return (
    <div className="shop-detail">
      <button type="button" className="btn-ter shop-back" onClick={onBack}><b style={{ transform: "rotate(180deg)", display: "inline-flex" }}><Icon name="arrowRight" size={14} /></b> {t("shop.back")}</button>
      {storyable ? (
        <button type="button" className="shop-hero as-story" onClick={() => setStoryAt(0)}
          aria-label={`Open ${product.title} — ${media.length} photo${media.length === 1 ? "" : "s"} and video, full screen`}>
          {cover ? <img src={cover} alt="" /> : <span className="shop-thumb-ph lg"><Icon name="package" /></span>}
          <span className="shop-hero-cue" aria-hidden>{hasVideo(media) ? "▶ Watch" : `${media.length} photos`}</span>
          <span className="shop-hero-pips" aria-hidden>{media.map((m) => <i key={m.id} />)}</span>
        </button>
      ) : (
        <div className="shop-hero">{cover ? <img src={cover} alt={product.title} /> : <span className="shop-thumb-ph lg"><Icon name="package" /></span>}</div>
      )}
      {storyAt !== null && (
        <StoryViewer items={media} start={storyAt} title={product.public_title || product.title} onClose={() => setStoryAt(null)} />
      )}
      <h1 className="shop-h1 sm">{product.title}</h1>
      <div className="shop-detail-px">{money(product.price_cents)}</div>
      {product.blurb && <p className="shop-blurb">{product.blurb}</p>}
      {hasVariants && (
        <label className="shop-vari">
          <span>{t("shop.options")}</span>
          <select value={vi} onChange={(e) => setVi(Number(e.target.value))}>
            {product.variants.map((v, i) => <option key={i} value={i}>{variantLabel(v) || v.sku || `Option ${i + 1}`}</option>)}
          </select>
        </label>
      )}
      <div className="shop-qty">
        <button type="button" onClick={() => { if (qty > 1) haptic("decrease"); else haptic("boundary"); setQty((q) => Math.max(1, q - 1)); }} aria-label="Fewer">–</button>
        <span>{qty}</span>
        <button type="button" onClick={() => { if (qty < 20) haptic("increase"); else haptic("boundary"); setQty((q) => Math.min(20, q + 1)); }} aria-label="More">+</button>
      </div>
      <button type="button" className="mpack-cta" onClick={() => onAdd(variant, qty)}>{t("shop.add_cart")} · {money(product.price_cents * qty)}</button>
    </div>
  );
}
