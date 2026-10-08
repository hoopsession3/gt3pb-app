"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";
import { axisOf, heldBy, velocity, SLOP, type Axis, type Box, type Sample } from "@/lib/gesture";

// THE TOUCH ENGINE (2026-10-05) — the one place a finger is followed. A sheet pulled down, a page
// swiped sideways, an inbox row swiped open, the edge swipe back and the pull to refresh all ride it,
// and each says only what it does with the finger; lib/gesture says what the finger meant.
//
// Why native listeners and not React's onTouch*: React attaches touch listeners passive, and a passive
// listener cannot stop the page scrolling under a sheet being pulled. And why a frame at a time: the
// last version of the sheet's pull set React state on every touchmove — a full re-render of the sheet
// and everything in it, sixty times a second, under the finger. Here the finger writes a transform.
//
// ONE OWNER PER TOUCH. Gestures nest — an inbox row inside a sheet, a tab page inside the console — and
// a touch reaches the innermost first (the edge back listens in the capture phase, so it goes first of
// all). Whoever takes the touch owns it to the end and every other gesture stands down; a gesture that
// declines leaves it for the one around it. That is how a row can be swiped sideways inside a sheet
// that is pulled down, and how Plan's last tab hands a swipe on to the section after it.

export type Pull = { dx: number; dy: number; x: number; y: number };
export type Release = Pull & { vx: number; vy: number };

export type GestureSpec = {
  axis: Axis;
  /** Sideways only: how many times wider than tall a move must be to count as sideways (lib/gesture). */
  bias?: number;
  /** At touchdown: may this touch become ours? `target` is what the finger landed on. */
  begin?: (target: Element, x: number, y: number) => boolean;
  /** Once the touch has shown it moves along our axis: take it? (A sheet's content only pulls down.) */
  take?: (d: Pull) => boolean;
  /** The finger moved — at most once a frame. */
  move: (d: Pull) => void;
  /** The finger let go, or the touch was taken away (`cancelled`: a second finger, the system). */
  end: (d: Release, cancelled: boolean) => void;
  /** Listen before everything inside (the capture phase): a gesture that must win where it starts. */
  capture?: boolean;
  enabled?: boolean;
};

let owner: symbol | null = null;
let quietUntil = 0;
let installed = false;

/** Window listeners, once: forget the owner when the last finger lifts (this runs after every element
 *  listener — the window is where a bubbling event ends) and again when a new touch begins (a touch
 *  whose element was removed mid-swipe never bubbles its end this far), and swallow the click a browser
 *  may still send straight after a touch that was a swipe, so letting go of a swiped row never also
 *  taps it. That click comes at once; a tap a beat later is the person's, and goes through. */
function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const done = (e: TouchEvent) => { if (e.touches.length === 0) owner = null; };
  window.addEventListener("touchstart", (e) => { if (e.touches.length === 1) owner = null; }, { passive: true, capture: true });
  window.addEventListener("touchend", done, { passive: true });
  window.addEventListener("touchcancel", done, { passive: true });
  window.addEventListener("click", (e) => {
    if (performance.now() < quietUntil) { e.stopPropagation(); e.preventDefault(); quietUntil = 0; }
  }, true);
}

/** Is a touch in progress already someone's? (The pull to refresh asks before it shows anything.) */
export const touchTaken = (): boolean => owner !== null;

/** A long press raised a row's menu (components/LongPress): the touch is the press's now, and every
 *  gesture stands down until the last finger lifts. */
export function claimTouch(): void {
  install();
  owner = Symbol("press");
}

/** That finger lifted: the click a browser may send for it lands on whatever rose under the finger (the
 *  menu), and it is nobody's — swallowed as a swipe's is. */
export function hushClick(): void {
  install();
  quietUntil = performance.now() + 150;
}

/** lib/gesture's walk with the browser's answers: the computed overflow, and what has focus. */
export function held(target: Element, root: Element, axis: Axis): ReturnType<typeof heldBy> {
  return heldBy(target as unknown as Box, root as unknown as Box, axis, (b) => {
    const s = getComputedStyle(b as unknown as Element);
    return { x: s.overflowX, y: s.overflowY };
  }, (typeof document !== "undefined" ? document.activeElement : null) as unknown as Box | null);
}

/** Follow a finger on `ref`'s element — or, for `"root"`, on the whole page (the edge swipe back). The
 *  spec's functions may read the component's latest props and state: they are called as Effect Events. */
