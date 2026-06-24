"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, roleOf } from "@/components/AuthProvider";
import { useOperatorSection } from "./OperatorNav";
import EventDayPlanner from "./EventDayPlanner";

// COMPANY CALENDAR — one pane for everything dated: truck events, admin/ops work, scheduled content
// (from Studio), and free-standing to-dos. Category-colored, filterable, click-through to source.
// Views: List · Week · Month · Quarter · Year. Owner can connect Outlook for two-way sync.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Ev = { id: string; title: string | null; day: string; day_label: string | null; is_live: boolean | null; category: string | null; plan_days: number | null };
type Content = { id: string; title: string; scheduled_for: string | null; status: string };
type Todo = { id: string; title: string; category: string; due_on: string | null; done: boolean; event_id: string | null; meeting_note_id: string | null };

const CAT: Record<string, { label: string; color: string }> = {
  admin: { label: "Admin", color: "#8b5cf6" }, ops: { label: "Ops", color: "#e0892b" },
  event: { label: "Events", color: "#6fa8dc" }, content: { label: "Content", color: "#2bb3a3" },
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDaysKey = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return key(d); };
const CAL_KEY = "gt3-company-cal-month";
const VIEW_KEY = "gt3-company-cal-view";
type View = "list" | "week" | "month" | "quarter" | "year";

type Item = { id: string; title: string; cat: string; kind: "event" | "content" | "todo"; done?: boolean; go: () => void; toggle?: () => void };

function gridMonth(cursor: Date): Date[] { const s = new Date(cursor.getFullYear(), cursor.getMonth(), 1); s.setDate(1 - s.getDay()); return Array.from({ length: 42 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d; }); }
function gridWeek(cursor: Date): Date[] { const s = new Date(cursor); s.setDate(cursor.getDate() - cursor.getDay()); return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d; }); }
const qStart = (cursor: Date) => Math.floor(cursor.getMonth() / 3) * 3;

