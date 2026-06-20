"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { clickable } from "@/lib/a11y";

export default function TodayScreen() {
  const { toast } = useApp();
  const [range, setRange] = useState<"7" | "30">("7");

  return (
    <section className="screen" id="s-today">
      <div className="toprow">
        <div className="eyb">Sat · Jun 20</div>
        <Link className="pf" href="/3mpire">R</Link>
      </div>
      <div className="h-title">Morning, Ryan.</div>
      <div className="h-sub">I read your night and built your day. One call below — tap once and I&apos;ll run it.</div>

      <div className="hero"><div className="hin">
        <div className="hero-top">
          <div className="hero-eye">Today&apos;s read</div>
          <div className="seg" role="group" aria-label="Trend range">
            <span className={range === "7" ? "on" : ""} aria-pressed={range === "7"} {...clickable(() => setRange("7"))}>7 days</span>
            <span className={range === "30" ? "on" : ""} aria-pressed={range === "30"} {...clickable(() => setRange("30"))}>30 days</span>
          </div>
        </div>
        <div className="hero-state">Ease today.</div>
        <div className="hero-sub">You&apos;re under-recovered — three nights trending down. We go gentle and earn it back.</div>
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
      <div className="step s-sun"><div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="4.2" /><path d="M12 1.8v2.4M12 19.8v2.4M3.5 12h-1.7M22.2 12h-1.7M5.6 5.6 4.4 4.4M19.6 19.6l-1.2-1.2M18.4 5.6l1.2-1.2M4.4 19.6l1.2-1.2" /></svg></div><div className="sx"><b>Get sun — 10 min</b><span>Beats a hard coffee right now. Step out before your first meeting.</span></div><div className="tm now">now</div></div>
      <div className="step s-cup"><div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8.5h13v5.5a4.5 4.5 0 0 1-4.5 4.5h-4A4.5 4.5 0 0 1 4 14z" /><path d="M17 9.5h2.2a2.3 2.3 0 0 1 0 4.6H17" /><path d="M8 2.2c-.5.9-.5 1.6 0 2.5M11.5 2.2c-.5.9-.5 1.6 0 2.5" /></svg></div><div className="sx"><b>DUSK, not FLOW</b><span>Warm + gentler — your system&apos;s asking for ease.</span></div><div className="tm">9:00</div></div>
      <div className="step s-broth"><div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11.5h18a8.2 8.2 0 0 1-8.2 8.2h-1.6A8.2 8.2 0 0 1 3 11.5z" /><path d="M7.5 11c-.4-1.6.5-2.6 1-3.6M12 11c-.4-1.6.5-2.6 1-3.6M16.5 11c-.4-1.6.5-2.6 1-3.6" /></svg></div><div className="sx"><b>FORGE broth</b><span>You trained — rebuild tonight, then an early night.</span></div><div className="tm">tonight</div></div>

      <div className="honest"><b>Straight talk:</b> skip the double-shot reflex today. On 5 hours, more caffeine just borrows from tonight. Sun + a gentle cup is the smarter trade.</div>
      <button className="handle" onClick={() => toast("Done. Sun reminder set, DUSK queued at 8:30, broth moved to tonight.")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M5 12l5 5L20 7" /></svg>
        <span>Handle it for me<span className="sm">orders + reminders, done</span></span>
      </button>

      <div className="sec">While you were busy</div>
      <div className="did">
        <div className="dc"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M3 7h18v13H3zM3 7l3-4h12l3 4M9 11a3 3 0 0 0 6 0" /></svg></div>
        <div className="dt"><b>Reordered FLOW</b><span>You were down to your last two — ships Monday</span></div>
        <div className="okc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12l5 5L20 7" /></svg></div>
      </div>
      <div className="did">
        <div className="dc"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg></div>
        <div className="dt"><b>Queued your usual at Duncan Square</b><span>Truck&apos;s at your office park 8:30 — no line</span></div>
        <div className="okc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12l5 5L20 7" /></svg></div>
      </div>
      <div className="signoff">Your standard. On tap. Handled.</div>
    </section>
  );
}
