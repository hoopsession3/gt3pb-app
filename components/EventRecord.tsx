"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Sheet from "./Sheet";
import Icon from "./Icon";
import {
  gapFix, money, owedLine, placeLine, prepHandoffKey, prepHandoffValue,
  sortGaps, stageLabel, whenLabel,
} from "@/lib/eventRecord";

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
};
type Gap = { gap: string; detail: string; severity: string };
type Data = { ev: Rec | null; gaps: Gap[] };

const dayLine = (e: Rec) => {
  const d = e.day ? new Date(`${e.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : null;
  const hours = [e.start_time, e.end_time].filter(Boolean).join("–");
  return [d, hours || null, Number(e.plan_days ?? 1) > 1 ? `${e.plan_days} days` : null].filter(Boolean).join(" · ");
};

export default function EventRecord({ eventId, onClose }: { eventId: string; onClose: () => void }) {
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

  // The prep checklist still lives at ?s=prep behind the handoff key. Built from the one helper in
  // lib/eventRecord rather than spelled out again — a sixth hand-written encoding is how the first
  // five drifted apart. A full navigation (not setSection) so the section param lands in the URL.
  const openPrep = () => {
    try { localStorage.setItem(prepHandoffKey, prepHandoffValue("event", eventId)); } catch { /* ignore */ }
    window.location.href = "/crew?s=prep";
  };

  return (
    <Sheet open onClose={onClose} label="Event"
      header={<div className="cp-head">
        <b>Event</b>
        <button type="button" className="qd-x" onClick={onClose} title="Close"><Icon name="close" /></button>
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

              {/* what disagrees — above every number, on purpose ──────────────────────────── */}
              {sorted.length > 0 && (
                <div className="cp-block evr-gaps">
                  <div className="cp-block-h">
                    <span>Needs sorting</span>
                    <b>{sorted.length}</b>
                  </div>
                  {sorted.map((g) => (
                    <div className={`evr-gap sev-${g.severity}`} key={g.gap}>
                      <b>{g.detail}</b>
                      <i>{gapFix(g.gap)}</i>
                    </div>
                  ))}
                </div>
              )}

              {/* where ────────────────────────────────────────────────────────────────────── */}
              <div className="cp-block">
                <div className="cp-block-h">
                  <span>Where</span>
                  <b>{e.market || e.rig || "—"}</b>
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
                <button type="button" className="cp-go" onClick={openPrep} style={{ marginTop: 10 }}>
                  Open the prep checklist <span aria-hidden="true">›</span>
                </button>
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
                ) : (
                  <p className="cp-line dim">
                    Nothing recorded. Card sales land here automatically from Square; cash has to be added.
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
