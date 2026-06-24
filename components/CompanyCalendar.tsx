"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useOperatorSection } from "./OperatorNav";
import EventDayPlanner from "./EventDayPlanner";

// COMPANY CALENDAR — one pane for everything dated: truck events, admin/ops work, scheduled content
// (from Studio), and free-standing to-dos. Category-colored, filterable, and every chip CLICKS
// THROUGH to its source (event → Prep, content → Studio, to-do → its linked event/note). Studio
// keeps its own content-only calendar; it all rolls up here.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Ev = { id: string; title: string | null; day: string; day_label: string | null; is_live: boolean | null; category: string | null; plan_days: number | null };
type Content = { id: string; title: string; scheduled_for: string | null; status: string };
type Todo = { id: string; title: string; category: string; due_on: string | null; done: boolean; event_id: string | null; meeting_note_id: string | null };

const CAT: Record<string, { label: string; color: string }> = {
  admin: { label: "Admin", color: "#8b5cf6" }, ops: { label: "Ops", color: "#e0892b" },
  event: { label: "Events", color: "#6fa8dc" }, content: { label: "Content", color: "#2bb3a3" },
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const CAL_KEY = "gt3-company-cal-month";

type Item = { id: string; title: string; cat: string; kind: "event" | "content" | "todo"; done?: boolean; go: () => void; toggle?: () => void };

export default function CompanyCalendar() {
  const { setSection } = useOperatorSection();
  const now = new Date();
  const [cursor, setCursor] = useState(() => {
    if (typeof window !== "undefined") { const s = localStorage.getItem(CAL_KEY); if (s) { const [y, m] = s.split("-").map(Number); if (y && m) return new Date(y, m - 1, 1); } }
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const setMonth = (d: Date) => { setCursor(d); if (typeof window !== "undefined") localStorage.setItem(CAL_KEY, `${d.getFullYear()}-${d.getMonth() + 1}`); };
  const [events, setEvents] = useState<Ev[]>([]);
  const [content, setContent] = useState<Content[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [addDay, setAddDay] = useState<string | null>(null);
  const [planEv, setPlanEv] = useState<{ id: string; title: string; day: string | null; plan_days: number; initialDay: number } | null>(null);
  const dragId = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const days = useMemo(() => { const s = new Date(cursor); s.setDate(1 - s.getDay()); return Array.from({ length: 42 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d; }); }, [cursor]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const from = key(days[0]), to = key(days[41]);
    const eFrom = (() => { const d = new Date(days[0]); d.setDate(d.getDate() - 30); return key(d); })(); // catch multi-day events that started before the window
    const [e, c, t] = await Promise.all([
      supabase.from("events").select("id, title, day, day_label, is_live, category, plan_days").is("archived_at", null).gte("day", eFrom).lte("day", to),
      supabase.from("content_items").select("id, title, scheduled_for, status").not("scheduled_for", "is", null).gte("scheduled_for", `${from}T00:00:00`).lte("scheduled_for", `${to}T23:59:59`),
      supabase.from("todos").select("id, title, category, due_on, done, event_id, meeting_note_id").not("due_on", "is", null).gte("due_on", from).lte("due_on", to),
    ]);
    setEvents((e.data as Ev[]) ?? []); setContent((c.data as Content[]) ?? []); setTodos((t.data as Todo[]) ?? []);
  }, [days]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel("company-cal")
      .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "content_items" }, () => load())
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

  const byDay = useMemo(() => {
    const m: Record<string, Item[]> = {};
    for (const d of days) m[key(d)] = [];
    const pass = (cat: string) => filter === "all" || filter === cat;
    const addDaysKey = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return key(d); };
    for (const e of events) {
      const cat = e.category && CAT[e.category] ? e.category : "event";
      if (!e.day || !pass(cat)) continue;
      const span = Math.max(1, e.plan_days ?? 1); // multi-day events span their days; each day clicks into that day's run of show
      for (let di = 0; di < span; di++) {
        const dk = addDaysKey(e.day, di);
        if (!m[dk]) continue;
        const base = e.title || e.day_label || "Event";
        m[dk].push({ id: e.id, title: span > 1 ? `${base} · D${di + 1}` : base, cat, kind: "event", go: () => openPlanner(e, di + 1) });
      }
    }
    for (const c of content) if (c.scheduled_for && pass("content")) { const k = key(new Date(c.scheduled_for)); if (m[k]) m[k].push({ id: c.id, title: c.title || "Content", cat: "content", kind: "content", go: () => setSection("studio") }); }
    for (const t of todos) if (t.due_on && pass(t.category)) { if (m[t.due_on]) m[t.due_on].push({ id: t.id, title: t.title, cat: CAT[t.category] ? t.category : "ops", kind: "todo", done: t.done, go: () => { if (t.event_id) openEventPrep(t.event_id); else if (t.meeting_note_id) setSection("plan"); }, toggle: () => toggleTodo(t) }); }
    return m;
  }, [days, events, content, todos, filter]);

  const todayKey = key(now);
  return (
    <div className="adm-sec cal">
      <div className="cal-sticky">
        <div className="cal-bar">
          <div className="cal-nav">
            <button type="button" className="cal-arrow" onClick={() => setMonth(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month">‹</button>
            <span className="cal-month">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</span>
            <button type="button" className="cal-arrow" onClick={() => setMonth(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month">›</button>
          </div>
          <button type="button" className="cal-today" onClick={() => setMonth(new Date(now.getFullYear(), now.getMonth(), 1))}>Today</button>
        </div>
        <div className="cal-filters">
          {["all", "admin", "ops", "event", "content"].map((f) => (
            <button key={f} type="button" className={`cc-filter${filter === f ? " on" : ""}`} onClick={() => setFilter(f)} style={f !== "all" ? { ["--c" as string]: CAT[f].color } : undefined}>
              {f !== "all" && <span className="cc-dot" style={{ background: CAT[f].color }} />}{f === "all" ? "All" : CAT[f].label}
            </button>
          ))}
        </div>
        <div className="cal-dow">{DOW.map((d) => <div key={d} className="cal-dow-c">{d}</div>)}</div>
      </div>

      <div className="cal-grid">
        {days.map((d) => {
          const k = key(d); const items = byDay[k] || []; const dim = d.getMonth() !== cursor.getMonth();
          return (
            <div key={k} className={`cal-cell${dim ? " dim" : ""}${k === todayKey ? " today" : ""}${over === k ? " over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver((o) => o === k ? null : o)} onDrop={() => { setOver(null); const id = dragId.current; dragId.current = null; if (id) reschedule(id, k); }}>
              <div className="cal-cell-h">
                <span className="cal-date">{d.getDate()}</span>
                <button type="button" className="cal-add" onClick={() => setAddDay(k)} aria-label="Add">+</button>
              </div>
              <div className="cal-items">
                {items.map((it) => (
                  <button key={`${it.kind}-${it.id}`} type="button" draggable={it.kind === "todo"} className={`cc-chip${it.done ? " done" : ""}`} style={{ borderLeftColor: CAT[it.cat]?.color }}
                    onDragStart={() => { if (it.kind === "todo") dragId.current = it.id; }} onClick={it.go} title={`${CAT[it.cat]?.label}: ${it.title}`}>
                    {it.kind === "todo" && <span className="cc-check" onClick={(e) => { e.stopPropagation(); it.toggle?.(); }}>{it.done ? "✓" : "○"}</span>}
                    <span className="cc-dot" style={{ background: CAT[it.cat]?.color }} />{it.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="insp-foot" style={{ marginTop: 12 }}>📅 Outlook two-way sync connects once Microsoft Graph credentials are set (config-gated).</div>
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
