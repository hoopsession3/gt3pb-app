"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Mpire from "./Mpire";
import { useAuth } from "./AuthProvider";

type Mode = "passwordless" | "password";
type Intent = "join" | "signin";

export default function SignIn() {
  const { sendCode, verifyCode, signInWithUrl, signInWithPassword, signUp, resetPassword } = useAuth();

  // The first question is WHO you are (new vs returning) — the auth method comes second.
  const [intent, setIntent] = useState<Intent>("join");
  const [mode, setMode] = useState<Mode>("passwordless");
  const [step, setStep] = useState<"form" | "sent" | "confirm" | "reset-sent">("form");

  // shared fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cooldown, setCooldown] = useState(0); // resend rate-limit (client; Supabase also throttles server-side)

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // passwordless — verify step
  const [otp, setOtp] = useState("");
  const [pastedUrl, setPastedUrl] = useState("");
  const [pasteErr, setPasteErr] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);

  // password mode
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const isNew = intent === "join"; // joining = creating the account; signing in = you have one
  const [showPass, setShowPass] = useState(false);

  const reset = () => {
    setStep("form"); setErr(""); setOtp(""); setPastedUrl(""); setPasteErr("");
  };

  // ── passwordless submit ──
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setErr("");
    const { error } = await sendCode(email.trim(), name.trim() || undefined);
    setBusy(false);
    if (error) setErr(error);
    else { setStep("sent"); setCooldown(30); }
  };

  // ── verify 6-digit code ──
  const handleVerifyCode = async () => {
    if (!otp.trim()) return;
    setBusy(true); setErr("");
    const { error } = await verifyCode(email.trim(), otp.trim());
    setBusy(false);
    if (error) setErr(error);
  };

  // ── paste magic-link URL (iOS PWA) ──
  const handlePastedUrl = async () => {
    if (!pastedUrl.trim()) return;
    setPasteBusy(true); setPasteErr("");
    const { error } = await signInWithUrl(pastedUrl.trim());
    if (error) setPasteErr(error);
    setPasteBusy(false);
  };

  // ── forgot password → email a reset link ──
  const handleReset = async () => {
    if (!email.trim()) { setErr("Enter your email first, then tap reset."); return; }
    setBusy(true); setErr("");
    const { error } = await resetPassword(email.trim());
    setBusy(false);
    if (error) setErr(error); else setStep("reset-sent");
  };

  // ── password sign in / create account ──
  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    if (isNew && password !== confirm) { setErr("Passwords don't match."); return; }
    setBusy(true); setErr("");
    if (isNew) {
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
          ? "Wrong email or password. New here? Switch to “Become a member” above."
          : error;
        setErr(msg);
      }
    }
  };

  return (
    <section className="screen auth" id="s-auth">
      <div className="auth-welcome">Welcome to the</div>
      <Image className="auth-logo" src="/gt3-pb-wordmark.png" alt="GT3 Performance Bar" width={440} height={248} priority unoptimized />
      <div className="auth-rule" />

      {/* ── email-confirmed waiting state ── */}
      {step === "confirm" && (
        <>
          <h1 className="auth-headline">Check your email.</h1>
          <p className="auth-sub">We sent a confirmation link to <b>{email}</b>. Tap it to activate your account, then come back and sign in.</p>
          <button className="handle" onClick={reset} style={{ marginTop: 20 }}><span>Back to sign in</span></button>
        </>
      )}

      {/* ── password reset link sent ── */}
      {step === "reset-sent" && (
        <>
          <h1 className="auth-headline">Check your email.</h1>
          <p className="auth-sub">We sent a password-reset link to <b>{email}</b>. Tap it, set a new password, and you&apos;re back in.</p>
          <p className="auth-paste-hint" style={{ marginTop: 8 }}>Don&apos;t see it? Check spam / promotions. Open the link in <b>this same browser</b>.</p>
          {err && <div className="auth-err">{err}</div>}
          <button className="handle" onClick={reset} style={{ marginTop: 20 }}><span>Back to sign in</span></button>
        </>
      )}

      {/* ── passwordless verify step ── */}
      {step === "sent" && (
        <>
          <h1 className="auth-headline">Check your email.</h1>
          <p className="auth-sub">We sent a sign-in link to <b>{email}</b> — tap it and you&apos;re in. Your email also includes a code if you prefer.</p>
          <p className="auth-paste-hint" style={{ marginTop: 8 }}>Don&apos;t see it? Check spam / promotions. Open the link in <b>this same browser</b> (Safari or Chrome) — not from inside another app.</p>
          {err && <div className="auth-err">{err}</div>}

          <div className="auth-label" style={{ marginTop: 22 }}>Enter the code from your email</div>
          <input
            className="auth-input auth-code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6,8}"
            maxLength={8}
            placeholder="••••••"
            value={otp}
            onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "").slice(0, 8)); setErr(""); }}
          />
          <button className="handle" disabled={otp.length < 6 || busy} onClick={handleVerifyCode} style={{ marginTop: 10 }}>
            <span>{busy ? "Verifying…" : "Verify code"}</span>
          </button>

          <div className="auth-divider" />
          <button className="handle ghost" disabled={busy || cooldown > 0} onClick={() => { setBusy(true); sendCode(email, name || undefined).then(() => { setBusy(false); setCooldown(30); }); }}>
            <span>{busy ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend"}</span>
          </button>
          <button className="auth-link" onClick={reset}>← Different email</button>

          <div className="auth-divider" />
          <div className="auth-label" style={{ marginTop: 4 }}>On iOS? Paste your sign-in URL</div>
          <p className="auth-paste-hint">If the link opened in Safari, copy the URL from the address bar and paste it here.</p>
          <input
            className="auth-input"
            type="url"
            inputMode="url"
            placeholder="Paste URL here…"
            value={pastedUrl}
            onChange={(e) => { setPastedUrl(e.target.value); setPasteErr(""); }}
          />
          {pasteErr && <div className="auth-err">{pasteErr}</div>}
          <button className="handle ghost" disabled={!pastedUrl.trim() || pasteBusy} onClick={handlePastedUrl} style={{ marginTop: 10 }}>
            <span>{pasteBusy ? "Signing in…" : "Sign in with pasted link"}</span>
          </button>
        </>
      )}

      {/* ── main form ── */}
      {step === "form" && (
        <>
          {/* The 3 in 3MPIRE is the real brand glyph (Mpire → public/brand/gt3-3.png), not a font
              character — display-scale brand words carry the mark, same law as the GT3 masthead. */}
          <h1 className="auth-headline">{intent === "join" ? <>Grow your <Mpire />.</> : "Welcome back."}</h1>
          <p className="auth-sub">
            {intent === "join"
              ? <>Free to join — points on every pour, first taste of reserves, order-ahead perks.</>
              : <>Good to see you. Pick how you want to sign in.</>}
          </p>

          <div className="auth-tabs auth-intent">
            <button className={`auth-tab${intent === "join" ? " on" : ""}`} onClick={() => { setIntent("join"); setErr(""); }}>Become a member</button>
            <button className={`auth-tab${intent === "signin" ? " on" : ""}`} onClick={() => { setIntent("signin"); setErr(""); }}>Member sign in</button>
          </div>

          <div className="auth-tabs auth-tabs-mini">
            <button className={`auth-tab${mode === "passwordless" ? " on" : ""}`} onClick={() => { setMode("passwordless"); setErr(""); }}>Link / code</button>
            <button className={`auth-tab${mode === "password" ? " on" : ""}`} onClick={() => { setMode("password"); setErr(""); }}>Password</button>
          </div>

          {mode === "passwordless" && (
            <form className="auth-form" onSubmit={handleSendCode}>
              {intent === "join" && (
                <>
                  <label className="auth-label" htmlFor="auth-name">First name <span>(so we can greet you)</span></label>
                  <input id="auth-name" className="auth-input" type="text" autoComplete="given-name" placeholder="Ryan" value={name} onChange={(e) => setName(e.target.value)} />
                </>
              )}
              <label className="auth-label" htmlFor="auth-email">Email</label>
              <input id="auth-email" className="auth-input" type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <label className="auth-check-row">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>Keep me signed in</span>
              </label>
              {err && <div className="auth-err">{err}</div>}
              <button className="handle" type="submit" disabled={busy} style={{ marginTop: 18 }}>
                <span>{busy ? "Sending…" : intent === "join" ? "Become a member — email my link" : "Send my sign-in link"}</span>
              </button>
            </form>
          )}

          {mode === "password" && (
            <form className="auth-form" onSubmit={handlePassword}>
              {isNew && (
                <>
                  <label className="auth-label" htmlFor="pw-name">First name <span>(optional)</span></label>
                  <input id="pw-name" className="auth-input" type="text" autoComplete="given-name" placeholder="Ryan" value={name} onChange={(e) => setName(e.target.value)} />
                </>
              )}
              <label className="auth-label" htmlFor="pw-email">Email</label>
              <input id="pw-email" className="auth-input" type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <label className="auth-label" htmlFor="pw-pass">Password</label>
              <div className="auth-pass-wrap">
                <input
                  id="pw-pass"
                  className="auth-input"
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
                  <input id="pw-confirm" className="auth-input" type={showPass ? "text" : "password"} autoComplete="new-password" placeholder="Repeat password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
                </>
              )}
              <label className="auth-check-row" style={{ marginTop: 14 }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>Keep me signed in</span>
              </label>
              {err && <div className="auth-err">{err}</div>}
              <button className="handle" type="submit" disabled={busy} style={{ marginTop: 18 }}>
                <span>{busy ? (isNew ? "Creating…" : "Signing in…") : (isNew ? "Become a member" : "Sign in")}</span>
              </button>
              {!isNew && (
                <button type="button" className="auth-link" onClick={handleReset} disabled={busy} style={{ marginTop: 12 }}>
                  Forgot your password? Email me a reset link
                </button>
              )}
            </form>
          )}

          <p className="auth-fine">Browse the truck, menu &amp; events without signing in — membership just makes Today &amp; your 3MPIRE yours.</p>
        </>
      )}
    </section>
  );
}
