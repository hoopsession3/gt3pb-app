"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
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
}

interface AuthCtx {
  ready: boolean; // initial session resolved
  enabled: boolean; // Supabase configured (env present)
  user: User | null;
  profile: Profile | null;
  sendCode: (email: string, displayName?: string) => Promise<{ error?: string }>;
  verifyCode: (email: string, token: string) => Promise<{ error?: string }>;
  signInWithUrl: (url: string) => Promise<{ error?: string }>;
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

  const loadProfile = useCallback(async (uid: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    // error (e.g. SQL migration not run yet) → leave profile null; UI falls back to defaults.
    setProfile(error ? null : (data as Profile | null));
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const u = data.session?.user ?? null;
      setUser(u);
      if (u) loadProfile(u.id);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) loadProfile(u.id);
      else setProfile(null);
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

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setUser(null);
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  return (
    <Ctx.Provider value={{ ready, enabled: supabaseEnabled, user, profile, sendCode, verifyCode, signInWithUrl, signOut, refreshProfile }}>
      {children}
    </Ctx.Provider>
  );
}
