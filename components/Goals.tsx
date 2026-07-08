"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth, roleOf } from "./AuthProvider";
import { StrategyThread } from "./StrategyCollab";

// GOALS — the strategy's scoreboard, worked live between owners and managers (Plan › Goals).
// Seeded from the locked strategy doc: the six Phase 1→2 trigger conditions arrive as goals, so
// the checklist the doc commits to is a living board, not a paragraph. Every goal carries a 💬
// thread (same engine as the Playbook — posting pings the owners), leadership logs progress as
// numbers, and the bar answers "are we there?" at a glance. Reviewed monthly against Money's
// actuals, per governance. Data: goals (0142) — audited + delete-guarded like every business record.

type Goal = {
  id: string; title: string; metric: string | null; unit: string;
  target_value: number; current_value: number; due_date: string | null;
  play: string | null; source: string | null; status: "active" | "hit" | "missed" | "archived";
  author_name: string | null; updated_at: string;
};

const LEAD_ROLES = ["owner", "admin", "event_manager"];

let goalsChanSeq = 0;
export default function Goals() {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<Goal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);     // which thread is open
  const [logging, setLogging] = useState<string | null>(null); // which goal shows the log form
  const [logVal, setLogVal] = useState("");
  const [adding, setAdding] = useState(false);
  const [ng, setNg] = useState({ title: "", target: "", unit: "", play: "", due: "" });
  const canLead = LEAD_ROLES.includes(roleOf(profile) ?? "") || !!profile?.is_admin;

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("goals").select("*").neq("status", "archived")
      .order("status").order("due_date", { ascending: true, nullsFirst: false }).order("created_at");
    if (data) setRows(data as Goal[]);
    setLoaded(true);
  }, []);
  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel(`goals-${++goalsChanSeq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "goals" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  const logProgress = async (g: Goal) => {
    if (!supabase) return;
    const v = Number(logVal);
    if (!Number.isFinite(v)) { toast("Numbers only — the bar does the talking", "error"); return; }
    setLogging(null); setLogVal("");
    setRows((r) => r.map((x) => (x.id === g.id ? { ...x, current_value: v } : x))); // optimistic
    const { error } = await supabase.from("goals").update({ current_value: v, updated_at: new Date().toISOString() }).eq("id", g.id);
    if (error) { toast(`Couldn't log it — ${error.message}`, "error"); load(); return; }
    toast(v >= g.target_value ? "Logged — that's the target. Mark it hit when it holds." : "Progress logged");
  };

  const setStatus = async (g: Goal, status: Goal["status"]) => {
    if (!supabase) return;
    setRows((r) => r.map((x) => (x.id === g.id ? { ...x, status } : x)));
    const { error } = await supabase.from("goals").update({ status, updated_at: new Date().toISOString() }).eq("id", g.id);
    if (error) { toast(`Couldn't update — ${error.message}`, "error"); load(); }
    else if (status === "hit") toast("Goal hit — log the decision on the Playbook");
  };

  const addGoal = async () => {
    if (!supabase || !user) return;
    const target = Number(ng.target);
    if (!ng.title.trim() || !Number.isFinite(target) || target <= 0) { toast("A goal needs a name and a real target", "error"); return; }
    const { error } = await supabase.from("goals").insert({
      title: ng.title.trim(), target_value: target, unit: ng.unit.trim(), play: ng.play.trim() || null,
      due_date: ng.due || null, created_by: user.id,
      author_name: profile?.display_name?.trim() || null,
    });
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    setAdding(false); setNg({ title: "", target: "", unit: "", play: "", due: "" });
    toast("On the board");
  };

  const active = rows.filter((g) => g.status === "active");
  const settled = rows.filter((g) => g.status !== "active");

  return (
    <div className="adm-sec" id="goals">
      <div className="sec">Goals{active.length > 0 && <span className="adm-pill">{active.length}</span>}</div>
      <p className="h-sub" style={{ marginBottom: 12 }}>
        The strategy&rsquo;s scoreboard — the Phase 1→2 conditions live here. Log the numbers, argue on the thread; the doc revs when a goal changes what&rsquo;s true.
      </p>

      {!loaded && <div className="dops-empty">Loading the board…</div>}
      {loaded && rows.length === 0 && <div className="dops-empty">No goals yet — put a number on the wall.</div>}

      {active.map((g) => {
        const pct = Math.max(0, Math.min(100, (g.current_value / g.target_value) * 100));
        const reached = g.current_value >= g.target_value;
        return (
          <div className="goal-card" key={g.id}>
            <div className="goal-top">
              <span className="goal-title">{g.title}</span>
              {g.play && <span className="goal-play">{g.play}</span>}
            </div>
            {g.metric && <p className="goal-metric">{g.metric}</p>}
            <div className={`goal-bar${reached ? " hit" : ""}`}><i style={{ width: `${pct}%` }} /></div>
            <div className="goal-nums">
              <span><b>{g.current_value}</b>{g.unit && ` ${g.unit}`} of <b>{g.target_value}</b>{g.unit && ` ${g.unit}`}</span>
              <span>{g.due_date ? `by ${new Date(`${g.due_date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : g.source ? "standing" : ""}</span>
            </div>
            <div className="goal-actions">
              {canLead && (logging === g.id ? (
                <span className="goal-log">
                  <input className="auth-input" inputMode="decimal" autoFocus value={logVal}
                    onChange={(e) => setLogVal(e.target.value)} placeholder={String(g.current_value)}
                    onKeyDown={(e) => { if (e.key === "Enter") logProgress(g); if (e.key === "Escape") setLogging(null); }} />
                  <button type="button" className="dops-mini" onClick={() => logProgress(g)}>Log</button>
                </span>
              ) : (
                <button type="button" className="st-discuss" onClick={() => { setLogging(g.id); setLogVal(""); }}>＋ Log progress</button>
              ))}
              {canLead && reached && <button type="button" className="st-discuss" onClick={() => setStatus(g, "hit")}>✓ Mark hit</button>}
              <button type="button" className="st-discuss" onClick={() => setOpen(open === g.id ? null : g.id)} aria-expanded={open === g.id}>💬 {open === g.id ? "Close" : "Discuss"}</button>
            </div>
            {open === g.id && <StrategyThread k={`goal:${g.id}`} label={`Goal: ${g.title}`} />}
          </div>
        );
      })}

      {canLead && (adding ? (
        <div className="goal-new">
          <input className="auth-input" value={ng.title} onChange={(e) => setNg({ ...ng, title: e.target.value })} placeholder="The goal, plain English — e.g. Wholesale accounts signed" maxLength={80} />
          <div className="goal-new-row">
            <input className="auth-input" inputMode="decimal" value={ng.target} onChange={(e) => setNg({ ...ng, target: e.target.value })} placeholder="Target (number)" />
            <input className="auth-input" value={ng.unit} onChange={(e) => setNg({ ...ng, unit: e.target.value })} placeholder="Unit — $/mo, %, orders" maxLength={16} />
          </div>
          <div className="goal-new-row">
            <input className="auth-input" value={ng.play} onChange={(e) => setNg({ ...ng, play: e.target.value })} placeholder="Which play it serves (optional)" maxLength={60} />
            <input className="auth-input" type="date" value={ng.due} onChange={(e) => setNg({ ...ng, due: e.target.value })} aria-label="Due date" />
          </div>
          <div className="st-log-btns">
            <button type="button" className="dops-mini" onClick={addGoal}>Put it on the board</button>
            <button type="button" className="st-discuss" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="dl-card st-build" onClick={() => setAdding(true)}>
          <b>＋ New goal</b>
          <span>A number, a date, a play it serves — then work it on the thread.</span>
        </button>
      ))}

      {settled.length > 0 && (
        <div className="goal-settled">
          <div className="dops-up-h">Settled · {settled.length}</div>
          {settled.map((g) => (
            <div className="dops-up-row" key={g.id}>
              <span><b>{g.title}</b> — {g.current_value}{g.unit && ` ${g.unit}`} of {g.target_value}{g.unit && ` ${g.unit}`}</span>
              <span className={`goal-chip ${g.status}`}>{g.status === "hit" ? "✓ hit" : g.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
