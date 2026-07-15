"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { InfoRow } from "@/components/kit";

// PLANNING BOARD — the plan at altitude. Goals grouped by horizon (strategic / tactical / operational,
// 0213) into three columns, each row showing owner + progress + due. The glanceable enterprise-planning
// view above the detailed goal threads. Read-only by default: rows rest plainly, no false clickable
// affordance. Pass onOpenCard to make each row an honest tap target (opens the goal); edit goal details
// in the threads below.
type G = { id: string; title: string; horizon: string; status: string; current_value: number; target_value: number; due_date: string | null; owner_user_id: string | null };
type P = { id: string; display_name: string | null };

const COLS = [
  { key: "strategic", label: "Strategic", hint: "The big bets", num: "I" },
  { key: "tactical", label: "Tactical", hint: "The moves", num: "II" },
  { key: "operational", label: "Operational", hint: "Day to day", num: "III" },
];
const dnice = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

export default function PlanningBoard({ onOpenCard }: { onOpenCard?: (id: string) => void }) {
  const [goals, setGoals] = useState<G[]>([]);
  const [people, setPeople] = useState<P[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
    const [g, p] = await Promise.all([
      supabase.from("goals").select("id, title, horizon, status, current_value, target_value, due_date, owner_user_id").neq("status", "archived"),
      supabase.from("profiles").select("id, display_name").neq("role", "member"),
    ]);
    setGoals((g.data as G[]) ?? []); setPeople((p.data as P[]) ?? []); setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["goals"], load);

  const firstName = (uid: string | null) => (people.find((x) => x.id === uid)?.display_name || "").trim().split(/\s+/)[0] || null;
  if (!loaded || goals.length === 0) return null;

  return (
    <div className="pboard">
      {COLS.map((c) => {
        const items = goals.filter((g) => (g.horizon || "tactical") === c.key);
        return (
          <div className={`pboard-col pboard-${c.key}`} key={c.key}>
            {/* Kit header treatment: mono .k-eyb eyebrow for the label, keeping the column ordinal + count */}
            <div className="pboard-col-h">
              <span className="pboard-num">{c.num}</span>
              <div className="pboard-col-title">
                <span className="k-eyb">{c.label}</span>
                <span className="pboard-hint">{c.hint}</span>
              </div>
              <span className="pboard-count">{items.length}</span>
            </div>
            {items.length === 0 ? (
              <div className="pboard-empty">Nothing here yet</div>
            ) : (
              <div className="k-rows">
                {items.map((g) => {
                  const pct = g.target_value > 0 ? Math.max(0, Math.min(100, Math.round((g.current_value / g.target_value) * 100))) : 0;
                  const who = firstName(g.owner_user_id) ?? "Unassigned";
                  return (
                    <InfoRow
                      key={g.id}
                      name={g.title}
                      sub={
                        <div className="pboard-prog">
                          <span className="pboard-bar"><span className={g.status === "hit" ? "hit" : ""} style={{ width: `${pct}%` }} /></span>
                          <span className="pboard-pct">{pct}%</span>
                        </div>
                      }
                      meta={`${who}${g.due_date ? ` · ${dnice(g.due_date)}` : ""}`}
                      onClick={onOpenCard ? () => onOpenCard(g.id) : undefined}
                      ariaLabel={onOpenCard ? `Open goal: ${g.title}` : undefined}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
