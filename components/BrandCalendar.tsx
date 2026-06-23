"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

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
const CAL_KEY = "gt3-cal-month";

export default function BrandCalendar({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: (iso: string, eventId?: string | null) => void }) {
  const now = new Date();
  const [cursor, setCursor] = useState(() => {
    if (typeof window !== "undefined") { const s = localStorage.getItem(CAL_KEY); if (s) { const [y, m] = s.split("-").map(Number); if (y && m) return new Date(y, m - 1, 1); } }
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const setMonth = (d: Date) => { setCursor(d); if (typeof window !== "undefined") localStorage.setItem(CAL_KEY, `${d.getFullYear()}-${d.getMonth() + 1}`); };
  const [content, setContent] = useState<CItem[]>([]);
  const [events, setEvents] = useState<EvItem[]>([]);
  const [backlog, setBacklog] = useState<CItem[]>([]);
  const [over, setOver] = useState<string | null>(null);
  const [focusEvent, setFocusEvent] = useState<string | null>(null); // highlight a relationship
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
        onDragStart={() => { dragId.current = c.id; }} onClick={() => onOpen(c.id)}
        onMouseEnter={() => linked && setFocusEvent(c.event_id)} onMouseLeave={() => setFocusEvent(null)}
        title={`${c.title} · ${c.status}${linked ? ` · ↔ ${evTitle(c.event_id)}` : ""}`}>
        <span className="cal-chip-dot" style={{ background: STC[c.status] ?? "#9a8f7c" }} />{linked ? "🔗 " : ""}{c.title || "Untitled"}
      </button>
    );
  };

  return (
    <div className="cal">
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
            <div key={k} className={`cal-cell${dim ? " dim" : ""}${over === k ? " over" : ""}${k === todayKey ? " today" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver((o) => (o === k ? null : o))} onDrop={() => drop(k)}>
              <div className="cal-cell-h">
                <span className="cal-date">{d.getDate()}</span>
                <button type="button" className="cal-add" onClick={() => onCreate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0).toISOString(), dayEv)} aria-label="New piece this day">+</button>
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
    </div>
  );
}
