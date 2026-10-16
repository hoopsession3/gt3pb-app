"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { trackFunnel } from "@/lib/funnel";
import dynamic from "next/dynamic";
import Link from "next/link";
import Gt3Mark from "./Gt3Mark";
import Icon from "./Icon";
import { useAuth } from "./AuthProvider";
import { APP_BUILD, isNativeApp } from "@/lib/native";
import { STAMP_GOAL } from "@/lib/loyalty";
import { nextOnEnter } from "@/lib/formKeys";
import { rememberReturn } from "@/lib/returnTo";

type Mode = "passwordless" | "password";
type Intent = "join" | "signin";

// THE CODE COMES FIRST (2026-10-10, Ryan: "Yes, add the code"). Both sign-in emails — Supabase's "Magic link
// or OTP" and "Confirm sign up" templates — carry the code in big digits above the link. The link opens in
// Safari, never in the iPhone app (no universal link reaches it: the link is supabase.co's, redirected), and
// on the web it signs in whichever browser opens it; the code works anywhere it is typed. So the screen after
// "email me" asks for the code — iPhone offers it from Mail above the keyboard (one-time-code) — and on the
// web says the link works too. The paste-your-URL workaround the code replaces is gone.
// CODE_LEN mirrors Supabase → Authentication → Email → "Email OTP length" (8 on this project). At that many
// digits the code sends itself; 6 to 10 digits can always be sent by the button, so a changed setting slows
// nobody down. The copy never names the count, so it cannot go stale.
const noSubscription = () => () => {};   // whether this is the app never changes while a page is open
// Sign in with Apple's button is the app's alone (components/AppleSignIn). In the app's build the load starts as this
// module is read — before the form asks for the button — so it is drawn with the form; the web's build has none of it,
// not even the import (lib/native APP_BUILD: a build-time constant, so the branch is dropped from the web's bundles).
const loadApple = () => import("./AppleSignIn");
const AppleSignIn = APP_BUILD ? dynamic(loadApple, { ssr: false }) : () => null;
if (APP_BUILD && isNativeApp()) void loadApple();

const CODE_LEN = 8;
const MIN_CODE = 6;

// ONE CODE SCREEN, THREE USES (2026-10-11: the password reset joins them — the "Reset password" email carries the
// code too). What it says, what its button says, which kind of code it checks, and what a resend sends.
type CodeStep = "sent" | "confirm" | "reset-sent";
const CODE_SCREEN: Record<CodeStep, { head: string; then: string; go: string; label: string; kind: "email" | "recovery" }> = {
  sent: { head: "Check your email.", then: "Enter it here and you’re in.", go: "Sign in", label: "Sign-in code", kind: "email" },
  confirm: { head: "Confirm your email.", then: "Enter it to finish joining.", go: "Confirm and sign in", label: "Confirmation code", kind: "email" },
  "reset-sent": { head: "Check your email.", then: "Enter it, then choose a new password.", go: "Continue", label: "Reset code", kind: "recovery" },
};

// WHERE YOU ARE, AND ONE WAY IN (2026-10-09, round 2 — Ryan: "Join by default", "Link returns you",
// approved). Seven pages that need an account showed this same screen with the consumer's pitch on it
// ("Grow your 3MPIRE") or showed nothing, so an office client, a new hire or a crew member scanning a card
// was never told where they were. A page that needs an account now names itself (`context`) and signs in;
// the 3MPIRE page joins by default. The two switches that stood before the email — join or sign in, a link
// or a password — are two quiet lines under the button, and a link sent from a page brings you back to it
// (lib/returnTo).
export type SignInContext = { title: ReactNode; sub: ReactNode };

// THE OFFER FIRST, AND THREE SIZES (2026-10-12, A2 of the account audit; the owner approved the mockups). The join
// screen led with a logo filling the top third and "Grow your 3MPIRE", which doesn't say what you get, and on an iPhone
// SE its button sat under the tab bar. Now the small lockup, the offer and what comes with it, then the form — and the
// Terms and Privacy where the account is made. Three sizes:
//   · the 3MPIRE page — join by default, or "Welcome back" when the avatar's Sign in sent you (`start`);
//   · a page that needs an account names itself (`context`) and signs in;
//   · inside a sheet that is already doing something — reserve, RSVP, checkout — `compact`: no logo, no pitch, the
//     sheet's own title says why.
type Props = { context?: SignInContext; compact?: boolean; start?: Intent };
const PERKS = ["A stamp on every cup", "Order ahead, skip the line", "First taste of new reserves"];

