"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";

// WORKLOAD BOARD — who's carrying what. As the team grows 2→5, work distribution can't stay invisible
// (headcount counts were all we had). Reads the all_tasks spine (0210) — event_tasks + delegated todos
// — and shows each teammate's open + overdue load. Leadership-only (Team section). Reuses the profiles
// roster filter (role != 'member').
type Person = { id: string; display_name: string | null; role: string };
type Task = { assignee: string | null; due: string | null };
const todayKey = () => new Date().toISOString().slice(0, 10);

export default function WorkloadBoard() {
  const [people, setPeople] = useState<Person[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
    const [pp, tt] = await Promise.all([
      supabase.from("profiles").select("id, display_name, role").neq("role", "member").order("display_name"),
      supabase.from("all_tasks").select("assignee, due").eq("done", false).not("assignee", "is", null),
    ]);
    setPeople((pp.data as Person[]) ?? []);
    setTasks((tt.data as Task[]) ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["event_tasks", "todos"], load);

  const byPerson = useMemo(() => {
    const today = todayKey();
    const m = new Map<string, { open: number; over: number }>();
    for (const t of tasks) {
      if (!t.assignee) continue;
      const e = m.get(t.assignee) ?? { open: 0, over: 0 };
      e.open++; if (t.due && t.due < today) e.over++;
      m.set(t.assignee, e);
    }
    return m;
  }, [tasks]);

  if (!loaded) return null;
  const rows = people.map((p) => ({ p, ...(byPerson.get(p.id) ?? { open: 0, over: 0 }) })).sort((a, b) => b.over - a.over || b.open - a.open);
  const max = Math.max(1, ...rows.map((r) => r.open));
  if (rows.length === 0) return <div className="wl-empty">No teammates yet — add people in the roster below.</div>;

  return (
    <div className="wl">
      {rows.map(({ p, open, over }) => (
        <div className="wl-row" key={p.id}>
          <div className="wl-who"><b>{p.display_name || "Teammate"}</b><span className="wl-role">{p.role}</span></div>
          <span className="wl-bar"><span className={over ? "over" : ""} style={{ width: `${(open / max) * 100}%` }} /></span>
          <span className="wl-n">{open === 0 ? "clear" : `${open} open`}{over ? <span className="wl-over"> · {over} overdue</span> : null}</span>
        </div>
      ))}
    </div>
  );
}
