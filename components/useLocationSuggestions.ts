"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Location autocomplete (2026-07-29, prefill round — queued from the audit, Ryan's standing ask:
// "whenever you see opportunity for prefill"). The places this business goes repeat: the same
// squares, breweries and venues come back every season, but the venue fields were plain free text
// — every booking meant retyping "Duncan Town Square" from memory (typos then read as new places).
// This feeds a <datalist> under the venue inputs (EventCard's "Location / venue", FieldOpSheet's
// "Where") with every place already on record: recent events' and stops' location_text plus the
// vendor book's saved locations/addresses. Native datalist = zero new UI to learn, works with the
// existing type-and-blur save patterns, and screen readers treat it as a plain combobox.
//
// Module-level cache: one fetch per app session, shared by every mount (a crew member editing five
// events shouldn't fire five identical selects). Errors degrade to "no suggestions" — the input
// stays a working free-text field no matter what.
let cache: string[] | null = null;

export function useLocationSuggestions(): string[] {
  const [sugs, setSugs] = useState<string[]>(cache ?? []);
  useEffect(() => {
    if (cache || !supabase) return;
    let live = true;
    (async () => {
      const [ev, st, vn] = await Promise.all([
        supabase!.from("events").select("location_text").not("location_text", "is", null).order("day", { ascending: false }).limit(80),
        supabase!.from("stops").select("location_text, address").is("archived_at", null).order("starts_at", { ascending: false, nullsFirst: false }).limit(80),
        supabase!.from("vendors").select("location_text, address").is("archived_at", null).limit(80),
      ]);
      const out = new Set<string>();
      const add = (v?: string | null) => { const t = v?.trim(); if (t) out.add(t); };
      (ev.data ?? []).forEach((r: { location_text: string | null }) => add(r.location_text));
      (st.data ?? []).forEach((r: { location_text: string | null; address: string | null }) => { add(r.location_text); add(r.address); });
      (vn.data ?? []).forEach((r: { location_text: string | null; address: string | null }) => { add(r.location_text); add(r.address); });
      const list = [...out].slice(0, 60);
      if (list.length) cache = list;
      if (live) setSugs(list);
    })().catch(() => { /* free text keeps working with no suggestions */ });
    return () => { live = false; };
  }, []);
  return sugs;
}
