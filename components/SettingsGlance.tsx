"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { squareClientReady } from "@/lib/square";
import { useWorkStreams } from "@/lib/streams";
import { useDisplay } from "@/components/DisplayToggle";
import { NOTIF_PREFS_EVENT, type NotifPrefsSaved } from "@/components/NotifPrefs";
import { useOutlookStatus } from "@/components/OutlookConnect";
import { payGlance, dialGlance, officeGlance, digestGlance, displayGlance, notifyGlance, lanesGlance, outlookGlance, UNREAD, type Glance } from "@/lib/settingsGlance";

// THE VALUES ON SETTINGS' ROWS (2026-10-06, the settings round). lib/settingsGlance has the words;
// this reads what they describe:
//   · live_status, once, for the four business rows it sets — and its changes, so a switch flipped in
//     a row's own panel, or on another phone, is the row's value at once;
//   · the person's own notification row, and every save of it (NOTIF_PREFS_EVENT);
//   · the lanes (lib/streams), counted only once the table has answered — its stand-in rows own nothing;
//   · this phone's display preference.
// The business reads run for an owner or an admin only: nobody else is drawn the rows they sit on.
// A read that failed says "Couldn’t read" on its rows (lib/settingsGlance UNREAD), never nothing and
// never a guess.
// Outlook's value is its own component (OutlookGlance) because only the owner's row draws it.

type LiveRow = { pay_at_pickup?: boolean | null; preorder_lead_h?: number | null; office_price_cents?: number | null; office_min_gallons?: number | null; digest_cadence?: string | null };

export type SettingsGlances = { notify: Glance; display: Glance; digest: Glance; pay: Glance; dial: Glance; office: Glance; lanes: Glance };

export function useSettingsGlance(userId: string | null, isAdmin: boolean): SettingsGlances {
  // select("*"), as PaymentSettings reads it: a column a database has not been given yet reads as unset
  // instead of failing the whole row.
  const liveLoader = useCallback(async (): Promise<LiveRow | null> => {
    if (!supabase || !isAdmin) return null;
    const { data, error } = await supabase.from("live_status").select("*").eq("id", 1).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as LiveRow | null) ?? {};
  }, [isAdmin]);
  const live = useAsyncData(liveLoader, [liveLoader]);
  useRealtimeTable("live_status", live.reload, { enabled: isAdmin });
  const row = live.data;
  const read = row !== null;
  const failed = live.status === "error"; // a first read that failed; a later one keeps the last answer

  const [notif, setNotif] = useState<{ muted: string[]; qs: number | null; qe: number | null } | null>(null);
  const [notifFailed, setNotifFailed] = useState(false);
  useEffect(() => {
    if (!supabase || !userId) return;
    let gone = false, saved = false;
    supabase.from("notif_prefs").select("muted_categories, quiet_start, quiet_end").eq("user_id", userId).maybeSingle()
      .then(({ data, error }) => {
        if (gone || saved) return; // a save that landed first is newer than this read
        if (error) { setNotifFailed(true); return; }
        const p = data as { muted_categories?: string[] | null; quiet_start?: number | null; quiet_end?: number | null } | null;
        setNotif({ muted: p?.muted_categories ?? [], qs: p?.quiet_start ?? null, qe: p?.quiet_end ?? null });
      });
    const onSaved = (e: Event) => {
      const s = (e as CustomEvent<NotifPrefsSaved>).detail;
      if (!s || s.userId !== userId) return;
      saved = true;
      setNotifFailed(false);
      setNotif({ muted: s.muted, qs: s.qs === "" ? null : Number(s.qs), qe: s.qe === "" ? null : Number(s.qe) });
    };
    window.addEventListener(NOTIF_PREFS_EVENT, onSaved);
    return () => { gone = true; window.removeEventListener(NOTIF_PREFS_EVENT, onSaved); };
  }, [userId]);

  const streams = useWorkStreams();
  const lanesRead = streams.some((s) => !!s.id);
  const display = useDisplay();

  const biz = (g: Glance): Glance => (failed ? UNREAD : g);
  return {
    notify: notif ? notifyGlance(notif.muted, notif.qs, notif.qe) : notifFailed ? UNREAD : null,
    display: displayGlance(display),
    digest: biz(digestGlance(row?.digest_cadence, read)),
    pay: biz(read ? payGlance(squareClientReady, row?.pay_at_pickup !== false) : null),
    dial: biz(dialGlance(row?.preorder_lead_h, read)),
    office: biz(officeGlance(row?.office_price_cents, row?.office_min_gallons, read)),
    lanes: lanesRead ? lanesGlance(streams.filter((s) => !!s.owner_user_id).length, streams.length) : null,
  };
}

/** A row's value, or nothing. A value that needs attention ("No way to pay") says so in colour. */
export function GlanceText({ g }: { g: Glance }) {
  if (!g) return null;
  return <span className={g.warn ? "mpanel-warn" : undefined}>{g.text}</span>;
}

/** Outlook's row value — the owner's row only, so its read is the owner's only. */
export function OutlookGlance() {
  const st = useOutlookStatus();
  return <GlanceText g={st.status === "error" ? UNREAD : st.status === "ready" ? outlookGlance(st.data) : null} />;
}
