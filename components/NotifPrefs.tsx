"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStable } from "@/components/AppProvider";
import { fmt12 } from "@/lib/dates";
import Sheet, { CloseButton } from "@/components/Sheet";
import Icon from "@/components/Icon";
import { RingThisPhone } from "@/components/RingThisPhone";
import { withMuted, writeMuted } from "@/lib/notifMuted";
import { failureWords, plainFailure } from "@/lib/failureWords";

// Notification management (0177) — mute a category's non-critical pings, set a quiet window. Own-row
// prefs. Criticals always come through; this only quiets the rest.
//
// ONE SET OF CONTROLS, TWO DOORS (2026-10-06, the settings round). These lived inside the crew page,
// reachable only from the inbox's gear. Settings › You › Notifications opens them now, and the gear
// still opens them in a sheet — the same component both times. Every save writes the whole row, so two
// copies on screen must not disagree: a save tells the other copy (NOTIF_PREFS_EVENT), and it takes
// the saved row instead of writing its own stale one back over it later.
const NOTIF_CATS: { key: string; label: string }[] = [
  { key: "order", label: "Orders & the pass" },
  { key: "money", label: "Money & refunds" },
  { key: "brew", label: "Brew ladder" },
  { key: "prep", label: "Prep & tasks" },
  { key: "content", label: "Brand / content" },
  { key: "strategy", label: "Pipeline & strategy" },
];
/** The crew's own categories in a muted list — a member's switches (lib/customerNotify, R6) share the notif_prefs row and
 *  are kept by every save here, but are never counted as the crew's. */
export const crewMuted = (muted: readonly string[] | null | undefined): string[] => (muted ?? []).filter((k) => NOTIF_CATS.some((c) => c.key === k));
// QUIET HOURS ARE A PICK, NOT A NUMBER (2026-10-04, the form audit). They were two text boxes read
// with parseInt: "10pm" saved as 10 — ten in the MORNING — "7pm" as 7am, and "10:30" as 10, with
// "Saved" toasted on every blur whatever happened. notif_prefs.quiet_start/_end are hours 0–23 on
// the phone's own clock (lib/useMyAlerts.inQuietHours), so the pick is those 24 hours, written the
// way every other time in the app is (lib/dates.fmt12: "10:00pm").
const QUIET_HOURS = Array.from({ length: 24 }, (_, h) => h);
const quietHourLabel = (h: number): string => fmt12(`${h}:00`) ?? String(h);

/** window event: a copy of these controls saved. `detail` is the row as written. */
export const NOTIF_PREFS_EVENT = "gt3-notif-prefs";
export type NotifPrefsSaved = { userId: string; muted: string[]; qs: string; qe: string };

/** The mutes and the quiet window. Settings › You › Notifications, and the inbox gear's sheet — each
 *  door heads it with its own title (the Settings row, the sheet's header), so the line leads here. */
