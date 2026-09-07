"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// OPEN SETS — the lists that grow from real use rather than being fixed.
//
// Units and statuses are closed vocabularies and got a <select> (0306 / useOptions). Category and
// vendor are not: a new vendor or a new category is a normal Tuesday, and a closed picker would
// mean a deploy to buy from someone new. So these get a <datalist> — you are offered what is
// already on record, and can still type something new. That is the honest control for an open set,
// and it kills the real problem, which was retyping "Brewing Equipment" from memory and creating a
// third spelling of it.
//
// Module-level cache and graceful failure, same contract as useLocationSuggestions: one fetch per
// session, and a failure degrades to "no suggestions" — a plain working text field.

let cache: { categories: string[]; vendors: string[] } | null = null;
let inflight: Promise<{ categories: string[]; vendors: string[] }> | null = null;

async function load() {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const out = { categories: [] as string[], vendors: [] as string[] };
    try {
      if (supabase) {
        const [cats, vends] = await Promise.all([
          supabase.from("v_inventory_categories").select("category"),
          supabase.from("vendors").select("name").order("name"),
        ]);
        const cSeen = new Set<string>();
        for (const r of ((cats.data as { category: string }[] | null) ?? [])) {
          const v = (r.category ?? "").trim();
          if (v && !cSeen.has(v.toLowerCase())) { cSeen.add(v.toLowerCase()); out.categories.push(v); }
        }
        for (const r of ((vends.data as { name: string }[] | null) ?? [])) {
          const v = (r.name ?? "").trim();
          if (v) out.vendors.push(v);
        }
      }
    } catch { /* a suggest list is a nicety; never break the field over it */ }
    cache = out; inflight = null; return out;
  })();
  return inflight;
}

export function useSuggestions(): { categories: string[]; vendors: string[] } {
  const [s, setS] = useState(() => cache ?? { categories: [], vendors: [] });
  useEffect(() => { let alive = true; load().then((v) => { if (alive) setS(v); }); return () => { alive = false; }; }, []);
  return s;
}
