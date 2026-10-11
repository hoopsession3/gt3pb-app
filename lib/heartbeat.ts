import type { SupabaseClient } from "@supabase/supabase-js";
import { roleLabel } from "./roles";
import { isMissingFunction } from "./schemaSkew";

// ── WHO IS WATCHING THE PASS (2026-10-11) ──────────────────────────────────────────────────────────────────────────
// Nobody could tell, from anywhere, which phone or iPad had the Pass open or whether it could hear an order. A
// sleeping iPad and a working one looked the same, and the Pass's orders feed had no health check of its own. So
// each device with the Pass open says so once a minute, and again the moment anything about it changes, to the
// database (0375's crew_heartbeat), which keeps one row per device and screen. Live Ops' Devices card reads those rows
// (components/crew/DevicesCard), and 0376's watchdog rings when, during service, no device is on the Pass and hearing.
//
// This file is the part that runs without a screen (scripts/heartbeat.test.mjs runs it): what a beat says, when one
// goes, the device's id, and the words the card shows. components/usePassHeartbeat feeds it from the page. Crew-only:
// the console, the Devices card and the app's bridge import it, and no guest page does.

// ── THE PASS'S WORD ON ITS FEED ────────────────────────────────────────────────────────────────────────────────────

/** The window event the Pass sends when its orders feed changes: `detail: { state, at }`. */
export const PASS_FEED_EVENT = "gt3:pass-feed";

/** The five words 0375 keeps for a feed (device_heartbeats.feed's check). */
export const FEEDS = ["live", "reconnecting", "down", "signed-out", "unknown"] as const;
export type Feed = (typeof FEEDS)[number];

/** What the Pass said, as one of the five — anything it did not say plainly is "unknown". */
export function feedOf(detail: unknown): Feed {
  const s = detail && typeof detail === "object" ? (detail as { state?: unknown }).state : undefined;
  return typeof s === "string" && (FEEDS as readonly string[]).includes(s) ? (s as Feed) : "unknown";
}

// The Pass's last word, kept from the moment the console opens. The Pass can say it in the same instant it mounts —
// before anything inside the page that opened it has run — so it is heard from outside the Pass and kept here. It
// starts "unknown": a build whose Pass never says is not reported as hearing.
let feedNow: Feed = "unknown";
const feedWatchers = new Set<() => void>();

/** The Pass's feed, as last said. */
export const passFeed = (): Feed => feedNow;

/** Keep a new word about the feed, and tell whoever watches it. */
export function setPassFeed(f: Feed): void {
  if (f === feedNow) return;
  feedNow = f;
  for (const fn of feedWatchers) fn();
}

/** Be told when the feed's word changes (useSyncExternalStore's subscribe). */
export function onPassFeed(fn: () => void): () => void {
  feedWatchers.add(fn);
  return () => { feedWatchers.delete(fn); };
}

/** Hear the Pass on `target` (the window) from now on; the answer stops hearing it. */
export function hearPassFeed(target: Pick<EventTarget, "addEventListener" | "removeEventListener">): () => void {
  const heard = (e: Event) => setPassFeed(feedOf((e as CustomEvent).detail));
  target.addEventListener(PASS_FEED_EVENT, heard);
  return () => target.removeEventListener(PASS_FEED_EVENT, heard);
}

// ── WHICH BUILD ────────────────────────────────────────────────────────────────────────────────────────────────────
// The web knows its commit when it is built (next.config.ts, NEXT_PUBLIC_BUILD_COMMIT). The iPhone app's version and
// build are the phone's to say: components/NativeBridge, the one file that speaks to Capacitor, hands them here once
// its plugins are in.
let appBuildNow: string | null = null;
const buildWatchers = new Set<() => void>();
const cleanBuild = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s ? s.slice(0, 40) : null;   // 0375 keeps 40 characters at most
};

/** The app's own version and build, once the phone has said ("1.0 (42)"); null on the web. */
export const appBuild = (): string | null => appBuildNow;

/** components/NativeBridge: the phone's answer to App.getInfo. */
export function setAppBuild(v: string | null): void {
  const c = cleanBuild(v);
  if (c === appBuildNow) return;
  appBuildNow = c;
  for (const fn of buildWatchers) fn();
}

export function onAppBuild(fn: () => void): () => void {
  buildWatchers.add(fn);
  return () => { buildWatchers.delete(fn); };
}

