"use client";

import { useEffect, useRef, useState } from "react";
import Sheet, { CloseButton } from "@/components/Sheet";
import Gt3Mark from "@/components/Gt3Mark";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/lib/haptics";
import { appleIdentity, linkAppleHere, takeFreshApple, FRESH_APPLE, type FreshApple } from "@/lib/appleAuth";
import { useAppStable } from "./AppProvider";
import Said from "./Said";
import { authWords } from "@/lib/failureWords";

// AN APPLE SIGN-IN FINDS THE ACCOUNT IT BELONGS TO (2026-10-15, A3 of the account audit; decided by Ryan on 2026-10-13:
// "right after a first Apple sign-in, offer 'Already a member with another email? Link it', verified by a code sent to
// that email"). Sign in with Apple can hide the email behind a relay address that matches nobody's, so a member who joined
// with their email got a second, empty account from Continue with Apple. The iPhone app's alone (components/AppShell loads
// it in the app's build only, as it does NativeBridge), and two ways in:
//
//   · right after a first Apple sign-in (lib/appleAuth says FRESH_APPLE and holds Apple's identity token, in memory only,
//     for one take):
//     "Already a member?" — their email, the code it is sent (which signs them in to that account), then the join
//     (lib/appleAuth linkAppleHere → app/api/account/link-apple → lib/appleLink): the empty account goes, and Continue
//     with Apple opens theirs from then on. "I'm new here" — or swiping the sheet away — keeps the new account;
//   · Settings & privacy › Link Sign in with Apple (components/AccountSheet says LINK_APPLE): Apple's sheet, then the
//     same join, for an account signed in with its email.
// Apple's identity token lasts ten minutes: one older than eight is asked for again (Apple's sheet, Face ID) at the join.

export const LINK_APPLE = "gt3-link-apple";
const FRESH_FOR = 8 * 60_000;
const MIN_CODE = 6;
const CODE_LEN = 8;   // Supabase › Authentication › Email › Email OTP length (components/SignIn says the same)

type Step = "ask" | "email" | "code" | "linking" | "done" | "stuck";

