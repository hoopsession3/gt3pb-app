"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { APP_BUILD, isNativeApp, nativePlatform } from "@/lib/native";
import { NATIVE_PUSH_ON } from "@/lib/nativePush";
import { onWakeLock, wakeLockHeld } from "@/lib/useWakeLock";
import {
  PASS_SURFACE, alertsOnFrom, appBuild, appOf, beater, buildOf, deviceId, hearPassFeed, onAppBuild, onPassFeed,
  passFeed, sendBeat, type Timers,
} from "@/lib/heartbeat";
import { useAlertPermission } from "./DeviceAlerts";
import { useAppAlerts } from "./AppAlerts";

// THIS DEVICE IS ON THE PASS (2026-10-11, the KDS program — devices). While the Pass is open and the page can be seen,
// this device checks in: once a minute, and the moment anything it reports changes (lib/heartbeat beater) — its
// orders feed, whether it can be pushed an order, whether its screen is kept on. The database keeps the latest word
// (0375); Live Ops' Devices card shows it to the managers, and 0376 rings them when, during service, no device is on
// the Pass with its feed live.
//
// What it reports, and where each answer comes from:
//   · the feed — the Pass's own word, the window's gt3:pass-feed event (lib/heartbeat PASS_FEED_EVENT). It is heard
//     from the moment the console opens, not from when the Pass does: the Pass can say it in the same instant it
//     mounts. Until it has said anything the beat says "unknown", which 0376 does not count as hearing; after that its
//     last word stands until it says another (a Pass opened again says its own as its feed comes up).
//   · alerts on — the answer Live Ops' alerts-off line reads (components/DeviceAlerts, components/AppAlerts);
//   · the wake lock — lib/useWakeLock's own record of what the browser holds;
//   · the device — an id this install keeps (lib/heartbeat deviceId); the app and its build — lib/native, the web's
//     commit, and the iPhone app's version once components/NativeBridge has it.
//
// Hidden — another app, the phone locked, a tab behind another — it says nothing, so a quiet device reads as away
// (lib/heartbeat AWAY_AFTER_S) and, five minutes on, as nobody (0376). Back, it checks in at once. A beat that fails
// costs nothing but itself: before 0375 is pasted every one does (lib/heartbeat sendBeat: "missing"), and the next
// one tries again.

const visibleNow = () => document.visibilityState === "visible";
const onVisibility = (fn: () => void) => {
  document.addEventListener("visibilitychange", fn);
  return () => document.removeEventListener("visibilitychange", fn);
};
const clock: Timers = {
  now: () => Date.now(),
  after: (fn, ms) => window.setTimeout(fn, ms),
  cancel: (h) => window.clearTimeout(h as number),
};
const storage = (): Pick<Storage, "getItem" | "setItem"> | null => {
  try { return window.localStorage; } catch { return null; }
};

/** While `open` — the Pass is up — and the page is visible, this device checks in (0375). */
export function usePassHeartbeat(open: boolean): void {
  const web = useAlertPermission();
  const { state: native } = useAppAlerts();
  const alertsOn = alertsOnFrom({ app: APP_BUILD, nativePushOn: NATIVE_PUSH_ON, web, native });
  const wakeLock = useSyncExternalStore(onWakeLock, wakeLockHeld, () => false);
  const visible = useSyncExternalStore(onVisibility, visibleNow, () => false);
  const feed = useSyncExternalStore(onPassFeed, passFeed, () => "unknown" as const);
  const build = useSyncExternalStore(onAppBuild, appBuild, () => null);
  const [beats] = useState(() => beater((b) => sendBeat(supabase, b), clock));

  useEffect(() => hearPassFeed(window), []);
  useEffect(() => () => beats.stop(), [beats]);
  useEffect(() => {
    if (!open || !visible || !supabase) { beats.stop(); return; }
    const app = appOf(isNativeApp(), nativePlatform());
    beats.say({
      device: deviceId(storage()),
      surface: PASS_SURFACE,
      app,
      build: buildOf(app, process.env.NEXT_PUBLIC_BUILD_COMMIT, build),
      feed,
      alertsOn,
      wakeLock,
    });
  }, [open, visible, feed, alertsOn, wakeLock, build, beats]);
}
