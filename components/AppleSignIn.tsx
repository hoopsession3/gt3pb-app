"use client";

import { useState } from "react";
import { trackFunnel } from "@/lib/funnel";
import { supabase } from "@/lib/supabase";
import { appleSignInFlow } from "@/lib/appleAuth";
import { useAuth } from "./AuthProvider";

// SIGN IN WITH APPLE — THE BUTTON (2026-10-11). In the iPhone app, first on the sign-in form and as plain as Apple asks:
// its sheet makes the account or signs in to it with Face ID, nothing to type. Apple's own style — white, the system
// font, and the system's Apple glyph (U+F8FF, which only Apple's own fonts draw: this is an iPhone-only button). It is
// Apple's button, not one of the kit's: those wear GT3's look, and this one wears Apple's (the HIG). The web has none —
// it would need a Services ID and a secret Apple makes expire every six months.
//
// ITS OWN FILE, LOADED ONLY IN THE APP, AND THE FLOW WITH IT. Every page carries the sign-in screen and the auth
// provider, so a button only the app draws — and the flow behind it — rode in every guest's bundle on the web: /shop
// crossed its weight ceiling (scripts/design.ratchet.mjs WEIGHT). components/SignIn loads this when it is the app, and
// starts the load as its module is read there, so it is in hand by the time the form asks for it; lib/appleAuth comes
// with it. The profile is read again by the id the sign-in returns (refreshProfile(uid)): the provider has not heard
// about the new session yet. Its own busy, so the email button never reads "Sending…" while Apple's sheet is up.
export default function AppleSignIn({ onError }: { onError: (message: string) => void }) {
  const { refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    if (!supabase) { onError("Sign-in isn't configured yet."); return; }
    setBusy(true); onError("");
    const { error, cancelled } = await appleSignInFlow(supabase, refreshProfile);
    setBusy(false);
    if (error) onError(error);
    else if (!cancelled) trackFunnel("signup", "signed_in");
  };
  return (
    <div className="auth-form mt-5">
      <button type="button" onClick={go} disabled={busy}
        className="flex w-full min-h-[var(--btn-h)] items-center justify-center gap-2 px-5 rounded-[var(--r-2xl)] border border-black/15 bg-white text-black text-body font-semibold [font-family:-apple-system,system-ui,sans-serif] cursor-pointer transition-opacity active:opacity-70 disabled:opacity-60">
        <span aria-hidden="true" className="text-title3 leading-none -mt-0.5">{"\uF8FF"}</span>
        <span>{busy ? "Waiting for Apple…" : "Continue with Apple"}</span>
      </button>
      <div aria-hidden="true" className="flex items-center gap-3 mt-4 -mb-1 [font-family:var(--mono)] text-caption2 tracking-[.16em] uppercase text-cream-dim">
        <span className="flex-1 h-px bg-line" />or<span className="flex-1 h-px bg-line" />
      </div>
    </div>
  );
}
