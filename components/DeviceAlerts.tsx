"use client";

import { useSyncExternalStore } from "react";
import { subscribePush } from "@/lib/push";
import { useApp } from "./AppProvider";
import GoLine from "./GoLine";
import { APP_BUILD } from "@/lib/native";

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
  // The iPhone app (2026-10-06) has no web notifications to ask for; its own, native alerts are the
  // next part of the app round. Until then it says so, rather than sending anyone to the Home Screen.
  unsupported: APP_BUILD
    ? "Alerts come to the app in its next update. Until then, the web app on this phone's Home Screen can ring."
    : "This browser can't show notifications. On an iPhone, add the app to your Home Screen first.",
};

/** Settings › You: what this phone says, and the one tap that asks it. */
export function DeviceAlerts({ userId }: { userId: string | null }) {
  const { toast } = useApp();
  const perm = useAlertPermission();
  const turnOn = async () => {
    let p: NotificationPermission;
    try { p = await Notification.requestPermission(); }
    catch { toast("Couldn't ask this phone for notifications — try again", "error"); return; }
    window.dispatchEvent(new Event(ASKED));
    if (p === "granted") { subscribePush(userId, true); toast("Order alerts are on for this phone"); } // background push for the kitchen
    else toast("Couldn't turn them on — this phone said no. Allow notifications for this site in the browser's settings.", "error");
  };
  return (
    <div className="pay-row">
      <div className="pay-row-l">
        <div className="pay-row-t">Order alerts on this phone</div>
        <div className="pay-row-s">{SAYS[perm]}</div>
      </div>
      {perm === "default"
        ? <button type="button" className="btn-sec" onClick={turnOn}>Turn on</button>
        : perm === "granted" ? <span className="pay-status on">On</span>
        : perm === "denied" ? <span className="pay-status">Blocked</span>
        : perm === "unsupported" ? <span className="pay-status">Not here</span>
        : null}
    </div>
  );
}

/** Live Ops: one line, only while alerts are off on this phone. */
export function AlertsOffLine() {
  const perm = useAlertPermission();
  if (!alertsOff(perm)) return null;
  return <GoLine to="settings" anchor="set-alerts">Order alerts are off on this phone — turn them on in Settings</GoLine>;
}
