"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import SignIn from "@/components/SignIn";
import { clickable } from "@/lib/a11y";

const RING = 232; // 2πr for r=37, matches prototype stroke-dasharray

function useRingFill(fill: number) {
  const ringRef = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const r = ringRef.current;
    if (!r) return;
    const t = setTimeout(() => {
      r.style.transition = "stroke-dashoffset 1.1s ease";
      r.style.strokeDashoffset = String(RING * (1 - fill));
    }, 700);
    return () => clearTimeout(t);
  }, [fill]);
  return ringRef;
}

function ReferralCard({ code }: { code: string }) {
  const { toast } = useApp();
  const [copyLbl, setCopyLbl] = useState("Copy");
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(code); } catch { /* clipboard may be blocked */ }
    setCopyLbl("Copied!");
    setTimeout(() => setCopyLbl("Copy"), 1400);
    toast("Referral code copied");
  };
  return (
    <div className="referral">
      <div className="eyb">Grow The 3MPIRE</div>
      <h3>Give a cuppa, get a cuppa.</h3>
      <div className="code"><b>{code}</b><span className="cp" aria-label={`Copy referral code ${code}`} {...clickable(copyCode)}>{copyLbl}</span></div>
    </div>
  );
}

// ───────────────────────── signed-in, profile-driven ─────────────────────────
function MpireReal() {
  const { toast } = useApp();
  const { profile, user, signOut } = useAuth();
  const router = useRouter();

  const name = profile?.display_name || (user?.email ? user.email.split("@")[0] : "Member");
  const points = profile?.points ?? 0;
  const streak = profile?.streak_days ?? 1;
  const credit = ((profile?.credit_cents ?? 0) / 100).toFixed(2);
  const code = profile?.referral_code || "GT3PB-3MP";
  const cuppas = Math.min(points, 10);
  const ringRef = useRingFill(cuppas / 10);

  return (
    <section className="screen" id="s-mpire">
      <div className="toprow">
        <div className="eyb">Membership</div>
        <Link className="pf" href="/3mpire">{name.charAt(0).toUpperCase()}</Link>
      </div>

      <div className="memcard"><div className="min">
        <div className="ring">
          <svg width="88" height="88">
            <circle cx="44" cy="44" r="37" fill="none" stroke="rgba(245,241,232,.1)" strokeWidth="8" />
            <circle ref={ringRef} cx="44" cy="44" r="37" fill="none" stroke="#B82420" strokeWidth="8" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING} />
          </svg>
          <div className="rc">{cuppas}<small>OF 10</small></div>
        </div>
        <div className="mt">
          <div className="eyb">★ {profile?.founding_member ? "Founding Member" : "Member"}</div>
          <h2>{name}</h2>
          <p>{10 - cuppas} cuppas from a free pour. Earn a point on every drink, double on subscription boxes.</p>
        </div>
      </div></div>

      <div className="cells">
        <div className="cell"><div className="cv gold">{points}</div><div className="cl">Points</div></div>
        <div className="cell"><div className="cv ok">Day {streak}</div><div className="cl">Streak</div></div>
        <div className="cell"><div className="cv">${credit}</div><div className="cl">Credit</div></div>
      </div>

      <ReferralCard code={code} />

      <div className="sec">Your account</div>
      <div className="rows">
        {profile?.is_admin && (
          <div className="row" aria-label="Back office" {...clickable(() => router.push("/admin"))}>
            <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></svg></div>
            <div className="rl"><b>Back office</b><span>Live truck · members · events</span></div>
            <div className="rr">›</div>
          </div>
        )}
        <div className="row" aria-label="My Subscription" {...clickable(() => toast("No active subscription yet — start one at the truck"))}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M3 7h18v13H3zM3 7l3-4h12l3 4M9 11h6" /></svg></div>
          <div className="rl"><b>My Subscription</b><span>Not subscribed yet</span></div>
          <div className="rr">›</div>
        </div>
        <div className="row" aria-label="Order History" {...clickable(() => toast("No orders yet — your history shows here"))}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M3 3h18v4H3zM5 7v14h14V7M9 11h6" /></svg></div>
          <div className="rl"><b>Order History</b><span>No orders yet</span></div>
          <div className="rr">›</div>
        </div>
        <div className="row" aria-label="Saved Events" {...clickable(() => router.push("/events"))}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg></div>
          <div className="rl"><b>Saved Events</b><span>Track stops + RSVP</span></div>
          <div className="rr">›</div>
        </div>
        <div className="row" aria-label="Book the bar — B2B" {...clickable(() => router.push("/book"))}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M3 9h18M3 9l2-5h14l2 5M5 9v11h14V9M9 13h6" /></svg></div>
          <div className="rl"><b>Book the bar</b><span>Bring GT3PB to your event — B2B</span></div>
          <div className="rr">›</div>
        </div>
        <div className="row" aria-label="Sign out" {...clickable(() => { signOut(); toast("Signed out"); })}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg></div>
          <div className="rl"><b>Sign out</b><span>{user?.email}</span></div>
          <div className="rr">›</div>
        </div>
      </div>

      <div className="domain">
        <Image src="/gt3pb-domain.png" alt="GT3PB.COM" width={170} height={24} style={{ height: 24, width: "auto", opacity: 0.8 }} priority />
      </div>
      <div className="tag-soft">Pure Signal, No Noise.</div>
    </section>
  );
}