export function NotifPrefs({ userId }: { userId: string | null }) {
  const { toast } = useAppStable();
  const [muted, setMuted] = useState<string[]>([]);
  const [qs, setQs] = useState<string>("");
  const [qe, setQe] = useState<string>("");
  // Picking one end of an unset window fills the other with the usual night (10:00pm–7:00am, the
  // boxes' old placeholders); setting either end to Off turns the window off.
  //
  // A FAILED READ IS NOT AN EMPTY LIST. Every save writes the whole row, so saving over prefs this
  // sheet could not read would unmute everything the person had muted. Until the read answers,
  // nothing here can be changed; if it fails, the sheet says so and stays read-only.
  const [read, setRead] = useState<"loading" | "ok" | "failed">("loading");
  // Settings is a page, not a sheet you can close and open again, so a failed read offers its own
  // retry: each tap of Try again is one more read.
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!supabase || !userId) return;
    supabase.from("notif_prefs").select("muted_categories, quiet_start, quiet_end").eq("user_id", userId).maybeSingle()
      .then(({ data, error }) => {
        if (error) { setRead("failed"); return; }
        const p = data as { muted_categories?: string[]; quiet_start?: number | null; quiet_end?: number | null } | null;
        if (p) { setMuted(p.muted_categories ?? []); setQs(p.quiet_start != null ? String(p.quiet_start) : ""); setQe(p.quiet_end != null ? String(p.quiet_end) : ""); }
        setRead("ok");
      });
  }, [userId, tries]);
  // Another copy saved: take what it wrote. A copy that could not read stays locked — it still does
  // not know the row, only this one change to it.
  useEffect(() => {
    const onSaved = (e: Event) => {
      const s = (e as CustomEvent<NotifPrefsSaved>).detail;
      if (!s || s.userId !== userId) return;
      setMuted(s.muted); setQs(s.qs); setQe(s.qe);
    };
    window.addEventListener(NOTIF_PREFS_EVENT, onSaved);
    return () => window.removeEventListener(NOTIF_PREFS_EVENT, onSaved);
  }, [userId]);
  // EACH SAVE WRITES ITS OWN CHANGE (R8, 2026-10-16; lib/notifMuted). The whole row went back on every tap — the muted
  // list as this screen read it, hours ago perhaps, the member's own switches in it (lib/customerNotify) — so turning a
  // category off here turned Order updates back on if they had turned it off on their phone since. A category's tap now
  // changes that category in the list as it is now; the quiet hours' pick sends the quiet hours alone.
  const told = (m: string[], nqs: string, nqe: string) =>
    window.dispatchEvent(new CustomEvent<NotifPrefsSaved>(NOTIF_PREFS_EVENT, { detail: { userId: userId ?? "", muted: m, qs: nqs, qe: nqe } }));
  // One category's write at a time (R8): two taps a moment apart each read the list before the other wrote, and the second
  // write took the first one's change back out. The categories wait for the one in flight, as the member's switches do.
  const [writing, setWriting] = useState(false);
  const toggle = async (k: string) => {
    if (!supabase || !userId || read !== "ok" || writing) return;
    setWriting(true);
    const before = muted;
    const mute = !muted.includes(k);   // what they saw, turned over
    setMuted(withMuted(muted, k, mute));
    const r = await writeMuted(supabase, userId, (fresh) => withMuted(fresh, k, mute), { updated_at: new Date().toISOString() })
      .catch((e: unknown) => ({ muted: null, error: e instanceof Error ? plainFailure(e) : "the connection dropped" }) as const);
    setWriting(false);
    if (r.error !== null) { setMuted(before); toast(`Couldn't save — ${plainFailure(r.error)}`, "error"); return; }
    setMuted(r.muted);
    told(r.muted, qs, qe);
  };
  const setQuiet = async (nqs: string, nqe: string) => {
    if (!supabase || !userId || read !== "ok") return;
    const before = [qs, qe];
    setQs(nqs); setQe(nqe);
    const { error } = await supabase.from("notif_prefs").upsert({ user_id: userId,
      quiet_start: nqs === "" ? null : Number(nqs), quiet_end: nqe === "" ? null : Number(nqe), updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) { setQs(before[0]); setQe(before[1]); toast(failureWords(error, "Couldn't save"), "error"); return; }
    told(muted, nqs, nqe);
    toast(nqs !== "" && nqe !== "" && nqs !== nqe ? `Quiet ${quietHourLabel(Number(nqs))}–${quietHourLabel(Number(nqe))}` : "Quiet hours off");
  };
  const locked = read !== "ok";
  const halfSet = (qs === "") !== (qe === "");
  const intro = "Quiet the categories you don’t need. Critical alerts always come through.";
  return (
    <>
      <p className="h-sub" style={{ marginTop: 0 }}>{intro}</p>
      {read === "failed" && (
        <div className="dp-err" role="alert">
          Couldn&rsquo;t read your notification settings, so nothing here can be changed right now.{" "}
          <button type="button" className="btn-ter" onClick={() => setTries((n) => n + 1)}>Try again</button>
        </div>
      )}
      <div className="notif-cats">
        {NOTIF_CATS.map((c) => (
          <button key={c.key} type="button" className={`notif-cat${muted.includes(c.key) ? " muted" : ""}`} onClick={() => toggle(c.key)} aria-pressed={muted.includes(c.key)} disabled={locked || writing}>
            <span>{c.label}</span><span className="notif-cat-s">{muted.includes(c.key) ? "🔕 Muted" : <><Icon name="bell" /> On</>}</span>
          </button>
        ))}
      </div>
      <div className="notif-quiet">
        <span className="adm-prep-label">Quiet hours (optional)</span>
        <p className="h-sub" style={{ margin: "0 0 8px" }}>During these hours, non-critical alerts are held into a morning digest instead of pinging you — they surface on their own when quiet hours end. Critical alerts always come through.</p>
        <div className="notif-quiet-r">
          <label>From<select value={qs} disabled={locked} onChange={(e) => (e.target.value === "" ? setQuiet("", "") : setQuiet(e.target.value, qe === "" ? "7" : qe))}>
            <option value="">Off</option>
            {QUIET_HOURS.map((h) => <option key={h} value={String(h)}>{quietHourLabel(h)}</option>)}
          </select></label>
          <label>to<select value={qe} disabled={locked} onChange={(e) => (e.target.value === "" ? setQuiet("", "") : setQuiet(qs === "" ? "22" : qs, e.target.value))}>
            <option value="">Off</option>
            {QUIET_HOURS.map((h) => <option key={h} value={String(h)}>{quietHourLabel(h)}</option>)}
          </select></label>
          <span className="notif-quiet-h">{halfSet ? "set both ends to turn it on" : qs !== "" && qs === qe ? "the same hour at both ends is off" : "on this phone’s clock"}</span>
        </div>
      </div>
    </>
  );
}

/** The inbox gear's door to the same controls — with "Ring this phone" first (2026-10-11): the inbox is where someone
 *  wonders whether their phone will ring for the next alert. */
export function NotifPrefsSheet({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} label="Notifications" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "var(--sans)", fontSize: 15 }}>Notifications</b><CloseButton onClick={onClose} /></div>}>
      <div className="mb-3"><RingThisPhone /></div>
      <NotifPrefs userId={userId} />
    </Sheet>
  );
}
