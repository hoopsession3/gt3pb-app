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
    if (loadOnMount) cb.current();
    const list: Change[] = (Array.isArray(tables) ? tables : [tables]).map((t) => (typeof t === "string" ? { table: t } : t));
    let ch = supabase.channel(`rt-${list.map((t) => t.table).join("-")}-${++chanSeq}`);
    for (const t of list) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table: t.table, ...(t.filter ? { filter: t.filter } : {}) }, () => cb.current());
    }
    ch.subscribe();
    return () => { supabase?.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}
