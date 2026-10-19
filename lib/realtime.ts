"use client";

import { useEffect } from "react";
import { supabase } from "./supabase";
import { coalesce } from "./rush";
import { useLatest } from "./useLatest";

// THE realtime-refetch hook. Nineteen files hand-rolled the same subscribe/refetch/cleanup effect
// (36 call sites), and ELEVEN of them independently reinvented the same module-level sequence
// counter to dodge the same Supabase gotcha: a channel NAME is a singleton per client — if two
// hook instances (or a StrictMode remount racing its own cleanup) reuse a name, the second
// .subscribe() throws "cannot add callbacks after subscribe". One shared counter here retires
// kdsChanSeq, goalsChanSeq, dropOpsChanSeq, drvSeq, and friends.
let chanSeq = 0;

// THE REFRESH (2026-10-05, the gesture round). Every loader handed to this hook is the answer to "read
// this again" — so the set of them, while their screens are mounted, IS the app's refresh, and nothing
// new has to be taught to forty panels. Two things pull it:
//  · pull to refresh (components/PullToRefresh), the iPhone gesture for "is this current?";
//  · coming back to the app after RESUME_MS away. A phone puts a backgrounded app's socket to sleep, and
//    Supabase's realtime replays nothing on reconnect — so a list could sit stale, saying nothing, until
//    some other change happened to wake its loader. Calling a loader again is always safe: realtime
//    already calls it whenever anyone changes its table.
// ONE CATCH-UP READ, NOT TWO (R38 — the fresh audit's PERF11-13). When the signal came back, every screen read twice in a
// second or two: once as the refresh ran on "online", and again as its channel rejoined — beside the offline queue's
// replay, the traffic that matters most then. A screen whose channel is down now waits for the rejoin, which reads once
// the channel listens again (nothing between the two is lost), and the rejoin's read goes through the screen's own
// coalescer with any change that lands with it. A pull to refresh still reads every screen at once.
/** A screen's read as the refresh holds it, and whether its channel is down — rejoining, when it will read itself. */
type Loader = { current: () => void; rejoining: boolean };
const loaders = new Set<Loader>();
const RESUME_MS = 30_000;
let resumeOn = false;

/** How long a refresh leaves a down channel's screen to its rejoin: one still down then isn't coming back soon (Realtime
 *  itself down, say), and its screen reads anyway — never left as it was. */
export const REJOIN_WAIT_MS = 5_000;

/** Read every live screen's data again — `skipRejoining`: those whose channel is down read as it rejoins, or after
 *  REJOIN_WAIT_MS if it hasn't. Resolves when every loader read now that answers with a promise has. */
export function refreshLive(opts: { skipRejoining?: boolean } = {}): Promise<void> {
  const now: Loader[] = [];
  for (const l of loaders) {
    if (!(opts.skipRejoining && l.rejoining)) { now.push(l); continue; }
    setTimeout(() => { if (l.rejoining && loaders.has(l)) void Promise.resolve().then(() => l.current()); }, REJOIN_WAIT_MS);
  }
  return Promise.allSettled(now.map((l) => Promise.resolve().then(() => l.current()))).then(() => undefined);
}

function watchResume() {
  if (resumeOn || typeof document === "undefined") return;
  resumeOn = true;
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt >= RESUME_MS) void refreshLive({ skipRejoining: true });
    hiddenAt = 0;
  });
  // THE SIGNAL CAME BACK (R11, 2026-10-16 — the 10/10 audit). A screen that never goes hidden — the Pass under its wake
  // lock, the TV board — missed everything said while its connection was down, and nothing read it again.
  if (typeof window !== "undefined") window.addEventListener("online", () => { void refreshLive({ skipRejoining: true }); });
}


/** A table to hear. `filter`: Realtime's own (a column's value on the row as it now stands). `when` (R38 — PERF11): the
 *  change's row — as it now stands, or the deleted row's key — asked whether this screen shows it at all, for what a filter
 *  can't say: an order leaving the history (done → ready) is one whose new row a filter on "done" never hears. */
export type Change = { table: string; filter?: string; when?: (row: Record<string, unknown>) => boolean };
export type Tables = string | Change | (string | Change)[];

/** The row a change is about: the new row, or — a delete — the old one's key. Pure. */
export function changedRow(p: { new?: unknown; old?: unknown }): Record<string, unknown> {
  const n = p.new && typeof p.new === "object" ? (p.new as Record<string, unknown>) : null;
  if (n && Object.keys(n).length) return n;
  return p.old && typeof p.old === "object" ? (p.old as Record<string, unknown>) : {};
}

/** THE CHANNEL ITSELF, OUTSIDE ANY ONE SCREEN (R13 — the 10/10 audit's performance pass, F5). Watch these tables and run
 *  `read` once for a burst of changes (lib/rush), once after the channel comes back from a drop, on pull to refresh, and on
 *  a return to the app after RESUME_MS. Answers the stop. useRealtimeTable below is this, for one screen; lib/shared's
 *  stores are this, for every screen that shows the same thing. */
export function watchTables(tables: Tables, read: { current: () => void }): () => void {
  if (!supabase) return () => {};
  const sb = supabase;
  watchResume();
  const entry: Loader = { current: () => read.current(), rejoining: false };
  loaders.add(entry);
  const list: Change[] = (Array.isArray(tables) ? tables : [tables]).map((t) => (typeof t === "string" ? { table: t } : t));
  const rush = coalesce(() => read.current());
  let ch = sb.channel(`rt-${list.map((t) => t.table).join("-")}-${++chanSeq}`);
  for (const t of list) {
    const when = t.when;
    ch = ch.on("postgres_changes", { event: "*", schema: "public", table: t.table, ...(t.filter ? { filter: t.filter } : {}) },
      (p) => { if (!when || when(changedRow(p))) rush.poke(); });
  }
  // CAUGHT UP AFTER A DROP (R11). Supabase rejoins a dropped channel by itself and replays nothing, so a list stayed as it
  // was before the drop, saying nothing, until some later change woke it (the Pass's own board already read again here —
  // components/pass/usePassBoard). Every screen does now: a rejoin after a break reads once.
  // The rejoin's read goes through the coalescer (R38, above), and the refresh leaves a rejoining screen to it.
  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") { if (entry.rejoining) { entry.rejoining = false; rush.poke(); } }
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") entry.rejoining = true;
  });
  return () => { rush.cancel(); loaders.delete(entry); void sb.removeChannel(ch); };
}

// Subscribe to postgres changes on one or more tables and run `onChange` on any hit (plus once on
// mount, so callers can pass their `load` directly and drop their separate initial-load effect if
// they want — passing loadOnMount:false keeps it notification-only).
export function useRealtimeTable(
  tables: Tables,
  onChange: () => void,
  opts: { enabled?: boolean; loadOnMount?: boolean } = {},
) {
  const { enabled = true, loadOnMount = false } = opts;
  // Latest-callback ref: callers pass inline closures; re-subscribing on every render identity
  // change would churn websocket channels for nothing.
  const cb = useLatest(onChange);
  const key = JSON.stringify(tables);

  useEffect(() => {
    if (!enabled || !supabase) return;
    if (loadOnMount) cb.current();
    return watchTables(tables, cb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}