export default function SignIn({ context, compact = false, start }: Props = {}) {
  const { sendCode, verifyCode, signInWithPassword, signUp, resetPassword } = useAuth();
  // In the iPhone app the emailed link can only open Safari, so the app never mentions it, and the form offers Sign in
  // with Apple. The page is drawn ahead of time with no phone (false); the app's first paint keeps that, then draws
  // what the phone has — read as React reads an outside value, so the two never split a hydration (React #418).
  const inApp = useSyncExternalStore(noSubscription, isNativeApp, () => false);

  // The first question is WHO you are (new vs returning) — the auth method comes second.
  const [intent, setIntent] = useState<Intent>(start ?? (context || compact ? "signin" : "join"));
  const [mode, setMode] = useState<Mode>("passwordless");
  const [step, setStep] = useState<"form" | "sent" | "confirm" | "reset-sent">("form");

  // shared fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cooldown, setCooldown] = useState(0); // resend rate-limit (client; Supabase also throttles server-side)

  useEffect(() => { trackFunnel("signup", "open"); }, []); // funnel analytics (anonymous, no PII)
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // passwordless — verify step
  const [otp, setOtp] = useState("");
  const [resent, setResent] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  // The code field is the screen's one job: it has the caret the moment the screen shows.
  const cs = step === "form" ? null : CODE_SCREEN[step];
  useEffect(() => { if (step !== "form") codeRef.current?.focus(); }, [step]);

  // password mode
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const isNew = intent === "join"; // joining = creating the account; signing in = you have one
  const [showPass, setShowPass] = useState(false);

  const reset = () => {
    setStep("form"); setErr(""); setOtp(""); setResent(false);
  };

  // ── passwordless submit ──
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setErr("");
    rememberReturn(window.location.pathname + window.location.search);
    const { error } = await sendCode(email.trim(), name.trim() || undefined);
    setBusy(false);
    if (error) setErr(error);
    else { setStep("sent"); setCooldown(30); trackFunnel("signup", "code_sent"); }
  };

  // ── resend the code (same trimming + error handling as first send). A new code retires the old one,
  // so the field empties and the screen says to use the newest email. ──
  const handleResend = async () => {
    if (busy || cooldown > 0) return;
    setBusy(true); setErr(""); setResent(false);
    try {
      const { error } = step === "reset-sent" ? await resetPassword(email.trim()) : await sendCode(email.trim(), name.trim() || undefined);
      if (error) setErr(error);
      else { setCooldown(30); setOtp(""); setResent(true); codeRef.current?.focus(); }
    } catch {
      setErr("Couldn't resend that — try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  // ── verify the emailed code — typed, pasted, or offered by iPhone from Mail ──
  const handleVerifyCode = async (token: string = otp) => {
    if (token.length < MIN_CODE || busy) return;
    setBusy(true); setErr("");
    const kind = cs?.kind ?? "email";
    const { error } = await verifyCode(email.trim(), token, kind);
    setBusy(false);
    if (error) {
      setErr(/expired|invalid/i.test(error)
        ? "That code didn't work — it may be from an older email, or expired. Use the newest one, or resend."
        : error);
      requestAnimationFrame(() => codeRef.current?.select());
    } else if (kind === "email") trackFunnel("signup", "signed_in");
    // a reset code's session raises AuthProvider's "Set a new password." over everything (PASSWORD_RECOVERY)
  };
  // Digits only, whatever arrives (a paste with spaces, Mail's suggestion); the whole code sends itself.
  const onCode = (raw: string) => {
    const d = raw.replace(/\D/g, "").slice(0, 10);
    setOtp(d); setErr("");
    if (d.length === CODE_LEN && d !== otp) void handleVerifyCode(d);
  };

  // ── forgot password → email a reset code (and link); the code screen asks for it ──
  const handleReset = async () => {
    if (!email.trim()) { setErr("Enter your email first, then tap reset."); return; }
    setBusy(true); setErr("");
    rememberReturn(window.location.pathname + window.location.search);
    const { error } = await resetPassword(email.trim());
    setBusy(false);
    if (error) setErr(error); else { setOtp(""); setResent(false); setCooldown(30); setStep("reset-sent"); }
  };

  // ── password sign in / create account ──
  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    if (isNew && password !== confirm) { setErr("Passwords don't match."); return; }
    setBusy(true); setErr("");
    if (isNew) {
      rememberReturn(window.location.pathname + window.location.search);
      const { error, confirm: needsConfirm } = await signUp(email.trim(), password, name.trim() || undefined);
      setBusy(false);
      if (error) setErr(error);
      else if (needsConfirm) setStep("confirm");
      // else: auth state change fires and signs in automatically
    } else {
      const { error } = await signInWithPassword(email.trim(), password);
      setBusy(false);
      if (error) {
        const msg = error.includes("Invalid login credentials")
          ? (context ? "Wrong email or password. No password yet? Have us email you a link instead, below." : "Wrong email or password. New here? Join free, below.")
          : error;
        setErr(msg);
      }
    }
  };

  return (
    <section className={compact ? "flex flex-col" : "screen auth"} id={compact ? undefined : "s-auth"}>
      {!compact && <div className="k-lock mb-6"><Gt3Mark tone="cream" /><span className="k-pb">Performance Bar</span></div>}

      {/* ── the code: after "email me a code" (sent), after a new password account (confirm) — the Confirm sign up
          email carries the same code, so a new account finishes here, not in Safari — and after "email me a reset
          code" (reset-sent), whose code opens "Set a new password." right here (CODE_SCREEN) ── */}
      {cs && (
        <>
          <h2 className="auth-headline">{cs.head}</h2>
          <p className="auth-sub" id="auth-code-for">
            We sent a code to <b>{email}</b>. {cs.then}
          </p>
          <form className="auth-form mt-5" noValidate onSubmit={(e) => { e.preventDefault(); void handleVerifyCode(); }}>
            <input
              id="auth-code"
              ref={codeRef}
              className="auth-input auth-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="go"
              pattern="[0-9]*"
              maxLength={10}
              aria-label={cs.label}
              aria-describedby="auth-code-for"
              placeholder={"•".repeat(CODE_LEN)}
              value={otp}
              onChange={(e) => onCode(e.target.value)}
            />
            {err && <div className="auth-err" role="alert">{err}</div>}
            <button className="btn-pri btn-wide mt-3" type="submit" disabled={otp.length < MIN_CODE || busy}>
              <span>{busy ? "Checking…" : cs.go}</span>
            </button>
          </form>
          <p className="auth-paste-hint mt-3.5" aria-live="polite">
            {resent ? "A new code is on its way — use the newest email." : "Don’t see it? Check spam or promotions."}
            {!inApp && " Or tap the link in the email."}
          </p>
          <div className="auth-form flex flex-wrap gap-x-5">
            {step !== "confirm" && (
              <button type="button" className="auth-link min-h-11 inline-flex items-center disabled:opacity-50" disabled={busy || cooldown > 0} onClick={handleResend}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend the code"}
              </button>
            )}
            <button type="button" className="auth-link min-h-11 inline-flex items-center" onClick={reset}>
              {step === "sent" ? "Use a different email" : "Back to sign in"}
            </button>
          </div>
        </>
      )}

      {/* ── main form ── */}
      {step === "form" && (
        <>
          {/* The offer is the headline, in the card's own terms (lib/loyalty: ten stamps, then a cup on us), and what comes with
              joining is three lines, not a sentence. Compact says nothing here: the sheet around it already did. */}
          {!compact && <h2 className="auth-headline">{context ? context.title : intent === "join" ? `Buy ${STAMP_GOAL}, the next cup is on us.` : "Welcome back."}</h2>}
          {compact ? null : context ? <p className="auth-sub">{context.sub}</p> : intent === "join" ? (
            <ul className="mt-3 flex flex-col gap-1.5">
              {PERKS.map((p) => <li key={p} className="flex items-center gap-2.5 text-callout text-cream"><span className="text-gold2"><Icon name="check" /></span>{p}</li>)}
            </ul>
          ) : <p className="auth-sub">Sign in with the email you joined with.</p>}

          {/* SIGN IN WITH APPLE (2026-10-11): in the iPhone app, first — Apple's sheet, then signed in where you are, no
              email to wait for (components/AppleSignIn says why it looks like Apple's and not like the kit). */}
          {inApp && <AppleSignIn onError={setErr} />}

          {mode === "passwordless" && (
            <form className="auth-form" onSubmit={handleSendCode}>
              {intent === "join" && (
                <>
                  <label className="auth-label" htmlFor="auth-name">First name</label>
                  <input id="auth-name" className="auth-input" enterKeyHint="next" onKeyDown={nextOnEnter} type="text" autoComplete="given-name" placeholder="Maverick" value={name} onChange={(e) => setName(e.target.value)} />
                </>
              )}
              <label className="auth-label" htmlFor="auth-email">Email</label>
              <input id="auth-email" className="auth-input" enterKeyHint="send" type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              {err && <div className="auth-err" role="alert">{err}</div>}
              <button className="btn-pri btn-wide mt-4.5" type="submit" disabled={busy}>
                <span>{busy ? "Sending…" : intent === "join" ? "Join free" : "Email me a sign-in code"}</span>
              </button>
            </form>
          )}

          {mode === "password" && (
            <form className="auth-form" onSubmit={handlePassword}>
              {isNew && (
                <>
                  <label className="auth-label" htmlFor="pw-name">First name <span>(optional)</span></label>
                  <input id="pw-name" className="auth-input" enterKeyHint="next" onKeyDown={nextOnEnter} type="text" autoComplete="given-name" placeholder="Maverick" value={name} onChange={(e) => setName(e.target.value)} />
                </>
              )}
              <label className="auth-label" htmlFor="pw-email">Email</label>
              <input id="pw-email" className="auth-input" enterKeyHint="next" onKeyDown={nextOnEnter} type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <label className="auth-label" htmlFor="pw-pass">Password</label>
              <div className="auth-pass-wrap">
                <input
                  id="pw-pass"
                  className="auth-input"
                  enterKeyHint={isNew ? "next" : "go"}
                  onKeyDown={isNew ? nextOnEnter : undefined}
                  type={showPass ? "text" : "password"}
                  autoComplete={isNew ? "new-password" : "current-password"}
                  placeholder={isNew ? "Create a password" : "Your password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={isNew ? 8 : 1}
                />
                <button type="button" className="auth-show-pass" onClick={() => setShowPass((v) => !v)} tabIndex={-1}>
                  {showPass ? "Hide" : "Show"}
                </button>
              </div>
              {isNew && (
                <>
                  <label className="auth-label" htmlFor="pw-confirm">Confirm password</label>
                  <input id="pw-confirm" className="auth-input" enterKeyHint="go" type={showPass ? "text" : "password"} autoComplete="new-password" placeholder="Repeat password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
                </>
              )}
              {err && <div className="auth-err" role="alert">{err}</div>}
              <button className="btn-pri btn-wide mt-4.5" type="submit" disabled={busy}>
                <span>{busy ? (isNew ? "Creating…" : "Signing in…") : (isNew ? "Become a member" : "Sign in")}</span>
              </button>
              {!isNew && (
                <button type="button" className="auth-link hit-44 mt-3" onClick={handleReset} disabled={busy}>
                  Forgot your password? Email me a reset code
                </button>
              )}
            </form>
          )}

          {/* The other ways in, quiet, under the one that is asked for. A page that needs an account signs in
              (a link creates the account if there is none), so it does not offer to join. Each is 44 tall in
              its own box, not by a reach drawn past it: at the foot of /driver the scroller's edge cut that reach
              to the words' 28px. */}
          <div className="auth-form flex flex-wrap gap-x-5">
            {!context && (
              <button type="button" className="auth-link min-h-11 inline-flex items-center" onClick={() => { setIntent(intent === "join" ? "signin" : "join"); setErr(""); }}>
                {intent === "join" ? "Already a member? Sign in" : "New here? Join free"}
              </button>
            )}
            {/* The password is the quieter way: it doesn't compete with joining or signing in (the account audit, #7). */}
            <button type="button" className="auth-link min-h-11 inline-flex items-center text-cream-muted" onClick={() => { setMode(mode === "passwordless" ? "password" : "passwordless"); setErr(""); }}>
              {mode === "passwordless" ? "Use a password instead" : "Email me a code instead"}
            </button>
          </div>

          {/* Where an account can be made, its Terms and Privacy (the account audit, #7) — joining, and signing in too: an
              emailed code or Apple makes the account when there is none (AuthProvider sendCode, shouldCreateUser).
              Each link takes a 44×44 tap (hit-44) around words drawn at 12px: production's measure found Terms 15px
              tall on /3mpire (2026-10-12). The local build shows /3mpire's demo, not this form, so the smoke pins it. */}
          {!context && (
            <p className="auth-fine">By {intent === "join" ? "joining" : "continuing"} you agree to the <Link className="text-cream underline decoration-line2 underline-offset-4 hit-44" href="/terms">Terms</Link> and <Link className="text-cream underline decoration-line2 underline-offset-4 hit-44" href="/privacy">Privacy</Link>.{compact ? "" : " Or browse the menu and the truck first."}</p>
          )}
        </>
      )}
    </section>
  );
}
