"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { canOf } from "@/lib/roles";
import { useConfirm } from "./ConfirmSheet";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Sheet, { CloseButton } from "./Sheet";
import { NoteBox, TakingsBox, WayButtons, type Way } from "./RecordWays";
import { addTakings, archiveOwner, saveRecap, setEventLive, tookNothing, wrapOwner, type WriteResult } from "@/lib/wrap";
import {
  gapFix, gapWaysOut, money, owedLine, placeLine, prepHandoffKey, prepHandoffValue,
  sortGaps, stageLabel, whenLabel, type WayOut,
} from "@/lib/eventRecord";
import { evDate, evTime } from "@/lib/dates";
import { MARKET_LABEL, isMarket } from "@/lib/markets";

// ONE EVENT, WHOLE (0314).
//
// Nine tables describe an event and 24 components touch one or another of them. None of them showed
// you an event. The closest thing — PrepDetail, 581 lines inside app/crew/page.tsx — is a genuinely
// good operational checklist that you could only reach by writing a localStorage key and switching
// sections, from five call sites, in two different encodings.
//
// So this does NOT rebuild PrepDetail. Same call CustomerRecord made in 0311: the view was right,
// it was only unreachable. This is the CENTRE those nine tables sit around — what it is, when and
// where, what it is waiting on, what it took — and the prep checklist is one tap from here.
//
// ORDERED BY WHAT DISAGREES. The gap block sits directly under the header, above the counts,
// because a row that contradicts itself is more urgent than any number on it. Two events sat at
// "confirmed" for over a month after they happened, and nothing in this app was capable of saying so.
//
// AND EVERY FINDING CARRIES ITS WAY OUT (2026-10-03). The first version of this sheet rendered each
// gap as the diagnosis plus a sentence — "Wrap it if it happened, archive it if it didn't" — and no
// control. The wrap lived behind the prep checklist, the archive behind an edit form, and "add what
// it took" lived nowhere at all. Now the sentence is followed by the button, or by the box itself
// when the finding IS the form (the after-action note, what it took). The writes are lib/wrap's;
// which gap gets which control is lib/eventRecord's gapWaysOut, so the sheet cannot drift from it.

type Rec = {
  id: string; title: string | null; public_title: string | null; stage: string | null;
  category: string | null; archetype: string | null; type: string | null;
  day: string | null; day_label: string | null; start_time: string | null; end_time: string | null;
  duration_hrs: number | null; plan_days: number | null; phase: string | null; days_away: number | null;
  location_text: string | null; county: string | null; state: string | null; market: string | null; rig: string | null;
  blurb: string | null; capacity: number | null; expected_attendance: number | null;
  member_only: boolean | null; is_public: boolean | null; is_live: boolean | null;
  power_available: boolean | null; water_available: boolean | null;
  archived_at: string | null; vendor_id: string | null; vendor_name: string | null;
  crew_brief: string | null; dress_code: string | null; recap: string | null;
  tasks: number | null; tasks_done: number | null; tasks_open: number | null; tasks_critical_open: number | null;
  staff: number | null; approvals: number | null; rsvps: number | null;
  menu_items: number | null; schedule_items: number | null;
  sales_cents: number | null; sales_count: number | null; items_sold: number | null;
  has_economics: boolean | null;
  took_nothing_at?: string | null;   // arrives with 0339; optional so the sheet renders before it lands
};
type Gap = { gap: string; detail: string; severity: string };
type Data = { ev: Rec | null; gaps: Gap[] };

// The date and hours through lib/dates' one formatter (2026-10-05): the hours went out exactly as
// stored — "18:00–21:00" for anything entered since the editor took type="time", "6:00PM" before —
// on the sheet that the Events list and the calendar, both on fmt12, open into.
const dayLine = (e: Rec) =>
  [evDate(e), evTime(e) || null, Number(e.plan_days ?? 1) > 1 ? `${e.plan_days} days` : null].filter(Boolean).join(" · ");

