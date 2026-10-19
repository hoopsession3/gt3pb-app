"use client";

import { useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authedFetch";
import { haptic } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { markSigninAsked, takeSigninAsked } from "@/lib/linkSignin";
import { isNativeApp, nativePlatform } from "@/lib/native";
import { claimsOf, provedWithin, PROVED_FOR_S } from "@/lib/freshProof";
// The provider, imported here as well as by the sheet that opens this (R28, measured): without it, every route's shared
// download regrouped into one chunk more (+0.92 KB gzipped) — the same modules, split differently.
import { useAuth } from "./AuthProvider";
import Said from "./Said";

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
//   3. prove it's them, just now (R27, 2026-10-18 — the 10/10 audit, security F7; Ryan: "Yes, a fresh code"): the red
//      button emails an 8-digit code — Supabase's own, the one the sign-in screen asks for — and the delete goes when it
//      is entered. A phone left unlocked, or lent for a minute, can't delete its owner's account. An account that signs
//      in with Apple can confirm with Apple's sheet on the iPhone instead (Face ID) — first, when its email is Apple's
//      relay, which a code may never reach. Proved in the last few minutes already (lib/freshProof), no second code: the
//      server is the judge either way, and answers "prove" when it isn't;
//   4. delete (POST /api/account/erase), then sign this device out — the account no longer exists.
// The server does the deleting and every check; this only tells the truth about it — the database first, then
// what is outside it (2026-10-15, 0404): what the server couldn't finish outside is the crew's now, and said.

type Blocker = { code: string; message: string };
type Phase =
  | { at: "checking" }
  | { at: "blocked"; blockers: Blocker[] }
  | { at: "ready"; membership: boolean; office: string[] }
  // the code (or Apple's sheet) before the delete goes (R27)
  | { at: "prove"; membership: boolean; office: string[] }
  // `proving`: sent from the code's screen, which stays up while it goes
  | { at: "deleting"; membership: boolean; office: string[]; proving: boolean }
  | { at: "failed"; message: string }
  // deleted — and a step is left: Apple could not be told (the person ends Sign in with Apple in Settings), or the
  // membership's cancel is still going through with Square (the crew has it)
  | { at: "after"; apple: boolean; membership: boolean };

const OFFLINE = "You're offline. Connect, then try again.";
const MIN_CODE = 6;
const CODE_LEN = 8;   // Supabase › Authentication › Email › Email OTP length (components/SignIn and AppleLink say the same)
const RESEND_S = 30;
const NO_PROOF = "To delete this account, open the GT3 app on the iPhone you signed in with, and confirm with Apple there.";

/** Proved in the last few minutes on this device (lib/freshProof) — a minute short of the server's window, so a delete
 *  sent now lands inside it. */
async function provedLately(): Promise<boolean> {
  if (!supabase) return false;
  const s = (await supabase.auth.getSession()).data.session;
  return !!s && provedWithin(claimsOf(s.access_token), Date.now(), PROVED_FOR_S - 60);
}

export default function DeleteAccount({ staff, onKeep, onDeleted, onBusy }: {
  staff: boolean;
  onKeep: () => void;
  onDeleted: () => void;
  /** While the delete is out (R8): the sheet around it holds still until it answers. */
  onBusy?: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ at: "checking" });
  const [asked, setAsked] = useState(0);   // "Try again" asks once more
  useEffect(() => { onBusy?.(phase.at === "deleting"); }, [phase.at, onBusy]);
  // Who is proving it (R27): the account's own email gets the code; its Apple ID, on the iPhone, can answer instead.
  const { user } = useAuth();
  const email = user?.email ?? "";
  const appleHere = !!user?.identities?.some((i) => i.provider === "apple") && isNativeApp() && nativePlatform() === "ios";
  const relay = /@privaterelay\.appleid\.com$/i.test(email);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);   // a code went to the email on this step
  const [resent, setResent] = useState(false);   // …and a newer one since
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const going = useRef(false);   // the red button's first tap, until its step is up: a second tap sends no second code
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  // Each step is read where it appears (R8): the button pressed is gone with the step, and focus with it — so it moves to
  // the words that replaced it, and a screen reader says why deleting was refused, or what is left. The code's step is
  // the code field's: it has the caret, and its words are read with it (aria-describedby).
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase.at === "prove") codeRef.current?.focus({ preventScroll: true });
    else if (phase.at !== "checking" && phase.at !== "deleting") top.current?.focus({ preventScroll: true });
  }, [phase.at]);

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

  // A code to the account's email (R27). True when it went. Its link opens a sign-in too — this device asked for it.
  const sendCode = async (): Promise<boolean> => {
    if (!supabase || !email || sending) return false;
    setSending(true); setCodeErr("");
    markSigninAsked();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }).catch(() => ({ error: { status: 0, message: "", name: "AuthRetryableFetchError" } }));
    setSending(false);
    if (error) {
      haptic("error");
      setCodeErr(error.name === "AuthRetryableFetchError" || error.status === 0 ? OFFLINE
        : error.status === 429 || /security purposes|rate limit/i.test(error.message)
          ? "A code went out a moment ago — enter that one, or send a new one in a minute."
          : "We couldn't send a code just now. Try again in a minute.");
      return false;
    }
    setCode(""); setResent(sent); setSent(true); setCooldown(RESEND_S);
    return true;
  };

  // The red button under what goes and what stays: proof first (R27).
  const prove = async (membership: boolean, office: string[]) => {
    if (going.current) return;
    going.current = true;
    try {
      if (await provedLately()) { await erase(membership, office); return; }
      if (appleHere && (relay || !email)) { await withApple(membership, office, false); return; }
      if (!email) { haptic("error"); setPhase({ at: "failed", message: NO_PROOF }); return; }
      setCode(""); setSent(false); setResent(false); setPhase({ at: "prove", membership, office });
      await sendCode();
    } finally {
      going.current = false;
    }
  };

  // The code, checked — it signs this device in again, as the same person, with the proof's time on it — and the delete.
  const confirmCode = async (membership: boolean, office: string[]) => {
    if (!supabase) return;
    const token = code.replace(/\D/g, "");
    if (token.length < MIN_CODE) return;
    setCodeErr("");
    setPhase({ at: "deleting", membership, office, proving: true });
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" }).catch(() => ({ data: { session: null }, error: { message: OFFLINE } }));
    if (error || !data.session) {
      haptic("error");
      setPhase({ at: "prove", membership, office });
      setCodeErr(error?.message === OFFLINE ? OFFLINE : "That code didn't work — enter the newest one we emailed, or send a new one.");
      requestAnimationFrame(() => codeRef.current?.select());
      return;
    }
    takeSigninAsked();   // the code was this device's own ask, used up (lib/linkSignin)
    await erase(membership, office, undefined, true);
  };

  // Apple's sheet, just now, for an account that signs in with Apple (the iPhone app only). Closed, nothing changes.
  const withApple = async (membership: boolean, office: string[], proving: boolean) => {
    setCodeErr("");
    let got: { idToken: string; nonce: string } | { cancelled: true } | { error: string };
    try { got = await (await import("@/lib/appleAuth")).appleIdentity(); } catch { got = { error: "Apple didn't finish. Try again." }; }
    if ("cancelled" in got) return;
    if ("error" in got) {
      haptic("error");
      if (proving) setCodeErr(got.error); else setPhase({ at: "failed", message: got.error });
      return;
    }
    await erase(membership, office, { idToken: got.idToken, nonce: got.nonce }, proving);
  };

  const erase = async (membership: boolean, office: string[], apple?: { idToken: string; nonce: string }, proving = false) => {
    haptic("heavy");
    setPhase({ at: "deleting", membership, office, proving });
    try {
      const r = await authedFetch("/api/account/erase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, ...(apple ? { apple } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409 && Array.isArray(j.blockers) && j.blockers.length) { haptic("error"); setPhase({ at: "blocked", blockers: j.blockers }); return; }
      // Not proved just now, the server says (R27): the code's step again, with a new code — the last one is used.
      if (r.status === 403 && j.prove) {
        haptic("error");
        if (!email) { setPhase({ at: "failed", message: NO_PROOF }); return; }
        setCode(""); setPhase({ at: "prove", membership, office });
        if (await sendCode()) setCodeErr("We couldn't confirm it was you just then. We've emailed a new code — enter that one.");
        return;
      }
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
      <div ref={top} tabIndex={-1} role="alert" className="outline-none">
        <p className="cfm-body">Not yet.</p>
        {/* raw words: the route's own sentence for each blocker (app/api/account/delete) */}
        {phase.blockers.map((b) => <p key={b.code} className="dp-hint">{b.message}</p>)}
        <div className="prod-actions cfm-actions">
          <button type="button" className="btn-pri" onClick={onKeep}>Back to your account</button>
        </div>
      </div>
    );
  }

  if (phase.at === "after") {
    return (
      <div ref={top} tabIndex={-1} className="outline-none">
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
      <div ref={top} tabIndex={-1} className="outline-none">
        {/* raw words: our own sentence, set where the phase is chosen */}
        <p className="cfm-body" role="alert">{phase.message}</p>
        <div className="prod-actions cfm-actions">
          <button type="button" className="note-arch" onClick={onKeep}>Back</button>
          <button type="button" className="btn-pri" onClick={() => { setPhase({ at: "checking" }); setAsked((n) => n + 1); }}>Try again</button>
        </div>
      </div>
    );
  }

  // The code, before the delete goes (R27): the one job on this step, and the red words are still the delete.
  if (phase.at === "prove" || (phase.at === "deleting" && phase.proving)) {
    const busy = phase.at === "deleting";
    const { membership, office } = phase;
    return (
      <div ref={top} tabIndex={-1} className="outline-none">
        <form noValidate onSubmit={(e) => { e.preventDefault(); void confirmCode(membership, office); }}>
          <p className="cfm-body">Confirm it&rsquo;s you.</p>
          {/* Said (R12): "sending" becomes "sent" while the caret is in the field — the change is read. */}
          <Said as="p" className="dp-hint" id="del-code-for" quietFirst>
            {resent ? <>We sent a new code to <b>{email}</b> — enter the newest one, and your account is deleted.</>
              : sent ? <>We sent an 8-digit code to <b>{email}</b>. Enter it, and your account is deleted.</>
              : sending ? <>We&rsquo;re emailing an 8-digit code to <b>{email}</b>.</>
              : <>We email an 8-digit code to <b>{email}</b> — enter it, and your account is deleted.</>}
          </Said>
          {/* Hide My Email, on the web (R35 — UX11-14): the code goes through Apple's relay, which may not pass it on — said first,
              with the way that doesn't need it. */}
          {relay && !appleHere && (
            <p className="dp-hint">
              You joined with Apple&rsquo;s Hide My Email, so the code goes through Apple&rsquo;s relay. If it doesn&rsquo;t arrive,
              delete from the GT3 iPhone app instead — there your Apple ID confirms it&rsquo;s you.
            </p>
          )}
          <input id="del-code" ref={codeRef} className="auth-input auth-code" type="text" inputMode="numeric" autoComplete="one-time-code"
            enterKeyHint="go" pattern="[0-9]*" maxLength={10} aria-label="The code from your email" aria-describedby={codeErr ? "del-code-for del-code-err" : "del-code-for"} aria-invalid={codeErr ? true : undefined}
            placeholder={"•".repeat(CODE_LEN)} value={code} readOnly={busy}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LEN))} />
          {codeErr && <div className="auth-err" role="alert" id="del-code-err">{codeErr}</div>}
          <div className="prod-actions cfm-actions">
            <button type="button" className="btn-ter" onClick={onKeep} disabled={busy}>Keep my account</button>
            <button type="submit" className="btn-del" disabled={busy || code.length < MIN_CODE}>{busy ? "Deleting…" : "Delete my account"}</button>
          </div>
          <div className="flex flex-wrap gap-x-5">
            <button type="button" className="auth-link min-h-11 inline-flex items-center" disabled={busy || sending || cooldown > 0} onClick={() => void sendCode()}>
              {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
            </button>
            {appleHere && (
              <button type="button" className="auth-link min-h-11 inline-flex items-center" disabled={busy} onClick={() => void withApple(membership, office, true)}>
                Confirm with Apple instead
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }

  const busy = phase.at === "deleting";
  return (
    <div ref={top} tabIndex={-1} className="outline-none">
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
        <button type="button" className="btn-del" onClick={() => void prove(phase.membership, phase.office)} disabled={busy}>
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </div>
    </div>
  );
}