export type App = "web" | "ios";

/** "ios" inside the iPhone app's shell; "web" everywhere else — a browser, the home-screen web app, a test run. */
export const appOf = (native: boolean, platform: string): App => (native && platform === "ios" ? "ios" : "web");

/** The build a beat names: the app's own in the app, the web's commit (seven characters) on the web, or none. */
export function buildOf(app: App, webCommit: string | null | undefined, appVersion: string | null): string | null {
  if (app === "ios") return cleanBuild(appVersion);
  const c = (webCommit ?? "").trim();
  return c ? c.slice(0, 7) : null;
}

// ── CAN IT BE PUSHED AN ORDER ──────────────────────────────────────────────────────────────────────────────────────
// The same answer Live Ops' alerts-off line reads (components/DeviceAlerts AlertsOffLine): on the web, the browser said
// yes to notifications; in the app, the app's alerts are live (lib/nativePush NATIVE_PUSH_ON) and iOS said yes. Any
// other answer — not asked yet, blocked, not possible here, not known yet — is off.
export function alertsOnFrom(o: { app: boolean; nativePushOn: boolean; web: string; native: string }): boolean {
  return o.app ? o.nativePushOn && o.native === "granted" : o.web === "granted";
}

// ── THIS DEVICE ────────────────────────────────────────────────────────────────────────────────────────────────────
export const DEVICE_KEY = "gt3-device-id";
const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;   // 0375's check: the database refuses anything else
let visitId: string | null = null;

/** A random id in the uuid's shape (v4). getRandomValues, not randomUUID: the app's page is not always a secure
 *  context the way a browser counts one, and randomUUID is only offered to those. */
