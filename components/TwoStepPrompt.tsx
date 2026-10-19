"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/lib/haptics";
import { digitsOf, giveCode, recoverWithCode, TOTP_LEN } from "@/lib/twoStep";
import { useAuth } from "./AuthProvider";
import TwoStepSetup from "./TwoStepSetup";

// THE CREW CONSOLE ASKS AN OWNER OR ADMIN FOR THEIR CODE (R28, 2026-10-18 — the 10/10 audit, security F6; 0433). Shown in
// place of the console, before it reads anything, when an owner or admin with an authenticator opens it on a sign-in
// that hasn't given its code (lib/twoStep useTwoStep "code") — once a sign-in; the session keeps it. Or, when their
// business requires two-step and they have no authenticator ("setup"), the setup itself. "Not now" opens the console
// with the crew's tools: the owner's and admin's wait for the code (the database holds them to it), and a line at the top
// of the console asks again.
//
// Its text is the theme's ink (R29: text-cream on the section): set on no colour of its own, the title inherited the
// body's — the night theme's cream — and drew cream on the day console's ground.
//
// LOST THE AUTHENTICATOR (R37, 2026-10-19 — the fresh audit's UX11-10; Ryan: "Recovery codes"; 0438). The only way back
// was another owner, or the database's dashboard, taking it off — the business's only owner had neither. One of the ten
// recovery codes made when it was set up takes it off now (lib/twoStep recoverWithCode, on a sign-in from the last few
// minutes); Supabase signs the person out everywhere as it does, and they sign in again and set up a new one.

