"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import Sheet from "@/components/Sheet";
import { useOperatorSection } from "./OperatorNav";
import { CAL_CAT, CONTENT_STATUS as STC } from "@/lib/calendarTokens";
import { localDayBoundsISO } from "@/lib/calendarMath";
import { isBlank } from "@/lib/formGuard";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import Icon from "@/components/Icon";
import { clickable } from "@/lib/a11y";

// BRAND CALENDAR — the planning brain of Studio. Posts (scheduled content) + events roll onto one
// month view so Ryan + Kayla see the whole picture and build FROM it.
// - Integrated: real events + content on one surface; create on a day, open a piece, drag to move.
// - Sticky: the month bar + weekday header stay pinned while you scroll; the month you're on is
//   remembered across sessions.
// - Relational: a piece can belong to an event (content_items.event_id). Start a post on an event's
//   day and it auto-links; linked posts show the tie. Reschedules sync live via Supabase Realtime.
// Fetch state via useAsyncData — a failed load is a real error now, not a silently empty calendar.
/* eslint-disable @typescript-eslint/no-explicit-any */

type CItem = { id: string; title: string; status: string; channel: string; scheduled_for: string | null; event_id: string | null };
type EvItem = { id: string; title: string | null; day: string; day_label: string | null };
type Board = { content: CItem[]; events: EvItem[]; backlog: CItem[] };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function BrandCalendar({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: (iso: string, eventId?: string | null) => void }) {
  const { setSection } = useOperatorSection();
  const { toast } = useApp();
  const goToCompany = () => setSection("plan");
  const now = new Date();
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), now.getDate())); // always open on today
  const setMonth = (d: Date) => setCursor(d);
  const [over, setOver] = useState<string | null>(null);
  const [focusEvent, setFocusEvent] = useState<string | null>(null); // highlight a relationship
  const [dayOpen, setDayOpen] = useState<string | null>(null); // tap a day → its detail
  const [editId, setEditId] = useState<string | null>(null);  // quick in-place edit of a piece
  const dragId = useRef<string | null>(null);
  // Week is the default — a spacious, readable agenda of the next seven days; Month is the zoomed-out
  // grid. The choice is remembered. (First render is deterministic "week" for SSR; the stored pref,
  // if any, is applied right after mount.)
  const [view, setView] = useState<"week" | "month">("week");
  useEffect(() => { try { const v = localStorage.getItem("gt3-cal-view"); if (v === "week" || v === "month") setView(v); } catch { /* */ } }, []);
  const setCalView = (v: "week" | "month") => { setView(v); try { localStorage.setItem("gt3-cal-view", v); } catch { /* */ } };
  const addDays = (base: Date, n: number) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };

  const days = useMemo(() => {
    // Anchor the grid to the FIRST of the cursor's month, then back up to that week's Sunday. Using
    // `cursor` directly broke the current month: on first open cursor is TODAY (e.g. the 11th), so
    // `setDate(1 - getDay())` measured off the 11th and started the grid days early — every cell
    // slid columns and "today" landed under the wrong weekday (Sat 7/11 showing as Tuesday). Months
    // reached via the arrows set cursor to the 1st, which is why only the opening month was off.
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    start.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);

  // The visible week (Sun→Sat around the cursor). Its day-keys are a subset of the 42-cell `days`
  // span, so byDay + the load() query already cover it — no extra fetch.
  const weekDays = useMemo(() => {
    const s = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    s.setDate(s.getDate() - s.getDay());
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }, [cursor]);
  const goPrev = () => setCursor(view === "week" ? addDays(cursor, -7) : new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  const goNext = () => setCursor(view === "week" ? addDays(cursor, 7) : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  const goToday = () => setCursor(new Date(now.getFullYear(), now.getMonth(), now.getDate()));

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { content: [], events: [], backlog: [] };
    // Shared UTC-bounding math (lib/calendarMath) — events.day keys off local calendar strings.
    const fromKey = key(days[0]), toKey = key(days[41]);
    const { fromISO, toISO } = localDayBoundsISO(days[0], days[41]);
    const [c, e, b] = await Promise.all([
      supabase.from("content_items").select("id, title, status, channel, scheduled_for, event_id").not("scheduled_for", "is", null).gte("scheduled_for", fromISO).lt("scheduled_for", toISO),
      supabase.from("events").select("id, title, day, day_label").is("archived_at", null).gte("day", fromKey).lte("day", toKey),
      supabase.from("content_items").select("id, title, status, channel, scheduled_for, event_id").is("scheduled_for", null).neq("status", "published").order("updated_at", { ascending: false }).limit(24),
    ]);
    const firstErr = [c, e, b].find((x) => x.error)?.error;
    if (firstErr) throw new Error(firstErr.message);
    return { content: (c.data as CItem[]) ?? [], events: (e.data as EvItem[]) ?? [], backlog: (b.data as CItem[]) ?? [] };
  }, [days]);
  const board = useAsyncData(loader, [days]);
  const { reload } = board;
  useRealtimeTable(["content_items", "events"], reload);
  const content = board.data?.content ?? [];
  const events = board.data?.events ?? [];
  const backlog = board.data?.backlog ?? [];

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
    const { error } = await supabase.from("content_items").update({ scheduled_for: dt.toISOString() }).eq("id", id);
    if (error) toast("Couldn't move that piece — check your role or connection.", "error");
    reload();
  };
  const drop = (dayKey: string) => { setOver(null); const id = dragId.current; dragId.current = null; if (id) reschedule(id, dayKey); };

  const monthName = `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  const weekLabel = (() => {
    const a = weekDays[0], b = weekDays[6];
    const mA = MONTHS[a.getMonth()].slice(0, 3), mB = MONTHS[b.getMonth()].slice(0, 3);
    return a.getMonth() === b.getMonth() ? `${mA} ${a.getDate()}–${b.getDate()}` : `${mA} ${a.getDate()} – ${mB} ${b.getDate()}`;
  })();
  const todayKey = key(now);

  const Chip = ({ c, inCell }: { c: CItem; inCell?: boolean }) => {
    const linked = !!c.event_id; const lit = focusEvent && c.event_id === focusEvent;
    return (
      <button type="button" draggable className={`cal-chip${inCell ? "" : " backlog"}${lit ? " lit" : ""}`} style={{ borderLeftColor: STC[c.status] ?? "#9a8f7c" }}
        onDragStart={() => { dragId.current = c.id; }} onClick={(e) => { e.stopPropagation(); onOpen(c.id); }}
        onMouseEnter={() => linked && setFocusEvent(c.event_id)} onMouseLeave={() => setFocusEvent(null)}
        title={`${c.title} · ${c.status}${linked ? ` · ↔ ${evTitle(c.event_id)}` : ""}`}>
        <span className="cal-chip-dot" style={{ background: STC[c.status] ?? "#9a8f7c" }} />{linked ? <><Icon name="link" /> {c.title || "Untitled"}</> : (c.title || "Untitled")}
      </button>
    );
  };

  // Week view uses a fuller, full-width chip — a status rail + title + a sub line (status · channel ·
  // time). More room than a month cell, so we say more.
  const WChip = ({ c }: { c: CItem }) => {
    const linked = !!c.event_id;
    const t = c.scheduled_for ? new Date(c.scheduled_for) : null;
    const time = t ? t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    return (
      <button type="button" draggable className="calw-chip" style={{ ["--st" as string]: STC[c.status] ?? "#9a8f7c" }}
        onDragStart={() => { dragId.current = c.id; }} onClick={() => onOpen(c.id)}
        title={`${c.title} · ${c.status}${linked ? ` · ↔ ${evTitle(c.event_id)}` : ""}`}>
        <span className="calw-chip-rail" />
        <span className="calw-chip-main">
          <b>{linked ? <><Icon name="link" /> {c.title || "Untitled"}</> : (c.title || "Untitled")}</b>
          <span className="calw-chip-sub">{c.status}{c.channel ? ` · ${c.channel}` : ""}{time ? ` · ${time}` : ""}</span>
        </span>
      </button>
    );
  };

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load the content calendar" emptyTitle="Nothing here yet">
      {() => (
    <div className="cal">
      <div className="cal-titlebar">
        <span className="cal-eyebrow">Content schedule</span>
        <button type="button" className="cal-tolink" onClick={() => { if (typeof window !== "undefined") localStorage.setItem("gt3-plan-tab", "calendar"); goToCompany(); }}>Company calendar <Icon name="externalLink" /></button>
      </div>
      <div className="cal-sticky">
        <div className="cal-bar">
          <div className="cal-nav">
            <button type="button" className="cal-arrow" onClick={goPrev} aria-label={view === "week" ? "Previous week" : "Previous month"}>‹</button>
            <span className="cal-month">{view === "week" ? weekLabel : monthName}</span>
            <button type="button" className="cal-arrow" onClick={goNext} aria-label={view === "week" ? "Next week" : "Next month"}>›</button>
          </div>
          <div className="cal-barx">
            <div className="cal-viewtog" role="tablist" aria-label="Calendar view">
              <button type="button" role="tab" aria-selected={view === "week"} className={`cal-vt${view === "week" ? " on" : ""}`} onClick={() => setCalView("week")}>Week</button>
              <button type="button" role="tab" aria-selected={view === "month"} className={`cal-vt${view === "month" ? " on" : ""}`} onClick={() => setCalView("month")}>Month</button>
            </div>
            <button type="button" className="cal-today" onClick={goToday}>Today</button>
          </div>
        </div>
        {view === "month" && <div className="cal-dow">{DOW.map((d) => <div key={d} className="cal-dow-c">{d}</div>)}</div>}
      </div>

      {backlog.length > 0 && (
        <div className="cal-backlog cal-backlog-top">
          <div className="insp-lbl">Unscheduled · {backlog.length} — tap to open &amp; set a date, or drag onto a day</div>
          <div className="cal-backlog-row">
            {backlog.map((c) => <Chip key={c.id} c={c} />)}
          </div>
        </div>
      )}

      {view === "week" ? (
        <div className="calw">
          {weekDays.map((d) => {
            const k = key(d); const cell = byDay[k] ?? { posts: [], evs: [] };
            const isToday = k === todayKey; const dayEv = cell.evs[0]?.id ?? null;
            const iso9 = () => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0).toISOString();
            return (
              <div key={k} className={`calw-day${isToday ? " today" : ""}${over === k ? " over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver((o) => (o === k ? null : o))} onDrop={() => drop(k)}>
                <div className="calw-h">
                  <span className="calw-dow">{DOW[d.getDay()]}</span>
                  <span className="calw-date">{d.getDate()}</span>
                  {isToday && <span className="calw-today">Today</span>}
                  <button type="button" className="calw-add" onClick={() => onCreate(iso9(), dayEv)} aria-label={`New piece ${DOW[d.getDay()]}`}>+ Add</button>
                </div>
                <div className="calw-items">
                  {cell.evs.map((e) => (
                    <button key={e.id} type="button" className="calw-ev" onClick={() => setDayOpen(k)} title={e.title || "Event"}><Icon name="pin" /> {e.title || e.day_label || "Event"}</button>
                  ))}
                  {cell.posts.map((c) => <WChip key={c.id} c={c} />)}
                  {cell.posts.length === 0 && cell.evs.length === 0 && (
                    <button type="button" className="calw-empty" onClick={() => onCreate(iso9(), null)}>+ plan something</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <div className="cal-grid">
        {days.map((d) => {
          const k = key(d); const cell = byDay[k]; const dim = d.getMonth() !== cursor.getMonth();
          const dayEv = cell.evs[0]?.id ?? null;
          return (
            <div key={k} {...clickable(() => setDayOpen(k))} className={`cal-cell${dim ? " dim" : ""}${over === k ? " over" : ""}${k === todayKey ? " today" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver((o) => (o === k ? null : o))} onDrop={() => drop(k)}>
              <div className="cal-cell-h">
                <span className="cal-date">{d.getDate()}</span>
                <button type="button" className="cal-add" onClick={(e) => { e.stopPropagation(); onCreate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0).toISOString(), dayEv); }} aria-label="New piece this day">+</button>
              </div>
              <div className="cal-items">
                {cell.evs.map((e) => (
                  <div key={e.id} className={`cal-ev${focusEvent === e.id ? " lit" : ""}`} title={e.title || "Event"}
                    onMouseEnter={() => setFocusEvent(e.id)} onMouseLeave={() => setFocusEvent(null)}><Icon name="pin" /> {e.title || e.day_label || "Event"}</div>
                ))}
                {cell.posts.map((c) => <Chip key={c.id} c={c} inCell />)}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {dayOpen && (
        <DayView dayKey={dayOpen} posts={byDay[dayOpen]?.posts ?? []} evs={byDay[dayOpen]?.evs ?? []} evTitle={evTitle}
          onClose={() => setDayOpen(null)} onEdit={(id) => setEditId(id)} onOpenFull={(id) => { setDayOpen(null); onOpen(id); }}
          onAdd={() => { const [y, mo, da] = dayOpen.split("-").map(Number); const evId = byDay[dayOpen]?.evs[0]?.id ?? null; setDayOpen(null); onCreate(new Date(y, mo - 1, da, 9, 0).toISOString(), evId); }} />
      )}
      {editId && <ContentEdit id={editId} events={events} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); reload(); }} onOpenFull={(id) => { setEditId(null); onOpen(id); }} />}
    </div>
      )}
    </AsyncSection>
  );
}

// One day, expanded — the Studio mirror of the Company calendar's day view. Tap a piece to edit it in
// place (date, time, status, link-to-event); events are shown for context. "↗" opens the full editor.
function DayView({ dayKey, posts, evs, evTitle, onClose, onEdit, onOpenFull, onAdd }: { dayKey: string; posts: CItem[]; evs: EvItem[]; evTitle: (id: string | null) => string; onClose: () => void; onEdit: (id: string) => void; onOpenFull: (id: string) => void; onAdd: () => void }) {
  const d = new Date(`${dayKey}T00:00:00`);
  const heading = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return (
    <Sheet open onClose={onClose} label="Content day" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>{heading}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}><Icon name="close" /></button></div>}>
          {posts.length === 0 && evs.length === 0 && <EmptyState title="Nothing this day" sub="Tap + New piece to start one." />}
          <div className="dv-list">
            {evs.map((e) => (
              <div key={e.id} className="dv-row" style={{ ["--c" as string]: CAL_CAT.event.color }}>
                <span className="dv-dot" style={{ background: CAL_CAT.event.color }} />
                <span className="dv-main"><b><Icon name="pin" /> {e.title || e.day_label || "Event"}</b><span>event · plan content around it</span></span>
              </div>
            ))}
            {posts.map((c) => (
              <div key={c.id} className="dv-row" style={{ ["--c" as string]: STC[c.status] ?? "#9a8f7c" }}>
                <span className="dv-dot" style={{ background: STC[c.status] ?? "#9a8f7c" }} />
                <button type="button" className="dv-main dv-tap" onClick={() => onEdit(c.id)}>
                  <b>{c.event_id ? <><Icon name="link" /> {c.title || "Untitled"}</> : (c.title || "Untitled")}</b>
                  <span>{c.status} · {c.channel}{c.event_id ? ` · ↔ ${evTitle(c.event_id)}` : ""} · tap to edit</span>
                </button>
                <button type="button" className="dv-go" title="Open full editor" onClick={() => onOpenFull(c.id)}><Icon name="externalLink" /></button>
              </div>
            ))}
          </div>
          <div className="prod-actions" style={{ marginTop: 14 }}><span /><button type="button" className="note-save" onClick={onAdd}>+ New piece</button></div>
    </Sheet>
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
    if (!supabase || !f || isBlank(f.title)) return;   // a piece can't be saved without a title (no more "Untitled")
    setSaving(true);
    await supabase.from("content_items").update({ title: f.title.trim(), scheduled_for: f.scheduled_for || null, status: f.status || "draft", event_id: f.event_id || null }).eq("id", id);
    setSaving(false); onSaved();
  };
  const unschedule = async () => { if (!supabase) return; setSaving(true); await supabase.from("content_items").update({ scheduled_for: null }).eq("id", id); setSaving(false); onSaved(); };
  if (!f) return null;
  const dateVal = f.scheduled_for ? localDate(f.scheduled_for) : "";
  const timeVal = f.scheduled_for ? localTime(f.scheduled_for) : "09:00";
  const setDT = (date: string, time: string) => { if (!date) { set("scheduled_for", null); return; } set("scheduled_for", new Date(`${date}T${time || "09:00"}:00`).toISOString()); };
  return (
    <Sheet open onClose={onClose} label="Edit content piece" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>Edit piece</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}><Icon name="close" /></button></div>}>
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
          <button type="button" className="cal-tolink" style={{ marginTop: 10, marginLeft: 0 }} onClick={() => onOpenFull(id)}>Open full editor (hook, caption, Canva) <Icon name="externalLink" /></button>
          <div className="prod-actions" style={{ marginTop: 14, justifyContent: "space-between" }}>
            <button type="button" className="note-arch" onClick={unschedule} disabled={saving}>Unschedule</button>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
              <button type="button" className="note-save" onClick={save} disabled={saving || isBlank(f?.title)}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
    </Sheet>
  );
}
