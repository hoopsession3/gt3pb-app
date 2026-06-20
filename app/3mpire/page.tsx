"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";

const RING = 232; // 2πr for r=37, matches prototype stroke-dasharray
const FILL = 0.7; // 7 of 10

export default function MpireScreen() {
  const { toast } = useApp();
  const router = useRouter();
  const ringRef = useRef<SVGCircleElement>(null);
  const [copyLbl, setCopyLbl] = useState("Copy");

  useEffect(() => {
    const r = ringRef.current;
    if (!r) return;
    const t = setTimeout(() => {
      r.style.transition = "stroke-dashoffset 1.1s ease";
      r.style.strokeDashoffset = String(RING * (1 - FILL));
    }, 700);
    return () => clearTimeout(t);
  }, []);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText("RYAN-3MP");
    } catch {
      /* clipboard may be blocked; toast still fires */
    }
    setCopyLbl("Copied!");
    setTimeout(() => setCopyLbl("Copy"), 1400);
    toast("Referral code copied");
  };

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

      <div className="referral">
        <div className="eyb">Grow The 3MPIRE</div>
        <h3>Give a cuppa, get a cuppa.</h3>
        <div className="code"><b>RYAN-3MP</b><span className="cp" onClick={copyCode}>{copyLbl}</span></div>
      </div>

      <div className="sec">Your account</div>
      <div className="rows">
        <div className="row" onClick={() => toast("Bi-weekly · RISE + FLOW · next ships Mon")}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M3 7h18v13H3zM3 7l3-4h12l3 4M9 11h6" /></svg></div>
          <div className="rl"><b>My Subscription</b><span>Bi-weekly · RISE + FLOW · next ships Mon</span></div>
          <div className="rr">›</div>
        </div>
        <div className="row" onClick={() => toast("Showing your last 6 orders")}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M3 3h18v4H3zM5 7v14h14V7M9 11h6" /></svg></div>
          <div className="rl"><b>Order History</b><span>Last: 2× FLOW · Duncan Square</span></div>
          <div className="rr">›</div>
        </div>
        <div className="row" onClick={() => router.push("/events")}>
          <div className="ri"><svg viewBox="0 0 24 24" strokeWidth="2"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg></div>
          <div className="rl"><b>Saved Events</b><span>3 stops tracked this week</span></div>
          <div className="rr">›</div>
        </div>
        <div className="row" onClick={() => router.push("/book")}>
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
