"use client";

import { useRef, type RefObject } from "react";
import { follow, held, settle, useGesture } from "./useGesture";
import { pageTurn, rubber, sheetCloses } from "@/lib/gesture";

// THE SHEET'S PULL — components/Sheet's motion, loaded with the first sheet that opens (2026-10-05, the
// gesture round). Every page carries the sheet; not every visit opens one, and the finger-following
// code (this, components/useGesture, lib/gesture) weighed 4.8 KB gzipped on every route when it rode
// in the shell. A sheet takes a third of a second to arrive; this arrives in that time, and the sheet
// is the same without it in the meantime — closed by its X, a tap outside or Escape.
//
// What it does is components/Sheet's header ("PULL IT DOWN FROM ANYWHERE"): the whole panel follows a
// finger down — from the content only once it is scrolled to its top — the dim lightens as it goes,
// and letting go past lib/gesture's line (or flicking) carries it off at the finger's speed. A sheet
// that is held or holds unsaved typing gives like a rubber band and, let go past the line, asks.
// Sideways, a sheet given `page` walks to the item before or after.

export type SheetMotionProps = {
  panel: RefObject<HTMLDivElement | null>;
  scrim: RefObject<HTMLDivElement | null>;
  body: RefObject<HTMLDivElement | null>;
  /** "Discard your changes?" is showing: nothing moves under it. */
  asking: boolean;
  dismissible: boolean;
  unsaved: () => boolean;
  /** Ask "Discard your changes?"; `go` is what Discard does. */
  ask: (go: () => void) => void;
  requestClose: () => void;
  /** The sheet already left (`ms` from now, by the pull): unmount without playing the exit again. */
  finish: (ms: number, played: boolean) => void;
  page?: { prev?: () => void; next?: () => void };
};

/** The scrim's dim, through --scrim (globals.css .sheet2-scrim::before) — the scrim's own opacity
 *  would fade the sheet, its child, with it. null hands it back to the stylesheet. */
export function dimScrim(el: HTMLElement | null, v: number | null, ms = 0): void {
  if (!el) return;
  el.style.setProperty("--scrim-ms", `${ms}ms`);
  if (v == null) el.style.removeProperty("--scrim"); else el.style.setProperty("--scrim", String(v));
}

export default function SheetMotion({ panel: panelRef, scrim: scrimRef, body, asking, dismissible, unsaved, ask, requestClose, finish, page }: SheetMotionProps) {
  const grab = useRef({ h: 0, fromBody: false, w: 0 });
  const springBack = () => {
    settle(panelRef.current, "translate3d(0,0,0)", 420, { clear: true });
    dimScrim(scrimRef.current, null, 320);
  };
  useGesture(panelRef, {
    axis: "y",
    begin: (target) => {
      const panel = panelRef.current;
      if (!panel || asking || held(target, panel, "y")) return false;
      grab.current.fromBody = !!body.current?.contains(target);
      return true;
    },
    // The content pulls the sheet only downward; a finger going up there is scrolling.
    take: (d) => !grab.current.fromBody || d.dy > 0,
    move: (d) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (!grab.current.h) {
        grab.current.h = panel.getBoundingClientRect().height || 1;
        // The keyboard goes as the sheet starts to move, as it does when an iPhone sheet is dragged.
        const f = document.activeElement as HTMLElement | null;
        if (f && f !== panel && panel.contains(f) && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName)) f.blur();
      }
      const h = grab.current.h;
      // A sheet that will not leave (or would ask first) gives like a rubber band, not like a door.
      const holds = !dismissible || unsaved();
      const y = d.dy > 0 ? (holds ? rubber(d.dy, h * 0.6) : d.dy) : rubber(d.dy, h);
      follow(panel, `translate3d(0,${y}px,0)`);
      dimScrim(scrimRef.current, 1 - Math.min(1, Math.max(0, y) / h) * 0.85);
    },
    end: (d, cancelled) => {
      const h = grab.current.h || panelRef.current?.getBoundingClientRect().height || 1;
      grab.current.h = 0;
      if (cancelled || !sheetCloses(d.dy, d.vy, h) || !dismissible) { springBack(); return; }
      if (unsaved()) { springBack(); ask(requestClose); return; }
      // Leave at the finger's speed: the faster the flick, the shorter the rest of the trip.
      const rest = Math.max(0, h - d.dy);
      const ms = Math.round(Math.min(280, Math.max(140, rest / Math.max(d.vy, 1.1))));
      settle(panelRef.current, `translate3d(0,${h + 40}px,0)`, ms, { ease: "cubic-bezier(.2,.75,.3,1)" });
      dimScrim(scrimRef.current, 0, ms);
      finish(ms, true);
    },
  });
  // ── the sideways walk (only a sheet given `page`) ──
  useGesture(panelRef, {
    axis: "x",
    bias: 1.15,
    enabled: !!page,
    begin: (target) => {
      const panel = panelRef.current;
      if (!panel || asking || held(target, panel, "x")) return false;
      grab.current.w = panel.getBoundingClientRect().width || 1;
      return true;
    },
    move: (d) => {
      const w = grab.current.w;
      const can = d.dx < 0 ? !!page?.next : !!page?.prev;
      const x = can ? d.dx : rubber(d.dx, w * 0.5);
      follow(panelRef.current, `translate3d(${x}px,0,0)`, 1 - Math.min(0.5, Math.abs(x) / w));
    },
    end: (d, cancelled) => {
      const w = grab.current.w || 1;
      const turn = cancelled ? 0 : pageTurn(d.dx, d.vx, w);
      const go = turn === 1 ? page?.next : turn === -1 ? page?.prev : undefined;
      const back = () => settle(panelRef.current, "translate3d(0,0,0)", 380, { opacity: 1, clear: true });
      if (!go) { back(); return; }
      const slide = () => {
        settle(panelRef.current, `translate3d(${-turn * w * 0.6}px,0,0)`, 150, { opacity: 0, ease: "ease-in" }).then(() => {
          go();
          // The same sheet showing the next item comes in from the side it was swiped toward; a new
          // sheet (the caller keys one per item) arrives on its own.
          const panel = panelRef.current;
          if (!panel) return;
          follow(panel, `translate3d(${turn * w * 0.3}px,0,0)`, 0);
          settle(panel, "translate3d(0,0,0)", 260, { opacity: 1, clear: true });
        });
      };
      if (unsaved()) { back(); ask(slide); return; }
      slide();
    },
  });
  return null;
}
