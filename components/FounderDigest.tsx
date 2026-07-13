"use client";

import { useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";

// Owner control for the founder digest (0208). Sets the cadence on the live_status singleton (the
// pg_cron job honors it) and offers a "Send digest now" button that emails/texts the founders on
// demand via /api/cron/digest. Mirrors OfficeSettings' live_status read/write pattern.
type Cadence = "off" | "daily" | "weekly";
const LABELS: Record<Cadence, string> = { off: "Off", daily: "Daily", weekly: "Weekly" };

export default function FounderDigest() {
  const { toast } = useApp();
  const [cadence, setCadence] = useState<Cadence>("daily");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.from("live_status").select("digest_cadence").eq("id", 1).maybeSingle().then(({ data }) => {
      setCadence((data as { digest_cadence?: Cadence } | null)?.digest_cadence ?? "daily");
      setLoaded(true);
    });
  }, []);

  const change = async (c: Cadence) => {
    if (!supabase || busy) return;
    setCadence(c); setBusy(true);
    const { error } = await supabase.from("live_status").update({ digest_cadence: c }).eq("id", 1);
    setBusy(false);
    toast(error ? "Couldn't save — try again" : `Digest ${LABELS[c].toLowerCase()}`, error ? "error" : undefined);
  };

  const sendNow = async () => {
    if (sending) return;
    setSending(true);
    try {
      const r = await authedFetch("/api/cron/digest", { method: "POST" });
      const j = await r.json();
      if (j.ok) toast(`Digest sent to ${j.sent} founder${j.sent === 1 ? "" : "s"}`);
      else toast(`Couldn't send — ${j.error ?? "try again"}`, "error");
    } catch { toast("Couldn't send — try again", "error"); }
    setSending(false);
  };

  if (!loaded) return null;
  return (
    <div className="fdig">
      <p className="fdig-note">A once-a-day roll-up — all-channel revenue, launch readiness, open blockers, reorders, and what needs you — for the founders. Daily/weekly also land in the Inbox automatically; use Send now for an email + text right away.</p>
      <div className="fdig-cad" role="group" aria-label="Digest cadence">
        {(["off", "daily", "weekly"] as Cadence[]).map((c) => (
          <button key={c} type="button" className={`fdig-opt${cadence === c ? " on" : ""}`} onClick={() => change(c)} disabled={busy} aria-pressed={cadence === c}>{LABELS[c]}</button>
        ))}
      </div>
      <button type="button" className="note-save" onClick={sendNow} disabled={sending}>{sending ? "Sending…" : "Send digest now"}</button>
    </div>
  );
}
