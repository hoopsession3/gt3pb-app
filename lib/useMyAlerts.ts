"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useRealtimeTable } from "./realtime";

// THE one answer to "what needs me?" — the audit found three surfaces counting alerts three
// different ways (the My Day flags list, the Now screen strip, and the nav badge, which counted
// other people's targeted criticals). All three consume this hook now, so the numbers agree by
// construction.
//
// Semantics (migration 0157):
// - visible = unacked AND (broadcast OR targeted at me) AND not in MY alert_reads.
//   RLS enforces the middle clause for crew; leadership sees broadcasts + their own the same way.
// - "Got it" on a TARGETED alert sets ack_at (the row is mine; the escalation ladder reads it).
//   "Got it" on a BROADCAST records a per-user read — it disappears for me, stays for the team.
export type MyFlag = {
  id: string;
  severity: "critical" | "important" | "fyi";
  title: string;
  body: string | null;
  category: string | null;
  link: string | null;
  target_user_id: string | null;
  created_by: string | null;
  kind: string | null;         // 0174 action contract — names the inline handler
  subject_id: string | null;   // the row that handler acts on
};

// Quiet hours: is the local clock currently inside [start, end)? Wrap-aware (22→7 spans midnight).
// A null bound or an empty window (start === end) means "no quiet window".
export function inQuietHours(now: Date, start: number | null | undefined, end: number | null | undefined): boolean {
  if (start == null || end == null || start === end) return false;
  const h = now.getHours();
  return start < end ? (h >= start && h < end) : (h >= start || h < end);
}

export function useMyAlerts(userId: string | null, enabled = true) {
  const [flags, setFlags] = useState<MyFlag[]>([]);
  const [held, setHeld] = useState<MyFlag[]>([]);       // non-criticals held by quiet hours (the digest)
  const [quietActive, setQuietActive] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !userId) { setFlags([]); setHeld([]); setQuietActive(false); return; }
    const nowIso = new Date().toISOString();
    const [{ data: alerts }, { data: reads }, { data: prefsRow }, { data: snz }] = await Promise.all([
      supabase.from("alerts")
        .select("id, severity, title, body, category, link, target_user_id, created_by, kind, subject_id")
        .or(`target_user_id.eq.${userId},target_user_id.is.null`)
        .is("ack_at", null)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("alert_reads").select("alert_id").eq("user_id", userId),
      supabase.from("notif_prefs").select("muted_categories, quiet_start, quiet_end").eq("user_id", userId).maybeSingle(),
      supabase.from("alert_snoozes").select("alert_id, until").eq("user_id", userId).gt("until", nowIso),
    ]);
    const readIds = new Set(((reads ?? []) as { alert_id: string }[]).map((r) => r.alert_id));
    const snoozed = new Set(((snz ?? []) as { alert_id: string }[]).map((r) => r.alert_id));
    const prefs = (prefsRow as { muted_categories?: string[]; quiet_start?: number | null; quiet_end?: number | null } | null);
    const muted = new Set(prefs?.muted_categories ?? []);
    const quiet = inQuietHours(new Date(), prefs?.quiet_start, prefs?.quiet_end);
    setQuietActive(quiet);
    // Dedupe identical title+body (belt-and-braces; the duplicate-producer era left twins in old rows).
    const seen = new Set<string>();
    const shown: MyFlag[] = [];
    const digest: MyFlag[] = [];
    for (const f of ((alerts as MyFlag[]) ?? [])) {
      if (readIds.has(f.id)) continue;
      const k = `${f.title}|${f.body ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      // Criticals are never silenced — they always show live. Otherwise: a muted category or an
      // active snooze hides it entirely; and during quiet hours the rest are HELD off the glance
      // (into the digest) so the night stays calm, then surface when quiet hours end.
      if (f.severity !== "critical") {
        if (f.category && muted.has(f.category)) continue;
        if (snoozed.has(f.id)) continue;
        if (quiet) { digest.push(f); continue; }
      }
      shown.push(f);
    }
    setFlags(shown);
    setHeld(digest);
  }, [userId]);

  useEffect(() => { if (enabled) load(); }, [load, enabled]);
  useRealtimeTable(["alerts", "alert_reads", "alert_snoozes", "notif_prefs"], load, { enabled: enabled && !!userId });
  // Re-evaluate on the hour so the digest releases when quiet hours end even with no other activity.
  useEffect(() => {
    if (!enabled || !userId) return;
    const t = setInterval(() => load(), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [enabled, userId, load]);

  // Dismiss one flag for ME (and, if it's mine alone, for the record). Works from the live glance
  // or the quiet-hours digest.
  const ack = useCallback(async (f: MyFlag) => {
    setFlags((cur) => cur.filter((x) => x.id !== f.id));
    setHeld((cur) => cur.filter((x) => x.id !== f.id));
    if (!supabase || !userId) return;
    if (f.target_user_id === userId) {
      await supabase.from("alerts").update({ ack_at: new Date().toISOString(), ack_by: userId }).eq("id", f.id);
    } else {
      await supabase.from("alert_reads").upsert({ alert_id: f.id, user_id: userId });
    }
  }, [userId]);

  const clearAll = useCallback(async () => {
    const cur = flags;
    setFlags([]);
    if (!supabase || !userId || !cur.length) return;
    const mine = cur.filter((f) => f.target_user_id === userId).map((f) => f.id);
    const broadcast = cur.filter((f) => f.target_user_id !== userId).map((f) => f.id);
    if (mine.length) await supabase.from("alerts").update({ ack_at: new Date().toISOString(), ack_by: userId }).in("id", mine);
    if (broadcast.length) await supabase.from("alert_reads").upsert(broadcast.map((id) => ({ alert_id: id, user_id: userId })));
  }, [flags, userId]);

  // Push a flag to later — off my glance screen until `until`, then it returns. Criticals ignore this.
  const snooze = useCallback(async (f: MyFlag, until: Date) => {
    if (f.severity === "critical") return;
    setFlags((cur) => cur.filter((x) => x.id !== f.id));
    if (!supabase || !userId) return;
    await supabase.from("alert_snoozes").upsert({ alert_id: f.id, user_id: userId, until: until.toISOString() });
  }, [userId]);

  // Release the whole digest onto the glance now — "read them all" (acks every held item).
  const clearHeld = useCallback(async () => {
    const cur = held;
    setHeld([]);
    if (!supabase || !userId || !cur.length) return;
    const mine = cur.filter((f) => f.target_user_id === userId).map((f) => f.id);
    const broadcast = cur.filter((f) => f.target_user_id !== userId).map((f) => f.id);
    if (mine.length) await supabase.from("alerts").update({ ack_at: new Date().toISOString(), ack_by: userId }).in("id", mine);
    if (broadcast.length) await supabase.from("alert_reads").upsert(broadcast.map((id) => ({ alert_id: id, user_id: userId })));
  }, [held, userId]);

  const critCount = flags.filter((f) => f.severity === "critical").length;
  return { flags, held, quietActive, critCount, ack, clearAll, clearHeld, snooze, reload: load };
}
