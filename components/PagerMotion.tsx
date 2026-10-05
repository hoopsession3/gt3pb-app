"use client";

import { useRef, type RefObject } from "react";
import { follow, held, settle, useGesture } from "./useGesture";
import { pageStep, pageTurn, rubber } from "@/lib/gesture";
import type { PagerLevel } from "./SwipePager";

// THE PAGER'S SWIPE — components/SwipePager's motion, loaded right after the screen is up (2026-10-05,
// the gesture round). The pager is in the first paint (the tab rows it holds, the box the content sits
// in); the finger-following code (this, components/useGesture, lib/gesture) arrives a moment later,
// off the path that draws the page: on the shop it was 3 KB gzipped of a guest's first load, for a
// swipe nobody makes in the first half-second. components/SheetMotion does the same for the sheet,
// and the two share the engine's one chunk.
//
// What it does is components/SwipePager's header ("SWIPE BETWEEN TABS").

export type PagerMotionProps = {
  /** The content that moves. */
  box: RefObject<HTMLDivElement | null>;
  /** Where the finger is followed: the screen's scroll container. */
  surface: RefObject<HTMLElement | null>;
  /** The tab rows showing now, outermost first (the screen's own, then the ones offered inside it). */
  levels: () => PagerLevel[];
};

export default function PagerMotion({ box, surface, levels }: PagerMotionProps) {
  const width = useRef(1);
  useGesture(surface, {
    axis: "x",
    bias: 1.15,
    begin: (target) => {
      const el = box.current, root = surface.current;
      if (!el || !root || !levels().length || held(target, root, "x")) return false;
      width.current = el.getBoundingClientRect().width || 1;
      return true;
    },
    move: (d) => {
      const w = width.current;
      const can = !!pageStep(levels(), d.dx < 0 ? 1 : -1);
      const x = can ? d.dx : rubber(d.dx, w * 0.4);
      follow(box.current, `translate3d(${x}px,0,0)`, 1 - Math.min(0.4, (Math.abs(x) / w) * 0.7));
    },
    end: (d, cancelled) => {
      const w = width.current;
      const turn = cancelled ? 0 : pageTurn(d.dx, d.vx, w);
      const ls = levels();
      const step = turn ? pageStep(ls, turn) : null;
      if (!step) { settle(box.current, "translate3d(0,0,0)", 380, { opacity: 1, clear: true }); return; }
      // Out the way the finger was going; the new tab in from the other side.
      settle(box.current, `translate3d(${-turn * w * 0.32}px,0,0)`, 110, { opacity: 0, ease: "ease-in" }).then(() => {
        ls[step.level].go(step.to);
        requestAnimationFrame(() => {
          const el = box.current;
          if (!el) return;
          el.dataset.entering = "1";
          follow(el, `translate3d(${turn * w * 0.24}px,0,0)`, 0);
          settle(el, "translate3d(0,0,0)", 260, { opacity: 1, ease: "cubic-bezier(.16,1,.3,1)", clear: true }).then(() => { el.dataset.entering = ""; });
        });
      });
    },
  });
  return null;
}
