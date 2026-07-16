"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useApp } from "./AppProvider";
import { useAuth, roleOf, LEADERSHIP_ROLES } from "./AuthProvider";
import { useWorkStreams } from "@/lib/streams";
import { METRIC_SOURCES, computeMetric } from "@/lib/goalMetrics";
import { raiseAlertClient } from "@/lib/clientAlerts";
import { updateTask, deleteTask, createEventTask } from "@/lib/tasks";
import { StrategyThread } from "./StrategyCollab";
import { SectionHeader } from "@/components/kit";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "@/components/Icon";

// GOALS — the true tracker (0163/0164). Three layers, top down:
//   lane → goal → moves.
// Every goal rolls up to a work stream; a metric-bound goal reads its number LIVE from real
// orders. Moves are event_tasks rows owned by goal_id (0049's meeting-note precedent), so an
// assigned move pings its owner, lands in their My Tasks, rides the task-due ladder, and shows
// on the calendar — the ONE task engine, not a second one. Fetch state via useAsyncData — a failed
// load is a real error now, not a silent "No goals yet". Every mutation below used to patch local
// state optimistically with no server round-trip check (several had no reload at all); useAsyncData
// exposes no setter, so each one now awaits its write, then reload()s the real board.

type Goal = {
  id: string; title: string; metric: string | null; unit: string;
  target_value: number; current_value: number; due_date: string | null;
  play: string | null; source: string | null; status: "active" | "hit" | "missed" | "archived";
  author_name: string | null; updated_at: string;
  stream_key: string | null; metric_source: string | null; owner_user_id: string | null;
  horizon: "strategic" | "tactical" | "operational";
};
type Move = { id: string; goal_id: string; label: string; done: boolean; assignee: string | null; due_at: string | null; sort: number };
type Staff = { id: string; display_name: string | null };
type Board = { rows: Goal[]; inits: Move[]; staff: Staff[] };

