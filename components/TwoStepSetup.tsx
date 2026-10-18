"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/lib/haptics";
import { isNativeApp } from "@/lib/native";
import { digitsOf, finishSetup, giveCode, keyGroups, qrSrc, setRequired, startSetup, turnOff, twoStepState, TOTP_LEN, type Enrolment, type TwoStepState } from "@/lib/twoStep";
import Said from "./Said";
import { useStepFocus } from "./useStepFocus";

// TWO-STEP SIGN-IN — Settings & privacy, for an owner or an admin (R28, 2026-10-18 — the 10/10 audit, security F6; Ryan:
// "Yes, owner/admin"). And the crew console's setup step when their business requires it (components/TwoStepPrompt).
//
//   off  → Set up: an authenticator app (Apple's Passwords, Google Authenticator, 1Password…) scans the code — or takes the
//          key typed, or, on the iPhone, the link — and its first code turns it on (lib/twoStep). From then on the money,
//          the books, customers and the crew's roles ask for its code once each sign-in (0433).
//   on   → said; an owner may require it of every owner and admin (0433 require_two_step — on a sign-in that gave the
//          code); and it can be turned off, with this sign-in's code.
//
// The key and the code are drawn for the person setting it up and nowhere else.

type Step =
  | { at: "loading" }
  | { at: "off" }
  | { at: "scan"; enrol: Enrolment }
  | { at: "on"; state: TwoStepState | null }
  | { at: "failed"; message: string };

