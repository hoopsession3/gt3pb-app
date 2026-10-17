"use client";

import { useInsertionEffect, useRef, type MutableRefObject } from "react";

// THE LATEST VALUE, FOR A HANDLER OR AN EFFECT TO READ (R16, 2026-10-17 — the lint ceiling's refs rule).
//
// Six places kept "the latest callback" (or value) in a ref by writing `ref.current = value` while rendering, so an
// effect or a listener set up once could read today's version without re-subscribing. React's rule: a ref is not read
// or written during render — a render React throws away (StrictMode's second pass, a transition left unfinished) would
// still have moved it. Written as the render commits instead, before any layout effect or handler can run: the same
// latest value, and only from a render that happened.
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useInsertionEffect(() => { ref.current = value; });
  return ref;
}
