"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { roleLabel } from "@/lib/roles";

// THE CREW, once. The same "who can I assign this to?" fetch was hand-rolled on TWELVE screens —
// this file's original comment said four, which was the count at the time it was written and was
// never revisited. Same query, same filter, same ordering, twelve times.
//
// ── WHAT THIS IS FOR, AND WHAT IT IS NOT ───────────────────────────────────────────────────────
// A PICKER. An assign-to dropdown, a rep selector, a mention list. For those, one shared cached
// fetch is strictly better than twelve.
//
// It is NOT for two other things, and the difference between them matters:
//
//   PEOPLE AS THE DATA — OrgChart (which needs title and avatar_url), UtilizationPanel, the crew
//   roster and the Academy team view render people as the subject, not as a field. A cached list
//   is the wrong shape: it goes stale and it does not carry the columns they select.
//
//   AN EMPTY LIST WOULD BE WRONG — Discussions and StrategyCollab turn author ids into names, and
//   ProposalDesk decides who gets the review alert. This hook's graceful failure (below) means a
//   failed read returns [], which for those three is not "a short dropdown", it is every comment
//   attributed to "Crew" and nobody notified. They read inside useAsyncData, which throws, on
//   purpose.
//
// scripts/dupe.audit.mjs exempts all of them BY NAME with those reasons, and its baseline is now
// zero: this hook is the crew fetch, and anything else has to argue for itself.
//
// Seven files call it (it had exactly one importer when the audit found this).
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

/** How a crew member reads in a dropdown — name, or the role when they have not set one.
 *
 *  The role's WORD comes from lib/roles, not from replacing underscores with spaces. That produced
 *  "event manager" here while the team console, the org chart and the offer letter all said "Event
 *  Manager" — a ninth spelling of the same seven words, and the reason the role vocabulary now has
 *  exactly one home. */
export const crewLabel = (c: { display_name: string | null; role: string | null }) =>
  `${c.display_name || roleLabel(c.role)} · ${roleLabel(c.role)}`;
