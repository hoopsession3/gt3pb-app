"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// THE JURISDICTIONS THE PERMIT CHECKER CAN ACTUALLY ANSWER FOR (0306's v_compliance_jurisdictions).
//
// State and County were free text, and lib/compliance.ts matches those strings against
// compliance_rules.state / .county. A near miss — "Ga." for "GA", "Fulton County" for "Fulton" —
// matches zero rules and renders a permit checklist that looks COMPLETE. Of every field in this
// app that is the worst one to get quietly wrong: the failure is invisible and it is regulatory.
//
// So the control offers what the rules can answer for. A place GT3 has never worked in yet is
// still typable — you cannot be blocked from booking in a new county because nobody has researched
// it — but the common case stops being a spelling test.

export type Jurisdiction = { state: string; county: string | null; active_rules: number };

let cache: Jurisdiction[] | null = null;
let inflight: Promise<Jurisdiction[]> | null = null;

async function load(): Promise<Jurisdiction[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    let out: Jurisdiction[] = [];
    try {
      if (supabase) {
        const { data, error } = await supabase.from("v_compliance_jurisdictions")
          .select("state, county, active_rules");
        if (!error && Array.isArray(data)) out = data as Jurisdiction[];
      }
    } catch { /* an empty list means the fields behave exactly as they did before */ }
    cache = out; inflight = null; return out;
  })();
  return inflight;
}

export function useJurisdictions(): {
  states: string[];
  countiesFor: (state: string | null | undefined) => string[];
  rulesFor: (state: string | null | undefined, county: string | null | undefined) => number | null;
} {
  const [rows, setRows] = useState<Jurisdiction[]>(() => cache ?? []);
  useEffect(() => { let alive = true; load().then((r) => { if (alive) setRows(r); }); return () => { alive = false; }; }, []);

  const states = [...new Set(rows.map((r) => r.state))].sort();
  const countiesFor = (state: string | null | undefined) => {
    const s = (state ?? "").trim().toUpperCase();
    return [...new Set(rows.filter((r) => r.state.toUpperCase() === s && r.county).map((r) => r.county as string))].sort();
  };
  // How many rules actually back a chosen pair. A zero here is the thing the old text boxes could
  // never say out loud, and it is exactly what the crew needs to see before they trust the list.
  const rulesFor = (state: string | null | undefined, county: string | null | undefined) => {
    const s = (state ?? "").trim().toUpperCase();
    if (!s) return null;
    const c = (county ?? "").trim().toLowerCase();
    const hit = rows.filter((r) => r.state.toUpperCase() === s
      && (c ? (r.county ?? "").toLowerCase() === c : true));
    if (!hit.length) return 0;
    return hit.reduce((n, r) => n + Number(r.active_rules || 0), 0);
  };
  return { states, countiesFor, rulesFor };
}
