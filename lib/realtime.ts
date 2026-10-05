"use client";

import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

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
const loaders = new Set<{ current: () => void }>();
const RESUME_MS = 30_000;
let resumeOn = false;

/** Read every live screen's data again. Resolves when every loader that answers with a promise has. */
export function refreshLive(): Promise<void> {
  return Promise.allSettled([...loaders].map((l) => Promise.resolve().then(() => l.current()))).then(() => undefined);
}

function watchResume() {
  if (resumeOn || typeof document === "undefined") return;
  resumeOn = true;
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt >= RESUME_MS) void refreshLive();
    hiddenAt = 0;
  });
}

type Change = { table: string; filter?: string };

// Subscribe to postgres changes on one or more tables and run `onChange` on any hit (plus once on
// mount, so callers can pass their `load` directly and drop their separate initial-load effect if
// they want — passing loadOnMount:false keeps it notification-only).
export function useRealtimeTable(
  tables: string | Change | (string | Change)[],
  onChange: () => void,
  opts: { enabled?: boolean; loadOnMount?: boolean } = {},
) {
  const { enabled = true, loadOnMount = false } = opts;
  // Latest-callback ref: callers pass inline closures; re-subscribing on every render identity
  // change would churn websocket channels for nothing.
  const cb = useRef(onChange); cb.current = onChange;
  const key = JSON.stringify(tables);

  useEffect(() => {
    if (!enabled || !supabase) return;
    watchResume();
    loaders.add(cb);
    if (loadOnMount) cb.current();
    const list: Change[] = (Array.isArray(tables) ? tables : [tables]).map((t) => (typeof t === "string" ? { table: t } : t));
    let ch = supabase.channel(`rt-${list.map((t) => t.table).join("-")}-${++chanSeq}`);
    for (const t of list) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table: t.table, ...(t.filter ? { filter: t.filter } : {}) }, () => cb.current());
    }
    ch.subscribe();
    return () => { loaders.delete(cb); supabase?.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}
