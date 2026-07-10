"use client";

import { useEffect, useRef, useState } from "react";

// A dollar figure that counts up on mount — the Stripe/Apple "the number lands" feel. Reduced-motion
// safe (snaps to the value). tabular-nums so it never jitters mid-count.
export default function CountUp({ cents, ms = 900, className }: { cents: number; ms?: number; className?: string }) {
  const [v, setV] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || cents <= 0) { setV(cents); return; }
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
  }, [cents, ms]);
  return <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>${(v / 100).toFixed(2)}</span>;
}

// Integer roll for gauges/counters — same easing + reduced-motion contract as CountUp.
export function NumberRoll({ value, ms = 700, suffix = "", className }: { value: number; ms?: number; suffix?: string; className?: string }) {
  const [v, setV] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || value <= 0) { setV(value); return; }
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
  }, [value, ms]);
  return <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>{v}{suffix}</span>;
}
