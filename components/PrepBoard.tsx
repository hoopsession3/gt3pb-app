"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { completeTask } from "@/lib/tasks";
import { useTaskSheet } from "./TaskSheet";

// PREP BOARD — the aggregate readiness triage surface. Every open prep task across every event and
// stop, in ONE prioritized board you can actually work: critical + overdue first, one tap to done,
// one tap to assign, filter to what matters. Fixes the dead-end where the "open prep tasks" number
// had nowhere to go. Reads event_tasks (the same universe the readiness KPIs count).
type Task = {
  id: string; label: string; critical: boolean; due_at: string | null; assignee: string | null;
  event_id: string | null; stop_id: string | null; section: string | null;
  events: { title: string | null } | null; stops: { name: string | null } | null;
};
type Crew = { id: string; display_name: string | null };
type Filter = "all" | "critical" | "mine" | "overdue";

const nowISO = () => new Date().toISOString();
const dueLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

export default function PrepBoard() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Task[]>([]);
  const [crew, setCrew] = useState<Crew[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const { openTask } = useTaskSheet(); // the ONE task editor, on the spine
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
    const [t, c] = await Promise.all([
      supabase.from("event_tasks").select("id, label, critical, due_at, assignee, event_id, stop_id, section, events(title), stops(name)").eq("done", false).limit(300),
      supabase.from("profiles").select("id, display_name").neq("role", "member").order("display_name"),
    ]);
    setRows((t.data as unknown as Task[]) ?? []); setCrew((c.data as Crew[]) ?? []); setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable("event_tasks", load);

  const done = async (t: Task) => {
    if (!supabase) return;
    setRows((p) => p.filter((x) => x.id !== t.id));
    await completeTask("event", t.id, user?.id);   // ONE complete path (lib/tasks)
  };
  const assign = async (t: Task, uid: string) => {
    if (!supabase) return;
    setRows((p) => p.map((x) => (x.id === t.id ? { ...x, assignee: uid || null } : x)));
    await supabase.from("event_tasks").update({ assignee: uid || null }).eq("id", t.id);
  };

  const now = nowISO();
  const isOver = (t: Task) => !!t.due_at && t.due_at < now;
  const shown = useMemo(() => {
    const f = rows.filter((t) =>
      filter === "all" ? true : filter === "critical" ? t.critical : filter === "mine" ? t.assignee === user?.id : isOver(t));
    // critical → overdue → soonest due → has-a-date-before-undated
    return f.slice().sort((a, b) =>
      Number(b.critical) - Number(a.critical) || Number(isOver(b)) - Number(isOver(a)) || (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));
  }, [rows, filter, user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) return null;
  const counts = { all: rows.length, critical: rows.filter((t) => t.critical).length, mine: rows.filter((t) => t.assignee === user?.id).length, overdue: rows.filter(isOver).length };
  const ctx = (t: Task) => t.events?.title || t.stops?.name || (t.section ? t.section : "General");

  return (
    <div className="pbd">
      <div className="pbd-filters" role="tablist" aria-label="Filter prep">
        {(["all", "critical", "mine", "overdue"] as Filter[]).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} className={`pbd-filter${filter === f ? " on" : ""}${f === "critical" && counts.critical ? " crit" : ""}`} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)} <span className="pbd-fn">{counts[f]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="pbd-empty">{filter === "all" ? "Nothing open — you're ready. 🟢" : `Nothing ${filter}.`}</div>
      ) : (
        <div className="pbd-list">
          {shown.map((t) => (
            <div key={t.id} className={`pbd-row${t.critical ? " crit" : isOver(t) ? " over" : ""}`}>
              <button type="button" className="pbd-check" onClick={() => done(t)} aria-label={`Mark done: ${t.label}`}><span /></button>
              <div className="pbd-main" role="button" tabIndex={0} style={{ cursor: "pointer" }}
                onClick={() => openTask(t.id, "event")}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTask(t.id, "event"); } }}
                aria-label={`Open task: ${t.label}`}>
                <span className="pbd-label">{t.label}</span>
                <span className="pbd-ctx">{ctx(t)}{t.due_at ? <span className={isOver(t) ? "pbd-due over" : "pbd-due"}> · {isOver(t) ? "overdue" : dueLabel(t.due_at)}</span> : null}{t.critical ? <span className="pbd-crit">critical</span> : null}</span>
              </div>
              <select className={`pbd-assign${t.assignee ? " on" : ""}`} value={t.assignee ?? ""} onChange={(e) => assign(t, e.target.value)} aria-label={`Assign: ${t.label}`}>
                <option value="">Assign</option>
                {crew.map((c) => <option key={c.id} value={c.id}>{c.display_name || "Crew"}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
