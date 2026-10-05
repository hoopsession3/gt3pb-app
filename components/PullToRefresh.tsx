"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { held, useGesture } from "./useGesture";
import { sheetOpen } from "./Sheet";
import { PULL, pullShown } from "@/lib/gesture";
import { refreshLive } from "@/lib/realtime";
import { haptic, HAPTIC } from "@/lib/haptics";

// PULL TO REFRESH (2026-10-05, the gesture round) — the iPhone's "is this current?". At the top of the
// crew console, pull the screen down: it follows with the rubber band's give, a ring fills under it,
// and past PULL.arm the phone ticks; let go there and every live screen reads its data again
// (lib/realtime refreshLive — the loaders the screens already hand to realtime), the screen resting a
// little down with the ring turning until the reads are back. Short of the line it settles back.
// Only from the top — scrolled down, a pull down is a scroll — and never under an open sheet, from a
// field, or from something that handles its own swipes.
//
// The screen moves by one CSS variable on the scroll container (data-ptr), not by re-rendering. The
// container is the app's one <main id="body"> (components/AppShell), found once on mount.
export default function PullToRefresh() {
  const scroller = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { scroller.current = document.getElementById("body"); }, []);
  const ring = useRef<HTMLDivElement>(null);
  const armed = useRef(false);
  const busy = useRef(false);
  const [spinning, setSpinning] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);

  const paint = (shown: number) => {
    const el = scroller.current;
    if (!el) return;
    el.style.setProperty("--ptr", `${shown}px`);
    const r = ring.current;
    if (r) {
      const p = Math.min(1, shown / PULL.arm);
      r.style.setProperty("--ptr-p", String(p));
      r.style.opacity = String(Math.min(1, shown / 24));
    }
  };
  const settleTo = (shown: number) => new Promise<void>((done) => {
    const el = scroller.current;
    if (!el) { done(); return; }
    el.dataset.ptr = "ease";
    paint(shown);
    setTimeout(() => {
      if (shown === 0 && el.dataset.ptr === "ease") { el.dataset.ptr = ""; el.style.removeProperty("--ptr"); }
      done();
    }, 360);
  });

  useGesture(scroller, {
    axis: "y",
    begin: (target) => {
      const el = scroller.current;
      if (!el || busy.current || el.scrollTop > 0 || sheetOpen() || held(target, el, "y")) return false;
      if (!host) setHost(el);
      return true;
    },
    take: (d) => d.dy > 0 && (scroller.current?.scrollTop ?? 1) <= 0,
    move: (d) => {
      const el = scroller.current;
      if (!el) return;
      el.dataset.ptr = "pull";
      const shown = pullShown(d.dy);
      const on = shown >= PULL.arm;
      if (on !== armed.current) { armed.current = on; if (ring.current) ring.current.dataset.armed = on ? "1" : ""; if (on) haptic(HAPTIC.tick); }
      paint(shown);
    },
    end: (_d, cancelled) => {
      const go = armed.current && !cancelled;
      armed.current = false;
      if (ring.current) ring.current.dataset.armed = "";
      if (!go) { void settleTo(0); return; }
      busy.current = true;
      setSpinning(true);
      void settleTo(PULL.hold);
      const started = Date.now();
      // A refresh that answers in 40ms still shows the ring turn once, or the pull feels like it did
      // nothing; one that hangs is let go after 8s — the screens keep whatever they had.
      Promise.race([refreshLive(), new Promise((r) => setTimeout(r, 8000))])
        .then(() => new Promise((r) => setTimeout(r, Math.max(0, 650 - (Date.now() - started)))))
        .then(() => settleTo(0))
        .then(() => { busy.current = false; setSpinning(false); });
    },
  });

  if (!host) return null;
  return createPortal(
    <div ref={ring} className={`ptr${spinning ? " spin" : ""}`} aria-hidden>
      <svg viewBox="0 0 28 28"><circle cx="14" cy="14" r="10" pathLength={100} /></svg>
    </div>,
    host,
  );
}
