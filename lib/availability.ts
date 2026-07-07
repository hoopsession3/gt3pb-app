"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

// Live availability for the à-la-carte menu. Two axes, from public.products:
//   sold_out  — 86'd for the day: stays ON the menu, shows SOLD OUT, can't be ordered.
//   inactive  — off the menu entirely (guests can't even read inactive rows per RLS).
// Realtime, so an 86 flipped mid-rush lands on every open menu without a refresh. The server
// re-checks at charge time regardless — this hook is honesty for the screen, not the enforcement.
//
// Several components use this hook at once (menu, drink sheet, checkout, AppProvider). Supabase
// keys channels by NAME and refuses `.on()` after a same-named channel has `.subscribe()`d — so a
// shared topic name threw "cannot add callbacks after subscribe()" and error-boundaried every page.
// Each hook instance gets its own uniquely-named channel to keep them fully independent.
let chanSeq = 0;
export function useAvailability(): { soldOut: Set<string>; inactive: Set<string> } {
  const [state, setState] = useState<{ soldOut: Set<string>; inactive: Set<string> }>({ soldOut: new Set(), inactive: new Set() });
  const idRef = useRef<number>(0);
  if (idRef.current === 0) idRef.current = ++chanSeq;
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    const load = async () => {
      const { data } = await supabase!.from("products").select("slug, sold_out, active");
      if (!live || !data) return;
      const rows = data as { slug: string; sold_out: boolean | null; active: boolean | null }[];
      setState({
        soldOut: new Set(rows.filter((p) => p.sold_out).map((p) => p.slug)),
        inactive: new Set(rows.filter((p) => p.active === false).map((p) => p.slug)),
      });
    };
    load();
    const ch = supabase.channel(`product-availability-${idRef.current}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => load())
      .subscribe();
    return () => { live = false; supabase?.removeChannel(ch); };
  }, []);
  return state;
}
