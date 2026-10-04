// CLOSING OUT — one write path for "it happened" (2026-10-03).
//
// Ryan opened Plan › Needs sorting, tapped the WineXpress stop, and the sheet told him:
//
//     Finished, with no after-action note.
//     Two lines on how it went, while you still remember.
//
// and offered nowhere to write them. The sentence describes a door. Measured, the door did not
// exist anywhere in the app: the only wrap flow is OwnerDetails inside the prep checklist, and it
// shows "Complete stop" only while the stop is NOT done, then shows the recap's "edit" button only
// when a recap already exists (`done && f.recap && …`). A stop that was closed without a note —
// which is every stop LiveControl closes on go-offline — had no way to get one, ever. The gap
// view's own detail text even said "The wrap flow writes one and works." It did, for the people
// who used it in the right order.
//
// Same for events: "Add what it took, or confirm it took nothing" — nothing in the console writes
// event_sales except the Square webhook, and nothing anywhere records "it took nothing".
//
// So the record sheets grow their ways out, and this file is the one place those writes live:
//
//   wrapOwner     it happened — stage/status done, completed_at, the live flag cleared, the note
//   saveRecap     the note alone, for something already done
//   archiveOwner  it did not happen, or it is the duplicate — off the active lists, record kept
//   addTakings    what it took, when Square did not see it (cash, a card reader, a tab)
//   tookNothing   it took nothing — said once, so the gap stops asking
//   setEventLive  the event's live flag, through the RPC that owns it (0024)
//
// Before this file the first of those was written in THREE shapes — OwnerDetails.complete,
// LiveControl.pause ("status done + archived", no completed_at) and the archive in EventsAdmin
// ("archived + is_live false", which OwnerDetails.archive forgot). One home now; the components
// call it. LiveControl.archiveStop keeps its own `status: "upcoming"` on purpose: it archives a
// LOCATION, and a restored location should come back upcoming, not done.
//
// The patch builders are pure so scripts/smoke.cjs can assert their shape without a database; the
// writers take the client so the same code runs in a component and under a fake in a test.

import type { SupabaseClient } from "@supabase/supabase-js";

export type OwnerKind = "event" | "stop";
export type WriteResult = { error: { message: string } | null };

export const ownerTable = (kind: OwnerKind): "events" | "stops" => (kind === "event" ? "events" : "stops");
/** The staff-only sibling the note lives on (0195). */
export const opsTable = (kind: OwnerKind): "event_ops" | "stop_ops" => (kind === "event" ? "event_ops" : "stop_ops");
export const opsKey = (kind: OwnerKind): "event_id" | "stop_id" => (kind === "event" ? "event_id" : "stop_id");

/**
 * Done. An event also drops its live flag here rather than trusting the trigger alone — a flag the
 * public site reads is not something to leave to a side effect. A stop has no such column.
 */
export function wrapPatch(kind: OwnerKind, now: string, alsoArchive = false): Record<string, string | boolean> {
  const p: Record<string, string | boolean> = kind === "event"
    ? { stage: "done", completed_at: now, is_live: false }
    : { status: "done", completed_at: now };
  if (alsoArchive) p.archived_at = now;
  return p;
}

/** Off the active lists, record kept. An archived event must not stay live either. */
export function archivePatch(kind: OwnerKind, now: string): Record<string, string | boolean> {
  return kind === "event" ? { archived_at: now, is_live: false } : { archived_at: now };
}

/** Trimmed; blank becomes null, so the gap view sees "no note" rather than a row of spaces. */
export const cleanRecap = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

const nowIso = () => new Date().toISOString();

export async function saveRecap(sb: SupabaseClient, a: { kind: OwnerKind; id: string; recap: string | null | undefined }): Promise<WriteResult> {
  const { error } = await sb.from(opsTable(a.kind))
    .upsert({ [opsKey(a.kind)]: a.id, recap: cleanRecap(a.recap) }, { onConflict: opsKey(a.kind) });
  return { error };
}

