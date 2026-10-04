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
import { useRecord } from "./RecordSheet";
import Icon from "@/components/Icon";
import { targetIsCurrent } from "@/lib/readiness";
import { localToday } from "@/lib/dates";
import { useCrew, crewLabel } from "./useCrew";

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
// same way Route already does, so the two screens agree.
// 2026-10-03: the same for EVENTS, and from one rule — lib/readiness decides what is still ahead,
// for this board, for the Readiness tiles above it and for the prep list beside it. Groups whose
// target has gone (day passed, stage done, archived) sort LAST and say so; the tiles count only
// what is ahead, so their number is the number of rows at the top of this board.
type Task = {
  id: string; label: string; critical: boolean; due_at: string | null; assignee: string | null;
  event_id: string | null; stop_id: string | null; section: string | null; initiative_id: string | null;
  events: { title: string | null; day: string | null; archived_at: string | null; stage: string | null } | null;
  stops: { name: string | null; starts_at: string | null; archived_at: string | null; status: string | null } | null;
  initiatives: { title: string | null; emoji: string | null } | null;
};
type Filter = "all" | "critical" | "mine" | "overdue";
type Group = { key: string; label: string; kind: "initiative" | "event" | "stop" | "general"; initiativeId: string | null; recId: string | null; icon: React.ReactNode; tasks: Task[]; past?: boolean };
type BoardData = { rows: Task[] };

const nowISO = () => new Date().toISOString();
const dueLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

export default function PrepBoard() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const { openTask } = useTaskSheet(); // the ONE task editor, on the spine
  const { openRecord } = useRecord();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState<string | null>(null); // group armed for a "complete all" confirm

  const loader = useCallback(async (): Promise<BoardData> => {
    if (!supabase) return { rows: [] };
    // The assignee list is NOT fetched here. It used to be, which meant a failed profiles read
    // killed the whole prep board over an empty dropdown. useCrew is the one crew fetch (cached,
    // 60s TTL, shared with every other picker) and degrades to an empty list rather than an error,
    // which is the right failure for a picker: the tasks still render, one <select> is short.
    const { data, error } = await supabase.from("event_tasks")
      .select("id, label, critical, due_at, assignee, event_id, stop_id, section, initiative_id, events(title, day, archived_at, stage), stops(name, starts_at, archived_at, status), initiatives(title, emoji)")
      .eq("done", false).limit(300);
    if (error) throw new Error(error.message);
    return { rows: (data as unknown as Task[]) ?? [] };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  useRealtimeTable("event_tasks", reload);

  const rows = board.data?.rows ?? [];
  const crew = useCrew();

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
  const today = localToday();
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
        // An event or stop group is "past" by lib/readiness's one rule. An initiative can span many
        // stops, so no single date applies to it (mirrors Route: isAhead only ever judges one stop
        // at a time); a general group has no date at all.
        const past = kind === "event" ? !targetIsCurrent(t.events, null, today) : kind === "stop" ? !targetIsCurrent(null, t.stops, today) : false;
        g = { key, label, kind, initiativeId: t.initiative_id, recId: kind === "event" ? t.event_id : kind === "stop" ? t.stop_id : null, icon, tasks: [], past };
        map.set(key, g);
      }
      g.tasks.push(t);
    }
    // What is ahead first; what was left open last. Within each half the task sort still decides.
    const all = [...map.values()];
    return [...all.filter((g) => !g.past), ...all.filter((g) => g.past)];
  }, [shown, today]);

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
  // The tiles above this board count what is ahead; this is the rest, named once at the top so the
  // two numbers never look like a disagreement.
  const leftOpen = groups.filter((g) => g.past).reduce((n, g) => n + g.tasks.length, 0);

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
          {leftOpen > 0 && <p className="pbd-leftopen">{leftOpen} of these belong to events or stops that have already passed — at the end, each with its Wrap up.</p>}
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
                      {g.past && <span className="pbd-group-past">{g.kind === "event" ? "past · not closed out" : "past visit"}</span>}
                      <span className="pbd-group-n">{g.tasks.length}{crit ? ` · ${crit} crit` : ""}</span>
                    </button>
                    {/* The event or stop a group is named for opens its record (2026-10-04): the name only
                        folded the list. A past one says what it is owed — the record's wrap and archive. */}
                    {g.recId && (g.kind === "event" || g.kind === "stop") && (
                      <button type="button" className="pbd-group-open" onClick={() => openRecord(g.kind as "event" | "stop", g.recId!)}>
                        {g.past ? "Wrap up" : "Open"} <span aria-hidden="true">›</span>
                      </button>
                    )}
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
                              {crew.map((c) => <option key={c.id} value={c.id}>{crewLabel(c)}</option>)}
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
