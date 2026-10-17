// JUST ENOUGH REACT TO RUN A HOOK AS A COMPONENT DOES (R17, 2026-10-17).
//
// The hooks under test are compiled from their TypeScript (scripts/fixtures/moneyWorld routeLoader) with `react` answered
// by `React` here. A module binds `react` once, so — as React's own dispatcher does — each call goes to whichever host is
// rendering. What it keeps of React's rules, because the hooks under test lean on them:
//   · state is kept per call site, in call order; outside a render, a setter given the same value (Object.is) is no
//     update; a function handed to useState or a setter is called (a lazy first value, an updater), never kept;
//   · a setState DURING render (React's "adjust state when a prop changes") throws that render away and renders again
//     before anything commits — effects included — even when it sets the value already there, as React does (a render-
//     phase update is queued before any comparison), so a hook that sets state on every render never settles here either;
//   · a commit runs insertion effects, then layout effects, then passive effects, each only when a dep changed (or on
//     every commit with no deps), its last cleanup first;
//   · a setState from outside a render (an effect, a promise, a timer) renders again on the next microtask;
//   · useSyncExternalStore subscribes once and re-renders when the store says so; the client snapshot is read.
// It counts commits, so a test can say how many renders a change cost.
let rendering = null;
const call = (name) => (...a) => {
  if (!rendering) throw new Error(`hookHost: ${name} called outside a render`);
  return rendering[name](...a);
};
export const React = {
  useState: call("useState"), useRef: call("useRef"), useEffect: call("useEffect"), useLayoutEffect: call("useLayoutEffect"),
  useInsertionEffect: call("useInsertionEffect"), useCallback: call("useCallback"), useMemo: call("useMemo"),
  useSyncExternalStore: call("useSyncExternalStore"),
};

const changed = (was, deps) => !was || !deps || !was.deps || deps.length !== was.deps.length || deps.some((d, j) => !Object.is(d, was.deps[j]));

export function hookHost() {
  const slots = [];
  let i = 0, hook = null, args = [], inRender = false, renderDirty = false, dirty = false, scheduled = false, gone = false;
  let queued = { insertion: [], layout: [], passive: [] };
  const host = { commits: 0, renders: 0, value: undefined };
  const schedule = () => {
    if (scheduled || gone) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (dirty && !gone) { dirty = false; render(); } });
  };
  const self = {
    useState(init) {
      const k = i++;
      if (!slots[k]) slots[k] = { v: typeof init === "function" ? init() : init };
      const s = slots[k];
      s.set ??= (nv) => {
        const v = typeof nv === "function" ? nv(s.v) : nv;
        if (inRender) { s.v = v; renderDirty = true; return; }   // React queues a render-phase update unconditionally
        if (Object.is(v, s.v)) return;
        s.v = v;
        dirty = true; schedule();
      };
      return [s.v, s.set];
    },
    useRef(init) { const k = i++; if (!slots[k]) slots[k] = { current: init }; return slots[k]; },
    useCallback(fn, deps) { const k = i++; if (changed(slots[k], deps)) slots[k] = { deps, v: fn }; return slots[k].v; },
    useMemo(fn, deps) { const k = i++; if (changed(slots[k], deps)) slots[k] = { deps, v: fn() }; return slots[k].v; },
    useEffect(effect, deps) { const k = i++; if (changed(slots[k], deps)) queued.passive.push({ k, effect, deps }); },
    useLayoutEffect(effect, deps) { const k = i++; if (changed(slots[k], deps)) queued.layout.push({ k, effect, deps }); },
    useInsertionEffect(effect, deps) { const k = i++; if (changed(slots[k], deps)) queued.insertion.push({ k, effect, deps }); },
    useSyncExternalStore(subscribe, snapshot) {
      const k = i++;
      if (!slots[k]) slots[k] = { unsub: subscribe(() => { dirty = true; schedule(); }) };
      return snapshot();
    },
  };
  const render = () => {
    for (let pass = 0; ; pass++) {
      if (pass > 25) throw new Error("hookHost: more than 25 renders in a row — a setState during render that never settles");
      i = 0; renderDirty = false;
      queued = { insertion: [], layout: [], passive: [] };
      rendering = self; inRender = true;
      try { host.value = hook(...args); host.renders++; } finally { rendering = null; inRender = false; }
      if (!renderDirty) break;   // a setState during render: this render is thrown away and done again
    }
    host.commits++;
    for (const kind of ["insertion", "layout", "passive"]) {
      for (const q of queued[kind]) {
        slots[q.k]?.cleanup?.();
        const c = q.effect();
        slots[q.k] = { deps: q.deps, cleanup: typeof c === "function" ? c : null };
      }
    }
  };
  host.mount = (h, ...a) => { hook = h; args = a; render(); return host; };
  host.update = (...a) => { args = a; render(); return host; };
  host.unmount = () => { gone = true; for (const s of slots) { s?.cleanup?.(); s?.unsub?.(); } };
  return host;
}

/** Let promises and the host's scheduled renders run. */
export const settle = async (n = 8) => { for (let k = 0; k < n; k++) await new Promise((r) => setImmediate(r)); };

/** A promise the test resolves or rejects by hand. */
export function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
