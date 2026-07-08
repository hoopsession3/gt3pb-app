"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { preorderWindow, preorderLeadMs, PREORDER_TAIL_MS } from "@/lib/orderAhead";

// IS THE TRUCK TAKING CUP ORDERS? — one hook, one answer, used by every ordering surface (menu
// drink sheet + checkout sheet; /api/checkout runs the same rule server-side before any charge).
// Open while the truck is LIVE, or inside the operator-set window before the next stop
// (live_status.preorder_lead_h — 0 = strict live-only). Pack reserves are always open.
export type OrderingOpen = {
  open: boolean;
  checked: boolean;                 // false until the first read lands (render optimistically)
  nextAt: string | null;            // next stop start (ISO) for "opens at…" copy
  nextName: string | null;
};

export function useOrderingOpen(active: boolean): OrderingOpen {
  const [state, setState] = useState<OrderingOpen>({ open: true, checked: false, nextAt: null, nextName: null });
  useEffect(() => {
    if (!active || !supabase) return;
    let liveFlag = true;
    (async () => {
      const [{ data: ls }, { data: st }] = await Promise.all([
        supabase!.from("live_status").select("is_live, preorder_lead_h").maybeSingle(),
        supabase!.from("stops").select("name, starts_at").is("archived_at", null).neq("status", "done").not("starts_at", "is", null)
          .gte("starts_at", new Date(Date.now() - PREORDER_TAIL_MS).toISOString()) // an in-progress stop still counts
          .order("starts_at", { ascending: true }).limit(1).maybeSingle(),
      ]);
      if (!liveFlag) return;
      const l = ls as { is_live?: boolean; preorder_lead_h?: number | null } | null;
      const s = st as { name?: string | null; starts_at?: string | null } | null;
      const win = preorderWindow(Date.now(), !!l?.is_live, s?.starts_at ?? null, preorderLeadMs(l?.preorder_lead_h));
      setState({ open: win.open, checked: true, nextAt: s?.starts_at ?? null, nextName: s?.name ?? null });
    })();
    return () => { liveFlag = false; };
  }, [active]);
  return state;
}
