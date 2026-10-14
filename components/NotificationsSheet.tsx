"use client";

import { useEffect, useState } from "react";
import Sheet, { CloseButton } from "./Sheet";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import Icon, { type IconName } from "./Icon";
import TextsSetting from "./TextsSetting";
import { AppAlertsProfile } from "./AppAlerts";
import { useLivePing } from "./useLivePing";
import { supabase } from "@/lib/supabase";
import { subscribePush } from "@/lib/push";
import { NATIVE_PUSH_ON } from "@/lib/nativePush";
import { haptic } from "@/lib/haptics";
import { ALWAYS_SENT, CUSTOMER_KINDS, kindMuted, withKind, type CustomerKind } from "@/lib/customerNotify";

// NOTIFICATIONS, ONE SCREEN (2026-10-14, R6 of the customer audit — decided by Ryan: every kind but receipts). The account
// had one switch, the truck-live chip on Find Us; order alerts stopped only in the phone's own Settings, the emails not at
// all. Here, from the account menu (Settings & privacy) and the account page:
//   · this phone — whether it may show alerts at all (the browser's or the iPhone app's own permission);
//   · a switch per kind — order updates and pickup reminders (the account's, lib/customerNotify: push, email and text
//     alike), truck live (this device's, components/useLivePing) and texts (components/TextsSetting, the number's yes);
//   · what always comes: receipts, and any change to an order already paid for.
// The server reads the same switches before it sends (lib/notify customerMuted, supabase/functions/push).
const KIND_ICON: Record<CustomerKind, IconName> = { order_updates: "package", pickup_reminders: "calendar" };
const NOTE = "mx-0.5 mt-3.5 text-caption leading-normal text-cream-muted";

export default function NotificationsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} label="Notifications"
      header={<div className="flex items-center"><span className="isheet-title">Notifications</span><CloseButton onClick={onClose} className="isheet-x ml-auto" /></div>}>
      <NotificationsBody />
    </Sheet>
  );
}

function NotificationsBody() {
  const { user } = useAuth();
  const { toast } = useApp();
  // Theirs, as notif_prefs keeps it (own-row RLS, 0177): null until the read answers — a switch drawn before then would
  // say "on" for something they had turned off.
  const [muted, setMuted] = useState<string[] | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [busy, setBusy] = useState<CustomerKind | null>(null);
  useEffect(() => {
    if (!supabase || !user) return;
    let live = true;
    supabase.from("notif_prefs").select("muted_categories").eq("user_id", user.id).maybeSingle()
      .then(({ data, error }) => {
        if (!live) return;
        if (error) { setReadFailed(true); return; }
        setMuted(((data as { muted_categories?: string[] | null } | null)?.muted_categories) ?? []);
      });
    return () => { live = false; };
  }, [user]);

  const flip = async (kind: CustomerKind, title: string) => {
    if (!supabase || !user || muted === null || busy) return;
    const on = kindMuted(muted, kind);              // it is off now, so the tap turns it on
    const next = withKind(muted, kind, on);
    setBusy(kind);
    // Only muted_categories is sent, so a crew member's quiet hours on the same row stay as they were.
    const { error } = await supabase.from("notif_prefs").upsert({ user_id: user.id, muted_categories: next }, { onConflict: "user_id" });
    setBusy(null);
    if (error) { toast("Couldn't change it — try again.", "error"); return; }
    setMuted(next);
    if (on) haptic("toggleOn"); else haptic("toggleOff");
    toast(`${title} ${on ? "on" : "off"}`);
  };

  return (
    <div>
      <ThisPhone />
      {user && (
        <div className="rows mt-3.5" role="group" aria-label="What you hear about">
          {CUSTOMER_KINDS.map((k) => {
            const on = muted !== null && !kindMuted(muted, k.key);
            return (
              <div key={k.key} className="row" aria-label={k.title}>
                <div className="ri"><Icon name={KIND_ICON[k.key]} /></div>
                <div className="rl"><b>{k.title}</b><span>{k.sub}</span></div>
                <button type="button" role="switch" aria-checked={on} aria-label={k.title} className={`k-switch${on ? " on" : ""}`}
                  onClick={() => flip(k.key, k.title)} disabled={muted === null || busy !== null}>
                  <span className="k-switch-k" />
                </button>
              </div>
            );
          })}
          <TruckLive />
          <TextsSetting />
        </div>
      )}
      {!user && <div className="rows mt-3.5"><TruckLive /></div>}
      {readFailed && <p className={NOTE} role="status">Couldn&rsquo;t read your choices just now — close this and open it again.</p>}
      <p className={NOTE}>{ALWAYS_SENT}</p>
    </div>
  );
}

/** The go-live ping, this device's own — the same as Find Us's chip, as a switch. Nothing where push can't work here. */
function TruckLive() {
  const { state, toggle } = useLivePing();
  if (state === "hidden") return null;
  const on = state === "on";
  return (
    <div className="row" aria-label="Truck live">
      <div className="ri"><Icon name="truck" /></div>
      <div className="rl"><b>Truck live</b><span>When the truck starts pouring · this device</span></div>
      <button type="button" role="switch" aria-checked={on} aria-label="Truck live" className={`k-switch${on ? " on" : ""}`} onClick={toggle} disabled={state === "busy"}>
        <span className="k-switch-k" />
      </button>
    </div>
  );
}

/** Whether this phone may show alerts at all: the iPhone app's own permission, or the browser's. Moved here from the
 *  profile sheet (R6) — it is a notification, not a profile. A browser with none shows nothing: a button that cannot work
 *  is worse than no button. */
function ThisPhone() {
  const { profile } = useAuth();
  const { toast } = useApp();
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  if (NATIVE_PUSH_ON) return <AppAlertsProfile />;
  if (perm === "unsupported") return null;
  const turnOn = async () => {
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") return;
      // "On" only once the database has kept this phone (lib/push, 0366).
      if (await subscribePush(!!profile?.is_admin)) toast("Alerts are on for this phone");
      else toast("Couldn't save this phone for alerts — try again", "error");
    } catch { /* ignore */ }
  };
  return (
    <div className="prof-notif">
      <div className="prof-notif-t">Alerts on this phone</div>
      {perm === "granted" ? (
        <div className="prof-notif-s on"><Icon name="check" /> On — this phone shows the alerts you leave on below.</div>
      ) : perm === "denied" ? (
        <div className="prof-notif-s">Blocked in your phone&rsquo;s settings — allow notifications for this app to get them.</div>
      ) : (
        <button type="button" className="btn-sec btn-wide" onClick={turnOn}><Icon name="bell" /> Turn on alerts on this phone</button>
      )}
    </div>
  );
}
