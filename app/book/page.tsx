"use client";

import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import AccountPill from "@/components/AccountPill";
import { Masthead, ClosingBeat } from "@/components/kit";
import { supabase } from "@/lib/supabase";

// "Book the bar" intake — captures B2B/event requests into Supabase (admins manage them
// in the back office). Booking Tool v5 stays the rate source of truth; the app never quotes.
export default function BookScreen() {
  const { toast } = useApp();
  const [f, setF] = useState({ name: "", email: "", phone: "", event_date: "", headcount: "", location_text: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // .trim() catches empty, but NOT whitespace-only (native `required` is satisfied by a lone
    // space too) — that combination used to hit this early return with zero feedback: no toast, no
    // visual change, the tap just visibly did nothing. Toast it like every other validation failure
    // in this codebase does.
    if (!f.name.trim() || !f.email.trim()) { toast("Add your name and email", "error"); return; }
    setBusy(true);
    if (supabase) {
      const { error } = await supabase.from("booking_requests").insert({
        name: f.name.trim(),
        email: f.email.trim(),
        phone: f.phone.trim() || null,
        event_date: f.event_date || null,
        headcount: f.headcount ? parseInt(f.headcount) : null,
        location_text: f.location_text.trim() || null,
        notes: f.notes.trim() || null,
      });
      setBusy(false);
      // Missing the "error" variant meant a failed insert rendered as a GREEN, checkmark-styled
      // toast — the same look as success — while the form sat there unsubmitted. Every other
      // error-toast call site in this codebase passes the variant; this was the one that didn't.
      if (error) { toast(`Couldn't send — try again in a moment`, "error"); return; }
    } else {
      setBusy(false);
    }
    setDone(true);
    toast("Request sent — Kayla will reach out");
  };

  if (done) {
    return (
      <section className="screen bookwrap" id="s-book">
        <Masthead eyebrow="Book the bar" right={<AccountPill />} />
        <div className="bookcard">
          <div className="eyb">Request received</div>
          <h2>We&apos;re on it.</h2>
          <p>Thanks, {f.name.split(" ")[0]}. Kayla will reach out within a day to lock your date and the bar. Pricing &amp; prep run through Booking Tool v5.</p>
        </div>
        <ClosingBeat />
      </section>
    );
  }

  return (
    <section className="screen bookwrap" id="s-book">
      <Masthead eyebrow="Book the bar" right={<AccountPill />} />
      <div className="bookcard">
        <div className="eyb">Bring GT3PB to your event</div>
        <h2>Book the bar.</h2>
        <p>Offsites, run clubs, launches, weddings. We bring the full bar and pour on site. Tell us the basics — Kayla takes it from there.</p>
      </div>

      <form className="auth-form" onSubmit={submit} style={{ marginTop: 18 }}>
        <label className="auth-label" htmlFor="b-name">Name</label>
        <input id="b-name" className="auth-input" value={f.name} onChange={set("name")} placeholder="Your name" maxLength={200} required />
        <label className="auth-label" htmlFor="b-email">Email</label>
        <input id="b-email" className="auth-input" type="email" inputMode="email" value={f.email} onChange={set("email")} placeholder="you@email.com" maxLength={200} required />
        <label className="auth-label" htmlFor="b-phone">Phone</label>
        <input id="b-phone" className="auth-input" type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} placeholder="For a quick call if email doesn't land" maxLength={40} />
        <div className="b-row">
          <div><label className="auth-label" htmlFor="b-date">Event date</label><input id="b-date" className="auth-input" type="date" value={f.event_date} onChange={set("event_date")} min={new Date().toISOString().slice(0, 10)} required /></div>
          <div><label className="auth-label" htmlFor="b-head">Headcount</label><input id="b-head" className="auth-input" type="number" inputMode="numeric" min={1} max={100000} value={f.headcount} onChange={set("headcount")} placeholder="50" /></div>
        </div>
        <label className="auth-label" htmlFor="b-loc">Location</label>
        <input id="b-loc" className="auth-input" value={f.location_text} onChange={set("location_text")} placeholder="Your address, venue, or city" maxLength={300} />
        <label className="auth-label" htmlFor="b-notes">Anything else</label>
        <textarea id="b-notes" className="auth-input" value={f.notes} onChange={set("notes")} placeholder="Vibe, timing, must-haves…" rows={3} maxLength={2000} />
        <button className="handle" type="submit" disabled={busy} style={{ marginTop: 18 }}><span>{busy ? "Sending…" : "Send request"}</span></button>
      </form>
      <p className="auth-fine">Pricing &amp; prep handled by Booking Tool v5 — the app never quotes.</p>
      <ClosingBeat />
    </section>
  );
}
