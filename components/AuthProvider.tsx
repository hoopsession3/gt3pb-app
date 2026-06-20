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
}

interface AuthCtx {
  ready: boolean; // initial session resolved
  enabled: boolean; // Supabase configured (env present)
  user: User | null;
  profile: Profile | null;
  sendCode: (email: string, displayName?: string) => Promise<{ error?: string }>;
  verifyCode: (email: string, token: string) => Promise<{ error?: string }>;
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
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, data: displayName ? { display_name: displayName } : undefined },
    });
    return error ? { error: error.message } : {};
  }, []);

  const verifyCode = useCallback<AuthCtx["verifyCode"]>(async (email, token) => {
    if (!supabase) return { error: "Sign-in isn't configured yet." };
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    return error ? { error: error.message } : {};
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
    <Ctx.Provider value={{ ready, enabled: supabaseEnabled, user, profile, sendCode, verifyCode, signOut, refreshProfile }}>
      {children}
    </Ctx.Provider>
  );
}
