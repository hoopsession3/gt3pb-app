"use client";

import { useCallback } from "react";
import { supabase } from "./supabase";
import { sharedStore } from "./shared";
import { sameJson } from "./sharedCore";
import { claimWords } from "./alertKinds";

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
//   Since 0383 the first such read is a CLAIM the database keeps on the alert (claimed_by): the team
//   sees "<first name> has it" on it, and it is listed apart (`claimed`) and no longer counted for them.
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
  // 0383: on a team alert, who has it — the first person who tapped Got it, kept by the database (absent
  // before 0383) — and, on one someone else has, what the inbox says of it: "Max has it" (lib/alertKinds
  // claimWords, with the first name only the database may tell a server: alert_claimants).
  claimed_by?: string | null;
  claim?: string | null;
};

// Quiet hours: is the local clock currently inside [start, end)? Wrap-aware (22→7 spans midnight).
// A null bound or an empty window (start === end) means "no quiet window".
function inQuietHours(now: Date, start: number | null | undefined, end: number | null | undefined): boolean {
  if (start == null || end == null || start === end) return false;
  const h = now.getHours();
  return start < end ? (h >= start && h < end) : (h >= start || h < end);
}

// ONE COPY PER PERSON (R13 — the 10/10 audit's performance pass, F5 and F15, lib/shared). With the Pass open the console
// kept two — the header's bell and the Pass's strip — each with four reads, a call, a four-table channel and a 5-minute
// clock; and a read that left before a dismissal and landed after it put the flag back on the bell. One store per
// person now: one read for all of them, a dismissal on any of them is at once on all of them, and a read that left before
// it is not let back over it.
type Mine = { flags: MyFlag[]; held: MyFlag[]; claimed: MyFlag[]; quietActive: boolean; error: string | null };
const NONE: Mine = { flags: [], held: [], claimed: [], quietActive: false, error: null };
const myAlerts = sharedStore<Mine>({
  initial: NONE,
  personal: true,
  tables: () => ["alerts", "alert_reads", "alert_snoozes", "notif_prefs"],
  // Again every 5 minutes on screen, so the digest lets go when quiet hours end with nothing else happening.
  every: { ms: 5 * 60 * 1000 },
  equal: sameJson,
  read: async (userId, cur) => {
    if (!supabase) return undefined;
    const nowIso = new Date().toISOString();
    const [al, rd, pf, sz] = await Promise.all([
      // EVERY COLUMN, SO THE CLAIM ARRIVES WITH ITS MIGRATION (2026-10-12). claimed_by is 0383's, and a list
      // naming it would fail this whole read — the bell, My Day, the inbox — on a database still before 0383
      // (migrations are pasted by hand, after the deploy). "*" reads it once it exists and nothing until then.
      supabase.from("alerts")
        .select("*")
        .or(`target_user_id.eq.${userId},target_user_id.is.null`)
        .is("ack_at", null)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("alert_reads").select("alert_id").eq("user_id", userId),
      supabase.from("notif_prefs").select("muted_categories, quiet_start, quiet_end").eq("user_id", userId).maybeSingle(),
      supabase.from("alert_snoozes").select("alert_id, until").eq("user_id", userId).gt("until", nowIso),
    ]);
    // A FAILED READ IS NOT "NOTHING NEEDS YOU" (2026-10-04). All four reads used to destructure `data` alone, so a
    // refused alerts read set the list to empty — the bell went quiet and My Day, whose rule is "when nothing needs you,
    // we say NOTHING", said nothing. A failure keeps the last answer on screen and says it could not refresh; and a
    // failed alert_reads or snoozes read is a failure too, because without it broadcasts already dismissed would count again.
    const failed = [al.error, rd.error, pf.error, sz.error].find(Boolean);
    if (failed) return { ...cur, error: failed.message };
    const alerts = al.data, reads = rd.data, prefsRow = pf.data, snz = sz.data;
    const readIds = new Set(((reads ?? []) as { alert_id: string }[]).map((r) => r.alert_id));
    const snoozed = new Set(((snz ?? []) as { alert_id: string }[]).map((r) => r.alert_id));
    const prefs = (prefsRow as { muted_categories?: string[]; quiet_start?: number | null; quiet_end?: number | null } | null);
    const muted = new Set(prefs?.muted_categories ?? []);
    const quiet = inQuietHours(new Date(), prefs?.quiet_start, prefs?.quiet_end);
    // Dedupe identical title+body (belt-and-braces; the duplicate-producer era left twins in old rows).
    const seen = new Set<string>();
    const shown: MyFlag[] = [];
    const digest: MyFlag[] = [];
    const taken: MyFlag[] = [];
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
      // SOMEBODY HAS IT (2026-10-12, 0383): a team alert someone else claimed is listed, with who, and
      // counted nowhere — not on the bell, not as a critical, not on the service strip. In quiet hours a
      // non-critical one waits in the digest like the rest, still saying who has it.
      if (claimWords(f, userId)) { taken.push(f); continue; }
      shown.push(f);
    }
    // Who has each: a first name only the database may give a server (alert_claimants, 0383). Without
    // its answer the line still says the truth — "Someone has it" — so a failure here is not a failed read.
    const theirs = [...taken, ...digest.filter((f) => claimWords(f, userId))];
    if (theirs.length) {
      const { data: who, error: whoErr } = await supabase.rpc("alert_claimants", { p_alerts: theirs.map((f) => f.id) });
      const names = new Map(whoErr ? [] : ((who ?? []) as { alert_id: string; first_name: string | null }[]).map((w) => [w.alert_id, w.first_name]));
      for (const f of theirs) f.claim = claimWords({ ...f, claimed_name: names.get(f.id) }, userId);
    }
    return { flags: shown, held: digest, claimed: taken, quietActive: quiet, error: null };
  },
});

