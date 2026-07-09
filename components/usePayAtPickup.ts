"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// PAY-AT-PICKUP — is the operator offering a pay-later path (pay at the truck / on delivery)?
// Reads `live_status.pay_at_pickup` (0145), the crew's Money-section toggle. Every ordering surface
// (cup checkout, pack reserve, Sunday delivery) uses this one answer so the option can't drift.
// Optimistic ON (the DB default) so the button doesn't flash-then-vanish on the common path; the
// server routes re-check the flag before recording a pay-later order, so this is a UI helper, not
// the authority.
export function usePayAtPickup(active = true): { on: boolean; checked: boolean } {
  const [state, setState] = useState<{ on: boolean; checked: boolean }>({ on: true, checked: false });
  useEffect(() => {
    if (!active || !supabase) return;
    let live = true;
    supabase.from("live_status").select("pay_at_pickup").maybeSingle().then(({ data }) => {
      if (live) setState({ on: (data as { pay_at_pickup?: boolean } | null)?.pay_at_pickup !== false, checked: true });
    });
    return () => { live = false; };
  }, [active]);
  return state;
}
