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
//      that stands in the way, in words they can act on, whether a membership will be cancelled, and a
//      company's weekly office order under their name, which stops (A3 of the account audit);
//   2. say plainly what goes and what stays, before the one red button;
//   3. delete (POST /api/account/erase), then sign this device out — the account no longer exists.
// The server does the deleting and every check; this only tells the truth about it — the database first, then
// what is outside it (2026-10-15, 0404): what the server couldn't finish outside is the crew's now, and said.

type Blocker = { code: string; message: string };
type Phase =
  | { at: "checking" }
  | { at: "blocked"; blockers: Blocker[] }
  | { at: "ready"; membership: boolean; office: string[] }
  | { at: "deleting"; membership: boolean; office: string[] }
  | { at: "failed"; message: string }
  // deleted — and a step is left: Apple could not be told (the person ends Sign in with Apple in Settings), or the
  // membership's cancel is still going through with Square (the crew has it)
  | { at: "after"; apple: boolean; membership: boolean };

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
        const office = Array.isArray(j.office) ? (j.office as unknown[]).map(String).filter(Boolean) : [];
        setPhase(blockers.length ? { at: "blocked", blockers } : { at: "ready", membership: !!j.membership, office });
      })
      .catch(() => { if (live) { haptic("error"); setPhase({ at: "failed", message: OFFLINE }); } });
    return () => { live = false; };
  }, [asked]);

  const erase = async (membership: boolean, office: string[]) => {
    haptic("heavy");
    setPhase({ at: "deleting", membership, office });
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
      // Signed in with Apple, and Apple's tokens could not be revoked from here (app/api/account/erase): the one
      // step left is theirs, in the iPhone's Settings (Apple's TN3194; support.apple.com/102571). And a membership
      // Square didn't confirm cancelled is the crew's now (0404 rings them): said, so nobody wonders.
      if (j.appleManual || j.membershipPending) { haptic("success"); setPhase({ at: "after", apple: !!j.appleManual, membership: !!j.membershipPending }); return; }
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

  if (phase.at === "after") {
    return (
      <div>
        <p className="cfm-body" role="status">Your account is deleted.</p>
        {phase.membership && (
          <p className="dp-hint">
            Your membership&rsquo;s cancellation is still going through with Square. We&rsquo;ve been told, and we&rsquo;ll
            make sure it doesn&rsquo;t bill again.
          </p>
        )}
        {phase.apple && (
          <p className="dp-hint">
            One last step, because you signed in with Apple: on your iPhone, open Settings, tap your name, then Sign in
            with Apple. Choose GT3 Performance Bar and tap Delete.
          </p>
        )}
        <div className="prod-actions cfm-actions">
          <button type="button" className="btn-pri" onClick={onDeleted}>Done</button>
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
        {phase.membership ? " Your membership is cancelled too, so it won't bill again." : ""}
      </p>

      {phase.office.length > 0 && (
        <>
          <div className="acs-group">Your office</div>
          <p className="dp-hint">
            {phase.office.join(" and ")}&rsquo;s weekly office order is under your name, so deleting stops it. We&rsquo;ll reach
            your company to set up a new contact.
          </p>
        </>
      )}

      <div className="acs-group">Kept, without your name</div>
      <p className="dp-hint">
        Your orders and payments stay in our books — a business keeps its sales records — with your name, phone, email
        and address taken out.
        {staff ? " Your work for GT3 stays without your name, and a signed agreement or offer letter stays as signed." : ""}
      </p>

      <div className="prod-actions cfm-actions">
        <button type="button" className="btn-ter" onClick={onKeep} disabled={busy}>Keep my account</button>
        <button type="button" className="btn-del" onClick={() => erase(phase.membership, phase.office)} disabled={busy}>
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </div>
    </div>
  );
}
