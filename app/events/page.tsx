"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import AccountPill from "@/components/AccountPill";
import Reserves from "@/components/Reserves";
import { supabase } from "@/lib/supabase";
import type { EventRow } from "@/lib/db";

function evTime(ev: EventRow) {
  return ev.end_time ? `${ev.start_time ?? ""}–${ev.end_time}` : ev.start_time ?? "";
}

function ReserveCard() {
  // Teaser only — the actual reserve sale isn't built yet, so no fake "claim".
  return (
    <div className="drop">
      <span className="badge">★ Member access</span>
      <div className="din">
        <div className="eyb">Limited Reserve</div>
        <h2>FLOW RESERVE</h2>
        <div className="desc">A single-origin micro-lot of our cacao-nib cold brew. A capped run — members get first access when it drops.</div>
        <div className="left" style={{ marginTop: 14 }}>Members are notified first</div>
      </div>
    </div>
  );
}

function RsvpRow({ ev }: { ev: EventRow }) {
  const { toast } = useApp();
  const { user } = useAuth();
  const [going, setGoing] = useState(false);
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (going) { setGoing(false); return; } // local toggle off (no destructive delete)
    setGoing(true);
    toast("You're in — we'll remind you");
    if (supabase && !busy) {
      setBusy(true);
      await supabase.from("rsvps").insert({ event_id: ev.id, user_id: user?.id ?? null, contact_email: user?.email ?? null, status: "going" });
      setBusy(false);
    }
  };

  return (
    <div className={`ev${ev.member_only ? " mo" : ""}`}>
      <div className="when"><b>{ev.day_label ?? ""}</b><span>{evTime(ev)}</span></div>
      <div className="info">
        <b>{ev.title}{ev.member_only && <span className="motag">Members</span>}</b>
        <span>{ev.blurb ?? ev.location_text ?? ""}</span>
        {ev.going_count != null && <span className="go">● {ev.going_count} going</span>}
      </div>
      <button className={`rsvp${going ? " in" : ""}`} onClick={onClick}>{going ? "Going ✓" : "I'm in"}</button>
    </div>
  );
}

// ───────────────────────── live ─────────────────────────
function EventsLive() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase) return;
      const { data } = await supabase.from("events").select("*").order("sort");
      if (active && data) setEvents(data as EventRow[]);
      if (active) setLoaded(true);
    })();
    return () => { active = false; };
  }, []);

  return (
    <section className="screen" id="s-events">
      <div className="toprow">
        <div className="eyb">Grow The 3MPIRE</div>
        <AccountPill />
      </div>
      <div className="h-title">Events.</div>

      <Reserves />

      <div className="sec">RSVP · this week</div>
      {events.map((ev) => <RsvpRow key={ev.id} ev={ev} />)}
      {loaded && events.length === 0 && <div className="h-sub">No events scheduled right now — check back soon.</div>}
    </section>
  );
}

// ───────────────────────── demo ─────────────────────────
function RsvpButtonDemo() {
  const { toast } = useApp();
  const [going, setGoing] = useState(false);
  return (
    <button className={`rsvp${going ? " in" : ""}`} onClick={() => { setGoing((g) => { if (!g) toast("You're in — we'll remind you"); return !g; }); }}>
      {going ? "Going ✓" : "I'm in"}
    </button>
  );
}

function EventsDemo() {
  return (
    <section className="screen" id="s-events">
      <div className="toprow">
        <div className="eyb">Grow The 3MPIRE</div>
        <AccountPill />
      </div>
      <div className="h-title">Events.</div>
      <ReserveCard />
      <div className="sec">RSVP · this week</div>
      <div className="ev">
        <div className="when"><b>SAT</b><span>8–1</span></div>
        <div className="info"><b>Duncan Town Square</b><span>Saturday Market</span><span className="go">● 23 members going</span></div>
        <RsvpButtonDemo />
      </div>
      <div className="ev mo">
        <div className="when"><b>SAT</b><span>2:30</span></div>
        <div className="info"><b>Founding First Pour<span className="motag">Members</span></b><span>DUSK winter blend · tasting</span><span className="go">● 9 going · 6 left</span></div>
        <RsvpButtonDemo />
      </div>
      <div className="ev">
        <div className="when"><b>SUN</b><span>10–2</span></div>
        <div className="info"><b>Greenville Run Club</b><span>Hydrate + Rebuild</span><span className="go">● 11 members going</span></div>
        <RsvpButtonDemo />
      </div>
    </section>
  );
}

export default function EventsScreen() {
  const { enabled } = useAuth();
  return enabled ? <EventsLive /> : <EventsDemo />;
}
