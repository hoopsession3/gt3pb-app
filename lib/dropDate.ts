// WHICH DAY "THIS DROP" IS — one answer (2026-10-09, One home). The pickup board (DropOps) and the home's
// next-drop number both read it here, so the two cannot name different days.
// IT HOLDS ITS DAY (2026-10-11): today's stop for the whole of its ET day, until it is marked done; else the
// truck's next scheduled stop; else this week's Saturday. It asked for the next stop starting after NOW, so the
// minute a drop's stop began the board turned to the following one: opened at 11:05 for an 11:00 drop it showed
// next week's list, and the day's reservations sat under "Past drops" as no-shows with nothing to tap. With the
// route empty it used the ordering rule (orderAhead nextDrop), which moves on to next Saturday at Wednesday's
// cutoff while this Saturday's packs are still to brew and hand out. Ordering asks a different question, the next
// drop still open to order (orderAhead dropForStop and nextDrop, /api/reserve), and keeps its own rule.
// scripts/dropday.test.mjs holds the board to this.
import type { SupabaseClient } from "@supabase/supabase-js";
import { dropDateKey } from "./orderAhead";
import { etDayKey } from "./dates";
import { etDayStart } from "./etDay";

export type DropDay = { iso: string; at: Date; fromStop: boolean };

/** This week's Saturday, today included: the drop the board works when the route is empty. Anchored at local
 *  noon like nextDrop, so its ET key is the same calendar day on any US device. */
export function boardSaturday(now: Date = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return d;
}

/** The drop being worked. A failed stops read falls back to the Saturday rule and says so in `error`. */
export async function nextDropDay(sb: SupabaseClient, now: Date = new Date()): Promise<DropDay & { error: string | null }> {
  const sat = boardSaturday(now);
  const { data, error } = await sb.from("stops").select("starts_at").is("archived_at", null).neq("status", "done").not("starts_at", "is", null)
    .gte("starts_at", etDayStart(etDayKey(now)).toISOString()).order("starts_at", { ascending: true }).limit(1).maybeSingle();
  const at = (data as { starts_at?: string | null } | null)?.starts_at;
  if (at) { const d = new Date(at); return { iso: dropDateKey(d), at: d, fromStop: true, error: null }; }
  return { iso: dropDateKey(sat), at: sat, fromStop: false, error: error?.message ?? null };
}
