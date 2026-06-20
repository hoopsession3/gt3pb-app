"use client";

import { Fragment, useState } from "react";
import Image from "next/image";
import { useAuth } from "./AuthProvider";

const TAGLINE = "Become a member and watch your empire grow.";

export default function SignIn() {
  const { sendCode, signInWithUrl } = useAuth();
  const [step, setStep] = useState<"email" | "sent">("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // paste-link flow (iOS PWA: magic link opens Safari, paste URL back here)
  const [pastedUrl, setPastedUrl] = useState("");
  const [pasteErr, setPasteErr] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    setErr("");
    const { error } = await sendCode(email.trim(), name.trim() || undefined);
    setBusy(false);
    if (error) setErr(error);
    else setStep("sent");
  };

  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) send();
  };

  const tryPastedUrl = async () => {
    if (!pastedUrl.trim()) return;
    setPasteBusy(true);
    setPasteErr("");
    const { error } = await signInWithUrl(pastedUrl.trim());
    if (error) setPasteErr(error);
    setPasteBusy(false);
  };

  return (
    <section className="screen auth" id="s-auth">
      <div className="auth-welcome">Welcome to the</div>
      <Image className="auth-logo" src="/gt3-pb-wordmark.png" alt="GT3 Performance Bar" width={440} height={248} priority unoptimized />
      <div className="auth-rule" />

      {step === "email" ? (
        <>
          <h1 className="auth-tag">
            {TAGLINE.split(" ").map((w, i) => (
              <Fragment key={i}>
                <span className="w" style={{ animationDelay: `${0.5 + i * 0.085}s` }}>{w}</span>{" "}
              </Fragment>
            ))}
          </h1>
          <p className="auth-sub">Members get their day dialed, their points, pours &amp; reserves. No password — we&apos;ll email you a one-tap sign-in link.</p>
          <form className="auth-form" onSubmit={submitEmail}>
            <label className="auth-label" htmlFor="auth-name">First name <span>(optional)</span></label>
            <input id="auth-name" className="auth-input" type="text" autoComplete="given-name" placeholder="Ryan" value={name} onChange={(e) => setName(e.target.value)} />
            <label className="auth-label" htmlFor="auth-email">Email</label>
            <input id="auth-email" className="auth-input" type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <label className="auth-check-row">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>Keep me signed in</span>
            </label>
            {err && <div className="auth-err">{err}</div>}
            <button className="handle" type="submit" disabled={busy} style={{ marginTop: 18 }}>
              <span>{busy ? "Sending…" : "Become a member"}</span>
            </button>
          </form>
          <p className="auth-fine">Browse the truck, menu &amp; events without signing in — membership just makes Today &amp; your 3MPIRE yours.</p>
        </>
      ) : (
        <>
          <h1 className="auth-tag auth-tag-sm">Check your email.</h1>
          <p className="auth-sub">We sent a sign-in link to <b>{email}</b>. Tap it and you&apos;re in — your Today and 3MPIRE will be waiting.</p>
          {err && <div className="auth-err">{err}</div>}
          <button className="handle" type="button" disabled={busy} style={{ marginTop: 18 }} onClick={send}>
            <span>{busy ? "Sending…" : "Resend link"}</span>
          </button>
          <button className="auth-link" type="button" onClick={() => { setStep("email"); setErr(""); }}>
            ← Use a different email
          </button>

          <div className="auth-divider" />
          <div className="auth-label" style={{ marginTop: 4 }}>Saved to your home screen?</div>
          <p className="auth-paste-hint">
            On iOS the link opens in Safari (separate from your app). After clicking it, copy the URL from Safari&apos;s address bar and paste it here.
          </p>
          <input
            className="auth-input"
            type="url"
            inputMode="url"
            placeholder="Paste sign-in URL here…"
            value={pastedUrl}
            onChange={(e) => { setPastedUrl(e.target.value); setPasteErr(""); }}
          />
          {pasteErr && <div className="auth-err">{pasteErr}</div>}
          <button
            className="handle ghost"
            type="button"
            disabled={!pastedUrl.trim() || pasteBusy}
            style={{ marginTop: 10 }}
            onClick={tryPastedUrl}
          >
            <span>{pasteBusy ? "Signing in…" : "Sign in with pasted link"}</span>
          </button>
        </>
      )}
    </section>
  );
}
