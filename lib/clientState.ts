"use client";

import { useSyncExternalStore } from "react";

// THE BROWSER'S OWN ANSWERS, READ AS STORES (R17, 2026-10-17 — the lint ceiling's set-state-in-effect).
//
// Screens asked the browser something as they mounted — is this the browser yet, is it online, which tab did the link
// ask for, does the person want less motion — in an effect that then set state: a second render each
// time, and a first frame that said the server's answer before the phone's. Read as stores (useSyncExternalStore), the
// server and the hydrating render draw the server's answer and the phone's follows in the commit React makes for
// hydration anyway — with nothing to set and nothing to forget to unsubscribe. lib/devicePref is the same for a value
// the phone keeps.
//
// TWO FILES, FOR THE WEIGHT. These two are what the shell reads (AppProvider, the offline banner and chip, the console's
// section, the viewer's market), so they ride on every route; what only some screens ask — the address, the history,
// Reduce Motion, a value read off the page — is lib/clientPage's, and stays off the routes that don't.

const never = () => () => {};

/** False on the server and while hydrating; true once this is the browser — for a portal, or a read of the page. */
export function useHydrated(): boolean {
  return useSyncExternalStore(never, () => true, () => false);
}

function watchOnline(change: () => void): () => void {
  window.addEventListener("online", change);
  window.addEventListener("offline", change);
  return () => { window.removeEventListener("online", change); window.removeEventListener("offline", change); };
}

/** What the browser says about the network (navigator.onLine), kept current by its online/offline events. True on the
 *  server and while hydrating — the page is drawn as online until the phone says otherwise. */
export function useOnline(): boolean {
  return useSyncExternalStore(watchOnline, () => (typeof navigator === "undefined" ? true : navigator.onLine !== false), () => true);
}
