"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, supabaseEnabled } from "@/lib/supabase";

export interface Profile {
  id: string;
  display_name: string | null;
  referral_code: string | null;
  points: number;
  streak_days: number;
  credit_cents: number;
  founding_member: boolean;
  is_admin: boolean;
  role?: "member" | "server" | "admin" | "owner";
  referred_by: string | null;
  avatar_url?: string | null;
  title?: string | null;
  bio?: string | null;
}

// Effective role with a graceful fallback for profiles loaded before the roles
// migration ran (legacy admins read as owner).
export function roleOf(p: { role?: string | null; is_admin?: boolean } | null): "member" | "server" | "admin" | "owner" {
  const r = p?.role;
  if (r === "server" || r === "admin" || r === "owner") return r;
  return p?.is_admin ? "owner" : "member";
}

interface AuthCtx {
  ready: boolean;
  enabled: boolean;
  user: User | null;
  profile: Profile | null;
  sendCode: (email: string, displayName?: string) => Promise<{ error?: string }>;
  verifyCode: (email: string, token: string) => Promise<{ error?: string }>;
  signInWithUrl: (url: string) => Promise<{ error?: string }>;
  signInWithPassword: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error?: string; confirm?: boolean }>;
  resetPassword: (email: string) => Promise<{ error?: string }>;
  updatePassword: (password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!supabaseEnabled); // if no Supabase, we're "ready" immediately
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recovery, setRecovery] = useState(false); // landed via a password-reset link → must set a new password

  const loadProfile = useCallback(async (uid: string) => {
    if (!supabase) return;
    let { data, error } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    // First load with no referrer yet + a stored ?ref= code → attach it (write-once, server-validated).
    if (!error && data && !(data as Profile).referred_by && typeof window !== "undefined") {
      const code = localStorage.getItem("gt3_ref");
      if (code) {
        localStorage.removeItem("gt3_ref"); // consume first so a concurrent load can't re-issue it
        await supabase.rpc("attach_referral", { code });
        const r2 = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
        if (!r2.error && r2.data) data = r2.data;
      }
    }
    // error (e.g. SQL migration not run yet) → leave profile null; UI falls back to defaults.
    setProfile(error ? null : (data as Profile | null));
  }, []);

  // Capture a referral code from the invite link (/?ref=CODE) before sign-in so it
  // survives the auth round-trip; loadProfile attaches it on first profile load.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const r = new URLSearchParams(window.location.search).get("ref");
      if (r && r.trim()) localStorage.setItem("gt3_ref", r.trim());
    } catch { /* storage may be blocked */ }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      // Only set user/ready here; onAuthStateChange fires INITIAL_SESSION and owns the
      // profile load, so we don't fetch (or attach_referral) twice on cold start.
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) loadProfile(u.id);
      else setProfile(null);
      // Clicking a reset link signs the user in with a short-lived recovery session and fires this
      // event — gate the app behind a "set a new password" overlay until they pick one.
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const sendCode = useCallback<AuthCtx["sendCode"]>(async (email, displayName) => {
    if (!supabase) return { error: "Sign-in isn't configured yet." };
    // Free-tier Supabase email sends a magic LINK (templates are locked without custom
    // SMTP). emailRedirectTo brings the user back to the app signed in; detectSessionInUrl
    // (set in lib/supabase) completes it. When Resend SMTP lands we can switch to a 6-digit code.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        data: displayName ? { display_name: displayName } : undefined,
      },
    });
    return error ? { error: error.message } : {};
  }, []);

  const verifyCode = useCallback<AuthCtx["verifyCode"]>(async (email, token) => {
    if (!supabase) return { error: "Sign-in isn't configured yet." };
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    return error ? { error: error.message } : {};
  }, []);

  // For iOS PWA: magic links open in Safari (separate storage). The user copies the
  // full redirect URL from Safari's address bar and pastes it here so we can extract
  // the access/refresh tokens and set the session in the PWA context.
  const signInWithUrl = useCallback<AuthCtx["signInWithUrl"]>(async (url) => {
    if (!supabase) return { error: "Sign-in isn't configured yet." };
    try {
      const parsed = new URL(url.trim());
      // Implicit flow: tokens arrive in the URL hash fragment (#access_token=...&refresh_token=...)
      const frag = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.search.slice(1);
      const p = new URLSearchParams(frag);
      const access_token = p.get("access_token");
      const refresh_token = p.get("refresh_token");
      if (!access_token || !refresh_token)
        return { error: "Paste the full URL from your browser's address bar after clicking the sign-in link." };
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      return error ? { error: error.message } : {};
    } catch {
      return { error: "That doesn't look like a valid sign-in URL." };
    }
  }, []);

  const signInWithPassword = useCallback<AuthCtx["signInWithPassword"]>(async (email, password) => {
    if (!supabase) return { error: "Sign-in isn't configured yet." };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }, []);

  const signUp = useCallback<AuthCtx["signUp"]>(async (email, password, displayName) => {
    if (!supabase) return { error: "Sign-in isn't configured yet." };
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: displayName ? { display_name: displayName } : undefined,
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });
    if (error) return { error: error.message };
    // If session is null but user exists, email confirmation is required
    return { confirm: !data.session && !!data.user };
  }, []);

  // Email a password-reset link. Works for anyone with a password OR who only ever used magic links
  // (Supabase just sets/overwrites the password on completion), so every user can recover access.
  const resetPassword = useCallback<AuthCtx["resetPassword"]>(async (email) => {
    if (!supabase) return { error: "Sign-in isn't configured yet." };
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
    });
    return error ? { error: error.message } : {};
  }, []);

  // Set the new password while in the recovery session, then drop the overlay (the user is now
  // signed in normally with their new password).
  const updatePassword = useCallback<AuthCtx["updatePassword"]>(async (password) => {
    if (!supabase) return { error: "Sign-in isn't configured yet." };
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: error.message };
    setRecovery(false);
    return {};
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setUser(null);
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  // Memoize the context value so incidental provider re-renders don't re-render the whole admin
  // subtree (which churns the Studio realtime channel). supabaseEnabled is a module constant.
  const value = useMemo(() => ({ ready, enabled: supabaseEnabled, user, profile, sendCode, verifyCode, signInWithUrl, signInWithPassword, signUp, resetPassword, updatePassword, signOut, refreshProfile }), [ready, user, profile, sendCode, verifyCode, signInWithUrl, signInWithPassword, signUp, resetPassword, updatePassword, signOut, refreshProfile]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {recovery && <PasswordRecovery updatePassword={updatePassword} onCancel={() => { setRecovery(false); signOut(); }} />}
    </Ctx.Provider>
  );
}

