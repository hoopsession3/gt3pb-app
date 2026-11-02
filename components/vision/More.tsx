"use client";

import { useState, type ReactNode } from "react";

// SHOW THE REST, ON ASKING (IMS8 P12 — "Never silently omit figures, needs, or material qualifications"). A list too long
// for a slide shows its first few and says how many more there are, with a button that opens them all — the same on every
// screen size. Nothing is cut without being counted.
export default function More<T>({ items, first, render, word }: { items: readonly T[]; first: number; render: (x: T, i: number) => ReactNode; word: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, first);
  return (
    <>
      {shown.map(render)}
      {items.length > first && (
        <button type="button" className="btn-ter self-start" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show ${items.length - first} more ${word}`}
        </button>
      )}
    </>
  );
}
