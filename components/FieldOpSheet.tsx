"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Sheet, { CloseButton, LeaveButton } from "@/components/Sheet";
import { edited } from "@/lib/formGuard";
import { useApp } from "@/components/AppProvider";
import { supabase } from "@/lib/supabase";
import { geocode } from "@/lib/geocode";
import VenuePick from "@/components/VenuePickLazy";
import type { VenueFill } from "@/lib/venues";
import { useLocationSuggestions } from "@/components/useLocationSuggestions";
import Icon from "@/components/Icon";
import { MARKETS, MARKET_LABEL, toMarket, FOUNDING_MARKET } from "@/lib/markets";
import { derivedStopStatus } from "@/lib/stopRecord";
import { archiveOwner } from "@/lib/wrap";
import { useConfirm } from "@/components/ConfirmSheet";

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
// The venue is PICKED (2026-10-05, the form audit, part 4 — components/VenuePick, the one venue
// control). save() used to match the stop's NAME against the vendor book: an exact name linked
// silently, a look-alike paused the save behind a confirm sheet, and anything else was added to the
// book as a pending vendor — so a stop called "Saturday" could mint a vendor called "Saturday", and
// an event here was never linked to anything. Now the place is picked for a stop and an event alike;
// what it fills (the name, Where, the address and the venue's pin) follows lib/pickFill, so a typed
// value stays typed; words that already spell a venue start on it and the line under the pick says
// saving links it; and a venue joins the book only when someone adds it, by name, from the pick.

type Kind = "event" | "stop";

// Truck stops read "Upcoming" forever unless a human flips the dropdown — a stop from last week
// nobody touched still shows Upcoming here even though FindUs/Route/PrepBoard already treat it as
// past (starts_at + 8h grace). This mirrors that same rule so the editor agrees with what guests
// and crew already see elsewhere. An explicit "done" or a completed_at stamp (the Complete-stop
// wrap flow, in OwnerDetails) always wins over the date math.

// A pin as the row brought it: numbers from the database, typed as the form's strings.
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

// The address geocode on save — skipped when the picked venue supplied its own pin for the address
// the stop ends up at (lib/venues.venueFill), so a venue's saved pin always wins over a fresh (and
// possibly slightly different) geocode of the same address text.
async function geocodeIfNoCoords(patch: Record<string, string | number | null>): Promise<void> {
  if (patch.lat != null) return;
  const q = (patch.address as string | null) || (patch.location_text as string | null) || "";
  if (!q) return;
  const g = await geocode(q).catch(() => null);
  if (g) { patch.lat = g.lat; patch.lng = g.lng; }
}

// What Save writes, per kind — the fields whose change is "unsaved" (lib/formGuard edited). The publish
// switch is not among them: it writes the moment it is flipped.
const EVENT_SAVES = ["title", "day", "location_text", "stage", "public_title", "market", "vendor_id"] as const;
const STOP_SAVES = ["name", "starts_at", "ends_at", "location_text", "address", "status", "market", "vendor_id"] as const;