export function useGesture(ref: RefObject<HTMLElement | null> | "root", spec: GestureSpec): void {
  const on = spec.enabled !== false;
  const capture = !!spec.capture;
  const axisNow = useEffectEvent((): [Axis, number] => [spec.axis, spec.bias ?? 1]);
  const begin = useEffectEvent((target: Element, x: number, y: number) => (spec.begin ? spec.begin(target, x, y) : true));
  const take = useEffectEvent((d: Pull) => (spec.take ? spec.take(d) : true));
  const move = useEffectEvent((d: Pull) => spec.move(d));
  const end = useEffectEvent((d: Release, cancelled: boolean) => spec.end(d, cancelled));
  useEffect(() => {
    const el = ref === "root" ? document.documentElement : ref.current;
    if (!el || !on) return;
    install();
    const me = Symbol("gesture");
    let live = false, mine = false, id = -1, x0 = 0, y0 = 0;
    let path: Sample[] = [];
    let frame = 0;
    let pending: Pull | null = null;

    const flush = () => { frame = 0; if (pending && mine) move(pending); pending = null; };
    const reset = () => {
      if (owner === me) owner = null;
      live = false; mine = false; path = []; pending = null;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
    };
    const finish = (at: number, x: number, y: number, cancelled: boolean) => {
      if (!mine) { reset(); return; }
      if (frame) { cancelAnimationFrame(frame); frame = 0; if (pending) move(pending); }
      const { vx, vy } = velocity(path, at);
      quietUntil = performance.now() + 150;
      live = false; mine = false; path = []; pending = null;   // `owner` stays until the last finger lifts
      end({ dx: x - x0, dy: y - y0, x, y, vx, vy }, cancelled);
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        if (mine) { const p = path[path.length - 1]; finish(e.timeStamp, p.x, p.y, true); } else reset();
        return;
      }
      reset();
      const t = e.touches[0];
      if (!begin(e.target as Element, t.clientX, t.clientY)) return;
      live = true; id = t.identifier; x0 = t.clientX; y0 = t.clientY;
      path = [{ t: e.timeStamp, x: x0, y: y0 }];
    };
    const onMove = (e: TouchEvent) => {
      if (!live) return;
      const t = [...e.touches].find((x) => x.identifier === id);
      if (!t || e.touches.length !== 1) {
        if (mine) { const p = path[path.length - 1]; finish(e.timeStamp, p.x, p.y, true); } else reset();
        return;
      }
      const d: Pull = { dx: t.clientX - x0, dy: t.clientY - y0, x: t.clientX, y: t.clientY };
      if (!mine) {
        if (owner && owner !== me) { reset(); return; }
        const [want, bias] = axisNow();
        const axis = axisOf(d.dx, d.dy, SLOP, bias);
        if (!axis) return;
        // Not our axis, too late to stop the browser scrolling, or declined: leave it for whoever is
        // around us (or the page's own scroll).
        if (axis !== want || !e.cancelable || !take(d)) { live = false; path = []; return; }
        owner = me; mine = true;
      }
      if (e.cancelable) e.preventDefault();
      path.push({ t: e.timeStamp, x: t.clientX, y: t.clientY });
      if (path.length > 16) path.shift();
      pending = d;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const onEnd = (e: TouchEvent) => {
      if (!live) return;
      const t = [...e.changedTouches].find((x) => x.identifier === id);
      if (!t) return;
      if (!mine) { reset(); return; }
      finish(e.timeStamp, t.clientX, t.clientY, e.type === "touchcancel");
    };
    const o = { capture };
    el.addEventListener("touchstart", onStart, { passive: true, capture });
    el.addEventListener("touchmove", onMove, { passive: false, capture });
    el.addEventListener("touchend", onEnd, { passive: true, capture });
    el.addEventListener("touchcancel", onEnd, { passive: true, capture });
    return () => {
      el.removeEventListener("touchstart", onStart, o);
      el.removeEventListener("touchmove", onMove, o);
      el.removeEventListener("touchend", onEnd, o);
      el.removeEventListener("touchcancel", onEnd, o);
      reset();
    };
  }, [ref, on, capture]);
}

// ── moving things, a frame at a time ───────────────────────────────────────────────────────────
/** iOS's own settle: the curve a sheet or a page springs back on (and Vaul's, for the same reason). */
export const SETTLE = "cubic-bezier(.32,.72,0,1)";

// Which write on an element is the latest: a settle that finishes after the finger has taken the
// element again must not wipe the transform the finger just put there.
const turn = new WeakMap<HTMLElement, number>();
const claimTurn = (el: HTMLElement) => { const n = (turn.get(el) ?? 0) + 1; turn.set(el, n); return n; };

/** Set an element's inline transform/opacity now, with no transition — under the finger. */
export function follow(el: HTMLElement | null, transform: string, opacity?: number): void {
  if (!el) return;
  claimTurn(el);
  el.style.transition = "none";
  el.style.transform = transform;
  if (opacity !== undefined) el.style.opacity = String(opacity);
}

/** Animate an element's inline transform/opacity to a value over `ms`, then — if `clear` — hand the
 *  element back to its stylesheet (no inline transform left behind to become a containing block for
 *  something fixed inside it). Resolves when done; a timer, not transitionend, so it always resolves. */
export function settle(el: HTMLElement | null, transform: string, ms: number, opts: { opacity?: number; ease?: string; clear?: boolean } = {}): Promise<void> {
  return new Promise((done) => {
    if (!el) { done(); return; }
    const mine = claimTurn(el);
    const ease = opts.ease ?? SETTLE;
    el.style.transition = `transform ${ms}ms ${ease}${opts.opacity !== undefined ? `, opacity ${ms}ms ${ease}` : ""}`;
    // A style write in the same frame as the one before it would be coalesced: read layout once so the
    // browser starts from where the finger left it.
    void el.offsetHeight;
    el.style.transform = transform;
    if (opts.opacity !== undefined) el.style.opacity = String(opts.opacity);
    setTimeout(() => {
      if (opts.clear && turn.get(el) === mine) {
        el.style.transition = ""; el.style.transform = "";
        if (opts.opacity !== undefined) el.style.opacity = "";
      }
      done();
    }, ms + 20);
  });
}
