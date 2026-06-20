"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";

function RsvpButton() {
  const { toast } = useApp();
  const [going, setGoing] = useState(false);
  return (
    <button
      className={`rsvp${going ? " in" : ""}`}
      onClick={() => {
        setGoing((g) => {
          if (!g) toast("You're in — we'll remind you");
          return !g;
        });
      }}
    >
      {going ? "Going ✓" : "I'm in"}
    </button>
  );
}

export default function EventsScreen() {
  const { toast } = useApp();
  return (
    <section className="screen" id="s-events">
      <div className="toprow">
        <div className="eyb">Grow The 3MPIRE</div>
        <Link className="pf" href="/3mpire">R</Link>
      </div>
      <div className="h-title">Events.</div>

      <div className="drop">
        <span className="badge">★ Member access</span>
        <div className="din">
          <div className="eyb">Limited Reserve</div>
          <h2>FLOW RESERVE</h2>
          <div className="desc">A single-origin micro-lot of our cacao-nib cold brew. Capped run — members claim before it opens to the truck.</div>
          <div className="meta"><span className="cd">2d 14h 06m</span><span className="left">38 of 120 left</span></div>
          <button className="handle" style={{ marginTop: 0 }} onClick={() => toast("Reserve claimed — pick up at your next stop")}>
            <span>Claim your reserve</span>
          </button>
        </div>
      </div>

      <div className="sec">RSVP · this week</div>
      <div className="ev">
        <div className="when"><b>SAT</b><span>8–1</span></div>
        <div className="info"><b>Duncan Town Square</b><span>Saturday Market</span><span className="go">● 23 members going</span></div>
        <RsvpButton />
      </div>
      <div className="ev mo">
        <div className="when"><b>SAT</b><span>2:30</span></div>
        <div className="info"><b>Founding First Pour<span className="motag">Members</span></b><span>DUSK winter blend · tasting</span><span className="go">● 9 going · 6 left</span></div>
        <RsvpButton />
      </div>
      <div className="ev">
        <div className="when"><b>SUN</b><span>10–2</span></div>
        <div className="info"><b>Greenville Run Club</b><span>Hydrate + Rebuild</span><span className="go">● 11 members going</span></div>
        <RsvpButton />
      </div>

      <div className="bring">
        <div className="bt"><b>Bring someone.</b><span>Send a pour — they redeem at the truck, you both earn points.</span></div>
        <button onClick={() => toast("Pour sent — Grow The 3MPIRE")}>Send</button>
      </div>
    </section>
  );
}
