"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import AccountPill from "@/components/AccountPill";
import { supabase } from "@/lib/supabase";
import type { EventRow } from "@/lib/db";

function evTime(ev: EventRow) {
  return ev.end_time ? `${ev.start_time ?? ""}–${ev.end_time}` : ev.start_time ?? "";
}

function ReserveCard() {
  const { toast } = useApp();
  return (
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
  );
}

function BringSomeone() {
  const { toast } = useApp();
  return (
    <div className="bring">
      <div className="bt"><b>Bring someone.</b><span>Send a pour — they redeem at the truck, you both earn points.</span></div>
      <button onClick={() => toast("Pour sent — Grow The 3MPIRE")}>Send</button>
    </div>
  );
}

// Presentational: the parent owns "going" (single source of truth, persisted to Supabase),
// so there's no prop→state mirroring here. Local state is only the in-flight guard.
function RsvpRow({ ev, going, onToggle }: { ev: EventRow; going: boolean; onToggle: (ev: EventRow, next: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    await onToggle(ev, !going);
    setBusy(false);
  };

  return (
    <div className={`ev${ev.member_only ? " mo" : ""}`}>
      <div className="when"><b>{ev.day_label ?? ""}</b><span>{evTime(ev)}</span></div>
      <div className="info">
        <b>{ev.title}{ev.member_only && <span className="motag">Members</span>}</b>
        <span>{ev.blurb ?? ev.location_text ?? ""}</span>
        {ev.going_count != null && <span className="go">● {ev.going_count} going</span>}
      </div>
      <button className={`rsvp${going ? " in" : ""}`} onClick={onClick} disabled={busy}>{going ? "Going ✓" : "I'm in"}</button>
    </div>
  );
}

// ───────────────────────── live ─────────────────────────
function EventsLive() {
  const { toast } = useApp();
  const { user } = useAuth();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [going, setGoing] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  const setMember = useCallback((id: string, member: boolean) => {
    setGoing((prev) => {
      const s = new Set(prev);
      if (member) s.add(id); else s.delete(id);
      return s;
    });
  }, []);

  // Optimistically flip, persist, and roll back on error. One RSVP per (event, member).
  const toggle = useCallback(async (ev: EventRow, next: boolean) => {
    setMember(ev.id, next);
    if (next) toast("You're in — we'll remind you");
    if (!supabase) return;
    if (next) {
      const { error } = await supabase
        .from("rsvps")
        .upsert(
          { event_id: ev.id, user_id: user?.id ?? null, contact_email: user?.email ?? null, status: "going" },
          { onConflict: "event_id,user_id" }
        );
      if (error) { setMember(ev.id, false); toast("Couldn't RSVP — try again"); }
    } else if (user) {
      // Cancel: remove the member's own RSVP (anonymous rows can't be targeted safely).
      const { error } = await supabase.from("rsvps").delete().eq("event_id", ev.id).eq("user_id", user.id);
      if (error) { setMember(ev.id, true); toast("Couldn't update — try again"); }
    }
  }, [user, toast, setMember]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase) return;
      const { data } = await supabase.from("events").select("*").order("sort");
      if (active && data) setEvents(data as EventRow[]);
      // Which events has this member already RSVP'd to? (RLS lets them read only their own.)
      if (user) {
        const { data: mine } = await supabase.from("rsvps").select("event_id").eq("user_id", user.id);
        if (active && mine) setGoing(new Set(mine.map((r) => r.event_id as string)));
      } else if (active) {
        setGoing(new Set());
      }
      if (active) setLoaded(true);
    })();
    return () => { active = false; };
  }, [user]);

  return (
    <section className="screen" id="s-events">
      <div className="toprow">
        <div className="eyb">Grow The 3MPIRE</div>
        <AccountPill />
      </div>
      <div className="h-title">Events.</div>

      <ReserveCard />

      <div className="sec">RSVP · this week</div>
      {events.map((ev) => <RsvpRow key={ev.id} ev={ev} going={going.has(ev.id)} onToggle={toggle} />)}
      {loaded && events.length === 0 && <div className="h-sub">No events scheduled right now — check back soon.</div>}

      <BringSomeone />
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
      <BringSomeone />
    </section>
  );
}

export default function EventsScreen() {
  const { enabled } = useAuth();
  return enabled ? <EventsLive /> : <EventsDemo />;
}
