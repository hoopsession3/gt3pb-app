"use client";

import { useEffect, useRef, useState } from "react";

// A STICKY BAR KNOWS WHEN IT HAS STUCK (2026-10-14, R6 of the customer audit). A bar that sticks over a page drawn on a
// gradient or a watermark is painted only while it is stuck: at rest it is part of the page, and a fill there showed as
// a box cut out of it (the crew calendar's month row, 2026-10-01; the dark shop's aisle row, R6). The calendar told
// "stuck" from a 1px sentinel above the bar leaving the scroller's top edge — true only for a bar that sticks AT that
// edge. On an iPhone it sticks under the status bar (top: env(safe-area-inset-top)) and, under a compact title bar,
// 44 points lower again, so the list ran under a bare bar for that far before it was painted. Here the bar's own place
// is read against its own sticky top, whatever that resolves to: stuck is "as high as it is allowed to go".
//
// Read again when anything can move it: a scroll of its scroller (found, not assumed — #body in the app, a sheet's own
// body in a sheet), the window turning, and the scroller's content changing size (a section above it loading, fonts
// arriving), which moves a bar without a scroll. One read a frame at most.
export function useStuck<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const first = ref.current;
    if (!first) return;
    let scroller: HTMLElement | null = first.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const source: HTMLElement | Window = scroller ?? window;
    let raf = 0;
    const check = () => {
      raf = 0;
      const el = ref.current;
      if (!el || !el.isConnected) { setStuck(false); return; }
      const top = parseFloat(getComputedStyle(el).top) || 0;
      const edge = scroller ? scroller.getBoundingClientRect().top + scroller.clientTop : 0;
      setStuck(el.getBoundingClientRect().top - edge <= top + 0.5);
    };
    const soon = () => { if (!raf) raf = requestAnimationFrame(check); };
    source.addEventListener("scroll", soon, { passive: true });
    window.addEventListener("resize", soon);
    const grew = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(soon);
    for (const c of Array.from((scroller ?? document.body).children)) grew?.observe(c);
    soon();
    return () => {
      source.removeEventListener("scroll", soon);
      window.removeEventListener("resize", soon);
      grew?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return [ref, stuck] as const;
}
