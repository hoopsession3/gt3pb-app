"use client";

import { useSyncExternalStore } from "react";

// REDUCE MOTION, READ AS A STORE (R17, 2026-10-17). A file of its own: the order total's roll (components/CountUp
// NumberRoll) asks it on every ordering page, and should not bring the address and history reads (lib/clientPage, and
// lib/urlParam with them) along. lib/motion is its plain-function sibling, for a scroll a script asks for.

const REDUCE = "(prefers-reduced-motion: reduce)";
function watchMotion(change: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(REDUCE);
  mq.addEventListener?.("change", change);
  return () => mq.removeEventListener?.("change", change);
}

/** The person asked their device for less motion — kept current. False on the server and while hydrating. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(watchMotion, () => typeof window.matchMedia === "function" && window.matchMedia(REDUCE).matches, () => false);
}
