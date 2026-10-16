"use client";

import { useCallback, useSyncExternalStore } from "react";
import { watchTables, type Tables } from "./realtime";
import { createStore, type StoreEnv, type StoreSpec } from "./sharedCore";

// lib/sharedCore wired to React (useSyncExternalStore) and to lib/realtime (the channel, pull to refresh, the return to the
// app, the rejoin after a drop). R13 — the 10/10 audit's performance pass, F5 and F15: lib/sharedCore says why.

const env: StoreEnv = {
  timers: {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    every: (fn, ms) => setInterval(fn, ms),
    stop: (t) => clearInterval(t as ReturnType<typeof setInterval>),
  },
  visible: () => typeof document === "undefined" || document.visibilityState === "visible",
  onReturn: (fn) => {
    if (typeof window === "undefined") return () => {};
    const onVis = () => { if (document.visibilityState === "visible") fn(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", fn);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", fn); };
  },
};

const personal: { forget: () => void }[] = [];

export type Shared<T> = {
  /** What the store holds for `key` (null: nothing to read — `initial`), kept current while the screen is up. */
  use: (key: string | null) => T;
  reload: (key: string) => Promise<void>;
  change: (key: string, next: (cur: T) => T) => void;
  peek: (key: string) => T;
};

export function sharedStore<T>(spec: Omit<StoreSpec<T>, "watch"> & { tables: (key: string) => Tables }): Shared<T> {
  const { tables, ...rest } = spec;
  const store = createStore<T>({ ...rest, watch: (key, run) => watchTables(tables(key), { current: run }) }, env);
  if (spec.personal) personal.push(store);
  const initial = () => spec.initial;
  return {
    use(key) {
      const subscribe = useCallback((l: () => void) => (key == null ? () => {} : store.subscribe(key, l)), [key]);
      const snapshot = useCallback(() => (key == null ? spec.initial : store.peek(key)), [key]);
      return useSyncExternalStore(subscribe, snapshot, initial);
    },
    reload: store.reload,
    change: store.change,
    peek: store.peek,
  };
}

/** A sign-out: every store that holds a person's things forgets them at once (components/AuthProvider). */
export function forgetPersonal(): void {
  for (const s of personal) s.forget();
}
