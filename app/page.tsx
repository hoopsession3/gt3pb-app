"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth, type Profile } from "@/components/AuthProvider";
import { useApp } from "@/components/AppProvider";
import GenerateDay from "@/components/GenerateDay";
import ReservePitch from "@/components/ReservePitch";
import StampCard from "@/components/StampCard";
import { useSiteCopy } from "@/lib/copy";
import { supabase } from "@/lib/supabase";
import { DRINKS, type DrinkId } from "@/lib/menu";
import type { Order } from "@/lib/db";
import { clickable } from "@/lib/a11y";

const SUN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="4.2" /><path d="M12 1.8v2.4M12 19.8v2.4M3.5 12h-1.7M22.2 12h-1.7M5.6 5.6 4.4 4.4M19.6 19.6l-1.2-1.2M18.4 5.6l1.2-1.2M4.4 19.6l1.2-1.2" /></svg>
);
const CUP = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8.5h13v5.5a4.5 4.5 0 0 1-4.5 4.5h-4A4.5 4.5 0 0 1 4 14z" /><path d="M17 9.5h2.2a2.3 2.3 0 0 1 0 4.6H17" /><path d="M8 2.2c-.5.9-.5 1.6 0 2.5M11.5 2.2c-.5.9-.5 1.6 0 2.5" /></svg>
);
const BROTH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11.5h18a8.2 8.2 0 0 1-8.2 8.2h-1.6A8.2 8.2 0 0 1 3 11.5z" /><path d="M7.5 11c-.4-1.6.5-2.6 1-3.6M12 11c-.4-1.6.5-2.6 1-3.6M16.5 11c-.4-1.6.5-2.6 1-3.6" /></svg>
);

function firstName(profile: Profile | null, email?: string | null) {
  const n = profile?.display_name || (email ? email.split("@")[0] : "");
  const f = (n || "there").split(" ")[0];
  return f.charAt(0).toUpperCase() + f.slice(1);
}

