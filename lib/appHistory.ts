// THE APP'S HISTORY — what Back closes first, and where it goes (2026-10-08, the navigation round:
// redesigns 2 and 3, approved by Ryan).
//
// BACK CLOSES THE STEP YOU ARE IN. On Android, and in every browser, Back used to leave the page from under
// an open sheet: the sheet went with the page, and whatever was typed in it. An iPhone sheet is a step you
// back out of, and so is a view a screen opens inside itself (an Academy lesson). Each is a STEP here
// (step()): while any is open, the history holds one entry of theirs at the same address, and Back takes
// that entry away — the step on top closes through its own door (a held sheet stays put, a form with
// typed changes asks first), and the screen stays. With more steps open, the next Back closes the next.
//
// A STEP'S ENTRY GOES WHEN THE STEP DOES. A step ended any other way — the X, a tap outside, the pull,
// Save — leaves its entry behind; GRACE later, if nothing has used it, it is taken back with a step of the
// history, and nothing else on the page hears that step: it is stopped here, before the router, the crew's
// section history, the tabs' places and the record sheet's address. A move in that time ("Add to order"
// closing the drink and opening the checkout, a row in More opening a section) takes the entry's place
// instead of stacking after it — a push becomes a replace — so the history reads as if the step had never
// had one. A move asked for while the entry is being taken back waits for it (a few milliseconds), so it
// is never undone by it. Not in the iPhone app: it has no Back button, and a sheet's pull, its X and the
// bar's ‹ are its ways out.
//
// WHERE BACK GOES, BY NAME. Every entry carries its place in this tab's history (gt3n), and the trail keeps
// the address each place showed, so the title bar's ‹ can say where Back goes ("‹ Menu") and knows when
// nothing came before this screen in the visit.
//
// The house rules this keeps: an entry is only ever added after the person has used the page (Chrome's
// Back skips the entries a page adds before that, and would skip the screen with them); Next's own state
// rides in every entry this adds (its router reloads the page on an entry without it); and this listens
// for popstate first — at the window, in the capture phase, from the moment the module loads, before the
// router's own listener exists.
//
// createAppHistory() is the whole of it, over an environment it is handed, so scripts/smoke.cjs drives it
// with a stand-in history; appHistory() is the browser's one.

import { isNativeApp } from "./native";

type Data = Record<string, unknown>;
type Call = (data: unknown, unused: string, url?: string | URL | null) => void;
type Pop = { state: unknown; stopImmediatePropagation(): void };

export type HistoryEnv = {
  /** window.history — its pushState and replaceState are wrapped where they stand. */
  history: { readonly state: unknown; pushState: Call; replaceState: Call; back(): void };
  /** The browser's own pushState and replaceState, under every wrapper (History.prototype's). */
  native: { push: Call; replace: Call };
  href(): string;
  /** pathname + search: what the trail keeps. */
  path(): string;
  /** popstate, heard before anyone else. */
  listen(fn: (e: Pop) => void): void;
  /** The person has used the page (sticky user activation). */
  activated(): boolean;
  later(fn: () => void, ms: number): unknown;
  cancel(t: unknown): void;
  /** Steps take an entry of their own: false in the iPhone app. */
  entries: boolean;
  /** Where the trail outlives a reload (sessionStorage). */
  store?: { get(): string | null; set(v: string): void };
  /** The page this one was loaded from, when it is this site's (document.referrer's path and query). */
  referrer?(): string | null;
  /** How many entries this tab's history holds (history.length). */
  depth?(): number;
};

/** A sheet or a screen's own sub-view. `back` is its door for Back: true when it is leaving. */
export type Step = { back: () => boolean; label?: string };

export type AppHistory = {
  /** A step begins; call what this returns when it ends, however it ends. */
  step(s: Step): () => void;
  /** Back, as the bar's ‹ and the edge swipe ask for it: the top step's door, or the history's. */
  back(): void;
  /** The newest step that names where its Back goes ("Academy"), or null. */
  stepLabel(): string | null;
  /** The address of the screen before this one in this visit, or null. */
  previous(): string | null;
  /** The screen has changed since this page loaded (a Back label may appear without moving anything). */
  moved(): boolean;
  subscribe(fn: () => void): () => void;
  version(): number;
};

