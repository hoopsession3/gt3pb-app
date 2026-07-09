"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// MARKETING SPLASH — the sales word-art the app opens to for guests. Fixed premium copy ("Own your
// week."), so it ships with NO database dependency and shows the moment we deploy. Once per app
// open (per session — reopening shows it again; navigating within a session doesn't re-nag), always
// closeable three ways (X, tap-outside, "Skip"). If an owner later sets an active promo (0144), its
// words override the defaults — best-effort, so a missing table just keeps the built-in copy.

const SESSION_KEY = "gt3-splash-shown";
let shownThisSession = false;

type Copy = { head1: string; head2: string; sub: string; cta: string; href: string };
const DEFAULT: Copy = {
  head1: "Own your", head2: "week.",
  sub: "A pack of clean, cold-extracted coffee — on your porch every Sunday.",
  cta: "Build my pack →", href: "/delivery",
};

export default function MarketingSplash() {
  const router = useRouter();
  const [copy, setCopy] = useState<Copy>(DEFAULT);
  const [show, setShow] = useState(false);

  useEffect(() => {
    try { if (sessionStorage.getItem(SESSION_KEY)) shownThisSession = true; } catch { /* */ }
    if (shownThisSession) return;
    shownThisSession = true;
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* */ }
    // Best-effort owner override (promos table, 0144). Missing table → keep the built-in copy.
    if (supabase) {
      supabase.from("promos").select("headline, body, cta_label, cta_href").eq("active", true)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle()
        .then(({ data }) => {
          if (data) {
            const p = data as { headline?: string; body?: string; cta_label?: string; cta_href?: string };
            const words = (p.headline || "").trim().split(/\s+/);
            setCopy((c) => ({
              head1: words.length > 1 ? words.slice(0, -1).join(" ") : (p.headline || c.head1),
              head2: words.length > 1 ? words[words.length - 1] : "",
              sub: p.body || c.sub,
              cta: p.cta_label || c.cta,
              href: p.cta_href || c.href,
            }));
          }
        });
    }
    const t = setTimeout(() => setShow(true), 350);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!show) return;
    const b = document.getElementById("body") ?? document.body;
    const prev = b.style.overflow; b.style.overflow = "hidden";
    return () => { b.style.overflow = prev; };
  }, [show]);

  const close = () => setShow(false);
  const go = () => { const h = copy.href; setShow(false); if (h) { if (h.startsWith("/")) router.push(h); else window.open(h, "_blank", "noopener"); } };

  if (!show) return null;
  return (
    <div className="spl-scrim" role="dialog" aria-modal="true" aria-label="A note from GT3" onClick={close}>
      <button type="button" className="spl-skip" onClick={close}>Skip ›</button>
      <div className="spl-wrap" onClick={(e) => e.stopPropagation()}>
        <div className="spl-kick">Sunday delivery · Greenville</div>
        <h1 className="spl-head">{copy.head1}{copy.head2 ? <><br />{copy.head2}</> : null}</h1>
        <p className="spl-sub">{copy.sub} <b>From <span className="spl-price">$8</span> a bottle.</b></p>
        <button type="button" className="spl-cta" onClick={go}>{copy.cta}</button>
        <div className="spl-foot">Mix &amp; match · free delivery at 24+</div>
      </div>
    </div>
  );
}
