"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// IS THIS PHONE KEPT FOR THIS PERSON? (R8, 2026-10-16). A browser's permission is the browser's; whether alerts reach
// this person here is a row (push_subscriptions, 0366: this phone's endpoint, kept for its person). Signing out lets the
// phone go (lib/pushRelease) and nothing kept it again at the next sign-in, so "Alerts on this phone: On" stood over a
// phone no order alert reached — and the crew's "On" over a phone the kitchen's pushes no longer rang. This reads the row
// for this phone: kept for them (and, for the crew, marked crew), or not. null — not known: no permission yet, nothing to
// read with, or a read that failed — draws as it always did.
export function usePushKept(active: boolean, userId: string | null, crew = false): { kept: boolean | null; recheck: () => void } {
  const [kept, setKept] = useState<boolean | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!active || !userId || !supabase || typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const sb = supabase;
    let live = true;
    void (async () => {
      try {
        const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager?.getSubscription();
        if (!sub?.endpoint) { if (live) setKept(false); return; }
        // Their own row only (0006's "own sub read"): another person's, or one let go at a sign-out, reads as none.
        const { data, error } = await sb.from("push_subscriptions").select("user_id, is_admin").eq("endpoint", sub.endpoint).maybeSingle();
        if (!live) return;
        const row = data as { user_id: string | null; is_admin: boolean | null } | null;
        setKept(error ? null : !!row && row.user_id === userId && (!crew || row.is_admin === true));
      } catch { if (live) setKept(null); }
    })();
    return () => { live = false; };
  }, [active, userId, crew, asked]);
  const recheck = useCallback(() => setAsked((n) => n + 1), []);
  return { kept: active ? kept : null, recheck };
}
