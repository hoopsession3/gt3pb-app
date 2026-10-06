"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Icon, { type IconName } from "./Icon";
import { follow, held, settle, useGesture } from "./useGesture";
import { rowArmed, rowSettle, rubber } from "@/lib/gesture";
import { haptic } from "@/lib/haptics";

// A ROW YOU CAN SWIPE (2026-10-05, the gesture round) — Mail's swipe, for a list whose rows have
// actions. Swipe a row left and its trailing actions slide out from under it (an inbox flag: Snooze,
// Got it); swipe it right for the leading one (Open). Let go past half the buttons and the row stays
// open on them; swipe on past the line (lib/gesture ROW.full) and the side's main action stretches
// across the row, the phone ticks, and letting go does it — a row that leaves (`removes`) flies off and
// the list closes over the gap. One row is open at a time; touching anything else closes it, and a tap
// on an open row closes it instead of opening what it names.
//
// The actions are the row's own buttons, called the same way — the swipe is a faster way to the same
// thing, never the only one: the visible buttons stay, so a keyboard or a screen reader loses nothing,
// and the swipe's copies are hidden from both.

export type RowAction = {
  key: string;
  label: string;
  icon?: IconName;
  tone: "ok" | "warn" | "info" | "danger";
  run: () => void;
  /** The row is gone once this is done (cleared, snoozed): it flies off and the list closes up. */
  removes?: boolean;
};

const BTN = 74; // each action's width when a row rests open on them

// The one row open right now, so opening another closes it.
let openRow: { id: symbol; close: () => void } | null = null;
function claimOpen(id: symbol, close: () => void) {
  if (openRow && openRow.id !== id) openRow.close();
  openRow = { id, close };
}
function closeOthers(id: symbol) { if (openRow && openRow.id !== id) { const o = openRow; openRow = null; o.close(); } }
function release(id: symbol) { if (openRow?.id === id) openRow = null; }