function todayLabel() {
  const d = new Date();
  const wk = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${wk} · ${mo} ${d.getDate()}`;
}
function greet() {
  const h = new Date().getHours();
  return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
}

// ───────────────────────── your usual — one-tap reorder of the last order ─────────────────────────
function YourUsual() {
  const { reorder } = useApp();
  const { user } = useAuth();
  const [last, setLast] = useState<Order | null>(null);
  useEffect(() => {
    if (!supabase || !user) return;
    supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => { if (data && data[0]) setLast(data[0] as Order); });
  }, [user]);
  if (!last) return null;
  const names = last.items.map((i) => DRINKS[i as DrinkId]?.n ?? i).join(" · ");
  return (
    <button className="usual" onClick={() => reorder(last.items as DrinkId[])}>
      <span className="usual-l"><span className="usual-k">Your usual</span><span className="usual-v">{names}</span></span>
      <span className="usual-cta">Order again</span>
    </button>
  );
}

// ───────────────────────── signed-in Today — generator-driven ─────────────────────────
function TodayReal({ t }: { t: (k: string) => string }) {
  const { user, profile } = useAuth();
  const name = firstName(profile, user?.email);

  return (
    <section className="screen" id="s-today">
      <div className="toprow">
        <div className="eyb">{todayLabel()}</div>
        <Link className="pf" href="/3mpire">{name.charAt(0)}</Link>
      </div>
      <div className="h-title">{greet()}, {name}.</div>
      <YourUsual />
      <StampCard />
      <ReservePitch />
      <div className="h-sub">{t("home.questions")}</div>
      <GenerateDay />
    </section>
  );
}

// ───────────────────────── demo Today (Supabase not configured) ─────────────────────────
function TodayDemo({ t }: { t: (k: string) => string }) {
  const { toast } = useApp();
  const [range, setRange] = useState<"7" | "30">("7");
  return (
    <section className="screen" id="s-today">
      <div className="toprow">
        <div className="eyb">Sat · Jun 20</div>
        <Link className="pf" href="/3mpire">R</Link>
      </div>
      <div className="h-title">Morning, Ryan.</div>
      <div className="h-sub">{t("home.questions")}</div>

      <div className="hero"><div className="hin">
        <div className="hero-top">
          <div className="hero-eye">Today&apos;s read</div>
          <div className="seg" role="group" aria-label="Trend range">
            <span className={range === "7" ? "on" : ""} aria-pressed={range === "7"} {...clickable(() => setRange("7"))}>7 days</span>
            <span className={range === "30" ? "on" : ""} aria-pressed={range === "30"} {...clickable(() => setRange("30"))}>30 days</span>
          </div>
        </div>
        <div className="hero-state">Ease today.</div>
        <div className="hero-sub">A few short nights in a row — we keep today gentle and build the routine back up.</div>
        <div className="spark">
          <svg viewBox="0 0 332 96" preserveAspectRatio="none">
            <defs>
              <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#B8902F" stopOpacity="0.32" />
                <stop offset="1" stopColor="#B8902F" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#cda84b" />
                <stop offset="1" stopColor="#e6ddc9" />
              </linearGradient>
            </defs>
            <path d="M8 26 C 40 30, 50 22, 74 30 S 130 50, 160 50 S 215 58, 244 52 S 300 66, 324 72 L 324 96 L 8 96 Z" fill="url(#area)" />
            <path d="M8 26 C 40 30, 50 22, 74 30 S 130 50, 160 50 S 215 58, 244 52 S 300 66, 324 72" fill="none" stroke="url(#line)" strokeWidth="3" strokeLinecap="round" />
            <circle cx="324" cy="72" r="9" fill="#B82420" opacity="0.25" />
            <circle cx="324" cy="72" r="5" fill="#B82420" stroke="#F5F1E8" strokeWidth="2" />
          </svg>
          <div className="axis">
            <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span className="tdy">Today</span>
          </div>
        </div>
        <div className="cells">
          <div className="cell"><div className="cv warn">5h 12m</div><div className="cl">Sleep</div></div>
          <div className="cell"><div className="cv warn">↓ 18%</div><div className="cl">HRV</div></div>
          <div className="cell"><div className="cv warn">0 min</div><div className="cl">Daylight</div></div>
        </div>
      </div></div>

      <div className="sec">Your day · dialed</div>
      <div className="step s-sun"><div className="ic">{SUN}</div><div className="sx"><b>Get sun — 10 min</b><span>Beats a hard coffee right now. Step out before your first meeting.</span></div><div className="tm now">now</div></div>
      <div className="step s-cup"><div className="ic">{CUP}</div><div className="sx"><b>DUSK, not FLOW</b><span>Warm + gentler — your system&apos;s asking for ease.</span></div><div className="tm">9:00</div></div>
      <div className="step s-broth"><div className="ic">{BROTH}</div><div className="sx"><b>FORGE broth</b><span>You trained — rebuild tonight, then an early night.</span></div><div className="tm">tonight</div></div>

      <div className="honest"><b>Straight talk:</b> skip the double-shot reflex today. On a short night, a gentle cup and a few minutes of sun beat a second coffee.</div>
      <button className="handle" onClick={() => toast("Done. Sun reminder set, DUSK queued at 8:30, broth moved to tonight.")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M5 12l5 5L20 7" /></svg>
        <span>Handle it for me<span className="sm">orders + reminders, done</span></span>
      </button>
      <div className="signoff">Your standard. On tap. Handled.</div>
    </section>
  );
}

// ───────────────────────── arrival (first-time / signed-out front door) ─────────────────────────
// Today is the MEMBER home. Guests land on the Truck — where the bar is, the route, the menu —
// and hit the membership door only where membership matters (order-ahead, 3MPIRE, account pill).
export default function TodayScreen() {
  const { ready, enabled, user } = useAuth();
  const t = useSiteCopy();
  const router = useRouter();
  useEffect(() => { if (enabled && ready && !user) router.replace("/truck"); }, [enabled, ready, user, router]);
  if (!enabled) return <TodayDemo t={t} />;
  if (!ready || !user) return <section className="screen" id="s-today" />;
  return <TodayReal t={t} />;
}
