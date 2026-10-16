"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/components/AuthProvider";
import { useApp } from "@/components/AppProvider";
import Button from "@/components/Button";
import Icon from "@/components/Icon";
import { useAlertPermission } from "@/components/DeviceAlerts";
import { useAppAlerts } from "@/components/AppAlerts";
import { supabase } from "@/lib/supabase";
import { subscribePush } from "@/lib/push";
import { APP_BUILD, isNativeApp, publicOrigin } from "@/lib/native";
import { NATIVE_PUSH_ON } from "@/lib/nativePush";
import { clockTime } from "@/lib/dates";
import { fillCopy } from "@/lib/copy";

// REMIND ME WHEN CUP ORDERS OPEN (2026-10-13, R3 of the customer audit — board 04, approved). With the truck off, Today
// says when cup orders open; this is the one thing to do about it: a push at that minute (0394 keeps it, the minute's run
// sends it through the push function). Shown only where a push can land — the iPhone app once its alerts are live, or a
// browser that can take a push — and only once the phone has said yes; a button that cannot ring is not drawn (an
// iPhone's Safari tab, which has no web push, sees the stop and the time and nothing to tap).
//
// WHERE NO PUSH CAN LAND, A CALENDAR CAN (2026-10-15, R7 of the customer re-audit). An iPhone's Safari tab had nothing to
// tap at all. It offers the phone's calendar instead: the minute cup orders open, at the stop, with the menu's link —
// the same Add to calendar the events and the crew's stops use (lib/ics, components/AddToCalendar).
const AddToCalendar = dynamic(() => import("@/components/AddToCalendar"));
const OPEN_FOR_MS = 15 * 60 * 1000;

export default function RemindMe({ stopId, opensAt, stopName, where, t }: { stopId: string; opensAt: string; stopName?: string | null; where?: string | null; t: (k: string) => string }) {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const perm = useAlertPermission();      // the browser's answer ("unsupported" where there is no Notification)
  const app = useAppAlerts();             // the iPhone app's (null half on the web)
  const [kept, setKept] = useState<boolean | null>(null);     // null: not read yet
  const [unreadable, setUnreadable] = useState(false);          // the read failed (0394 not pasted): no button at all
  const [busy, setBusy] = useState(false);
  // The phone's half is there only in the app on a phone; the app's build opened in a plain browser (a test run) is the web.
  const [native] = useState(() => APP_BUILD && isNativeApp());
  const webPush = !native && perm !== "unknown" && perm !== "unsupported" && typeof window !== "undefined" && "PushManager" in window && "serviceWorker" in navigator;
  const appPush = native && NATIVE_PUSH_ON && app.state !== "unknown" && app.state !== "unavailable";
  // An answer from the phone that never comes (its half failed to load) is no answer: after 3 seconds, no button.
  const [waited, setWaited] = useState(false);
  useEffect(() => { const id = setTimeout(() => setWaited(true), 3000); return () => clearTimeout(id); }, []);
  // Is one kept for this stop? Read from the member's own rows; a read that fails (0394 not pasted yet) draws no button.
  // arrives-with: 0394 — cup_reminders and its two functions.
  useEffect(() => {
    if (!supabase || !user) return;
    let alive = true;
    supabase.from("cup_reminders").select("stop_id, fired_at").eq("stop_id", stopId).maybeSingle()
      .then(({ data, error }) => { if (!alive) return; if (error) setUnreadable(true); else setKept(!!data && !data.fired_at); });
    return () => { alive = false; };
  }, [user, stopId]);

  const at = clockTime(opensAt);
  const ask = async (): Promise<boolean> => {
    if (native) {
      const s = await app.turnOn();
      if (s !== "granted") { toast(t("today.remind_blocked"), "error"); return false; }
      return true;
    }
    let p: NotificationPermission;
    try { p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission; }
    catch { p = "denied"; }
    if (p !== "granted") { toast(t("today.remind_blocked"), "error"); return false; }
    if (!(await subscribePush(!!profile?.is_admin))) { toast("Couldn't save this phone for the reminder — try again.", "error"); return false; }
    return true;
  };
  const on = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      if (!(await ask())) return;
      const { error } = await supabase.rpc("keep_cup_reminder", { p_stop: stopId, p_at: opensAt });
      if (error) { toast(error.message, "error"); return; }
      setKept(true);
      toast(fillCopy(t("today.remind_said"), { time: at }));
    } finally { setBusy(false); }
  };
  const off = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("drop_cup_reminder", { p_stop: stopId });
      if (error) { toast(error.message, "error"); return; }
      setKept(false);
      toast(t("today.remind_off"), "info");
    } finally { setBusy(false); }
  };

  // Its room is kept while the answers come in (the phone's, then the row's), so the rows under it do not jump.
  const maybe = native ? NATIVE_PUSH_ON && app.state !== "unavailable" && !(app.state === "unknown" && waited) : webPush;
  // No push here (an iPhone's Safari tab; alerts the app can't have): the calendar, at the minute they open.
  const calendar = (
    <AddToCalendar label={fillCopy(t("today.remind"), { time: at })} ev={{
      uid: `cups-open-${stopId}@gt3pb`, title: `GT3 cup orders open${stopName ? ` — ${stopName}` : ""}`,
      start: new Date(opensAt), end: new Date(Date.parse(opensAt) + OPEN_FOR_MS), allDay: false,
      location: where ?? undefined, description: "Cup orders are open — pre-order in the GT3 app and skip the line.", url: `${publicOrigin()}/menu`,
    }} />
  );
  if (!maybe || unreadable) return calendar;
  if (kept === null || (native && app.state === "unknown")) return <div className="h-[50px]" aria-hidden="true" />;
  if (!(webPush || appPush)) return calendar;
  return kept
    ? <Button kind="secondary" wide aria-pressed="true" disabled={busy} onClick={() => { void off(); }}><Icon name="check" /> {fillCopy(t("today.remind_set"), { time: at })}</Button>
    : <Button kind="primary" wide disabled={busy} onClick={() => { void on(); }}><Icon name="bell" /> {fillCopy(t("today.remind"), { time: at })}</Button>;
}
