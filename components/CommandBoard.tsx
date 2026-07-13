"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { useRealtimeTable } from "@/lib/realtime";
import MoneyKpis from "./MoneyKpis";
import InlineCreate from "./InlineCreate";

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
const toWork = (rows: any[], src: "todo" | "task"): Work[] => rows.map((r) => ({ id: r.id, title: r.title ?? r.label ?? "—", due: r.due_on ?? (r.due_at ? String(r.due_at).slice(0, 10) : null), src }));

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
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const safe = async (p: PromiseLike<{ data: any[] | null }>): Promise<any[]> => { try { return (await p).data ?? []; } catch { return []; } };
    const today = todayKey(), wk = weekAheadKey(), wago = weekAgoISO();
    const [ini, mil, tThis, eThis, inc, tOver, eOver, tDone, eDone] = await Promise.all([
      safe(supabase.from("initiatives").select("id, title, summary, target_date, status, emoji").neq("status", "done").order("target_date", { nullsFirst: false })),
      safe(supabase.from("initiative_milestones").select("id, initiative_id, title, due_on, done, workstream, sort").order("sort")),
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
    setWeek([...toWork(tThis, "todo"), ...toWork(eThis, "task")].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")));
    setIncidents(inc as Incident[]);
    setOverdue([...toWork(tOver, "todo"), ...toWork(eOver, "task")].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")));
    setDone([...toWork(tDone, "todo"), ...toWork(eDone, "task")]);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["initiatives", "initiative_milestones", "todos", "event_tasks", "incident_log"], load);

  const milesByInit = useMemo(() => {
    const m = new Map<string, Milestone[]>();
    for (const x of miles) (m.get(x.initiative_id) ?? m.set(x.initiative_id, []).get(x.initiative_id)!).push(x);
    return m;
  }, [miles]);

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
    const n = miles.filter((x) => x.initiative_id === initId).length;
    const { error } = await supabase.from("initiative_milestones").insert({ initiative_id: initId, title, sort: n });
    if (error) toast(`Couldn't add — ${error.message}`, "error"); else load();
  };

  if (!loaded) return <div className="cmd-empty">Loading the board…</div>;

  const cap = (a: Work[], n = 8) => ({ shown: a.slice(0, n), more: Math.max(0, a.length - n) });
  const wk = cap(week), ov = cap(overdue), dn = cap(done, 6);

  return (
    <div className="cmd">
      {/* ── Initiatives · the launch ── */}
      <div className="crew-group">Initiatives</div>
      {inits.length === 0 && !isAdmin && <div className="cmd-empty">No active initiatives.</div>}
      {inits.map((it) => {
        const ms = (milesByInit.get(it.id) ?? []).slice().sort((a, b) => a.sort - b.sort);
        const doneN = ms.filter((m) => m.done).length;
        const pct = ms.length ? Math.round((doneN / ms.length) * 100) : 0;
        const cd = it.target_date ? countdown(it.target_date) : "";
        const late = it.target_date ? daysTo(it.target_date) < 0 : false;
        return (
          <div className="cmd-init" key={it.id}>
            <div className="cmd-init-h">
              <b>{it.emoji ? `${it.emoji} ` : ""}{it.title}</b>
              {it.target_date && <span className={`cmd-cd${late ? " late" : ""}`}>{dnice(it.target_date)} · {cd}</span>}
            </div>
            {it.summary && <p className="cmd-init-sum">{it.summary}</p>}
            <div className="cmd-prog"><span className="cmd-prog-bar"><span style={{ width: `${pct}%` }} /></span><span className="cmd-prog-n">{doneN}/{ms.length} · {pct}%</span></div>
            <div className="cmd-miles">
              {ms.map((m) => {
                const mlate = !m.done && m.due_on && daysTo(m.due_on) < 0;
                return (
                  <button key={m.id} type="button" className={`cmd-mile${m.done ? " done" : ""}`} onClick={() => toggleMile(m)} disabled={!isAdmin} aria-pressed={m.done}>
                    <span className={`cmd-check${m.done ? " on" : ""}`} aria-hidden>{m.done ? "✓" : ""}</span>
                    <span className="cmd-mile-t">{m.title}</span>
                    {m.workstream && <span className="cmd-ws">{m.workstream}</span>}
                    {m.due_on && <span className={`cmd-mile-due${mlate ? " late" : ""}`}>{dnice(m.due_on)}</span>}
                  </button>
                );
              })}
            </div>
            {isAdmin && <InlineCreate label="+ Milestone" placeholder="Milestone" className="cmd-add" onCreate={(t) => addMilestone(it.id, t)} />}
          </div>
        );
      })}
      {isAdmin && <InlineCreate label="+ New initiative" placeholder="Initiative name" className="cmd-add big" onCreate={createInit} />}

      {/* ── This Week ── */}
      <div className="crew-group">This week</div>
      {wk.shown.length === 0 ? <div className="cmd-empty">Nothing due in the next 7 days.</div> : (
        <div className="cmd-list">
          {wk.shown.map((w) => <div className="cmd-row" key={`${w.src}-${w.id}`}><span className="cmd-row-t">{w.title}</span><span className="cmd-row-due">{dnice(w.due)}</span></div>)}
          {wk.more > 0 && <div className="cmd-more">+{wk.more} more</div>}
        </div>
      )}

      {/* ── Blockers ── */}
      <div className="crew-group">Blockers</div>
      {incidents.length === 0 && ov.shown.length === 0 ? <div className="cmd-empty">Nothing blocked. 🟢</div> : (
        <div className="cmd-list">
          {incidents.map((i) => <div className="cmd-row blk" key={i.id}><span className="cmd-row-t">🛑 {i.problem}</span></div>)}
          {ov.shown.map((w) => <div className="cmd-row blk" key={`ov-${w.src}-${w.id}`}><span className="cmd-row-t">{w.title}</span><span className="cmd-row-due late">{dnice(w.due)} · overdue</span></div>)}
          {ov.more > 0 && <div className="cmd-more">+{ov.more} more overdue</div>}
        </div>
      )}

      {/* ── Done this week ── */}
      <div className="crew-group">Done this week</div>
      {dn.shown.length === 0 ? <div className="cmd-empty">Nothing wrapped yet this week.</div> : (
        <div className="cmd-list">
          {dn.shown.map((w) => <div className="cmd-row done" key={`dn-${w.src}-${w.id}`}><span className="cmd-row-t">{w.title}</span></div>)}
          {dn.more > 0 && <div className="cmd-more">+{dn.more} more done</div>}
        </div>
      )}

      {/* ── Money ── */}
      <div className="crew-group">Money</div>
      <MoneyKpis />
    </div>
  );
}
