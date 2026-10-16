"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "./AppProvider";
import { nativePush, onNativePush, type AppAlertState } from "@/lib/nativePush";
import { nativeDevice } from "@/lib/deviceActions";
import { appleDevice } from "@/lib/ios";

/** GT3's own page in the iPhone's Settings — where alerts turned off there are turned back on (GT3Device.openSettings). */
const openSettings = () => { void nativeDevice()?.openSettings().catch(() => {}); };
/** Where that is, in the device's own name — "this iPad's Settings" on an iPad (2026-10-11, lib/ios appleDevice). Said only
 *  once the phone has answered "denied", in the browser, so a server render never draws a device's name. */
const itsSettings = () => `this ${appleDevice()}'s Settings`;

// ALERTS ON THIS IPHONE, IN THE APP (2026-10-11). What the phone says, read when the screen opens, when the phone's
// half arrives (components/NativeBridge sets it once its plugins are in) and each time the app comes back to the
// front — someone who turned GT3's notifications on or off in the iPhone's Settings comes back to the right word.
// Turning on asks iOS (its question appears once; after that the answer is in Settings) and registers the phone
// (lib/nativePush). Only drawn where alerts are live (NATIVE_PUSH_ON): DeviceAlerts, the profile sheet, Live Ops.

/** What this phone says about GT3's notifications, and the one tap that asks. "unknown" until it has answered. */
export function useAppAlerts(): { state: AppAlertState | "unknown"; turnOn: () => Promise<AppAlertState | null> } {
  const [state, setState] = useState<AppAlertState | "unknown">("unknown");
  useEffect(() => {
    let live = true;
    const read = () => {
      const p = nativePush();
      if (!p) return;
      void p.state().then((s) => { if (live) setState(s); });
    };
    read();
    const off = onNativePush(read);
    const onVisible = () => { if (document.visibilityState === "visible") read(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { live = false; off(); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  const turnOn = async () => {
    const p = nativePush();
    if (!p) return null;
    const s = await p.enable();
    setState(s);
    return s;
  };
  return { state, turnOn };
}

const SAYS: Record<Exclude<AppAlertState, "denied"> | "unknown", string> = {
  unknown: "Checking this phone…",
  granted: "On. A push lands the moment a new order reaches the pass — even with the app closed.",
  prompt: "Off. Get a push the moment a new order lands on the pass — even with the app closed.",
  unavailable: "This phone can't take alerts right now.",
};
/** What the row says for each answer; "denied" names the device's Settings (itsSettings, above). */
const says = (s: AppAlertState | "unknown"): string =>
  s === "denied" ? `Off for GT3PB in ${itsSettings()} — allow them there, then come back here.` : SAYS[s];

/** Settings › You › Notifications, in the app: what this iPhone says, and the one tap that asks it. */
export function AppAlertsRow() {
  const { toast } = useApp();
  const { state, turnOn } = useAppAlerts();
  const ask = async () => {
    const s = await turnOn();
    if (s === "granted") toast("Order alerts are on for this phone");
    else if (s === "denied") toast(`Alerts are off for GT3PB in ${itsSettings()} — allow them there.`, "error");
    else if (s === "unavailable") toast("Couldn't ask this phone for alerts — try again", "error");
  };
  return (
    <div className="pay-row">
      <div className="pay-row-l">
        <div className="pay-row-t">Order alerts on this phone</div>
        <div className="pay-row-s">{says(state)}</div>
      </div>
      {state === "prompt" ? <button type="button" className="btn-sec btn-sm" onClick={ask}>Turn on</button>
        : state === "granted" ? <span className="k-tag ok">On</span>
        : state === "denied" ? <button type="button" className="btn-sec btn-sm" onClick={openSettings}>Open Settings</button>
        : null}
    </div>
  );
}

/** Live Ops, in the app: one line while this phone's alerts are off and could be on. */
export function AppAlertsOffLine({ children }: { children: (off: boolean) => ReactNode }) {
  const { state } = useAppAlerts();
  return <>{children(state === "prompt" || state === "denied")}</>;
}

/** Notifications, in the app: whether this phone shows alerts at all — the switches under it say which (R8, 2026-10-16: it
 *  promised "a ping when your order is ready" over an Order updates switch the member had turned off; it says what the
 *  web's row says now). */
export function AppAlertsProfile() {
  const { toast } = useApp();
  const { state, turnOn } = useAppAlerts();
  if (state === "unknown" || state === "unavailable") return null;
  const ask = async () => {
    const s = await turnOn();
    if (s === "granted") toast("Alerts are on for this phone");
    else if (s === "denied") toast(`Alerts are off for GT3PB in ${itsSettings()} — allow them there.`, "error");
  };
  return (
    <div className="prof-notif">
      <div className="prof-notif-t">Alerts on this phone</div>
      {state === "granted" ? (
        <div className="prof-notif-s on">On — this phone shows the alerts you leave on below.</div>
      ) : state === "denied" ? (
        <>
          <div className="prof-notif-s">Off for GT3PB in {itsSettings()} — allow them there to get the alerts below.</div>
          <button type="button" className="btn-sec btn-wide" onClick={openSettings}>Open Settings</button>
        </>
      ) : (
        <button type="button" className="btn-sec btn-wide" onClick={ask}>Turn on alerts on this phone</button>
      )}
    </div>
  );
}
