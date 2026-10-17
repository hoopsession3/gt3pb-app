"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { reportFailure } from "./failureReport";
import { useLatest } from "./useLatest";

// THE fetch-state hook (Wave 2, 2026-07-15). An audit found 59 sites across 41 files where a failed
// fetch renders identically to genuine emptiness — "no reservations," "$0 revenue," "you're all
// caught up" on a request that actually errored. Four files independently reinvented the same
// error-swallowing `safe()` wrapper trying to guard against it; none of them checked `.error`.
// This is the one shared implementation, pairs with useRealtimeTable (lib/realtime.ts) for the
// refetch-on-change half of the same problem: `const { reload } = useAsyncData(...); useRealtimeTable(t, reload)`.
export type AsyncStatus = "loading" | "error" | "ready";
export type AsyncData<T> = { status: AsyncStatus; data: T | null; error: Error | null; reload: () => Promise<void>; refreshing: boolean };

/** The same deps, as React compares an effect's: the same length, each Object.is the last. Pure. */
export function sameDeps(a: React.DependencyList, b: React.DependencyList): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

type Settled<T> = { depsGen: number; reloadGen: number; ok: boolean; data: T | null; error: Error | null };

/** What the screen shows, read off what was asked for and what has answered (R17). Pure (scripts/r17.test.mjs). */
export function shownFrom<T>(settled: Settled<T> | null, depsGen: number, reloadGen: number): { status: AsyncStatus; data: T | null; error: Error | null; refreshing: boolean } {
  const data = settled?.data ?? null;
  if (settled !== null && settled.depsGen === depsGen && settled.reloadGen === reloadGen) {
    return { status: settled.ok || data !== null ? "ready" : "error", data, error: settled.error, refreshing: false };
  }
  // A load is out. Stale-while-revalidate: only a genuine first load (nothing to show yet) is "loading" — a reload with
  // data on screen keeps showing it and says `refreshing`. Unconditionally blanking on every reload flashed the whole
  // section to a bare "Loading…" on every save (losing scroll position and any in-progress edit in a sibling row).
  return { status: data !== null ? "ready" : "loading", data, error: null, refreshing: data !== null };
}

export function useAsyncData<T>(loader: () => Promise<T>, deps: React.DependencyList = []): AsyncData<T> {
  const loaderRef = useLatest(loader);

  // WHAT IS ASKED FOR, KEPT AS STATE (R17, 2026-10-17 — the lint ceiling's set-state-in-effect). A load starts when the
  // deps change or reload() is called, and the effect that starts it set "loading" or "refreshing" first — a second
  // render for every load, right after the first. Now each ask is a number: the deps' (moved while rendering, the way
  // React adjusts state when a prop changes) and reload()'s (moved by the call). The answer is kept with the numbers it
  // answers, and loading, refreshing and the error are read off the two while rendering (shownFrom). The effect only
  // starts the load; its answer is set when it comes.
  const [seenDeps, setSeenDeps] = useState<React.DependencyList>(deps);
  const [depsGen, setDepsGen] = useState(0);
  if (!sameDeps(seenDeps, deps)) { setSeenDeps(deps); setDepsGen((g) => g + 1); }
  const [reloadGen, setReloadGen] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  // reload() answers when its load has: the callers that await it (a save, then the toast) wait for the read it asked
  // for. The numbers handed out, and who is waiting on which — refs, written only by reload() and by an answer.
  const asked = useRef(0);
  const waiting = useRef<{ gen: number; done: () => void }[]>([]);

  useEffect(() => {
    // Race guard: a slow, superseded load (deps changed mid-flight, or reload() fired twice) must never overwrite a
    // newer one with stale data — the effect's cleanup marks it dead before the next one starts.
    let live = true;
    const answered = () => {
      waiting.current = waiting.current.filter((w) => { if (w.gen > reloadGen) return true; w.done(); return false; });
    };
    // A load overtaken by a newer one draws nothing, but whoever awaits it is still let go when it answers — as the load's
    // own promise was, before R17: under a stream of reloads the newest is always still out, and a save waiting for it
    // would never say "saved" (the R17 review).
    loaderRef.current().then(
      (data) => {
        if (live) setSettled({ depsGen, reloadGen, ok: true, data, error: null });
        answered();
      },
      (err) => {
        if (live) {
          // A read the database refused for a reason that is ours — a column, a grant, a view — is reported, not only drawn
          // as "couldn't load" (R13 — the 10/10 audit, F17, lib/failureReport). A lost signal and a person's refusal are not.
          reportFailure("load", err as { code?: string; message?: string });
          const error = err instanceof Error ? err : new Error(String(err));
          // A transient refetch error with data already on screen keeps it — "error" only when there is nothing to fall
          // back to (shownFrom). `error` is still set either way, for a caller that wants to show a toast.
          setSettled((was) => ({ depsGen, reloadGen, ok: false, data: was?.data ?? null, error }));
        }
        answered();
      },
    );
    return () => { live = false; };
  }, [depsGen, reloadGen, loaderRef]);

  // Gone before an answer came: whoever awaits a reload is let go, as the load's own promise always settled.
  useEffect(() => () => { for (const w of waiting.current) w.done(); waiting.current = []; }, []);

  // A stable identity: it is exposed as `reload` and plenty of callers pass it to useRealtimeTable or to effects.
  const reload = useCallback(() => new Promise<void>((done) => {
    const gen = ++asked.current;
    waiting.current.push({ gen, done });
    setReloadGen(gen);
  }), []);

  return { ...shownFrom(settled, depsGen, reloadGen), reload };
}
