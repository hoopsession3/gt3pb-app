"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { useApp } from "@/components/AppProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "@/components/AsyncSection";
import { Masthead, SectionHeader, ClosingBeat } from "@/components/kit";
import SignIn from "@/components/SignIn";
import OfferLetterPrint, { type LetterRow } from "@/components/OfferLetterPrint";
import { money } from "@/lib/offerLetter";
import { MARKET_LABEL, toMarket } from "@/lib/markets";

// YOUR OFFER — the candidate's side of the hiring flow, which did not exist.
//
// ── WHAT WAS MISSING ───────────────────────────────────────────────────────────────────────────
// respond_to_offer(id, action, note) shipped in 0281 and is careful about the right things: the
// caller must be the candidate (by user id, or by the email on their token), the offer must be
// `sent` or `countered`, and an offer whose expires_on has passed is flipped to `expired` and the
// call raises rather than quietly accepting a stale offer.
//
// It had ZERO callers. Not one, anywhere in the repo. The offer pipeline was fully built through
// draft → in_review → approved → sent and then stopped: nothing in the application could move an
// offer to accepted, declined or countered. An owner could write and send an offer and then had to
// take the answer by text message and set the status by hand.
//
// ── WHY THIS IS NOT A CREW SCREEN ──────────────────────────────────────────────────────────────
// A candidate is not staff. They are usually role='member' — a customer — and may have signed up
// only to read this. Every crew surface refuses that person by design, correctly. So this is a
// customer-side route gated on nothing but being signed in, and the row-level rules do the rest:
// 0281's "offers candidate read own" policy already returns only offers addressed to this person,
// only once sent. There is no filtering to get wrong here, because the database will not hand over
// anybody else's offer in the first place.
//
// It reuses OfferLetterPrint for the document itself — the same rendering an owner previews, so
// what the candidate reads and what the company thinks it sent cannot drift.

type Row = LetterRow & { expires_on: string | null; sent_at: string | null; responded_at: string | null };

const dayStr = (iso?: string | null) =>
  iso ? new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString(undefined,
    { year: "numeric", month: "long", day: "numeric" }) : null;

const daysUntil = (iso?: string | null) => {
  if (!iso) return null;
  const ms = new Date(iso + "T23:59:59").getTime() - Date.now();
  return Math.ceil(ms / 86400000);
};

export default function OfferPage() {
  const { user, ready } = useAuth();
  const { toast } = useApp();
  const [letter, setLetter] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [countering, setCountering] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const loader = useCallback(async (): Promise<Row[]> => {
    if (!supabase || !user) return [];
    // No .eq() on the candidate: the RLS policy IS the filter, and adding a second one in the
    // client would be a rule in two places that can disagree.
    const { data, error } = await supabase.from("v_offer_letter").select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data as Row[]) ?? [];
  }, [user]);
  const state = useAsyncData<Row[]>(loader, [user?.id]);
  const reload = state.reload;

  const respond = async (id: string, action: "accept" | "decline" | "counter", why?: string) => {
    if (!supabase || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("respond_to_offer", {
      p_id: id, p_action: action, p_note: (why ?? "").trim() || null,
    });
    setBusy(false);
    if (error) { toast(error.message, "error"); return; }  // including "this offer has expired"
    toast(action === "accept" ? "Accepted. GT3 has been told."
        : action === "decline" ? "Declined. GT3 has been told."
        : "Sent back with your note.");
    setCountering(null); setNote("");
    reload();
  };

  if (!ready) return <section className="screen" />;
  if (!user) return <SignIn />;

  return (
    <section className="screen">
      <Masthead eyebrow="Your offer" right={<Link className="pf" href="/" aria-label="Back">‹</Link>} />
      <AsyncSection
        state={state}
        isEmpty={(rows) => rows.length === 0}
        emptyTitle="No offer waiting for you"
        emptySub="If GT3 has offered you a role, it appears here the moment it is sent — and you can read it, accept it, ask for changes or turn it down from this page."
        loadingLabel="Looking for your offer…"
        errorTitle="Couldn't load your offer"
      >
        {(rows) => (
          <>
            {rows.map((r) => {
              const live = r.status === "sent" || r.status === "countered";
              const left = daysUntil(r.expires_on);
              const expired = left !== null && left < 0;
              return (
                <div key={r.id} className="adm-sec" style={{ marginBottom: 18 }}>
                  <SectionHeader
                    label={r.title}
                    annotation={`${MARKET_LABEL[toMarket(r.market)] ?? r.market} · ${r.employment_type === "contractor" ? "Contractor" : "Employee"}`} />

                  {/* what it pays, before anything else — it is the question being asked */}
                  <p className="cp-line">
                    {r.base_cents
                      ? <><b>{money(r.base_cents)}</b>{r.rate_per === "hour" ? " an hour" : " a year"}</>
                      : <b>Commission only</b>}
                    {r.commission_pct ? <> · <b>{r.commission_pct}%</b> commission</> : null}
                    {r.starts_on ? <> · starting {dayStr(r.starts_on)}</> : null}
                  </p>

                  {live && left !== null && (
                    <p className={`cp-line${left <= 2 ? "" : " dim"}`}>
                      {expired
                        ? <>This offer expired on {dayStr(r.expires_on)}. Ask GT3 to send a new one.</>
                        : left === 0
                          ? <b>This offer expires today.</b>
                          : <>Expires in {left} day{left === 1 ? "" : "s"} — {dayStr(r.expires_on)}.</>}
                    </p>
                  )}

                  {!live && (
                    <p className="cp-line dim">
                      {r.status === "accepted" ? `You accepted this${r.responded_at ? ` on ${dayStr(r.responded_at)}` : ""}.`
                        : r.status === "declined" ? `You turned this down${r.responded_at ? ` on ${dayStr(r.responded_at)}` : ""}.`
                        : r.status === "expired" ? "This offer expired."
                        : `Status: ${r.status}.`}
                    </p>
                  )}

                  <button type="button" className="cp-go" onClick={() => setLetter(r)}>
                    Read the full letter <span aria-hidden="true">›</span>
                  </button>

                  {live && !expired && (
                    countering === r.id ? (
                      <div className="prod-recipe" style={{ marginTop: 12 }}>
                        <label className="prod-f">
                          <span>What would you like changed?</span>
                          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                                    placeholder="The start date, the rate, the hours — say what you need." />
                        </label>
                        <div className="prod-actions" style={{ marginTop: 10 }}>
                          <button type="button" className="btn-pri" disabled={busy || !note.trim()}
                                  onClick={() => respond(r.id, "counter", note)}>
                            {busy ? "Sending…" : "Send it back"}
                          </button>
                          <button type="button" className="btn-sec" disabled={busy}
                                  onClick={() => { setCountering(null); setNote(""); }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="prod-actions" style={{ marginTop: 12 }}>
                        <button type="button" className="btn-pri" disabled={busy}
                                onClick={() => respond(r.id, "accept")}>
                          {busy ? "Working…" : "Accept this offer"}
                        </button>
                        <button type="button" className="btn-sec" disabled={busy}
                                onClick={() => setCountering(r.id)}>Ask for changes</button>
                        <button type="button" className="btn-sec" disabled={busy}
                                onClick={() => respond(r.id, "decline")}>Turn it down</button>
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </>
        )}
      </AsyncSection>
      {letter && <OfferLetterPrint row={letter} onClose={() => setLetter(null)} />}
      <ClosingBeat />
    </section>
  );
}