const without = (id: string) => (cur: Mine): Mine => ({ ...cur, flags: cur.flags.filter((x) => x.id !== id), held: cur.held.filter((x) => x.id !== id), claimed: cur.claimed.filter((x) => x.id !== id) });

export function useMyAlerts(userId: string | null, enabled = true) {
  const key = enabled && userId ? userId : null;
  const { flags, held, claimed, quietActive, error } = myAlerts.use(key);
  const load = useCallback(async () => { if (key) await myAlerts.reload(key); }, [key]);
  // A change made on this screen is made on every screen showing the alerts, at once (and is newer than any read out).
  const edit = useCallback((next: (cur: Mine) => Mine) => { if (key) myAlerts.change(key, next); }, [key]);

  // Dismiss one flag for ME (and, if it's mine alone, for the record). Works from the live glance
  // or the quiet-hours digest.
  //
  // EVERY WRITE HERE SAYS WHETHER IT TOOK (2026-10-05, the gesture round). They used to await the
  // database and drop its answer: a dismissal it refused took the flag off the screen and the next
  // read put it back, unexplained. Swiping makes dismissing a flick, so each write now answers with
  // the database's sentence (null: it took), puts the flag back by reading again, and the screen that
  // asked says what happened.
  const ack = useCallback(async (f: MyFlag): Promise<string | null> => {
    edit(without(f.id));
    if (!supabase || !userId) return null;
    const { error } = f.target_user_id === userId
      ? await supabase.from("alerts").update({ ack_at: new Date().toISOString(), ack_by: userId }).eq("id", f.id)
      : await supabase.from("alert_reads").upsert({ alert_id: f.id, user_id: userId });
    if (error) { await load(); return error.message; }
    return null;
  }, [userId, load, edit]);

  const clearAll = useCallback(async (): Promise<string | null> => {
    const cur = key ? myAlerts.peek(key).flags : [];
    edit((m) => ({ ...m, flags: [] }));
    if (!supabase || !userId || !cur.length) return null;
    const mine = cur.filter((f) => f.target_user_id === userId).map((f) => f.id);
    const broadcast = cur.filter((f) => f.target_user_id !== userId).map((f) => f.id);
    const a = mine.length ? await supabase.from("alerts").update({ ack_at: new Date().toISOString(), ack_by: userId }).in("id", mine) : null;
    const b = broadcast.length ? await supabase.from("alert_reads").upsert(broadcast.map((id) => ({ alert_id: id, user_id: userId }))) : null;
    const error = a?.error ?? b?.error;
    if (error) { await load(); return error.message; }
    return null;
  }, [key, userId, load, edit]);

  // UNDO (2026-10-05): flags dismissed by mistake come back — un-acked on the row if they were mine
  // alone, my read taken back if they were broadcasts, a snooze lifted. On the screen at once, in the
  // order the inbox reads them; the read that follows is the truth.
  const putBack = useCallback((fs: MyFlag[]) => {
    const into = (cur: MyFlag[], add: MyFlag[]) => [...cur, ...add.filter((f) => !cur.some((x) => x.id === f.id))].sort((x, y) => y.created_at.localeCompare(x.created_at));
    // One someone else has goes back where it was listed — apart, and not counted (0383).
    edit((m) => ({ ...m, flags: into(m.flags, fs.filter((f) => !f.claim)), claimed: into(m.claimed, fs.filter((f) => f.claim)) }));
  }, [edit]);
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
    edit((m) => ({ ...m, flags: m.flags.filter((x) => x.id !== f.id), claimed: m.claimed.filter((x) => x.id !== f.id) }));
    if (!supabase || !userId) return null;
    const { error } = await supabase.from("alert_snoozes").upsert({ alert_id: f.id, user_id: userId, until: new Date(Date.now() + forMs).toISOString() });
    if (error) { await load(); return error.message; }
    return null;
  }, [userId, load, edit]);
  const unsnooze = useCallback(async (f: MyFlag): Promise<string | null> => {
    if (!supabase || !userId) return null;
    putBack([f]);
    const { error } = await supabase.from("alert_snoozes").delete().eq("user_id", userId).eq("alert_id", f.id);
    await load();
    return error?.message ?? null;
  }, [userId, load, putBack]);

  // Release the whole digest onto the glance now — "read them all" (acks every held item).
  const clearHeld = useCallback(async () => {
    const cur = key ? myAlerts.peek(key).held : [];
    edit((m) => ({ ...m, held: [] }));
    if (!supabase || !userId || !cur.length) return;
    const mine = cur.filter((f) => f.target_user_id === userId).map((f) => f.id);
    const broadcast = cur.filter((f) => f.target_user_id !== userId).map((f) => f.id);
    // Cleared only when the database has them cleared (R12b, F4): refused, they come back to the held list — they had
    // vanished here and stayed unread everywhere else, back on the next read with nothing said.
    const acked = mine.length ? await supabase.from("alerts").update({ ack_at: new Date().toISOString(), ack_by: userId }).in("id", mine) : { error: null };
    const read = broadcast.length ? await supabase.from("alert_reads").upsert(broadcast.map((id) => ({ alert_id: id, user_id: userId }))) : { error: null };
    if (acked.error || read.error) edit((m) => ({ ...m, held: cur }));
  }, [key, userId, edit]);

  const critCount = flags.filter((f) => f.severity === "critical").length;
  return { flags, held, claimed, quietActive, critCount, error, ack, clearAll, clearHeld, snooze, restore, unsnooze, reload: load };
}
