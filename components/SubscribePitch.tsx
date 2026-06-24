"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { SUB_PACKS, SUBSCRIPTIONS_ON, squareClientReady } from "@/lib/square";

// The subscription, surfaced on the front door. When billing is live it routes into
// the subscribe flow; until then it captures a waitlist (which pack + email) so the
// intent isn't wasted and the operator gets a demand signal — no dead end.
export default function SubscribePitch() {
  const router = useRouter();
  const { toast } = useApp();
  const { user } = useAuth();
  const live = SUBSCRIPTIONS_ON && squareClientReady;

  const [open, setOpen] = useState(false);
  const [pack, setPack] = useState<"6" | "12" | "18">("12");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const join = async () => {
    const em = (user?.email || email).trim();
    if (!em || !/.+@.+\..+/.test(em)) { toast("Add your email so we can reach you", "error"); return; }
    if (!supabase) { toast("We're offline right now — try again in a moment", "error"); return; }
    setBusy(true);
    const { error } = await supabase.from("subscription_interest").insert({ user_id: user?.id ?? null, email: em, pack_size: pack });
    setBusy(false);
    if (error) { toast("That didn't save — give it another tap", "error"); return; }
    setDone(true);
    toast("You're on the list — we'll let you know");
  };

  return (
    <section className="subpitch">
      <div className="eyb">Subscription</div>
      <h2>The bottles you love, always ready.</h2>
      <p>Pick a pack — 6, 12, or 18 bottles — and we&apos;ll have it ready for you every two weeks.</p>
      <div className="subpitch-packs">
        {SUB_PACKS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`subpitch-pack${!live && pack === p.key ? " on" : ""}`}
            onClick={() => !live && setPack(p.key)}
            aria-pressed={!live ? pack === p.key : undefined}
          >
            <b>{p.size}</b><span>bottles</span><em>{p.price}</em>
          </button>
        ))}
      </div>

      {live ? (
        <>
          <button type="button" className="subpitch-cta" onClick={() => router.push("/3mpire")}>Set it up</button>
          <div className="subpitch-fine">Every two weeks. Pause or cancel anytime.</div>
        </>
      ) : done ? (
        <div className="subpitch-done">You&apos;re on the list — we&apos;ll let you know the moment it opens.</div>
      ) : !open ? (
        <>
          <button type="button" className="subpitch-cta" onClick={() => setOpen(true)}>Notify me when it opens</button>
          <div className="subpitch-fine">We&apos;ll send word the day it opens.</div>
        </>
      ) : (
        <>
          {!user && (
            <input
              className="subpitch-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email for the waitlist"
            />
          )}
          <button type="button" className="subpitch-cta" onClick={join} disabled={busy}>{busy ? "…" : `Notify me · ${pack}-pack`}</button>
          <button type="button" className="sub-link" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        </>
      )}
    </section>
  );
}
