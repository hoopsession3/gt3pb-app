"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// THE CREW, once. The same "who can I assign this to?" fetch was hand-rolled on TWELVE screens —
// this file's original comment said four, which was the count at the time it was written and was
// never revisited. Same query, same filter, same ordering, twelve times.
//
// ── WHAT THIS IS FOR, AND WHAT IT IS NOT ───────────────────────────────────────────────────────
// A PICKER. An assign-to dropdown, a rep selector, a mention list. For those, one shared cached
// fetch is strictly better than twelve.
//
// It is NOT for a screen whose job is to show the crew's current state — OrgChart (which needs
// title and avatar_url), UtilizationPanel and WorkloadBoard render people AS the data, and a
// cached list is the wrong shape for that. Those three keep their own reads on purpose, and the
// audit rule that enforces this exempts them by name.
//
// ── THE CACHE HAD NO WAY OUT ───────────────────────────────────────────────────────────────────
// It was `if (cache) return cache` with nothing that could ever clear it, so promoting somebody
// left every picker in the session showing the old list until a full reload. That was tolerable
// while one screen used it and is not now. Two changes: a 60-second TTL, and invalidateCrew() for
// the moment a role actually changes, so the correction is immediate where it matters and cheap
// everywhere else.
//
// Graceful failure is unchanged: an empty list is a working state, not a broken one — the caller
// falls back to whatever text it already had.

export type CrewMember = { id: string; display_name: string | null; role: string };

const TTL_MS = 60_000;
let cache: CrewMember[] | null = null;
let cachedAt = 0;
let inflight: Promise<CrewMember[]> | null = null;

/** Call after anything that changes who is on the crew, or what role they hold. */
export function invalidateCrew() { cache = null; cachedAt = 0; }

async function load(): Promise<CrewMember[]> {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
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
    cache = out; cachedAt = Date.now(); inflight = null; return out;
  })();
  return inflight;
}

export function useCrew(): CrewMember[] {
  const [crew, setCrew] = useState<CrewMember[]>(() => (cache && Date.now() - cachedAt < TTL_MS ? cache : []));
  useEffect(() => { let alive = true; load().then((c) => { if (alive) setCrew(c); }); return () => { alive = false; }; }, []);
  return crew;
}

/** How a crew member reads in a dropdown — name, or the role when they have not set one. */
export const crewLabel = (c: CrewMember) =>
  `${c.display_name || c.role} · ${c.role.replace(/_/g, " ")}`;
