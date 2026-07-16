"use client";

import { useEffect, useRef, useState } from "react";
import Sheet from "@/components/Sheet";
import { useApp } from "@/components/AppProvider";
import { supabase } from "@/lib/supabase";
import { geocode } from "@/lib/geocode";
import Icon from "@/components/Icon";

// FIELD-OP SHEET — the ONE quick editor for a field op's core facts (name · date · time ·
// place · status), reachable in two taps from anywhere a stop or event shows (calendar,
// route, boards). This kills the old maze: calendar said "edited in the prep hub", the
// route said the same, and changing a stop's TIME took six taps across three surfaces.
// The prep hub stays the deep surface (menus, staffing, run-of-show, order-ahead); this
// sheet is the fast path for the facts that actually change week to week.
//
// Correctness note (the stale-label bug): the guest Truck page prefers the hand-set
// when_label/time_label over starts_at. Whenever this sheet changes a stop's schedule it
// CLEARS both labels, so the time a crew member just set is the time guests actually see.

type Kind = "event" | "stop";

export default function FieldOpSheet({ kind, id, onClose, onSaved, onOpenPrep }: {
  kind: Kind; id: string;
  onClose: () => void;
  onSaved: () => void;           // fired after any successful write (save or archive)
  onOpenPrep?: () => void;       // optional door to the full prep hub
}) {
  const { toast } = useApp();
  const isEvent = kind === "event";
  const table = isEvent ? "events" : "stops";
  const [f, setF] = useState<Record<string, string | null> | null>(null);
  const [saving, setSaving] = useState(false);
  const [touchedWhen, setTouchedWhen] = useState(false);
  // stage/status as loaded — only written back if the USER changed it, so the lifecycle
  // triggers (live/done automation) can't be clobbered by a stale quick-edit (panel catch)
  const origStage = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    const sel = isEvent ? "title, day, location_text, stage" : "name, starts_at, location_text, address, status";
    supabase.from(table).select(sel).eq("id", id).maybeSingle()
      .then(({ data }) => {
        const row = ((data ?? {}) as unknown) as Record<string, string | null>;
        origStage.current = (isEvent ? row.stage : row.status) ?? null;
        setF(row);
      });
  }, [table, isEvent, id]);

  const set = (k: string, v: string | null) => setF((p) => ({ ...(p ?? {}), [k]: v }));

  // date/time <-> columns: events.day is a plain date; stops.starts_at is a timestamp.
  const dateVal = !f ? "" : isEvent ? (f.day || "") : (f.starts_at ? new Date(f.starts_at).toLocaleDateString("en-CA") : "");
  const onDate = (v: string) => {
    setTouchedWhen(true);
    if (isEvent) { set("day", v || null); return; }
    if (!v) { set("starts_at", null); return; }
    const old = f?.starts_at ? new Date(f.starts_at) : null;
    const hh = old ? `${String(old.getHours()).padStart(2, "0")}:${String(old.getMinutes()).padStart(2, "0")}` : "11:00";
    set("starts_at", new Date(`${v}T${hh}:00`).toISOString());
  };
  const timeVal = !f || isEvent || !f.starts_at ? "" : (() => { const d = new Date(f.starts_at); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })();
  const onTime = (v: string) => {
    if (isEvent || !v) return;
    setTouchedWhen(true);
    const dayKey = f?.starts_at ? new Date(f.starts_at).toLocaleDateString("en-CA") : new Date().toLocaleDateString("en-CA");
    set("starts_at", new Date(`${dayKey}T${v}:00`).toISOString());
  };

  const save = async () => {
    if (!supabase || !f) return;
    setSaving(true);
    const nm = (f[isEvent ? "title" : "name"] || "").trim() || (isEvent ? "Event" : "Stop");
    const patch: Record<string, string | number | null> = isEvent
      ? { title: nm, day: f.day || null, location_text: f.location_text?.trim() || null }
      : { name: nm, starts_at: f.starts_at || null, location_text: f.location_text?.trim() || null, address: f.address?.trim() || null };
    // stage/status: write ONLY a deliberate change (lifecycle automation owns it otherwise)
    const stageNow = (isEvent ? f.stage : f.status) ?? null;
    if (stageNow !== origStage.current) patch[isEvent ? "stage" : "status"] = stageNow;
    if (!isEvent) {
      // the schedule just changed → the derived values must win over stale hand-set labels
      if (touchedWhen) { patch.when_label = null; patch.time_label = null; }
      const q = (f.address?.trim() || f.location_text?.trim() || "");
      if (q) { const g = await geocode(q).catch(() => null); if (g) { patch.lat = g.lat; patch.lng = g.lng; } }
    }
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    setSaving(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    toast(isEvent ? "Event saved" : "Stop saved — guests see the new time");
    onSaved();
  };

  const archive = async () => {
    if (!supabase) return;
    if (typeof window !== "undefined" && !window.confirm(`Archive this ${isEvent ? "event" : "stop"}? It comes off the calendar and the customer app.`)) return;
    setSaving(true);
    const { error } = await supabase.from(table).update({ archived_at: new Date().toISOString() }).eq("id", id);
    setSaving(false);
    if (error) { toast(`Couldn't archive — ${error.message}`, "error"); return; }
    toast("Archived");
    onSaved();
  };

  if (!f) return null;
  return (
    <Sheet open onClose={onClose} className="dp-form" label={`Edit ${isEvent ? "event" : "truck stop"}`}
      header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>{isEvent ? "Event" : "Truck stop"}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}><Icon name="close" /></button></div>}>
      <input className="note-in" value={f[isEvent ? "title" : "name"] ?? ""} onChange={(e) => set(isEvent ? "title" : "name", e.target.value)} placeholder={isEvent ? "Event name" : "Stop name"} autoFocus />
      <div className="prod-grid" style={{ marginTop: 10 }}>
        <label className="prod-f"><span>Date</span><input type="date" value={dateVal} onChange={(e) => onDate(e.target.value)} /></label>
        {!isEvent && <label className="prod-f"><span>Start time</span><input type="time" value={timeVal} onChange={(e) => onTime(e.target.value)} /></label>}
        {isEvent && (
          <label className="prod-f"><span>Stage</span>
            <select value={f.stage ?? "confirmed"} onChange={(e) => set("stage", e.target.value)}>
              <option value="lead">Lead</option><option value="confirmed">Confirmed</option><option value="prep">Prep</option><option value="live">Live</option><option value="done">Done</option>
            </select>
          </label>
        )}
      </div>
      <label className="prod-f" style={{ marginTop: 8 }}><span>Where</span><input value={f.location_text ?? ""} onChange={(e) => set("location_text", e.target.value)} placeholder="Where" /></label>
      {!isEvent && <label className="prod-f" style={{ marginTop: 8 }}><span>Address (pins the map + directions)</span><input value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} placeholder="123 Peach St, Atlanta GA" /></label>}
      {!isEvent && (
        <label className="prod-f" style={{ marginTop: 8 }}><span>Status</span>
          <select value={f.status ?? "upcoming"} onChange={(e) => set("status", e.target.value)}>
            <option value="upcoming">Upcoming</option><option value="done">Done</option>
          </select>
        </label>
      )}
      {onOpenPrep && (
        <button type="button" className="btn-ter" style={{ marginTop: 12 }} onClick={onOpenPrep}>
          Full prep — menu, staffing, run-of-show <b><Icon name="arrowRight" /></b>
        </button>
      )}
      <div className="ownerdet-danger" style={{ marginTop: 12 }}>
        <button type="button" className="ownerdet-arch" onClick={archive} disabled={saving}>Archive</button>
      </div>
      <div className="prod-actions" style={{ marginTop: 12 }}>
        <button type="button" className="note-arch" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="note-save" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </Sheet>
  );
}
