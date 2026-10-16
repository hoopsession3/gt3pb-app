"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, supabaseEnabled } from "@/lib/supabase";
import { wipeAccountData } from "@/lib/accountWipe";
import { setQueueOwner } from "@/components/offline";
import { writeViewerHint } from "@/lib/viewerHint";
import type { Role } from "@/lib/roles";
import { publicOrigin } from "@/lib/native";
import { takeReturn } from "@/lib/returnTo";
import { markSigninAsked, signinAskedHere, OPENED_WITH_SESSION } from "@/lib/linkSignin";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

// SET A NEW PASSWORD, LOADED WHEN IT IS NEEDED (R8, 2026-10-16). The overlay a reset code or link raises
// (PASSWORD_RECOVERY) rode in every page's first download — the one bundle every route carries — for a screen a member
// sees once in a long while. It loads the moment it is asked for (components/PasswordRecovery).
// Its code fetched as the reset screen asks for the code (components/SignIn), so it is here when the code is checked; and
// if it still cannot be fetched — the connection dropped at that moment — the overlay says so and offers a reload, which
// raises it again (RECOVERY_KEY, below), instead of Next's "Application error" over the whole app.
const PasswordRecovery = dynamic(() => import("./PasswordRecovery").catch(() => ({ default: RecoveryDidNotLoad })), { ssr: false });
// Loaded only when a link signs a device in that asked for none (R9): every route carries this provider.
const LinkSigninNotice = dynamic(() => import("./LinkSigninNotice"), { ssr: false });
const RECOVERY_KEY = "gt3-recovery";   // this tab is mid-reset: a reload raises the overlay again
const recoveryPending = (on: boolean | null): boolean => {
  try {
    if (on === true) sessionStorage.setItem(RECOVERY_KEY, "1");
    else if (on === false) sessionStorage.removeItem(RECOVERY_KEY);
    return sessionStorage.getItem(RECOVERY_KEY) === "1";
  } catch { return false; }
};
function RecoveryDidNotLoad({ onCancel }: { updatePassword: unknown; onDone: () => void; onCancel: () => void }) {
  return (
    <div className="qd-scrim z-[200]" role="alertdialog" aria-modal="true" aria-label="Set a new password">
      <div className="qd-sheet max-w-[460px]"><div className="qd-body p-[22px]">
        <h1 className="auth-headline mt-0">Set a new password.</h1>
        <p className="auth-sub">This screen didn&apos;t load — check your connection, then reload to set your new password.</p>
        <button type="button" className="btn-pri btn-wide mt-4.5" onClick={() => window.location.reload()}><span>Reload</span></button>
        <button type="button" className="auth-link hit-44 mt-2.5" onClick={onCancel}>Cancel</button>
      </div></div>
    </div>
  );
}

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
  // "email": the sign-in or sign-up code; "recovery": the password-reset code, whose session raises the
  // set-a-new-password overlay (supabase-js fires PASSWORD_RECOVERY for it, as for the reset link).
  verifyCode: (email: string, token: string, kind?: "email" | "recovery") => Promise<{ error?: string }>;
  signInWithUrl: (url: string) => Promise<{ error?: string }>;
  signInWithPassword: (email: string, password: string) => Promise<{ error?: string }>;
  // `existing`: the email already had an account — a sign-in code went to it instead (R8, below).
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error?: string; confirm?: boolean; existing?: boolean }>;
  resetPassword: (email: string) => Promise<{ error?: string }>;
  /** A new account's confirmation sent again — its email and code (R8: the confirm screen's Resend). */
  resendConfirm: (email: string) => Promise<{ error?: string }>;
  updatePassword: (password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  // Whose profile to read again: the signed-in person's, or — right after a sign-in this provider has not heard about
  // yet (components/AppleSignIn) — the one named.
  refreshProfile: (uid?: string) => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(!supabaseEnabled); // if no Supabase, we're "ready" immediately
  const [user, setUser] = useState<User | null>(null);
  // A sign-in this device never asked for, said (R9, lib/linkSignin): the email it is signed in as, until answered —
  // asked once a page load, of the session the address brought.
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const linkSeen = useRef(false);
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

  // When the profile was last read — the quiet re-read on return (below) waits 30 seconds after one.
  const lastProfileRead = useRef(0);
  // THE LAST READ ASKED FOR IS THE ONE THAT LANDS (2026-10-11, the review): a sign-in's read, then a read asked for
  // because the row just changed (a name the sign-in kept: refreshProfile) — the older one coming back last put the old row back.
  const profileAsk = useRef(0);
  // THE SAME PERSON, READ AGAIN, IS READ QUIETLY (2026-10-11). Every auth event reads the profile — a token refresh, a
  // return to the app — and each one said "loading": the console went blank under the person using it, and a read that
  // failed put "Couldn't load your account" over a profile still in hand. `shown` is whose profile is here, read and
  // ready; a read for them again changes nothing until a row lands, and a failure keeps it. Another person, or a
  // sign-out, starts over.
  const shown = useRef<string | null>(null);
  const loadProfile = useCallback(async (uid: string) => {
    if (!supabase) return;
    const ask = ++profileAsk.current;
    const quiet = shown.current === uid;
    if (!quiet) setProfileStatus("loading");
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
    if (quiet && error) return;               // the profile already here stays, and so does "ready"
    if (ask !== profileAsk.current) return;   // a newer read is on its way, and it sets the status
    if (error) { setProfileStatus("error"); return; }
    setProfile(data as Profile | null);
    setProfileStatus("ready");   // includes a genuine null: asked, answered, no row
    shown.current = uid;
    lastProfileRead.current = Date.now();
  }, []);

  // WHO YOU ARE, READ AGAIN WHEN YOU COME BACK (2026-10-08). The profile — and the role in it — was
  // read when the session started and on a sign-in, and never again. Bringing someone onto the crew
  // changes their row at once (promote_to_crew; the database's own checks read the row, not the
  // token), but a phone that already had GT3 open kept showing the customer app until they signed
  // out and back in — which is the first thing Ryan had to text Niño: "Sign out and sign out of the
  // app". Now the row is read again when the app comes back to the screen, at most every 30 seconds,
  // QUIETLY: no "loading" in between (every screen would flash), and the same rule as above — a
  // failed or empty re-read changes nothing, so a blip never demotes anyone. An unchanged row is not
  // set again, so a return to the app does not re-render the whole tree for nothing.
  useEffect(() => {
    if (!supabase || !user) return;
    const sb = supabase, uid = user.id;
    const onBack = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastProfileRead.current < 30_000) return;
      lastProfileRead.current = Date.now();
      const ask = profileAsk.current;
      void sb.from("profiles").select("*").eq("id", uid).maybeSingle().then(({ data, error }) => {
        if (error || !data || ask !== profileAsk.current) return;   // a full read began since: it has the newer row
        setProfile((prev) => (prev && JSON.stringify(prev) === JSON.stringify(data) ? prev : (data as Profile)));
      });
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => { document.removeEventListener("visibilitychange", onBack); window.removeEventListener("focus", onBack); };
  }, [user]);

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
      writeViewerHint(!!data.session?.user);                   // the front door's copy (lib/viewerHint.ts)
      if (!data.session?.user) setProfileStatus("ready");      // no session ⇒ no profile, and we know it
      // Utilization (0267): no session = an anonymous visitor — count the visit (daily counter,
      // no IDs, throttled to one ping per device per hour in lib/track).
      if (!data.session?.user) import("@/lib/track").then((m) => m.trackGuest(), () => {});
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      writeViewerHint(!!u);
      setQueueOwner(u?.id ?? null);   // the offline queue replays only its own person's writes (R10b, components/offline)
      if (u) loadProfile(u.id);
      else { profileAsk.current++; shown.current = null; setProfile(null); setProfileStatus("ready"); }   // signed out: known, not unknown — a read still out lands nowhere, and the next one is not quiet
      if (event === "SIGNED_OUT") wipeAccountData();   // a sign-out from anywhere — another tab, the phone's own — wipes too
      // Utilization (0267): a real sign-in bumps the login counter; INITIAL_SESSION (cold-start
      // session restore) counts as presence, not a login — so "logins" answers "how many times
      // did they actually sign in," not "how many times did the PWA wake up."
      if (u && event === "SIGNED_IN") import("@/lib/track").then((m) => m.trackUser("login", true), () => {});
      else if (u && event === "INITIAL_SESSION") import("@/lib/track").then((m) => m.trackUser("open"), () => {});
      // A reset link, or the reset code (verifyOtp type "recovery"), signs the user in with a short-lived recovery
      // session and fires this event — gate the app behind a "set a new password" overlay until they pick one.
      if (event === "PASSWORD_RECOVERY") { recoveryPending(true); setRecovery(true); }
      // A reload in the middle of setting a new password (the overlay's Reload, above): raised again.
      else if (u && event === "INITIAL_SESSION" && recoveryPending(null)) setRecovery(true);
      // THE PAGE YOU STARTED ON (2026-10-09, lib/returnTo): a sign-in link lands on the front door; the
      // sign-in it completes goes back to the page the link was asked for on, once.
      // A session that arrived in the address, on a device that asked for no sign-in in the last day (R9): whose it is,
      // said once, with a way out — a link someone else asked for, opened here, signed this device into their account.
      if (u && (event === "SIGNED_IN" || event === "INITIAL_SESSION") && OPENED_WITH_SESSION && !linkSeen.current) {
        linkSeen.current = true;
        if (!signinAskedHere()) setLinkNotice(u.email ?? "another account");
      }
      if (u && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        const to = takeReturn();
        if (to && to !== window.location.pathname + window.location.search) router.replace(to);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, router]);

  const sendCode = useCallback<AuthCtx["sendCode"]>(async (email, displayName) => {
    if (!supabase) return { error: "Sign-in isn't configured yet." };
    // The email carries a code and a link (2026-10-10: the "Magic link or OTP" and "Confirm sign up"
    // templates put {{ .Token }} above the link). The screen asks for the code (SignIn → verifyCode); the
    // link still works where it opens: emailRedirectTo brings that browser back signed in, and
    // detectSessionInUrl (set in lib/supabase) completes it.
    // publicOrigin (lib/native): the web's own address on the web, app.gt3pb.com in the iPhone app,
    // whose own address (capacitor://localhost) means nothing to a mail app.
    markSigninAsked();   // this device asked: its link reads as its own (R9, lib/linkSignin)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: typeof window !== "undefined" ? publicOrigin() : undefined,
        data: displayName ? { display_name: displayName } : undefined,
      },
    });
    return error ? { error: error.message } : {};
  }, []);

  const verifyCode = useCallback<AuthCtx["verifyCode"]>(async (email, token, kind = "email") => {
    if (!supabase) return { error: "Sign-in isn't configured yet." };
    const { error } = await supabase.auth.verifyOtp({ email, token, type: kind });
    return error ? { error: error.message } : {};
  }, []);

  // A sign-in URL carrying tokens becomes this page's session: the iPhone app's appUrlOpen hands it one
  // (NativeBridge). The paste-your-URL box that also used it is gone (2026-10-10) — the code replaced it.
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
      const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) return { error: error.message };
      // The iPhone app's sign-in link (NativeBridge): the same notice when this phone asked for none (R9, lib/linkSignin).
      if (!signinAskedHere()) setLinkNotice(data.user?.email ?? "another account");
      return {};
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
    markSigninAsked();   // its confirmation link, or the sign-in code sent instead, is this device's own (R9)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: displayName ? { display_name: displayName } : undefined,
        emailRedirectTo: typeof window !== "undefined" ? publicOrigin() : undefined,
      },
    });
    if (error) return { error: error.message };
    // AN EMAIL THAT ALREADY HAS AN ACCOUNT (R8, 2026-10-16). Supabase answers a sign-up for it as if it were new — no
    // error, a user with no identities, and no email sent — so nobody can learn from the form who is a member. The screen
    // then said "We sent a code" and nothing came: the member waited on a code that was never sent. The address is sent a
    // sign-in code instead, on the same screen (the code screen checks either kind), so whoever owns the email gets in and
    // whoever doesn't learns nothing; the one who owns it is told once they are in (SignIn). A send refused (too soon
    // after the last) is not said either: the screen's Resend is there.
    if (data.user && !data.session && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: typeof window !== "undefined" ? publicOrigin() : undefined },
      }).catch(() => null);
      return { confirm: true, existing: true };
    }
    // If session is null but user exists, email confirmation is required
    return { confirm: !data.session && !!data.user };
  }, []);

  // Email a password reset — a code and a link (2026-10-11: the "Reset password" template puts {{ .Token }}
  // above the link; SignIn asks for the code, verifyCode(…, "recovery")). Works for anyone with a password OR
  // who only ever used a code (Supabase sets or overwrites the password on completion), so everyone can recover.
  const resetPassword = useCallback<AuthCtx["resetPassword"]>(async (email) => {
    if (!supabase) return { error: "Sign-in isn't configured yet." };
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== "undefined" ? publicOrigin() : undefined,
    });
    return error ? { error: error.message } : {};
  }, []);

  // THE CONFIRMATION, SENT AGAIN (R8, 2026-10-16). The confirm screen had no Resend: an email that never came, or a
  // join met by the account the email already had (a sign-in code goes instead — signUp, above — and a send refused for
  // coming too soon was said nowhere), left the member waiting with no way on. A new account's Resend is Supabase's own
  // resend of its "Confirm sign up" email; the account that was already there is sent a sign-in code (SignIn).
  const resendConfirm = useCallback<AuthCtx["resendConfirm"]>(async (email) => {
    if (!supabase) return { error: "Sign-in isn't configured yet." };
    markSigninAsked();   // this device asked: its link reads as its own (R9, lib/linkSignin)
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: typeof window !== "undefined" ? publicOrigin() : undefined } });
    return error ? { error: error.message } : {};
  }, []);

  // Set the new password (the recovery session's, or — R8 — a join that met the account it already had: SignIn). The
  // overlay is not dropped here (R8, 2026-10-16): it dropped the moment the password saved, so "Password updated." was
  // never seen — the sheet vanished and the focus with it. Its Continue drops it (PasswordRecovery, onDone).
  const updatePassword = useCallback<AuthCtx["updatePassword"]>(async (password) => {
    if (!supabase) return { error: "Sign-in isn't configured yet." };
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: error.message };
    return {};
  }, []);

  const signOut = useCallback(async () => {
    // OUT IS OUT, OFFLINE TOO (R8). supabase-js asks the server first and, on a network error or a 5xx, returns that error
    // without clearing the session it stored: the screen said "Signed out", and the next time the app came back to the
    // front the same person was signed in again — on a shared phone, the next person was in their account. Its answer is
    // read now: refused, this phone's copy is removed by the library's own step for it (which says SIGNED_OUT to every
    // listener), else by its stored keys. The server's copy of the session expires on its own.
    const r = await supabase?.auth.signOut().catch((e: unknown) => ({ error: e }));
    if (r?.error && supabase) {
      // Not stopAutoRefresh: it takes the library's visibility listener with it, and the next sign-in would never refresh.
      const auth = supabase.auth as unknown as { _removeSession?: () => Promise<void> };
      try {
        if (typeof auth._removeSession === "function") await auth._removeSession();
        else for (const k of Object.keys(localStorage)) if (/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k);
      } catch { /* storage refused: the in-app state below is cleared all the same */ }
    }
    shown.current = null;
    setUser(null);
    setProfile(null);
    wipeAccountData();   // what was theirs leaves the phone with them (R10b, lib/accountWipe)
  }, []);

  // SIGN IN WITH APPLE lives in the iPhone app's own code, not here (2026-10-11): the button and its flow in
  // components/AppleSignIn, the "stopped using it in Settings" sign-out in components/NativeBridge. Every route on the
  // web carries this provider; not a byte of Apple's sign-in rides in it.
  const refreshProfile = useCallback(async (uid?: string) => {
    const id = uid ?? user?.id;
    if (id) await loadProfile(id);
  }, [user, loadProfile]);

  // Memoize the context value so incidental provider re-renders don't re-render the whole admin
  // subtree (which churns the Studio realtime channel). supabaseEnabled is a module constant.
  const value = useMemo(() => ({ ready, enabled: supabaseEnabled, user, profile, profileStatus, sendCode, verifyCode, signInWithUrl, signInWithPassword, signUp, resetPassword, resendConfirm, updatePassword, signOut, refreshProfile }), [ready, user, profile, profileStatus, sendCode, verifyCode, signInWithUrl, signInWithPassword, signUp, resetPassword, resendConfirm, updatePassword, signOut, refreshProfile]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Saved is saved (R8): the reload flag goes the moment the new password is, not at Continue — a reload on "Password
          updated." would raise "Set a new password." again, and its Cancel sign them out of the account they just secured. */}
      {linkNotice && <LinkSigninNotice email={linkNotice} onKeep={() => { markSigninAsked(); setLinkNotice(null); }} onLeave={() => { setLinkNotice(null); void signOut(); }} />}
      {recovery && <PasswordRecovery updatePassword={async (pw) => { const r = await updatePassword(pw); if (!r.error) recoveryPending(false); return r; }} onDone={() => { recoveryPending(false); setRecovery(false); }} onCancel={() => { recoveryPending(false); setRecovery(false); signOut(); }} />}
    </Ctx.Provider>
  );
}
