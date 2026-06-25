"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// EVENT DAY PLANNER — a multi-day, time-by-time run of show for one event. Pick how many days the
// event runs, then build each day block by block: leave home 9:00, drive, arrive Airbnb (address +
// gate code), setup, doors, teardown, load out. Every logistic gets a home. Quick-add templates make
// it tap-fast; an optional AI draft proposes a full day from a few notes (crew approves). Realtime,
// so Ryan & Kayla can plan the same trip together.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Item = {
  id: string; event_id: string; day_index: number; day_date: string | null;
  start_time: string | null; end_time: string | null; title: string; kind: string;
  location: string | null; address: string | null; details: string | null; who: string | null;
  done: boolean; sort: number;
};

const KINDS = [
  { key: "travel", label: "Travel", icon: "🚗", color: "#6fa8dc" },
  { key: "lodging", label: "Lodging", icon: "🏡", color: "#8b5cf6" },
  { key: "setup", label: "Setup", icon: "🛠️", color: "#e0892b" },
  { key: "service", label: "Service", icon: "🥤", color: "#2bb3a3" },
  { key: "meal", label: "Meal", icon: "🍽️", color: "#d98c5f" },
  { key: "meeting", label: "Meeting", icon: "🤝", color: "#c084fc" },
  { key: "teardown", label: "Teardown", icon: "📦", color: "#a1887f" },
  { key: "personal", label: "Personal", icon: "🧘", color: "#94a3b8" },
  { key: "other", label: "Other", icon: "•", color: "#9aa0a6" },
];
const KMAP: Record<string, { key: string; label: string; icon: string; color: string }> = Object.fromEntries(KINDS.map((k) => [k.key, k]));
const kindOf = (k: string) => KMAP[k] ?? KMAP.other;

// common blocks, so a day fills in a few taps
const QUICK: { title: string; kind: string; start?: string }[] = [
  { title: "Leave home", kind: "travel", start: "9:00a" }, { title: "Drive", kind: "travel" },
  { title: "Fuel / stop", kind: "travel" }, { title: "Arrive & check in", kind: "lodging" },
  { title: "Load in & setup", kind: "setup" }, { title: "Doors / service", kind: "service" },
  { title: "Meal", kind: "meal" }, { title: "Teardown", kind: "teardown" },
  { title: "Load out", kind: "travel" }, { title: "Debrief", kind: "meeting" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const isoAddDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };

// parse free-text time → minutes for sorting ("9:00a", "noon", "2:30p", "14:00", "9am")
function toMinutes(t: string | null): number {
  if (!t) return 9999;
  const s = t.trim().toLowerCase();
  if (s === "noon") return 12 * 60;
  if (s === "midnight") return 0;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(a|am|p|pm)?/);
  if (!m) return 9998;
  let h = parseInt(m[1]); const min = m[2] ? parseInt(m[2]) : 0; const ap = m[3];
  if (ap?.startsWith("p") && h < 12) h += 12;
  if (ap?.startsWith("a") && h === 12) h = 0;
  return h * 60 + min;
}