/**
 * Mark it done, stamp when, file the note. The status write goes first and a failure there stops
 * everything: a note filed against something that is still "upcoming" would be a recap the gap
 * list never asks for and nobody reads. `recap` undefined means "leave the note alone".
 */
export async function wrapOwner(sb: SupabaseClient, a: { kind: OwnerKind; id: string; recap?: string | null; archive?: boolean; now?: string }): Promise<WriteResult> {
  const now = a.now ?? nowIso();
  const { error } = await sb.from(ownerTable(a.kind)).update(wrapPatch(a.kind, now, !!a.archive)).eq("id", a.id);
  if (error) return { error };
  if (a.recap === undefined) return { error: null };
  return saveRecap(sb, { kind: a.kind, id: a.id, recap: a.recap });
}

export async function archiveOwner(sb: SupabaseClient, a: { kind: OwnerKind; id: string; now?: string }): Promise<WriteResult> {
  const { error } = await sb.from(ownerTable(a.kind)).update(archivePatch(a.kind, a.now ?? nowIso())).eq("id", a.id);
  return { error };
}

// ── what it took ────────────────────────────────────────────────────────────────────────────────
// event_sales is Square's mirror (0024): the webhook writes every completed payment there. A row
// from a person carries source 'manual' and no payment id, which is also the shape 0339's insert
// policy admits and nothing else — so a client cannot forge a Square row, and a manual row can
// never collide with a real one on the unique payment id.
export const MANUAL_SOURCE = "manual";

/** "$1,200.50" → 120050. Whole dollars and up to two decimals; anything else is refused by name. */
export function parseDollars(s: string | null | undefined): { cents: number } | { error: string } {
  const t = (s ?? "").replace(/[$,\s]/g, "");
  if (!t) return { error: "Enter what it took, in dollars." };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: "Dollars and cents only — like 184 or 184.50." };
  const cents = Math.round(Number(t) * 100);
  if (!Number.isFinite(cents) || cents > 100_000_000) return { error: "That is more than a truck takes in a day. Check the number." };
  return { cents };
}

/** Optional. "" → null; "12" → 12; anything that is not a whole count is refused. */
export function parseCount(s: string | null | undefined): { count: number | null } | { error: string } {
  const t = (s ?? "").trim();
  if (!t) return { count: null };
  if (!/^\d+$/.test(t)) return { error: "Items is a whole number." };
  return { count: Number(t) };
}

export function takingsRow(eventId: string, dollars: string, items?: string | null):
  { row: { event_id: string; source: string; amount_cents: number; item_count: number } } | { error: string } {
  const d = parseDollars(dollars);
  if ("error" in d) return d;
  const c = parseCount(items);
  if ("error" in c) return c;
  return { row: { event_id: eventId, source: MANUAL_SOURCE, amount_cents: d.cents, item_count: c.count ?? 0 } };
}

export async function addTakings(sb: SupabaseClient, a: { eventId: string; dollars: string; items?: string | null }): Promise<WriteResult> {
  const r = takingsRow(a.eventId, a.dollars, a.items);
  if ("error" in r) return { error: { message: r.error } };
  const { error } = await sb.from("event_sales").insert(r.row);
  return { error };
}

/** It took nothing — recorded on the ops sibling, so the no_sales gap stops asking (0339). */
export async function tookNothing(sb: SupabaseClient, eventId: string, now?: string): Promise<WriteResult> {
  const { error } = await sb.from("event_ops")
    .upsert({ event_id: eventId, took_nothing_at: now ?? nowIso() }, { onConflict: "event_id" });
  return { error };
}

/** The live flag, through the RPC that owns the one-live-at-a-time rule (0024). */
export async function setEventLive(sb: SupabaseClient, eventId: string, live: boolean): Promise<WriteResult> {
  const { error } = await sb.rpc("admin_set_event_live", { p_event: eventId, p_live: live });
  return { error };
}
