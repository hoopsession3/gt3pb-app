"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";

export default function TruckScreen() {
  const { toast } = useApp();
  const router = useRouter();
  const [cd, setCd] = useState("00:00:00");

  // Countdown to the next stop at 16:30 local, identical to the prototype tick().
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const tgt = new Date(now);
      tgt.setHours(16, 30, 0, 0);
      let d = Math.floor((tgt.getTime() - now.getTime()) / 1000);
      if (d < 0) d += 86400;
      const h = String(Math.floor(d / 3600)).padStart(2, "0");
      const m = String(Math.floor((d % 3600) / 60)).padStart(2, "0");
      const s = String(d % 60).padStart(2, "0");
      setCd(`${h}:${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="screen" id="s-truck">
      <div className="toprow">
        <div className="eyb">On the ground</div>
        <Link className="pf" href="/3mpire">R</Link>
      </div>
      <div className="hero"><div className="hin">
        <div className="livebadge"><span className="d" />Live now</div>
        <div className="hero-state" style={{ fontSize: 26 }}>Duncan Town Square</div>
        <div className="hero-sub">Saturday Market · full NET+ bar on board</div>
        <div className="cells">
          <div className="cell"><div className="cv gold">1.4 mi</div><div className="cl">Away</div></div>
          <div className="cell"><div className="cv">til 3:00p</div><div className="cl">Open</div></div>
          <div className="cell"><div className="cv ok">~7 min</div><div className="cl">Wait</div></div>
        </div>
        <div className="countpill"><span className="cl">Next stop in</span><span className="cd">{cd}</span></div>
        <button className="handle" style={{ marginTop: 14 }} onClick={() => router.push("/menu")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M5 12h14M12 5v14" /></svg>
          <span>Pre-order · skip the line</span>
        </button>
      </div></div>

      <div className="sec">This week</div>
      <div className="stop now" onClick={() => router.push("/menu")}>
        <div className="when"><b>NOW</b><span>til 3p</span></div>
        <div className="info"><b>Duncan Town Square</b><span>Saturday Market</span></div>
        <div className="tag live">Live</div>
      </div>
      <div className="stop" onClick={() => toast("Saved — we'll remind you")}>
        <div className="when"><b>SUN</b><span>10–2</span></div>
        <div className="info"><b>Greenville Run Club</b><span>Hydrate + Rebuild</span></div>
        <div className="tag soon">Sun</div>
      </div>
      <div className="stop" onClick={() => toast("Saved — we'll remind you")}>
        <div className="when"><b>WED</b><span>7–11</span></div>
        <div className="info"><b>Spartanburg Market</b><span>Full NET+ bar</span></div>
        <div className="tag soon">Wed</div>
      </div>
      <div className="stop" onClick={() => toast("Saved — we'll remind you")}>
        <div className="when"><b>SAT</b><span>2:30</span></div>
        <div className="info"><b>Founding First Pour</b><span>DUSK winter blend · members</span></div>
        <div className="tag soon">Next</div>
      </div>
    </section>
  );
}
