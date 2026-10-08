"use client";

import { useRef, useState } from "react";
import { useGesture } from "./useGesture";
import { sheetOpen } from "./Sheet";
import { useBack } from "./useBack";
import { BACK, backGoes } from "@/lib/gesture";
import { haptic } from "@/lib/haptics";

// SWIPE-BACK — a left-edge drag that goes back. Installed PWAs have no browser chrome, so the OS edge-swipe
// doesn't exist; this restores the expected "swipe from the left to go back". Only fires when there's
// somewhere to go — it never accidentally drops you out of crew mode.
//
// On the touch engine (2026-10-05, the gesture round): it listens first (the capture phase), so a swipe
// from the edge is the way back even over a row or a tab page that swipes sideways itself; a flick
// goes back as well as a long drag (lib/gesture BACK); the phone ticks when letting go would go back;
// and it stands down while a sheet is open — it used to walk the screen BEHIND an open sheet, which
// then sat over a section it no longer belonged to. The chevron moves by direct style writes, not by
// re-rendering on every frame.
//
// ON EVERY SCREEN (2026-10-08, the navigation round: redesign 2, approved). It walked the crew console's
// sections only; now it goes where the title bar's ‹ goes, on any screen (components/useBack, one answer
// for both, so they never disagree): out of a view a screen opened inside itself, to the screen before,
// to the crew's last section. Outside the console it is drawn only where nothing else answers that
// swipe — the iPhone app and a PWA on the home screen (AppShell decides); a browser tab has its own.
export default function SwipeBack() {
  const way = useBack();
  const [shown, setShown] = useState(false);
  const pill = useRef<HTMLDivElement>(null);
  const armed = useRef(false);

  useGesture("root", {
    axis: "x",
    capture: true,
    begin: (_target, x) => x <= BACK.edge && !!way && !sheetOpen(),
    take: (d) => d.dx > 0,
    move: (d) => {
      const dx = Math.min(Math.max(d.dx, 0), BACK.max);
      const on = dx >= BACK.go;
      const el = pill.current;
      if (on !== armed.current) {
        armed.current = on;
        if (el) el.dataset.armed = on ? "1" : "";
        // Far enough to go back, a tick; drawn back short of it mid-swipe, the lighter release. The
        // let-go (end) clears `armed` itself and says nothing.
        if (on) haptic("threshold"); else haptic("release");
      }
      if (!shown) setShown(true);
      if (el) { el.style.transform = `translateX(${dx - BACK.max}px)`; el.style.opacity = String(Math.min(1, dx / BACK.go)); }
    },
    end: (d, cancelled) => {
      armed.current = false;
      if (pill.current) pill.current.dataset.armed = "";
      setShown(false);
      if (!cancelled && backGoes(d.dx, d.vx)) way?.go();
    },
  });

  return (
    <div ref={pill} className={`swipeback${shown ? " on" : ""}`} style={{ transform: `translateX(${-BACK.max}px)`, opacity: 0 }} aria-hidden>
      <span className="swipeback-chev">‹</span>
    </div>
  );
}
