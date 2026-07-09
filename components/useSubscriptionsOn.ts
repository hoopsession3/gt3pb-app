"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { SUBSCRIPTIONS_ON } from "@/lib/square";

// SUBSCRIPTIONS GO-LIVE — is the operator offering recurring coffee subscriptions to customers?
// Two gates, both must be true: the infra prerequisite (NEXT_PUBLIC_SUBSCRIPTIONS_ON env, i.e. the
// Square plans are configured) AND the owner's business switch (live_status.subscriptions_enabled,
// 0150 — default OFF). Every subscription surface reads this one answer so it can't drift.
// Optimistic OFF: subscriptions are NOT part of the launch, so we default hidden and only reveal
// when both gates confirm. Resilient to a not-yet-applied column (treats a read error as off).
export function useSubscriptionsOn(active = true): { on: boolean; checked: boolean } {
  const [state, setState] = useState<{ on: boolean; checked: boolean }>({ on: false, checked: false });
  useEffect(() => {
    if (!active) return;
    if (!SUBSCRIPTIONS_ON || !supabase) { setState({ on: false, checked: true }); return; }
    let live = true;
    // select("*") tolerates the column not being applied yet (reads undefined → off, never errors).
    supabase.from("live_status").select("*").maybeSingle().then(({ data, error }) => {
      if (!live) return;
      const dbOn = !error && (data as { subscriptions_enabled?: boolean } | null)?.subscriptions_enabled === true;
      setState({ on: dbOn, checked: true });
    });
    return () => { live = false; };
  }, [active]);
  return state;
}
