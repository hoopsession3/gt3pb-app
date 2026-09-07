"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { FALLBACK, type Option, type OptionSetKey } from "@/lib/options";

// PICKER LISTS, from the one place that owns them (0306's public.option_sets, read via v_options).
//
// Before this, the same column was a <select> over a lib/ constant on one screen and an <input> on
// another, and inventory status had two DIFFERENT hard-coded lists in two editors that both wrote
// it. Every picker now reads the same rows.
//
// Module-level cache, same shape as useLocationSuggestions: one fetch per app session no matter how
// many editors mount. A failed fetch falls back to the constants in lib/options — degrading to
// today's behaviour, never to an empty dropdown, which would be worse than the free text this
// replaced. One in-flight promise so five mounts do not fire five identical selects.

let cache: Record<string, Option[]> | null = null;
let inflight: Promise<Record<string, Option[]>> | null = null;

async function load(): Promise<Record<string, Option[]>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const out: Record<string, Option[]> = {};
    try {
      if (supabase) {
        const { data, error } = await supabase.from("v_options").select("set_key, value, label, sort");
        if (!error && Array.isArray(data)) {
          for (const r of data as { set_key: string; value: string; label: string | null; sort: number }[]) {
            (out[r.set_key] ??= []).push({ value: r.value, label: r.label || r.value });
          }
        }
      }
    } catch { /* fall through to the constants */ }
    // Any set the table did not answer for keeps its constant. Partial results are fine: a new set
    // that has not been seeded yet simply behaves the way it did before the table existed.
    for (const k of Object.keys(FALLBACK) as OptionSetKey[]) {
      if (!out[k]?.length) out[k] = FALLBACK[k];
    }
    cache = out;
    inflight = null;
    return out;
  })();
  return inflight;
}

/** The options for one set. Renders the constant immediately, then the table's rows when they
 *  arrive — so a picker is never briefly empty on first paint. */
export function useOptions(key: OptionSetKey): Option[] {
  const [list, setList] = useState<Option[]>(() => cache?.[key] ?? FALLBACK[key]);
  useEffect(() => {
    let alive = true;
    load().then((all) => { if (alive && all[key]) setList(all[key]); });
    return () => { alive = false; };
  }, [key]);
  return list;
}
