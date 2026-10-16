// ONE READ, ONE CHANNEL, FOR EVERY SCREEN THAT SHOWS IT (R13, 2026-10-16 — the 10/10 audit's performance pass, F5 and F15).
//
// The data every screen shares — the site's words (lib/copy useSiteCopy), what is on the menu (lib/availability), the work
// streams (lib/streams), a member's open orders (components/useMyOrders), a person's alerts (lib/useMyAlerts) — was read
// by each screen for itself: a guest's cold /menu read site_copy four times and the products six, and opened eight
// channels to hear about them; one 86 made every open menu read the menu again three or four times; the Pass kept two
// copies of the alerts, each with its own clock, and Today two of the open orders, each polling every 20 seconds, hidden
// or not. A store here keeps one copy per key (the market, the person): the first screen to ask opens its channel and
// reads; every other screen shares that answer; the last to leave closes it a moment later (LINGER_MS — a screen that
// comes straight back finds it open, and what it last said is shown at once while it is read again).
//
// THE NEWEST ANSWER STANDS (F15). Reads overlap — a change, the clock, a return to the page — and an older answer landing
// last put an older truth back on the screen: "Being made" after "Ready", a just-dismissed alert back on the bell. Every
// read is numbered when it is asked; an answer older than one already landed is dropped, and so is one older than a
// change made here (an alert cleared on the screen), which is newer than any read that began before it.
//
// AN ANSWER THAT CHANGES NOTHING CHANGES NOTHING: `equal` decides whether a read's answer is what is already here, and an
// equal one is not handed to the screens (each read used to draw every screen showing it again).
//
// Pure but for what it is handed (the channel, the clock, whether the page is on screen), so scripts/r13.test.mjs turns
// it by hand; lib/shared is it wired to React and to lib/realtime.

export const LINGER_MS = 5_000;

export type StoreTimers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (t: unknown) => void;
  every: (fn: () => void, ms: number) => unknown;
  stop: (t: unknown) => void;
};

export type StoreEnv = {
  timers: StoreTimers;
  /** Whether the page is on screen: the clock reads nothing for a page no one is looking at. */
  visible: () => boolean;
  /** Run `fn` on each return to the page; answers the stop. */
  onReturn: (fn: () => void) => () => void;
};

export type StoreSpec<T> = {
  initial: T;
  /** The read. `undefined`: keep what is here (a failure that must not show as "none"). A read that throws keeps it too. */
  read: (key: string, cur: T) => Promise<T | undefined>;
  /** The channel: call `run` when what was read may have changed. Answers the stop. */
  watch: (key: string, run: () => void) => () => void;
  /** A clock, while the page is on screen — `when` (what is here, which tick) may skip a tick. */
  every?: { ms: number; when?: (cur: T, tick: number) => boolean };
  /** Read again on every return to the page as well (beyond lib/realtime's own after 30 seconds away). */
  back?: boolean;
  /** Whether a read's answer is what is already here. Default: the same object. */
  equal?: (a: T, b: T) => boolean;
  /** A person's: forgotten when its last screen has gone, and on forget() (a sign-out). */
  personal?: boolean;
  linger?: number;
};

export type Store<T> = {
  subscribe: (key: string, listener: () => void) => () => void;
  peek: (key: string) => T;
  reload: (key: string) => Promise<void>;
  /** A change made here, at once, for every screen showing it — newer than any read already asked for. */
  change: (key: string, next: (cur: T) => T) => void;
  /** Every key back to `initial` (a personal store, on a sign-out). */
  forget: () => void;
  /** Keys held, and channels open — for the tests. */
  counts: () => { keys: number; open: number };
};

type Entry<T> = {
  value: T;
  listeners: Set<() => void>;
  stop: (() => void) | null;
  asked: number;
  landed: number;
  linger: unknown;
};

export function createStore<T>(spec: StoreSpec<T>, env: StoreEnv): Store<T> {
  const entries = new Map<string, Entry<T>>();
  const equal = spec.equal ?? ((a: T, b: T) => a === b);
  const entry = (key: string): Entry<T> => {
    let e = entries.get(key);
    if (!e) { e = { value: spec.initial, listeners: new Set(), stop: null, asked: 0, landed: 0, linger: null }; entries.set(key, e); }
    return e;
  };
  const put = (e: Entry<T>, v: T) => {
    if (v === e.value || equal(v, e.value)) return;
    e.value = v;
    for (const l of [...e.listeners]) l();
  };

  const reload = (key: string): Promise<void> => {
    const e = entry(key);
    const n = ++e.asked;
    return spec.read(key, e.value).then((v) => {
      if (v === undefined || n < e.landed) return;
      e.landed = n;
      // The entry may have been forgotten and made again while this read was out: the answer goes to the one held now.
      if (entries.get(key) !== e) return;
      put(e, v);
    }, () => { /* a read that threw keeps what is here */ });
  };

  const start = (key: string, e: Entry<T>) => {
    const stops: (() => void)[] = [spec.watch(key, () => { void reload(key); })];
    if (spec.every) {
      const { ms, when } = spec.every;
      let tick = 0;
      const clock = env.timers.every(() => {
        tick++;
        if (env.visible() && (!when || when(e.value, tick))) void reload(key);
      }, ms);
      stops.push(() => env.timers.stop(clock));
    }
    if (spec.back) stops.push(env.onReturn(() => { void reload(key); }));
    e.stop = () => { for (const s of stops) s(); };
    void reload(key);
  };

  const close = (key: string, e: Entry<T>) => {
    e.stop?.();
    e.stop = null;
    if (spec.personal && entries.get(key) === e) entries.delete(key);
  };

  return {
    subscribe(key, listener) {
      const e = entry(key);
      e.listeners.add(listener);
      if (e.linger !== null) { env.timers.clear(e.linger); e.linger = null; }
      if (!e.stop) start(key, e);
      return () => {
        e.listeners.delete(listener);
        if (e.listeners.size || e.linger !== null || !e.stop) return;
        e.linger = env.timers.set(() => { e.linger = null; if (!e.listeners.size) close(key, e); }, spec.linger ?? LINGER_MS);
      };
    },
    peek: (key) => (entries.get(key) ?? { value: spec.initial }).value,
    reload,
    change(key, next) {
      const e = entry(key);
      e.landed = ++e.asked;
      put(e, next(e.value));
    },
    forget() {
      for (const e of entries.values()) { e.landed = ++e.asked; put(e, spec.initial); }
    },
    counts: () => ({ keys: entries.size, open: [...entries.values()].filter((e) => e.stop).length }),
  };
}

/** Equal by what they hold, for answers made of plain rows. */
export const sameJson = <T,>(a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b);
