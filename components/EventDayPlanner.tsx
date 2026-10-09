"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { useRealtimeTable } from "@/lib/realtime";
import Sheet, { CloseButton, LeaveButton } from "@/components/Sheet";
import Icon from "@/components/Icon";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { useLocationSuggestions } from "./useLocationSuggestions";
import { errorMessage } from "@/lib/errorMessage";
import { useCrew } from "./useCrew";
import { follow } from "@/lib/pickFill";
import { edited } from "@/lib/formGuard";
import Button from "./Button";

// EVENT DAY PLANNER — a multi-day, time-by-time run of show for one event. Pick how many days the
// event runs, then build each day block by block: leave home 9:00, drive, arrive Airbnb (address +
// gate code), setup, doors, teardown, load out. Every logistic gets a home. Quick-add templates make
// it tap-fast; an optional AI draft proposes a full day from a few notes (crew approves). Realtime,
// so Ryan & Kayla can plan the same trip together. Fetch state via useAsyncData — a failed load is a
// real error now, not a silent "No blocks yet".
/* eslint-disable @typescript-eslint/no-explicit-any */

type Item = {
  id: string; event_id: string; day_index: number; day_date: string | null;
  start_time: string | null; end_time: string | null; title: string; kind: string;
  location: string | null; address: string | null; details: string | null; who: string | null;
  done: boolean; sort: number;
};

const KINDS = [
  { key: "travel", label: "Travel", icon: <Icon name="compass" />, color: "#6fa8dc" },
  { key: "lodging", label: "Lodging", icon: "🏡", color: "#8b5cf6" },
  { key: "setup", label: "Setup", icon: "🛠️", color: "#e0892b" },
  { key: "service", label: "Service", icon: "🥤", color: "#2bb3a3" },
  { key: "meal", label: "Meal", icon: "🍽️", color: "#d98c5f" },
  { key: "meeting", label: "Meeting", icon: <Icon name="partners" />, color: "#c084fc" },
  { key: "teardown", label: "Teardown", icon: <Icon name="package" />, color: "#a1887f" },
  { key: "personal", label: "Personal", icon: "🧘", color: "#94a3b8" },
  { key: "other", label: "Other", icon: "•", color: "#9aa0a6" },
];
const KMAP: Record<string, { key: string; label: string; icon: ReactNode; color: string }> = Object.fromEntries(KINDS.map((k) => [k.key, k]));
const kindOf = (k: string) => KMAP[k] ?? KMAP.other;

// common blocks, so a day fills in a few taps
const QUICK: { title: string; kind: string; start?: string }[] = [
  { title: "Leave home", kind: "travel", start: "9:00a" }, { title: "Drive", kind: "travel" },
  { title: "Fuel / stop", kind: "travel" }, { title: "Arrive & check in", kind: "lodging" },
  { title: "Load in & setup", kind: "setup" }, { title: "Doors / service", kind: "service" },
  { title: "Meal", kind: "meal" }, { title: "Teardown", kind: "teardown" },
  { title: "Load out", kind: "travel" }, { title: "Debrief", kind: "meeting" },
];

// WHAT A NEW BLOCK ALREADY KNOWS (2026-10-04, the form audit). The event or stop this run sheet is
// for has a place, and usually a crew; the day has a block before this one. Each new block was
// typed from nothing: the venue retyped for setup, service and teardown, "Ryan" / "ryan" / "R" for
// who, a start time when the last block already said when it ends.
//   · Start — where the day's last block ends (blank if it says no end: a guessed time reads as one
//     somebody chose).
//   · Place and Address — the event's or stop's own, for the blocks that happen there; they follow
//     the kind while untouched (lib/pickFill), so switching a block to Travel takes them away again.
//   · Who — the crew on this event or stop as tap chips (everyone, when nobody is on it yet), still a
//     free-text box for "Host" or "Both".
const AT_THE_VENUE = new Set(["setup", "service", "teardown"]);
type Venue = { place: string; address: string };
const NO_VENUE: Venue = { place: "", address: "" };

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