export default function FieldOpSheet({ kind, id, onClose, onSaved, onChanged, onOpenPrep, page, walker }: {
  kind: Kind; id: string;
  onClose: () => void;
  onSaved: () => void;           // fired after a save or an archive — the caller closes the sheet
  /** A write that keeps the sheet open (the publish switch): the caller refreshes what is behind it. */
  onChanged?: () => void;
  onOpenPrep?: () => void;       // optional door to the full prep hub
  /** The calendar's walk: a sideways swipe on the sheet goes to the item before or after. */
  page?: { prev?: () => void; next?: () => void };
  /** The walk's own controls (the calendar's ‹ › pill), rendered inside the sheet so they leave by its door. */
  walker?: ReactNode;
}) {
  const confirm = useConfirm();
  const { toast } = useApp();
  const locSugs = useLocationSuggestions(); // datalist under Where/Address — the venues repeat
  const isEvent = kind === "event";
  const table = isEvent ? "events" : "stops";
  const [f, setF] = useState<Record<string, string | null> | null>(null);
  // The row as loaded: what "unsaved" is measured against.
  const [loaded, setLoaded] = useState<Record<string, string | null> | null>(null);
  const [saving, setSaving] = useState(false);
  const [touchedWhen, setTouchedWhen] = useState(false);
  // The pin the venue pick decided (lib/venues.venueFill): undefined leaves the geocode to save();
  // null means the old pin went with the old address.
  const [pin, setPin] = useState<{ lat: number; lng: number } | null | undefined>(undefined);
  // The venue as loaded — what the line under the pick compares ("Saving files it to…").
  const [origVendor, setOrigVendor] = useState<string | null>(null);
  // stage/status as loaded — only written back if the USER changed it, so the lifecycle
  // triggers (live/done automation) can't be clobbered by a stale quick-edit (panel catch).
  // For stops, "as loaded" is the DATE-DERIVED default (derivedStopStatus above), not the raw
  // column — so an unconfirmed default can never overwrite the real column either.
  const origStage = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    const sel = isEvent ? "title, day, location_text, stage, published_at, public_title, market, vendor_id" : "name, starts_at, ends_at, location_text, address, lat, lng, status, completed_at, vendor_id, market";
    supabase.from(table).select(sel).eq("id", id).maybeSingle()
      .then(({ data }) => {
        const row = ((data ?? {}) as unknown) as Record<string, string | null>;
        if (!isEvent) row.status = derivedStopStatus(row.status ?? null, row.starts_at ?? null, row.completed_at ?? null);
        origStage.current = (isEvent ? row.stage : row.status) ?? null;
        setOrigVendor(row.vendor_id ?? null);
        setF(row);
        setLoaded(row);
      });
  }, [table, isEvent, id]);

  const set = (k: string, v: string | null) => setF((p) => ({ ...(p ?? {}), [k]: v }));
  // A venue picked: its words into the form, its pin aside until save.
  const onVenue = (fill: VenueFill) => {
    setF((p) => ({ ...(p ?? {}), ...fill.text }));
    if (fill.pin !== undefined) setPin(fill.pin);
  };

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
  // Close time (stops.ends_at) — online ordering auto-closes 60 min before this and the truck goes
  // offline 45 min before it (FindUs). Empty = no auto wind-down. Same day as the start.
  const endTimeVal = !f || isEvent || !f.ends_at ? "" : (() => { const d = new Date(f.ends_at); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })();
  const onEndTime = (v: string) => {
    if (isEvent) return;
    if (!v) { set("ends_at", null); return; }
    setTouchedWhen(true);
    const dayKey = f?.starts_at ? new Date(f.starts_at).toLocaleDateString("en-CA") : new Date().toLocaleDateString("en-CA");
    set("ends_at", new Date(`${dayKey}T${v}:00`).toISOString());
  };

  const save = async () => {
    if (!supabase || !f) return;
    setSaving(true);
    const nm = (f[isEvent ? "title" : "name"] || "").trim() || (isEvent ? "Event" : "Stop");
    // The venue the pick left on the form — a stop's and, since the venue pick, an event's too.
    const patch: Record<string, string | number | null> = isEvent
      ? { title: nm, day: f.day || null, location_text: f.location_text?.trim() || null, market: toMarket(f.market), vendor_id: f.vendor_id || null,
          // Publish gate (0270): published_at carries the guest-visibility decision; public_title is
          // the optional guest-facing name. Both are set by the toggle/field below, written verbatim.
          published_at: f.published_at || null, public_title: f.public_title?.trim() || null }
      : { name: nm, starts_at: f.starts_at || null, ends_at: f.ends_at || null, location_text: f.location_text?.trim() || null, address: f.address?.trim() || null, market: toMarket(f.market), vendor_id: f.vendor_id || null };
    // stage/status: write ONLY a deliberate change (lifecycle automation owns it otherwise)
    const stageNow = (isEvent ? f.stage : f.status) ?? null;
    if (stageNow !== origStage.current) patch[isEvent ? "stage" : "status"] = stageNow;
    if (!isEvent) {
      // the schedule just changed → the derived values must win over stale hand-set labels
      if (touchedWhen) { patch.when_label = null; patch.time_label = null; }
      if (pin !== undefined) { patch.lat = pin?.lat ?? null; patch.lng = pin?.lng ?? null; }
      await geocodeIfNoCoords(patch);
    }
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    setSaving(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    toast(isEvent ? "Event saved" : "Stop saved — guests see the new time");
    onSaved();
  };

  const archive = async () => {
    if (!supabase) return;
    if (!(await confirm({ title: `Archive this ${isEvent ? "event" : "stop"}?`, body: "It comes off the calendar and the customer app.", confirmLabel: "Archive" }))) return;
    setSaving(true);
    // lib/wrap's write, shared with OwnerDetails, EventsAdmin and the record sheets — an archived
    // event drops its live flag with it, which this copy used to leave set.
    const { error } = await archiveOwner(supabase, { kind, id });
    setSaving(false);
    if (error) { toast(`Couldn't archive — ${error.message}`, "error"); return; }
    toast("Archived");
    onSaved();
  };

  // Publish/hide toggle — persists IMMEDIATELY (like archive), not just local state. Before, flipping
  // it only updated the on-screen label and relied on the separate Save press; hiding an event from
  // guests silently didn't stick if you closed without saving. Optimistic flip + write, revert on error.
  // It keeps the sheet open (2026-10-05): it called onSaved, and every caller closes the sheet on
  // that — so publishing an event threw away whatever else had been typed and not saved yet.
  const togglePublish = async () => {
    if (!supabase || !f || !isEvent) return;
    const next = f.published_at ? null : new Date().toISOString();
    set("published_at", next);
    const { error } = await supabase.from(table).update({ published_at: next }).eq("id", id);
    if (error) { set("published_at", f.published_at ?? null); toast(`Couldn't ${next ? "publish" : "hide"} — ${error.message}`, "error"); return; }
    toast(next ? "Published — live to guests" : "Hidden from guests");
    onChanged?.();
  };

  if (!f) return null;
  const dirty = edited(f, loaded, isEvent ? EVENT_SAVES : STOP_SAVES);
  return (
    <>
    <Sheet open onClose={onClose} className="dp-form" label={`Edit ${isEvent ? "event" : "truck stop"}`} dirty={dirty} page={page}
      header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>{isEvent ? "Event" : "Truck stop"}</b><CloseButton onClick={onClose} /></div>}
      footer={
        <div className="prod-actions" style={{ marginTop: 0 }}>
          <LeaveButton className="note-arch" onClick={onClose} disabled={saving}>Cancel</LeaveButton>
          <button type="button" className="note-save" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      }>
      <input className="note-in" value={f[isEvent ? "title" : "name"] ?? ""} onChange={(e) => set(isEvent ? "title" : "name", e.target.value)} placeholder={isEvent ? "Event name" : "Stop name"} aria-label={isEvent ? "Event name" : "Stop name"} autoFocus />
      <div className="prod-grid" style={{ marginTop: 10 }}>
        <label className="prod-f"><span>Date</span><input type="date" value={dateVal} onChange={(e) => onDate(e.target.value)} /></label>
        {!isEvent && <label className="prod-f"><span>Start time</span><input type="time" value={timeVal} onChange={(e) => onTime(e.target.value)} /></label>}
        {!isEvent && <label className="prod-f"><span>End time</span><input type="time" value={endTimeVal} onChange={(e) => onEndTime(e.target.value)} /></label>}
        {isEvent && (
          <label className="prod-f"><span>Stage</span>
            <select value={f.stage ?? "confirmed"} onChange={(e) => set("stage", e.target.value)}>
              <option value="lead">Lead</option><option value="confirmed">Confirmed</option><option value="prep">Prep</option><option value="live">Live</option><option value="done">Done</option>
            </select>
          </label>
        )}
      </div>
      <VenuePick kind={kind} source={isEvent ? "an event" : "a truck stop"} saved={origVendor} onChange={onVenue} style={{ marginTop: 8 }}
        rec={{ vendor_id: f.vendor_id, name: f[isEvent ? "title" : "name"], location_text: f.location_text, address: f.address, market: f.market,
               lat: pin === undefined ? numOrNull(f.lat) : pin?.lat ?? null, lng: pin === undefined ? numOrNull(f.lng) : pin?.lng ?? null }} />
      {/* What the venue filled stays editable — a typed value stays typed (lib/pickFill). The places
          typed before are suggested only while the stop or event is linked to no venue. */}
      <label className="prod-f" style={{ marginTop: 8 }}><span>Where</span><input value={f.location_text ?? ""} onChange={(e) => set("location_text", e.target.value)} placeholder="Where" list={f.vendor_id ? undefined : "gt3-locs-fieldop"} /></label>
      {!isEvent && <label className="prod-f" style={{ marginTop: 8 }}><span>Address (pins the map + directions)</span><input value={f.address ?? ""} onChange={(e) => { set("address", e.target.value); setPin(undefined); }} placeholder="123 Peach St, Atlanta GA" list={f.vendor_id ? undefined : "gt3-locs-fieldop"} /></label>}
      {!f.vendor_id && locSugs.length > 0 && <datalist id="gt3-locs-fieldop">{locSugs.map((s) => <option key={s} value={s} />)}</datalist>}
      {/* MARKET (0279) — which city this belongs to. It lives HERE, in the one sheet that reaches
          every stop and event in two taps, rather than in each of the three places a stop can be
          created: one control to find, and re-tagging something created in the wrong city is the
          same two taps as fixing its time. Defaults to the founding market, exactly like the column,
          so a crew member who never opens this row changes nothing. */}
      <label className="prod-f" style={{ marginTop: 8 }}>
        <span>City {f.market && toMarket(f.market) !== FOUNDING_MARKET ? <i>(guests in other cities won&rsquo;t see this)</i> : null}</span>
        <select value={toMarket(f.market)} onChange={(e) => set("market", e.target.value)}>
          {MARKETS.map((m) => <option key={m} value={m}>{MARKET_LABEL[m]}</option>)}
        </select>
      </label>
      {!isEvent && (
        <label className="prod-f" style={{ marginTop: 8 }}><span>Status</span>
          <select value={f.status ?? "upcoming"} onChange={(e) => set("status", e.target.value)}>
            <option value="upcoming">Upcoming</option><option value="done">Done</option>
          </select>
        </label>
      )}
      {isEvent && (
        // GUEST VISIBILITY (0270) — the publish decision, on the event everyone already edits here.
        // Toggling it flips published_at; guests see the event only once it's on. Truck stops have no
        // such control — they're always customer-facing. The optional public name lets an internal
        // title ("Soul Yoga pilot #2 · compliance pending") face guests as something cleaner.
        <div className={`fop-pub${f.published_at ? " on" : ""}`} style={{ marginTop: 12 }}>
          <button type="button" className="fop-pub-toggle" role="switch" aria-checked={!!f.published_at}
            onClick={togglePublish}>
            <span className="fop-pub-dot" aria-hidden="true" />
            <span className="fop-pub-l">
              <b>{f.published_at ? "Published to guests" : "Hidden from guests"}</b>
              <span>{f.published_at
                ? `Live on the customer calendar${f.published_at.length >= 10 ? ` · since ${new Date(f.published_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}`
                : "Only the crew can see this — tap to publish"}</span>
            </span>
          </button>
          {f.published_at && (
            <label className="prod-f" style={{ marginTop: 8 }}><span>Public name <i>(optional — blank uses the event name)</i></span>
              <input value={f.public_title ?? ""} onChange={(e) => set("public_title", e.target.value)} placeholder={f.title ?? "Name guests see"} maxLength={120} />
            </label>
          )}
        </div>
      )}
      {onOpenPrep && (
        <LeaveButton className="btn-ter" style={{ marginTop: 12 }} onClick={onOpenPrep}>
          Full prep — menu, staffing, run-of-show <b><Icon name="arrowRight" /></b>
        </LeaveButton>
      )}
      <div className="ownerdet-danger" style={{ marginTop: 12 }}>
        <button type="button" className="ownerdet-arch" onClick={archive} disabled={saving}>Archive</button>
      </div>
      {walker}
    </Sheet>
    </>
  );
}
