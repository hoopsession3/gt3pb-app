"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";

export default function SignIn() {
  const { sendCode, verifyCode } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setErr("");
    const { error } = await sendCode(email.trim(), name.trim() || undefined);
    setBusy(false);
    if (error) setErr(error);
    else setStep("code");
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 6) return;
    setBusy(true);
    setErr("");
    const { error } = await verifyCode(email.trim(), code.trim());
    setBusy(false);
    if (error) setErr(error); // success → AuthProvider flips to signed-in, this unmounts
  };

  return (
    <section className="screen auth" id="s-auth">
      <div className="auth-mark">GT<span>3</span></div>
      <div className="auth-eyb">GT3 Performance Bar</div>

      {step === "email" ? (
        <>
          <h1 className="auth-title">Your standard.<br />On tap.</h1>
          <p className="auth-sub">Sign in to get your day dialed and your 3MPIRE membership. No password — we&apos;ll text a code to your email.</p>
          <form onSubmit={submitEmail}>
            <label className="auth-label" htmlFor="auth-name">First name <span>(optional)</span></label>
            <input id="auth-name" className="auth-input" type="text" autoComplete="given-name" placeholder="Ryan" value={name} onChange={(e) => setName(e.target.value)} />
            <label className="auth-label" htmlFor="auth-email">Email</label>
            <input id="auth-email" className="auth-input" type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            {err && <div className="auth-err">{err}</div>}
            <button className="handle" type="submit" disabled={busy} style={{ marginTop: 18 }}>
              <span>{busy ? "Sending…" : "Send my code"}</span>
            </button>
          </form>
          <p className="auth-fine">Browse the truck, menu &amp; events without signing in — sign-in just makes Today and 3MPIRE yours.</p>
        </>
      ) : (
        <>
          <h1 className="auth-title">Check your email.</h1>
          <p className="auth-sub">We sent a 6-digit code to <b>{email}</b>. Enter it below.</p>
          <form onSubmit={submitCode}>
            <label className="auth-label" htmlFor="auth-code">Code</label>
            <input id="auth-code" className="auth-input auth-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoFocus />
            {err && <div className="auth-err">{err}</div>}
            <button className="handle" type="submit" disabled={busy} style={{ marginTop: 18 }}>
              <span>{busy ? "Verifying…" : "Verify & sign in"}</span>
            </button>
          </form>
          <button className="auth-link" type="button" onClick={() => { setStep("email"); setCode(""); setErr(""); }}>
            ← Use a different email
          </button>
        </>
      )}
    </section>
  );
}
