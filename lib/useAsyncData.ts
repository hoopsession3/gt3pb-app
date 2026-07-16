"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// THE fetch-state hook (Wave 2, 2026-07-15). An audit found 59 sites across 41 files where a failed
// fetch renders identically to genuine emptiness — "no reservations," "$0 revenue," "you're all
// caught up" on a request that actually errored. Four files independently reinvented the same
// error-swallowing `safe()` wrapper trying to guard against it; none of them checked `.error`.
// This is the one shared implementation, pairs with useRealtimeTable (lib/realtime.ts) for the
// refetch-on-change half of the same problem: `const { reload } = useAsyncData(...); useRealtimeTable(t, reload)`.
export type AsyncStatus = "loading" | "error" | "ready";
export type AsyncData<T> = { status: AsyncStatus; data: T | null; error: Error | null; reload: () => Promise<void>; refreshing: boolean };

export function useAsyncData<T>(loader: () => Promise<T>, deps: React.DependencyList = []): AsyncData<T> {
  const [status, setStatus] = useState<AsyncStatus>("loading");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Race guard: a slow, superseded load (deps changed mid-flight, or reload() fired twice) must
  // never overwrite a newer one with stale data — this is the exact bug the ad-hoc safe() wrappers
  // never covered, since they only checked truthiness, not which request was still current.
  const gen = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  // Mirrors `data` for run()'s closure without needing `data` in its deps (run must stay a stable
  // identity — it's exposed as `reload` and plenty of callers pass it to useRealtimeTable/effects).
  const dataRef = useRef<T | null>(null);

  const run = useCallback(() => {
    const myGen = ++gen.current;
    // Stale-while-revalidate: only blank the UI to the full "loading" state on a genuine first load
    // (no data yet). A reload() with existing data — after a save, a realtime nudge, a dep change —
    // keeps rendering what's there and just flags `refreshing`. Unconditionally re-loading on every
    // mutation was flashing the whole section to a bare "Loading…" on every save (losing scroll
    // position and any in-progress edit in a sibling row) — worse than briefly showing stale data.
    if (dataRef.current === null) setStatus("loading"); else setRefreshing(true);
    setError(null);
    return loaderRef
      .current()
      .then((result) => {
        if (gen.current !== myGen) return; // superseded — drop it
        dataRef.current = result;
        setData(result);
        setStatus("ready");
        setRefreshing(false);
      })
      .catch((err) => {
        if (gen.current !== myGen) return;
        setRefreshing(false);
        setError(err instanceof Error ? err : new Error(String(err)));
        // Same principle for failures: a transient refetch error with data already on screen
        // shouldn't nuke it to a hard error card — only surface "error" when there's nothing to
        // fall back to. `error` is still set either way, for a caller that wants to show a toast.
        if (dataRef.current === null) setStatus("error");
      });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, deps);

  return { status, data, error, reload: run, refreshing };
}
