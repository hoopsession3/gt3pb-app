"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/Icon";
import { STORY_IMAGE_MS, step, tapZone, type MediaItem } from "@/lib/shopMedia";

// STORY VIEWER (0278) — a product's photos and clips, full screen, the way people already know how
// to look at things on a phone: tap the right side to go on, the left third to go back, watch the
// bars at the top fill. Photos hold for STORY_IMAGE_MS; a video holds until it ends, however long
// that is, because a clip that gets yanked away mid-sentence is worse than no clip.
//
// It is a portal, not an in-tree overlay — the Shop sits on the paper surface and this is pure black,
// so rendering it inside .shop would inherit a paper palette onto a black screen (the exact bug the
// paper token scope was written to end). Outside the tree it just is what it is.
//
// Accessibility is not bolted on here: the overlay is a real dialog with a focus trap, every tap
// target has a keyboard equivalent (← → Esc), progress is announced, and prefers-reduced-motion
// turns off auto-advance entirely so nothing moves unless the person moves it.

type Props = { items: MediaItem[]; start?: number; title: string; onClose: () => void };

export default function StoryViewer({ items, start = 0, title, onClose }: Props) {
  const count = items.length;
  const [i, setI] = useState(() => Math.min(Math.max(0, start), Math.max(0, count - 1)));
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);      // 0..1 for the CURRENT item
  const [videoFailed, setVideoFailed] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);            // survives a pause so resuming doesn't restart

  const item = items[i];
  // Both of these are client-only facts. Reading them during render makes the first client render
  // disagree with the server's (which has no document and no matchMedia) and React throws out the
  // whole tree to re-render — caught in test as a hydration mismatch. So: render nothing until
  // mounted, then portal. The overlay is user-opened anyway; one frame costs nothing.
  const [mounted, setMounted] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setMounted(true);
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  const go = useCallback((dir: 1 | -1) => {
    const next = step(i, count, dir);
    if (next === null) { if (dir === 1) onClose(); return; }   // off the end = done watching
    setI(next);
  }, [i, count, onClose]);

  // Reset the clock whenever the item changes — including when the caller swaps the whole list.
  useEffect(() => { elapsedRef.current = 0; setProgress(0); setVideoFailed(false); }, [i, items]);

  // ── the clock ──────────────────────────────────────────────────────────────────────────────────
  // Images run on rAF (so the bar is smooth and pauses cleanly). Video reports its own time, since
  // its duration is the truth and a parallel timer would drift against it.
  useEffect(() => {
    if (!item || item.kind === "video") return;
    if (reduced) { setProgress(1); return; }        // no auto-advance; the bar just reads "here"
    if (paused) return;
    startedRef.current = performance.now() - elapsedRef.current;
    const tick = () => {
      const el = performance.now() - startedRef.current;
      elapsedRef.current = el;
      const p = Math.min(1, el / STORY_IMAGE_MS);
      setProgress(p);
      if (p >= 1) { go(1); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [item, paused, reduced, go]);

  // Video playback follows the same pause state as the bar.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !item || item.kind !== "video") return;
    if (paused) v.pause();
    else { const play = v.play(); if (play && typeof play.catch === "function") play.catch(() => { /* autoplay refused; the poster stays and the tap still works */ }); }
  }, [paused, item]);

  // ── keyboard + focus trap ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    el?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); return; }
      if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); setPaused((p) => !p); return; }
      if (e.key === "Tab" && el) {
        const f = el.querySelectorAll<HTMLElement>('button:not([disabled]),[href],video[controls]');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll under the overlay.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [go, onClose]);

  // ── touch: swipe down closes, a press-and-hold pauses (both are the gestures people expect) ─────
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    holdTimer.current = setTimeout(() => setPaused(true), 260);
  };
  const clearHold = () => { if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } };
  const onTouchEnd = (e: React.TouchEvent) => {
    clearHold();
    const wasPaused = paused;
    if (wasPaused) setPaused(false);
    const s = touch.current; touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (dy > 70 && Math.abs(dy) > Math.abs(dx)) { onClose(); return; }        // swipe down = close
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { go(dx < 0 ? 1 : -1); return; }
    if (wasPaused || Date.now() - s.t > 260) return;                          // a hold isn't a tap
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    go(tapZone(t.clientX - rect.left, rect.width) === "prev" ? -1 : 1);
  };

  if (!count || !item || !mounted) return null;

  const label = item.alt || `${title} — ${i + 1} of ${count}`;

  return createPortal(
    <div className="sv" ref={wrapRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${title} — photos and video`}>
      <div className="sv-bars" aria-hidden>
        {items.map((m, n) => (
          <span key={m.id} className="sv-bar">
            <i style={{ transform: `scaleX(${n < i ? 1 : n === i ? progress : 0})` }} />
          </span>
        ))}
      </div>

      <div className="sv-top">
        <span className="sv-title">{title}</span>
        <div className="sv-top-b">
          {item.kind === "video" && !videoFailed && (
            <button type="button" className="sv-ic" onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Unmute video" : "Mute video"}>{muted ? "🔇" : "🔊"}</button>
          )}
          <button type="button" className="sv-ic" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
      </div>

      {/* The stage takes the taps. Buttons above/below it sit on their own layer so they still work. */}
      <div className="sv-stage" onTouchStart={onTouchStart} onTouchMove={clearHold} onTouchEnd={onTouchEnd}
        onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)} onMouseLeave={() => setPaused(false)}>
        {item.kind === "video" && !videoFailed ? (
          <video
            ref={videoRef} className="sv-media" src={item.url} poster={item.poster || undefined}
            muted={muted} playsInline autoPlay preload="metadata"
            onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration > 0) setProgress(Math.min(1, v.currentTime / v.duration)); }}
            onEnded={() => go(1)}
            onError={() => setVideoFailed(true)}
            aria-label={label}
          />
        ) : videoFailed ? (
          <div className="sv-fallback">
            {item.poster
              ? <img className="sv-media" src={item.poster} alt={label} />
              : <p className="sv-fallback-t">This clip wouldn&rsquo;t play.</p>}
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img className="sv-media" src={item.url} alt={label} />
        )}

        {/* Real buttons, not just tap zones — a pointer user gets arrows, a screen reader gets names. */}
        <button type="button" className="sv-zone prev" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous">
          <span className="sv-arrow" aria-hidden>‹</span>
        </button>
        <button type="button" className="sv-zone next" onClick={() => go(1)} aria-label={i === count - 1 ? "Close" : "Next"}>
          <span className="sv-arrow" aria-hidden>›</span>
        </button>
        {paused && <span className="sv-paused" aria-hidden>Paused</span>}
      </div>

      <p className="sv-count" aria-live="polite">{i + 1} / {count}{item.alt ? ` · ${item.alt}` : ""}</p>
    </div>,
    document.body
  );
}
