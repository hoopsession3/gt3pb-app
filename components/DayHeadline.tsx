"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { localToday } from "@/lib/dates";
import { setEventLive } from "@/lib/wrap";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { useRecord } from "./RecordSheet";
import { useApp } from "./AppProvider";
import { WayButtons } from "./RecordWays";

// THE DAY'S HEADLINE — what today is about, before the plates.
//
// Crew P3 (2026-08-03): My Day for a leader opened with today's field op and the top three due.
// Ten seconds of glance before the plates.
//
// ── ONE CARD FOR TODAY'S OP (2026-10-04, Ryan's My Day at 10:13 PM) ─────────────────────────────
// The op card here read field_ops, and three things were wrong with it:
//   · no archived filter — an event wrapped and archived that evening still headlined the day;
//   · it matched on field_ops.day, which the stop mirror never fills, so a truck-stop day never
//     headlined at all (the "Truck stop" fallback below it was unreachable);
//   · for a leader it sat directly above My Day's own card for the same event, read from a different
//     table: two cards for one event, one carrying the dress code and the brief and one not.
// So this is now the ONE place today's op is shown, for everybody: the active events My Day used to
// read, with the brief from event_ops. Stops keep their chips in My Day's rhythm row, which already
// read them properly. The top three are a leader's, and each says how late it is.
//
// ── AND IT OPENS (later that night) ─────────────────────────────────────────────────────────────
// Ryan: "Clicking on Greenville Fit Fest today's op does nothing." In production it was a <div>. The
// whole card is now the button, and it opens the event's record — the one place an event is
// (components/EventRecord.tsx): where, the brief, what it is waiting on, what it took, the prep
// checklist, and for today the live switch and the wrap. Not the old localStorage handoff into the
// checklist, which a server cannot open and which skipped everything but the checklist. And the day's
// most important switch, which lived in a folded panel at the foot of Live Ops, is on the card itself
// for whoever may throw it: today, not live, not wrapped — "Make it live".
//
// ── AND THE TOP THREE ARE GONE (2026-10-04, "one task, one place") ──────────────────────────────
// For a leader the headline also listed the three most urgent tasks due — company-wide, critical
// first. Every one of them was already on the same screen, once or twice: a task assigned to you is
// in My tasks, and the team's late tasks and the company's to-dos are under Needs you. Ryan's 10:13
// screen had all three of its top three in Needs you's team list as well. So a task now has one place
// on My Day — yours in My tasks, everybody else's under Needs you, where the most urgent three now
// lead the team list unfolded (components/Owed) — and the headline is what it says: today's op.
//
// A FAILED READ IS NOT A QUIET DAY. Every read below throws. This used to read .data straight
// through a PostgREST error object — which is not a throw — so the error branch it had was
// unreachable and a failure rendered as the silence that means "nothing on today".

type Op = { id: string; title: string | null; day_label: string | null; is_live: boolean | null; stage: string | null; dress_code: string | null; crew_brief: string | null };
type Data = { ops: Op[]; dayLabel: string };

export default function DayHeadline({ canGoLive }: { canGoLive: boolean }) {
  const { openRecord } = useRecord();
  const { toast } = useApp();
  const [arming, setArming] = useState<string | null>(null);
  const loader = useCallback(async (): Promise<Data> => {
    // The event is the crew's wall-clock day (lib/dates localToday). The date rides on the card rather
    // than a greeting line above it: on an operator's first screen the day's op is the headline, and
    // the date is its caption. Read here, not in render.
    const dayLabel = new Date(`${localToday()}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    if (!supabase) return { ops: [], dayLabel };
    const sb = supabase;
    const ev = await sb.from("events").select("id, title, day_label, is_live, stage").eq("day", localToday()).is("archived_at", null).order("title");
    if (ev.error) throw new Error(ev.error.message);
    const evs = (ev.data ?? []) as Omit<Op, "dress_code" | "crew_brief">[];
    let briefs = new Map<string, { dress_code: string | null; crew_brief: string | null }>();
    if (evs.length) {
      // The brief lives on the staff-only event_ops sibling (0195).
      const o = await sb.from("event_ops").select("event_id, dress_code, crew_brief").in("event_id", evs.map((e) => e.id));
      if (o.error) throw new Error(o.error.message); // else every event silently loses its dress code and brief
      briefs = new Map(((o.data ?? []) as { event_id: string; dress_code: string | null; crew_brief: string | null }[]).map((r) => [r.event_id, r]));
    }
    return {
      ops: evs.map((e) => ({ ...e, dress_code: briefs.get(e.id)?.dress_code ?? null, crew_brief: briefs.get(e.id)?.crew_brief ?? null })),
      dayLabel,
    };
  }, []);
  const state = useAsyncData(loader, [loader]);
  useRealtimeTable(["events", "event_ops"], state.reload);

  // The same write Live Ops' heads-up makes (lib/wrap setEventLive → admin_set_event_live).
  const makeLive = async (id: string) => {
    if (!supabase || arming) return;
    setArming(id);
    const { error } = await setEventLive(supabase, id, true);
    setArming(null);
    if (error) { toast(`Couldn't make it live — ${error.message}`, "error"); return; }
    toast("Event is live — sales now track to it");
    state.reload();
  };

  const d = state.data;
  if (state.status === "error") return (
    <p className="load-failed" role="status">
      Couldn&apos;t load today&apos;s op — this is not &ldquo;nothing on&rdquo;.{" "}
      <button type="button" className="btn-ter" onClick={() => state.reload()}>Try again</button>
    </p>
  );
  if (!d || d.ops.length === 0) return null;
  return (
    <div className="dayhead">
      {d.ops.map((op) => {
        const name = op.title || op.day_label || "Event";
        const done = op.stage === "done";
        return (
          <div key={op.id} className={`dayhead-op${op.is_live ? " live" : ""}`}>
            {/* The whole card is the button. The brief is spans, not divs, so it can sit inside one. */}
            <button type="button" className="dayhead-op-go" onClick={() => openRecord("event", op.id)}>
              <span className="dayhead-op-t">
                <span className="dayhead-k">{op.is_live ? "LIVE now" : done ? "Today's op · wrapped" : "Today's op"} · {d.dayLabel}</span>
                <b>{name}</b>
                {(op.dress_code?.trim() || op.crew_brief?.trim()) && (
                  <span className="myday-brief">
                    {op.dress_code?.trim() && <span className="myday-brief-row"><b>Wear</b><span>{op.dress_code}</span></span>}
                    {op.crew_brief?.trim() && <span className="myday-brief-row"><b>Details</b><span style={{ whiteSpace: "pre-wrap" }}>{op.crew_brief}</span></span>}
                  </span>
                )}
              </span>
              <span className="ev-chev" aria-hidden="true">›</span>
            </button>
            {canGoLive && !op.is_live && !done && (
              <WayButtons ways={[{ label: "Make it live", busy: arming === op.id, onClick: () => makeLive(op.id) }]} />
            )}
          </div>
        );
      })}
    </div>
  );
}
