"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { OFFICE } from "@/lib/office";

// Live office pricing (owner-editable via the Settings tab, 0189). Falls back to the code constants
// if the columns are unset/missing, so the office order flow never breaks on a schema gap.
export function useOfficeSettings() {
  const [s, setS] = useState<{ priceCents: number; minGallons: number }>({ priceCents: OFFICE.pricePerGallonCents, minGallons: OFFICE.minGallons });
  useEffect(() => {
    if (!supabase) return;
    supabase.from("live_status").select("office_price_cents, office_min_gallons").eq("id", 1).maybeSingle()
      .then(({ data }) => {
        const d = data as { office_price_cents?: number; office_min_gallons?: number } | null;
        if (d) setS({ priceCents: d.office_price_cents ?? OFFICE.pricePerGallonCents, minGallons: d.office_min_gallons ?? OFFICE.minGallons });
      });
  }, []);
  return s;
}
