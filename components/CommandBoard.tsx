"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { useRealtimeTable } from "@/lib/realtime";
import MoneyKpis from "./MoneyKpis";
import LaunchReadiness from "./LaunchReadiness";
import { useTaskSheet } from "./TaskSheet";
import { SectionHeader, InfoRow } from "@/components/kit";
import InlineCreate from "./InlineCreate";
import Sheet from "@/components/Sheet";

// COMMAND BOARD — the shared war room both founders see: the launch initiatives with a countdown and
// milestone progress, then This Week · Blockers · Done · Money in one glance. This is the digital twin
// of the physical magnetic board — one screen that answers "are we on track?" instead of a text thread.
// Reads across BOTH task engines (todos + event_tasks) + incidents + initiatives; every query is
// defensive (fails to empty). Admins (the owners) manage initiatives + milestones.
type Initiative = { id: string; title: string; summary: string | null; target_date: string | null; status: string; emoji: string | null };
type Milestone = { id: string; initiative_id: string; title: string; due_on: string | null; done: boolean; workstream: string | null; sort: number };
type Work = { id: string; title: string; due: string | null; src: "todo" | "task" };
type Incident = { id: string; problem: string; severity: string; created_at: string };

const todayKey = () => new Date().toISOString().slice(0, 10);
const weekAheadKey = () => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); };
const weekAgoISO = () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString(); };
const daysTo = (iso: string) => Math.round((new Date(`${iso}T12:00:00`).getTime() - Date.now()) / 864e5);
const countdown = (iso: string | null) => { if (!iso) return ""; const d = daysTo(iso); return d > 1 ? `${d} days left` : d === 1 ? "tomorrow" : d === 0 ? "today" : `${-d}d overdue`; };
const dnice = (iso: string | null) => iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const localYMD = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const toWork = (rows: any[], src: "todo" | "task"): Work[] => rows.map((r) => ({ id: r.id, title: r.title ?? r.label ?? "—", due: r.due_on ?? (r.due_at ? localYMD(String(r.due_at)) : null), src }));

