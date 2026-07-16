"use client";

import { useEffect, useRef, useState } from "react";
import Sheet from "@/components/Sheet";
import { useApp } from "@/components/AppProvider";
import { supabase } from "@/lib/supabase";
import { geocode } from "@/lib/geocode";
import { resolveVendor, addVendorLocation, type VendorMatch } from "@/lib/vendorLink";
import VendorResolve from "@/components/VendorResolve";
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
//
// Vendor autocomplete: a stop's name field used to be plain free text — linking it to a real
// vendor (and inheriting that vendor's saved address/coords) meant a SEPARATE trip to the
// picker in Route's location card. That's two disconnected steps for one fact, and the easy
// path (just type a name here, skip the picker) is exactly how a place ends up as three
// almost-identical vendor rows. save() below now runs a typed name through the SAME resolver
// (lib/vendorLink) that picker uses — exact match links silently, a near-miss pauses the save
// and asks (VendorResolve, the same confirm sheet), a clean miss auto-creates a pending vendor.
// Skipped once a stop is already linked — an existing link's identity comes from the vendor.

type Kind = "event" | "stop";

// Truck stops read "Upcoming" forever unless a human flips the dropdown — a stop from last week
// nobody touched still shows Upcoming here even though FindUs/Route/PrepBoard already treat it as
// past (starts_at + 8h grace). This mirrors that same rule so the editor agrees with what guests
// and crew already see elsewhere. An explicit "done" or a completed_at stamp (the Complete-stop
// wrap flow, in OwnerDetails) always wins over the date math.
const STOP_GRACE_MS = 8 * 3600 * 1000;
function derivedStopStatus(status: string | null, startsAt: string | null, completedAt: string | null): string {
  if (status === "done" || completedAt) return "done";
  if (!startsAt) return "upcoming";
  return Date.now() - new Date(startsAt).getTime() > STOP_GRACE_MS ? "done" : "upcoming";
}

// Pull a vendor's canonical name + saved address/coords onto a stop patch about to be written —
// the SAME fields Route's own linkVendor denormalizes onto a stop, so a name-triggered auto-link
// behaves identically to picking the vendor by hand. Returns the vendor's name for toast copy.
async function pullVendorFields(vendorId: string, patch: Record<string, string | number | null>): Promise<string | null> {
  patch.vendor_id = vendorId;
  if (!supabase) return null;
  const { data } = await supabase.from("vendors").select("name, address, location_text, lat, lng").eq("id", vendorId).maybeSingle();
  const v = data as { name: string; address: string | null; location_text: string | null; lat: number | null; lng: number | null } | null;
  if (!v) return null;
  patch.name = v.name;
  if (v.address) patch.address = v.address;
  if (v.location_text) patch.location_text = v.location_text;
  if (v.lat != null) patch.lat = v.lat;
  if (v.lng != null) patch.lng = v.lng;
  return v.name;
}

