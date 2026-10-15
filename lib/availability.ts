"use client";

import { useCallback, useState } from "react";
import { supabase } from "./supabase";
import { useRealtimeTable } from "./realtime";
import { FOUNDING_MARKET, type Market } from "./markets";

// Live availability for the à-la-carte menu. Two axes, from public.products:
//   sold_out  — 86'd for the day: stays ON the menu, shows SOLD OUT, can't be ordered.
//   inactive  — off the menu entirely (guests can't even read inactive rows per RLS).
// activeTotal — count of products actually on the menu today (total minus inactive), i.e. the
//   denominator for "how much of today's real menu is 86'd." Added for FindUs.tsx's road-schedule
//   tagline (a stop's static tier tagline like "Full bar on board" needs to know when the menu is
//   near-empty, not just which individual items are out) — kept here rather than a second query
//   since this hook already loads every row this needs.
// Realtime, so an 86 flipped mid-rush lands on every open menu without a refresh. The server
// re-checks at charge time regardless — this hook is honesty for the screen, not the enforcement.
//
// Several components use this hook at once (menu, drink sheet, checkout, AppProvider);
// useRealtimeTable gives each instance its own uniquely-named channel, so they stay independent.
// `names` (2026-10-13, R2 — the Catalog is the menu): each product's name as the Catalog says it, live — so a drink added
// mid-shift prints by its name on the Pass the moment its row exists, and the crew (who read every row) see a drink taken
// off the menu by its name in the history. AppProvider's nameOf reads it after the menu's own rows.
//
// AN 86 IS FOR ONE CITY (2026-10-15, 0408 — Ryan: "Pass: its city. Catalog: all"). Sold out is two things now: a product
// sold out everywhere (products.sold_out, the Catalog's switch) and one sold out in a city (product_86, the Pass's 86
// board). `market` is whose menu this is — the viewer's (useViewerMarket), the truck's, the crew member's — and, given
// none, the founding city, as every market-aware reader here defaults (lib/markets). Before 0408 is pasted there is no
// product_86 to read, and sold out is products.sold_out alone, as before.
type Availability = { soldOut: Set<string>; inactive: Set<string>; activeTotal: number; names: ReadonlyMap<string, string> };
export function useAvailability(market: Market = FOUNDING_MARKET): Availability {
  const [state, setState] = useState<Availability>({ soldOut: new Set(), inactive: new Set(), activeTotal: 0, names: new Map() });
  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data }, city] = await Promise.all([
      supabase.from("products").select("id, slug, sold_out, active, name"),
      // arrives-with: 0408
      supabase.from("product_86").select("product_id").eq("market", market),
    ]);
    if (!data) return;
    // A city's 86s that could not be read are not "none": keep what this menu last knew rather than say an item is back.
    // Before 0408 is pasted the table is not there, and the products alone say what is sold out. lib/schemaSkew is loaded
    // only to tell the two apart: every route carries this hook (AppProvider), and the predicates stay off its first load.
    if (city.error && !(await import("@/lib/schemaSkew")).isMissingTable(city.error)) return;
    const cityOut = new Set(((city.data as { product_id: string }[] | null) ?? []).map((r) => r.product_id));
    const rows = data as { id: string; slug: string; sold_out: boolean | null; active: boolean | null; name: string | null }[];
    const inactive = new Set(rows.filter((p) => p.active === false).map((p) => p.slug));
    setState({
      soldOut: new Set(rows.filter((p) => p.sold_out || cityOut.has(p.id)).map((p) => p.slug)),
      inactive,
      activeTotal: rows.length - inactive.size,
      names: new Map(rows.filter((p) => (p.name ?? "").trim()).map((p) => [p.slug, (p.name as string).trim()])),
    });
  }, [market]);
  useRealtimeTable(["products", "product_86"], load, { loadOnMount: true });
  return state;
}
