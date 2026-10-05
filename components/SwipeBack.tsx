"use client";

import { useRef, useState } from "react";
import { useOperatorSection } from "./OperatorNav";
import { useGesture } from "./useGesture";
import { sheetOpen } from "./Sheet";
import { BACK, backGoes } from "@/lib/gesture";
import { haptic, HAPTIC } from "@/lib/haptics";

// SWIPE-BACK — a left-edge drag that walks the crew section history (the same back() the console
// button uses). Installed PWAs have no browser chrome, so the OS edge-swipe doesn't exist; this
// restores the expected "swipe from the left to go back" on the crew console. Only fires when there's
// section history to step through — it never accidentally drops you out of crew mode.
//
// On the touch engine (2026-10-05, the gesture round): it listens first (the capture phase), so a swipe
// from the edge is the way back even over a row or a tab page that swipes sideways itself; a flick
// goes back as well as a long drag (lib/gesture BACK); the phone ticks when letting go would go back;
// and it stands down while a sheet is open — it used to walk the screen BEHIND an open sheet, which
// then sat over a section it no longer belonged to. The chevron moves by direct style writes, not by
// re-rendering on every frame.
export default function SwipeBack() {
  const { back, canGoBack } = useOperatorSection();
  const [shown, setShown] = useState(false);
  const pill = useRef<HTMLDivElement>(null);
  const armed = useRef(false);

  useGesture("root", {
    axis: "x",
    capture: true,
    begin: (_target, x) => x <= BACK.edge && canGoBack && !sheetOpen(),
    take: (d) => d.dx > 0,
    move: (d) => {
      const dx = Math.min(Math.max(d.dx, 0), BACK.max);
      const on = dx >= BACK.go;
      const el = pill.current;
      if (on !== armed.current) {
        armed.current = on;
        if (el) el.dataset.armed = on ? "1" : "";
        if (on) haptic(HAPTIC.tick);
      }
      if (!shown) setShown(true);
      if (el) { el.style.transform = `translateX(${dx - BACK.max}px)`; el.style.opacity = String(Math.min(1, dx / BACK.go)); }
    },
    end: (d, cancelled) => {
      armed.current = false;
      if (pill.current) pill.current.dataset.armed = "";
      setShown(false);
      if (!cancelled && backGoes(d.dx, d.vx)) back();
    },
  });

  return (
    <div ref={pill} className={`swipeback${shown ? " on" : ""}`} style={{ transform: `translateX(${-BACK.max}px)`, opacity: 0 }} aria-hidden>
      <span className="swipeback-chev">‹</span>
    </div>
  );
}
