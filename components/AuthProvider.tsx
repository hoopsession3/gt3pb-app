"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, supabaseEnabled } from "@/lib/supabase";
import { useFocusTrap } from "@/lib/useFocusTrap";
import type { Role } from "@/lib/roles";

export interface Profile {
  id: string;
  display_name: string | null;
  referral_code: string | null;
  points: number;
  credit_cents: number;
  founding_member: boolean;
  is_admin: boolean;
  is_driver?: boolean;
  // WAS a four-value union hand-written here — "member" | "server" | "admin" | "owner" — while the
  // database has allowed seven since 0031. operator, event_manager and contractor were missing, and
  // `operator` is one of only THREE roles present in production, so every consumer narrowing on
  // this type was reasoning about a role set that does not match the data. Now it IS the vocabulary
  // in lib/roles, so it cannot drift from the CHECK constraint again.
  role?: Role;
  market?: string;              // profiles.market — NOT NULL in the DB, default 'greenville' (0289)
  leads_market?: string | null; // at most one lead per market, partial unique index (0289)
  referred_by: string | null;
  avatar_url?: string | null;
  gender?: "male" | "female" | "other" | null;  // optional; drives the founding-member crest only (0182)
  card_vision?: string | null;                  // member's own 5-year goal — the card hero line (0183)
  card_motto?: string | null;                    // member card motto — canonical, DB-persisted (0186)
  title?: string | null;
  bio?: string | null;
  nav_pins?: string[] | null;  // pinned work-stream keys for the crew bar (0160); null = role default
}

// The role vocabulary now lives in lib/roles.ts so that non-React code can use it — lib/access.ts
// needs it and must stay pure. Re-exported here because five surfaces already import these names
// from this module, and a move that breaks callers is not a move.
export {
  ALL_ROLES, LEADERSHIP_ROLES, STAFF_ROLES, roleOf, isLeadership, isStaff, type Role,
} from "@/lib/roles";

/**
 * Whether we KNOW who this person is yet — separately from `ready`, which only covers the auth
 * session. See the note on profileStatus in the provider: null used to mean three different things
 * and roleOf(null) is "member", so a profile that had not loaded looked exactly like a customer.
 */
export type ProfileStatus = "loading" | "ready" | "error";

interface AuthCtx {
  ready: boolean;
  enabled: boolean;
  user: User | null;
  profile: Profile | null;
  profileStatus: ProfileStatus;
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
  // WHY THIS EXISTS. `profile === null` meant three different things — not fetched yet, the fetch
  // failed, and this person genuinely has no profile row — and roleOf(null) returns "member". So
  // every staff gate in the app read all three as "you are a customer". app/crew renders
  // "Staff only. This area is for GT3PB staff. If that's you, ask the owner to add you" on exactly
  // that condition, which means a slow or failed profile read told the OWNER he does not work here
  // and shut him out of the whole console. Seen live on 2026-09-09, mid-navigation.
  //
  // Same bug class as every false-empty state this audit has been closing — a failed read rendered
  // as a confident negative — but in the auth layer, where the negative is "you are not staff".
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>(supabaseEnabled ? "loading" : "ready");
  const [recovery, setRecovery] = useState(false); // landed via a password-reset link → must set a new password

  const loadProfile = useCallback(async (uid: string) => {
    if (!supabase) return;
    setProfileStatus("loading");
    const first = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    let data = first.data;
    const error = first.error;
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
    // A FAILED READ DOES NOT DEMOTE ANYONE. On error the previously loaded profile stays exactly
    // where it is — dropping a known-good owner to null on a transient refresh is how a working
    // session turns into "Staff only" without anything actually changing. The status carries the
    // failure instead, and callers decide what to say about it.
    if (error) { setProfileStatus("error"); return; }
    setProfile(data as Profile | null);
    setProfileStatus("ready");   // includes a genuine null: asked, answered, no row
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
      if (!data.session?.user) setProfileStatus("ready");      // no session ⇒ no profile, and we know it
      // Utilization (0267): no session = an anonymous visitor — count the visit (daily counter,
      // no IDs, throttled to one ping per device per hour in lib/track).
      if (!data.session?.user) import("@/lib/track").then((m) => m.trackGuest(), () => {});
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) loadProfile(u.id);
      else { setProfile(null); setProfileStatus("ready"); }   // signed out: known, not unknown
      // Utilization (0267): a real sign-in bumps the login counter; INITIAL_SESSION (cold-start
      // session restore) counts as presence, not a login — so "logins" answers "how many times
      // did they actually sign in," not "how many times did the PWA wake up."
      if (u && event === "SIGNED_IN") import("@/lib/track").then((m) => m.trackUser("login", true), () => {});
      else if (u && event === "INITIAL_SESSION") import("@/lib/track").then((m) => m.trackUser("open"), () => {});
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
  const value = useMemo(() => ({ ready, enabled: supabaseEnabled, user, profile, profileStatus, sendCode, verifyCode, signInWithUrl, signInWithPassword, signUp, resetPassword, updatePassword, signOut, refreshProfile }), [ready, user, profile, profileStatus, sendCode, verifyCode, signInWithUrl, signInWithPassword, signUp, resetPassword, updatePassword, signOut, refreshProfile]);

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
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  useFocusTrap(true, panelRef);
  // useFocusTrap's own restore fires on open→false, but this component is always "open" while
  // mounted (it's unmounted wholesale instead) — so restore that contract locally: capture on
  // mount, fire it from whichever exit path (Escape/Cancel/Continue) actually gets used.
  useEffect(() => { restoreRef.current = (document.activeElement as HTMLElement) ?? null; }, []);
  const close = useCallback(() => { restoreRef.current?.focus?.(); onCancel(); }, [onCancel]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

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
              <h1 className="auth-headline" style={{ marginTop: 0 }}>Password updated.</h1>
              <p className="auth-sub">You&apos;re all set — you&apos;re signed in with your new password.</p>
              <button className="handle" onClick={close} style={{ marginTop: 18 }}><span>Continue</span></button>
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
              <button type="button" className="auth-link" onClick={close} style={{ marginTop: 10 }}>Cancel</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