export function mintId(fill: (b: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const b = fill(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** This install's id: kept in localStorage, made once. Storage that cannot be read or written (a private window, a
 *  locked-down browser) gets an id for this visit instead — the same one for as long as the page is open. */
export function deviceId(store: Pick<Storage, "getItem" | "setItem"> | null, mint: () => string = mintId): string {
  try {
    const kept = store?.getItem(DEVICE_KEY);
    if (kept && DEVICE_ID.test(kept)) return kept;
  } catch { /* unreadable: this visit's id, below */ }
  const id = (visitId ??= mint());
  try { store?.setItem(DEVICE_KEY, id); } catch { /* not kept: next visit is another device, and ages out */ }
  return id;
}

// ── A BEAT ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The one screen that checks in today. 0375 has room for "live_ops" and "driver". */
export const PASS_SURFACE = "pass";

export type Beat = { device: string; surface: string; app: App; build: string | null; feed: Feed; alertsOn: boolean; wakeLock: boolean };

export const sameBeat = (a: Beat, b: Beat): boolean =>
  a.device === b.device && a.surface === b.surface && a.app === b.app && a.build === b.build
  && a.feed === b.feed && a.alertsOn === b.alertsOn && a.wakeLock === b.wakeLock;

/** crew_heartbeat's arguments, by name (0375) — scripts/heartbeat.test.mjs reads the migration and holds the two to
 *  the same names. */
export function beatArgs(b: Beat): Record<string, string | boolean | null> {
  return { p_device: b.device, p_surface: b.surface, p_app: b.app, p_app_build: b.build, p_feed: b.feed, p_alerts_on: b.alertsOn, p_wake_lock: b.wakeLock };
}

/** "kept" — the database has it; "missing" — 0375 is not pasted yet (PGRST202: the beat arrives with the database
 *  update, and the next one tries again); "refused" — any other answer; "offline" — no answer at all. */
export type Sent = "kept" | "missing" | "refused" | "offline";

export async function sendBeat(sb: Pick<SupabaseClient, "rpc"> | null, b: Beat): Promise<Sent> {
  if (!sb) return "offline";
  try {
    const { error } = await sb.rpc("crew_heartbeat", beatArgs(b));
    if (!error) return "kept";
    return isMissingFunction(error) ? "missing" : "refused";
  } catch {
    return "offline";
  }
}

// ── WHEN ONE GOES ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Once a minute while nothing changes: 0376 calls a Pass deaf after five minutes without a live one. */
export const BEAT_MS = 60_000;
/** Never two beats closer than this: a feed that flaps for a second is one beat, with its last word. */
export const BEAT_GAP_MS = 2_000;

export type Timers = { now: () => number; after: (fn: () => void, ms: number) => unknown; cancel: (handle: unknown) => void };

/**
 * say(beat): what this device should be saying now. A beat that differs from the last one sent goes at once (or as
 * soon as BEAT_GAP_MS since the last allows); the same beat goes again every BEAT_MS. stop(): nothing more until the
 * next say(), which then goes at once — a page coming back, a Pass opened again. A send that fails is a beat missed,
 * never a stopped clock: the next one goes on time.
 */
export function beater(send: (b: Beat) => unknown, t: Timers, every: number = BEAT_MS, gap: number = BEAT_GAP_MS) {
  let want: Beat | null = null, last: Beat | null = null, sentAt = -Infinity, handle: unknown = null;
  const clear = () => { if (handle !== null) t.cancel(handle); handle = null; };
  const fire = () => {
    handle = null;
    if (!want) return;
    last = want;
    sentAt = t.now();
    try { void Promise.resolve(send(want)).catch(() => {}); } catch { /* the next beat goes on time */ }
    arm();
  };
  const arm = () => {
    clear();
    if (!want) return;
    const due = last && sameBeat(last, want) ? sentAt + every : sentAt + gap;
    handle = t.after(fire, Math.max(0, due - t.now()));
  };
  return {
    say(b: Beat) { want = b; arm(); },
    stop() { want = null; last = null; clear(); },
  };
}

// ── WHAT THE DEVICES CARD SHOWS ────────────────────────────────────────────────────────────────────────────────────
/** The card asks again every half minute (it is not on realtime: 0375 says why). */
export const DEVICES_POLL_MS = 30_000;
/** A device not heard from in this long has missed two beats: "Away", whatever it last said. */
export const AWAY_AFTER_S = 150;

/** One row of crew_devices() (0375). */
export type DeviceRow = {
  device_id: string; surface: string; user_id: string; display_name: string | null; role: string | null;
  app: string; app_build: string | null; feed: string; alerts_on: boolean; wake_lock: boolean;
  last_seen: string; seen_s: number;
};

export type Tone = "" | "ok" | "warn" | "crit";

const FEED_WORD: Record<Feed, string> = { live: "Live", reconnecting: "Reconnecting", down: "Down", "signed-out": "Signed out", unknown: "Unknown" };
const FEED_TONE: Record<Feed, Tone> = { live: "ok", reconnecting: "warn", down: "crit", "signed-out": "crit", unknown: "" };
const SURFACE_WORD: Record<string, string> = { pass: "Pass", live_ops: "Live Ops", driver: "Driver" };

/** The feed in a word, as the card's tag says it. */
export const feedWord = (f: string): string => FEED_WORD[feedOf({ state: f })];

/** "seen just now" · "seen 12 s ago" · "seen 3 min ago" · "seen 2 h ago". */
export function seenWords(ageS: number): string {
  const s = Math.max(0, Math.floor(ageS));
  if (s < 5) return "seen just now";
  if (s < 60) return `seen ${s} s ago`;
  if (s < 3600) return `seen ${Math.floor(s / 60)} min ago`;
  return `seen ${Math.floor(s / 3600)} h ago`;
}

export type DeviceView = { key: string; who: string; feed: string; tone: Tone; line: string; meta: string; hearing: boolean };

/** A row as the card says it: who, the feed in a word (and its tone — never the only sign), then the screen, whether
 *  it can be pushed an order and when it was seen; under that, the app and build and whether the screen stays on. */
export function deviceView(r: DeviceRow, ageS: number): DeviceView {
  const away = ageS > AWAY_AFTER_S;
  const feed = feedOf({ state: r.feed });
  const app = r.app === "ios" ? "iPhone app" : "Web";
  return {
    key: `${r.device_id}:${r.surface}`,
    who: (r.display_name ?? "").trim() || roleLabel(r.role),
    feed: away ? "Away" : FEED_WORD[feed],
    tone: away ? "warn" : FEED_TONE[feed],
    line: [SURFACE_WORD[r.surface] ?? r.surface, r.alerts_on ? "alerts on" : "alerts off", seenWords(ageS)].join(" · "),
    meta: [r.app_build ? `${app} ${r.app_build}` : app, r.wake_lock ? "screen stays on" : "screen can sleep"].join(" · "),
    hearing: !away && feed === "live",
  };
}