export default function CommandBoard() {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const isAdmin = !!profile?.is_admin;
  const [inits, setInits] = useState<Initiative[]>([]);
  const [miles, setMiles] = useState<Milestone[]>([]);
  const [week, setWeek] = useState<Work[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [overdue, setOverdue] = useState<Work[]>([]);
  const [done, setDone] = useState<Work[]>([]);
  const { openTask } = useTaskSheet(); // the ONE task editor, on the spine
  const [links, setLinks] = useState<{ initiative_id: string; milestone_id: string }[]>([]);
  const [manage, setManage] = useState<Milestone | null>(null);   // milestone open in the manage sheet
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const safe = async (p: PromiseLike<{ data: any[] | null }>): Promise<any[]> => { try { return (await p).data ?? []; } catch { return []; } };
    const today = todayKey(), wk = weekAheadKey(), wago = weekAgoISO();
    const [ini, mil, lnk, tThis, eThis, inc, tOver, eOver, tDone, eDone] = await Promise.all([
      safe(supabase.from("initiatives").select("id, title, summary, target_date, status, emoji").neq("status", "done").order("target_date", { nullsFirst: false })),
      safe(supabase.from("initiative_milestones").select("id, initiative_id, title, due_on, done, workstream, sort").order("sort")),
      safe(supabase.from("initiative_milestone_links").select("initiative_id, milestone_id")),
      safe(supabase.from("todos").select("id, title, due_on").eq("done", false).not("due_on", "is", null).gte("due_on", today).lte("due_on", wk)),
      safe(supabase.from("event_tasks").select("id, label, due_at").eq("done", false).not("due_at", "is", null).gte("due_at", today).lte("due_at", `${wk}T23:59:59`)),
      safe(supabase.from("incident_log").select("id, problem, severity, created_at").eq("resolved", false).eq("severity", "blocker").order("created_at", { ascending: false })),
      safe(supabase.from("todos").select("id, title, due_on").eq("done", false).not("due_on", "is", null).lt("due_on", today)),
      safe(supabase.from("event_tasks").select("id, label, due_at").eq("done", false).not("due_at", "is", null).lt("due_at", today)),
      safe(supabase.from("todos").select("id, title, due_on, done_at").eq("done", true).gte("done_at", wago)),
      safe(supabase.from("event_tasks").select("id, label, due_at, done_at").eq("done", true).gte("done_at", wago)),
    ]);
    setInits(ini as Initiative[]);
    setMiles(mil as Milestone[]);
    setLinks(lnk as { initiative_id: string; milestone_id: string }[]);
    setWeek([...toWork(tThis, "todo"), ...toWork(eThis, "task")].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")));
    setIncidents(inc as Incident[]);
    setOverdue([...toWork(tOver, "todo"), ...toWork(eOver, "task")].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")));
    setDone([...toWork(tDone, "todo"), ...toWork(eDone, "task")]);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["initiatives", "initiative_milestones", "initiative_milestone_links", "todos", "event_tasks", "incident_log"], load);

  const mById = useMemo(() => new Map(miles.map((m) => [m.id, m])), [miles]);
  // Placement now comes from the many-to-many links (a milestone can sit under several initiatives).
  // Any milestone with no link at all still shows under its created-under initiative_id (defensive).
  const milesByInit = useMemo(() => {
    const m = new Map<string, Milestone[]>();
    const push = (initId: string, ms: Milestone) => (m.get(initId) ?? m.set(initId, []).get(initId)!).push(ms);
    for (const l of links) { const ms = mById.get(l.milestone_id); if (ms) push(l.initiative_id, ms); }
    for (const ms of miles) { if (ms.initiative_id && !links.some((l) => l.milestone_id === ms.id)) push(ms.initiative_id, ms); }
    return m;
  }, [links, miles, mById]);

  const toggleMile = async (m: Milestone) => {
    if (!supabase || !isAdmin) return;
    setMiles((p) => p.map((x) => (x.id === m.id ? { ...x, done: !x.done } : x)));
    await supabase.from("initiative_milestones").update({ done: !m.done, done_at: !m.done ? new Date().toISOString() : null }).eq("id", m.id);
  };
  const createInit = async (title: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("initiatives").insert({ title, status: "active", created_by: user?.id ?? null });
    if (error) toast(`Couldn't add — ${error.message}`, "error"); else { toast("Initiative added"); load(); }
  };
  const addMilestone = async (initId: string, title: string) => {
    if (!supabase) return;
    const n = (milesByInit.get(initId) ?? []).length;
    const { data, error } = await supabase.from("initiative_milestones").insert({ initiative_id: initId, title, sort: n }).select("id").single();
    if (error || !data) { toast(`Couldn't add — ${error?.message ?? "error"}`, "error"); return; }
    await supabase.from("initiative_milestone_links").insert({ initiative_id: initId, milestone_id: (data as { id: string }).id });
    load();
  };
  // Tie/untie a milestone to an initiative — this is BOTH "move" and "tie to multiple" in one control.
  const toggleLink = async (mId: string, initId: string, on: boolean) => {
    if (!supabase) return;
    setLinks((p) => (on ? [...p, { initiative_id: initId, milestone_id: mId }] : p.filter((l) => !(l.initiative_id === initId && l.milestone_id === mId))));
    if (on) await supabase.from("initiative_milestone_links").insert({ initiative_id: initId, milestone_id: mId });
    else await supabase.from("initiative_milestone_links").delete().eq("initiative_id", initId).eq("milestone_id", mId);
  };
  const saveMile = async (m: Milestone, patch: Partial<Milestone>) => {
    if (!supabase) return;
    setMiles((p) => p.map((x) => (x.id === m.id ? { ...x, ...patch } : x)));
    await supabase.from("initiative_milestones").update(patch).eq("id", m.id);
  };
  const deleteMile = async (m: Milestone) => {
    if (!supabase || (typeof window !== "undefined" && !window.confirm(`Delete "${m.title}"?`))) return;
    await supabase.from("initiative_milestones").delete().eq("id", m.id);   // cascades its links
    setManage(null); load();
  };

  if (!loaded) return <div className="cmd-empty">Loading the board…</div>;

  const cap = (a: Work[], n = 8) => ({ shown: a.slice(0, n), more: Math.max(0, a.length - n) });
  const wk = cap(week), ov = cap(overdue), dn = cap(done, 6);

  return (
    <div className="cmd">
      {/* ── Initiatives · the launch ── */}
      <SectionHeader label="Initiatives" annotation="the launch" />
      {inits.length === 0 && !isAdmin && <div className="cmd-empty">No active initiatives.</div>}
      {inits.map((it) => {
        const ms = (milesByInit.get(it.id) ?? []).slice().sort((a, b) => a.sort - b.sort);
        const doneN = ms.filter((m) => m.done).length;
        const pct = ms.length ? Math.round((doneN / ms.length) * 100) : 0;
        const cd = it.target_date ? countdown(it.target_date) : "";
        const late = it.target_date ? daysTo(it.target_date) < 0 : false;
        return (
          <div className="cmd-init" key={it.id}>
            <div className="k-rows">
              <InfoRow
                name={<>{it.emoji ? `${it.emoji} ` : ""}{it.title}</>}
                sub={it.summary || undefined}
                trailing={it.target_date ? <span className={`cmd-cd${late ? " late" : ""}`}>{dnice(it.target_date)} · {cd}</span> : undefined}
              />
            </div>
            <div className="cmd-prog"><span className="cmd-prog-bar"><span style={{ width: `${pct}%` }} /></span><span className="cmd-prog-n">{doneN}/{ms.length} · {pct}%</span></div>
            {ms.length > 0 && (
              <div className="k-rows">
                {ms.map((m) => {
                  const mlate = !m.done && m.due_on && daysTo(m.due_on) < 0;
                  const ties = links.filter((l) => l.milestone_id === m.id).length;
                  const trailing = (ties > 1 || m.workstream || m.due_on || isAdmin) ? (
                    <>
                      {ties > 1 && <span className="cmd-tie" title={`Tied to ${ties} initiatives`}>⧉{ties}</span>}
                      {m.workstream && <span className="cmd-ws">{m.workstream}</span>}
                      {m.due_on && <span className={`cmd-mile-due${mlate ? " late" : ""}`}>{dnice(m.due_on)}</span>}
                      {isAdmin && <button type="button" className="cmd-mile-mng" onClick={() => setManage(m)} aria-label="Manage milestone">⋯</button>}
                    </>
                  ) : undefined;
                  return (
                    <InfoRow
                      key={m.id}
                      name={
                        <>
                          <span className={`cmd-check${m.done ? " on" : ""}`} aria-hidden>{m.done ? "✓" : ""}</span>
                          <span className="cmd-mile-t" style={{ fontWeight: 400, ...(m.done ? { textDecoration: "line-through", color: "var(--cream-m)" } : {}) }}>{m.title}</span>
                        </>
                      }
                      trailing={trailing}
                      bodyClick={isAdmin ? () => toggleMile(m) : undefined}
                      ariaLabel={m.title}
                    />
                  );
                })}
              </div>
            )}
            {isAdmin && <InlineCreate label="+ Milestone" placeholder="Milestone" className="cmd-add" onCreate={(t) => addMilestone(it.id, t)} />}
          </div>
        );
      })}
      {isAdmin && <InlineCreate label="+ New initiative" placeholder="Initiative name" className="cmd-add big" onCreate={createInit} />}

      {/* ── Launch readiness · go/no-go ── */}
      <LaunchReadiness />

      {/* ── This Week ── */}
      <SectionHeader label="This week" annotation="due next 7 days" />
      {wk.shown.length === 0 ? <div className="cmd-empty">Nothing due in the next 7 days.</div> : (
        <div className="k-rows">
          {wk.shown.map((w) => (
            <InfoRow
              key={`${w.src}-${w.id}`}
              name={w.title}
              trailing={<span className="cmd-row-due">{dnice(w.due)}</span>}
              onClick={() => openTask(w.id, w.src === "task" ? "event" : "todo")}
              ariaLabel={`Open task: ${w.title}`}
            />
          ))}
          {wk.more > 0 && <div className="cmd-more">+{wk.more} more</div>}
        </div>
      )}

      {/* ── Blockers ── */}
      <SectionHeader label="Blockers" annotation="clear these first" />
      {incidents.length === 0 && ov.shown.length === 0 ? <div className="cmd-empty">Nothing blocked. 🟢</div> : (
        <div className="k-rows">
          {incidents.map((i) => <InfoRow key={i.id} name={<>🛑 {i.problem}</>} />)}
          {ov.shown.map((w) => (
            <InfoRow
              key={`ov-${w.src}-${w.id}`}
              name={w.title}
              trailing={<span className="cmd-row-due late">{dnice(w.due)} · overdue</span>}
              onClick={() => openTask(w.id, w.src === "task" ? "event" : "todo")}
              ariaLabel={`Open task: ${w.title}`}
            />
          ))}
          {ov.more > 0 && <div className="cmd-more">+{ov.more} more overdue</div>}
        </div>
      )}

      {/* ── Done this week ── */}
      <SectionHeader label="Done this week" annotation="wrapped" />
      {dn.shown.length === 0 ? <div className="cmd-empty">Nothing wrapped yet this week.</div> : (
        <div className="k-rows">
          {dn.shown.map((w) => <InfoRow key={`dn-${w.src}-${w.id}`} name={<span style={{ textDecoration: "line-through", color: "var(--cream-d)" }}>{w.title}</span>} />)}
          {dn.more > 0 && <div className="cmd-more">+{dn.more} more done</div>}
        </div>
      )}

      {/* ── Money ── */}
      <SectionHeader label="Money" annotation="the number" />
      <MoneyKpis />

      {manage && (
        <MilestoneManage
          key={manage.id}
          m={manage}
          initiatives={inits}
          linkedIds={links.filter((l) => l.milestone_id === manage.id).map((l) => l.initiative_id)}
          onToggleLink={(initId, on) => toggleLink(manage.id, initId, on)}
          onSave={(patch) => saveMile(manage, patch)}
          onDelete={() => deleteMile(manage)}
          onClose={() => setManage(null)}
        />
      )}
    </div>
  );
}

// Manage a milestone: rename / re-date / retag, then MOVE or TIE it across initiatives via checkboxes
// (checking several = tied to several — one control for both), or delete it. Admins only.
function MilestoneManage({ m, initiatives, linkedIds, onToggleLink, onSave, onDelete, onClose }: {
  m: Milestone; initiatives: Initiative[]; linkedIds: string[];
  onToggleLink: (initId: string, on: boolean) => void; onSave: (patch: Partial<Milestone>) => void; onDelete: () => void; onClose: () => void;
}) {
  const [title, setTitle] = useState(m.title);
  const [due, setDue] = useState(m.due_on ?? "");
  const [ws, setWs] = useState(m.workstream ?? "");
  const linked = new Set(linkedIds);
  const saveEdits = () => { const patch: Partial<Milestone> = {}; if (title.trim() && title !== m.title) patch.title = title.trim(); if ((due || null) !== m.due_on) patch.due_on = due || null; if ((ws.trim() || null) !== m.workstream) patch.workstream = ws.trim() || null; if (Object.keys(patch).length) onSave(patch); onClose(); };
  return (
    <Sheet open onClose={onClose} label="Manage milestone" header={<div className="oa-kicker">Milestone</div>}>
      <label className="prod-f"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></label>
      <div className="prod-grid" style={{ marginTop: 8 }}>
        <label className="prod-f"><span>Due</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <label className="prod-f"><span>Workstream</span><input value={ws} onChange={(e) => setWs(e.target.value)} placeholder="content · events · delivery…" /></label>
      </div>
      <div className="cmd-mng-h">Tied to — check every initiative this belongs to</div>
      <div className="cmd-mng-inits">
        {initiatives.map((it) => (
          <label key={it.id} className="cmd-mng-init">
            <input type="checkbox" checked={linked.has(it.id)} onChange={(e) => onToggleLink(it.id, e.target.checked)} />
            <span>{it.emoji ? `${it.emoji} ` : ""}{it.title}</span>
          </label>
        ))}
      </div>
      <div className="prod-actions" style={{ marginTop: 14, justifyContent: "space-between" }}>
        <button type="button" className="note-arch" onClick={onDelete}>Delete</button>
        <button type="button" className="note-save" onClick={saveEdits}>Save</button>
      </div>
    </Sheet>
  );
}
