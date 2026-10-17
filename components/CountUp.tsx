"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/money";
import { useReducedMotion } from "@/lib/reducedMotion";

// A dollar figure that counts up on mount — the Stripe/Apple "the number lands" feel. Reduced-motion
// safe (snaps to the value). tabular-nums so it never jitters mid-count.
export default function CountUp({ cents, ms = 900, className }: { cents: number; ms?: number; className?: string }) {
  const [v, setV] = useState(0);
  const raf = useRef(0);
  // Reduce Motion (a store, lib/reducedMotion) or nothing to count: the value itself, said in the render — the effect only
  // runs the roll (R17: it set the snapped value as it started, a second render).
  const reduce = useReducedMotion();
  const snap = reduce || cents <= 0;
  useEffect(() => {
    if (snap) return;
    let start: number | null = null;
    const tick = (t: number) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic — fast then settles
      setV(Math.round(cents * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [cents, ms, snap]);
  return <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>{money(snap ? cents : v)}</span>;
}

// Integer roll for gauges/counters — same easing + reduced-motion contract as CountUp.
export function NumberRoll({ value, ms = 700, suffix = "", className }: { value: number; ms?: number; suffix?: string; className?: string }) {
  const [v, setV] = useState(0);
  const raf = useRef(0);
  const reduce = useReducedMotion();   // as CountUp's, above (R17)
  const snap = reduce || value <= 0;
  useEffect(() => {
    if (snap) return;
    let start: number | null = null;
    const from = 0;
    const tick = (t: number) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(from + (value - from) * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, ms, snap]);
  return <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>{snap ? value : v}{suffix}</span>;
}