export default function EventDayPlanner({ eventId, title, eventDay, planDays, initialDay = 1, onPlanDays, onClose }: {
  eventId: string; title: string; eventDay: string | null; planDays: number; initialDay?: number; onPlanDays: (n: number) => void; onClose: () => void;
}) {
  const days = Math.max(1, planDays || 1);
  const [active, setActive] = useState(Math.min(Math.max(1, initialDay), Math.max(1, planDays || 1)));
  const [items, setItems] = useState<Item[]>([]);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [departure, setDeparture] = useState<{ leave_by: string; summary: string; risks: string[] } | null>(null);
  const [depBusy, setDepBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("event_schedule_items").select("*").eq("event_id", eventId).order("day_index").order("sort");
    setItems((data as Item[]) ?? []);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel(`dayplan-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_schedule_items", filter: `event_id=eq.${eventId}` }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [eventId, load]);

  const dayDate = (di: number) => (eventDay ? isoAddDays(eventDay, di - 1) : null);
  const dayItems = useMemo(
    () => items.filter((i) => i.day_index === active).sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time) || a.sort - b.sort),
    [items, active]
  );
  const counts = useMemo(() => { const m: Record<number, number> = {}; for (const i of items) m[i.day_index] = (m[i.day_index] ?? 0) + 1; return m; }, [items]);

  const setDays = (n: number) => { const v = Math.min(30, Math.max(1, n)); onPlanDays(v); if (active > v) setActive(v); };

  const addItem = async (patch: Partial<Item>) => {
    if (!supabase) return;
    const { data: { user } } = await supabase.auth.getUser();
    const nextSort = (dayItems[dayItems.length - 1]?.sort ?? 0) + 1;
    await supabase.from("event_schedule_items").insert({
      event_id: eventId, day_index: active, day_date: dayDate(active),
      title: patch.title ?? "New block", kind: patch.kind ?? "other",
      start_time: patch.start_time ?? null, end_time: patch.end_time ?? null,
      location: patch.location ?? null, address: patch.address ?? null, details: patch.details ?? null, who: patch.who ?? null,
      sort: patch.sort ?? nextSort, created_by: user?.id ?? null,
    });
    load();
  };
  const saveItem = async (id: string, patch: Partial<Item>) => { if (!supabase) return; await supabase.from("event_schedule_items").update(patch).eq("id", id); load(); };
  const delItem = async (id: string) => { if (!supabase) return; setItems((p) => p.filter((x) => x.id !== id)); await supabase.from("event_schedule_items").delete().eq("id", id); };
  const toggle = async (it: Item) => { if (!supabase) return; setItems((p) => p.map((x) => x.id === it.id ? { ...x, done: !x.done } : x)); await supabase.from("event_schedule_items").update({ done: !it.done, done_at: !it.done ? new Date().toISOString() : null }).eq("id", it.id); };
  const moveDay = async (it: Item, di: number) => { if (!supabase) return; await supabase.from("event_schedule_items").update({ day_index: di, day_date: dayDate(di) }).eq("id", it.id); load(); };

  // "When to leave" — the AI scheduler reads THIS day's slots and says when to leave, anchored on
  // the first fixed commitment. Cleared whenever you switch days or the blocks change.
  useEffect(() => { setDeparture(null); }, [active]);
  const genDeparture = async () => {
    if (!supabase || depBusy || dayItems.length === 0) return;
    setDepBusy(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/agents/dayplan", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ event_id: eventId, day_index: active, summarize: true }) });
      const j = await r.json();
      if (j.ok) setDeparture({ leave_by: j.leave_by || "", summary: j.summary || "", risks: j.risks || [] });
    } catch { /* leave banner empty on failure */ }
    setDepBusy(false);
  };

  const dd = dayDate(active);
  const doneCount = dayItems.filter((i) => i.done).length;

  return (
    <div className="qd-scrim" onClick={onClose}>
      <div className="qd-sheet dp" onClick={(e) => e.stopPropagation()}>
        <div className="dp-head">
          <div className="dp-head-l">
            <div className="dp-eyebrow">Run of show</div>
            <div className="dp-title">{title || "Event"} — daily schedule</div>
          </div>
          <button type="button" className="qd-x" onClick={onClose}>✕</button>
        </div>

        <div className="dp-daysctl">
          <span>Runs</span>
          <button type="button" className="dp-step" onClick={() => setDays(days - 1)} aria-label="Fewer days">−</button>
          <b>{days}</b><span>{days === 1 ? "day" : "days"}</span>
          <button type="button" className="dp-step" onClick={() => setDays(days + 1)} aria-label="More days">+</button>
        </div>

        <div className="dp-tabs">
          {Array.from({ length: days }, (_, i) => i + 1).map((di) => {
            const ddi = dayDate(di);
            return (
              <button key={di} type="button" className={`dp-tab${active === di ? " on" : ""}`} onClick={() => setActive(di)}>
                <span className="dp-tab-d">Day {di}</span>
                <span className="dp-tab-s">{ddi ? fmtDate(ddi) : `${counts[di] ?? 0} block${(counts[di] ?? 0) === 1 ? "" : "s"}`}</span>
              </button>
            );
          })}
        </div>

        <div className="dp-body">
          {dd && <div className="dp-daydate">{fmtDate(dd)}{dayItems.length > 0 && <span className="dp-prog">{doneCount}/{dayItems.length} done</span>}</div>}

          {dayItems.length > 0 && (
            departure ? (
              <div className="dp-leave">
                <div className="dp-leave-h"><span>🚗 Leave by</span><b>{departure.leave_by || "—"}</b><button type="button" className="dp-leave-redo" onClick={genDeparture} disabled={depBusy} aria-label="Recompute">↻</button></div>
                {departure.summary && <div className="dp-leave-sum">{departure.summary}</div>}
                {departure.risks.length > 0 && <div className="dp-leave-risks">{departure.risks.map((r, i) => <span key={i}>⚠ {r}</span>)}</div>}
              </div>
            ) : (
              <button type="button" className="dp-leave-btn" onClick={genDeparture} disabled={depBusy}>{depBusy ? "Working out when to leave…" : "⏱ When do we leave? — summarize from the schedule"}</button>
            )
          )}

          <div className="dp-timeline">
            {dayItems.length === 0 && <div className="dp-empty">No blocks yet. Use a quick-add below, build one by hand, or let AI draft the day.</div>}
            {dayItems.map((it) => {
              const k = kindOf(it.kind);
              return (
                <div key={it.id} className={`dp-item${it.done ? " done" : ""}`} style={{ ["--c" as string]: k.color }}>
                  <button type="button" className="dp-check" onClick={() => toggle(it)} aria-label="Toggle done">{it.done ? "✓" : "○"}</button>
                  <div className="dp-time">{it.start_time || "—"}{it.end_time ? <span className="dp-time-e">{it.end_time}</span> : null}</div>
                  <div className="dp-item-main">
                    <div className="dp-item-h"><span className="dp-kind" title={k.label}>{k.icon}</span><span className="dp-item-t">{it.title}</span></div>
                    {(it.location || it.who) && <div className="dp-item-meta">{it.location && <span>📍 {it.location}</span>}{it.who && <span>👤 {it.who}</span>}</div>}
                    {it.address && <a className="dp-item-addr" href={`https://maps.google.com/?q=${encodeURIComponent(it.address)}`} target="_blank" rel="noreferrer">🗺️ {it.address}</a>}
                    {it.details && <div className="dp-item-det">{it.details}</div>}
                  </div>
                  <div className="dp-item-acts">
                    <button type="button" className="dp-mini" onClick={() => setEditing(it)} aria-label="Edit">✎</button>
                    {days > 1 && (
                      <select className="dp-move" value={it.day_index} onChange={(e) => moveDay(it, parseInt(e.target.value))} title="Move to day" aria-label="Move to day">
                        {Array.from({ length: days }, (_, i) => i + 1).map((di) => <option key={di} value={di}>D{di}</option>)}
                      </select>
                    )}
                    <button type="button" className="dp-mini del" onClick={() => delItem(it.id)} aria-label="Delete">✕</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="dp-quick">
            {QUICK.map((q) => (
              <button key={q.title} type="button" className="dp-qchip" style={{ ["--c" as string]: kindOf(q.kind).color }} onClick={() => addItem({ title: q.title, kind: q.kind, start_time: q.start ?? null })}>
                <span>{kindOf(q.kind).icon}</span>{q.title}
              </button>
            ))}
          </div>

          <div className="dp-actions">
            <button type="button" className="dp-add" onClick={() => setEditing("new")}>+ Add time block</button>
            <button type="button" className="dp-draft" onClick={() => setDrafting(true)}>✨ Draft this day with AI</button>
          </div>
        </div>
      </div>

      {editing && (
        <ItemForm
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => { if (editing === "new") await addItem(patch); else await saveItem(editing.id, patch); setEditing(null); }}
        />
      )}
      {drafting && (
        <DraftPanel eventId={eventId} dayIndex={active} onClose={() => setDrafting(false)}
          onAdd={async (rows) => { for (const r of rows) await addItem(r); setDrafting(false); }} />
      )}
    </div>
  );
}

