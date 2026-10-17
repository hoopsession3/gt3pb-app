"use client";

import { useSyncExternalStore } from "react";
import { readParam } from "./urlParam";

// WHAT THE PAGE SAYS, READ AS STORES (R17, 2026-10-17) — the address, the history, a value read off the page.
// lib/clientState's siblings, in a file of their own so the routes whose screens never ask don't carry them (or
// lib/urlParam with them): the shell reads lib/clientState, Reduce Motion is lib/reducedMotion's (the order total's roll
// reads it on every ordering page), and this rides only with the screens that import it.

const never = () => () => {};

function watchAddress(change: () => void): () => void {
  window.addEventListener("popstate", change);
  return () => window.removeEventListener("popstate", change);
}

/** ?name= of the page's address as the browser has it — null on the server and while hydrating. Read again on every
 *  render and on back/forward; a link's instruction a screen acts on once is lib/urlParam's (read, then dropped). */
export function useSearchParam(name: string): string | null {
  return useSyncExternalStore(watchAddress, () => readParam(name), () => null);
}

/** How far back this tab can go (window.history.length > 1) — false on the server and while hydrating. */
export function useCanGoBack(): boolean {
  return useSyncExternalStore(watchAddress, () => window.history.length > 1, () => false);
}

/** A value read off the page once this is the browser — a node, a number — and `server` on the server and while
 *  hydrating. `read` must answer the same value for the same page (it is read on every render). */
export function useClientValue<T>(read: () => T, server: T): T {
  return useSyncExternalStore(never, read, () => server);
}
