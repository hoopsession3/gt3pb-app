"use client";

import { useCallback, useState } from "react";
import { supabase } from "./supabase";
import { useRealtimeTable } from "./realtime";

// Live availability for the à-la-carte menu. Two axes, from public.products:
//   sold_out  — 86'd for the day: stays ON the menu, shows SOLD OUT, can't be ordered.
//   inactive  — off the menu entirely (guests can't even read inactive rows per RLS).
// Realtime, so an 86 flipped mid-rush lands on every open menu without a refresh. The server
// re-checks at charge time regardless — this hook is honesty for the screen, not the enforcement.
//
// Several components use this hook at once (menu, drink sheet, checkout, AppProvider);
// useRealtimeTable gives each instance its own uniquely-named channel, so they stay independent.
export function useAvailability(): { soldOut: Set<string>; inactive: Set<string> } {
  const [state, setState] = useState<{ soldOut: Set<string>; inactive: Set<string> }>({ soldOut: new Set(), inactive: new Set() });
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("products").select("slug, sold_out, active");
    if (!data) return;
    const rows = data as { slug: string; sold_out: boolean | null; active: boolean | null }[];
    setState({
      soldOut: new Set(rows.filter((p) => p.sold_out).map((p) => p.slug)),
      inactive: new Set(rows.filter((p) => p.active === false).map((p) => p.slug)),
    });
  }, []);
  useRealtimeTable("products", load, { loadOnMount: true });
  return state;
}