export default function AppleLink() {
  const { toast } = useAppStable();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("ask");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const apple = useRef<FreshApple | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // A first Apple sign-in: ask — said now, or said before this was loaded (it waits in lib/appleAuth for one take).
  useEffect(() => {
    const onFresh = () => {
      const d = takeFreshApple();
      if (!d) return;
      apple.current = d;
      setStep("ask"); setEmail(""); setCode(""); setErr(""); setNote(""); setOpen(true);
    };
    onFresh();
    window.addEventListener(FRESH_APPLE, onFresh);
    return () => window.removeEventListener(FRESH_APPLE, onFresh);
  }, []);

  // Settings & privacy › Link Sign in with Apple: Apple's sheet, then the join.
  useEffect(() => {
    const onLink = async () => {
      if (!supabase) return;
      const got = await appleIdentity();
      if ("cancelled" in got) return;
      if ("error" in got) { haptic("error"); toast(got.error, "error"); return; }
      const done = await linkAppleHere(supabase, got);
      if ("error" in done) { haptic("error"); toast(done.error, "error"); return; }
      haptic("success");
      toast("Sign in with Apple is linked. It opens this account from now on.");
    };
    const handler = () => { void onLink(); };
    window.addEventListener(LINK_APPLE, handler);
    return () => window.removeEventListener(LINK_APPLE, handler);
  }, [toast]);

  useEffect(() => { if (step === "code") codeRef.current?.focus(); }, [step]);

  const close = () => { setOpen(false); apple.current = null; };

  const sendCode = async () => {
    if (!supabase || busy) return;
    const to = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(to)) { setErr("Enter the email you joined GT3 with."); return; }
    setBusy(true); setErr("");
    // An account that already exists only: this is to prove the email is theirs, not to make another account.
    const { error } = await supabase.auth.signInWithOtp({ email: to, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) {
      haptic("error");
      setErr(/signups? not allowed|otp_disabled|not found/i.test(error.message)
        ? "We couldn't find a GT3 account with that email. Check it, or tap I'm new here."
        : authWords(error));
      return;
    }
    setCode(""); setStep("code");
  };

  const join = async () => {
    if (!supabase || busy) return;
    const token = code.replace(/\D/g, "");
    if (token.length < MIN_CODE) return;
    setBusy(true); setErr("");
    // The code signs this phone in to the account it was sent for — the member's own.
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: "email" });
    if (error) { setBusy(false); haptic("error"); setErr("That code didn't work. Check the newest email, or send a new one."); return; }
    setStep("linking");
    // Apple's word that the Apple ID is theirs: the one from the sign-in while it is fresh, or Apple's sheet again.
    const held = apple.current;
    let cred: { idToken: string; nonce: string } | null = held && Date.now() - held.at < FRESH_FOR ? { idToken: held.idToken, nonce: held.nonce } : null;
    if (!cred) {
      const got = await appleIdentity();
      cred = "idToken" in got ? got : null;
    }
    let done = cred ? await linkAppleHere(supabase, cred) : { error: "" };
    if ("error" in done && cred && held && cred.idToken === held.idToken) {
      // The held token was refused (it may have run out): Apple's sheet once more, then once more the join.
      const got = await appleIdentity();
      if ("idToken" in got) done = await linkAppleHere(supabase, got);
    }
    setBusy(false);
    if ("error" in done) {
      haptic("error");
      setNote(done.error);
      setStep("stuck");
      return;
    }
    haptic("success");
    setStep("done");
  };

  if (!open) return null;

  const head = (
    <div className="acs-head">
      <span className="acs-head-t"><Gt3Mark tone="cream" /> Your account</span>
      <CloseButton onClick={close} className="isheet-x" />
    </div>
  );

  return (
    // An email typed, or a code on its way: leaving by the X, a tap outside or the pull asks first ("I'm new here" is
    // an answer, and doesn't).
    <Sheet open onClose={close} header={head} label="Your account" dismissible={step !== "linking"} className="acs-sheet"
      dirty={(step === "email" && email.trim() !== "") || step === "code"}>
      {step === "ask" && (
        <div>
          <p className="cfm-body">Already a GT3 member?</p>
          <p className="dp-hint">
            If you joined with another email, link it now. Your stamps, orders and rewards come with you, and Continue with
            Apple opens that account from now on.
          </p>
          <div className="prod-actions cfm-actions">
            <button type="button" className="btn-ter" onClick={close}>I&rsquo;m new here</button>
            <button type="button" className="btn-pri" onClick={() => { setErr(""); setStep("email"); }}>Link my account</button>
          </div>
        </div>
      )}

      {step === "email" && (
        // Not .auth-form: that is the sign-in screen's entrance, faded in half a second late — a step here is there at once.
        <form noValidate onSubmit={(e) => { e.preventDefault(); void sendCode(); }}>
          <label className="auth-label" htmlFor="al-email">The email you joined with</label>
          <input id="al-email" className="auth-input" type="email" inputMode="email" autoComplete="email" enterKeyHint="send"
            placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          {err && <div className="auth-err" role="alert">{err}</div>}
          <button className="btn-pri btn-wide mt-4" type="submit" disabled={busy}><span>{busy ? "Sending…" : "Email me a code"}</span></button>
          <button type="button" className="auth-link min-h-11 inline-flex items-center" onClick={close}>I&rsquo;m new here</button>
        </form>
      )}

      {step === "code" && (
        <form noValidate onSubmit={(e) => { e.preventDefault(); void join(); }}>
          <p className="dp-hint" id="al-code-for">We sent a code to <b>{email.trim()}</b>. Enter it to link the two.</p>
          <input id="al-code" ref={codeRef} className="auth-input auth-code" type="text" inputMode="numeric" autoComplete="one-time-code"
            enterKeyHint="go" pattern="[0-9]*" maxLength={10} aria-label="The code from your email" aria-describedby="al-code-for"
            placeholder={"•".repeat(CODE_LEN)} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LEN))} />
          {err && <div className="auth-err" role="alert">{err}</div>}
          <button className="btn-pri btn-wide mt-3" type="submit" disabled={code.length < MIN_CODE || busy}><span>{busy ? "Checking…" : "Link my account"}</span></button>
          <div className="flex flex-wrap gap-x-5">
            <button type="button" className="auth-link min-h-11 inline-flex items-center" disabled={busy} onClick={() => void sendCode()}>Send a new code</button>
            <button type="button" className="auth-link min-h-11 inline-flex items-center" disabled={busy} onClick={() => { setErr(""); setStep("email"); }}>Use a different email</button>
          </div>
        </form>
      )}

      {step === "linking" && <Said as="p" className="dp-hint">Linking your accounts…</Said>}

      {step === "done" && (
        <div>
          <Said as="p" className="cfm-body">Linked.</Said>
          <p className="dp-hint">This is your account, with your stamps, orders and rewards. Continue with Apple opens it from now on.</p>
          <div className="prod-actions cfm-actions">
            <button type="button" className="btn-pri" onClick={close}>Done</button>
          </div>
        </div>
      )}

      {step === "stuck" && (
        <div>
          <p className="cfm-body" role="alert">You&rsquo;re signed in to your account.</p>
          <p className="dp-hint">
            {/Settings & privacy/.test(note) ? note
              : `${note || "Apple's link didn't finish."} To use Sign in with Apple for this account, tap Link Sign in with Apple in Settings & privacy.`}
          </p>
          <div className="prod-actions cfm-actions">
            <button type="button" className="btn-pri" onClick={close}>Done</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