export default function Goals() {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const streams = useWorkStreams();
  const [live, setLive] = useState<Record<string, number>>({});   // metric_source → live value
  const [open, setOpen] = useState<string | null>(null);          // which thread is open
  const [logging, setLogging] = useState<string | null>(null);
  const [logVal, setLogVal] = useState("");
  const [initFor, setInitFor] = useState<string | null>(null);    // which goal shows the add-initiative input
  const [initTitle, setInitTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);
  const [ng, setNg] = useState({ title: "", target: "", unit: "", play: "", due: "", stream: "business", source: "" });
  // Edit + archive (2026-07-16) — a goal could be created and have its owner/lane/progress changed,
  // but never its own title/description/target/unit/due date, and never removed. Confirmed gap from
  // the crew-console audit; "archive" (not a hard delete) matches the status column that already had
  // an unused 'archived' value and the query that already excludes it (line ~57) — the plumbing was
  // half there, just no button called it.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eg, setEg] = useState({ title: "", metric: "", target: "", unit: "", due: "", play: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const canLead = LEADERSHIP_ROLES.includes(roleOf(profile)) || !!profile?.is_admin;

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { rows: [], inits: [], staff: [] };
    const [g, i, st] = await Promise.all([
      supabase.from("goals").select("*").neq("status", "archived")
        .order("status").order("due_date", { ascending: true, nullsFirst: false }).order("created_at"),
      supabase.from("event_tasks").select("id, goal_id, label, done, assignee, due_at, sort").not("goal_id", "is", null).order("sort").order("created_at"),
      supabase.from("profiles").select("id, display_name").neq("role", "member").order("display_name"),
    ]);
    const firstErr = [g, i, st].find((x) => x.error)?.error;
    if (firstErr) throw new Error(firstErr.message);
    return { rows: (g.data as Goal[]) ?? [], inits: (i.data as Move[]) ?? [], staff: (st.data as Staff[]) ?? [] };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  useRealtimeTable(["goals", "event_tasks"], reload);
  const rows = board.data?.rows ?? [];
  const inits = board.data?.inits ?? [];
  const staff = board.data?.staff ?? [];

  // Live metrics: compute each bound source once, show it, and (leadership only) write it back so
  // reports and escalation read the same number the board shows.
  useEffect(() => {
    const sources = [...new Set(rows.map((g) => g.metric_source).filter(Boolean))] as string[];
    if (!sources.length) return;
    Promise.all(sources.map(async (s) => [s, await computeMetric(s)] as const)).then((pairs) => {
      const m: Record<string, number> = {};
      for (const [s, v] of pairs) if (v != null) m[s] = v;
      setLive(m);
      if (canLead && supabase) {
        for (const g of rows) {
          const v = g.metric_source ? m[g.metric_source] : undefined;
          if (v != null && v !== g.current_value) supabase.from("goals").update({ current_value: v }).eq("id", g.id);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((g) => `${g.id}:${g.metric_source}`).join("|")]);

  const logProgress = async (g: Goal) => {
    if (!supabase) return;
    const v = Number(logVal);
    if (!Number.isFinite(v) || v < 0) { toast("Numbers only — the bar does the talking", "error"); return; }
    setLogging(null); setLogVal("");
    const { error } = await supabase.from("goals").update({ current_value: v, updated_at: new Date().toISOString() }).eq("id", g.id);
    if (error) { toast(`Couldn't log it — ${error.message}`, "error"); reload(); return; }
    toast(v >= g.target_value ? "Logged — that's the target. Mark it hit when it holds." : "Progress logged");
    reload();
  };

  const setStatus = async (g: Goal, status: Goal["status"]) => {
    if (!supabase) return;
    const { error } = await supabase.from("goals").update({ status, updated_at: new Date().toISOString() }).eq("id", g.id);
    if (error) { toast(`Couldn't update — ${error.message}`, "error"); }
    else if (status === "hit") toast("Goal hit — log the decision on the Playbook");
    else if (status === "archived") toast("Archived — off the board");
    reload();
  };

  // The fields nothing else here can touch: title, description, target, unit, due date. Owner/lane/
  // horizon/progress already had their own controls — this is the rest of "edit a goal."
  const startEdit = (g: Goal) => {
    setEditingId(g.id);
    setEg({ title: g.title, metric: g.metric ?? "", target: String(g.target_value), unit: g.unit ?? "", due: g.due_date ?? "", play: g.play ?? "" });
  };
  const saveEdit = async (g: Goal) => {
    if (!supabase || savingEdit) return;
    const target = Number(eg.target);
    if (!eg.title.trim() || !Number.isFinite(target) || target <= 0) { toast("A goal needs a name and a real target", "error"); return; }
    setSavingEdit(true);
    const { error } = await supabase.from("goals").update({
      title: eg.title.trim(), metric: eg.metric.trim() || null, target_value: target,
      unit: g.metric_source ? g.unit : eg.unit.trim(), // a live-bound goal's unit comes from its metric source, not free text
      due_date: eg.due || null, play: eg.play.trim() || null, updated_at: new Date().toISOString(),
    }).eq("id", g.id);
    setSavingEdit(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    setEditingId(null);
    toast("Goal updated");
    reload();
  };
  const archiveGoal = (g: Goal) => { setEditingId(null); setStatus(g, "archived"); };

  const setStream = async (g: Goal, stream_key: string) => {
    if (!supabase) return;
    await supabase.from("goals").update({ stream_key }).eq("id", g.id);
    reload();
  };

  // Every objective gets ONE accountable owner (distinct from the people doing the individual moves).
  const setOwner = async (g: Goal, uid: string) => {
    if (!supabase) return;
    await supabase.from("goals").update({ owner_user_id: uid || null, updated_at: new Date().toISOString() }).eq("id", g.id);
    reload();
  };

  // Planning altitude: strategic (big bets) / tactical (moves) / operational (day-to-day).
  const setHorizon = async (g: Goal, horizon: string) => {
    if (!supabase) return;
    await supabase.from("goals").update({ horizon, updated_at: new Date().toISOString() }).eq("id", g.id);
    reload();
  };

  const addInitiative = async (goalId: string) => {
    if (!supabase || !initTitle.trim()) return;
    const label = initTitle.trim();
    // ONE write path (lib/tasks) — createEventTask closes the last gap: every other write here
    // already had a lib/tasks helper; creating a move was the one insert with no home yet.
    const { error } = await createEventTask({ goalId, label, kind: "task", sort: inits.filter((i) => i.goal_id === goalId).length });
    if (error) { toast(`Couldn't add — ${error}`, "error"); return; }
    setInitTitle("");
    reload();
  };
  const toggleInitiative = async (i: Move) => {
    if (!supabase) return;
    await updateTask("event", i.id, { done: !i.done }, user?.id);   // ONE write path (lib/tasks)
    reload();
  };
  const removeInitiative = async (i: Move) => {
    if (!supabase) return;
    await deleteTask("event", i.id);   // ONE write path (lib/tasks)
    reload();
  };
  // Assigning a move works exactly like assigning prep: the owner gets a targeted ping and the
  // move appears in THEIR My Tasks (same rows, same engine).
  const assignMove = async (i: Move, goalTitle: string, uid: string) => {
    if (!supabase) return;
    await updateTask("event", i.id, { assignee: uid || null });   // ONE write path (lib/tasks)
    if (uid && uid !== user?.id) {
      raiseAlertClient({ severity: "critical", category: "task", kind: "task_assigned", subjectId: i.id, title: `Assigned to you: ${i.label}`.slice(0, 140), body: `Goal: ${goalTitle}`, link: "/crew?s=day", targetUserId: uid });
    }
    reload();
  };
  const dueMove = async (i: Move, v: string) => {
    if (!supabase) return;
    const due_at = v ? new Date(`${v}T23:59:59`).toISOString() : null;
    await updateTask("event", i.id, { dueISO: due_at });   // ONE write path (lib/tasks)
    reload();
  };
  const firstName = (uid: string | null) => (staff.find((s) => s.id === uid)?.display_name || "").trim().split(/\s+/)[0] || null;

  const addGoal = async () => {
    if (!supabase || !user || savingGoal) return;
    const target = Number(ng.target);
    if (!ng.title.trim() || !Number.isFinite(target) || target <= 0) { toast("A goal needs a name and a real target", "error"); return; }
    const src = ng.source || null;
    setSavingGoal(true);
    const { error } = await supabase.from("goals").insert({
      title: ng.title.trim(), target_value: target,
      unit: src ? METRIC_SOURCES[src].unit : ng.unit.trim(),
      play: ng.play.trim() || null, due_date: ng.due || null,
      stream_key: ng.stream, metric_source: src,
      created_by: user.id, author_name: profile?.display_name?.trim() || null,
    });
    setSavingGoal(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    setAdding(false); setNg({ title: "", target: "", unit: "", play: "", due: "", stream: "business", source: "" });
    toast("On the board");
    reload();
  };

  const active = rows.filter((g) => g.status === "active");
  const settled = rows.filter((g) => g.status !== "active");
  const laneOf = (key: string | null) => streams.find((s) => s.key === (key || "business"));
  const groups = streams
    .map((s) => ({ s, goals: active.filter((g) => laneOf(g.stream_key)?.key === s.key) }))
    .filter((grp) => grp.goals.length > 0);
  const orphans = active.filter((g) => !laneOf(g.stream_key));

  const card = (g: Goal) => {
    const cur = (g.metric_source && live[g.metric_source] != null) ? live[g.metric_source] : g.current_value;
    const pct = g.target_value > 0 ? Math.max(0, Math.min(100, (cur / g.target_value) * 100)) : 0;
    const reached = cur >= g.target_value;
    const goalInits = inits.filter((i) => i.goal_id === g.id);
    const doneN = goalInits.filter((i) => i.done).length;
    return (
      <div className="goal-card" key={g.id}>
        {editingId === g.id ? (
          <div className="goal-edit">
            <div className="goal-edit-h">Editing this goal</div>
            <input className="auth-input" value={eg.title} onChange={(e) => setEg({ ...eg, title: e.target.value })} placeholder="Goal title" maxLength={80} aria-label="Goal title" />
            <input className="auth-input" value={eg.metric} onChange={(e) => setEg({ ...eg, metric: e.target.value })} placeholder="Description (optional)" maxLength={140} aria-label="Description" />
            <div className="goal-new-row">
              <input className="auth-input" inputMode="decimal" value={eg.target} onChange={(e) => setEg({ ...eg, target: e.target.value })} placeholder="Target (number)" aria-label="Target" />
              {g.metric_source
                ? <input className="auth-input" value={eg.unit} disabled aria-label="Unit (set by the live metric)" />
                : <input className="auth-input" value={eg.unit} onChange={(e) => setEg({ ...eg, unit: e.target.value })} placeholder="Unit — $/mo, %, orders" maxLength={16} aria-label="Unit" />}
            </div>
            <div className="goal-new-row">
              <input className="auth-input" value={eg.play} onChange={(e) => setEg({ ...eg, play: e.target.value })} placeholder="Which play it serves (optional)" maxLength={60} aria-label="Play" />
              <input className="auth-input" type="date" value={eg.due} onChange={(e) => setEg({ ...eg, due: e.target.value })} aria-label="Due date" />
            </div>
            <div className="st-log-btns">
              <button type="button" className="dops-mini" onClick={() => saveEdit(g)} disabled={savingEdit}>{savingEdit ? "Saving…" : "Save"}</button>
              <button type="button" className="st-discuss" onClick={() => setEditingId(null)}>Cancel</button>
              <button type="button" className="st-discuss goal-archive" onClick={() => archiveGoal(g)}>Archive goal</button>
            </div>
          </div>
        ) : (
          <>
            <div className="goal-top">
              <span className="goal-title">{g.title}</span>
              {g.metric_source && <span className="goal-live" title={METRIC_SOURCES[g.metric_source]?.hint}>live</span>}
              {g.horizon && <span className={`goal-tier tier-${g.horizon}`}>{g.horizon}</span>}
              {g.play && <span className="goal-play">{g.play}</span>}
              {canLead && <button type="button" className="goal-edit-btn" onClick={() => startEdit(g)} aria-label={`Edit ${g.title}`}><Icon name="edit" size={12} /></button>}
            </div>
            {g.metric && <p className="goal-metric">{g.metric}</p>}
            <div className={`goal-bar${reached ? " hit" : ""}`}><i style={{ width: `${pct}%` }} /></div>
            <div className="goal-nums">
              <span><b>{cur}</b> of <b>{g.target_value}</b>{g.unit && ` ${g.unit}`}</span>
              <span>{goalInits.length > 0 && `${doneN}/${goalInits.length} moves · `}{g.due_date ? `by ${new Date(`${g.due_date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : g.source ? "standing" : ""}</span>
            </div>
          </>
        )}

        <div className="goal-owner">
          <span className="goal-owner-l">Owner</span>
          {canLead ? (
            <select className="goal-owner-sel" value={g.owner_user_id ?? ""} onChange={(e) => setOwner(g, e.target.value)} aria-label={`Owner of ${g.title}`}>
              <option value="">Unassigned</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.display_name || "Unnamed"}</option>)}
            </select>
          ) : (
            <span className="goal-owner-n">{firstName(g.owner_user_id) ?? "Unassigned"}</span>
          )}
          {canLead && (
            <select className="goal-owner-sel" value={g.horizon} onChange={(e) => setHorizon(g, e.target.value)} aria-label={`Horizon of ${g.title}`}>
              <option value="strategic">Strategic</option>
              <option value="tactical">Tactical</option>
              <option value="operational">Operational</option>
            </select>
          )}
        </div>

        {/* the breakdown — the concrete moves that accomplish this goal */}
        {(goalInits.length > 0 || initFor === g.id) && (
          <div className="goal-inits">
            {goalInits.map((i) => (
              <div key={i.id}>
                <div className={`goal-init${i.done ? " done" : ""}`}>
                  <button type="button" className="goal-init-ck" onClick={() => (canLead || i.assignee === user?.id) && toggleInitiative(i)} aria-pressed={i.done} disabled={!canLead && i.assignee !== user?.id}>{i.done ? <Icon name="check" /> : <Icon name="dotOutline" />}</button>
                  <span className="goal-init-t">{i.label}</span>
                  {!canLead && (i.assignee || i.due_at) && (
                    <span className="goal-init-who">{[firstName(i.assignee), i.due_at ? `due ${new Date(i.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : null].filter(Boolean).join(" · ")}</span>
                  )}
                  {canLead && <button type="button" className="goal-init-x" onClick={() => removeInitiative(i)} aria-label={`Remove ${i.label}`}><Icon name="close" /></button>}
                </div>
                {canLead && !i.done && (
                  <div className="goal-init-meta">
                    <select value={i.assignee ?? ""} onChange={(e) => assignMove(i, g.title, e.target.value)} aria-label={`Owner of ${i.label}`}>
                      <option value="">No owner</option>
                      {staff.map((s) => <option key={s.id} value={s.id}>{s.display_name || "Unnamed"}</option>)}
                    </select>
                    <input type="date" value={i.due_at ? i.due_at.slice(0, 10) : ""} onChange={(e) => dueMove(i, e.target.value)} aria-label={`Due date for ${i.label}`} />
                  </div>
                )}
              </div>
            ))}
            {initFor === g.id && (
              <div className="goal-init add">
                <input className="auth-input" autoFocus value={initTitle} onChange={(e) => setInitTitle(e.target.value)} placeholder="A concrete move — e.g. Pitch 3 wholesale accounts"
                  onKeyDown={(e) => { if (e.key === "Enter") addInitiative(g.id); if (e.key === "Escape") setInitFor(null); }} />
                <button type="button" className="dops-mini" onClick={() => addInitiative(g.id)}>Add</button>
              </div>
            )}
          </div>
        )}

        <div className="goal-actions">
          {canLead && !g.metric_source && (logging === g.id ? (
            <span className="goal-log">
              <input className="auth-input" inputMode="decimal" autoFocus value={logVal}
                onChange={(e) => setLogVal(e.target.value)} placeholder={String(g.current_value)}
                onKeyDown={(e) => { if (e.key === "Enter") logProgress(g); if (e.key === "Escape") setLogging(null); }} />
              <button type="button" className="dops-mini" onClick={() => logProgress(g)}>Log</button>
            </span>
          ) : (
            <button type="button" className="st-discuss" onClick={() => { setLogging(g.id); setLogVal(""); }}>＋ Log progress</button>
          ))}
          {canLead && <button type="button" className="st-discuss" onClick={() => { setInitFor(initFor === g.id ? null : g.id); setInitTitle(""); }}>{initFor === g.id ? "Done adding" : "＋ Break it down"}</button>}
          {canLead && reached && <button type="button" className="st-discuss" onClick={() => setStatus(g, "hit")}><Icon name="check" /> Mark hit</button>}
          <button type="button" className="st-discuss" onClick={() => setOpen(open === g.id ? null : g.id)} aria-expanded={open === g.id}><Icon name="chat" /> {open === g.id ? "Close" : "Discuss"}</button>
          {canLead && (
            <select className="goal-lane-pick" value={laneOf(g.stream_key)?.key ?? "business"} onChange={(e) => setStream(g, e.target.value)} aria-label={`Lane for ${g.title}`}>
              {streams.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          )}
        </div>
        {open === g.id && <StrategyThread k={`goal:${g.id}`} label={`Goal: ${g.title}`} />}
      </div>
    );
  };

  return (
    <div className="adm-sec" id="goals">
      <SectionHeader label="Goals" right={active.length > 0 && <span className="adm-pill">{active.length}</span>} />
      <p className="h-sub" style={{ marginBottom: 12 }}>Every goal is a number with a bar, filed to the lane that owns it. Break it into moves; talk it out on the thread.</p>

      <AsyncSection state={board} isEmpty={(data) => data.rows.length === 0} emptyTitle="No goals yet" emptySub="Put a number on the wall." errorTitle="Couldn't load the board" loadingLabel="Loading the board…">
        {() => (
          <>
            {groups.map(({ s, goals }) => (
              <div key={s.key} className="goal-lane">
                <div className="goal-lane-h"><span className="cc-dot" style={{ background: s.color }} /><b>{s.label}</b><span className="goal-lane-n">{goals.length}</span></div>
                {goals.map(card)}
              </div>
            ))}
            {orphans.length > 0 && (
              <div className="goal-lane">
                <div className="goal-lane-h"><span className="cc-dot" style={{ background: "#9a8f7c" }} /><b>Unfiled</b><span className="goal-lane-n">{orphans.length}</span></div>
                {orphans.map(card)}
              </div>
            )}
            {settled.length > 0 && (
              <div className="goal-settled">
                <div className="dops-up-h">Settled · {settled.length}</div>
                {settled.map((g) => (
                  <div className="dops-up-row" key={g.id}>
                    <span><b>{g.title}</b> — {g.current_value}{g.unit && ` ${g.unit}`} of {g.target_value}{g.unit && ` ${g.unit}`}</span>
                    <span className={`goal-chip ${g.status}`}>{g.status === "hit" ? <><Icon name="check" /> hit</> : g.status}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </AsyncSection>

      {canLead && (adding ? (
        <div className="goal-new">
          <input className="auth-input" value={ng.title} onChange={(e) => setNg({ ...ng, title: e.target.value })} placeholder="The goal, plain English — e.g. Wholesale accounts signed" maxLength={80} />
          <div className="goal-new-row">
            <input className="auth-input" inputMode="decimal" value={ng.target} onChange={(e) => setNg({ ...ng, target: e.target.value })} placeholder="Target (number)" />
            {ng.source ? <input className="auth-input" value={METRIC_SOURCES[ng.source].unit} disabled aria-label="Unit (set by the live metric)" />
              : <input className="auth-input" value={ng.unit} onChange={(e) => setNg({ ...ng, unit: e.target.value })} placeholder="Unit — $/mo, %, orders" maxLength={16} />}
          </div>
          <div className="goal-new-row">
            <select className="auth-input" value={ng.stream} onChange={(e) => setNg({ ...ng, stream: e.target.value })} aria-label="Lane">
              {streams.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select className="auth-input" value={ng.source} onChange={(e) => setNg({ ...ng, source: e.target.value })} aria-label="How it's measured">
              <option value="">Measured by hand (log progress)</option>
              {Object.entries(METRIC_SOURCES).map(([k, m]) => <option key={k} value={k}>Live: {m.label}</option>)}
            </select>
          </div>
          <div className="goal-new-row">
            <input className="auth-input" value={ng.play} onChange={(e) => setNg({ ...ng, play: e.target.value })} placeholder="Which play it serves (optional)" maxLength={60} />
            <input className="auth-input" type="date" value={ng.due} onChange={(e) => setNg({ ...ng, due: e.target.value })} aria-label="Due date" />
          </div>
          <div className="st-log-btns">
            <button type="button" className="dops-mini" onClick={addGoal} disabled={savingGoal}>{savingGoal ? "Putting it up…" : "Put it on the board"}</button>
            <button type="button" className="st-discuss" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="dl-card st-build" onClick={() => setAdding(true)}>
          <b>＋ New goal</b>
          <span>A number, a lane, a date — measured live from the data where it can be.</span>
        </button>
      ))}
    </div>
  );
}
