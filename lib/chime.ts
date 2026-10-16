// Two-tone "new order" chime via Web Audio — no asset, no network. A browser starts a page's sound only from a touch, so
// the Pass asks with every touch on it (components/pass/ThePass), and says "Tap for sound" while it can't play.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useSyncExternalStore } from "react";

let ctx: AudioContext | null = null;

// WHETHER IT CAN PLAY (R11, 2026-10-16 — the 10/10 audit). Nothing said so: a web Pass opened by a tap never asked for its
// sound (only the Sound chip did), and an iPhone call, Siri or the background left the context "interrupted" — which
// only "suspended" was checked for, so it was never asked again. Every state that is not "running" is asked again now,
// and the context's own changes are told to the screen (useSoundLocked).
const heard = new Set<() => void>();
const tell = () => heard.forEach((f) => f());

function context(): AudioContext | null {
  const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    ctx.onstatechange = tell;
    tell();
  }
  return ctx;
}

function wake(c: AudioContext) {
  if (c.state !== "running") void c.resume().then(tell, () => {});
}

export function unlockAudio() {
  try { const c = context(); if (c) wake(c); } catch { /* */ }
}

/** The Pass's sound is made and can't play yet — it waits for a touch. */
export function soundLocked(): boolean {
  return !!ctx && ctx.state !== "running";
}

const listen = (f: () => void) => { heard.add(f); return () => { heard.delete(f); }; };
const notLocked = () => false;
/** Re-renders when the sound starts or stops being able to play. */
export function useSoundLocked(): boolean {
  return useSyncExternalStore(listen, soundLocked, notLocked);
}

export function chime() {
  try {
    const c = context();
    if (!c) return;
    wake(c);
    const now = c.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(g);
      g.connect(c.destination);
      const t = now + i * 0.14;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.start(t);
      o.stop(t + 0.18);
    });
  } catch { /* */ }
}