/** How long a closed step's entry waits for a move to take its place before it is taken back. */
export const GRACE = 250;
/** How long to wait for the step of the history that takes an entry back. */
export const SAFETY = 600;

type Entry = { token: string; url: string; live: boolean; kept: boolean };

export function createAppHistory(env: HistoryEnv): AppHistory {
  const h = env.history;
  // What pushState and replaceState were before this: the browser's, or a router's wrapper of them.
  const inner = { push: h.pushState.bind(h), replace: h.replaceState.bind(h) };
  const steps: Step[] = [];
  const subs = new Set<() => void>();
  let ver = 0;
  const changed = () => { ver += 1; for (const fn of subs) fn(); };
  // The router moves inside a React commit (Next's history updater is an insertion effect, where an update
  // must not be scheduled): what the bar redraws from is told a moment later, still before the paint.
  let telling = false;
  const changedSoon = () => {
    if (telling) return;
    telling = true;
    queueMicrotask(() => { telling = false; changed(); });
  };

  const st = (): Data => { const s = h.state; return s && typeof s === "object" ? (s as Data) : {}; };
  // Our marks belong to the entry they were written on — never carried into the next by a router that
  // copies the state it found.
  const clean = (d: unknown): Data => {
    const o: Data = d && typeof d === "object" ? { ...(d as Data) } : {};
    delete o.gt3n; delete o.gt3Step; delete o.gt3Under;
    return o;
  };
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

  // ── the trail ──
  let saved: { p?: unknown; t?: unknown } = {};
  try { const raw = env.store?.get(); const o = raw ? JSON.parse(raw) : null; if (o && typeof o === "object") saved = o; } catch { saved = {}; }
  let trail: Record<string, string> = saved.t && typeof saved.t === "object" ? (saved.t as Record<string, string>) : {};
  const save = () => {
    const keep: Record<string, string> = {};
    for (const k of Object.keys(trail)) if (+k > page - 60 && +k <= page + 60) keep[k] = trail[k];
    trail = keep;
    try { env.store?.set(JSON.stringify({ p: page, t: trail })); } catch { /* storage full or off: the labels go, Back does not */ }
  };

  // ── where we are ──
  let cur = num(st().gt3n) ?? 0;   // the current entry's place
  let page = cur;                  // the screen's own entry: one under a step's
  let entry: Entry | null = null;  // the steps' entry, while it is the current one
  let popping: Entry | null = null;// an entry being taken back (our own step back, under way)
  let queued: Array<[Call, unknown, string, string | URL | null | undefined]> = [];
  let want = false;                // a step opened while an entry was being taken back
  let timer: unknown = null;
  let safety: unknown = null;
  let rearm: unknown = null;
  let seq = 0;
  let moved = false;

  if (num(st().gt3n) == null) {
    // An entry no page of ours has marked: the first of the visit — or a whole page loaded by a link from
    // the screen the trail last saw (a plain <a>, an address set by a script), which then stands right
    // before it in this tab. Anything else starts the trail again at 0, with nothing before it.
    const from = env.referrer?.() ?? null;
    const last = num(saved.p);
    if (last != null && from && trail[String(last)] === from && (env.depth?.() ?? 1) > 1) {
      for (const k of Object.keys(trail)) if (+k > last) delete trail[k];
      cur = page = last + 1;
    } else {
      trail = {};
      cur = page = 0;
    }
    env.native.replace({ ...clean(st()), gt3n: cur }, "");
  } else if (typeof st().gt3Step === "string") {
    // Reloaded on a step's entry: the step is gone with the old page. Its entry stays, closed — Back from it
    // goes on to the screen before (below), a move takes its place, a new step reuses it.
    entry = { token: st().gt3Step as string, url: env.href(), live: false, kept: true };
    page = cur - 1;
  }
  trail[String(page)] = env.path();
  save();

  const clearTimer = () => { if (timer != null) { env.cancel(timer); timer = null; } };

  // A step's entry: the screen's own entry is marked as the one under it, so a Back that lands there is
  // known for what it is (and one that jumps further back, from a long press on the browser's Back, is not).
  function pushEntry(): void {
    if (!env.entries || entry || popping || !env.activated()) return;
    const token = `${Date.now().toString(36)}.${(seq += 1)}`;
    const s = clean(st());
    env.native.replace({ ...s, gt3n: cur, gt3Under: token }, "");
    cur += 1;
    env.native.push({ ...s, gt3n: cur, gt3Step: token }, "");
    entry = { token, url: env.href(), live: true, kept: true };
  }

  // The page's address as it was on the step's entry — a sheet that wrote to the address (a record's ?r=)
  // keeps what it wrote, and takes it away itself when it closes.
  const keepUrl = (url: string) => { if (env.href() !== url) env.native.replace(h.state, "", url); };

  function opened(): void {
    if (entry) { if (!entry.live) { entry.live = true; clearTimer(); } return; }
    if (popping) { want = true; return; }
    pushEntry();
  }
  function closed(): void {
    want = false;
    if (!entry?.live) return;
    entry.live = false;
    clearTimer();
    timer = env.later(takeBack, GRACE);
  }
  function takeBack(): void {
    timer = null;
    if (!entry || entry.live) return;
    popping = entry;
    entry = null;
    safety = env.later(() => { safety = null; if (popping) settle(null); }, SAFETY);
    h.back();
  }
  function settle(n: number | null): void {
    const was = popping;
    popping = null;
    if (safety != null) { env.cancel(safety); safety = null; }
    cur = page = n ?? Math.max(0, cur - 1);
    if (was?.kept) keepUrl(was.url);
    trail[String(page)] = env.path();
    save();
    const q = queued;
    queued = [];
    for (const [fn, d, u, url] of q) fn(d, u, url);
    if (want) { want = false; if (steps.length) pushEntry(); }
    changed();
  }

  // ── the wrappers ──
  const push: Call = (data, unused, url) => {
    if (popping) { queued.push([push, data, unused, url]); return; }
    clearTimer();
    if (entry) {
      // A move from a step's entry takes its place.
      entry = null;
      inner.replace({ ...clean(data), gt3n: cur }, unused, url);
      // A step that outlives the move (one that does not close with its screen) gets an entry again.
      if (steps.length) { if (rearm != null) env.cancel(rearm); rearm = env.later(() => { rearm = null; if (steps.length && !entry) pushEntry(); }, GRACE); }
    } else {
      cur += 1;
      inner.push({ ...clean(data), gt3n: cur }, unused, url);
    }
    page = cur;
    moved = true;
    for (const k of Object.keys(trail)) if (+k > page) delete trail[k];
    trail[String(page)] = env.path();
    save();
    changedSoon();
  };
  const replace: Call = (data, unused, url) => {
    if (popping) { queued.push([replace, data, unused, url]); return; }
    const mark: Data = { gt3n: cur };
    if (entry) mark.gt3Step = entry.token;
    inner.replace({ ...clean(data), ...mark }, unused, url);
    if (entry) { entry.url = env.href(); return; }
    trail[String(page)] = env.path();
    save();
  };
  h.pushState = push;
  h.replaceState = replace;

  env.listen((e) => {
    const s: Data = e.state && typeof e.state === "object" ? (e.state as Data) : {};
    const n = num(s.gt3n);
    if (popping) {
      // Our own step back, taking a closed step's entry away: nobody else hears it.
      e.stopImmediatePropagation();
      settle(n);
      return;
    }
    if (entry && s.gt3Under === entry.token) {
      // Back from the steps' entry to the screen under it: the step on top ends, the screen stays.
      e.stopImmediatePropagation();
      const was = entry;
      entry = null;
      clearTimer();
      cur = page = n ?? Math.max(0, cur - 1);
      if (was.live) {
        keepUrl(was.url);
        trail[String(page)] = env.path();
        save();
        const top = steps[steps.length - 1];
        const leaving = top ? top.back() : false;
        // Steps still open (or one that would not go): the next Back is theirs too.
        if (steps.length - (leaving ? 1 : 0) > 0) pushEntry();
      } else {
        // A closed step's entry not yet taken back: this Back was meant for the screen.
        h.back();
      }
      changed();
      return;
    }
    if (entry && s.gt3Step === entry.token) return;   // back onto the steps' own entry (a #link inside a sheet)
    if (typeof s.gt3Step === "string") {
      // Another step's entry, long closed — Forward past a sheet that Back closed. There is nothing to show
      // there: straight back to the screen, unheard.
      e.stopImmediatePropagation();
      popping = { token: s.gt3Step, url: env.href(), live: false, kept: false };
      if (n != null) cur = n;
      safety = env.later(() => { safety = null; if (popping) settle(null); }, SAFETY);
      h.back();
      return;
    }
    // Anywhere else is the screens' own business: the router, the sections and the tabs hear it.
    if (entry) { entry = null; clearTimer(); }
    if (n == null) { trail = {}; env.native.replace({ ...clean(st()), gt3n: 0 }, ""); }
    cur = page = n ?? 0;
    moved = true;
    trail[String(page)] = env.path();
    save();
    changed();
  });

  return {
    step(s) {
      steps.push(s);
      opened();
      changed();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const i = steps.lastIndexOf(s);
        if (i >= 0) steps.splice(i, 1);
        if (!steps.length) closed();
        changed();
      };
    },
    back() {
      const top = steps[steps.length - 1];
      if (top && !entry?.live) { top.back(); return; }   // no entry of theirs (the iPhone app): the door itself
      h.back();
    },
    stepLabel() {
      for (let i = steps.length - 1; i >= 0; i -= 1) if (steps[i].label) return steps[i].label ?? null;
      return null;
    },
    previous() { return page > 0 ? trail[String(page - 1)] ?? null : null; },
    moved: () => moved,
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    version: () => ver,
  };
}

