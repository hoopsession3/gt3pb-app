"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { useRealtimeTable } from "@/lib/realtime";
import { CAL_CAT as CAT } from "@/lib/calendarTokens";
import { useWorkStreams } from "@/lib/streams";
import { useAuth, roleOf } from "@/components/AuthProvider";
import { useOperatorSection } from "./OperatorNav";
import EventDayPlanner from "./EventDayPlanner";
import Sheet from "@/components/Sheet";

// COMPANY CALENDAR — one pane for everything dated: truck events, admin/ops work, scheduled content
// (from Studio), and free-standing to-dos. Category-colored, filterable, click-through to source.
// Views: List · Week · Month · Quarter · Year. Owner can connect Outlook for two-way sync.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Ev = { id: string; title: string | null; day: string; day_label: string | null; is_live: boolean | null; category: string | null; plan_days: number | null; stage: string | null };
type Content = { id: string; title: string; scheduled_for: string | null; status: string };
type Todo = { id: string; title: string; category: string; due_on: string | null; done: boolean; event_id: string | null; meeting_note_id: string | null };
type PrepTask = { id: string; label: string; due_at: string | null; event_id: string | null; stop_id: string | null; meeting_note_id: string | null };

const FILTERS = ["all", ...Object.keys(CAT)];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDaysKey = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return key(d); };
const VIEW_KEY = "gt3-company-cal-view";
type View = "list" | "board" | "cards" | "week" | "month" | "quarter" | "year";
// board/cards are "from today" views — no month cursor, one shared window
const FLOW_VIEWS: View[] = ["list", "board", "cards"];
const VLABEL: Record<View, string> = { list: "Agenda", board: "Board", cards: "Cards", week: "Week", month: "Month", quarter: "Quarter", year: "Year" };

type Stop = { id: string; name: string; location_text: string | null; starts_at: string | null; status: string | null };
type Brew = { id: string; recipe_name: string | null; batch_gal: number | null; status: string; brew_date: string | null; ready_at: string | null; latest_start_at: string | null };
type Item = { id: string; title: string; cat: string; kind: "event" | "content" | "todo" | "stop" | "task" | "brew" | "drop" | "delivery"; done?: boolean; warn?: boolean; meta?: string; go: () => void; toggle?: () => void };
// kinds that back a SRC row and can be edited/dragged here; brew/drop/delivery are read-only rollups
type EditKind = "event" | "content" | "todo" | "stop" | "task";
const isEditable = (k: Item["kind"]): k is EditKind => k in SRC;
const DRAG = new Set<Item["kind"]>(["event", "stop", "content", "todo"]); // event_task + rollups stay put

function gridMonth(cursor: Date): Date[] { const s = new Date(cursor.getFullYear(), cursor.getMonth(), 1); s.setDate(1 - s.getDay()); return Array.from({ length: 42 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d; }); }
function gridWeek(cursor: Date): Date[] { const s = new Date(cursor); s.setDate(cursor.getDate() - cursor.getDay()); return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d; }); }
const qStart = (cursor: Date) => Math.floor(cursor.getMonth() / 3) * 3;

