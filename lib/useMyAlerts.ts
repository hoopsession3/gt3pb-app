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
  created_at: string;          // 2026-07-30 (Ryan: "put dates to these alerts") — an alert with no age is a rumor
  // 0327 added this column so a recurring condition could be ONE line that says how many times.
  // It wrote the number and nothing ever read it: on 2026-09-30 a row in production stood at ×6 and
  // no screen had ever shown it. A count that is stored and never displayed is not a feature, it is
  // a second copy of the thing you were trying to stop — the flood, invisible.
  occurrences: number | null;
  last_seen_at: string | null; // when this condition was last true, as opposed to first noticed
};

// Quiet hours: is the local clock currently inside [start, end)? Wrap-aware (22→7 spans midnight).
// A null bound or an empty window (start === end) means "no quiet window".
function inQuietHours(now: Date, start: number | null | undefined, end: number | null | undefined): boolean {
  if (start == null || end == null || start === end) return false;
  const h = now.getHours();
  return start < end ? (h >= start && h < end) : (h >= start || h < end);
}

export function useMyAlerts(userId: string | null, enabled = true) {
  const [flags, setFlags] = useState<MyFlag[]>([]);
  const [held, setHeld] = useState<MyFlag[]>([]);       // non-criticals held by quiet hours (the digest)
  const [quietActive, setQuietActive] = useState(false);
  // A FAILED READ IS NOT "NOTHING NEEDS YOU" (2026-10-04). All four reads below used to destructure
  // `data` alone, so a refused alerts read set the list to empty — the bell went quiet and My Day,
  // whose rule is "when nothing needs you, we say NOTHING", said nothing. A failure keeps the last
  // answer on screen and says it could not refresh; and a failed alert_reads or snoozes read is a
  // failure too, because without it broadcasts already dismissed would count again.
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !userId) { setFlags([]); setHeld([]); setQuietActive(false); return; }
    const nowIso = new Date().toISOString();
    const [al, rd, pf, sz] = await Promise.all([
      supabase.from("alerts")
        .select("id, severity, title, body, category, link, target_user_id, created_by, kind, subject_id, created_at, occurrences, last_seen_at")
        .or(`target_user_id.eq.${userId},target_user_id.is.null`)
        .is("ack_at", null)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("alert_reads").select("alert_id").eq("user_id", userId),
      supabase.from("notif_prefs").select("muted_categories, quiet_start, quiet_end").eq("user_id", userId).maybeSingle(),
      supabase.from("alert_snoozes").select("alert_id, until").eq("user_id", userId).gt("until", nowIso),
    ]);
    const failed = [al.error, rd.error, pf.error, sz.error].find(Boolean);
    if (failed) { setError(failed.message); return; }
    setError(null);
    const alerts = al.data, reads = rd.data, prefsRow = pf.data, snz = sz.data;
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
  //
  // EVERY WRITE HERE SAYS WHETHER IT TOOK (2026-10-05, the gesture round). They used to await the
  // database and drop its answer: a dismissal it refused took the flag off the screen and the next
  // read put it back, unexplained. Swiping makes dismissing a flick, so each write now answers with
  // the database's sentence (null: it took), puts the flag back by reading again, and the screen that
  // asked says what happened.
  const ack = useCallback(async (f: MyFlag): Promise<string | null> => {
    setFlags((cur) => cur.filter((x) => x.id !== f.id));
    setHeld((cur) => cur.filter((x) => x.id !== f.id));
    if (!supabase || !userId) return null;
    const { error } = f.target_user_id === userId
      ? await supabase.from("alerts").update({ ack_at: new Date().toISOString(), ack_by: userId }).eq("id", f.id)
      : await supabase.from("alert_reads").upsert({ alert_id: f.id, user_id: userId });
    if (error) { await load(); return error.message; }
    return null;
  }, [userId, load]);

  const clearAll = useCallback(async (): Promise<string | null> => {
    const cur = flags;
    setFlags([]);
    if (!supabase || !userId || !cur.length) return null;
    const mine = cur.filter((f) => f.target_user_id === userId).map((f) => f.id);
    const broadcast = cur.filter((f) => f.target_user_id !== userId).map((f) => f.id);
    const a = mine.length ? await supabase.from("alerts").update({ ack_at: new Date().toISOString(), ack_by: userId }).in("id", mine) : null;
    const b = broadcast.length ? await supabase.from("alert_reads").upsert(broadcast.map((id) => ({ alert_id: id, user_id: userId }))) : null;
    const error = a?.error ?? b?.error;
    if (error) { await load(); return error.message; }
    return null;
  }, [flags, userId, load]);

  // UNDO (2026-10-05): flags dismissed by mistake come back — un-acked on the row if they were mine
  // alone, my read taken back if they were broadcasts, a snooze lifted. On the screen at once, in the
  // order the inbox reads them; the read that follows is the truth.
  const putBack = useCallback((fs: MyFlag[]) => {
    setFlags((cur) => [...cur, ...fs.filter((f) => !cur.some((x) => x.id === f.id))].sort((x, y) => y.created_at.localeCompare(x.created_at)));
  }, []);
  const restore = useCallback(async (fs: MyFlag[]): Promise<string | null> => {
    if (!supabase || !userId || !fs.length) return null;
    putBack(fs);
    const mine = fs.filter((f) => f.target_user_id === userId).map((f) => f.id);
    const broadcast = fs.filter((f) => f.target_user_id !== userId).map((f) => f.id);
    const a = mine.length ? await supabase.from("alerts").update({ ack_at: null, ack_by: null }).in("id", mine) : null;
    const b = broadcast.length ? await supabase.from("alert_reads").delete().eq("user_id", userId).in("alert_id", broadcast) : null;
    await load();
    return a?.error?.message ?? b?.error?.message ?? null;
  }, [userId, load, putBack]);

  // Push a flag to later — off my glance screen for `forMs`, then it returns. Criticals ignore this.
  const snooze = useCallback(async (f: MyFlag, forMs: number): Promise<string | null> => {
    if (f.severity === "critical") return null;
    setFlags((cur) => cur.filter((x) => x.id !== f.id));
    if (!supabase || !userId) return null;
    const { error } = await supabase.from("alert_snoozes").upsert({ alert_id: f.id, user_id: userId, until: new Date(Date.now() + forMs).toISOString() });
    if (error) { await load(); return error.message; }
    return null;
  }, [userId, load]);
  const unsnooze = useCallback(async (f: MyFlag): Promise<string | null> => {
    if (!supabase || !userId) return null;
    putBack([f]);
    const { error } = await supabase.from("alert_snoozes").delete().eq("user_id", userId).eq("alert_id", f.id);
    await load();
    return error?.message ?? null;
  }, [userId, load, putBack]);

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
  return { flags, held, quietActive, critCount, error, ack, clearAll, clearHeld, snooze, restore, unsnooze, reload: load };
}