// ── the browser's one ──────────────────────────────────────────────────────────────────────────────
const KEY = "gt3-trail";
type Held = { __gt3History?: AppHistory };

/** The app's history, made the first time anything asks — on the client only. */
export function appHistory(): AppHistory | null {
  if (typeof window === "undefined" || typeof History === "undefined") return null;
  const w = window as unknown as Held;
  if (w.__gt3History) return w.__gt3History;
  const hist = window.history;
  const proto = History.prototype;
  w.__gt3History = createAppHistory({
    history: hist,
    native: {
      push: (d, u, url) => proto.pushState.call(hist, d, u, url),
      replace: (d, u, url) => proto.replaceState.call(hist, d, u, url),
    },
    href: () => window.location.href,
    path: () => window.location.pathname + window.location.search,
    listen: (fn) => window.addEventListener("popstate", fn as unknown as EventListener, true),
    activated: () => (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } }).userActivation?.hasBeenActive ?? true,
    later: (fn, ms) => window.setTimeout(fn, ms),
    cancel: (t) => window.clearTimeout(t as number),
    entries: !isNativeApp(),
    store: { get: () => window.sessionStorage.getItem(KEY), set: (v) => window.sessionStorage.setItem(KEY, v) },
    referrer: () => {
      // Compared, never used to build an address (that is lib/native publicOrigin's job).
      try { const r = new URL(document.referrer); const here = window.location; return r.protocol === here.protocol && r.host === here.host ? r.pathname + r.search : null; } catch { return null; }
    },
    depth: () => window.history.length,
  });
  return w.__gt3History;
}

// Made as this module loads — before the router has drawn anything or listened for anything — so it hears
// every popstate first.
if (typeof window !== "undefined" && typeof History !== "undefined") appHistory();