export default function EventDayPlanner({ ownerType = "event", eventId, title, eventDay, planDays, initialDay = 1, onPlanDays, onClose }: {
  ownerType?: "event" | "stop"; eventId: string; title: string; eventDay: string | null; planDays: number; initialDay?: number; onPlanDays: (n: number) => void; onClose: () => void;
}) {
  const ownerCol = ownerType === "stop" ? "stop_id" : "event_id"; // event_schedule_items belongs to one owner
  const days = Math.max(1, planDays || 1);
  const [active, setActive] = useState(Math.min(Math.max(1, initialDay), Math.max(1, planDays || 1)));
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [departure, setDeparture] = useState<{ leave_by: string; summary: string; risks: string[] } | null>(null);
  const [depBusy, setDepBusy] = useState(false);

  const loader = useCallback(async (): Promise<Item[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("event_schedule_items").select("*").eq(ownerCol, eventId).order("day_index").order("sort");
    if (error) throw new Error(error.message);
    return (data as Item[]) ?? [];
  }, [eventId, ownerCol]);
  const board = useAsyncData(loader, [eventId, ownerCol]);
  const { reload } = board;
  useRealtimeTable({ table: "event_schedule_items", filter: `${ownerCol}=eq.${eventId}` }, reload);
  const items = useMemo(() => board.data ?? [], [board.data]);

  // The place and the crew of the event or stop this sheet is for. A convenience, not the sheet:
  // if it does not load, blocks start blank exactly as they used to.
  const aboutLoader = useCallback(async (): Promise<{ venue: Venue | null; staff: string[] }> => {
    if (!supabase) return { venue: null, staff: [] };
    const [own, st] = await Promise.all([
      ownerType === "stop"
        ? supabase.from("stops").select("name, location_text, address").eq("id", eventId).maybeSingle()
        : supabase.from("events").select("location_text, vendors(name, address)").eq("id", eventId).maybeSingle(),
      supabase.from("event_staff").select("user_id").eq(ownerCol, eventId),
    ]);
    const o = (own.data ?? null) as { name?: string | null; location_text?: string | null; address?: string | null; vendors?: { name?: string | null; address?: string | null } | { name?: string | null; address?: string | null }[] | null } | null;
    const v = Array.isArray(o?.vendors) ? o?.vendors[0] : o?.vendors;
    const place = (o?.location_text || v?.name || o?.name || "").trim();
    const address = (o?.address || v?.address || "").trim();
    return {
      venue: place || address ? { place, address } : null,
      staff: ((st.data as { user_id: string | null }[] | null) ?? []).map((r) => r.user_id).filter((x): x is string => !!x),
    };
  }, [eventId, ownerCol, ownerType]);
  const about = useAsyncData(aboutLoader, [eventId, ownerCol, ownerType]);
  const crewList = useCrew();
  const onSite = useMemo(() => {
    const ids = about.data?.staff ?? [];
    const pool = ids.length ? crewList.filter((c) => ids.includes(c.id)) : crewList;
    return { names: pool.map((c) => (c.display_name ?? "").trim()).filter(Boolean), staffed: ids.length > 0 };
  }, [about.data, crewList]);
  const venue = about.data?.venue ?? null;
  const venueFor = (kind: string | null | undefined): Venue => (venue && AT_THE_VENUE.has(kind ?? "") ? venue : NO_VENUE);

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
      [ownerCol]: eventId, day_index: active, day_date: dayDate(active),
      title: patch.title ?? "New block", kind: patch.kind ?? "other",
      start_time: patch.start_time ?? null, end_time: patch.end_time ?? null,
      location: patch.location ?? null, address: patch.address ?? null, details: patch.details ?? null, who: patch.who ?? null,
      sort: patch.sort ?? nextSort, created_by: user?.id ?? null,
    });
    reload();
  };
  const saveItem = async (id: string, patch: Partial<Item>) => { if (!supabase) return; await supabase.from("event_schedule_items").update(patch).eq("id", id); reload(); };
  const delItem = async (id: string) => { if (!supabase) return; await supabase.from("event_schedule_items").delete().eq("id", id); reload(); };
  const toggle = async (it: Item) => { if (!supabase) return; await supabase.from("event_schedule_items").update({ done: !it.done, done_at: !it.done ? new Date().toISOString() : null }).eq("id", it.id); reload(); };
  const moveDay = async (it: Item, di: number) => { if (!supabase) return; await supabase.from("event_schedule_items").update({ day_index: di, day_date: dayDate(di) }).eq("id", it.id); reload(); };

  // "When to leave" — the AI scheduler reads THIS day's slots and says when to leave, anchored on
  // the first fixed commitment. Cleared whenever you switch days or the blocks change.
  useEffect(() => { setDeparture(null); }, [active]);
  const genDeparture = async () => {
    if (!supabase || depBusy || dayItems.length === 0) return;
    setDepBusy(true);
    try {
      const r = await authedFetch("/api/agents/dayplan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [ownerCol]: eventId, day_index: active, summarize: true }) });
      const j = await r.json();
      if (j.ok) {
        setDeparture({ leave_by: j.leave_by || "", summary: j.summary || "", risks: j.risks || [] });
        // auto-fill the event's calendar buffer from the computed drive+setup time
        if (typeof j.buffer_min === "number" && j.buffer_min > 0) {
          const table = ownerCol === "stop_id" ? "stops" : "events";
          supabase.from(table).update({ default_buffer_min: j.buffer_min }).eq("id", eventId).then(() => {});
        }
      }
    } catch { /* leave banner empty on failure */ }
    setDepBusy(false);
  };

  const dd = dayDate(active);
  const doneCount = dayItems.filter((i) => i.done).length;
  // Where the day's last block ends is where the next one starts.
  const nextStart = (dayItems[dayItems.length - 1]?.end_time ?? "").trim();

  return (
    <>
      <Sheet open onClose={onClose} label="Day-of run sheet" header={<div style={{ display: "flex", alignItems: "center" }}>
        <div className="dp-head-l">
          <div className="dp-eyebrow">Run of show</div>
          <div className="dp-title">{title || "Event"} — daily schedule</div>
        </div>
        <CloseButton onClick={onClose} />
      </div>}>

        <div className="dp-daysctl">
          <span>Runs</span>
          <button type="button" className="dp-step" onClick={() => setDays(days - 1)} aria-label="Fewer days">−</button>
          <b>{days}</b><span>{days === 1 ? "day" : "days"}</span>
          <button type="button" className="dp-step" onClick={() => setDays(days + 1)} aria-label="More days">+</button>
        </div>

        <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load the schedule" emptyTitle="Nothing here yet">
          {() => (
            <>
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
                <div className="dp-leave-h"><span><Icon name="compass" /> Leave by</span><b>{departure.leave_by || "—"}</b><button type="button" className="dp-leave-redo" onClick={genDeparture} disabled={depBusy} aria-label="Recompute">↻</button></div>
                {departure.summary && <div className="dp-leave-sum">{departure.summary}</div>}
                {departure.risks.length > 0 && <div className="dp-leave-risks">{departure.risks.map((r, i) => <span key={i}><Icon name="warning" /> {r}</span>)}</div>}
              </div>
            ) : (
              <Button type="button" kind="secondary" wide className="mb-3" onClick={genDeparture} disabled={depBusy}>{depBusy ? "Working out when to leave…" : <><Icon name="clock" /> When do we leave? — summarize from the schedule</>}</Button>
            )
          )}

          <div className="dp-timeline">
            {dayItems.length === 0 && <div className="dp-empty">No blocks yet. Use a quick-add below, build one by hand, or let AI draft the day.</div>}
            {dayItems.map((it) => {
              const k = kindOf(it.kind);
              return (
                <div key={it.id} className={`dp-item${it.done ? " done" : ""}`} style={{ ["--c" as string]: k.color }}>
                  <button type="button" className="k-icon-btn sm dp-check" onClick={() => toggle(it)} aria-pressed={it.done} aria-label="Done">{it.done ? <Icon name="check" /> : <Icon name="dotOutline" />}</button>
                  <div className="dp-time">{it.start_time || "—"}{it.end_time ? <span className="dp-time-e">{it.end_time}</span> : null}</div>
                  <div className="dp-item-main">
                    <div className="dp-item-h"><span className="dp-kind" title={k.label}>{k.icon}</span><span className="dp-item-t">{it.title}</span></div>
                    {(it.location || it.who) && <div className="dp-item-meta">{it.location && <span><Icon name="pin" /> {it.location}</span>}{it.who && <span>{it.who}</span>}</div>}
                    {it.address && <a className="dp-item-addr" href={`https://maps.google.com/?q=${encodeURIComponent(it.address)}`} target="_blank" rel="noreferrer">{it.address}</a>}
                    {it.details && <div className="dp-item-det">{it.details}</div>}
                  </div>
                  <div className="dp-item-acts">
                    <button type="button" className="dp-mini" onClick={() => setEditing(it)} aria-label="Edit">✎</button>
                    {days > 1 && (
                      <select className="dp-move" value={it.day_index} onChange={(e) => moveDay(it, parseInt(e.target.value))} title="Move to day" aria-label="Move to day">
                        {Array.from({ length: days }, (_, i) => i + 1).map((di) => <option key={di} value={di}>D{di}</option>)}
                      </select>
                    )}
                    <button type="button" className="dp-mini del" onClick={() => delItem(it.id)} aria-label="Delete"><Icon name="close" /></button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="dp-quick">
            {QUICK.map((q) => (
              <button key={q.title} type="button" className="k-chip"
                onClick={() => addItem({ title: q.title, kind: q.kind, start_time: q.start ?? (nextStart || null),
                  location: venueFor(q.kind).place || null, address: venueFor(q.kind).address || null })}>
                <span>{kindOf(q.kind).icon}</span>{q.title}
              </button>
            ))}
          </div>

          <div className="dp-actions">
            <button type="button" className="dp-add" onClick={() => setEditing("new")}>+ Add time block</button>
            <button type="button" className="dp-draft" onClick={() => setDrafting(true)}><Icon name="sparkles" /> Draft this day with AI</button>
          </div>
        </div>
            </>
          )}
        </AsyncSection>
      </Sheet>

      {editing && (
        <ItemForm
          item={editing === "new" ? null : editing}
          start={nextStart} venueFor={venueFor} onSite={onSite}
          onClose={() => setEditing(null)}
          onSave={async (patch) => { if (editing === "new") await addItem(patch); else await saveItem(editing.id, patch); setEditing(null); }}
        />
      )}
      {drafting && (
        <DraftPanel ownerType={ownerType} eventId={eventId} dayIndex={active} onClose={() => setDrafting(false)}
          onAdd={async (rows) => { for (const r of rows) await addItem(r); setDrafting(false); }} />
      )}
    </>
  );
}

// Add / edit a single block — every logistic field in one place.
function ItemForm({ item, start, venueFor, onSite, onClose, onSave }: {
  item: Item | null; start: string; venueFor: (kind: string | null | undefined) => Venue; onSite: { names: string[]; staffed: boolean };
  onClose: () => void; onSave: (patch: Partial<Item>) => void | Promise<void>;
}) {
  // The block as it opened — what "unsaved" is measured against.
  const [first] = useState<Partial<Item>>(() => item ?? { title: "", kind: "other", start_time: start, end_time: "", location: "", address: "", details: "", who: "" });
  const [f, setF] = useState<Partial<Item>>(first);
  const locSugs = useLocationSuggestions();
  const set = (k: keyof Item, v: any) => setF((p) => ({ ...p, [k]: v }));
  // The venue follows the kind while Place and Address are untouched (lib/pickFill).
  const setKind = (k: string) => setF((p) => {
    const was = venueFor(p.kind), now = venueFor(k);
    return { ...p, kind: k, location: follow(p.location, was.place, now.place), address: follow(p.address, was.address, now.address) };
  });
  // Who: names as chips over the same free-text column — "Ryan, Kayla".
  const whoList = (f.who ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const isOn = (n: string) => whoList.some((x) => x.toLowerCase() === n.toLowerCase());
  const toggleWho = (n: string) => set("who", (isOn(n) ? whoList.filter((x) => x.toLowerCase() !== n.toLowerCase()) : [...whoList, n]).join(", "));
  return (
    <Sheet open onClose={onClose} label="Day-of block" dirty={edited(f, first, ["title", "kind", "start_time", "end_time", "location", "address", "details", "who"])} header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>{item ? "Edit block" : "New block"}</b><CloseButton onClick={onClose} /></div>}>
          <input className="note-in" value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="What's happening? e.g. Arrive Airbnb" autoFocus />
          <div className="dp-kinds">
            {KINDS.map((k) => (
              <button key={k.key} type="button" className={`k-chip hue${f.kind === k.key ? " on" : ""}`} style={{ ["--k-tone" as string]: k.color }} aria-pressed={f.kind === k.key} onClick={() => setKind(k.key)}>{k.icon} {k.label}</button>
            ))}
          </div>
          <div className="prod-grid" style={{ marginTop: 10 }}>
            <label className="prod-f"><span>Start</span><input value={f.start_time ?? ""} onChange={(e) => set("start_time", e.target.value)} placeholder="9:00a" /></label>
            <label className="prod-f"><span>End</span><input value={f.end_time ?? ""} onChange={(e) => set("end_time", e.target.value)} placeholder="optional" /></label>
            <label className="prod-f"><span>Who</span><input value={f.who ?? ""} onChange={(e) => set("who", e.target.value)} placeholder="Crew on site" /></label>
            {/* Place and Address are two boxes for one location, and the audit flagged the pair.
                They are NOT merged here, deliberately: they are two real columns carrying two
                different things people have typed, and collapsing them means choosing which one
                survives — a data decision, not a layout one, and one worth making after the
                geocoder is trusted rather than at the same time. What they get now is the thing
                that removes most of the pain: the same suggest-list of every place already on
                record that FieldOpSheet and the event card use, so neither field is blind free
                text and "Duncan Town Square" stops acquiring a third spelling. */}
            <label className="prod-f"><span>Place</span><input value={f.location ?? ""} onChange={(e) => set("location", e.target.value)} placeholder="Airbnb, venue…" list="gt3-locs-edp" /></label>
            {onSite.names.length > 0 && (
              <div className="prod-f" style={{ gridColumn: "1 / -1" }}>
                <span>{onSite.staffed ? "On this one — tap to add to Who" : "The crew — tap to add to Who"}</span>
                <div className="ts-chips" role="group" aria-label="Who — tap to add">
                  {onSite.names.map((n) => (
                    <button key={n} type="button" className={`k-chip${isOn(n) ? " on" : ""}`} aria-pressed={isOn(n)} onClick={() => toggleWho(n)}>{n}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <label className="prod-f" style={{ marginTop: 8 }}><span>Address (tap-to-map)</span><input value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} placeholder="123 Peach St, Atlanta GA" list="gt3-locs-edp" /></label>
          {locSugs.length > 0 && <datalist id="gt3-locs-edp">{locSugs.map((sg) => <option key={sg} value={sg} />)}</datalist>}
          <label className="prod-f" style={{ marginTop: 8 }}><span>Details — gate code, parking, contact, what to load</span><textarea className="note-in" rows={3} value={f.details ?? ""} onChange={(e) => set("details", e.target.value)} placeholder="Everything you'll want at a glance" /></label>
          <div className="prod-actions" style={{ marginTop: 14 }}>
            <LeaveButton className="note-arch" onClick={onClose}>Cancel</LeaveButton>
            <button type="button" className="btn-pri" onClick={() => onSave(f)} disabled={!f.title?.trim()}>{item ? "Save" : "Add block"}</button>
          </div>
    </Sheet>
  );
}

// AI draft — notes in, a proposed day out. Crew picks what to keep.
function DraftPanel({ ownerType = "event", eventId, dayIndex, onClose, onAdd }: { ownerType?: "event" | "stop"; eventId: string; dayIndex: number; onClose: () => void; onAdd: (rows: Partial<Item>[]) => void | Promise<void> }) {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<{ start_time: string; end_time: string; title: string; kind: string; location: string; details: string; who: string }[] | null>(null);
  const [pick, setPick] = useState<Record<number, boolean>>({});

  const run = async () => {
    if (!supabase) return;
    setLoading(true); setErr(null);
    try {
      const r = await authedFetch("/api/agents/dayplan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [ownerType === "stop" ? "stop_id" : "event_id"]: eventId, day_index: dayIndex, notes }) });
      const j = await r.json();
      if (!j.ok) { setErr(j.error || "Draft failed"); setRows(null); }
      else { setRows(j.items ?? []); setPick(Object.fromEntries((j.items ?? []).map((_: any, i: number) => [i, true]))); }
    } catch (e) { setErr(errorMessage(e)); }
    setLoading(false);
  };

  return (
    <Sheet open onClose={onClose} label="Draft the day" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}><Icon name="sparkles" /> Draft day {dayIndex}</b><CloseButton onClick={onClose} /></div>}>
          {!rows && (
            <>
              <div className="dp-hint">A few notes — where you&apos;re leaving from, when the event opens, where you&apos;re staying — and AI proposes the day. You approve what to keep.</div>
              <textarea className="note-in" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Leaving Greenville ~9am, ~3hr drive, market opens noon–6, Airbnb 2 nights, teardown after close" autoFocus />
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
                <button type="button" className="btn-pri" onClick={run} disabled={loading}>{loading ? "Drafting…" : "Draft the day"}</button>
              </div>
            </>
          )}
          {rows && (
            <>
              <div className="dp-hint">{rows.length} block{rows.length === 1 ? "" : "s"} proposed. Untick anything you don&apos;t want, then add.</div>
              <div className="dp-draftlist">
                {rows.map((r, i) => (
                  <button key={i} type="button" className={`dp-draftrow${pick[i] ? " on" : ""}`} style={{ ["--c" as string]: kindOf(r.kind).color }} onClick={() => setPick((p) => ({ ...p, [i]: !p[i] }))}>
                    <span className="dp-draftck">{pick[i] ? <Icon name="check" /> : <Icon name="dotOutline" />}</span>
                    <span className="dp-drafttime">{r.start_time}</span>
                    <span className="dp-draftmain"><b>{kindOf(r.kind).icon} {r.title}</b>{(r.location || r.details) && <span>{[r.location, r.details].filter(Boolean).join(" · ")}</span>}</span>
                  </button>
                ))}
              </div>
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={() => setRows(null)}>‹ Redo</button>
                <button type="button" className="btn-pri" onClick={() => onAdd(rows.filter((_, i) => pick[i]))} disabled={!Object.values(pick).some(Boolean)}>Add {Object.values(pick).filter(Boolean).length} to day</button>
              </div>
            </>
          )}
    </Sheet>
  );
}
