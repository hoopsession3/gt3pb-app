"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import { completeTask, updateTask } from "@/lib/tasks";
import { useTaskSheet } from "./TaskSheet";
import Icon from "@/components/Icon";

// PREP BOARD — the aggregate readiness triage surface. Every open prep task, ROLLED UP into
// collapsible groups by the INITIATIVE it's assigned to (0201/0237) — falling back to its event/stop
// for anything not yet assigned — so a 60-item flat wall becomes a handful of named groups you can
// collapse, work, and clear together. Critical + overdue still lead; one tap to done, one tap to
// assign, and one deliberate two-tap to finish a whole initiative (which cascades its tasks + closes
// the program). Reads event_tasks; tasks never leave their event/stop. Fetch state (loading/error/
// empty) comes from useAsyncData — a failed query is a real error now, not a silent "you're ready 🟢".
//
// 2026-07-16: a stop-linked group here had no idea Route (app/crew/page.tsx) already considers a
// visit >8h past "stale" and files it under Past visits — this board kept showing it as a plain
// current group, so the same stop could read as active in one lane and archived in another. Not
// hiding it (an open task for a past stop is still real, maybe more urgent) — just naming it the
// same way Route already does, so the two screens agree. See isStopPast below.
type Task = {
  id: string; label: string; critical: boolean; due_at: string | null; assignee: string | null;
  event_id: string | null; stop_id: string | null; section: string | null; initiative_id: string | null;
  events: { title: string | null } | null; stops: { name: string | null; starts_at: string | null } | null;
  initiatives: { title: string | null; emoji: string | null } | null;
};
type Crew = { id: string; display_name: string | null };
type Filter = "all" | "critical" | "mine" | "overdue";
type Group = { key: string; label: string; kind: "initiative" | "event" | "stop" | "general"; initiativeId: string | null; icon: React.ReactNode; tasks: Task[]; past?: boolean };
type BoardData = { rows: Task[]; crew: Crew[] };

const nowISO = () => new Date().toISOString();
const dueLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
// Mirrors Route's own >8h-past grace exactly (app/crew/page.tsx's isAhead/graceMs) — same cutoff, so
// a stop reads the same age in both places even though the two components can't share the literal
// function across this file/route boundary.
const STOP_GRACE_MS = 8 * 3600 * 1000;
const isStopPast = (startsAt: string | null | undefined) => !!startsAt && new Date(startsAt).getTime() <= Date.now() - STOP_GRACE_MS;