export default function TwoStepPrompt({ need, onDone, onLater }: { need: "code" | "setup"; onDone: () => void; onLater: () => void }) {
  const { signOut } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (need === "code") codeRef.current?.focus({ preventScroll: true }); }, [need]);
  // The recovery code: asked for ("recover"), or used ("recovered") — the authenticator is off, and they sign in again.
  const [mode, setMode] = useState<"code" | "recover" | "recovered">("code");
  const [recovery, setRecovery] = useState("");
  const [stale, setStale] = useState(false);
  const recoveryRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  // Each view's field, or its line, takes focus as it comes — back to the authenticator's code included. The two fields
  // are two elements (their keys): one field changing in place kept the iPhone's number pad up for a code of letters.
  const modeShown = useRef(mode);
  useEffect(() => {
    const back = modeShown.current !== mode && mode === "code";
    modeShown.current = mode;
    if (back) codeRef.current?.focus({ preventScroll: true });
    if (mode === "recover") recoveryRef.current?.focus({ preventScroll: true });
    if (mode === "recovered") doneRef.current?.focus({ preventScroll: true });
  }, [mode]);

  const recover = async () => {
    if (busy || !recovery.trim()) return;
    setBusy(true); setErr(""); setStale(false);
    const r = await recoverWithCode(recovery);
    setBusy(false);
    if (r.error) { haptic("error"); setErr(r.error); setStale(!!r.prove); recoveryRef.current?.focus(); return; }
    haptic("success"); setRecovery("");
    setMode("recovered");
  };

  const give = async () => {
    if (!supabase || busy || code.length < TOTP_LEN) return;
    setBusy(true); setErr("");
    const r = await giveCode(supabase, code);
    setBusy(false);
    if (r.error) { haptic("error"); setErr(r.error); setCode(""); codeRef.current?.focus(); return; }
    haptic("success");
    onDone();
  };

  const later = <button type="button" className="auth-link min-h-11 inline-flex items-center" onClick={onLater} disabled={busy}>Not now — the crew&rsquo;s tools only</button>;

  if (need === "setup") {
    return (
      <section className="screen text-cream">
        <div className="toprow"><div className="eyb">Crew</div></div>
        <h1 className="h-title">Set up two-step sign-in.</h1>
        <p className="h-sub">
          Your business asks every owner and admin for an authenticator&rsquo;s code once each sign-in. Set yours up — it
          takes a minute — and the owner and admin tools open.
        </p>
        <div className="mt-3.5"><TwoStepSetup onDone={onDone} /></div>
        <div className="flex flex-wrap gap-x-5">{later}</div>
      </section>
    );
  }

  if (mode === "recovered") {
    return (
      <section className="screen text-cream">
        <div className="toprow"><div className="eyb">Crew</div></div>
        <h1 className="h-title" ref={doneRef} tabIndex={-1}>Your authenticator is off your account.</h1>
        <p className="h-sub">
          You&rsquo;re signed out everywhere it was used. Sign in again, then set up a new authenticator in Settings &amp;
          privacy — it makes ten new recovery codes. The owners and admins have been told a recovery code was used.
        </p>
        <button type="button" className="btn-pri btn-wide mt-3" onClick={() => void signOut()}>Sign in again</button>
      </section>
    );
  }

  if (mode === "recover") {
    return (
      <section className="screen text-cream">
        <form noValidate onSubmit={(e) => { e.preventDefault(); void recover(); }}>
          <div className="toprow"><div className="eyb">Crew</div></div>
          <h1 className="h-title">Use a recovery code.</h1>
          <p className="h-sub" id="ts-recover-for">
            Enter one of the ten codes you saved when you set up two-step sign-in. It takes your lost authenticator off your
            account and signs you out everywhere; then you sign in again and set up a new one.
          </p>
          <input key="ts-recovery" id="ts-recovery" ref={recoveryRef} className="auth-input mt-3.5" type="text" autoComplete="off" autoCapitalize="characters"
            autoCorrect="off" spellCheck={false} enterKeyHint="go" maxLength={20} aria-label="Recovery code"
            aria-describedby={err ? "ts-recover-for ts-err" : "ts-recover-for"} aria-invalid={err ? true : undefined}
            placeholder="ABCDE-23456" value={recovery} readOnly={busy} onChange={(e) => setRecovery(e.target.value)} />
          {err && <div className="auth-err" role="alert" id="ts-err">{err}</div>}
          <button className="btn-pri btn-wide mt-3" type="submit" disabled={busy || !recovery.trim()}><span>{busy ? "Checking…" : "Use this code"}</span></button>
          <div className="flex flex-wrap gap-x-5">
            <button type="button" className="auth-link min-h-11 inline-flex items-center" onClick={() => { setMode("code"); setErr(""); setStale(false); }} disabled={busy}>Back to the authenticator&rsquo;s code</button>
            {stale && <button type="button" className="auth-link min-h-11 inline-flex items-center" onClick={() => void signOut()} disabled={busy}>Sign out, then sign in again</button>}
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="screen text-cream">
      <form noValidate onSubmit={(e) => { e.preventDefault(); void give(); }}>
        <div className="toprow"><div className="eyb">Crew</div></div>
        <h1 className="h-title">Your two-step code.</h1>
        <p className="h-sub" id="ts-code-for">
          The money, the books, customers and the crew&rsquo;s roles ask for the six-digit code from your authenticator app,
          once each sign-in.
        </p>
        <input key="ts-code" id="ts-code" ref={codeRef} className="auth-input auth-code mt-3.5" type="text" inputMode="numeric" autoComplete="one-time-code"
          enterKeyHint="go" pattern="[0-9]*" maxLength={TOTP_LEN + 4} aria-label="The code from your authenticator" aria-describedby={err ? "ts-code-for ts-err" : "ts-code-for"} aria-invalid={err ? true : undefined}
          placeholder={"•".repeat(TOTP_LEN)} value={code} readOnly={busy} onChange={(e) => setCode(digitsOf(e.target.value))} />
        {err && <div className="auth-err" role="alert" id="ts-err">{err}</div>}
        <button className="btn-pri btn-wide mt-3" type="submit" disabled={busy || code.length < TOTP_LEN}><span>{busy ? "Checking…" : "Continue"}</span></button>
        <div className="flex flex-wrap gap-x-5">
          {later}
          <button type="button" className="auth-link min-h-11 inline-flex items-center" onClick={() => void signOut()} disabled={busy}>Sign out</button>
        </div>
        {/* Its own line under the words: a 44pt button inside a sentence stretched that line, and the lines around it
            stood apart (R37's capture). */}
        <div className="mt-3">
          <p className="dp-hint">
            Lost your authenticator? One of your recovery codes takes it off your account — or an owner can, in Supabase
            (Authentication → Users).
          </p>
          <button type="button" className="auth-link min-h-11 inline-flex items-center" onClick={() => { setMode("recover"); setErr(""); }} disabled={busy}>Use a recovery code</button>
        </div>
      </form>
    </section>
  );
}