export default function CompanyCalendar() {
  const { setSection } = useOperatorSection();
  const { profile } = useAuth();
  const isOwner = roleOf(profile) === "owner";
  const now = new Date();
  const todayKey = key(now);
  const [view, setView] = useState<View>(() => { if (typeof window !== "undefined") { const v = localStorage.getItem(VIEW_KEY) as View; if (v) return v; } return "month"; });
  const setV = (v: View) => { setView(v); if (typeof window !== "undefined") localStorage.setItem(VIEW_KEY, v); };
  const [cursor, setCursor] = useState(() => {
    if (typeof window !== "undefined") { const s = localStorage.getItem(CAL_KEY); if (s) { const [y, m] = s.split("-").map(Number); if (y && m) return new Date(y, m - 1, 1); } }
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const setCur = (d: Date) => { setCursor(d); if (typeof window !== "undefined") localStorage.setItem(CAL_KEY, `${d.getFullYear()}-${d.getMonth() + 1}`); };
  const [events, setEvents] = useState<Ev[]>([]);
  const [content, setContent] = useState<Content[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [addDay, setAddDay] = useState<string | null>(null);
  const [planEv, setPlanEv] = useState<{ id: string; title: string; day: string | null; plan_days: number; initialDay: number } | null>(null);
  const dragId = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  // The date window to load + render, by view.
  const range = useMemo(() => {
    if (view === "week") { const w = gridWeek(cursor); return { start: w[0], end: w[6] }; }
    if (view === "list") { const s = new Date(cursor.getFullYear(), cursor.getMonth(), 1); const e = new Date(s); e.setMonth(e.getMonth() + 3); e.setDate(0); return { start: s, end: e }; }
    if (view === "quarter") { const q = qStart(cursor); const s = new Date(cursor.getFullYear(), q, 1); const e = new Date(cursor.getFullYear(), q + 3, 0); return { start: s, end: e }; }
    if (view === "year") return { start: new Date(cursor.getFullYear(), 0, 1), end: new Date(cursor.getFullYear(), 11, 31) };
    const g = gridMonth(cursor); return { start: g[0], end: g[41] };
  }, [view, cursor]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const to = key(range.end);
    const eFrom = (() => { const d = new Date(range.start); d.setDate(d.getDate() - 31); return key(d); })(); // catch multi-day spillover
    const from = key(range.start);
    const [e, c, t] = await Promise.all([
      supabase.from("events").select("id, title, day, day_label, is_live, category, plan_days").is("archived_at", null).gte("day", eFrom).lte("day", to),
      supabase.from("content_items").select("id, title, scheduled_for, status").not("scheduled_for", "is", null).gte("scheduled_for", `${from}T00:00:00`).lte("scheduled_for", `${to}T23:59:59`),
      supabase.from("todos").select("id, title, category, due_on, done, event_id, meeting_note_id").not("due_on", "is", null).gte("due_on", from).lte("due_on", to),
    ]);
    setEvents((e.data as Ev[]) ?? []); setContent((c.data as Content[]) ?? []); setTodos((t.data as Todo[]) ?? []);
  }, [range]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel("company-cal")
      .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "content_items" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  const openEventPrep = (eventId: string) => { if (typeof window !== "undefined") localStorage.setItem("gt3-prep-open", eventId); setSection("prep"); };
  const openPlanner = (e: Ev, dayNo: number) => setPlanEv({ id: e.id, title: e.title || e.day_label || "Event", day: e.day, plan_days: Math.max(1, e.plan_days ?? 1), initialDay: dayNo });
  const toggleTodo = async (t: Todo) => {
    if (!supabase) return;
    setTodos((p) => p.map((x) => x.id === t.id ? { ...x, done: !x.done } : x));
    await supabase.from("todos").update({ done: !t.done, done_at: !t.done ? new Date().toISOString() : null }).eq("id", t.id);
  };
  const reschedule = async (id: string, dayKey: string) => {
    if (!supabase) return;
    setTodos((p) => p.map((x) => x.id === id ? { ...x, due_on: dayKey } : x));
    await supabase.from("todos").update({ due_on: dayKey }).eq("id", id);
  };

  const pass = (cat: string) => filter === "all" || filter === cat;
  const byDay = useMemo(() => {
    const m: Record<string, Item[]> = {};
    const push = (k: string, it: Item) => { (m[k] ||= []).push(it); };
    for (const e of events) {
      const cat = e.category && CAT[e.category] ? e.category : "event";
      if (!e.day || !pass(cat)) continue;
      const span = Math.max(1, e.plan_days ?? 1);
      for (let di = 0; di < span; di++) {
        const base = e.title || e.day_label || "Event";
        push(addDaysKey(e.day, di), { id: e.id, title: span > 1 ? `${base} · D${di + 1}` : base, cat, kind: "event", go: () => openPlanner(e, di + 1) });
      }
    }
    for (const c of content) if (c.scheduled_for && pass("content")) push(key(new Date(c.scheduled_for)), { id: c.id, title: c.title || "Content", cat: "content", kind: "content", go: () => setSection("studio") });
    for (const t of todos) if (t.due_on && pass(t.category)) push(t.due_on, { id: t.id, title: t.title, cat: CAT[t.category] ? t.category : "ops", kind: "todo", done: t.done, go: () => { if (t.event_id) openEventPrep(t.event_id); else if (t.meeting_note_id) setSection("plan"); }, toggle: () => toggleTodo(t) });
    return m;
  }, [events, content, todos, filter]);

  // header label + navigation step by view
  const nav = (dir: number) => {
    const d = new Date(cursor);
    if (view === "week") d.setDate(d.getDate() + dir * 7);
    else if (view === "quarter") d.setMonth(d.getMonth() + dir * 3);
    else if (view === "year") d.setFullYear(d.getFullYear() + dir);
    else d.setMonth(d.getMonth() + dir);
    setCur(d);
  };
  const label = (() => {
    if (view === "week") { const w = gridWeek(cursor); return `${MON3[w[0].getMonth()]} ${w[0].getDate()} – ${w[6].getMonth() !== w[0].getMonth() ? `${MON3[w[6].getMonth()]} ` : ""}${w[6].getDate()}`; }
    if (view === "quarter") return `Q${Math.floor(cursor.getMonth() / 3) + 1} ${cursor.getFullYear()}`;
    if (view === "year") return `${cursor.getFullYear()}`;
    if (view === "list") return "Agenda";
    return `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  })();

  const VIEWS: View[] = ["list", "week", "month", "quarter", "year"];
  const Chip = ({ it }: { it: Item }) => (
    <button type="button" draggable={it.kind === "todo"} className={`cc-chip${it.done ? " done" : ""}`} style={{ borderLeftColor: CAT[it.cat]?.color }}
      onDragStart={() => { if (it.kind === "todo") dragId.current = it.id; }} onClick={it.go} title={`${CAT[it.cat]?.label}: ${it.title}`}>
      {it.kind === "todo" && <span className="cc-check" onClick={(e) => { e.stopPropagation(); it.toggle?.(); }}>{it.done ? "✓" : "○"}</span>}
      <span className="cc-dot" style={{ background: CAT[it.cat]?.color }} />{it.title}
    </button>
  );

  return (
    <div className="adm-sec cal">
      <div className="cal-sticky">
        <div className="cal-bar">
          <div className="cal-nav">
            {view !== "list" && <button type="button" className="cal-arrow" onClick={() => nav(-1)} aria-label="Previous">‹</button>}
            <span className="cal-month">{label}</span>
            {view !== "list" && <button type="button" className="cal-arrow" onClick={() => nav(1)} aria-label="Next">›</button>}
          </div>
          <button type="button" className="cal-today" onClick={() => setCur(new Date(now.getFullYear(), now.getMonth(), now.getDate()))}>Today</button>
        </div>
        <div className="cal-views">
          {VIEWS.map((v) => <button key={v} type="button" className={`cal-view${view === v ? " on" : ""}`} onClick={() => setV(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
        </div>
        <div className="cal-filters">
          {["all", "admin", "ops", "event", "content"].map((f) => (
            <button key={f} type="button" className={`cc-filter${filter === f ? " on" : ""}`} onClick={() => setFilter(f)} style={f !== "all" ? { ["--c" as string]: CAT[f].color } : undefined}>
              {f !== "all" && <span className="cc-dot" style={{ background: CAT[f].color }} />}{f === "all" ? "All" : CAT[f].label}
            </button>
          ))}
        </div>
        {(view === "month" || view === "week") && <div className="cal-dow">{DOW.map((d) => <div key={d} className="cal-dow-c">{d}</div>)}</div>}
      </div>

      {/* ── MONTH ── */}
      {view === "month" && (
        <div className="cal-grid">
          {gridMonth(cursor).map((d) => {
            const k = key(d); const items = byDay[k] || []; const dim = d.getMonth() !== cursor.getMonth();
            return (
              <div key={k} className={`cal-cell${dim ? " dim" : ""}${k === todayKey ? " today" : ""}${over === k ? " over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver((o) => o === k ? null : o)} onDrop={() => { setOver(null); const id = dragId.current; dragId.current = null; if (id) reschedule(id, k); }}>
                <div className="cal-cell-h"><span className="cal-date">{d.getDate()}</span><button type="button" className="cal-add" onClick={() => setAddDay(k)} aria-label="Add">+</button></div>
                <div className="cal-items">{items.map((it) => <Chip key={`${it.kind}-${it.id}`} it={it} />)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── WEEK ── */}
      {view === "week" && (
        <div className="cal-week">
          {gridWeek(cursor).map((d) => {
            const k = key(d); const items = byDay[k] || [];
            return (
              <div key={k} className={`cal-wrow${k === todayKey ? " today" : ""}${over === k ? " over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver((o) => o === k ? null : o)} onDrop={() => { setOver(null); const id = dragId.current; dragId.current = null; if (id) reschedule(id, k); }}>
                <div className="cal-wday"><b>{DOW[d.getDay()]}</b><span>{d.getDate()}</span><button type="button" className="cal-add wk" onClick={() => setAddDay(k)} aria-label="Add">+</button></div>
                <div className="cal-witems">{items.length === 0 ? <span className="cal-wnone">—</span> : items.map((it) => <Chip key={`${it.kind}-${it.id}`} it={it} />)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── LIST / AGENDA ── */}
      {view === "list" && (() => {
        const out: { d: Date; items: Item[] }[] = [];
        for (let dt = new Date(range.start); dt <= range.end; dt.setDate(dt.getDate() + 1)) { const k = key(dt); if (byDay[k]?.length) out.push({ d: new Date(dt), items: byDay[k] }); }
        return (
          <div className="cal-list">
            {out.length === 0 ? <div className="h-sub" style={{ marginTop: 12 }}>Nothing scheduled in the next three months.</div> : out.map(({ d, items }) => {
              const k = key(d);
              return (
                <div key={k} className={`cal-lrow${k === todayKey ? " today" : ""}`}>
                  <div className="cal-ldate"><b>{d.getDate()}</b><span>{DOW[d.getDay()]}</span><span className="cal-lmon">{MON3[d.getMonth()]}</span></div>
                  <div className="cal-litems">{items.map((it) => <Chip key={`${it.kind}-${it.id}`} it={it} />)}</div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── QUARTER / YEAR (mini-months, tap to open) ── */}
      {(view === "quarter" || view === "year") && (
        <div className={`cal-multi ${view}`}>
          {(view === "quarter" ? [0, 1, 2].map((i) => new Date(cursor.getFullYear(), qStart(cursor) + i, 1)) : Array.from({ length: 12 }, (_, i) => new Date(cursor.getFullYear(), i, 1))).map((mDate) => (
            <MiniMonth key={key(mDate)} mDate={mDate} byDay={byDay} todayKey={todayKey} onOpen={() => { setCur(new Date(mDate.getFullYear(), mDate.getMonth(), 1)); setV("month"); }} />
          ))}
        </div>
      )}

      {isOwner && <OutlookBar onSynced={load} />}
      {!isOwner && <div className="insp-foot" style={{ marginTop: 12 }}>📅 Outlook two-way sync is managed by the owner.</div>}

      {addDay && <AddSheet day={addDay} events={events} onClose={() => setAddDay(null)} onDone={() => { setAddDay(null); load(); }} setSection={setSection} />}
      {planEv && (
        <EventDayPlanner
          eventId={planEv.id} title={planEv.title} eventDay={planEv.day} planDays={planEv.plan_days} initialDay={planEv.initialDay}
          onPlanDays={async (n) => { if (supabase) { await supabase.from("events").update({ plan_days: n }).eq("id", planEv.id); setPlanEv((p) => p ? { ...p, plan_days: n } : p); load(); } }}
          onClose={() => { setPlanEv(null); load(); }}
        />
      )}
    </div>
  );
}

function MiniMonth({ mDate, byDay, todayKey, onOpen }: { mDate: Date; byDay: Record<string, Item[]>; todayKey: string; onOpen: () => void }) {
  const days = gridMonth(mDate);
  return (
    <button type="button" className="mini-m" onClick={onOpen}>
      <div className="mini-h">{MONTHS[mDate.getMonth()]}</div>
      <div className="mini-grid">
        {days.map((d) => {
          const k = key(d); const items = byDay[k] || []; const dim = d.getMonth() !== mDate.getMonth();
          const cats = Array.from(new Set(items.map((i) => i.cat))).slice(0, 3);
          return (
            <div key={k} className={`mini-d${dim ? " dim" : ""}${k === todayKey ? " today" : ""}`}>
              <span>{d.getDate()}</span>
              {items.length > 0 && <span className="mini-dots">{cats.map((c) => <i key={c} style={{ background: CAT[c]?.color }} />)}</span>}
            </div>
          );
        })}
      </div>
    </button>
  );
}

// Owner-only Outlook connect / sync control.
function OutlookBar({ onSynced }: { onSynced: () => void }) {
  const [st, setSt] = useState<{ configured: boolean; connected: boolean; account: string | null; last_sync: string | null; last_note: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const token = async () => (await supabase!.auth.getSession()).data.session?.access_token;
  const refresh = useCallback(async () => {
    if (!supabase) return;
    const t = await token();
    const r = await fetch("/api/outlook/status", { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    const j = await r.json(); if (j.ok) setSt(j);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search).get("outlook");
    if (p === "connected") { setMsg("Outlook connected."); refresh(); }
    else if (p === "error") setMsg("Couldn't connect Outlook — try again.");
    if (p) window.history.replaceState({}, "", window.location.pathname);
  }, [refresh]);

  const connect = async () => {
    setBusy("connect"); setMsg(null);
    const t = await token();
    const r = await fetch("/api/outlook/connect", { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    const j = await r.json();
    if (j.ok && j.url) window.location.href = j.url; else { setMsg(j.error || "Couldn't start Outlook connect."); setBusy(null); }
  };
  const sync = async () => {
    setBusy("sync"); setMsg(null);
    const t = await token();
    const r = await fetch("/api/outlook/sync", { method: "POST", headers: t ? { Authorization: `Bearer ${t}` } : {} });
    const j = await r.json();
    setMsg(j.ok ? `Synced — ${j.note}.` : (j.error || "Sync failed."));
    setBusy(null); if (j.ok) { onSynced(); refresh(); }
  };
  const disconnect = async () => {
    if (typeof window !== "undefined" && !window.confirm("Disconnect Outlook?")) return;
    setBusy("dc"); const t = await token();
    await fetch("/api/outlook/disconnect", { method: "POST", headers: t ? { Authorization: `Bearer ${t}` } : {} });
    setBusy(null); setMsg("Outlook disconnected."); refresh();
  };

  if (!st) return null;
  return (
    <div className="ol-bar">
      <div className="ol-top"><span className="ol-i">📅</span><b>Outlook sync</b>
        {st.connected ? <span className="ol-state on">Connected</span> : st.configured ? <span className="ol-state">Not connected</span> : <span className="ol-state off">Not configured</span>}
      </div>
      {!st.configured && <div className="ol-note">Set <code>MS_CLIENT_ID</code> and <code>MS_CLIENT_SECRET</code> (Azure app) to enable two-way sync.</div>}
      {st.configured && !st.connected && <button type="button" className="ol-btn primary" onClick={connect} disabled={busy === "connect"}>{busy === "connect" ? "Opening Microsoft…" : "Connect Outlook"}</button>}
      {st.connected && (
        <>
          <div className="ol-note">{st.account || "Connected"}{st.last_sync ? ` · last sync ${new Date(st.last_sync).toLocaleString()}` : ""}{st.last_note ? ` · ${st.last_note}` : ""}</div>
          <div className="ol-acts">
            <button type="button" className="ol-btn primary" onClick={sync} disabled={busy === "sync"}>{busy === "sync" ? "Syncing…" : "Sync now"}</button>
            <button type="button" className="ol-btn" onClick={disconnect} disabled={busy === "dc"}>Disconnect</button>
          </div>
        </>
      )}
      {msg && <div className="ol-msg">{msg}</div>}
    </div>
  );
}

function AddSheet({ day, events, onClose, onDone }: { day: string; events: Ev[]; onClose: () => void; onDone: () => void; setSection: (s: any) => void }) {
  const [kind, setKind] = useState<"todo" | "event">("todo");
  const [title, setTitle] = useState(""); const [cat, setCat] = useState("ops"); const [eventId, setEventId] = useState("");
  const save = async () => {
    if (!supabase || !title.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (kind === "todo") await supabase.from("todos").insert({ title: title.trim(), category: cat, due_on: day, event_id: eventId || null, created_by: user?.id ?? null });
    else await supabase.from("events").insert({ title: title.trim(), day, category: cat === "content" ? "event" : cat });
    onDone();
  };
  return (
    <div className="qd-scrim" onClick={onClose}>
      <div className="qd-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="qd-tabs">
          <button type="button" className={`qd-tab${kind === "todo" ? " on" : ""}`} onClick={() => setKind("todo")}>To-do</button>
          <button type="button" className={`qd-tab${kind === "event" ? " on" : ""}`} onClick={() => setKind("event")}>Event</button>
          <span style={{ marginLeft: "auto", fontFamily: "Inter", fontSize: 13, color: "var(--cream-m)" }}>{day}</span>
          <button type="button" className="qd-x" onClick={onClose}>✕</button>
        </div>
        <div className="qd-body">
          <input className="note-in" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "todo" ? "What needs doing?" : "Event name"} autoFocus />
          <div className="prod-grid" style={{ marginTop: 10 }}>
            <label className="prod-f"><span>Category</span>
              <select value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="admin">Admin</option><option value="ops">Ops</option><option value="event">Events</option>{kind === "todo" && <option value="content">Content</option>}
              </select>
            </label>
            {kind === "todo" && (
              <label className="prod-f"><span>Link to event (optional)</span>
                <select value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">None</option>{events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title || ev.day_label}</option>)}</select>
              </label>
            )}
          </div>
          <div className="prod-actions" style={{ marginTop: 14 }}>
            <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
            <button type="button" className="note-save" onClick={save} disabled={!title.trim()}>Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}
