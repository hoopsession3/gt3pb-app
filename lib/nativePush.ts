import { supabase } from "./supabase";
import { APP_BUILD } from "./native";

// ALERTS IN THE IPHONE APP — THE PAGE'S HALF (2026-10-11).
//
// The web reaches a phone through the browser's push service (lib/push: a service worker, VAPID). An app is
// reached through Apple's (APNs), with a device token the phone gets when it registers. Three parts:
//
//   components/NativeBridge   — the only file that speaks to Capacitor: asks iOS for permission, registers the
//                               phone, hands the token here, and opens the screen a tapped alert is about;
//   this file                 — what a screen asks (state, enable), and the phone kept in push_subscriptions as
//                               an 'apns' row by the database (0367), as a browser's is (0366);
//   supabase/functions/push   — sends to an 'apns' row through APNs, with the team's key.
//
// DARK UNTIL IT CAN RING. NATIVE_PUSH_ON is the app's build AND NEXT_PUBLIC_NATIVE_PUSH=1 — set on the web (and so
// in the TestFlight build, which takes the web's public settings: lib/publicConfig.json) on the day the push
// function holds APNs' key. Before that the app shows no alerts row, as since the App Store pass: a switch that
// turns on nothing is a placeholder (App Review 2.1).

/** Alerts in the app are live: this is the app's build, and the web says APNs is set up (see above). */
export const NATIVE_PUSH_ON = APP_BUILD && process.env.NEXT_PUBLIC_NATIVE_PUSH === "1";

/** What iOS says about notifications for the app. "prompt": never asked (iOS asks a person once). */
export type AppAlertState = "granted" | "denied" | "prompt" | "unavailable";

/** The phone's half, set by components/NativeBridge once its plugins are in. */
export type NativePush = {
  state(): Promise<AppAlertState>;
  /** Ask — iOS shows its question only the first time — and register the phone on a yes. */
  enable(): Promise<AppAlertState>;
};

let impl: NativePush | null = null;
const listeners = new Set<() => void>();

export function setNativePush(p: NativePush | null): void {
  impl = p;
  for (const fn of listeners) fn();
}

export function nativePush(): NativePush | null {
  return impl;
}

/** Called when the phone's half arrives or goes — a screen that asked too early asks again. */
export function onNativePush(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Keep this phone for whoever is signed in now — or nobody (0367 keep_app_push_token, as a browser is kept by 0366's
 * keep_push_device): the database takes the phone from whoever had it, keeps one app install each (a browser is not
 * one), and marks it for the pass's new orders only for the crew (0365). The page used to write the row itself, and a
 * phone someone signed out of stayed theirs; the next person's write was refused and the delete after it took away
 * their other devices (2026-10-11, the review). The answer is whether the phone was kept.
 */
export async function keepAppDevice(token: string): Promise<boolean> {
  if (!supabase || !/^[0-9a-f]{32,200}$/i.test(token)) return false;
  const { error } = await supabase.rpc("keep_app_push_token", { p_token: token });
  return !error;
}

/** Where a tapped alert goes, inside the app: the link it carries, the console's old address read as its new one. */
export function alertTarget(url: unknown): string | null {
  const u = typeof url === "string" ? url : "";
  if (!u.startsWith("/") || u.startsWith("//")) return null;
  return /^\/admin(?=$|[/?#])/.test(u) ? u.replace(/^\/admin/, "/crew") : u;
}
