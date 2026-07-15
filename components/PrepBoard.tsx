"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { completeTask } from "@/lib/tasks";
import { useTaskSheet } from "./TaskSheet";

// PREP BOARD — the aggregate readiness triage surface. Every open prep task across every event and
// stop, ROLLED UP into collapsible groups by its own event/stop (its rightful stream), so a 60-item
// flat wall becomes a handful of named groups you can collapse, work, and clear together. Critical +
// overdue still float to the top group; one tap to done, one tap to assign, and one deliberate
// two-tap to complete a whole group at once. Reads event_tasks; tasks never leave their event/stop.
type Task = {
  id: string; label: string; critical: boolean; due_at: string | null; assignee: string | null;
  event_id: string | null; stop_id: string | null; section: string | null;
  events: { title: string | null } | null; stops: { name: string | null } | null;
};
type Crew = { id: string; display_name: string | null };
type Filter = "all" | "critical" | "mine" | "overdue";
type Group = { key: string; label: string; kind: "event" | "stop" | "general"; tasks: Task[] };

const nowISO = () => new Date().toISOString();
const dueLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

export default function PrepBoard() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Task[]>([]);
  const [crew, setCrew] = useState<Crew[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const { openTask } = useTaskSheet(); // the ONE task editor, on the spine
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState<string | null>(null); // group armed for a "complete all" confirm

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

  // Roll the sorted flat list up into groups by each task's OWN event/stop (its rightful stream).
  // Group order follows the sort, so the group holding the top critical/overdue task leads.
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const t of shown) {
      const key = t.event_id ? `e:${t.event_id}` : t.stop_id ? `s:${t.stop_id}` : t.section ? `x:${t.section}` : "general";
      let g = map.get(key);
      if (!g) { g = { key, label: t.events?.title || t.stops?.name || t.section || "General", kind: t.event_id ? "event" : t.stop_id ? "stop" : "general", tasks: [] }; map.set(key, g); }
      g.tasks.push(t);
    }
    return [...map.values()];
  }, [shown]);

  // Finish a whole group at once (Ryan: "finish an initiative → it finishes all tasks under it").
  // Two-tap: first tap arms, second confirms — so a mass-complete is never a mis-tap.
  const completeGroup = async (g: Group) => {
    if (!supabase) return;
    const ids = g.tasks.map((t) => t.id);
    setRows((p) => p.filter((x) => !ids.includes(x.id)));
    setArmed(null);
    await Promise.all(ids.map((id) => completeTask("event", id, user?.id)));
  };

  if (!loaded) return null;
  const counts = { all: rows.length, critical: rows.filter((t) => t.critical).length, mine: rows.filter((t) => t.assignee === user?.id).length, overdue: rows.filter(isOver).length };

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
        groups.map((g) => {
          const open = !collapsed.has(g.key);
          const crit = g.tasks.filter((t) => t.critical).length;
          const icon = g.kind === "event" ? "📅" : g.kind === "stop" ? "📍" : "•";
          return (
            <div className="pbd-group" key={g.key}>
              <div className="pbd-group-h">
                <button type="button" className="pbd-group-t" aria-expanded={open}
                  onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>
                  <span className={`pbd-chev${open ? " open" : ""}`} aria-hidden>›</span>
                  <span className="pbd-group-ic" aria-hidden>{icon}</span>
                  <span className="pbd-group-nm">{g.label}</span>
                  <span className="pbd-group-n">{g.tasks.length}{crit ? ` · ${crit} crit` : ""}</span>
                </button>
                <button type="button" className={`pbd-group-all${armed === g.key ? " armed" : ""}`}
                  onClick={() => (armed === g.key ? completeGroup(g) : setArmed(g.key))}
                  onBlur={() => setArmed((a) => (a === g.key ? null : a))}
                  aria-label={`Complete all ${g.tasks.length} tasks in ${g.label}`}>
                  {armed === g.key ? `Complete ${g.tasks.length}?` : "✓ all"}
                </button>
              </div>
              {open && (
                <div className="pbd-list">
                  {g.tasks.map((t) => (
                    <div key={t.id} className={`pbd-row${t.critical ? " crit" : isOver(t) ? " over" : ""}`}>
                      <button type="button" className="pbd-check" onClick={() => done(t)} aria-label={`Mark done: ${t.label}`}><span /></button>
                      <div className="pbd-main" role="button" tabIndex={0} style={{ cursor: "pointer" }}
                        onClick={() => openTask(t.id, "event")}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTask(t.id, "event"); } }}
                        aria-label={`Open task: ${t.label}`}>
                        <span className="pbd-label">{t.label}</span>
                        <span className="pbd-ctx">{t.section && t.section !== g.label ? t.section : null}{t.due_at ? <span className={isOver(t) ? "pbd-due over" : "pbd-due"}>{t.section && t.section !== g.label ? " · " : ""}{isOver(t) ? "overdue" : dueLabel(t.due_at)}</span> : null}{t.critical ? <span className="pbd-crit">critical</span> : null}</span>
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
        })
      )}
    </div>
  );
}
