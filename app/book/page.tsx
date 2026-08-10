"use client";

import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import AccountPill from "@/components/AccountPill";
import EditCopyPill from "@/components/EditCopyPill";
import EditableCopy from "@/components/EditableCopy";
import { Masthead, ClosingBeat } from "@/components/kit";
import { supabase } from "@/lib/supabase";
import { useSiteCopy, fillCopy } from "@/lib/copy";

// "Book the bar" intake — captures B2B/event requests into Supabase (admins manage them
// in the back office). Booking Tool v5 stays the rate source of truth; the app never quotes.
export default function BookScreen() {
  const { toast } = useApp();
  const t = useSiteCopy();
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
    // No success toast (2026-07-30 audit) — the full-screen "Request received" card below IS the
    // confirmation; a toast over it said the same thing twice at the same moment. Error toasts stay.
  };

  if (done) {
    return (
      <section className="screen bookwrap" id="s-book">
        <Masthead eyebrow={<EditableCopy k="book.eyebrow" value={t("book.eyebrow")} />} right={<div className="mast-right"><EditCopyPill group="Book" /><AccountPill /></div>} />
        <div className="bookcard">
          <EditableCopy k="book.done_eye" value={t("book.done_eye")} as="div" className="eyb" />
          <EditableCopy k="book.done_title" value={t("book.done_title")} as="h2" />
          {/* 2026-07-30 (Ryan): no internal tool names ("Booking Tool v5") and no crew first names
              in guest-facing copy — "it's not professional." The card speaks as the business.
              {name} is filled live via fillCopy; the raw template is what's edited/saved. */}
          <EditableCopy k="book.done_thanks" value={t("book.done_thanks")} displayValue={fillCopy(t("book.done_thanks"), { name: f.name.split(" ")[0] })} as="p" multiline />
        </div>
        <ClosingBeat />
      </section>
    );
  }

  return (
    <section className="screen bookwrap" id="s-book">
      <Masthead eyebrow={<EditableCopy k="book.eyebrow" value={t("book.eyebrow")} />} right={<div className="mast-right"><EditCopyPill group="Book" /><AccountPill /></div>} />
      <div className="bookcard">
        <EditableCopy k="book.eye" value={t("book.eye")} as="div" className="eyb" />
        <EditableCopy k="book.title" value={t("book.title")} as="h2" />
        <EditableCopy k="book.lede" value={t("book.lede")} as="p" multiline />
      </div>

      {/* Form field labels use htmlFor (a11y association), which EditableCopy's wrapper wouldn't carry,
          so labels + placeholders render as plain t() — editable via Settings → the Book group. */}
      <form className="auth-form" onSubmit={submit} style={{ marginTop: 18 }}>
        <label className="auth-label" htmlFor="b-name">{t("book.f_name")}</label>
        <input id="b-name" className="auth-input" value={f.name} onChange={set("name")} placeholder={t("book.ph_name")} maxLength={200} required />
        <label className="auth-label" htmlFor="b-email">{t("book.f_email")}</label>
        <input id="b-email" className="auth-input" type="email" inputMode="email" value={f.email} onChange={set("email")} placeholder={t("book.ph_email")} maxLength={200} required />
        <label className="auth-label" htmlFor="b-phone">{t("book.f_phone")}</label>
        <input id="b-phone" className="auth-input" type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} placeholder={t("book.ph_phone")} maxLength={40} />
        <EditableCopy k="book.consent" value={t("book.consent")} as="p" className="tel-consent" multiline />
        <div className="b-row">
          <div><label className="auth-label" htmlFor="b-date">{t("book.f_date")}</label><input id="b-date" className="auth-input" type="date" value={f.event_date} onChange={set("event_date")} min={new Date().toISOString().slice(0, 10)} required /></div>
          <div><label className="auth-label" htmlFor="b-head">{t("book.f_headcount")}</label><input id="b-head" className="auth-input" type="number" inputMode="numeric" min={1} max={100000} value={f.headcount} onChange={set("headcount")} placeholder={t("book.ph_headcount")} /></div>
        </div>
        <label className="auth-label" htmlFor="b-loc">{t("book.f_location")}</label>
        <input id="b-loc" className="auth-input" value={f.location_text} onChange={set("location_text")} placeholder={t("book.ph_location")} maxLength={300} />
        <label className="auth-label" htmlFor="b-notes">{t("book.f_notes")}</label>
        <textarea id="b-notes" className="auth-input" value={f.notes} onChange={set("notes")} placeholder={t("book.ph_notes")} rows={3} maxLength={2000} />
        <button className="handle" type="submit" disabled={busy} style={{ marginTop: 18 }}><span>{busy ? "Sending…" : t("book.submit")}</span></button>
      </form>
      {/* Pricing footnote removed entirely at Ryan's call (2026-07-30) — the form ends at the
          button; the success card carries the "we reply within a day" expectation. */}
      <ClosingBeat />
    </section>
  );
}
