// WHICH DAY "THIS DROP" IS — one answer (2026-10-09, One home). The truck's next scheduled stop,
// falling back to the Saturday cadence when the route is empty: the rule the pickup board (DropOps)
// and the reserve flow already used. The home's next-drop number reads it here, and the pickup board
// moved onto it, so the two cannot name different days.
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextDrop, dropDateKey } from "./orderAhead";

export type DropDay = { iso: string; at: Date; fromStop: boolean };

/** The next drop's day. A failed stops read falls back to the Saturday rule and says so in `error`. */
export async function nextDropDay(sb: SupabaseClient, now: Date = new Date()): Promise<DropDay & { error: string | null }> {
  const sat = nextDrop(now).sat;
  const { data, error } = await sb.from("stops").select("starts_at").is("archived_at", null).neq("status", "done").not("starts_at", "is", null)
    .gte("starts_at", now.toISOString()).order("starts_at", { ascending: true }).limit(1).maybeSingle();
  const at = (data as { starts_at?: string | null } | null)?.starts_at;
  if (at) { const d = new Date(at); return { iso: dropDateKey(d), at: d, fromStop: true, error: null }; }
  return { iso: dropDateKey(sat), at: sat, fromStop: false, error: error?.message ?? null };
}
