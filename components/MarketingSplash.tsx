"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { DELIVERY_PRICING } from "@/lib/delivery";

// MARKETING SPLASH — the card the app opens to for guests. Content is owner-editable (promos, 0144,
// edited in Studio → App splash), so it changes with no deploy. Shows ONCE PER APP OPEN (per
// session — reopening the app shows it again; navigating within a session does not re-nag), always
// closeable three ways (X, tap-outside, "Maybe later"), and leads with the pack pitch. Renders
// nothing when there's no active promo or the table isn't there yet — it never blocks the app.

type Promo = { id: string; headline: string; body: string | null; cta_label: string | null; cta_href: string | null; image_url: string | null };
const SESSION_KEY = "gt3-promo-shown"; // set once shown this session, so it appears once per open

// Module-level guard so React StrictMode double-mount / route changes don't double-fire the fetch.
let shownThisSession = false;

const money = (c: number) => `$${(c / 100).toFixed(0)}`;

export default function MarketingSplash() {
  const router = useRouter();
  const [promo, setPromo] = useState<Promo | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    try { if (sessionStorage.getItem(SESSION_KEY)) shownThisSession = true; } catch { /* */ }
    if (shownThisSession) return;
    let live = true;
    supabase.from("promos").select("id, headline, body, cta_label, cta_href, image_url")
      .eq("active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        if (!live || !data || shownThisSession) return;
        shownThisSession = true;
        try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* */ }
        setPromo(data as Promo);
        setTimeout(() => { if (live) setShow(true); }, 400); // a beat, so it feels intentional
      });
    return () => { live = false; };
  }, []);

  // lock the page scroll behind the card while it's open (no drag-through), restore on close
  useEffect(() => {
    if (!show) return;
    const b = document.getElementById("body") ?? document.body;
    const prev = b.style.overflow; b.style.overflow = "hidden";
    return () => { b.style.overflow = prev; };
  }, [show]);

  const close = () => setShow(false);
  const go = () => {
    const href = promo?.cta_href;
    setShow(false);
    if (href) { if (href.startsWith("/")) router.push(href); else window.open(href, "_blank", "noopener"); }
  };

  if (!promo || !show) return null;
  // Pack-savings chips are the pitch — accurate to the live pricing model, shown for the packs CTA.
  const packsPitch = (promo.cta_href || "").startsWith("/delivery") || (promo.cta_href || "").startsWith("/reserve");
  return (
    <div className="promo-scrim" role="dialog" aria-modal="true" aria-label="A note from GT3" onClick={close}>
      <div className="promo-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="promo-x" onClick={close} aria-label="Close">✕</button>
        {promo.image_url && <div className="promo-img" style={{ backgroundImage: `url(${promo.image_url})` }} aria-hidden />}
        <div className="promo-body">
          <div className="promo-eyb">GT<span>3</span> · Performance Bar</div>
          <h2 className="promo-h">{promo.headline}</h2>
          {promo.body && <p className="promo-p">{promo.body}</p>}
          {packsPitch && (
            <div className="promo-chips" aria-hidden>
              <span><b>Mix &amp; match</b> any brews</span>
              <span><b>{money(DELIVERY_PRICING.refill)}</b>/bottle with your empties back</span>
              <span><b>Free delivery</b> at {DELIVERY_PRICING.feeWaivedAt}+</span>
            </div>
          )}
          <div className="promo-acts">
            {promo.cta_label && promo.cta_href && <button type="button" className="promo-cta" onClick={go}>{promo.cta_label}</button>}
            <button type="button" className="promo-skip" onClick={close}>Maybe later</button>
          </div>
        </div>
      </div>
    </div>
  );
}
