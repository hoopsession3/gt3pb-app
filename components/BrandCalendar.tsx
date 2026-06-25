"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useOperatorSection } from "./OperatorNav";

// BRAND CALENDAR — the planning brain of Studio. Posts (scheduled content) + events roll onto one
// month view so Ryan + Kayla see the whole picture and build FROM it.
// - Integrated: real events + content on one surface; create on a day, open a piece, drag to move.
// - Sticky: the month bar + weekday header stay pinned while you scroll; the month you're on is
//   remembered across sessions.
// - Relational: a piece can belong to an event (content_items.event_id). Start a post on an event's
//   day and it auto-links; linked posts show the tie. Reschedules sync live via Supabase Realtime.
/* eslint-disable @typescript-eslint/no-explicit-any */

type CItem = { id: string; title: string; status: string; channel: string; scheduled_for: string | null; event_id: string | null };
type EvItem = { id: string; title: string | null; day: string; day_label: string | null };

const STC: Record<string, string> = { draft: "#9a8f7c", review: "var(--gold2)", changes: "#d2554a", approved: "#7bbf6a", scheduled: "#6fa8dc", published: "#7bbf6a" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function BrandCalendar({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: (iso: string, eventId?: string | null) => void }) {
  const { setSection } = useOperatorSection();
  const goToCompany = () => setSection("plan");
  const now = new Date();
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), now.getDate())); // always open on today
  const setMonth = (d: Date) => setCursor(d);
  const [content, setContent] = useState<CItem[]>([]);
  const [events, setEvents] = useState<EvItem[]>([]);
  const [backlog, setBacklog] = useState<CItem[]>([]);
  const [over, setOver] = useState<string | null>(null);
  const [focusEvent, setFocusEvent] = useState<string | null>(null); // highlight a relationship
  const [dayOpen, setDayOpen] = useState<string | null>(null); // tap a day → its detail
  const [editId, setEditId] = useState<string | null>(null);  // quick in-place edit of a piece
  const dragId = useRef<string | null>(null);

  const days = useMemo(() => {
    const start = new Date(cursor); start.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const from = key(days[0]), to = key(days[41]);
    const [c, e, b] = await Promise.all([
      supabase.from("content_items").select("id, title, status, channel, scheduled_for, event_id").not("scheduled_for", "is", null).gte("scheduled_for", `${from}T00:00:00`).lte("scheduled_for", `${to}T23:59:59`),
      supabase.from("events").select("id, title, day, day_label").is("archived_at", null).gte("day", from).lte("day", to),
      supabase.from("content_items").select("id, title, status, channel, scheduled_for, event_id").is("scheduled_for", null).neq("status", "published").order("updated_at", { ascending: false }).limit(24),
    ]);
    setContent((c.data as CItem[]) ?? []); setEvents((e.data as EvItem[]) ?? []); setBacklog((b.data as CItem[]) ?? []);
  }, [days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel("studio-cal").on("postgres_changes", { event: "*", schema: "public", table: "content_items" }, () => load()).subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  const evTitle = useCallback((id: string | null) => id ? (events.find((e) => e.id === id)?.title ?? "linked event") : "", [events]);
  const byDay = useMemo(() => {
    const m: Record<string, { posts: CItem[]; evs: EvItem[] }> = {};
    for (const d of days) m[key(d)] = { posts: [], evs: [] };
    for (const c of content) if (c.scheduled_for) { const k = key(new Date(c.scheduled_for)); if (m[k]) m[k].posts.push(c); }
    for (const e of events) if (m[e.day]) m[e.day].evs.push(e);
    return m;
  }, [days, content, events]);

  const reschedule = async (id: string, dayKey: string) => {
    if (!supabase) return;
    const it = [...content, ...backlog].find((c) => c.id === id);
    const prev = it?.scheduled_for ? new Date(it.scheduled_for) : null;
    const [y, mo, da] = dayKey.split("-").map(Number);
    const dt = new Date(y, mo - 1, da, prev ? prev.getHours() : 9, prev ? prev.getMinutes() : 0);
    setBacklog((b) => b.filter((x) => x.id !== id));
    await supabase.from("content_items").update({ scheduled_for: dt.toISOString() }).eq("id", id);
    load();
  };
  const drop = (dayKey: string) => { setOver(null); const id = dragId.current; dragId.current = null; if (id) reschedule(id, dayKey); };

  const monthName = `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  const todayKey = key(now);

  const Chip = ({ c, inCell }: { c: CItem; inCell?: boolean }) => {
    const linked = !!c.event_id; const lit = focusEvent && c.event_id === focusEvent;
    return (
      <button type="button" draggable className={`cal-chip${inCell ? "" : " backlog"}${lit ? " lit" : ""}`} style={{ borderLeftColor: STC[c.status] ?? "#9a8f7c" }}
        onDragStart={() => { dragId.current = c.id; }} onClick={(e) => { e.stopPropagation(); onOpen(c.id); }}
        onMouseEnter={() => linked && setFocusEvent(c.event_id)} onMouseLeave={() => setFocusEvent(null)}
        title={`${c.title} · ${c.status}${linked ? ` · ↔ ${evTitle(c.event_id)}` : ""}`}>
        <span className="cal-chip-dot" style={{ background: STC[c.status] ?? "#9a8f7c" }} />{linked ? "🔗 " : ""}{c.title || "Untitled"}
      </button>
    );
  };

  return (
    <div className="cal">
      <div className="cal-titlebar">
        <span className="cal-eyebrow">🎨 Content schedule</span>
        <button type="button" className="cal-tolink" onClick={() => { if (typeof window !== "undefined") localStorage.setItem("gt3-plan-tab", "calendar"); goToCompany(); }}>Company calendar ↗</button>
      </div>
      <div className="cal-sticky">
        <div className="cal-bar">
          <div className="cal-nav">
            <button type="button" className="cal-arrow" onClick={() => setMonth(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month">‹</button>
            <span className="cal-month">{monthName}</span>
            <button type="button" className="cal-arrow" onClick={() => setMonth(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month">›</button>
          </div>
          <button type="button" className="cal-today" onClick={() => setMonth(new Date(now.getFullYear(), now.getMonth(), 1))}>Today</button>
        </div>
        <div className="cal-dow">{DOW.map((d) => <div key={d} className="cal-dow-c">{d}</div>)}</div>
      </div>

      <div className="cal-grid">
        {days.map((d) => {
          const k = key(d); const cell = byDay[k]; const dim = d.getMonth() !== cursor.getMonth();
          const dayEv = cell.evs[0]?.id ?? null;
          return (
            <div key={k} role="button" tabIndex={0} className={`cal-cell${dim ? " dim" : ""}${over === k ? " over" : ""}${k === todayKey ? " today" : ""}`}
              onClick={() => setDayOpen(k)}
              onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver((o) => (o === k ? null : o))} onDrop={() => drop(k)}>
              <div className="cal-cell-h">
                <span className="cal-date">{d.getDate()}</span>
                <button type="button" className="cal-add" onClick={(e) => { e.stopPropagation(); onCreate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0).toISOString(), dayEv); }} aria-label="New piece this day">+</button>
              </div>
              <div className="cal-items">
                {cell.evs.map((e) => (
                  <div key={e.id} className={`cal-ev${focusEvent === e.id ? " lit" : ""}`} title={e.title || "Event"}
                    onMouseEnter={() => setFocusEvent(e.id)} onMouseLeave={() => setFocusEvent(null)}>📍 {e.title || e.day_label || "Event"}</div>
                ))}
                {cell.posts.map((c) => <Chip key={c.id} c={c} inCell />)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="cal-backlog">
        <div className="insp-lbl">Unscheduled — drag onto a day to plan it</div>
        <div className="cal-backlog-row">
          {backlog.length === 0 ? <span className="cal-empty">Nothing waiting. Tap a day&apos;s + to start a piece.</span> : backlog.map((c) => <Chip key={c.id} c={c} />)}
        </div>
      </div>

      {dayOpen && (
        <DayView dayKey={dayOpen} posts={byDay[dayOpen]?.posts ?? []} evs={byDay[dayOpen]?.evs ?? []} evTitle={evTitle}
          onClose={() => setDayOpen(null)} onEdit={(id) => setEditId(id)} onOpenFull={(id) => { setDayOpen(null); onOpen(id); }}
          onAdd={() => { const [y, mo, da] = dayOpen.split("-").map(Number); const evId = byDay[dayOpen]?.evs[0]?.id ?? null; setDayOpen(null); onCreate(new Date(y, mo - 1, da, 9, 0).toISOString(), evId); }} />
      )}
      {editId && <ContentEdit id={editId} events={events} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); load(); }} onOpenFull={(id) => { setEditId(null); onOpen(id); }} />}
    </div>
  );
}

// One day, expanded — the Studio mirror of the Company calendar's day view. Tap a piece to edit it in
// place (date, time, status, link-to-event); events are shown for context. "↗" opens the full editor.
function DayView({ dayKey, posts, evs, evTitle, onClose, onEdit, onOpenFull, onAdd }: { dayKey: string; posts: CItem[]; evs: EvItem[]; evTitle: (id: string | null) => string; onClose: () => void; onEdit: (id: string) => void; onOpenFull: (id: string) => void; onAdd: () => void }) {
  const d = new Date(`${dayKey}T00:00:00`);
  const heading = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return (
    <div className="qd-scrim" onClick={onClose}>
      <div className="qd-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="qd-tabs"><b style={{ fontFamily: "Inter", fontSize: 15 }}>{heading}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>
        <div className="qd-body">
          {posts.length === 0 && evs.length === 0 && <div className="oa-empty" style={{ padding: "18px 8px" }}>Nothing this day. Tap + New piece to start one.</div>}
          <div className="dv-list">
            {evs.map((e) => (
              <div key={e.id} className="dv-row" style={{ ["--c" as string]: "#6fa8dc" }}>
                <span className="dv-dot" style={{ background: "#6fa8dc" }} />
                <span className="dv-main"><b>📍 {e.title || e.day_label || "Event"}</b><span>event · plan content around it</span></span>
              </div>
            ))}
            {posts.map((c) => (
              <div key={c.id} className="dv-row" style={{ ["--c" as string]: STC[c.status] ?? "#9a8f7c" }}>
                <span className="dv-dot" style={{ background: STC[c.status] ?? "#9a8f7c" }} />
                <button type="button" className="dv-main dv-tap" onClick={() => onEdit(c.id)}>
                  <b>{c.event_id ? "🔗 " : ""}{c.title || "Untitled"}</b>
                  <span>{c.status} · {c.channel}{c.event_id ? ` · ↔ ${evTitle(c.event_id)}` : ""} · tap to edit</span>
                </button>
                <button type="button" className="dv-go" title="Open full editor" onClick={() => onOpenFull(c.id)}>↗</button>
              </div>
            ))}
          </div>
          <div className="prod-actions" style={{ marginTop: 14 }}><span /><button type="button" className="note-save" onClick={onAdd}>+ New piece</button></div>
        </div>
      </div>
    </div>
  );
}

// Quick in-place editor for a scheduled piece — date, time, status, and the event link, written
// straight to content_items. "Open full editor" jumps to Studio for hook/caption/Canva.
function ContentEdit({ id, events, onClose, onSaved, onOpenFull }: { id: string; events: EvItem[]; onClose: () => void; onSaved: () => void; onOpenFull: (id: string) => void }) {
  const [f, setF] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (supabase) supabase.from("content_items").select("title, scheduled_for, status, event_id, channel").eq("id", id).maybeSingle().then(({ data }) => setF(data ?? {})); }, [id]);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const localDate = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const localTime = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const save = async () => {
    if (!supabase || !f) return;
    setSaving(true);
    await supabase.from("content_items").update({ title: (f.title || "").trim() || "Untitled", scheduled_for: f.scheduled_for || null, status: f.status || "draft", event_id: f.event_id || null }).eq("id", id);
    setSaving(false); onSaved();
  };
  const unschedule = async () => { if (!supabase) return; setSaving(true); await supabase.from("content_items").update({ scheduled_for: null }).eq("id", id); setSaving(false); onSaved(); };
  if (!f) return null;
  const dateVal = f.scheduled_for ? localDate(f.scheduled_for) : "";
  const timeVal = f.scheduled_for ? localTime(f.scheduled_for) : "09:00";
  const setDT = (date: string, time: string) => { if (!date) { set("scheduled_for", null); return; } set("scheduled_for", new Date(`${date}T${time || "09:00"}:00`).toISOString()); };
  return (
    <div className="qd-scrim dp-scrim2" onClick={onClose}>
      <div className="qd-sheet dp-form" onClick={(e) => e.stopPropagation()}>
        <div className="qd-tabs"><b style={{ fontFamily: "Inter", fontSize: 15 }}>Edit piece</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>
        <div className="qd-body">
          <input className="note-in" value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="Title" autoFocus />
          <div className="prod-grid" style={{ marginTop: 10 }}>
            <label className="prod-f"><span>Date</span><input type="date" value={dateVal} onChange={(e) => setDT(e.target.value, timeVal)} /></label>
            <label className="prod-f"><span>Time</span><input type="time" value={timeVal} onChange={(e) => setDT(dateVal, e.target.value)} /></label>
            <label className="prod-f"><span>Status</span>
              <select value={f.status ?? "draft"} onChange={(e) => set("status", e.target.value)}>
                <option value="draft">Draft</option><option value="review">In review</option><option value="changes">Changes</option><option value="approved">Approved</option><option value="scheduled">Scheduled</option><option value="published">Published</option>
              </select>
            </label>
            <label className="prod-f"><span>Link to event</span>
              <select value={f.event_id ?? ""} onChange={(e) => set("event_id", e.target.value || null)}>
                <option value="">None</option>
                {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title || ev.day_label || "Event"}</option>)}
              </select>
            </label>
          </div>
          <button type="button" className="cal-tolink" style={{ marginTop: 10, marginLeft: 0 }} onClick={() => onOpenFull(id)}>Open full editor (hook, caption, Canva) ↗</button>
          <div className="prod-actions" style={{ marginTop: 14, justifyContent: "space-between" }}>
            <button type="button" className="note-arch" onClick={unschedule} disabled={saving}>Unschedule</button>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
              <button type="button" className="note-save" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
