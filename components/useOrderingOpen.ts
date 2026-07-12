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
  pickup: boolean;                  // does THIS stop offer pickup? (per-stop opt-in, 0191)
};

export function useOrderingOpen(active: boolean): OrderingOpen {
  const [state, setState] = useState<OrderingOpen>({ open: true, checked: false, nextAt: null, nextName: null, pickup: false });
  useEffect(() => {
    if (!active || !supabase) return;
    let liveFlag = true;
    (async () => {
      const [{ data: ls }, { data: st }] = await Promise.all([
        supabase!.from("live_status").select("is_live, preorder_lead_h").maybeSingle(),
        supabase!.from("stops").select("name, starts_at, order_ahead_enabled, order_ahead_lead_min, pickup_enabled").is("archived_at", null).neq("status", "done").not("starts_at", "is", null)
          .gte("starts_at", new Date(Date.now() - PREORDER_TAIL_MS).toISOString()) // an in-progress stop still counts
          .order("starts_at", { ascending: true }).limit(1).maybeSingle(),
      ]);
      if (!liveFlag) return;
      const l = ls as { is_live?: boolean; preorder_lead_h?: number | null } | null;
      const s = st as { name?: string | null; starts_at?: string | null; order_ahead_enabled?: boolean; order_ahead_lead_min?: number | null; pickup_enabled?: boolean } | null;
      // Per-stop override: a stop that opted into order-ahead with its own lead time widens the window
      // for that stop; otherwise the global live_status window governs (no change for existing stops).
      const lead = s?.order_ahead_enabled && s?.order_ahead_lead_min != null ? s.order_ahead_lead_min * 60_000 : preorderLeadMs(l?.preorder_lead_h);
      const win = preorderWindow(Date.now(), !!l?.is_live, s?.starts_at ?? null, lead);
      setState({ open: win.open, checked: true, nextAt: s?.starts_at ?? null, nextName: s?.name ?? null, pickup: !!s?.pickup_enabled });
    })();
    return () => { liveFlag = false; };
  }, [active]);
  return state;
}
