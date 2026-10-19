"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/lib/haptics";
import { digitsOf, giveCode, TOTP_LEN } from "@/lib/twoStep";
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

export default function TwoStepPrompt({ need, onDone, onLater }: { need: "code" | "setup"; onDone: () => void; onLater: () => void }) {
  const { signOut } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (need === "code") codeRef.current?.focus({ preventScroll: true }); }, [need]);

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

  return (
    <section className="screen text-cream">
      <form noValidate onSubmit={(e) => { e.preventDefault(); void give(); }}>
        <div className="toprow"><div className="eyb">Crew</div></div>
        <h1 className="h-title">Your two-step code.</h1>
        <p className="h-sub" id="ts-code-for">
          The money, the books, customers and the crew&rsquo;s roles ask for the six-digit code from your authenticator app,
          once each sign-in.
        </p>
        <input id="ts-code" ref={codeRef} className="auth-input auth-code mt-3.5" type="text" inputMode="numeric" autoComplete="one-time-code"
          enterKeyHint="go" pattern="[0-9]*" maxLength={TOTP_LEN + 4} aria-label="The code from your authenticator" aria-describedby={err ? "ts-code-for ts-err" : "ts-code-for"} aria-invalid={err ? true : undefined}
          placeholder={"•".repeat(TOTP_LEN)} value={code} readOnly={busy} onChange={(e) => setCode(digitsOf(e.target.value))} />
        {err && <div className="auth-err" role="alert" id="ts-err">{err}</div>}
        <button className="btn-pri btn-wide mt-3" type="submit" disabled={busy || code.length < TOTP_LEN}><span>{busy ? "Checking…" : "Continue"}</span></button>
        <div className="flex flex-wrap gap-x-5">
          {later}
          <button type="button" className="auth-link min-h-11 inline-flex items-center" onClick={() => void signOut()} disabled={busy}>Sign out</button>
        </div>
        <p className="dp-hint mt-3">
          Lost your authenticator? The owner can take it off your account in Supabase (Authentication → Users), and you set
          up a new one.
        </p>
      </form>
    </section>
  );
}