export default function EventRecord({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { toast } = useApp();
  // WHO CAN DO WHAT HERE (2026-10-04). Today's op on My Day opens this sheet for every role now, and
  // until this it offered everyone every write: a server would get "It happened — wrap it up" and a
  // database refusal. Staff may write the note and what it took (0195, 0339); only an admin changes
  // the event itself or its live flag (0003, 0024); the checklist is for those who prep.
  const { profile } = useAuth();
  const can = canOf(profile);
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [wrapping, setWrapping] = useState(false);   // the stale_stage wrap box, opened by its button
  const [note, setNote] = useState<string | null>(null);   // null = not yet seeded from the record

  const loader = useCallback(async (): Promise<Data> => {
    if (!supabase) return { ev: null, gaps: [] };
    const [e, g] = await Promise.all([
      supabase.from("v_event_record").select("*").eq("id", eventId).maybeSingle(),
      supabase.from("v_event_gaps").select("gap, detail, severity").eq("event_id", eventId),
    ]);
    if (e.error) throw new Error(e.error.message);
    return { ev: (e.data as Rec) ?? null, gaps: (g.data as Gap[]) ?? [] };
  }, [eventId]);
  const state = useAsyncData<Data>(loader, [eventId]);
  const reload = state.reload;

  // The prep checklist still lives at ?s=prep behind the handoff key. Built from the one helper in
  // lib/eventRecord rather than spelled out again — a sixth hand-written encoding is how the first
  // five drifted apart. A full navigation (not setSection) so the section param lands in the URL.
  const openPrep = () => {
    try { localStorage.setItem(prepHandoffKey, prepHandoffValue("event", eventId)); } catch { /* ignore */ }
    window.location.assign("/crew?s=prep");
  };

  // Every write goes through here: one busy flag, the database's own sentence on failure, a reload
  // on success so the finding that was just answered leaves the list rather than lingering.
  const run = async (what: () => Promise<WriteResult>, done: string) => {
    if (!supabase || busy) return;
    setBusy(true);
    const { error } = await what();
    setBusy(false);
    if (error) { toast(error.message, "error"); return; }
    setWrapping(false); setNote(null);
    toast(done);
    reload();
  };
  const sb = supabase!;
  const kind = "event" as const;

  const archive = async () => {
    if (!(await confirm({ title: "Archive this event?", body: "It comes off the calendar, prep and readiness, and the record is kept — you can restore it from Plan › Lists › Events.", confirmLabel: "Archive" }))) return;
    run(() => archiveOwner(sb, { kind, id: eventId }), "Event archived");
  };

  // gap → controls. Which gaps get which is lib/eventRecord's call (gapWaysOut); this only knows how
  // to draw each one. `recap` and `takings` draw a box rather than a button: the finding is the form.
  const waysFor = (gap: string, e: Rec): { buttons: Way[]; box: "wrap" | "recap" | "takings" | null } => {
    const buttons: Way[] = [];
    let box: "wrap" | "recap" | "takings" | null = null;
    for (const w of gapWaysOut(gap) as readonly WayOut[]) {
      if ((w === "edit" || w === "prep") && !can.prep) continue;
      if ((w === "archive" || w === "wrap" || w === "live_off") && !can.admin) continue;
      switch (w) {
        case "edit":     buttons.push({ label: "Edit the details", go: true, onClick: openPrep }); break;
        case "prep":     buttons.push({ label: "Open the prep checklist", go: true, onClick: openPrep }); break;
        case "archive":  buttons.push({ label: gap === "twin" ? "Archive this one" : "It didn't happen — archive", onClick: archive, busy }); break;
        case "live_off": buttons.push({ label: "Turn the live flag off", busy, onClick: () => run(() => setEventLive(sb, eventId, false), "Live flag cleared") }); break;
        case "wrap":
          if (wrapping) box = "wrap";
          else buttons.push({ label: "It happened — wrap it up", busy, onClick: () => { setNote(e.recap ?? ""); setWrapping(true); } });
          break;
        case "recap":    box = "recap"; break;
        case "takings":  box = "takings"; break;
      }
    }
    return { buttons, box };
  };

  return (
    <Sheet open onClose={onClose} label="Event"
      header={<div className="cp-head">
        <b>Event</b>
        <CloseButton onClick={onClose} />
      </div>}>
      <AsyncSection state={state} isEmpty={({ ev }) => !ev}
        emptyTitle="No such event" emptySub="It may have been removed, or the link is stale."
        loadingLabel="Loading…" errorTitle="Couldn't load this event">
        {({ ev, gaps }) => {
          const e = ev!;
          const sorted = sortGaps(gaps);
          const place = placeLine(e);
          const owed = owedLine(e);
          return (
            <>
              {/* what it is ───────────────────────────────────────────────────────────────── */}
              <div className="so-id">
                <div className="cp-id-t">
                  <b>{e.title?.trim() || "Untitled event"}</b>
                  <span>{dayLine(e) || "no date"} · {whenLabel(e.phase, e.days_away)}</span>
                </div>
                <span className={`so-pill ${e.stage === "done" ? "so-nobody" : e.phase === "past" ? "so-us" : "so-carrier"}`}>
                  {stageLabel(e.stage)}
                </span>
              </div>
              {owed && <p className={`evr-owed${e.phase === "past" && e.stage !== "done" ? " due" : ""}`}>{owed}</p>}

              {/* TODAY, RUN IT FROM HERE (2026-10-04). Ryan tapped "Today's op · Greenville Fit Fest"
                  and nothing happened; behind the tap there now has to be the day itself. The live
                  switch lived only in a folded panel at the foot of Live Ops, and an event could be
                  wrapped only once the date had passed — never the night it ended. */}
              {Number(e.days_away) === 0 && e.stage !== "done" && can.admin && (
                <div className="cp-block evr-today">
                  <div className="cp-block-h"><span>Today</span><b>{e.is_live ? "Live" : "Not live"}</b></div>
                  {!e.is_live && <p className="cp-line dim">Card sales only count toward an event while it&apos;s live.</p>}
                  {wrapping && !sorted.some((g) => gapWaysOut(g.gap).includes("wrap")) ? (
                    <NoteBox value={note ?? e.recap ?? ""} onChange={setNote} busy={busy} autoFocus actions={[
                      { label: "Mark done", primary: true, onClick: () => run(() => wrapOwner(sb, { kind, id: eventId, recap: note ?? e.recap ?? "" }), "Event wrapped — nice work") },
                      { label: "Cancel", quiet: true, onClick: () => { setWrapping(false); setNote(null); } },
                    ]} />
                  ) : (
                    <WayButtons ways={[
                      e.is_live
                        ? { label: "Take it offline", busy, onClick: () => run(() => setEventLive(sb, eventId, false), "Taken offline") }
                        : { label: "Make it live", busy, onClick: () => run(() => setEventLive(sb, eventId, true), "Event is live — sales now track to it") },
                      { label: "It's over — wrap it up", busy, onClick: () => { setNote(e.recap ?? ""); setWrapping(true); } },
                    ]} />
                  )}
                </div>
              )}

              {/* what disagrees — above every number, on purpose ──────────────────────────── */}
              {sorted.length > 0 && (
                <div className="cp-block evr-gaps">
                  <div className="cp-block-h">
                    <span>Needs sorting</span>
                    <b>{sorted.length}</b>
                  </div>
                  {sorted.map((g) => {
                    const { buttons, box } = waysFor(g.gap, e);
                    const noteValue = note ?? e.recap ?? "";
                    return (
                      <div className={`evr-gap sev-${g.severity}`} key={g.gap}>
                        <b>{g.detail}</b>
                        <i>{gapFix(g.gap)}</i>
                        <WayButtons ways={buttons} />
                        {box === "wrap" && (
                          <NoteBox value={noteValue} onChange={setNote} busy={busy} autoFocus actions={[
                            { label: "Mark done", primary: true, onClick: () => run(() => wrapOwner(sb, { kind, id: eventId, recap: noteValue }), "Event wrapped — nice work") },
                            { label: "Cancel", quiet: true, onClick: () => { setWrapping(false); setNote(null); } },
                          ]} />
                        )}
                        {box === "recap" && (
                          <NoteBox value={noteValue} onChange={setNote} busy={busy} actions={[
                            { label: "Save the note", primary: true, onClick: () => run(() => saveRecap(sb, { kind, id: eventId, recap: noteValue }), "After-action saved") },
                          ]} />
                        )}
                        {box === "takings" && (
                          <TakingsBox busy={busy}
                            onAdd={(dollars, items) => run(() => addTakings(sb, { eventId, dollars, items }), "Takings added")}
                            onNothing={() => run(() => tookNothing(sb, eventId), "Noted — it took nothing")} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* where ────────────────────────────────────────────────────────────────────── */}
              <div className="cp-block">
                <div className="cp-block-h">
                  <span>Where</span>
                  {/* The city by its name ("Greenville"), not its key — lib/markets says it once. */}
                  <b>{isMarket(e.market) ? MARKET_LABEL[e.market] : e.market || e.rig || "—"}</b>
                </div>
                <p className="cp-line">{place || <span className="dim">No location on this event.</span>}</p>
                {e.vendor_name && <p className="cp-line">Host: <b>{e.vendor_name}</b></p>}
                <p className="cp-line dim">
                  {e.power_available === true ? "Power on site" : e.power_available === false ? "No power" : "Power unknown"}
                  {" · "}
                  {e.water_available === true ? "water on site" : e.water_available === false ? "no water" : "water unknown"}
                  {e.is_live ? " · flagged live" : ""}
                  {e.member_only ? " · members only" : ""}
                </p>
              </div>

              {/* what's on it ─────────────────────────────────────────────────────────────── */}
              <div className="cp-block">
                <div className="cp-block-h">
                  <span>On it</span>
                  <b>{Number(e.tasks_done ?? 0)}/{Number(e.tasks ?? 0)} done</b>
                </div>
                <div className="so-kpis" style={{ marginTop: 10, marginBottom: 0 }}>
                  <span className="so-kpi"><b>{Number(e.tasks_critical_open ?? 0)}</b><i>critical open</i></span>
                  <span className="so-kpi"><b>{Number(e.staff ?? 0)}</b><i>crew</i></span>
                  <span className="so-kpi"><b>{Number(e.rsvps ?? 0)}</b><i>rsvps</i></span>
                  <span className="so-kpi"><b>{Number(e.menu_items ?? 0)}</b><i>menu</i></span>
                  <span className="so-kpi"><b>{Number(e.schedule_items ?? 0)}</b><i>run of show</i></span>
                  {Number(e.expected_attendance ?? 0) > 0 &&
                    <span className="so-kpi"><b>{e.expected_attendance}</b><i>expected</i></span>}
                </div>
                {can.prep && (
                  <button type="button" className="cp-go" onClick={openPrep} style={{ marginTop: 10 }}>
                    Open the prep checklist <span aria-hidden="true">›</span>
                  </button>
                )}
              </div>

              {/* what it took ─────────────────────────────────────────────────────────────── */}
              <div className="cp-block">
                <div className="cp-block-h">
                  <span>Took</span>
                  <b>{Number(e.sales_count ?? 0) > 0 ? money(e.sales_cents) : "—"}</b>
                </div>
                {Number(e.sales_count ?? 0) > 0 ? (
                  <p className="cp-line">
                    <b>{e.sales_count}</b> sale{Number(e.sales_count) === 1 ? "" : "s"}
                    {Number(e.items_sold ?? 0) > 0 && <> · <b>{e.items_sold}</b> items</>}
                  </p>
                ) : e.took_nothing_at ? (
                  <p className="cp-line">
                    Took nothing at the window — noted {new Date(e.took_nothing_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.
                  </p>
                ) : (
                  <p className="cp-line dim">
                    Nothing recorded yet. Card sales land here from Square on their own; once the event is wrapped, cash gets added here too.
                  </p>
                )}
                <p className="cp-line dim">
                  {e.has_economics ? "Cost assumptions are set for this event." : "No cost assumptions set — the P&L can't be worked out."}
                </p>
              </div>

              {/* the brief and the write-up ───────────────────────────────────────────────── */}
              {(e.crew_brief || e.dress_code || e.recap || e.blurb) && (
                <div className="cp-block">
                  <div className="cp-block-h"><span>Notes</span><b>{e.dress_code || ""}</b></div>
                  {e.blurb && <p className="cp-line">{e.blurb}</p>}
                  {e.crew_brief && <p className="cp-line"><b>Crew:</b> {e.crew_brief}</p>}
                  {e.recap && <p className="cp-line" style={{ whiteSpace: "pre-line" }}><b>After:</b> {e.recap}</p>}
                </div>
              )}

              <p className="so-foot">
                {e.category}{e.archetype ? ` · ${e.archetype}` : ""}{e.type ? ` · ${e.type}` : ""}
                {e.archived_at ? " · archived" : ""}
              </p>
            </>
          );
        }}
      </AsyncSection>
    </Sheet>
  );
}
