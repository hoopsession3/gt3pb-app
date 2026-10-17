"use client";

import { useCallback } from "react";
import { FOUNDING_MARKET, MARKET_CHOICE_KEY, pickViewerMarket, type Market } from "@/lib/markets";
import { devicePref, useDevicePref } from "@/lib/devicePref";
import { useHydrated } from "@/lib/clientState";

const MARKET_PREF = devicePref(MARKET_CHOICE_KEY);

// WHICH CITY IS THIS PERSON LOOKING AT? — one hook, one answer, for every customer surface that
// shows the road. The decision logic is pure and lives in lib/markets.ts (pickViewerMarket); this
// only owns the two things a hook has to: reading the stored choice without breaking SSR, and
// writing it back when someone picks.
//
// `available` comes from rows the caller already loaded, so the answer narrows as the screen learns
// what is actually on the road — and while one city runs alone it is always the founding market.
//
// SSR note: the first render must not read localStorage, or the server's HTML and the client's
// disagree and React throws the tree away (the same hydration trap the story viewer hit). So the
// first render is always the pure default and the stored choice lands on mount.

export function useViewerMarket(available: readonly Market[] = []) {
  // Kept on the phone and read as a store (lib/devicePref, R17): nothing on the server and while hydrating — the default
  // market — and the phone's own choice right after, in every reader at once.
  const stored = useDevicePref(MARKET_PREF);
  const ready = useHydrated();

  const market = pickViewerMarket(ready ? stored : null, available);

  const choose = useCallback((m: Market) => {
    MARKET_PREF.write(m);   // the choice still holds for this session when storage is refused (lib/devicePref)
  }, []);

  return { market, choose, ready };
}

export { FOUNDING_MARKET };
export type { Market };
