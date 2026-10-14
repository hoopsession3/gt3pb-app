"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { subscribePush } from "@/lib/push";

// "PING ME WHEN THE TRUCK GOES LIVE" — the public opt-in for the go-live push (0257), one device's own. Find Us draws it
// as a chip (components/FindUs LivePingButton) and the account's Notifications screen as a switch (R6,
// components/NotificationsSheet): the same state, the same device row, from here.
//
// Only where background push can actually work (needs PushManager: an installed web app or a desktop browser — an iOS
// Safari TAB has none, so it is "hidden" there rather than dead-ending someone; the iPhone app's own alerts are
// lib/nativePush's, and its install does not take this ping yet). Signed-in visitors keep their user_id/is_admin on the
// row (the same keep_push_device Checkout and the profile use — wants_live is one more preference on the device's row,
// not a second subscription). A guest can't read their row back (RLS is owner/admin-only), so the on/off rides
// localStorage — a courtesy memory, not an audit. "On" only once the database has kept the device (lib/push, 0366).
export type LivePing = "hidden" | "off" | "on" | "busy";

const canPush = (): boolean =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";

export function useLivePing(): { state: LivePing; toggle: () => Promise<void> } {
  const { profile } = useAuth();
  // Known on the first render, not one after it (2026-10-04): the chip arrived a frame late and wrapped Find Us's chip row
  // onto a second line under everything already drawn. Both places mount it only in the browser.
  const [state, setState] = useState<LivePing>(() => {
    if (!canPush()) return "hidden";
    try { return localStorage.getItem("gt3-live-ping") === "1" ? "on" : "off"; } catch { return "off"; }
  });
  const toggle = async () => {
    if (state === "busy" || state === "hidden") return;
    const turningOn = state === "off";
    setState("busy");
    try {
      if (turningOn) {
        const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
        if (p !== "granted") { setState("off"); return; }
      }
      if (!(await subscribePush(!!profile?.is_admin, { wantsLive: turningOn }))) { setState(turningOn ? "off" : "on"); return; }
      try { localStorage.setItem("gt3-live-ping", turningOn ? "1" : "0"); } catch { /* ignore */ }
      setState(turningOn ? "on" : "off");
    } catch {
      setState(turningOn ? "off" : "on");
    }
  };
  return { state, toggle };
}