// Shown over the app when the user arrives from a reset link — they pick a new password before
// they can use the app. Reuses the auth styling so it feels like the sign-in screen.
function PasswordRecovery({ updatePassword, onCancel }: { updatePassword: AuthCtx["updatePassword"]; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

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
    <div className="qd-scrim" style={{ zIndex: 200 }} role="dialog" aria-modal="true" aria-label="Set a new password">
      <div className="qd-sheet" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="qd-body" style={{ padding: 22 }}>
          {done ? (
            <>
              <h1 className="auth-headline" style={{ marginTop: 0 }}>Password updated.</h1>
              <p className="auth-sub">You&apos;re all set — you&apos;re signed in with your new password.</p>
              <button className="handle" onClick={onCancel} style={{ marginTop: 18 }}><span>Continue</span></button>
            </>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <h1 className="auth-headline" style={{ marginTop: 0 }}>Set a new password.</h1>
              <p className="auth-sub">Pick a new password for your account. At least 8 characters.</p>
              <label className="auth-label" htmlFor="rec-pass">New password</label>
              <div className="auth-pass-wrap">
                <input id="rec-pass" className="auth-input" type={show ? "text" : "password"} autoComplete="new-password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus />
                <button type="button" className="auth-show-pass" onClick={() => setShow((v) => !v)} tabIndex={-1}>{show ? "Hide" : "Show"}</button>
              </div>
              <label className="auth-label" htmlFor="rec-confirm">Confirm password</label>
              <input id="rec-confirm" className="auth-input" type={show ? "text" : "password"} autoComplete="new-password" placeholder="Repeat password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              {err && <div className="auth-err">{err}</div>}
              <button className="handle" type="submit" disabled={busy} style={{ marginTop: 18 }}><span>{busy ? "Saving…" : "Save new password"}</span></button>
              <button type="button" className="auth-link" onClick={onCancel} style={{ marginTop: 10 }}>Cancel</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