// Add / edit a single block — every logistic field in one place.
function ItemForm({ item, onClose, onSave }: { item: Item | null; onClose: () => void; onSave: (patch: Partial<Item>) => void | Promise<void> }) {
  const [f, setF] = useState<Partial<Item>>(item ?? { title: "", kind: "other", start_time: "", end_time: "", location: "", address: "", details: "", who: "" });
  const set = (k: keyof Item, v: any) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="qd-scrim dp-scrim2" onClick={onClose}>
      <div className="qd-sheet dp-form" onClick={(e) => e.stopPropagation()}>
        <div className="qd-tabs"><b style={{ fontFamily: "Inter", fontSize: 15 }}>{item ? "Edit block" : "New block"}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>
        <div className="qd-body">
          <input className="note-in" value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="What's happening? e.g. Arrive Airbnb" autoFocus />
          <div className="dp-kinds">
            {KINDS.map((k) => (
              <button key={k.key} type="button" className={`dp-kchip${f.kind === k.key ? " on" : ""}`} style={{ ["--c" as string]: k.color }} onClick={() => set("kind", k.key)}>{k.icon} {k.label}</button>
            ))}
          </div>
          <div className="prod-grid" style={{ marginTop: 10 }}>
            <label className="prod-f"><span>Start</span><input value={f.start_time ?? ""} onChange={(e) => set("start_time", e.target.value)} placeholder="9:00a" /></label>
            <label className="prod-f"><span>End</span><input value={f.end_time ?? ""} onChange={(e) => set("end_time", e.target.value)} placeholder="optional" /></label>
            <label className="prod-f"><span>Who</span><input value={f.who ?? ""} onChange={(e) => set("who", e.target.value)} placeholder="Ryan / Kayla / Both" /></label>
            <label className="prod-f"><span>Place</span><input value={f.location ?? ""} onChange={(e) => set("location", e.target.value)} placeholder="Airbnb, venue…" /></label>
          </div>
          <label className="prod-f" style={{ marginTop: 8 }}><span>Address (tap-to-map)</span><input value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} placeholder="123 Peach St, Atlanta GA" /></label>
          <label className="prod-f" style={{ marginTop: 8 }}><span>Details — gate code, parking, contact, what to load</span><textarea className="note-in" rows={3} value={f.details ?? ""} onChange={(e) => set("details", e.target.value)} placeholder="Everything you'll want at a glance" /></label>
          <div className="prod-actions" style={{ marginTop: 14 }}>
            <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
            <button type="button" className="note-save" onClick={() => onSave(f)} disabled={!f.title?.trim()}>{item ? "Save" : "Add block"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// AI draft — notes in, a proposed day out. Crew picks what to keep.
function DraftPanel({ eventId, dayIndex, onClose, onAdd }: { eventId: string; dayIndex: number; onClose: () => void; onAdd: (rows: Partial<Item>[]) => void | Promise<void> }) {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<{ start_time: string; end_time: string; title: string; kind: string; location: string; details: string; who: string }[] | null>(null);
  const [pick, setPick] = useState<Record<number, boolean>>({});

  const run = async () => {
    if (!supabase) return;
    setLoading(true); setErr(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/agents/dayplan", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ event_id: eventId, day_index: dayIndex, notes }) });
      const j = await r.json();
      if (!j.ok) { setErr(j.error || "Draft failed"); setRows(null); }
      else { setRows(j.items ?? []); setPick(Object.fromEntries((j.items ?? []).map((_: any, i: number) => [i, true]))); }
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    setLoading(false);
  };

  return (
    <div className="qd-scrim dp-scrim2" onClick={onClose}>
      <div className="qd-sheet dp-form" onClick={(e) => e.stopPropagation()}>
        <div className="qd-tabs"><b style={{ fontFamily: "Inter", fontSize: 15 }}>✨ Draft day {dayIndex}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>
        <div className="qd-body">
          {!rows && (
            <>
              <div className="dp-hint">A few notes — where you&apos;re leaving from, when the event opens, where you&apos;re staying — and AI proposes the day. You approve what to keep.</div>
              <textarea className="note-in" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Leaving Greenville ~9am, ~3hr drive, market opens noon–6, Airbnb 2 nights, teardown after close" autoFocus />
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
                <button type="button" className="note-save" onClick={run} disabled={loading}>{loading ? "Drafting…" : "Draft the day"}</button>
              </div>
            </>
          )}
          {rows && (
            <>
              <div className="dp-hint">{rows.length} block{rows.length === 1 ? "" : "s"} proposed. Untick anything you don&apos;t want, then add.</div>
              <div className="dp-draftlist">
                {rows.map((r, i) => (
                  <button key={i} type="button" className={`dp-draftrow${pick[i] ? " on" : ""}`} style={{ ["--c" as string]: kindOf(r.kind).color }} onClick={() => setPick((p) => ({ ...p, [i]: !p[i] }))}>
                    <span className="dp-draftck">{pick[i] ? "✓" : "○"}</span>
                    <span className="dp-drafttime">{r.start_time}</span>
                    <span className="dp-draftmain"><b>{kindOf(r.kind).icon} {r.title}</b>{(r.location || r.details) && <span>{[r.location, r.details].filter(Boolean).join(" · ")}</span>}</span>
                  </button>
                ))}
              </div>
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={() => setRows(null)}>‹ Redo</button>
                <button type="button" className="note-save" onClick={() => onAdd(rows.filter((_, i) => pick[i]))} disabled={!Object.values(pick).some(Boolean)}>Add {Object.values(pick).filter(Boolean).length} to day</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