export default function CompanyCalendar() {
  const { setSection } = useOperatorSection();
  const router = useRouter();
  const { profile } = useAuth();
  const isOwner = roleOf(profile) === "owner";
  const now = new Date();
  const todayKey = key(now);
  // Default is LIST, not the month grid — on a phone the 30-day grid is a wall of tiny cells that
  // shows almost no data (owner call, 2026-07-09: "we lose sight… it's small and shows not much").
  // List reads like an agenda: dense, dated, actionable. A chosen view still persists.
  const [view, setView] = useState<View>(() => { if (typeof window !== "undefined") { const v = localStorage.getItem(VIEW_KEY) as View; if (v && v in VLABEL) return v; } return "list"; });
  const setV = (v: View) => { setView(v); if (typeof window !== "undefined") localStorage.setItem(VIEW_KEY, v); };
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), now.getDate())); // always open on today (right week AND month)
  const setCur = (d: Date) => setCursor(d);
  const [events, setEvents] = useState<Ev[]>([]);
  const [content, setContent] = useState<Content[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [prepTasks, setPrepTasks] = useState<PrepTask[]>([]);
  const [brews, setBrews] = useState<Brew[]>([]);
  const [drops, setDrops] = useState<{ drop_date: string; size: number }[]>([]);
  const [dels, setDels] = useState<{ delivery_date: string }[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [filterSheet, setFilterSheet] = useState(false); // categories live behind one quiet chip
  const [addDay, setAddDay] = useState<string | null>(null);
  const [dayOpen, setDayOpen] = useState<string | null>(null); // a date → show that day's detail
  const [backlogT, setBacklogT] = useState<Todo[]>([]);   // undated to-dos — Board's Unscheduled column
  const [backlogC, setBacklogC] = useState<Content[]>([]); // unscheduled content, same column
  const [edit, setEdit] = useState<{ kind: EditKind; id: string } | null>(null); // Cards/Rails edit in place
  const [stale, setStale] = useState(0); // overdue, unpublished, not-yet-tidied content
  const [tidying, setTidying] = useState(false);
  const dragId = useRef<{ kind: EditKind; id: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  // The date window to load + render, by view.
  const range = useMemo(() => {
    if (view === "board" || view === "cards") {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
      const e = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 60);
      return { start: s, end: e };
    }
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
    const [e, c, t, s, pt, bb, dr, dv, bt, bc] = await Promise.all([
      supabase.from("events").select("id, title, day, day_label, is_live, category, plan_days, stage").is("archived_at", null).gte("day", eFrom).lte("day", to),
      supabase.from("content_items").select("id, title, scheduled_for, status").is("archived_at", null).not("scheduled_for", "is", null).gte("scheduled_for", `${from}T00:00:00`).lte("scheduled_for", `${to}T23:59:59`),
      supabase.from("todos").select("id, title, category, due_on, done, event_id, meeting_note_id").not("due_on", "is", null).gte("due_on", from).lte("due_on", to),
      supabase.from("stops").select("id, name, location_text, starts_at, status").not("starts_at", "is", null).neq("status", "done").gte("starts_at", `${from}T00:00:00`).lte("starts_at", `${to}T23:59:59`),
      supabase.from("event_tasks").select("id, label, due_at, event_id, stop_id, meeting_note_id").eq("done", false).eq("kind", "task").not("due_at", "is", null).gte("due_at", `${from}T00:00:00`).lte("due_at", `${to}T23:59:59`),
      supabase.from("brew_batches").select("id, recipe_name, batch_gal, status, brew_date, ready_at, latest_start_at").not("status", "in", "(served,dumped)").not("brew_date", "is", null).gte("brew_date", from).lte("brew_date", to),
      supabase.from("drop_orders").select("drop_date, size").is("canceled_at", null).gte("drop_date", from).lte("drop_date", to),
      supabase.from("delivery_orders").select("delivery_date").is("canceled_at", null).gte("delivery_date", from).lte("delivery_date", to),
      supabase.from("todos").select("id, title, category, due_on, done, event_id, meeting_note_id").is("due_on", null).eq("done", false).limit(30),
      supabase.from("content_items").select("id, title, scheduled_for, status").is("archived_at", null).is("scheduled_for", null).neq("status", "published").limit(30),
    ]);
    setEvents((e.data as Ev[]) ?? []); setContent((c.data as Content[]) ?? []); setTodos((t.data as Todo[]) ?? []); setStops((s.data as Stop[]) ?? []); setPrepTasks((pt.data as PrepTask[]) ?? []);
    setBrews((bb.data as Brew[]) ?? []); setDrops((dr.data as { drop_date: string; size: number }[]) ?? []); setDels((dv.data as { delivery_date: string }[]) ?? []);
    setBacklogT((bt.data as Todo[]) ?? []); setBacklogC((bc.data as Content[]) ?? []);
  }, [range]);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["todos", "content_items", "events", "stops", "event_tasks", "brew_batches", "drop_orders", "delivery_orders"], load);

  const loadStale = useCallback(async () => { if (!supabase) return; const { data } = await supabase.rpc("stale_content_count"); setStale(typeof data === "number" ? data : 0); }, []);
  useEffect(() => { loadStale(); }, [loadStale]);
  const tidy = async () => {
    if (!supabase || tidying) return;
    setTidying(true);
    const { data } = await supabase.rpc("tidy_stale_content", { grace_days: 0 }); // owner tapped Tidy → file all overdue now
    setTidying(false); await load(); await loadStale();
    return data;
  };
  // Tapping ANY dated thing on the calendar — event or stop — opens the same unified prep hub, so they
  // operate and look identical. (The run-of-show / time blocks live inside the hub and on CalEdit.)
  const openEventPrep = (eventId: string) => { if (typeof window !== "undefined") localStorage.setItem("gt3-prep-open", `event:${eventId}`); setSection("prep"); };
  const openStopPrep = (stopId: string) => { if (typeof window !== "undefined") localStorage.setItem("gt3-prep-open", `stop:${stopId}`); setSection("prep"); };
  const toggleTodo = async (t: Todo) => {
    if (!supabase) return;
    setTodos((p) => p.map((x) => x.id === t.id ? { ...x, done: !x.done } : x));
    await supabase.from("todos").update({ done: !t.done, done_at: !t.done ? new Date().toISOString() : null }).eq("id", t.id);
  };
  // Drag-to-reschedule for every editable kind — same rule as CalEdit's onDate: plain-date columns
  // take the day key, timestamp columns keep their existing time-of-day.
  const reschedule = async (kind: EditKind, id: string, dayKey: string) => {
    if (!supabase) return;
    const cfg = SRC[kind];
    let val: string = dayKey;
    if (cfg.dateIsTimestamp) {
      const prev = kind === "stop" ? stops.find((x) => x.id === id)?.starts_at : content.find((x) => x.id === id)?.scheduled_for;
      const old = prev ? new Date(prev) : null;
      const hh = old ? `${pad(old.getHours())}:${pad(old.getMinutes())}` : cfg.defTime;
      val = new Date(`${dayKey}T${hh}:00`).toISOString();
    }
    if (kind === "todo") setTodos((p) => p.map((x) => x.id === id ? { ...x, due_on: dayKey } : x));
    await supabase.from(cfg.table).update({ [cfg.dateCol]: val }).eq("id", id);
    load();
  };
  const unschedule = async (kind: EditKind, id: string) => {
    if (!supabase || (kind !== "todo" && kind !== "content")) return;
    await supabase.from(SRC[kind].table).update({ [SRC[kind].dateCol]: null }).eq("id", id);
    load();
  };
  // Business-rhythm rollups deep-link to the surface that owns them (same pattern as Studio's
  // "Company calendar ↗" hand-off). setSection for cross-section jumps — OperatorNav only reads
  // ?s= on mount/popstate, so a bare router.push wouldn't switch; brew stays a URL push because
  // we're already inside Plan and setSection would no-op.
  const openBrew = () => { try { localStorage.setItem("gt3-plan-tab", "brew"); } catch { /* ignore */ } router.push("/admin?s=plan"); };
  const openNow = () => setSection("now");

  const streams = useWorkStreams();
  const laneFilter = filter.startsWith("lane:") ? streams.find((s) => s.key === filter.slice(5)) : null;
  const pass = (cat: string) => filter === "all" || filter === cat || Boolean(laneFilter?.categories.includes(cat));
  const byDay = useMemo(() => {
    const m: Record<string, Item[]> = {};
    const push = (k: string, it: Item) => { (m[k] ||= []).push(it); };
    for (const e of events) {
      const cat = e.category && CAT[e.category] ? e.category : "event";
      if (!e.day || !pass(cat)) continue;
      const span = Math.max(1, e.plan_days ?? 1);
      for (let di = 0; di < span; di++) {
        const base = e.title || e.day_label || "Event";
        const meta = e.is_live ? "Live" : (e.stage ? e.stage[0].toUpperCase() + e.stage.slice(1) : "");
        push(addDaysKey(e.day, di), { id: e.id, title: span > 1 ? `${base} · D${di + 1}` : base, cat, kind: "event", meta, go: () => openEventPrep(e.id) });
      }
    }
    for (const s of stops) if (s.starts_at && pass("stop")) push(key(new Date(s.starts_at)), { id: s.id, title: s.name, cat: "stop", kind: "stop", go: () => openStopPrep(s.id) });
    for (const c of content) if (c.scheduled_for && pass("content")) push(key(new Date(c.scheduled_for)), { id: c.id, title: c.title || "Content", cat: "content", kind: "content", go: () => setSection("studio") });
    for (const t of todos) if (t.due_on && pass(t.category)) push(t.due_on, { id: t.id, title: t.title, cat: CAT[t.category] ? t.category : "ops", kind: "todo", done: t.done, go: () => { if (t.event_id) openEventPrep(t.event_id); else if (t.meeting_note_id) setSection("plan"); }, toggle: () => toggleTodo(t) });
    for (const t of prepTasks) if (t.due_at && pass("task")) push(key(new Date(t.due_at)), { id: t.id, title: t.label, cat: "task", kind: "task", go: () => { if (t.event_id) openEventPrep(t.event_id); else if (t.stop_id) openStopPrep(t.stop_id); else if (t.meeting_note_id) setSection("plan"); } });
    if (pass("brew")) for (const b of brews) if (b.brew_date) push(b.brew_date, { id: b.id, title: `Brew · ${b.recipe_name || "Batch"} ${Number(b.batch_gal ?? 1)} gal`, cat: "brew", kind: "brew", warn: b.status === "planned" && !!b.latest_start_at && new Date(b.latest_start_at) < new Date(), go: openBrew });
    if (pass("drop")) {
      const agg: Record<string, number> = {};
      for (const d of drops) agg[d.drop_date] = (agg[d.drop_date] || 0) + 1;
      for (const [dk, n] of Object.entries(agg)) push(dk, { id: `drop-${dk}`, title: `Drop · ${n} pack${n === 1 ? "" : "s"}`, cat: "drop", kind: "drop", go: openNow });
    }
    if (pass("delivery")) {
      const agg: Record<string, number> = {};
      for (const d of dels) agg[d.delivery_date] = (agg[d.delivery_date] || 0) + 1;
      for (const [dk, n] of Object.entries(agg)) push(dk, { id: `del-${dk}`, title: `Sunday run · ${n} porch${n === 1 ? "" : "es"}`, cat: "delivery", kind: "delivery", go: openNow });
    }
    return m;
  }, [events, content, todos, stops, prepTasks, brews, drops, dels, filter, streams]);

  // Flat date-sorted spine for Board / Cards / Rails.
  const flat = useMemo(() => {
    const out: { k: string; it: Item }[] = [];
    for (const [k, its] of Object.entries(byDay)) for (const it of its) out.push({ k, it });
    out.sort((a, b) => a.k.localeCompare(b.k));
    return out;
  }, [byDay]);
  const backlogItems = useMemo(() => {
    const out: Item[] = [];
    for (const t of backlogT) if (pass(CAT[t.category] ? t.category : "ops")) out.push({ id: t.id, title: t.title, cat: CAT[t.category] ? t.category : "ops", kind: "todo", done: t.done, go: () => { if (t.event_id) openEventPrep(t.event_id); }, toggle: () => toggleTodo(t) });
    for (const c of backlogC) if (pass("content")) out.push({ id: c.id, title: c.title || "Content", cat: "content", kind: "content", go: () => setSection("studio") });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backlogT, backlogC, filter]);

  // Conflict signal — an event and a truck stop landing on the same day, or a brew past its
  // latest start. The day gets a warn ring; DayView says it in one line.
  const warnDays = useMemo(() => {
    const s = new Set<string>();
    for (const [k, its] of Object.entries(byDay)) {
      const kinds = new Set(its.map((i) => i.kind));
      if ((kinds.has("event") && kinds.has("stop")) || its.some((i) => i.warn)) s.add(k);
    }
    return s;
  }, [byDay]);

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
    if (view === "board") return "Flow";
    if (view === "cards") return "Up next";
    return `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  })();

  const VIEWS: View[] = ["list", "board", "cards", "week", "month", "quarter", "year"];
  const Chip = ({ it }: { it: Item }) => (
    <button type="button" draggable={DRAG.has(it.kind)} className={`cc-chip${it.done ? " done" : ""}`} style={{ borderLeftColor: CAT[it.cat]?.color }}
      onDragStart={() => { if (DRAG.has(it.kind) && isEditable(it.kind)) dragId.current = { kind: it.kind, id: it.id }; }} onClick={(e) => { e.stopPropagation(); it.go(); }} title={`${CAT[it.cat]?.label}: ${it.title}`}>
      {it.kind === "todo" && <span className="cc-check" onClick={(e) => { e.stopPropagation(); it.toggle?.(); }}>{it.done ? "✓" : "○"}</span>}
      <span className="cc-dot" style={{ background: CAT[it.cat]?.color }} />{it.title}
    </button>
  );

  return (
    <div className="adm-sec cal">
      <div className="cal-titlebar"><span className="cal-eyebrow">📅 Company calendar</span><span className="cal-titlesub">everything dated — tap any day to open &amp; edit</span></div>
      {stale > 0 && (
        <div className="cal-nudge">
          <span><b>{stale}</b> post{stale === 1 ? "" : "s"} went past their date unpublished.</span>
          <button type="button" onClick={tidy} disabled={tidying}>{tidying ? "Tidying…" : "Tidy up"}</button>
        </div>
      )}
      <div className="cal-sticky">
        <div className="cal-bar">
          <div className="cal-nav">
            {!FLOW_VIEWS.includes(view) && <button type="button" className="cal-arrow" onClick={() => nav(-1)} aria-label="Previous">‹</button>}
            <span className="cal-month">{label}</span>
            {!FLOW_VIEWS.includes(view) && <button type="button" className="cal-arrow" onClick={() => nav(1)} aria-label="Next">›</button>}
          </div>
          <button type="button" className="cal-today" onClick={() => setCur(new Date(now.getFullYear(), now.getMonth(), now.getDate()))}>Today</button>
        </div>
        <div className="cal-views">
          {VIEWS.map((v) => <button key={v} type="button" className={`cal-view${view === v ? " on" : ""}`} onClick={() => setV(v)}>{VLABEL[v]}</button>)}
          <button type="button" className={`cal-filterbtn${filter !== "all" ? " on" : ""}`} onClick={() => setFilterSheet(true)} aria-haspopup="dialog">
            {filter === "all" ? "Filter" : laneFilter ? <><span className="cc-dot" style={{ background: laneFilter.color }} />{laneFilter.label}</> : <><span className="cc-dot" style={{ background: CAT[filter].color }} />{CAT[filter].label}</>}
          </button>
        </div>
        {filterSheet && (
          <Sheet open onClose={() => setFilterSheet(false)} header={<div style={{ display: "flex", alignItems: "center" }}><div className="prep-sheet-h">Show on the calendar</div></div>}>
            <div className="prep-sheet-opts">
              <button type="button" className={`prep-sheet-opt${filter === "all" ? " on" : ""}`} onClick={() => { setFilter("all"); setFilterSheet(false); }}>Everything</button>
              <div className="dv-sub" style={{ margin: "10px 0 4px" }}>By lane</div>
              {streams.map((s) => (
                <button key={s.key} type="button" className={`prep-sheet-opt${filter === `lane:${s.key}` ? " on" : ""}`} onClick={() => { setFilter(`lane:${s.key}`); setFilterSheet(false); }}>
                  <span className="cc-dot" style={{ background: s.color, marginRight: 6 }} />{s.label}
                </button>
              ))}
              <div className="dv-sub" style={{ margin: "10px 0 4px" }}>By category</div>
              {FILTERS.filter((f) => f !== "all").map((f) => (
                <button key={f} type="button" className={`prep-sheet-opt${filter === f ? " on" : ""}`} onClick={() => { setFilter(f); setFilterSheet(false); }}>
                  {`${CAT[f].icon} ${CAT[f].label}`}
                </button>
              ))}
            </div>
          </Sheet>
        )}
        {(view === "month" || view === "week") && <div className="cal-dow">{DOW.map((d) => <div key={d} className="cal-dow-c">{d}</div>)}</div>}
      </div>

      {/* ── MONTH ── */}
      {view === "month" && (
        <div className="cal-grid">
          {gridMonth(cursor).map((d) => {
            const k = key(d); const items = byDay[k] || []; const dim = d.getMonth() !== cursor.getMonth();
            return (
              <div key={k} role="button" tabIndex={0} className={`cal-cell${dim ? " dim" : ""}${k === todayKey ? " today" : ""}${over === k ? " over" : ""}${warnDays.has(k) ? " heat" : ""}`} onClick={() => setDayOpen(k)}
                onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver((o) => o === k ? null : o)} onDrop={() => { setOver(null); const dg = dragId.current; dragId.current = null; if (dg) reschedule(dg.kind, dg.id, k); }}>
                <div className="cal-cell-h"><span className="cal-date">{d.getDate()}</span><button type="button" className="cal-add" onClick={(e) => { e.stopPropagation(); setAddDay(k); }} aria-label="Add">+</button></div>
                <div className="cal-marks">
                  {[...new Set(items.map((it) => it.cat))].slice(0, 4).map((c) => <span key={c} className="cal-mark" style={{ background: CAT[c]?.color }} />)}
                  {items.length > 0 && <span className="cal-mark-n">{items.length}</span>}
                </div>
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
              <div key={k} className={`cal-wrow${k === todayKey ? " today" : ""}${over === k ? " over" : ""}${warnDays.has(k) ? " heat" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver((o) => o === k ? null : o)} onDrop={() => { setOver(null); const dg = dragId.current; dragId.current = null; if (dg) reschedule(dg.kind, dg.id, k); }}>
                <div className="cal-wday" role="button" tabIndex={0} onClick={() => setDayOpen(k)}><b>{DOW[d.getDay()]}</b><span>{d.getDate()}</span><button type="button" className="cal-add wk" onClick={(e) => { e.stopPropagation(); setAddDay(k); }} aria-label="Add">+</button></div>
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

      {/* ── BOARD — flow kanban by time bucket; drag a card between columns to reschedule ── */}
      {view === "board" && (() => {
        const wk = addDaysKey(todayKey, 7), nx = addDaysKey(todayKey, 14);
        const buckets: Record<string, { k: string; it: Item }[]> = { overdue: [], today: [], week: [], next: [], later: [] };
        for (const { k, it } of flat) {
          if (k < todayKey) { if (!(it.kind === "todo" && it.done)) buckets.overdue.push({ k, it }); }
          else if (k === todayKey) buckets.today.push({ k, it });
          else if (k <= wk) buckets.week.push({ k, it });
          else if (k <= nx) buckets.next.push({ k, it });
          else buckets.later.push({ k, it });
        }
        const fmtK = (k: string) => { const d = new Date(`${k}T00:00:00`); return `${DOW[d.getDay()]} ${MON3[d.getMonth()]} ${d.getDate()}`; };
        const cols: { id: string; label: string; drop: string | null; sub?: string }[] = [
          { id: "overdue", label: "Overdue", drop: null },
          { id: "today", label: "Today", drop: todayKey },
          { id: "week", label: "This week", drop: addDaysKey(todayKey, 1), sub: `drop here → ${fmtK(addDaysKey(todayKey, 1))}` },
          { id: "next", label: "Next week", drop: addDaysKey(todayKey, 8), sub: `drop here → ${fmtK(addDaysKey(todayKey, 8))}` },
          { id: "later", label: "Later", drop: addDaysKey(todayKey, 21), sub: `drop here → ${fmtK(addDaysKey(todayKey, 21))}` },
          { id: "backlog", label: "Unscheduled", drop: "unschedule", sub: "drop a to-do or post here to park it" },
        ];
        return (
          <div className="cal-board">
            {cols.map((col) => {
              const rows = col.id === "backlog" ? backlogItems.map((it) => ({ k: "", it })) : buckets[col.id];
              return (
                <div key={col.id} className={`bd-col${over === `bd-${col.id}` ? " over" : ""}`}
                  onDragOver={col.drop ? (e) => { e.preventDefault(); setOver(`bd-${col.id}`); } : undefined}
                  onDragLeave={col.drop ? () => setOver((o) => o === `bd-${col.id}` ? null : o) : undefined}
                  onDrop={col.drop ? () => { setOver(null); const dg = dragId.current; dragId.current = null; if (!dg) return; if (col.drop === "unschedule") unschedule(dg.kind, dg.id); else reschedule(dg.kind, dg.id, col.drop!); } : undefined}>
                  <div className="bd-h"><b>{col.label}</b><span className="bd-n">{rows.length}</span></div>
                  {col.sub && <div className="bd-sub">{col.sub}</div>}
                  {rows.length === 0 ? <div className="bd-empty">{col.id === "overdue" ? "nothing slipped" : "clear"}</div> : rows.map(({ k, it }) => (
                    <div key={`${it.kind}-${it.id}-${k}`} className="bd-card">
                      {k && <span className="bd-date">{fmtK(k)}{it.warn ? " ⚠" : ""}</span>}
                      <Chip it={it} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── CARDS — the next two months as detail cards; tap a card to edit in place ── */}
      {view === "cards" && (() => {
        const overdue = flat.filter(({ k, it }) => k < todayKey && !(it.kind === "todo" && it.done));
        const up = flat.filter(({ k }) => k >= todayKey);
        const card = ({ k, it }: { k: string; it: Item }) => {
          const d = new Date(`${k}T00:00:00`);
          return (
            <div key={`${it.kind}-${it.id}-${k}`} className={`calcard${it.done ? " done" : ""}${it.warn ? " warn" : ""}`} style={{ borderLeftColor: CAT[it.cat]?.color }}>
              <div className="calcard-d"><b>{d.getDate()}</b><span>{DOW[d.getDay()]}</span><span>{MON3[d.getMonth()]}</span></div>
              <button type="button" className="calcard-m" onClick={() => { if (isEditable(it.kind)) setEdit({ kind: it.kind, id: it.id }); else it.go(); }}>
                <b>{it.title}</b>
                <span>{CAT[it.cat]?.label}{it.meta ? ` · ${it.meta}` : ""}{it.warn ? " · past latest start" : ""}{k === todayKey ? " · today" : ""}</span>
              </button>
              {it.kind === "todo"
                ? <button type="button" className="dv-go" title="Mark done" onClick={() => it.toggle?.()}>{it.done ? "✓" : "○"}</button>
                : <button type="button" className="dv-go" title="Open" onClick={() => it.go()}>↗</button>}
            </div>
          );
        };
        return (
          <div className="cal-cards">
            {overdue.length > 0 && <><div className="dv-sub" style={{ marginTop: 12 }}>Overdue · {overdue.length}</div>{overdue.map(card)}</>}
            <div className="dv-sub" style={{ marginTop: 12 }}>Up next</div>
            {up.length === 0 ? <div className="h-sub" style={{ marginTop: 10 }}>Nothing coming up in the next two months.</div> : up.map(card)}
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

      {edit && <CalEdit kind={edit.kind} id={edit.id} events={events} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {dayOpen && <DayView dayKey={dayOpen} items={byDay[dayOpen] || []} events={events} onClose={() => setDayOpen(null)} onAdd={() => { const k = dayOpen; setDayOpen(null); setAddDay(k); }} onSaved={load} />}
      {addDay && <AddSheet day={addDay} events={events} onClose={() => setAddDay(null)} onDone={() => { setAddDay(null); load(); }} setSection={setSection} />}
    </div>
  );
}

// One day, expanded. Tap ANY card — event, truck stop, ops/admin to-do, or content — to EDIT it
// right here. Every edit saves straight back to its source row, so it relates back everywhere that
// row appears (Prep, Studio, My Tasks). The "↗" opens its full prep / run-of-show / studio. Archived
// events show here (and only here) so a removed event is still reachable by opening its day.
function DayView({ dayKey, items, events, onClose, onAdd, onSaved }: { dayKey: string; items: Item[]; events: Ev[]; onClose: () => void; onAdd: () => void; onSaved: () => void }) {
  const [archived, setArchived] = useState<{ id: string; title: string | null; day_label: string | null }[]>([]);
  const [edit, setEdit] = useState<{ kind: EditKind; id: string } | null>(null);
  useEffect(() => {
    if (!supabase) return;
    supabase.from("events").select("id, title, day_label").not("archived_at", "is", null).eq("day", dayKey).then(({ data }) => setArchived((data as any[]) ?? []));
  }, [dayKey]);
  const d = new Date(`${dayKey}T00:00:00`);
  const heading = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const sub: Record<Item["kind"], string> = { event: "event", stop: "on-the-ground op", todo: "to-do", content: "content", task: "task due", brew: "brew day", drop: "pack pickup", delivery: "porch run" };
  const clash = items.some((i) => i.kind === "event") && items.some((i) => i.kind === "stop");
  const brewLate = items.some((i) => i.warn);
  return (
    <>
    <Sheet open onClose={onClose} header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>{heading}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>}>
          {items.length === 0 && archived.length === 0 && <div className="oa-empty" style={{ padding: "18px 8px" }}>Nothing scheduled this day. Tap Add to put something here.</div>}
          {clash && <div className="dv-heads">Heads up: event + truck stop share this day.</div>}
          {brewLate && <div className="dv-heads">Heads up: a brew here is past its latest start.</div>}
          <div className="dv-list">
            {items.map((it) => !isEditable(it.kind) ? (
              // read-only rollup (brew / drop / delivery) — the rows live on their own surface; tap through
              <div key={`${it.kind}-${it.id}`} className="dv-row" style={{ ["--c" as string]: CAT[it.cat]?.color }}>
                <span className="dv-dot" style={{ background: CAT[it.cat]?.color }} />
                <button type="button" className="dv-main dv-tap" onClick={() => { it.go(); onClose(); }}>
                  <b>{it.title}</b><span>{CAT[it.cat]?.label} · {sub[it.kind]}{it.warn ? " · past latest start" : ""} · tap to open</span>
                </button>
              </div>
            ) : (
              <div key={`${it.kind}-${it.id}`} className={`dv-row${it.done ? " done" : ""}`} style={{ ["--c" as string]: CAT[it.cat]?.color }}>
                <span className="dv-dot" style={{ background: CAT[it.cat]?.color }} />
                {/* every editable kind edits in place — tap the card to open its editor */}
                <button type="button" className="dv-main dv-tap" onClick={() => setEdit({ kind: it.kind as EditKind, id: it.id })}>
                  <b>{it.title}</b><span>{CAT[it.cat]?.label}{it.meta ? ` · ${it.meta}` : ` · ${sub[it.kind]}`} · tap to edit</span>
                </button>
                {it.kind === "todo"
                  ? <button type="button" className="dv-go" title="Mark done" onClick={() => it.toggle?.()}>{it.done ? "✓" : "○"}</button>
                  : <button type="button" className="dv-go" title={it.kind === "content" ? "Open in Studio" : "Open full prep"} onClick={() => { it.go(); onClose(); }}>↗</button>}
              </div>
            ))}
            {archived.length > 0 && (
              <>
                <div className="dv-sub">Removed (archived)</div>
                {archived.map((a) => (
                  <div key={a.id} className="dv-row arch"><span className="dv-dot" style={{ background: "#9a8f7c" }} /><span className="dv-main"><b>{a.title || a.day_label || "Event"}</b><span>archived — no longer on the calendar</span></span></div>
                ))}
              </>
            )}
          </div>
          <div className="prod-actions" style={{ marginTop: 14 }}><span /><button type="button" className="note-save" onClick={onAdd}>+ Add to this day</button></div>
    </Sheet>
    {edit && <CalEdit kind={edit.kind} id={edit.id} events={events} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onSaved(); }} />}
    </>
  );
}

// Polymorphic in-place editor for ANY calendar card. It dispatches on `kind` to read + write the one
// source row that backs the chip — events / stops / todos / content_items — so the calendar is a true
// command surface over the database, not a copy. The "Link to event" control on to-dos and content
// writes the foreign key that relates those rows back to an event. Reachable wherever the item shows.
const SRC: Record<EditKind, { table: string; nameCol: string; dateCol: string; dateIsTimestamp: boolean; defTime: string; noun: string }> = {
  event:   { table: "events",        nameCol: "title", dateCol: "day",           dateIsTimestamp: false, defTime: "11:00", noun: "event" },
  stop:    { table: "stops",         nameCol: "name",  dateCol: "starts_at",     dateIsTimestamp: true,  defTime: "11:00", noun: "truck stop" },
  todo:    { table: "todos",         nameCol: "title", dateCol: "due_on",        dateIsTimestamp: false, defTime: "09:00", noun: "to-do" },
  content: { table: "content_items", nameCol: "title", dateCol: "scheduled_for", dateIsTimestamp: true,  defTime: "09:00", noun: "content" },
  task:    { table: "event_tasks",   nameCol: "label", dateCol: "due_at",        dateIsTimestamp: true,  defTime: "23:59", noun: "task" },
};
function CalEdit({ kind, id, events, onClose, onSaved }: { kind: EditKind; id: string; events: Ev[]; onClose: () => void; onSaved: () => void }) {
  const cfg = SRC[kind];
  const { setSection } = useOperatorSection();
  const [f, setF] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [planOpen, setPlanOpen] = useState(false); // time blocks / run-of-show, right from the calendar
  const sel = kind === "event" ? "title, day, location_text, stage"
    : kind === "stop" ? "name, starts_at, location_text"
    : kind === "todo" ? "title, due_on, category, event_id, done"
    : "title, scheduled_for, status, event_id";
  useEffect(() => {
    if (!supabase) return;
    supabase.from(cfg.table).select(sel).eq("id", id).maybeSingle().then(({ data }) => setF(data ?? {}));
  }, [cfg.table, sel, id]);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const localDate = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  // a date input <-> the source column, preserving the existing time-of-day on timestamp columns
  const dateVal = !f ? "" : cfg.dateIsTimestamp ? (f[cfg.dateCol] ? localDate(f[cfg.dateCol]) : "") : (f[cfg.dateCol] || "");
  const onDate = (v: string) => {
    if (!cfg.dateIsTimestamp) { set(cfg.dateCol, v || null); return; }
    if (!v) { set(cfg.dateCol, null); return; }
    const old = f[cfg.dateCol] ? new Date(f[cfg.dateCol]) : null;
    const hh = old ? `${String(old.getHours()).padStart(2, "0")}:${String(old.getMinutes()).padStart(2, "0")}` : cfg.defTime;
    set(cfg.dateCol, new Date(`${v}T${hh}:00`).toISOString());
  };
  const save = async () => {
    if (!supabase || !f) return;
    setSaving(true);
    const name = (f[cfg.nameCol] || "").trim() || (kind === "event" ? "Event" : kind === "stop" ? "Stop" : kind === "todo" ? "To-do" : "Content");
    const patch: any = { [cfg.nameCol]: name, [cfg.dateCol]: f[cfg.dateCol] || null };
    if (kind === "event") { patch.location_text = f.location_text?.trim() || null; patch.stage = f.stage || "confirmed"; }
    else if (kind === "stop") { patch.location_text = f.location_text?.trim() || null; }
    else if (kind === "todo") { patch.category = f.category || "ops"; patch.event_id = f.event_id || null; }
    else if (kind === "content") { patch.status = f.status || "scheduled"; patch.event_id = f.event_id || null; }
    await supabase.from(cfg.table).update(patch).eq("id", id);
    setSaving(false); onSaved();
  };
  // "Remove from calendar" — kind-appropriate: archive the event/stop, unschedule content, delete the to-do.
  const remove = async () => {
    if (!supabase) return;
    if (typeof window !== "undefined" && !window.confirm(kind === "content" ? "Unschedule this from the calendar? (It stays in Studio.)" : kind === "todo" ? "Delete this to-do?" : "Remove from the calendar?")) return;
    setSaving(true);
    if (kind === "todo") await supabase.from("todos").delete().eq("id", id);
    else if (kind === "content") await supabase.from("content_items").update({ scheduled_for: null }).eq("id", id);
    else await supabase.from(cfg.table).update({ archived_at: new Date().toISOString() }).eq("id", id);
    setSaving(false); onSaved();
  };
  if (!f) return null;
  const linkable = kind === "todo" || kind === "content";
  return (
    <>
    {planOpen && f && (kind === "event" || kind === "stop") && (
      <EventDayPlanner
        ownerType={kind === "stop" ? "stop" : "event"}
        eventId={id}
        title={f[cfg.nameCol] || cfg.noun}
        eventDay={kind === "stop" ? (f.starts_at ? localDate(f.starts_at) : null) : (f.day || null)}
        planDays={1}
        onPlanDays={async (n) => { if (supabase) await supabase.from(cfg.table).update({ plan_days: n }).eq("id", id); }}
        onClose={() => setPlanOpen(false)}
      />
    )}
    <Sheet open onClose={onClose} className="dp-form" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>Edit {cfg.noun}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>}>
          <input className="note-in" value={f[cfg.nameCol] ?? ""} onChange={(e) => set(cfg.nameCol, e.target.value)} placeholder={`${cfg.noun[0].toUpperCase() + cfg.noun.slice(1)} name`} autoFocus />
          <div className="prod-grid" style={{ marginTop: 10 }}>
            <label className="prod-f"><span>Date</span><input type="date" value={dateVal} onChange={(e) => onDate(e.target.value)} /></label>
            {(kind === "event" || kind === "stop") && <label className="prod-f"><span>Location</span><input value={f.location_text ?? ""} onChange={(e) => set("location_text", e.target.value)} placeholder="Where" /></label>}
            {kind === "todo" && (
              <label className="prod-f"><span>Category</span>
                <select value={f.category ?? "ops"} onChange={(e) => set("category", e.target.value)}>
                  <option value="admin">Admin</option><option value="ops">Ops</option><option value="event">Events</option><option value="content">Content</option>
                </select>
              </label>
            )}
            {kind === "content" && (
              <label className="prod-f"><span>Status</span>
                <select value={f.status ?? "scheduled"} onChange={(e) => set("status", e.target.value)}>
                  <option value="draft">Draft</option><option value="review">In review</option><option value="changes">Changes</option><option value="approved">Approved</option><option value="scheduled">Scheduled</option><option value="published">Published</option>
                </select>
              </label>
            )}
          </div>
          {kind === "event" && (
            <label className="prod-f" style={{ marginTop: 8 }}><span>Stage</span>
              <select value={f.stage ?? "confirmed"} onChange={(e) => set("stage", e.target.value)}>
                <option value="lead">Lead</option><option value="confirmed">Confirmed</option><option value="prep">Prep</option><option value="live">Live</option><option value="done">Done</option>
              </select>
            </label>
          )}
          {linkable && (
            <label className="prod-f" style={{ marginTop: 8 }}><span>Link to event</span>
              <select value={f.event_id ?? ""} onChange={(e) => set("event_id", e.target.value || null)}>
                <option value="">None</option>
                {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title || ev.day_label || "Event"}</option>)}
              </select>
            </label>
          )}
          {kind === "content" && <button type="button" className="cal-tolink" style={{ marginTop: 10, marginLeft: 0 }} onClick={() => { setSection("studio"); onClose(); }}>Open full editor in Studio ↗</button>}
          {(kind === "event" || kind === "stop") && (
            <div className="prod-actions" style={{ marginTop: 10, gap: 8 }}>
              <button type="button" className="cal-tolink" style={{ marginLeft: 0 }} onClick={() => setPlanOpen(true)}>⏱ Time blocks</button>
              <button type="button" className="cal-tolink" style={{ marginLeft: 0 }} onClick={() => { try { localStorage.setItem("gt3-prep-open", kind === "stop" ? `stop:${id}` : id); } catch { /* ignore */ } setSection("prep"); onClose(); }}>Open full prep hub ↗</button>
            </div>
          )}
          <div className="prod-actions" style={{ marginTop: 14, justifyContent: "space-between" }}>
            <button type="button" className="note-arch" onClick={remove} disabled={saving}>{kind === "content" ? "Unschedule" : kind === "todo" ? "Delete" : "Remove"}</button>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
              <button type="button" className="note-save" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
    </Sheet>
    </>
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

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const r = await authedFetch("/api/outlook/status");
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
    const r = await authedFetch("/api/outlook/connect");
    const j = await r.json();
    if (j.ok && j.url) window.location.href = j.url; else { setMsg(j.error || "Couldn't start Outlook connect."); setBusy(null); }
  };
  const sync = async () => {
    setBusy("sync"); setMsg(null);
    const r = await authedFetch("/api/outlook/sync", { method: "POST" });
    const j = await r.json();
    setMsg(j.ok ? `Synced — ${j.note}.` : (j.error || "Sync failed."));
    setBusy(null); if (j.ok) { onSynced(); refresh(); }
  };
  const disconnect = async () => {
    if (typeof window !== "undefined" && !window.confirm("Disconnect Outlook?")) return;
    setBusy("dc");
    await authedFetch("/api/outlook/disconnect", { method: "POST" });
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
  const [kind, setKind] = useState<"todo" | "event" | "stop">("todo");
  const [title, setTitle] = useState(""); const [cat, setCat] = useState("ops"); const [eventId, setEventId] = useState(""); const [where, setWhere] = useState("");
  const save = async () => {
    if (!supabase || !title.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (kind === "todo") await supabase.from("todos").insert({ title: title.trim(), category: cat, due_on: day, event_id: eventId || null, created_by: user?.id ?? null });
    // local wall-clock 11am — a fixed -04:00 offset lands at 10am all winter
    else if (kind === "stop") await supabase.from("stops").insert({ name: title.trim(), location_text: where.trim() || null, starts_at: new Date(`${day}T11:00:00`).toISOString(), status: "upcoming", sort: 0 });
    else await supabase.from("events").insert({ title: title.trim(), day, category: cat === "content" ? "event" : cat });
    onDone();
  };
  return (
    <Sheet open onClose={onClose} header={<div style={{ display: "flex", alignItems: "center" }}><button type="button" className={`qd-tab${kind === "todo" ? " on" : ""}`} onClick={() => setKind("todo")}>To-do</button><button type="button" className={`qd-tab${kind === "stop" ? " on" : ""}`} onClick={() => setKind("stop")}>🚚 Truck stop</button><button type="button" className={`qd-tab${kind === "event" ? " on" : ""}`} onClick={() => setKind("event")}>Event</button><span style={{ marginLeft: "auto", fontFamily: "Inter", fontSize: 13, color: "var(--cream-m)" }}>{day}</span><button type="button" className="qd-x" onClick={onClose}>✕</button></div>}>
          <input className="note-in" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "todo" ? "What needs doing?" : kind === "stop" ? "Stop name — e.g. Saturday Market" : "Event name"} autoFocus />
          {kind === "stop" ? (
            <>
              <label className="prod-f" style={{ marginTop: 10 }}><span>Where (address or place)</span><input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="123 Main St, City — or a place name" /></label>
              <div className="dp-hint" style={{ marginTop: 8 }}>Lands on this day&apos;s route at 11am (edit the time later). Add the address in the stop&apos;s editor to pin it on the map.</div>
            </>
          ) : (
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
          )}
          <div className="prod-actions" style={{ marginTop: 14 }}>
            <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
            <button type="button" className="note-save" onClick={save} disabled={!title.trim()}>Add</button>
          </div>
    </Sheet>
  );
}