export default function PrepBoard() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const { openTask } = useTaskSheet(); // the ONE task editor, on the spine
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState<string | null>(null); // group armed for a "complete all" confirm

  const loader = useCallback(async (): Promise<BoardData> => {
    if (!supabase) return { rows: [], crew: [] };
    const [t, c] = await Promise.all([
      supabase.from("event_tasks").select("id, label, critical, due_at, assignee, event_id, stop_id, section, initiative_id, events(title), stops(name, starts_at), initiatives(title, emoji)").eq("done", false).limit(300),
      supabase.from("profiles").select("id, display_name").neq("role", "member").order("display_name"),
    ]);
    if (t.error) throw new Error(t.error.message);
    if (c.error) throw new Error(c.error.message);
    return { rows: (t.data as unknown as Task[]) ?? [], crew: (c.data as Crew[]) ?? [] };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  useRealtimeTable("event_tasks", reload);

  const rows = board.data?.rows ?? [];
  const crew = board.data?.crew ?? [];

  const done = async (t: Task) => {
    if (!supabase) return;
    await completeTask("event", t.id, user?.id);   // ONE complete path (lib/tasks)
    reload();
  };
  const assign = async (t: Task, uid: string) => {
    if (!supabase) return;
    await updateTask("event", t.id, { assignee: uid || null });   // ONE write path (lib/tasks)
    reload();
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

  // Roll the sorted flat list up: by INITIATIVE first (the program a task is assigned to), else by its
  // own event/stop/section. Group order follows the sort, so the group holding the top task leads.
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const t of shown) {
      const key = t.initiative_id ? `i:${t.initiative_id}` : t.event_id ? `e:${t.event_id}` : t.stop_id ? `s:${t.stop_id}` : t.section ? `x:${t.section}` : "general";
      let g = map.get(key);
      if (!g) {
        const kind: Group["kind"] = t.initiative_id ? "initiative" : t.event_id ? "event" : t.stop_id ? "stop" : "general";
        const label = t.initiative_id ? (t.initiatives?.title || "Initiative") : (t.events?.title || t.stops?.name || t.section || "General");
        const icon = kind === "initiative" ? (t.initiatives?.emoji || "🎯") : kind === "event" ? <Icon name="calendar" /> : kind === "stop" ? <Icon name="pin" /> : "•";
        // Only a plain stop-kind group can be "past" — an initiative can span many stops, so no
        // single date applies to it (mirrors Route: isAhead only ever judges one stop at a time).
        const past = kind === "stop" ? isStopPast(t.stops?.starts_at) : false;
        g = { key, label, kind, initiativeId: t.initiative_id, icon, tasks: [], past };
        map.set(key, g);
      }
      g.tasks.push(t);
    }
    return [...map.values()];
  }, [shown]);

  // Within a group, show each task's OTHER binding as sub-context (event/stop inside an initiative;
  // section inside an event/stop) — never repeating the group's own label.
  const rowSub = (t: Task, g: Group) => {
    const s = g.kind === "initiative" ? (t.events?.title || t.stops?.name || t.section) : t.section;
    return s && s !== g.label ? s : null;
  };

  // Complete exactly the tasks SHOWN in a group — the count on the button, never more. (The full
  // "close the whole initiative" cascade lives on the Command board, where its true scope is clear;
  // completing from a filtered/limited board must not silently reach past what you can see.)
  // Two-tap so a mass-complete is never a mis-tap.
  const completeGroup = async (g: Group) => {
    if (!supabase) return;
    const ids = g.tasks.map((t) => t.id);
    setArmed(null);
    await Promise.all(ids.map((id) => completeTask("event", id, user?.id)));
    reload();
  };

  const counts = { all: rows.length, critical: rows.filter((t) => t.critical).length, mine: rows.filter((t) => t.assignee === user?.id).length, overdue: rows.filter(isOver).length };

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load prep" emptyTitle="Nothing here yet">
      {() => (
        <div className="pbd">
          <div className="pbd-filters" role="tablist" aria-label="Filter prep">
            {(["all", "critical", "mine", "overdue"] as Filter[]).map((f) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} className={`pbd-filter${filter === f ? " on" : ""}${f === "critical" && counts.critical ? " crit" : ""}`} onClick={() => setFilter(f)}>
                {f[0].toUpperCase() + f.slice(1)} <span className="pbd-fn">{counts[f]}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            // "all" empty means the whole board is clear — the designed empty state. A filtered tab
            // (critical/mine/overdue) coming up empty is a filtered VIEW, not the board itself — same
            // "no match" treatment as the roster search (stays a dense inline note).
            filter === "all" ? <EmptyState title="Nothing open" sub="You're ready." /> : <div className="pbd-empty">{`Nothing ${filter}.`}</div>
          ) : (
            groups.map((g) => {
              const open = !collapsed.has(g.key);
              const crit = g.tasks.filter((t) => t.critical).length;
              return (
                <div className="pbd-group" key={g.key}>
                  <div className="pbd-group-h">
                    <button type="button" className="pbd-group-t" aria-expanded={open}
                      onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>
                      <span className={`pbd-chev${open ? " open" : ""}`} aria-hidden>›</span>
                      <span className="pbd-group-ic" aria-hidden>{g.icon}</span>
                      <span className="pbd-group-nm">{g.label}</span>
                      {g.past && <span className="pbd-group-past">past visit</span>}
                      <span className="pbd-group-n">{g.tasks.length}{crit ? ` · ${crit} crit` : ""}</span>
                    </button>
                    <button type="button" className={`pbd-group-all${armed === g.key ? " armed" : ""}`}
                      onClick={() => (armed === g.key ? completeGroup(g) : setArmed(g.key))}
                      onBlur={() => setArmed((a) => (a === g.key ? null : a))}
                      aria-label={`Complete all ${g.tasks.length} tasks in ${g.label}`}>
                      {armed === g.key ? `Complete ${g.tasks.length}?` : <><Icon name="check" /> all</>}
                    </button>
                  </div>
                  {open && (
                    <div className="pbd-list">
                      {g.tasks.map((t) => {
                        const sub = rowSub(t, g);
                        return (
                          <div key={t.id} className={`pbd-row${t.critical ? " crit" : isOver(t) ? " over" : ""}`}>
                            <button type="button" className="pbd-check" onClick={() => done(t)} aria-label={`Mark done: ${t.label}`}><span /></button>
                            <div className="pbd-main" role="button" tabIndex={0} style={{ cursor: "pointer" }}
                              onClick={() => openTask(t.id, "event")}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTask(t.id, "event"); } }}
                              aria-label={`Open task: ${t.label}`}>
                              <span className="pbd-label">{t.label}</span>
                              <span className="pbd-ctx">{sub}{t.due_at ? <span className={isOver(t) ? "pbd-due over" : "pbd-due"}>{sub ? " · " : ""}{isOver(t) ? "overdue" : dueLabel(t.due_at)}</span> : null}{t.critical ? <span className="pbd-crit">critical</span> : null}</span>
                            </div>
                            <select className={`pbd-assign${t.assignee ? " on" : ""}`} value={t.assignee ?? ""} onChange={(e) => assign(t, e.target.value)} aria-label={`Assign: ${t.label}`}>
                              <option value="">Assign</option>
                              {crew.map((c) => <option key={c.id} value={c.id}>{c.display_name || "Crew"}</option>)}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </AsyncSection>
  );
}
