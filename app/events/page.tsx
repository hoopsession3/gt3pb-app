"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import AccountPill from "@/components/AccountPill";
import { Masthead, SectionHeader, InfoRow, ClosingBeat } from "@/components/kit";
import Reserves from "@/components/Reserves";
import Skeleton from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import AddToCalendar from "@/components/AddToCalendar";
import Sheet from "@/components/Sheet";
import SignIn from "@/components/SignIn";
import { calFromEvent } from "@/lib/ics";
import { supabase } from "@/lib/supabase";
import { localToday } from "@/lib/dates";
import type { EventRow } from "@/lib/db";

// EVENTS — on the kit (Design System v1): same masthead, same rows, same section
// grammar as the Truck. An event and a stop are the same InfoRow; only the trailing
// slot differs (RSVP chip here, caret there). Guests see ONLY public happenings —
// customer events, never internal admin/ops rows or private bookings (belt here,
// 0233's is_public policy at the door).

function evTime(ev: EventRow) {
  return ev.end_time ? `${ev.start_time ?? ""}–${ev.end_time}` : ev.start_time ?? "";
}

// "Sat, Jul 12" from events.day — parsed as local calendar parts, NOT new Date(iso),
// which reads as UTC midnight and shows yesterday for evening viewers.
function evDate(ev: EventRow) {
  if (!ev.day) return null;
  const [y, m, d] = ev.day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
// Lead column parts: day abbrev over "Jul 12" — hand-set label wins, else derived from the date.
function evLeadDay(ev: EventRow) {
  if (ev.day_label?.trim()) return ev.day_label;
  if (!ev.day) return "";
  const [y, m, d] = ev.day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}
function evLeadDate(ev: EventRow) {
  if (!ev.day) return "";
  const [y, m, d] = ev.day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function RsvpRow({ ev }: { ev: EventRow }) {
  const { toast } = useApp();
  const { user } = useAuth();
  const [going, setGoing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(ev.location_text || ev.blurb || ev.start_time);
  // Signed-out tap opens sign-in right here instead of a dead-end toast; once signed in, the RSVP
  // that was tapped fires automatically — no second tap, no redirect away and back.
  const [signInOpen, setSignInOpen] = useState(false);
  const pendingRsvp = useRef(false);

  // Hydrate from the DB so a refresh/return reflects the real RSVP (no phantom re-taps).
  useEffect(() => {
    if (!supabase || !user) return;
    supabase.from("rsvps").select("status").eq("event_id", ev.id).eq("user_id", user.id).eq("status", "going").maybeSingle()
      .then(({ data }) => { if (data) setGoing(true); });
  }, [ev.id, user]);

  const toggle = async () => {
    if (!supabase || !user) return;
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

  // Sign-in completed while the sheet was open for THIS row's tap — resume the RSVP automatically.
  useEffect(() => {
    if (user && pendingRsvp.current) { pendingRsvp.current = false; setSignInOpen(false); toggle(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const onRsvp = () => {
    if (busy) return;
    if (!supabase || !user) { pendingRsvp.current = true; setSignInOpen(true); return; }
    toggle();
  };

  const dateStr = evDate(ev);
  const meta = [evTime(ev), ev.going_count != null && ev.going_count > 0 ? `● ${ev.going_count} going` : ""].filter(Boolean).join(" · ");

  return (
    <div>
      <InfoRow
        lead={evLeadDay(ev)}
        leadSub={evLeadDate(ev)}
        name={ev.title}
        nameExtra={ev.member_only ? <span className="motag">Members</span> : undefined}
        sub={ev.blurb ?? ev.location_text ?? undefined}
        meta={meta || undefined}
        bodyClick={hasDetail ? () => setOpen((o) => !o) : undefined}
        ariaLabel={hasDetail ? `${ev.title} — details` : undefined}
        expanded={hasDetail ? open : undefined}
        trailing={
          <>
            <button type="button" className={`k-chip${going ? " on" : " sec"}`} onClick={onRsvp}>{going ? "Going ✓" : "I'm in"}</button>
            {hasDetail && <span className={`k-caret${open ? " open" : ""}`} aria-hidden="true">›</span>}
          </>
        }
      />
      {open && hasDetail && (
        <div className="k-detail">
          {ev.location_text && (
            <div className="k-det-row"><span className="k-det-k">Where</span>
              <a href={`https://maps.google.com/?q=${encodeURIComponent(ev.location_text)}`} target="_blank" rel="noreferrer">📍 {ev.location_text}</a>
            </div>
          )}
          {(ev.start_time || ev.end_time) && (
            <div className="k-det-row"><span className="k-det-k">When</span>
              <span>{(dateStr ?? ev.day_label) ? `${dateStr ?? ev.day_label} · ` : ""}{evTime(ev)}</span>
            </div>
          )}
          {ev.blurb && <p>{ev.blurb}</p>}
          {ev.member_only && <p className="k-cap">Members only — sign in to RSVP.</p>}
          <div style={{ marginTop: 10 }}><AddToCalendar ev={calFromEvent({ id: ev.id, title: ev.title, day: ev.day, start_time: ev.start_time, end_time: ev.end_time, location_text: ev.location_text, blurb: ev.blurb })} /></div>
        </div>
      )}
      <Sheet open={signInOpen} onClose={() => { pendingRsvp.current = false; setSignInOpen(false); }} labelledBy={`rsvp-signin-${ev.id}`}>
        <div className="oa-kicker" id={`rsvp-signin-${ev.id}`}>SIGN IN TO RSVP</div>
        <h2 className="dl-h">{ev.title}</h2>
        <SignIn />
      </Sheet>
    </div>
  );
}

export default function EventsScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase) { if (active) setLoaded(true); return; }
      // PUBLIC events only: customer occasions (category 'event'), never internal admin/ops
      // rows, never private bookings. Filters use columns that exist TODAY so this deploy is
      // safe before 0233 applies; 0233's is_public policy then enforces the same rule at the
      // door no matter what any client asks for.
      const { data } = await supabase.from("events").select("*")
        .eq("category", "event")
        .or("archetype.is.null,archetype.neq.private_booking")
        .order("day", { ascending: true, nullsFirst: false }).order("sort");
      if (active && data) setEvents((data as EventRow[]).filter((e) => !e.archived_at));
      if (active) setLoaded(true);
    })();
    return () => { active = false; };
  }, []);

  const today = localToday();
  const upcoming = events.filter((e) => !e.day || e.day >= today);
  const past = events.filter((e) => e.day && e.day < today);

  return (
    <section className="screen" id="s-events">
      <Masthead eyebrow="What's on" right={<AccountPill />} />
      <h1 className="k-title">Events</h1>

      <Reserves />

      <SectionHeader label="This Week" annotation="save your spot" />
      {!loaded && <Skeleton variant="row" count={3} />}
      <div className="k-rows">
        {upcoming.map((ev) => <RsvpRow key={ev.id} ev={ev} />)}
      </div>
      {loaded && upcoming.length === 0 && <EmptyState title="No events this week" sub="New pours and run-club meetups drop here — check back soon." />}

      {past.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="btn-ter" onClick={() => setShowPast((s) => !s)} aria-expanded={showPast}>
            Past · {past.length} <span className={`k-caret${showPast ? " open" : ""}`}>›</span>
          </button>
          {showPast && <div className="k-rows">{past.map((ev) => <RsvpRow key={ev.id} ev={ev} />)}</div>}
        </div>
      )}

      {/* Always-relevant close — true whether the week is packed or slow. */}
      <SectionHeader label="Bring Us To You" annotation="private events" />
      <p style={{ fontSize: 14, color: "var(--cream-m)", margin: "14px 2px 12px" }}>Pours, run clubs, launches — we set up anywhere.</p>
      <button type="button" className="btn-ter" onClick={() => router.push("/book")}>
        Book the bar for your event <b>→</b>
      </button>

      <ClosingBeat />
    </section>
  );
}