// The address geocode, shared by save()'s main path and every VendorResolve decision below — skips
// itself when a vendor link already supplied coords, so a resolved vendor's own saved pin always
// wins over a fresh (and possibly slightly different) geocode of the same address text.
async function geocodeIfNoCoords(patch: Record<string, string | number | null>): Promise<void> {
  if (patch.lat != null) return;
  const q = (patch.address as string | null) || (patch.location_text as string | null) || "";
  if (!q) return;
  const g = await geocode(q).catch(() => null);
  if (g) { patch.lat = g.lat; patch.lng = g.lng; }
}

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
  // A name that came back "≥40% similar, not exact" — save() pauses here and asks (VendorResolve)
  // instead of guessing; the paused patch waits in pendingPatch until that's answered.
  const [vendorSimilar, setVendorSimilar] = useState<{ nm: string; candidates: VendorMatch[] } | null>(null);
  const pendingPatch = useRef<Record<string, string | number | null> | null>(null);
  // stage/status as loaded — only written back if the USER changed it, so the lifecycle
  // triggers (live/done automation) can't be clobbered by a stale quick-edit (panel catch).
  // For stops, "as loaded" is the DATE-DERIVED default (derivedStopStatus above), not the raw
  // column — so an unconfirmed default can never overwrite the real column either.
  const origStage = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    const sel = isEvent ? "title, day, location_text, stage" : "name, starts_at, location_text, address, status, completed_at, vendor_id";
    supabase.from(table).select(sel).eq("id", id).maybeSingle()
      .then(({ data }) => {
        const row = ((data ?? {}) as unknown) as Record<string, string | null>;
        if (!isEvent) row.status = derivedStopStatus(row.status ?? null, row.starts_at ?? null, row.completed_at ?? null);
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

  // The actual write, shared by the normal save path and every VendorResolve decision below.
  const finishSave = async (patch: Record<string, string | number | null>, message?: string) => {
    const { error } = await supabase!.from(table).update(patch).eq("id", id);
    setSaving(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    toast(message ?? (isEvent ? "Event saved" : "Stop saved — guests see the new time"));
    onSaved();
  };

  const save = async () => {
    if (!supabase || !f) return;
    setSaving(true);
    // rawName is what the human actually typed — nm falls back to a generic "Stop"/"Event" label
    // when it's blank. Vendor resolution must gate on rawName: a blank name saving as "Stop" must
    // never search (or worse, auto-create) a vendor literally named "Stop".
    const rawName = (f[isEvent ? "title" : "name"] || "").trim();
    const nm = rawName || (isEvent ? "Event" : "Stop");
    const patch: Record<string, string | number | null> = isEvent
      ? { title: nm, day: f.day || null, location_text: f.location_text?.trim() || null }
      : { name: nm, starts_at: f.starts_at || null, location_text: f.location_text?.trim() || null, address: f.address?.trim() || null };
    // stage/status: write ONLY a deliberate change (lifecycle automation owns it otherwise)
    const stageNow = (isEvent ? f.stage : f.status) ?? null;
    if (stageNow !== origStage.current) patch[isEvent ? "stage" : "status"] = stageNow;
    let vendorNote: string | undefined;
    if (!isEvent) {
      // the schedule just changed → the derived values must win over stale hand-set labels
      if (touchedWhen) { patch.when_label = null; patch.time_label = null; }
      // Vendor autocomplete (see the header comment) — skipped once already linked.
      if (!f.vendor_id && rawName) {
        const r = await resolveVendor(rawName, { source: "a truck stop", sort: 0 });
        if (r.kind === "similar") {
          pendingPatch.current = patch;
          setVendorSimilar({ nm: rawName, candidates: r.candidates });
          setSaving(false);
          return;
        }
        if (r.kind === "linked") { const vn = await pullVendorFields(r.id, patch); if (vn) vendorNote = `Stop saved — linked to ${vn}`; }
        else if (r.kind === "created") { const vn = await pullVendorFields(r.id, patch); vendorNote = `Stop saved — ${vn ?? rawName} added to the vendor book, pending approval`; }
        // kind === "error": best-effort, same spirit as the geocode fallback below — save the plain name.
      }
      await geocodeIfNoCoords(patch);
    }
    await finishSave(patch, vendorNote);
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
    <>
    <Sheet open onClose={onClose} className="dp-form" label={`Edit ${isEvent ? "event" : "truck stop"}`}
      header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>{isEvent ? "Event" : "Truck stop"}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}><Icon name="close" /></button></div>}>
      <input className="note-in" value={f[isEvent ? "title" : "name"] ?? ""} onChange={(e) => set(isEvent ? "title" : "name", e.target.value)} placeholder={isEvent ? "Event name" : f.vendor_id ? "Stop name" : "Stop name — matches your vendor book on save"} autoFocus />
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
    {vendorSimilar && (
      <VendorResolve
        name={vendorSimilar.nm}
        candidates={vendorSimilar.candidates}
        busy={saving}
        onUse={async (c) => {
          const patch = pendingPatch.current;
          pendingPatch.current = null;
          setVendorSimilar(null);
          if (!patch) return;
          setSaving(true);
          const vn = await pullVendorFields(c.id, patch);
          await geocodeIfNoCoords(patch);
          await finishSave(patch, vn ? `Stop saved — linked to ${vn}` : undefined);
        }}
        onAddLocation={async (c) => {
          const patch = pendingPatch.current;
          const typedName = vendorSimilar.nm;
          pendingPatch.current = null;
          setVendorSimilar(null);
          if (!patch) return;
          setSaving(true);
          // This stop IS the new location — its own typed address stays; pulling the vendor's OWN
          // address here would show the wrong site (this is a different one under the same partner).
          patch.vendor_id = c.id;
          patch.name = c.name;
          await addVendorLocation(c.id, { label: typedName, address: (patch.address as string | null) || null, location_text: (patch.location_text as string | null) ?? null });
          await geocodeIfNoCoords(patch);
          await finishSave(patch, `Stop saved — added as a location of ${c.name}`);
        }}
        onCreateDistinct={async () => {
          const patch = pendingPatch.current;
          const typedName = vendorSimilar.nm;
          pendingPatch.current = null;
          setVendorSimilar(null);
          if (!patch) return;
          setSaving(true);
          const r = await resolveVendor(typedName, { source: "a truck stop", sort: 0, decision: { createDistinct: true } });
          let vendorNote: string | undefined;
          if (r.kind === "linked" || r.kind === "created") {
            const vn = await pullVendorFields(r.id, patch);
            vendorNote = r.kind === "created" ? `Stop saved — ${vn ?? typedName} added to the vendor book, pending approval` : (vn ? `Stop saved — linked to ${vn}` : undefined);
          }
          await geocodeIfNoCoords(patch);
          await finishSave(patch, vendorNote);
        }}
        onSkip={async () => {
          const patch = pendingPatch.current;
          pendingPatch.current = null;
          setVendorSimilar(null);
          if (!patch) return;
          setSaving(true);
          await geocodeIfNoCoords(patch);
          await finishSave(patch);
        }}
        onClose={() => { pendingPatch.current = null; setVendorSimilar(null); setSaving(false); }}
      />
    )}
    </>
  );
}
