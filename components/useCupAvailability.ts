"use client";

import { useAvailability } from "@/lib/availability";
import { CUP_MARKETS } from "@/lib/markets";
import { useViewerMarket } from "./useViewerMarket";

// THE GUEST'S MENU IS THEIR CITY'S (2026-10-15, 0408 — an 86 is for one city). What is sold out on a guest's menu, drink
// sheet and home is what is sold out where they buy: everywhere (the Catalog's 86) or in their city (the Pass's) — the
// city the checkout is asked about (components/Checkout, useViewerMarket over the cities with a truck).
export function useCupAvailability() {
  const { market } = useViewerMarket(CUP_MARKETS);
  return useAvailability(market);
}
