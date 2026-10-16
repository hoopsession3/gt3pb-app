"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { nextOnEnter } from "@/lib/formKeys";

// Shown over the app when the user arrives from a reset link or code — they pick a new password before they can use the
// app. Reuses the auth styling so it feels like the sign-in screen. Its own file since R8, loaded when it is raised
// (components/AuthProvider, PASSWORD_RECOVERY): it was in the bundle every page downloads.
export default function PasswordRecovery({ updatePassword, onDone, onCancel }: {
  updatePassword: (password: string) => Promise<{ error?: string }>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  useFocusTrap(true, panelRef);
  // useFocusTrap's own restore fires on open→false, but this component is always "open" while
  // mounted (it's unmounted wholesale instead) — so restore that contract locally: capture on
  // mount, fire it from whichever exit path (Escape/Cancel/Continue) actually gets used.
  useEffect(() => { restoreRef.current = (document.activeElement as HTMLElement) ?? null; }, []);
  const close = useCallback(() => { restoreRef.current?.focus?.(); onCancel(); }, [onCancel]);
  // Saved: Continue (or Escape) goes on signed in — not Cancel's way out, which signs the reset session out.
  const finish = useCallback(() => { restoreRef.current?.focus?.(); onDone(); }, [onDone]);
  const doneHead = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (done) doneHead.current?.focus(); }, [done]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") (done ? finish : close)(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, finish, done]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setErr("Use at least 8 characters."); return; }
    if (password !== confirm) { setErr("Passwords don't match."); return; }
    setBusy(true); setErr("");
    const { error } = await updatePassword(password);
    setBusy(false);
    if (error) setErr(error); else setDone(true);
  };

  return (
    <div className="qd-scrim" style={{ zIndex: 200 }} ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Set a new password">
      <div className="qd-sheet" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="qd-body" style={{ padding: 22 }}>
          {done ? (
            <>
              <h1 className="auth-headline" style={{ marginTop: 0 }} ref={doneHead} tabIndex={-1}>Password updated.</h1>
              <p className="auth-sub">You&apos;re all set — you&apos;re signed in with your new password.</p>
              <button type="button" className="btn-pri btn-wide mt-4.5" onClick={finish}><span>Continue</span></button>
            </>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <h1 className="auth-headline" style={{ marginTop: 0 }}>Set a new password.</h1>
              <p className="auth-sub">Pick a new password for your account. At least 8 characters.</p>
              <label className="auth-label" htmlFor="rec-pass">New password</label>
              <div className="auth-pass-wrap">
                <input id="rec-pass" className="auth-input" enterKeyHint="next" onKeyDown={nextOnEnter} type={show ? "text" : "password"} autoComplete="new-password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus />
                <button type="button" className="auth-show-pass" onClick={() => setShow((v) => !v)} tabIndex={-1}>{show ? "Hide" : "Show"}</button>
              </div>
              <label className="auth-label" htmlFor="rec-confirm">Confirm password</label>
              <input id="rec-confirm" className="auth-input" enterKeyHint="go" type={show ? "text" : "password"} autoComplete="new-password" placeholder="Repeat password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              {err && <div className="auth-err" role="alert">{err}</div>}
              <button className="btn-pri btn-wide mt-4.5" type="submit" disabled={busy}><span>{busy ? "Saving…" : "Save new password"}</span></button>
              <button type="button" className="auth-link hit-44" onClick={close} style={{ marginTop: 10 }}>Cancel</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
