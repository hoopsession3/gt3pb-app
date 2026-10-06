"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/authedFetch";
import { useAsyncData } from "@/lib/useAsyncData";
import { readParam, dropParam } from "@/lib/urlParam";
import { useConfirm } from "./ConfirmSheet";
import AsyncSection from "./AsyncSection";

// OUTLOOK — the owner's two-way calendar sync (/api/outlook/*, all owner-only).
//
// CONNECTING IS A SETTING (2026-10-06, the settings round). Connect and Disconnect sat in a bar under
// the company calendar, beside Sync now. Connecting an account changes how a feature works, so it
// lives in Settings › Integrations now, next to the status of everything else that is connected. The
// calendar keeps Sync now — that is a thing you do to the calendar — and a line to here.
//
// Microsoft sends the browser back to /crew?s=settings&a=set-outlook&outlook=connected (or =error)
// when the consent screen is done (app/api/outlook/callback). The word is read on this panel's first
// render and taken off the address after, so a refresh does not say it again (lib/urlParam).

export type OutlookStatus = { configured: boolean; connected: boolean; account: string | null; last_sync: string | null; last_note: string | null };

/** window event: Outlook was disconnected here — every status on screen reads again. (Connecting
 *  leaves the page for Microsoft's consent screen, so the page that comes back reads it fresh.) */
export const OUTLOOK_CHANGED_EVENT = "gt3-outlook-changed";

/** Outlook's status for the owner. A refused or failed read is an error, never "not connected".
 *  Drawn twice in Settings — the Outlook row's value and its panel — so a disconnect tells both. */
export function useOutlookStatus() {
  const loader = useCallback(async (): Promise<OutlookStatus> => {
    const r = await authedFetch("/api/outlook/status");
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Outlook's status didn't answer");
    return { configured: !!j.configured, connected: !!j.connected, account: j.account ?? null, last_sync: j.last_sync ?? null, last_note: j.last_note ?? null };
  }, []);
  const state = useAsyncData(loader, []);
  const { reload } = state;
  useEffect(() => {
    window.addEventListener(OUTLOOK_CHANGED_EVENT, reload);
    return () => window.removeEventListener(OUTLOOK_CHANGED_EVENT, reload);
  }, [reload]);
  return state;
}

/** The line under the status: who is connected, when it last synced, and what that sync said. */
export const outlookLine = (st: OutlookStatus): string =>
  `${st.account || "Connected"}${st.last_sync ? ` · last sync ${new Date(st.last_sync).toLocaleString()}` : ""}${st.last_note ? ` · ${st.last_note}` : ""}`;

const RETURNED: Record<string, string> = {
  connected: "Outlook connected.",
  error: "Couldn't connect Outlook — try again.",
};

/** Settings › Integrations › Outlook: connect, or see who is connected and disconnect. */
export default function OutlookConnect() {
  const confirm = useConfirm();
  const state = useOutlookStatus();
  const [busy, setBusy] = useState<"connect" | "dc" | null>(null);
  const [msg, setMsg] = useState<string | null>(() => RETURNED[readParam("outlook") ?? ""] ?? null);
  useEffect(() => { dropParam("outlook"); }, []);

  const connect = async () => {
    setBusy("connect"); setMsg(null);
    try {
      const r = await authedFetch("/api/outlook/connect");
      const j = await r.json();
      if (j.ok && j.url) { window.location.href = j.url; return; }
      setMsg(j.error || "Couldn't start Outlook connect.");
    } catch { setMsg("Couldn't reach the server — try again."); }
    setBusy(null);
  };
  const disconnect = async () => {
    if (!(await confirm({ title: "Disconnect Outlook?", body: "Two-way sync stops. Nothing already on the calendar is removed.", confirmLabel: "Disconnect" }))) return;
    setBusy("dc"); setMsg(null);
    try {
      const r = await authedFetch("/api/outlook/disconnect", { method: "POST" });
      setMsg(r.ok ? "Outlook disconnected." : "Couldn't disconnect Outlook — try again.");
    } catch { setMsg("Couldn't reach the server — try again."); }
    setBusy(null);
    window.dispatchEvent(new Event(OUTLOOK_CHANGED_EVENT)); // this panel's status and the row's value read again
  };

  return (
    <AsyncSection state={state} isEmpty={() => false} emptyTitle="Nothing to show" loadingLabel="Checking Outlook…" errorTitle="Couldn't check Outlook">
      {/* The row above it says "Outlook calendar" and its state (components/SettingsGlance), so the
          panel says only what to do — no second title and state pill in a card inside the row. */}
      {(st) => (
        <div className="ol-set">
          {!st.configured && <div className="ol-note">It can&rsquo;t connect yet: it needs the one-time Microsoft app setup on the server, a developer&rsquo;s job.</div>}
          {st.configured && !st.connected && <button type="button" className="ol-btn primary" onClick={connect} disabled={busy === "connect"}>{busy === "connect" ? "Opening Microsoft…" : "Connect Outlook"}</button>}
          {st.connected && (
            <>
              <div className="ol-note">{outlookLine(st)}</div>
              <div className="ol-acts">
                <button type="button" className="ol-btn" onClick={disconnect} disabled={busy === "dc"}>Disconnect</button>
              </div>
            </>
          )}
          {msg && <div className="ol-msg">{msg}</div>}
        </div>
      )}
    </AsyncSection>
  );
}