export default function SwipeRow({ lead = [], trail = [], children, className = "" }: {
  /** Shown by a swipe right; the first — the outermost — is the main one (a long swipe does it). */
  lead?: RowAction[];
  /** Shown by a swipe left; the last — the outermost — is the main one. */
  trail?: RowAction[];
  children: ReactNode;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<0 | 1 | -1>(0);   // whose buttons are under the face: 1 lead, -1 trail
  const sideRef = useRef<0 | 1 | -1>(0);
  const [open, setOpen] = useState(false);
  const rest = useRef(0);                               // where the face rests: 0, +lead, -trail
  const armed = useRef(false);
  const w = useRef(1);
  const [me] = useState(() => Symbol("row"));

  const showSide = useCallback((s: 0 | 1 | -1) => { if (sideRef.current !== s) { sideRef.current = s; setSide(s); } }, []);
  const paint = (x: number) => {
    const el = box.current;
    if (!el) return;
    if (x) showSide(x > 0 ? 1 : -1);
    el.style.setProperty("--pull", `${Math.abs(x)}px`);
    const has = x > 0 ? lead.length > 0 : trail.length > 0;
    const on = has && rowArmed(x, w.current, true);
    // Over the line, a tick; back off it while still swiping, the lighter release. A swipe that ends
    // or is reset says nothing here — close() and the let-go clear `armed` themselves.
    if (on !== armed.current) { armed.current = on; el.dataset.armed = on ? "1" : ""; if (on) haptic("threshold"); else haptic("release"); }
  };
  const close = useCallback(() => {
    rest.current = 0;
    armed.current = false;
    const el = box.current;
    if (el) { el.dataset.armed = ""; el.style.setProperty("--pull", "0px"); }
    setOpen(false);
    release(me);
    settle(face.current, "translate3d(0,0,0)", 300, { clear: true }).then(() => { if (rest.current === 0) showSide(0); });
  }, [me, showSide]);
  const openTo = (x: number) => {
    rest.current = x;
    // Resting open is not armed: cleared here without a word, so the next swipe cannot start on a
    // stale line and "release" what it never crossed.
    armed.current = false;
    if (box.current) box.current.dataset.armed = "";
    box.current?.style.setProperty("--pull", `${Math.abs(x)}px`);
    setOpen(true);
    claimOpen(me, close);
    settle(face.current, `translate3d(${x}px,0,0)`, 300);
  };
  const perform = (a: RowAction, dir: 1 | -1) => {
    const el = box.current;
    if (!a.removes || !el) { close(); a.run(); return; }
    // Off it goes the way it was swiped, the list closes over the gap — then the action, so the row
    // is not torn out of the list mid-flight.
    rest.current = 0;
    release(me);
    el.style.setProperty("--pull", `${w.current}px`);
    settle(face.current, `translate3d(${dir * w.current}px,0,0)`, 180, { ease: "ease-in" }).then(() => {
      const h = el.getBoundingClientRect().height;
      const mb = getComputedStyle(el).marginBottom;
      const anim = el.animate?.([{ height: `${h}px`, marginBottom: mb, opacity: 1 }, { height: "0px", marginBottom: "0px", opacity: 0 }], { duration: 200, easing: "ease-out", fill: "forwards" });
      const done = () => {
        a.run();
        // Still here a moment later — the action did not take the row away (it failed, and said so):
        // put the row back as it was.
        setTimeout(() => {
          if (!el.isConnected) return;
          anim?.cancel();
          el.dataset.armed = "";
          armed.current = false;
          el.style.setProperty("--pull", "0px");
          settle(face.current, "translate3d(0,0,0)", 1, { clear: true });
          showSide(0);
          setOpen(false);
        }, 700);
      };
      if (anim) anim.onfinish = done; else done();
    });
  };

  useGesture(box, {
    axis: "x",
    bias: 1.15,
    begin: (target) => {
      const el = box.current;
      if (!el || (!lead.length && !trail.length) || held(target, el, "x")) return false;
      // The buttons under an open row are tapped, not dragged.
      if ((target as Element).closest?.(".swipe-acts")) return false;
      w.current = el.getBoundingClientRect().width || 1;
      return true;
    },
    move: (d) => {
      let x = rest.current + d.dx;
      // No buttons that way: a rubber band.
      if (x > 0 && !lead.length) x = rubber(x, w.current * 0.25);
      if (x < 0 && !trail.length) x = rubber(x, w.current * 0.25);
      closeOthers(me);
      follow(face.current, `translate3d(${x}px,0,0)`);
      paint(x);
    },
    end: (d, cancelled) => {
      const x = rest.current + d.dx;
      const L = lead, T = trail;
      const r = cancelled ? "close" : rowSettle(x, d.vx, w.current, L.length * BTN, T.length * BTN, L.length > 0, T.length > 0);
      if (r === "lead-full") perform(L[0], 1);
      else if (r === "trail-full") perform(T[T.length - 1], -1);
      else if (r === "lead") openTo(L.length * BTN);
      else if (r === "trail") openTo(-T.length * BTN);
      else close();
    },
  });

  // Touching anything else closes an open row, the way a table closes its swiped cell.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) close(); };
    document.addEventListener("touchstart", away, { capture: true, passive: true });
    document.addEventListener("mousedown", away, true);
    return () => { document.removeEventListener("touchstart", away, true); document.removeEventListener("mousedown", away, true); };
  }, [open, close]);
  useEffect(() => () => release(me), [me]);

  const shown = side === 1 ? lead : side === -1 ? trail : [];
  return (
    <div ref={box} className={`swipe-row${className ? ` ${className}` : ""}`}>
      {shown.length > 0 && (
        <div className={`swipe-acts ${side === 1 ? "lead" : "trail"}`} aria-hidden>
          {shown.map((a, i) => (
            <button key={a.key} type="button" tabIndex={-1} className={`swipe-act ${a.tone}${(side === 1 ? i === 0 : i === shown.length - 1) ? " main" : ""}`}
              onClick={() => perform(a, side === 1 ? 1 : -1)}>
              {a.icon && <Icon name={a.icon} />}<span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
      <div ref={face} className="swipe-face" onClickCapture={(e) => { if (open) { e.preventDefault(); e.stopPropagation(); close(); } }}>
        {children}
      </div>
    </div>
  );
}
