// THE SERVICE SCHEDULE — when a piece of gear is next due, and the one write for "done" (2026-10-04).
//
// Ryan's My Day at 10:40 PM: four pieces of equipment on Needs you — the nitro tap 94 days late, the
// Cold Brew Avenue vessel, the Timemore grinder and the Toddy 71 each — every one "clean last done
// Jun 25". The cleaning is not three months behind; the LOGGING is. Saying "it is done" took eight
// steps: Assets, find the asset, open it, "+ Log maintenance", pick the kind, type what was done, type
// the next date by hand, save. Nobody does that weekly, so the schedule rotted and the list filled with
// a number nobody believes.
//
// And when somebody did, it could not stick. Two rules disagreed about which entry sets "next due":
//   · v_obligations (0320/0330): the most recent entry that set a date — distinct on (asset_id) …
//     where next_due_on is not null order by performed_on desc, created_at desc;
//   · the Assets panel: the EARLIEST next date across every entry the asset ever had — so once any
//     old entry's date had passed, the asset read DUE forever, whatever was logged after it.
// And the log sheet left "next due" blank by default; an entry with no date does not govern, so the
// old overdue entry kept governing and the row on My Day never moved.
//
// So, one home:
//   governing()   the entry whose next date counts — the view's rule, written once for the client;
//   cadenceDays() the gap that entry set (Jun 25 → Jul 2 is a weekly clean) — the rhythm "done" keeps;
//   donePatch()   the entry "done on this day" writes: same asset, same job, same steps, and the next
//                 date the same distance ahead;
//   logDone()     reads the entry Needs-you named and writes that patch — one tap, from My Day or Assets.
//
// The rules are pure so scripts/smoke.cjs can hold them without a database; the writer takes the
// client, like lib/wrap's, so the same code runs in a component and under a fake.

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, dayFromKey } from "./dates";

export type ServiceEntry = {
  id?: string;
  asset_id: string;
  kind: string;
  performed_on: string;
  next_due_on: string | null;
  summary?: string | null;
  how_to?: string | null;
  created_at?: string | null;
};

/** The entry whose next_due_on governs an asset: the most recent one that set a date. */
export function governing<T extends ServiceEntry>(entries: readonly T[]): T | null {
  let best: T | null = null;
  for (const e of entries) {
    if (!e.next_due_on) continue;
    if (!best || e.performed_on > best.performed_on
        || (e.performed_on === best.performed_on && (e.created_at ?? "") > (best.created_at ?? ""))) best = e;
  }
  return best;
}

/** The days between doing it and its next date — the rhythm a "done" keeps. null when it set none. */
export function cadenceDays(e: Pick<ServiceEntry, "performed_on" | "next_due_on">): number | null {
  if (!e.next_due_on) return null;
  const d = Math.round((dayFromKey(e.next_due_on).getTime() - dayFromKey(e.performed_on).getTime()) / 864e5);
  return d > 0 ? d : null;
}

export type DoneRow = {
  asset_id: string; kind: string; performed_on: string; summary: string; how_to: string | null;
  next_due_on: string | null; performed_by: string | null; created_by: string | null;
};

/** What "done on `doneOn`" writes. The summary and steps carry over — it is the same job again. */
export function donePatch(prev: ServiceEntry, doneOn: string, by: { userId: string | null; name: string | null }): DoneRow {
  const gap = cadenceDays(prev);
  return {
    asset_id: prev.asset_id,
    kind: prev.kind,
    performed_on: doneOn,
    summary: prev.summary?.trim() || `${prev.kind.charAt(0).toUpperCase()}${prev.kind.slice(1)}`,
    how_to: prev.how_to ?? null,
    next_due_on: gap ? addDays(doneOn, gap) : null,
    performed_by: by.name?.trim() || null,
    created_by: by.userId,
  };
}

export type DoneResult =
  | { error: string }
  | { error: null; already: boolean; kind: string; next_due_on: string | null };

/**
 * Done today, from the entry Needs-you names (v_obligations' subject_id is the governing entry).
 * Refuses — with words the screen can show — when the entry is gone or never set a rhythm to keep.
 * If the same job on the same asset is already logged for that day (another phone, a double tap),
 * nothing is written twice: the answer is "already done".
 */
export async function logDone(
  sb: SupabaseClient,
  entryId: string,
  doneOn: string,
  by: { userId: string | null; name: string | null },
): Promise<DoneResult> {
  const prev = await sb.from("asset_maintenance")
    .select("id, asset_id, kind, performed_on, summary, how_to, next_due_on, created_at").eq("id", entryId).maybeSingle();
  if (prev.error) return { error: prev.error.message };
  const p = prev.data as ServiceEntry | null;
  if (!p) return { error: "That service record is gone — open Assets to log it." };
  if (cadenceDays(p) == null) return { error: "It has no rhythm to keep — log it in Assets with its next date." };
  const dup = await sb.from("asset_maintenance").select("id")
    .eq("asset_id", p.asset_id).eq("kind", p.kind).gte("performed_on", doneOn).limit(1);
  if (dup.error) return { error: dup.error.message };
  const row = donePatch(p, doneOn, by);
  if ((dup.data as unknown[] | null)?.length) return { error: null, already: true, kind: row.kind, next_due_on: null };
  const ins = await sb.from("asset_maintenance").insert(row);
  if (ins.error) return { error: ins.error.message };
  return { error: null, already: false, kind: row.kind, next_due_on: row.next_due_on };
}
