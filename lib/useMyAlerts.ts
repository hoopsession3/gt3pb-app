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
};

export function useMyAlerts(userId: string | null, enabled = true) {
  const [flags, setFlags] = useState<MyFlag[]>([]);

  const load = useCallback(async () => {
    if (!supabase || !userId) { setFlags([]); return; }
    const [{ data: alerts }, { data: reads }] = await Promise.all([
      supabase.from("alerts")
        .select("id, severity, title, body, category, link, target_user_id, created_by")
        .or(`target_user_id.eq.${userId},target_user_id.is.null`)
        .is("ack_at", null)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("alert_reads").select("alert_id").eq("user_id", userId),
    ]);
    const readIds = new Set(((reads ?? []) as { alert_id: string }[]).map((r) => r.alert_id));
    // Dedupe identical title+body (belt-and-braces; the duplicate-producer era left twins in old rows).
    const seen = new Set<string>();
    setFlags(((alerts as MyFlag[]) ?? []).filter((f) => {
      if (readIds.has(f.id)) return false;
      const k = `${f.title}|${f.body ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }));
  }, [userId]);

  useEffect(() => { if (enabled) load(); }, [load, enabled]);
  useRealtimeTable(["alerts", "alert_reads"], load, { enabled: enabled && !!userId });

  // Dismiss one flag for ME (and, if it's mine alone, for the record).
  const ack = useCallback(async (f: MyFlag) => {
    setFlags((cur) => cur.filter((x) => x.id !== f.id));
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

  const critCount = flags.filter((f) => f.severity === "critical").length;
  return { flags, critCount, ack, clearAll, reload: load };
}
