"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// MARKETING SPLASH — the sales word-art the app opens to for guests. Fixed premium copy ("Own your
// week."), so it ships with NO database dependency and shows the moment we deploy. Once per app
// open (per session — reopening shows it again; navigating within a session doesn't re-nag), always
// closeable three ways (X, tap-outside, "Skip"). If an owner later sets an active promo (0144), its
// words override the defaults — best-effort, so a missing table just keeps the built-in copy.
//
// THE DISSOLVE (owner ask — "immediately start dissolving, after 10 secs all gone, smoke appears
// into a GT3 '3', then the home page"): the ad doesn't hold and close — the moment it's up it starts
// leaving. The copy drifts up and smokes out, a slow luxe haze blooms, and the brand red "3"
// condenses OUT of the smoke, sharpens and glows — then everything fades to nothing at 10s and the
// takeover unmounts, revealing the home page (truck) behind it. Skippable at any instant (tap /
// Skip / Esc). prefers-reduced-motion opts out: no auto-run, the static splash waits to be dismissed.

const SESSION_KEY = "gt3-splash-shown";

const DISSOLVE_MS = 10000;  // "after 10 secs all gone"

type Copy = { head1: string; head2: string; sub: string; cta: string; href: string };
const DEFAULT: Copy = {
  head1: "Own your", head2: "week.",
  sub: "A pack of clean, cold-extracted coffee — on your porch every Sunday.",
  cta: "Build my pack →", href: "/delivery",
};

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export default function MarketingSplash() {
  const router = useRouter();
  const [copy, setCopy] = useState<Copy>(DEFAULT);
  const [show, setShow] = useState(false);
  const [dissolving, setDissolving] = useState(false); // false only under reduced motion (static splash)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Once per session — but the flag is written only when the splash ACTUALLY shows (below), never
    // at schedule time. AuthProvider resolving can remount this subtree within the first frames; if
    // we set the flag up-front, that early remount would read it and permanently suppress the splash
    // for the whole session (the "never opens" bug). Guard on sessionStorage; a remount before the
    // show simply re-schedules.
    try { if (sessionStorage.getItem(SESSION_KEY)) return; } catch { /* */ }
    let cancelled = false;
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
    const t = setTimeout(() => {
      if (cancelled) return;
      try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* */ }
      setShow(true);
    }, 350);
    timers.current.push(t);
    return () => { cancelled = true; timers.current.forEach(clearTimeout); timers.current = []; };
  }, []);

  // The takeover dissolves the instant it's up: kick off the 10s sequence and unmount at the end.
  // Reduced motion opts out entirely — the splash stays static and waits for a manual dismiss.
  useEffect(() => {
    if (!show || reducedMotion()) return;
    setDissolving(true);
    const toClose = setTimeout(() => setShow(false), DISSOLVE_MS);
    timers.current.push(toClose);
    return () => clearTimeout(toClose);
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const b = document.getElementById("body") ?? document.body;
    const prev = b.style.overflow; b.style.overflow = "hidden";
    return () => { b.style.overflow = prev; };
  }, [show]);

  // Esc closes it too — a takeover that traps a keyboard user is the one thing worse than an ad.
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShow(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  const close = () => setShow(false);
  const go = () => { const h = copy.href; setShow(false); if (h) { if (h.startsWith("/")) router.push(h); else window.open(h, "_blank", "noopener"); } };

  if (!show) return null;
  return (
    <div className={`spl-scrim${dissolving ? " spl-smoke" : ""}`} role="dialog" aria-modal="true" aria-label="A note from GT3" onClick={close}>
      <button type="button" className="spl-skip" onClick={close}>Skip ›</button>

      {/* Smoke haze — drifting plumes that bloom, then gather toward center where the 3 forms. */}
      <div className="spl-haze" aria-hidden="true"><i /><i /><i /></div>

      <div className="spl-wrap" onClick={(e) => e.stopPropagation()}>
        <div className="spl-kick">Sunday delivery · Greenville</div>
        <h1 className="spl-head">{copy.head1}{copy.head2 ? <><br />{copy.head2}</> : null}</h1>
        <p className="spl-sub">{copy.sub} <b>From <span className="spl-price">$8</span> a bottle.</b></p>
        <button type="button" className="spl-cta" onClick={go}>{copy.cta}</button>
        <div className="spl-foot">Mix &amp; match · free delivery at 24+</div>
      </div>

      {/* Finale — the brand red "3" condenses out of the smoke, sharpens and glows, then fades. */}
      <div className="spl-finale" aria-hidden="true">
        <img className="spl-three" src="/brand/gt3-3.png" alt="" />
      </div>
    </div>
  );
}