// ───────────────────────── demo (Supabase not configured) ─────────────────────────
function MpireDemo() {
  const { toast } = useApp();
  const router = useRouter();
  const ringRef = useRingFill(0.7);
  return (
    <section className="screen" id="s-mpire">
      <div className="toprow">
        <div className="eyb">Membership</div>
        <Link className="pf" href="/3mpire">R</Link>
      </div>

      <div className="memcard"><div className="min">
        <div className="ring">
          <svg width="88" height="88">
            <circle cx="44" cy="44" r="37" fill="none" stroke="rgba(245,241,232,.1)" strokeWidth="8" />
            <circle ref={ringRef} cx="44" cy="44" r="37" fill="none" stroke="#B82420" strokeWidth="8" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING} />
          </svg>
          <div className="rc">7<small>OF 10</small></div>
        </div>
        <div className="mt">
          <div className="eyb">★ Founding Member</div>
          <h2>Ryan T.</h2>
          <p>3 cuppas from a free pour. Earn a point on every drink, double on subscription boxes.</p>
        </div>
      </div></div>

      <div className="cells">
        <div className="cell"><div className="cv gold">142</div><div className="cl">Points</div></div>
        <div className="cell"><div className="cv ok">Day 8</div><div className="cl">Streak</div></div>
        <div className="cell"><div className="cv">$14.00</div><div className="cl">Credit</div></div>
      </div>

      <ReferralCard code="RYAN-3MP" />

      <div className="sec">Your account</div>
      <div className="rows">
        <div className="row" aria-label="My Subscription" {...clickable(() => toast("Bi-weekly · RISE + FLOW · next ships Mon"))}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M3 7h18v13H3zM3 7l3-4h12l3 4M9 11h6" /></svg></div>
          <div className="rl"><b>My Subscription</b><span>Bi-weekly · RISE + FLOW · next ships Mon</span></div>
          <div className="rr">›</div>
        </div>
        <div className="row" aria-label="Order History" {...clickable(() => toast("Showing your last 6 orders"))}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M3 3h18v4H3zM5 7v14h14V7M9 11h6" /></svg></div>
          <div className="rl"><b>Order History</b><span>Last: 2× FLOW · Duncan Square</span></div>
          <div className="rr">›</div>
        </div>
        <div className="row" aria-label="Saved Events" {...clickable(() => router.push("/events"))}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg></div>
          <div className="rl"><b>Saved Events</b><span>3 stops tracked this week</span></div>
          <div className="rr">›</div>
        </div>
        <div className="row" aria-label="Book the bar — B2B" {...clickable(() => router.push("/book"))}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M3 9h18M3 9l2-5h14l2 5M5 9v11h14V9M9 13h6" /></svg></div>
          <div className="rl"><b>Book the bar</b><span>Bring GT3PB to your event — B2B</span></div>
          <div className="rr">›</div>
        </div>
      </div>

      <div className="domain">
        <Image src="/gt3pb-domain.png" alt="GT3PB.COM" width={170} height={24} style={{ height: 24, width: "auto", opacity: 0.8 }} priority />
      </div>
      <div className="tag-soft">Pure Signal, No Noise.</div>
    </section>
  );
}

export default function MpireScreen() {
  const { ready, enabled, user } = useAuth();
  if (!enabled) return <MpireDemo />;
  if (!ready) return <section className="screen" id="s-mpire" />;
  if (!user) return <SignIn />;
  return <MpireReal />;
}