export default function TwoStepSetup({ onDone }: { onDone?: () => void }) {
  const [step, setStep] = useState<Step>({ at: "loading" });
  const scope = useRef<HTMLDivElement>(null);
  // Only a view the person's own tap brought (acted): the first answer as Settings opens takes no focus from the page.
  const acted = useRef(false);
  useStepFocus(step.at, scope, { pick: () => (acted.current ? scope.current?.querySelector<HTMLElement>(".cfm-body") : null) });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [asked, setAsked] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  // What is there: an authenticator on the account (Supabase's own list), and what the business asks (0433).
  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    let live = true;
    Promise.all([sb.auth.mfa.listFactors(), twoStepState(sb)]).then(([list, state]) => {
      if (!live) return;
      if (list.error) { setStep({ at: "failed", message: "We couldn't check two-step sign-in just now. Try again in a minute." }); return; }
      setStep((list.data?.totp?.length ?? 0) > 0 ? { at: "on", state } : { at: "off" });
    }, () => { if (live) setStep({ at: "failed", message: "You're offline. Connect, then try again." }); });
    return () => { live = false; };
  }, [asked]);
  useEffect(() => { if (step.at === "scan") codeRef.current?.focus({ preventScroll: true }); }, [step.at]);

  const begin = async () => {
    acted.current = true;
    if (!supabase || busy) return;
    setBusy(true); setErr("");
    const got = await startSetup(supabase);
    setBusy(false);
    if ("error" in got) { haptic("error"); setErr(got.error); return; }
    setCode(""); setStep({ at: "scan", enrol: got });
  };

  const prove = async (enrol: Enrolment) => {
    acted.current = true;
    if (!supabase || busy || code.length < TOTP_LEN) return;
    setBusy(true); setErr("");
    const done = await finishSetup(supabase, enrol.factorId, code);
    if (done.error) { setBusy(false); haptic("error"); setErr(done.error); requestAnimationFrame(() => codeRef.current?.select()); return; }
    const state = await twoStepState(supabase);
    setBusy(false); haptic("success"); setCode("");
    setStep({ at: "on", state });
    onDone?.();
  };

  const require = async (state: TwoStepState, on: boolean) => {
    acted.current = true;
    if (!supabase || busy) return;
    setBusy(true); setErr("");
    const r = await setRequired(supabase, on);
    setBusy(false);
    if (r.error) { haptic("error"); setErr(r.error); return; }
    if (on) haptic("toggleOn"); else haptic("toggleOff");
    setStep({ at: "on", state: { ...state, required: on } });
  };

  // Off, with this sign-in's code: given now when this sign-in hasn't given it yet (Supabase asks for it).
  const stop = async (state: TwoStepState | null) => {
    acted.current = true;
    if (!supabase || busy) return;
    setBusy(true); setErr("");
    if (!state?.given) {
      if (code.length < TOTP_LEN) { setBusy(false); setErr("Enter the code from your authenticator to turn it off."); codeRef.current?.focus(); return; }
      const given = await giveCode(supabase, code);
      if (given.error) { setBusy(false); haptic("error"); setErr(given.error); return; }
    }
    const r = await turnOff(supabase);
    setBusy(false);
    if (r.error) { haptic("error"); setErr(r.error); return; }
    haptic("success"); setCode("");
    setStep({ at: "off" });
  };

  const codeField = (label: string) => (
    <input id="ts-code" ref={codeRef} className="auth-input auth-code" type="text" inputMode="numeric" autoComplete="one-time-code"
      enterKeyHint="go" pattern="[0-9]*" maxLength={TOTP_LEN} aria-label={label} aria-describedby="ts-code-for"
      placeholder={"•".repeat(TOTP_LEN)} value={code} onChange={(e) => setCode(digitsOf(e.target.value))} readOnly={busy} />
  );

  // EACH VIEW IS WHERE FOCUS GOES (R34 — the audit's UX11-05). Setting up, the code accepted, a failure: each swap of view
  // dropped focus to the page and said nothing. The view's first line takes focus (useStepFocus) — read where it lands.
  if (step.at === "loading") return <div ref={scope}><p className="dp-hint" role="status" aria-busy="true">Checking two-step sign-in…</p></div>;

  if (step.at === "failed") {
    return (
      <div ref={scope}>
        {/* raw words: our own sentence (the "failed" step's, set above) */}
        <p className="cfm-body" role="alert">{step.message}</p>
        <div className="prod-actions cfm-actions">
          <button type="button" className="btn-pri" onClick={() => { acted.current = true; setStep({ at: "loading" }); setAsked((n) => n + 1); }}>Try again</button>
        </div>
      </div>
    );
  }

  if (step.at === "off") {
    return (
      <div ref={scope}>
        <p className="cfm-body">Two-step sign-in is off.</p>
        <p className="dp-hint">
          Turn it on and the money, the books, customers and the crew&rsquo;s roles ask for a six-digit code from an
          authenticator app — Apple&rsquo;s Passwords, Google Authenticator or 1Password — once each sign-in. A password, or a
          code read off your email, is no longer enough on its own.
        </p>
        {/* The iPhone app's screens are its own build's: one from before R28 can't ask for the code, and the database
            holds the owner's and admin's powers to it there too. Said on the web, where it can be set up first. */}
        {!isNativeApp() && (
          <p className="dp-hint">
            Use the GT3 iPhone app as well? Update it first — a version from before two-step sign-in can&rsquo;t ask for
            the code, so it would open with the crew&rsquo;s tools only.
          </p>
        )}
        {err && <div className="auth-err" role="alert">{err}</div>}
        <div className="prod-actions cfm-actions">
          <button type="button" className="btn-pri" onClick={() => void begin()} disabled={busy}>{busy ? "Starting…" : "Set up two-step sign-in"}</button>
        </div>
      </div>
    );
  }

  if (step.at === "scan") {
    const { enrol } = step;
    return (
      <div ref={scope}><form noValidate onSubmit={(e) => { e.preventDefault(); void prove(enrol); }}>
        <p className="cfm-body">Add GT3 to your authenticator.</p>
        <p className="dp-hint">Scan this with your authenticator app{isNativeApp() ? ", or add it on this iPhone with the link below" : ""}.</p>
        {/* Black on white whatever the theme: a camera reads the code by its contrast. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- Supabase's QR code, a data URL drawn here; next/image cannot export it */}
        <img src={qrSrc(enrol.qr)} alt="A QR code for your authenticator app" width={192} height={192} className="mt-3 rounded-xl bg-white p-3" />
        {isNativeApp() && (
          <p className="mt-2"><a className="auth-link min-h-11 inline-flex items-center" href={enrol.uri}>Add to an authenticator on this iPhone</a></p>
        )}
        <p className="dp-hint mt-2">
          Can&rsquo;t scan it? Type this key into the app: <b className="select-all [font-variant-numeric:tabular-nums] tracking-wide">{keyGroups(enrol.secret)}</b>
        </p>
        <p className="dp-hint mt-3" id="ts-code-for">Then enter the six-digit code the app shows for GT3.</p>
        {codeField("The code from your authenticator")}
        {err && <div className="auth-err" role="alert">{err}</div>}
        <button className="btn-pri btn-wide mt-3" type="submit" disabled={busy || code.length < TOTP_LEN}><span>{busy ? "Checking…" : "Turn it on"}</span></button>
      </form></div>
    );
  }

  const { state } = step;
  return (
    <div ref={scope}>
      <Said as="p" className="cfm-body" quietFirst>Two-step sign-in is on.</Said>
      <p className="dp-hint">
        The money, the books, customers and the crew&rsquo;s roles ask for your authenticator&rsquo;s code once each sign-in.
        {state?.given ? " This sign-in has given it." : ""}
      </p>
      {state?.owner && (
        <div className="rows mt-3.5">
          <div className="row">
            <div className="rl">
              <b>Ask every owner and admin for it</b>
              <span>{state.required ? "On — one without an authenticator uses the crew's tools until they set one up" : "Off — each owner and admin decides for themselves"}</span>
            </div>
            <button type="button" role="switch" aria-checked={state.required} aria-label="Ask every owner and admin for it"
              className={`k-switch${state.required ? " on" : ""}`} disabled={busy || !state.given}
              aria-describedby={!state.given ? "ts-need-code" : undefined} onClick={() => void require(state, !state.required)}>
              <span className="k-switch-k" />
            </button>
          </div>
        </div>
      )}
      {state?.owner && !state.given && <p className="dp-hint" id="ts-need-code">Give this sign-in&rsquo;s code (in the crew console) to change who it&rsquo;s asked of.</p>}
      {!state?.given && (
        <>
          <p className="dp-hint mt-3" id="ts-code-for">To turn it off, enter the code from your authenticator.</p>
          {codeField("The code from your authenticator")}
        </>
      )}
      {err && <div className="auth-err" role="alert">{err}</div>}
      <div className="prod-actions cfm-actions">
        <button type="button" className="btn-ter" onClick={() => void stop(state)} disabled={busy}>{busy ? "Turning it off…" : "Turn off two-step sign-in"}</button>
      </div>
    </div>
  );
}
