"use client";

import { useEffect, useRef, useState } from "react";
import { useOperatorSection } from "./OperatorNav";

// SWIPE-BACK — a left-edge drag that walks the crew section history (the same back() the console
// button uses). Installed PWAs have no browser chrome, so the OS edge-swipe doesn't exist; this
// restores the expected "swipe from the left to go back" on the crew console. Only fires when there's
// section history to step through — it never accidentally drops you out of crew mode.
const EDGE = 28; // px from the left where a drag counts as an edge-swipe
const TRIGGER = 72; // px of horizontal travel to commit the back
const MAX = 120; // px the affordance travels before it's pinned

export default function SwipeBack() {
  const { back, canGoBack } = useOperatorSection();
  const [dx, setDx] = useState(0); // live drag distance (0 = hidden)
  const active = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const canGoBackRef = useRef(canGoBack);
  canGoBackRef.current = canGoBack;

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE || !canGoBackRef.current) return;
      active.current = true; startX.current = t.clientX; startY.current = t.clientY; setDx(0);
    };
    const onMove = (e: TouchEvent) => {
      if (!active.current) return;
      const t = e.touches[0];
      const dX = t.clientX - startX.current;
      const dY = t.clientY - startY.current;
      // Abandon if the drag is clearly a vertical scroll, or heading the wrong way.
      if (dX < 0 || Math.abs(dY) > Math.abs(dX) + 12) { active.current = false; setDx(0); return; }
      if (e.cancelable) e.preventDefault(); // claim the gesture from horizontal scroll
      setDx(Math.min(dX, MAX));
    };
    const onEnd = () => {
      if (!active.current) return;
      active.current = false;
      setDx((d) => { if (d >= TRIGGER) back(); return 0; });
    };
    // passive:false on move so we can preventDefault once we've claimed a horizontal edge-drag.
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [back]);

  if (dx <= 0) return null;
  const armed = dx >= TRIGGER;
  return (
    <div className={`swipeback${armed ? " armed" : ""}`} style={{ transform: `translateX(${dx - MAX}px)`, opacity: Math.min(1, dx / TRIGGER) }} aria-hidden>
      <span className="swipeback-chev">‹</span>
    </div>
  );
}
