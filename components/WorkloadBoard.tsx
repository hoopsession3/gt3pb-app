"use client";

import { useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { InfoRow } from "@/components/kit";

// WORKLOAD BOARD — who's carrying what. As the team grows 2→5, work distribution can't stay invisible
// (headcount counts were all we had). Reads the all_tasks spine (0210) — event_tasks + delegated todos
// — and shows each teammate's open + overdue load. Leadership-only (Team section). Reuses the profiles
// roster filter (role != 'member'). Fetch state via useAsyncData — a failed load is a real error now,
// not a silent "No teammates yet".
type Person = { id: string; display_name: string | null; role: string };
type Task = { assignee: string | null; due: string | null };
type BoardData = { people: Person[]; tasks: Task[] };
const todayKey = () => new Date().toISOString().slice(0, 10);

export default function WorkloadBoard() {
  const loader = useCallback(async (): Promise<BoardData> => {
    if (!supabase) return { people: [], tasks: [] };
    const [pp, tt] = await Promise.all([
      supabase.from("profiles").select("id, display_name, role").neq("role", "member").order("display_name"),
      supabase.from("all_tasks").select("assignee, due").eq("done", false).not("assignee", "is", null),
    ]);
    if (pp.error) throw new Error(pp.error.message);
    if (tt.error) throw new Error(tt.error.message);
    return { people: (pp.data as Person[]) ?? [], tasks: (tt.data as Task[]) ?? [] };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  useRealtimeTable(["event_tasks", "todos"], reload);

  const byPerson = useMemo(() => {
    const today = todayKey();
    const m = new Map<string, { open: number; over: number }>();
    for (const t of board.data?.tasks ?? []) {
      if (!t.assignee) continue;
      const e = m.get(t.assignee) ?? { open: 0, over: 0 };
      e.open++; if (t.due && t.due < today) e.over++;
      m.set(t.assignee, e);
    }
    return m;
  }, [board.data]);

  // On the kit InfoRow: name+role lead the body, the load bar + count ride the trailing slot.
  // Same row grammar as every other list in the app — a teammate reads like a stop reads.
  return (
    <AsyncSection
      state={board}
      isEmpty={(data) => data.people.length === 0}
      emptyTitle="No teammates yet"
      emptySub="Add people in the roster below."
      errorTitle="Couldn't load workload"
    >
      {(data) => {
        const rows = data.people.map((p) => ({ p, ...(byPerson.get(p.id) ?? { open: 0, over: 0 }) })).sort((a, b) => b.over - a.over || b.open - a.open);
        const max = Math.max(1, ...rows.map((r) => r.open));
        return (
          <div className="wl k-rows">
            {rows.map(({ p, open, over }) => (
              <InfoRow
                key={p.id}
                name={p.display_name || "Teammate"}
                sub={p.role}
                trailing={
                  <div className="wl-tr">
                    <span className="wl-bar"><span className={over ? "over" : ""} style={{ width: `${(open / max) * 100}%` }} /></span>
                    <span className="wl-n">{open === 0 ? "clear" : `${open} open`}{over ? <span className="wl-over"> · {over} overdue</span> : null}</span>
                  </div>
                }
              />
            ))}
          </div>
        );
      }}
    </AsyncSection>
  );
}
