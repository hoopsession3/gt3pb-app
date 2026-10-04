"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import type { Known, KnownRows } from "@/lib/customerKnown";

// WHAT WE ALREADY KNOW ABOUT THE PERSON FILLING THIS IN — the hook every customer form asks
// (2026-10-04, the form audit). lib/customerKnown decides the order; lib/customerKnownRead reads the
// customer's own rows. Both load on demand, and only for someone signed in: a guest gets the
// browser's own autofill (every field says what it is) and this downloads nothing for them.
//
// One read per person per minute, shared by every form on the screen; a placed order clears it
// (invalidateCustomerKnown) so the next form starts from what was just typed. The profile is not
// part of the read — it is applied at render — so a profile that lands after the rows still counts.

type Loaded = { uid: string; rows: Omit<KnownRows, "email" | "displayName" | "market">; failed: number; knownFrom: (r: KnownRows) => Known };
let cache: { uid: string; at: number; p: Promise<Loaded | null> } | null = null;
const TTL_MS = 60_000;

/** Call after an order is placed, so the next form starts from it. */
export function invalidateCustomerKnown() { cache = null; }

export function useCustomerKnown(enabled = true): Known | null {
  const { user, profile } = useAuth();
  const uid = user?.id ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!enabled || !uid || !supabase) return;
    const sb = supabase;
    if (!cache || cache.uid !== uid || Date.now() - cache.at > TTL_MS) {
      cache = {
        uid, at: Date.now(),
        p: import("@/lib/customerKnownRead")
          .then(async (m) => ({ uid, ...(await m.readKnownRows(sb, uid)), knownFrom: m.knownFrom }))
          .catch(() => null),
      };
    }
    let alive = true;
    cache.p.then((l) => { if (alive && l) setLoaded(l); });
    return () => { alive = false; };
  }, [enabled, uid]);
  return useMemo(
    () => (loaded && loaded.uid === uid
      ? loaded.knownFrom({ ...loaded.rows, email: user?.email, displayName: profile?.display_name, market: (profile as { market?: string | null } | null)?.market })
      : null),
    [loaded, uid, user?.email, profile],
  );
}

/**
 * A field that starts from what we know and becomes the customer's the moment they type in it.
 * Untouched it reads the known value (which may arrive a moment after the form opens); once typed
 * in — even emptied — it is theirs. No effect copies anything into state, so nothing a person has
 * typed is ever overwritten by a read that lands late.
 */
export function useKnownField(known: string | null | undefined): [string, (v: string) => void, boolean] {
  const [typed, setTyped] = useState<string | null>(null);
  return [typed ?? known ?? "", setTyped, typed === null && !!known];
}
