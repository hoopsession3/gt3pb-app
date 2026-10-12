"use client";

import { useSyncExternalStore } from "react";
import { subscribePush } from "@/lib/push";
import { useApp } from "./AppProvider";
import GoLine from "./GoLine";
import { APP_BUILD } from "@/lib/native";
import { NATIVE_PUSH_ON } from "@/lib/nativePush";
import { AppAlertsRow, AppAlertsOffLine, useAppAlerts } from "./AppAlerts";

// ALERTS ON THIS DEVICE (2026-10-06, the settings round). "Turn on order alerts" was a full card at
// the bottom of Live Ops, under the tasks, on every phone that had not said yes yet. It is a setting
// of this phone, so it lives in Settings › You now, where it also says what the phone answered: on,
// not asked yet, blocked, or not possible here. Live Ops keeps one line, and only while alerts are
// off on this phone and could be turned on.
//
// What the phone has said is read while rendering (useSyncExternalStore), not copied into state by
// an effect: it changes when we ask, and when someone flips it in the browser's own settings and
// comes back to the app — so it is read again on focus.

export type AlertPermission = NotificationPermission | "unsupported";
const ASKED = "gt3-alert-permission";

function readPermission(): AlertPermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}
function subscribe(onChange: () => void) {
  window.addEventListener(ASKED, onChange);
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener(ASKED, onChange);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/** What this phone has said about notifications. "unknown" on the server and while hydrating. */
export function useAlertPermission(): AlertPermission | "unknown" {
  return useSyncExternalStore(subscribe, readPermission, () => "unknown" as const);
}

/** Off here, and something can be done about it: not asked yet, or blocked in the browser. */
export const alertsOff = (p: AlertPermission | "unknown"): boolean => p === "default" || p === "denied";

const SAYS: Record<AlertPermission | "unknown", string> = {
  unknown: "Checking this phone…",
  granted: "On. A push lands the moment a new order reaches the pass — even with the app in your pocket.",
  default: "Off. Get a push the moment a new order lands on the pass — even with the app in your pocket.",
  denied: "Blocked by this browser. Allow notifications for this site in the browser's settings, then come back here.",
  // On the web only: the iPhone app shows no row at all (DeviceAlerts, below).
  unsupported: "This browser can't show notifications. On an iPhone, add GT3 to your Home Screen from Safari's Share menu first.",
};

/** Settings › You: what this phone says, and the one tap that asks it. */
export function DeviceAlerts() {
  const { toast } = useApp();
  const perm = useAlertPermission();
  // IN THE IPHONE APP, THE APP'S OWN (2026-10-11). The app has no web notifications to ask for: its alerts come
  // through Apple (components/AppAlerts, lib/nativePush). Until they are live (NATIVE_PUSH_ON) there is no row at all —
  // the row used to say "Alerts come to the app in its next update. Until then, the web app on this phone's Home
  // Screen can ring", a promise and a pointer to the website, in an App Store app: a placeholder (App Review 2.1).
  if (APP_BUILD) return NATIVE_PUSH_ON ? <AppAlertsRow /> : null;
  const turnOn = async () => {
    let p: NotificationPermission;
    try { p = await Notification.requestPermission(); }
    catch { toast("Couldn't ask this phone for notifications — try again", "error"); return; }
    window.dispatchEvent(new Event(ASKED));
    if (p !== "granted") { toast("Couldn't turn them on — this phone said no. Allow notifications for this site in the browser's settings.", "error"); return; }
    // Background push for the kitchen — "on" only once the database has kept this phone (lib/push, 0366).
    if (await subscribePush(true)) toast("Order alerts are on for this phone");
    else toast("Couldn't save this phone for alerts — try again", "error");
  };
  return (
    <div className="pay-row">
      <div className="pay-row-l">
        <div className="pay-row-t">Order alerts on this phone</div>
        <div className="pay-row-s">{SAYS[perm]}</div>
      </div>
      {perm === "default"
        ? <button type="button" className="btn-sec btn-sm" onClick={turnOn}>Turn on</button>
        : perm === "granted" ? <span className="k-tag ok">On</span>
        : perm === "denied" ? <span className="k-tag">Blocked</span>
        : perm === "unsupported" ? <span className="k-tag">Not here</span>
        : null}
    </div>
  );
}

/** THIS PHONE CAN'T RING (2026-10-12, the Live Ops round): the question AlertsOffLine below answers with a line, as a
 *  yes or no — so the Pass's row on Live Ops can say it in words (lib/liveOps passSays), with the line one tap away.
 *  Off here and able to be on: in the browser, not asked yet or blocked; in the iPhone app, once its alerts are live
 *  (NATIVE_PUSH_ON), not asked yet or turned off in the phone's Settings. Both answers are read, each where it can be
 *  (the app's answer is null on the web), so no hook is called on one build and not the other. */
export function useAlertsOffHere(): boolean {
  const perm = useAlertPermission();
  const { state } = useAppAlerts();
  return APP_BUILD ? NATIVE_PUSH_ON && (state === "prompt" || state === "denied") : alertsOff(perm);
}

/** Live Ops: one line, only while alerts are off on this phone. */
export function AlertsOffLine() {
  const perm = useAlertPermission();
  if (APP_BUILD) {
    if (!NATIVE_PUSH_ON) return null;
    return <AppAlertsOffLine>{(off) => off ? <GoLine to="settings" anchor="set-alerts">Order alerts are off on this phone — turn them on in Settings</GoLine> : null}</AppAlertsOffLine>;
  }
  if (!alertsOff(perm)) return null;
  return <GoLine to="settings" anchor="set-alerts">Order alerts are off on this phone — turn them on in Settings</GoLine>;
}
