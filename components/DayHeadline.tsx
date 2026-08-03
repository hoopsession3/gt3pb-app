"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { etToday } from "@/lib/dates";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { useTaskSheet } from "./TaskSheet";
import Icon from "@/components/Icon";

/* eslint-disable @typescript-eslint/no-explicit-any */
// THE OWNER'S HEADLINE (crew P3, 2026-08-03) — My Day for a leader opens with the ONE thing the
// day is about: today's field op (if there is one) and the top three due. Ten seconds of glance
// before the plates. Renders nothing when the day has neither — silence is a valid headline.

type Op = { id: string; kind: string; name: string | null; day: string | null; is_live: boolean | null };
type T = { id: string; source: string; title: string; due: string | null; critical: boolean };

export default function DayHeadline() {
  const { openTask } = useTaskSheet();
  const loader = useCallback(async (): Promise<{ op: Op | null; top: T[] }> => {
    if (!supabase) return { op: null, top: [] };
    const today = etToday();
    const [o, t] = await Promise.all([
      supabase.from("field_ops").select("id, kind, name, day, is_live").eq("day", today).limit(1).maybeSingle(),
      supabase.from("all_tasks").select("id, source, title, due, critical").eq("done", false).not("due", "is", null).lte("due", today)
        .order("critical", { ascending: false }).order("due").limit(3),
    ]);
    return { op: (o.data as Op) ?? null, top: (t.data as T[]) ?? [] };
  }, []);
  const state = useAsyncData(loader, []);
  useRealtimeTable(["field_ops", "event_tasks", "todos"], state.reload);

  const d = state.data;
  if (!d || (!d.op && d.top.length === 0)) return null;
  return (
    <div className="dayhead">
      {d.op && (
        <div className={`dayhead-op${d.op.is_live ? " live" : ""}`}>
          <span className="dayhead-k">{d.op.is_live ? "LIVE now" : "Today's op"}</span>
          <b>{d.op.name || (d.op.kind === "stop" ? "Truck stop" : "Event")}</b>
        </div>
      )}
      {d.top.length > 0 && (
        <div className="dayhead-top">
          <span className="dayhead-k">Top {d.top.length}</span>
          {d.top.map((t) => (
            <button key={t.id} type="button" className={`dayhead-t${t.critical ? " crit" : ""}`} onClick={() => openTask(t.id, t.source === "todo" ? "todo" : "event")}>
              {t.critical && <Icon name="warning" />}{t.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
