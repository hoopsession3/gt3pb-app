"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import AccountPill from "@/components/AccountPill";
import Reserves from "@/components/Reserves";
import Skeleton from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
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
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(ev.location_text || ev.blurb || ev.start_time);

  // Hydrate from the DB so a refresh/return reflects the real RSVP (no phantom re-taps).
  useEffect(() => {
    if (!supabase || !user) return;
    supabase.from("rsvps").select("status").eq("event_id", ev.id).eq("user_id", user.id).eq("status", "going").maybeSingle()
      .then(({ data }) => { if (data) setGoing(true); });
  }, [ev.id, user]);

  const onClick = async () => {
    if (busy) return;
    if (!supabase || !user) { toast("Sign in to RSVP"); return; }
    const next = !going;
    setGoing(next); // optimistic
    setBusy(true);
    if (next) {
      const { error } = await supabase.from("rsvps").insert({ event_id: ev.id, user_id: user.id, contact_email: user.email ?? null, status: "going" });
      let ok = !error;
      if (error?.code === "23505") { // a cancelled row already exists — flip it back to going
        const r = await supabase.from("rsvps").update({ status: "going" }).eq("event_id", ev.id).eq("user_id", user.id).select("user_id");
        ok = !r.error && !!r.data?.length; // 0 rows back = the write didn't land; don't claim success
      }
      if (!ok) { setGoing(false); toast("Couldn't RSVP — try again", "error"); setBusy(false); return; }
      toast("You're in — we'll remind you");
    } else {
      const { data, error } = await supabase.from("rsvps").update({ status: "cancelled" }).eq("event_id", ev.id).eq("user_id", user.id).select("user_id");
      if (error || !data?.length) { setGoing(true); toast("Couldn't update — try again", "error"); setBusy(false); return; }
      toast("RSVP removed");
    }
    setBusy(false);
  };

  return (
    <div className="ev-wrap">
      <div className={`ev${ev.member_only ? " mo" : ""}`}>
        <div className="when"><b>{ev.day_label ?? ""}</b><span>{evTime(ev)}</span></div>
        <div className="info" role={hasDetail ? "button" : undefined} tabIndex={hasDetail ? 0 : undefined} aria-expanded={hasDetail ? open : undefined}
          onClick={() => hasDetail && setOpen((o) => !o)} onKeyDown={(e) => { if (hasDetail && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen((o) => !o); } }}>
          <b>{ev.title}{ev.member_only && <span className="motag">Members</span>}</b>
          <span>{ev.blurb ?? ev.location_text ?? ""}</span>
          {ev.going_count != null && <span className="go">● {ev.going_count} going</span>}
        </div>
        {hasDetail && <span className={`ev-caret${open ? " open" : ""}`} aria-hidden="true">›</span>}
        <button className={`rsvp${going ? " in" : ""}`} onClick={onClick}>{going ? "Going ✓" : "I'm in"}</button>
      </div>
      {open && hasDetail && (
        <div className="ev-detail">
          {ev.location_text && <div className="ev-det-row"><span className="ev-det-k">Where</span><a className="ev-maplink" href={`https://maps.google.com/?q=${encodeURIComponent(ev.location_text)}`} target="_blank" rel="noreferrer">📍 {ev.location_text}</a></div>}
          {(ev.start_time || ev.end_time) && <div className="ev-det-row"><span className="ev-det-k">When</span><span>{ev.day_label ? `${ev.day_label} · ` : ""}{evTime(ev)}</span></div>}
          {ev.blurb && <p className="ev-det-blurb">{ev.blurb}</p>}
          {ev.member_only && <div className="ev-det-note">Members only — sign in to RSVP.</div>}
        </div>
      )}
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
      // hide archived events from guests (client-side so it's safe pre-migration 0032)
      if (active && data) setEvents((data as EventRow[]).filter((e) => !e.archived_at));
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

      <div className="dchapter"><span className="dchn">This Week</span><span className="dchw">save your spot</span></div>
      <div className="dchrule" />
      {!loaded && <Skeleton variant="row" count={3} />}
      {events.map((ev) => <RsvpRow key={ev.id} ev={ev} />)}
      {loaded && events.length === 0 && <EmptyState title="No events this week" sub="New pours and run-club meetups drop here — check back soon." />}
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
      <div className="dchapter"><span className="dchn">This Week</span><span className="dchw">save your spot</span></div>
      <div className="dchrule" />
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
