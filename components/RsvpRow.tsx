"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import { InfoRow } from "@/components/kit";
import AddToCalendar from "@/components/AddToCalendar";
import Sheet from "@/components/Sheet";
import SignIn from "@/components/SignIn";
import { calFromEvent } from "@/lib/ics";
import { supabase } from "@/lib/supabase";
import { evTime, evDate, evLeadDay, evLeadDate } from "@/lib/dates";
import { openDirections, openAddress } from "@/lib/maps";
import type { EventRow } from "@/lib/db";
import Icon from "@/components/Icon";

// RSVP ROW — one event row on the kit InfoRow, with the full RSVP machine (optimistic toggle,
// 23505 flip-back, sign-in resume). Extracted from /events so the unified Find Us surface and
// any future surface render the SAME row. An event and a stop are the same InfoRow; only the
// trailing slot differs.

// evTime/evDate/evLeadDay/evLeadDate moved to lib/dates.ts (2026-07-29) so the smoke harness can
// pin their format conventions — both bugs Ryan hit ("Jul 31" vs "8/1"; "6:00PM" vs "6:00pm")
// lived in these four functions. Re-exported so existing importers keep working.
export { evTime, evDate, evLeadDay, evLeadDate };

export function RsvpRow({ ev }: { ev: EventRow }) {
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
            <button type="button" className={`k-chip${going ? " on" : " sec"}`} onClick={onRsvp} aria-pressed={going} aria-label={`${going ? "Going" : "I'm in"} — ${ev.title}`}>{going ? <>Going <Icon name="check" /></> : "I'm in"}</button>
            {hasDetail && <span className={`k-caret${open ? " open" : ""}`} aria-hidden="true">›</span>}
          </>
        }
      />
      {open && hasDetail && (
        <div className="k-detail">
          {ev.location_text && (
            <div className="k-det-row"><span className="k-det-k">Where</span>
              <a href={`https://maps.google.com/?q=${encodeURIComponent(ev.location_text)}`} target="_blank" rel="noreferrer"><Icon name="pin" /> {ev.location_text}</a>
            </div>
          )}
          {(ev.start_time || ev.end_time) && (
            <div className="k-det-row"><span className="k-det-k">When</span>
              <span>{(dateStr ?? ev.day_label) ? `${dateStr ?? ev.day_label} · ` : ""}{evTime(ev)}</span>
            </div>
          )}
          {ev.blurb && <p>{ev.blurb}</p>}
          {ev.member_only && <p className="k-cap">Members only — sign in to RSVP.</p>}
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {/* stop/event parity (2026-08-01): the same Get-directions chip the stop rows carry —
                turn-by-turn off the pin when geocoded, else a maps handoff on the address text */}
            {((ev.lat != null && ev.lng != null) || ev.location_text) && (
              <button type="button" className="k-chip k-chip-sec" onClick={() => { if (ev.lat != null && ev.lng != null) openDirections(ev.lat, ev.lng); else if (ev.location_text) openAddress(ev.location_text); }}>Get directions</button>
            )}
            <AddToCalendar ev={calFromEvent({ id: ev.id, title: ev.title, day: ev.day, start_time: ev.start_time, end_time: ev.end_time, location_text: ev.location_text, blurb: ev.blurb })} />
          </div>
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
