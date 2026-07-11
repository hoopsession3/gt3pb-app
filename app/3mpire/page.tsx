"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth, roleOf } from "@/components/AuthProvider";
import SignIn from "@/components/SignIn";
import AccountPill from "@/components/AccountPill";
import ReviewPrompt from "@/components/ReviewPrompt";
import MembershipCard from "@/components/MembershipCard";
import MyPacks from "@/components/MyPacks";
import MyDeliveries from "@/components/MyDeliveries";
import { supabase } from "@/lib/supabase";
import { DRINKS, type DrinkId } from "@/lib/menu";
import type { Order } from "@/lib/db";
import { clickable } from "@/lib/a11y";

const RING = 232; // 2πr for r=37, matches prototype stroke-dasharray

function histDate(iso: string) {
  const d = new Date(iso);
  const wk = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${wk} · ${mo} ${d.getDate()}`;
}

// Real order history + one-tap reorder (replaces the old stub row).
function OrderHistory() {
  const { reorder } = useApp();
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAll, setShowAll] = useState(false); // quiet by default: 4 rows, the rest fold

  useEffect(() => {
    if (!supabase || !user) { setLoaded(true); return; }
    supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(8)
      .then(({ data }) => { if (data) setOrders(data as Order[]); setLoaded(true); });
  }, [user]);

  if (loaded && orders.length === 0) return null; // stay quiet for brand-new members

  return (
    <>
      <div className="dchapter"><span className="dchn">Recent Orders</span><span className="dchw">order again</span></div>
      <div className="dchrule" />
      {(showAll ? orders : orders.slice(0, 4)).map((o) => (
        <div className="hist-row" key={o.id}>
          <div className="hist-row-l">
            <b>{o.items.map((i) => DRINKS[i as DrinkId]?.n ?? i).join(" · ")}</b>
            <span>{histDate(o.created_at)} · {o.paid ? "Paid" : "Pre-order"}</span>
          </div>
          <span className="hist-px">${(o.total_cents / 100).toFixed(2)}</span>
          <button className="hist-redo" onClick={() => reorder(o.items as DrinkId[])} aria-label="Order this again">↻</button>
        </div>
      ))}
      {orders.length > 4 && (
        <button type="button" className="hist-more" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
          {showAll ? "Fewer ▴" : `All ${orders.length} ▸`}
        </button>
      )}
    </>
  );
}

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
  const { user } = useAuth();
  const [copyLbl, setCopyLbl] = useState("Copy");
  const [stats, setStats] = useState<{ n: number; earned: number } | null>(null);

  // Real earned-credit stats from the referral ledger (referrer = me).
  useEffect(() => {
    if (!supabase || !user) return;
    supabase.from("referral_events").select("referrer_credit_cents").eq("referrer", user.id)
      .then(({ data }) => {
        if (data) setStats({ n: data.length, earned: data.reduce((s, r) => s + (r.referrer_credit_cents ?? 0), 0) });
      });
  }, [user]);

  const link = typeof window !== "undefined" ? `${window.location.origin}/?ref=${encodeURIComponent(code)}` : "";

  const share = async () => {
    const payload = { title: "GT3 Performance Bar", text: `Join me on GT3 — use code ${code} and we both get $5.`, url: link };
    try {
      if (typeof navigator !== "undefined" && navigator.share) { await navigator.share(payload); return; }
    } catch { return; } // user dismissed the share sheet
    try { await navigator.clipboard.writeText(link); toast("Invite link copied"); } catch { toast(link); }
  };
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(code); } catch { /* clipboard may be blocked */ }
    setCopyLbl("Copied!");
    setTimeout(() => setCopyLbl("Copy"), 1400);
    toast("Referral code copied");
  };

  return (
    <div className="referral">
      <div className="eyb">Grow The 3MPIRE</div>
      <h3>Give $5, get $5.</h3>
      <p className="ref-sub">When a friend joins with your code and makes their first order, you each get $5 credit.</p>
      <div className="code"><b>{code}</b><span className="cp" aria-label={`Copy referral code ${code}`} {...clickable(copyCode)}>{copyLbl}</span></div>
      <button type="button" className="ref-share" onClick={share}>Share invite</button>
      {stats && stats.n > 0 && (
        <div className="ref-stat">{stats.n} {stats.n === 1 ? "friend" : "friends"} joined · ${(stats.earned / 100).toFixed(0)} earned</div>
      )}
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
  const creditCents = profile?.credit_cents ?? 0;

  // Deep-link landing — the account popout routes here with #orders / #rewards; scroll to the
  // section once the page has laid out (data blocks mount async).
  useEffect(() => {
    const h = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!h) return;
    const t = setTimeout(() => { document.getElementById(h)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 260);
    return () => clearTimeout(t);
  }, []);

  return (
    <section className="screen" id="s-mpire">
      <div className="toprow">
        <div className="eyb">Membership</div>
        <AccountPill />
      </div>

      {/* The card IS the hero — name, tier, stamps, code, QR, the free-pour promise. The old ring
          card + stat tiles repeated all of it (name ×2, 5/10 ×3); everything they added now lives
          in one quiet line, and credit only speaks up when there's actually credit. */}
      <MembershipCard />
      <div id="rewards" className="memline acs-anchor">
        <span><b>{points}</b> pts</span>
        <span className="memline-dot">·</span>
        <span>day <b>{streak}</b> streak</span>
        {creditCents > 0 && <><span className="memline-dot">·</span><span><b>${credit}</b> credit</span></>}
      </div>

      <ReviewPrompt />

      {/* Your orders — the fulfillment tracker the delivery success screen promises ("track it in
          your account"). Packs and deliveries share one card, live. Each self-hides when empty, so
          a brand-new member sees nothing here. Reserves stay on /events (their own mechanic). */}
      <div id="orders" className="acs-anchor" aria-hidden />
      <MyPacks />
      <MyDeliveries />

      <OrderHistory />

      <ReferralCard code={code} />

      <div className="dchapter"><span className="dchn">Your Account</span><span className="dchw">manage</span></div>
      <div className="dchrule" />
      <div className="rows">
        {roleOf(profile) !== "member" && (
          <div className="row" aria-label="Staff" {...clickable(() => router.push("/crew"))}>
            <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></svg></div>
            <div className="rl"><b>Switch to Crew Mode</b><span>{roleOf(profile) === "server" ? "Order pass · kitchen display" : "Your crew console — shift, prep, plan & money"}</span></div>
            <div className="rr">›</div>
          </div>
        )}
        {roleOf(profile) !== "member" && (
          <div className="row" aria-label="GT3 Academy" {...clickable(() => router.push("/academy"))}>
            <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M12 3L2 8l10 5 10-5-10-5z" /><path d="M6 10v5c0 1 3 3 6 3s6-2 6-3v-5" /></svg></div>
            <div className="rl"><b>GT3 Academy</b><span>Training · certifications · cookbook</span></div>
            <div className="rr">›</div>
          </div>
        )}
        {roleOf(profile) === "owner" && (
          <div className="row" aria-label="System architecture" {...clickable(() => router.push("/architecture"))}>
            <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg></div>
            <div className="rl"><b>System architecture</b><span>How the platform is built · owner</span></div>
            <div className="rr">›</div>
          </div>
        )}
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
        <AccountPill />
      </div>

      <MembershipCard />
      <div className="memcard"><div className="min">
        <div className="ring">
          <svg width="88" height="88">
            <circle cx="44" cy="44" r="37" fill="none" stroke="rgba(245,241,232,.1)" strokeWidth="8" />
            <circle ref={ringRef} cx="44" cy="44" r="37" fill="none" stroke="#B82420" strokeWidth="8" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING} />
          </svg>
          <div className="rc">7<small>OF 10 STAMPS</small></div>
        </div>
        <div className="mt">
          <div className="eyb">★ Founding Member</div>
          <h2>Ryan T.</h2>
          <p>Your 10th pour is on us. A point on every drink.</p>
        </div>
      </div></div>

      <div className="memline">
        <span><b>142</b> pts</span>
        <span className="memline-dot">·</span>
        <span>day <b>8</b> streak</span>
        <span className="memline-dot">·</span>
        <span><b>$14.00</b> credit</span>
      </div>

      <ReferralCard code="RYAN-3MP" />

      <div className="dchapter"><span className="dchn">Your Account</span><span className="dchw">manage</span></div>
      <div className="dchrule" />
      <div className="rows">
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
  const router = useRouter();
  // Return-to-intent: if the member door was opened mid-task (e.g. "Sign in to reserve"), finish
  // the thought — send them back where they were the moment sign-in completes.
  useEffect(() => {
    if (!user) return;
    try {
      const next = sessionStorage.getItem("gt3-next");
      if (next) { sessionStorage.removeItem("gt3-next"); router.replace(next); }
    } catch { /* ignore */ }
  }, [user, router]);
  if (!enabled) return <MpireDemo />;
  if (!ready) return <section className="screen" id="s-mpire" />;
  if (!user) return <SignIn />;
  return <MpireReal />;
}
