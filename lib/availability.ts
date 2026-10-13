"use client";

import { useCallback, useState } from "react";
import { supabase } from "./supabase";
import { useRealtimeTable } from "./realtime";

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
type Availability = { soldOut: Set<string>; inactive: Set<string>; activeTotal: number; names: ReadonlyMap<string, string> };
export function useAvailability(): Availability {
  const [state, setState] = useState<Availability>({ soldOut: new Set(), inactive: new Set(), activeTotal: 0, names: new Map() });
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("products").select("slug, sold_out, active, name");
    if (!data) return;
    const rows = data as { slug: string; sold_out: boolean | null; active: boolean | null; name: string | null }[];
    const inactive = new Set(rows.filter((p) => p.active === false).map((p) => p.slug));
    setState({
      soldOut: new Set(rows.filter((p) => p.sold_out).map((p) => p.slug)),
      inactive,
      activeTotal: rows.length - inactive.size,
      names: new Map(rows.filter((p) => (p.name ?? "").trim()).map((p) => [p.slug, (p.name as string).trim()])),
    });
  }, []);
  useRealtimeTable("products", load, { loadOnMount: true });
  return state;
}
