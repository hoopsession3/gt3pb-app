"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// THE CREW, once. Four screens already loaded profiles by hand to build the same "assign to"
// dropdown — AssignTaskSheet, TaskSheet, ShootPlanner, PipelinePanel — and a fifth (the workstream
// registry) asked you to TYPE the name instead, under a label promising "exactly one name". Same
// list, four fetches, one text box. This is the one fetch they can all share.
//
// Module-level cache and graceful failure, same contract as useLocationSuggestions. An empty list
// is a working state, not a broken one: the caller falls back to whatever text it already had.

export type CrewMember = { id: string; display_name: string | null; role: string };

let cache: CrewMember[] | null = null;
let inflight: Promise<CrewMember[]> | null = null;

async function load(): Promise<CrewMember[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    let out: CrewMember[] = [];
    try {
      if (supabase) {
        const { data, error } = await supabase.from("profiles")
          .select("id, display_name, role").neq("role", "member").order("display_name");
        if (!error && Array.isArray(data)) out = data as CrewMember[];
      }
    } catch { /* an empty crew list degrades to the free-text behaviour it replaced */ }
    cache = out; inflight = null; return out;
  })();
  return inflight;
}

export function useCrew(): CrewMember[] {
  const [crew, setCrew] = useState<CrewMember[]>(() => cache ?? []);
  useEffect(() => { let alive = true; load().then((c) => { if (alive) setCrew(c); }); return () => { alive = false; }; }, []);
  return crew;
}

/** How a crew member reads in a dropdown — name, or the role when they have not set one. */
export const crewLabel = (c: CrewMember) =>
  `${c.display_name || c.role} · ${c.role.replace(/_/g, " ")}`;
