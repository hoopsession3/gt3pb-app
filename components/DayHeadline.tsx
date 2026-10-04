"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { etToday, localToday } from "@/lib/dates";
import { daysBetween, dueWord } from "@/lib/dayWords";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { useTaskSheet } from "./TaskSheet";
import Icon from "@/components/Icon";

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
// So this is now the ONE place today's op is shown, for everybody: the events My Day used to read
// (active only, with the brief from event_ops), and the card opens the event when the viewer can
// prep it. Stops keep their chips in My Day's rhythm row, which already read them properly. The top
// three are still a leader's, and now each one says how late it is.
//
// A FAILED READ IS NOT A QUIET DAY. Every read below throws. This used to read .data straight
// through a PostgREST error object — which is not a throw — so the error branch it had was
// unreachable and a failure rendered as the silence that means "nothing on today".

type Op = { id: string; title: string | null; day_label: string | null; is_live: boolean | null; dress_code: string | null; crew_brief: string | null };
type T = { id: string; source: string; title: string; due: string | null; critical: boolean };
type Data = { ops: Op[]; top: T[]; dueDay: string };
type Read<R> = { data: R | null; error: { message: string } | null };

export default function DayHeadline({ leader, onOpenOp }: { leader: boolean; onOpenOp?: (id: string) => void }) {
  const { openTask } = useTaskSheet();
  const loader = useCallback(async (): Promise<Data> => {
    // Two "todays", each the one lib/dates says it means: the event is the crew's wall-clock day,
    // a task's due date is the business day it was always compared against here.
    const dueDay = etToday();
    if (!supabase) return { ops: [], top: [], dueDay };
    const sb = supabase;
    const topThree = async (): Promise<Read<T[]>> => {
      if (!leader) return { data: [], error: null };
      const r = await sb.from("all_tasks").select("id, source, title, due, critical")
        .eq("done", false).not("due", "is", null).lte("due", dueDay)
        .order("critical", { ascending: false }).order("due").limit(3);
      return { data: (r.data as T[] | null), error: r.error };
    };
    const [ev, tk] = await Promise.all([
      sb.from("events").select("id, title, day_label, is_live").eq("day", localToday()).is("archived_at", null).order("title"),
      topThree(),
    ]);
    if (ev.error) throw new Error(ev.error.message);
    if (tk.error) throw new Error(tk.error.message);
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
      top: tk.data ?? [],
      dueDay,
    };
  }, [leader]);
  const state = useAsyncData(loader, [loader]);
  useRealtimeTable(["events", "event_ops", "event_tasks", "todos"], state.reload);

  const d = state.data;
  if (state.status === "error") return (
    <p className="load-failed" role="status">
      Couldn&apos;t load today&apos;s op{leader ? " and top three" : ""} — this is not &ldquo;nothing on&rdquo;.{" "}
      <button type="button" className="btn-ter" onClick={() => state.reload()}>Try again</button>
    </p>
  );
  if (!d || (d.ops.length === 0 && d.top.length === 0)) return null;
  return (
    <div className="dayhead">
      {d.ops.map((op) => {
        const name = op.title || op.day_label || "Event";
        const head = (
          <>
            <span className="dayhead-k">{op.is_live ? "LIVE now" : "Today's op"}</span>
            <b>{name}</b>
          </>
        );
        return (
          <div key={op.id} className={`dayhead-op${op.is_live ? " live" : ""}`}>
            {onOpenOp ? (
              <button type="button" className="dayhead-op-go" onClick={() => onOpenOp(op.id)} aria-label={`Open ${name}`}>
                <span className="dayhead-op-t">{head}</span>
                <span className="ev-chev" aria-hidden="true">›</span>
              </button>
            ) : <span className="dayhead-op-t">{head}</span>}
            {(op.dress_code?.trim() || op.crew_brief?.trim()) && (
              <div className="myday-brief">
                {op.dress_code?.trim() && <div className="myday-brief-row"><b>Wear</b><span>{op.dress_code}</span></div>}
                {op.crew_brief?.trim() && <div className="myday-brief-row"><b>Details</b><span style={{ whiteSpace: "pre-wrap" }}>{op.crew_brief}</span></div>}
              </div>
            )}
          </div>
        );
      })}
      {d.top.length > 0 && (
        <div className="dayhead-top">
          <span className="dayhead-k">Top {d.top.length}</span>
          {d.top.map((t) => {
            const out = t.due ? daysBetween(d.dueDay, t.due) : null;
            return (
              <button key={t.id} type="button" className={`dayhead-t${t.critical ? " crit" : ""}`} onClick={() => openTask(t.id, t.source === "todo" ? "todo" : "event")}>
                {t.critical && <Icon name="warning" />}
                <span className="dayhead-tt">{t.title}</span>
                {/* The same words and the same look as Needs-you's rows: lateness is said one way. */}
                {out != null && <span className={`owed-age${out < 0 ? " late" : ""}`}>{dueWord(out)}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
