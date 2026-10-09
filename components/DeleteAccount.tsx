"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/authedFetch";
import { haptic } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";

// DELETE YOUR ACCOUNT — the body of the account sheet when its "Delete account" row is tapped
// (components/AccountSheet.tsx swaps it in under the same header, so there is one sheet, one way to
// close it, and "Keep my account" goes back to the menu).
//
// App Store Review Guideline 5.1.1(v): an app that lets people make an account must let them delete
// it, in the app, without an email to send or a number to call. Apple allows a confirmation step and
// asks that people be told what is kept and why. So, in order:
//   1. ask the server what deleting would mean for this account (GET /api/account/erase) — anything
//      that stands in the way, in words they can act on, and whether a membership will be cancelled;
//   2. say plainly what goes and what stays, before the one red button;
//   3. delete (POST /api/account/erase), then sign this device out — the account no longer exists.
// The server does the deleting and every check; this only tells the truth about it.

type Blocker = { code: string; message: string };
type Phase =
  | { at: "checking" }
  | { at: "blocked"; blockers: Blocker[] }
  | { at: "ready"; membership: boolean }
  | { at: "deleting"; membership: boolean }
  | { at: "failed"; message: string };

const OFFLINE = "You're offline. Connect, then try again.";

export default function DeleteAccount({ staff, onKeep, onDeleted }: {
  staff: boolean;
  onKeep: () => void;
  onDeleted: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ at: "checking" });
  const [asked, setAsked] = useState(0);   // "Try again" asks once more

  useEffect(() => {
    let live = true;
    authedFetch("/api/account/erase")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) { haptic("error"); setPhase({ at: "failed", message: j.error || "We couldn't check your account just now. Try again in a minute." }); return; }
        const blockers: Blocker[] = Array.isArray(j.blockers) ? j.blockers : [];
        setPhase(blockers.length ? { at: "blocked", blockers } : { at: "ready", membership: !!j.membership });
      })
      .catch(() => { if (live) { haptic("error"); setPhase({ at: "failed", message: OFFLINE }); } });
    return () => { live = false; };
  }, [asked]);

  const erase = async (membership: boolean) => {
    haptic("heavy");
    setPhase({ at: "deleting", membership });
    try {
      const r = await authedFetch("/api/account/erase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409 && Array.isArray(j.blockers) && j.blockers.length) { haptic("error"); setPhase({ at: "blocked", blockers: j.blockers }); return; }
      if (!r.ok) { haptic("error"); setPhase({ at: "failed", message: j.error || "We couldn't delete your account just now. Nothing was deleted — try again in a minute." }); return; }
      // The account is gone on the server, and its sessions with it: forget this device's copy too.
      await supabase?.auth.signOut({ scope: "local" }).catch(() => undefined);
      onDeleted();
    } catch {
      haptic("error");
      setPhase({ at: "failed", message: OFFLINE });
    }
  };

  if (phase.at === "checking") {
    return <p className="dp-hint" role="status">Checking your account…</p>;
  }

  if (phase.at === "blocked") {
    return (
      <div>
        <p className="cfm-body">Not yet.</p>
        {phase.blockers.map((b) => <p key={b.code} className="dp-hint">{b.message}</p>)}
        <div className="prod-actions cfm-actions">
          <button type="button" className="btn-pri" onClick={onKeep}>Back to your account</button>
        </div>
      </div>
    );
  }

  if (phase.at === "failed") {
    return (
      <div>
        <p className="cfm-body" role="alert">{phase.message}</p>
        <div className="prod-actions cfm-actions">
          <button type="button" className="note-arch" onClick={onKeep}>Back</button>
          <button type="button" className="btn-pri" onClick={() => { setPhase({ at: "checking" }); setAsked((n) => n + 1); }}>Try again</button>
        </div>
      </div>
    );
  }

  const busy = phase.at === "deleting";
  return (
    <div>
      <p className="cfm-body">This deletes your GT3 account for good. It can&rsquo;t be undone.</p>

      <div className="acs-group">Deleted</div>
      <p className="dp-hint">
        Your profile and photo; your name, email and phone; your reviews, RSVPs and VIP proof; your Primal progress;
        your points and store credit; and your saved settings.
        {phase.membership ? " Your membership is cancelled first, so it won't bill again." : ""}
      </p>

      <div className="acs-group">Kept, without your name</div>
      <p className="dp-hint">
        Your orders and payments stay in our books — a business keeps its sales records — with your name, phone, email
        and address taken out.
        {staff ? " Your work for GT3 stays without your name, and a signed agreement or offer letter stays as signed." : ""}
      </p>

      <div className="prod-actions cfm-actions">
        <button type="button" className="btn-ter" onClick={onKeep} disabled={busy}>Keep my account</button>
        <button type="button" className="btn-del" onClick={() => erase(phase.membership)} disabled={busy}>
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </div>
    </div>
  );
}
