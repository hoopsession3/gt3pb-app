"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import Icon from "@/components/Icon";
import FieldOpSheet from "@/components/FieldOpSheet";
import InputSheet from "@/components/InputSheet";
import type { Stop, Vendor } from "@/lib/db";
import { geocode } from "@/lib/geocode";
import VenueContact from "@/components/VenueContact";
import { useConfirm } from "@/components/ConfirmSheet";
import { useAuth } from "@/components/AuthProvider";
import { useOperatorSection } from "@/components/OperatorNav";
import { canOf } from "@/lib/roles";
import { goPlanTab } from "@/lib/planNav";
import { isStopAhead, wasAtVendorsPlace, type RoadStop } from "@/lib/stopRecord";
import { eventIsPast } from "@/lib/readiness";
import { localToday, etDayKey, etToday, timeRange } from "@/lib/dates";
import { dateLine } from "@/lib/eventRecord";
import { vendorKindLabel } from "@/lib/vendorKind";
import { useLongPress, type MenuItem } from "@/components/LongPress";

// LOCATION EDITOR — the address / pin / vendor-link row for a stop or a vendor place.
//
// Lifted verbatim from app/crew/page.tsx, where it was rendered from two unrelated screens (the
// live-truck control and the vendors admin) while living in the middle of a 6,400-line file.

type LinkedStop = RoadStop & { address: string | null; location_text: string | null };
type LinkedEvent = { id: string; location_text: string | null; day: string | null; completed_at: string | null; archived_at: string | null };

/** A venue's new address, carried to its visits still ahead that were at its old one. Returns the toast's tail. */
async function moveUpcomingVisits(venue: Vendor | Stop, address: string, geo: { lat: number; lng: number }): Promise<string> {
  const old = { name: venue.name, address: venue.address, location_text: venue.location_text };
  const [st, ev] = await Promise.all([
    supabase!.from("stops").select("id, address, location_text, starts_at, status, completed_at, archived_at").eq("vendor_id", venue.id),
    supabase!.from("events").select("id, location_text, day, completed_at, archived_at").eq("vendor_id", venue.id),
  ]);
  // A FAILED READ IS NOT AN EMPTY LIST: the venue saved, and nothing linked to it was touched.
  if (st.error || ev.error) return " — couldn't read its stops and events, so none were moved";
  const today = localToday();
  const stopIds = ((st.data ?? []) as LinkedStop[]).filter((s) => isStopAhead(s) && wasAtVendorsPlace(old, s)).map((s) => s.id);
  const eventIds = ((ev.data ?? []) as LinkedEvent[])
    .filter((e) => !e.archived_at && !e.completed_at && !eventIsPast(e.day, today) && wasAtVendorsPlace(old, e)).map((e) => e.id);
  const [su, eu] = await Promise.all([
    stopIds.length ? supabase!.from("stops").update({ address, location_text: address, lat: geo.lat, lng: geo.lng }).in("id", stopIds) : { error: null },
    eventIds.length ? supabase!.from("events").update({ location_text: address }).in("id", eventIds) : { error: null },
  ]);
  const failed = su.error ?? eu.error;
  if (failed) return ` — couldn't move its upcoming visits (${failed.message})`;
  const n = stopIds.length + eventIds.length;
  return n ? ` — ${n} upcoming ${n === 1 ? "visit" : "visits"} moved with it` : " — no upcoming visits were at the old address";
}

export function LocationEditor({ kind, row, open, onToggle, onChanged, onArchive, isCur, onGoLive, onGoOffline, venue, onOpenPrep, nameOverride }: {
  kind: "stop" | "vendor"; row: Stop | Vendor; isCur?: boolean; open: boolean; onToggle: () => void;
  onArchive: () => void; onChanged: () => void;
  // onGoOffline is optional on top of onGoLive: without it the live banner below just stays a status
  // readout (today's Go-offline-only-from-elsewhere behavior); with it, the banner itself becomes the
  // one-tap way to end service on the live stop — see the ev-golive button.
  onGoLive?: (id: string) => void; onGoOffline?: () => void; onOpenPrep?: () => void;
  // The venue a stop is linked to, from the book Route already holds — said here, picked in the
  // stop's sheet (FieldOpSheet → components/VenuePick), the one place a stop's venue is chosen.
  venue?: Vendor | null;
  // When a stop is vendor-linked, the VENDOR is the place's identity — show its canonical name on
  // every visit row so two visits to one place can't read as two different names (panel finding).
  nameOverride?: string | null;
}) {
  const confirm = useConfirm();
  const { toast } = useApp();
  const { profile } = useAuth();
  const { setSection } = useOperatorSection();
  const table = kind === "stop" ? "stops" : "vendors";
  const stop = kind === "stop" ? (row as Stop) : null;
  // POC/service-dates live only on vendors now (0240 dropped the dead stops.poc_* columns) —
  // this cast is how the subtitle + editor below read them without widening Stop's type.
  const vendor = kind === "vendor" ? (row as Vendor) : null;
  const displayName = (nameOverride && nameOverride.trim()) || row.name;
  const [name, setName] = useState(row.name);
  const [address, setAddress] = useState(row.address ?? "");
  const [busy, setBusy] = useState(false);
  const [editAddr, setEditAddr] = useState(false);
  const [editFacts, setEditFacts] = useState(false); // FieldOpSheet — quick core-facts editor
  const hasCoords = row.lat != null && row.lng != null;

  // every update carries a WHERE (id) — safe with the safeupdate guard
  const patch = async (p: Record<string, unknown>, msg = "Saved") => {
    const { error } = await supabase!.from(table).update(p).eq("id", row.id);
    toast(error ? `Error: ${error.message}` : msg, error ? "error" : undefined);
    if (!error) onChanged();
  };
  const saveName = () => { const nm = name.trim(); if (nm && nm !== row.name) patch({ name: nm }, "Name saved"); };
  const saveLocation = async (): Promise<boolean> => {
    const q = address.trim(); if (!q) return false;
    setBusy(true);
    const geo = await geocode(q);
    if (!geo) { setBusy(false); toast("Couldn't find that address — add city & state, then retry.", "error"); return false; }
    const { error } = await supabase!.from(table).update({ address: q, location_text: q, lat: geo.lat, lng: geo.lng }).eq("id", row.id);
    // A vendor's location is the source of truth — push it to the linked stops and events so
    // directions stay accurate everywhere the venue is used (audit P1·7: the "edit once, updates
    // everywhere" promise was only half-true — POC read live, but address/coords were snapshotted).
    //
    // But only to the visits STILL AHEAD that were AT THE OLD PLACE (2026-10-04, the form audit).
    // This updated every row with the vendor's id: a stop that had already happened was rewritten
    // to an address it was never at, and a stop at the venue's second location was moved to its
    // first. lib/stopRecord.wasAtVendorsPlace says which visits were here; the road (isStopAhead)
    // and the calendar (eventIsPast) say which are still to come.
    const moved = !error && kind === "vendor" ? await moveUpcomingVisits(row, q, geo) : "";
    setBusy(false);
    toast(error ? `Error: ${error.message}` : kind === "vendor" ? `Location saved${moved}` : "Location pinned — directions are now accurate", error ? "error" : undefined);
    if (!error) onChanged();
    return !error;
  };
  const remove = async () => {
    if (!(await confirm({ title: `Delete ${row.name}?`, body: kind === "stop" ? "This removes the record." : "Linked stops and events will unlink.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await supabase!.from(table).delete().eq("id", row.id);
    toast(error ? `Error: ${error.message}` : kind === "stop" ? "Location deleted" : "Vendor deleted", error ? "error" : undefined);
    if (!error) onChanged();
  };
  const showPoc = kind === "vendor";
  // THE SAME HEADER AS AN EVENT'S (2026-10-05). "LOCATION 01", "VENDOR 02" were the row's place in
  // the list — Plan › Events said "EVENT 01" the same way, and Ryan's screenshot of it is what
  // retired all three. A visit leads with its date against today (lib/eventRecord.dateLine, keyed on
  // the business day so it reads like the event beside it), its hours pinned to ET (lib/dates); a
  // book entry says which side of the business it is on (0298's kind).
  const startsAt = stop?.starts_at ?? null;
  const tag = kind === "stop"
    ? dateLine(startsAt ? etDayKey(new Date(startsAt)) : null, etToday())
    : vendorKindLabel(vendor?.kind);
  const hours = kind === "stop" ? timeRange(startsAt, stop?.ends_at) : "";
  const sub = [hours, vendor?.poc_name, vendor?.service_dates, hasCoords ? "pinned" : "no pin"].filter(Boolean).join(" · ");
  const stopWhen = startsAt ? [tag, hours].filter(Boolean).join(" · ") : null;
  // A LONG PRESS ON A STOP (2026-10-08, the navigation round, approved): on its head, the card's own buttons by
  // name, open or not — go live here (or take the truck offline), edit its facts, its full prep. The open card's
  // words (the address, the venue's number) still select.
  const menu: MenuItem[] = kind !== "stop" ? [] : [
    { key: "open", label: open ? "Hide the details" : "Show the details", icon: open ? "close" : "info", run: onToggle },
    ...(onGoLive && !isCur ? [{ key: "live", label: "Go live here", icon: "dot", run: () => onGoLive(row.id) } satisfies MenuItem] : []),
    ...(isCur && onGoOffline ? [{ key: "offline", label: "Take the truck offline", icon: "dotOutline", run: onGoOffline } satisfies MenuItem] : []),
    { key: "edit", label: "Edit name, date, time, venue & address", icon: "edit", run: () => setEditFacts(true) },
    ...(onOpenPrep ? [{ key: "prep", label: "Full prep — menu, staffing, run-of-show", icon: "arrowRight", run: onOpenPrep } satisfies MenuItem] : []),
  ];
  const press = useLongPress(displayName || "Untitled location", menu);
  return (
    <div className={`ev-card${isCur ? " live" : ""}${open ? " open" : ""}`}>
      {press.menu}
      {/* The facts' sheet is drawn whether the card is open or not: the menu opens it from a closed card. */}
      {editFacts && (
        <FieldOpSheet kind="stop" id={row.id} onClose={() => setEditFacts(false)}
          onSaved={() => { setEditFacts(false); onChanged(); }} onOpenPrep={onOpenPrep} />
      )}
      <button {...press.bind} className={`ev-head${kind === "stop" ? " pressable" : ""}`} onClick={onToggle} aria-expanded={open}>
        {/* The light is the live flag and nothing else (an empty ring read as a checkbox). */}
        {isCur && <span className="ev-led" />}
        <span className="ev-head-main">
          {tag && <span className="ev-tag">{tag}</span>}
          <span className="ev-title">{displayName || (kind === "stop" ? "Untitled location" : "Untitled vendor")}</span>
          <span className="ev-sub">{sub || "Tap to set up"}</span>
        </span>
        <span className="ev-head-badges">
          {isCur && <span className="ev-badge live"><Icon name="dot" /> Live</span>}
          <span className="ev-chev">›</span>
        </span>
      </button>

      {open && (
        <div className="ev-body">
          {kind === "stop" && onGoLive && (
            // Was a dead end while live: disabled unconditionally, so the one banner telling you
            // the truck IS live had no way to take it back offline from here — you had to already
            // know a separate "Go offline" button existed elsewhere. Now: live + onGoOffline wired
            // up = this IS that button (same confirm-and-archive flow as everywhere else Go offline
            // lives, since onGoOffline is just `pause`). No onGoOffline passed → falls back to the
            // old disabled status-only banner, so nothing breaks for any caller that doesn't wire it.
            <button
              className={`ev-golive${isCur ? " on" : ""}`}
              onClick={() => (isCur ? onGoOffline?.() : onGoLive(row.id))}
              disabled={isCur && !onGoOffline}
            >
              <span className="ev-golive-dot" />
              <span>{isCur ? (onGoOffline ? "Live here now — tap to take the truck offline" : "Live here now — guests see this location") : "Go live at this location"}</span>
              <span className="ev-golive-state">{isCur ? (onGoOffline ? "END" : "LIVE") : "GO"}</span>
            </button>
          )}

          {kind === "stop" ? (
            /* Identity is the PREP HUB's job (one editor per stop — same rule the calendar
               follows). Route shows the facts and one door to change them. */
            <div className="ev-group">
              <div className="ev-group-h">Location</div>
              <div className="stop-coords ok" style={{ marginTop: 0 }}>{displayName || "Untitled location"}{stopWhen ? ` · ${stopWhen}` : " · no date"}</div>
              <div className={`stop-coords${hasCoords ? " ok" : ""}`}>{hasCoords ? `Pinned · ${(row.lat as number).toFixed(4)}, ${(row.lng as number).toFixed(4)}` : "No pin yet — add the address for accurate directions"}</div>
              {/* THE VENUE IS SAID HERE AND PICKED IN THE SHEET (2026-10-05, the form audit, part 4).
                  This card carried a vendor <select> of its own under the Location group — a second
                  editor for the one fact the stop's sheet edits, against this group's own rule, with
                  a "Which location?" list that wrote nulls over the stop's address and pin when the
                  place picked had none. The pick lives in the sheet now (components/VenuePick, the
                  same control on every stop and event editor); this says what it is, and who to call. */}
              <div className={`stop-coords${venue ? " ok" : ""}`}>
                {venue ? `Venue · ${venue.name}${venue.status === "pending" ? " · waiting on the owner's approval" : ""}`
                  : stop?.vendor_id ? "Venue · no longer in the venue book — pick where it is now"
                  : "No venue linked — the place is typed, and the next visit here will be too"}
                {venue?.status === "pending" && canOf(profile).admin && <> <button type="button" className="rec-link" onClick={() => goPlanTab("vendors", { setSection })}>Review it ›</button></>}
              </div>
              {/* the facts change HERE, in two taps (FieldOpSheet) — the prep hub stays the deep surface.
                  The one door to the hub lives in the footer below (ev-card-foot) — this group used to
                  ALSO carry its own "Full prep" button, on top of two more in the footer. Three buttons,
                  one destination — exactly the "why is prep on the screen twice" complaint that opened
                  this audit. FieldOpSheet still offers its own single door to the hub on demand; that one
                  stays (different surface, on-demand only, already correctly singular). */}
              <button type="button" className="adm-btn" onClick={() => setEditFacts(true)}>Edit name, date, time, venue &amp; address ›</button>
              {venue && <VenueContact venue={venue} />}
            </div>
          ) : (
          <div className="ev-group">
            <div className="ev-group-h">Venue</div>
            <input className="ev-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} maxLength={120} placeholder="Vendor / venue name" />
            <button type="button" className="ev-fieldbtn" onClick={() => setEditAddr(true)}>
              <span className="ev-fieldbtn-l">Address</span>
              <span className={`ev-fieldbtn-v${address.trim() ? "" : " ph"}`}>{address.trim() || "Tap to add — we'll pin it on the map"}</span>
              <span className="ev-fieldbtn-chev">›</span>
            </button>
            <div className={`stop-coords${hasCoords ? " ok" : ""}`}>{hasCoords ? `Pinned · ${(row.lat as number).toFixed(4)}, ${(row.lng as number).toFixed(4)}` : "No pin yet — add an address for accurate directions"}</div>
            {editAddr && (
              <InputSheet
                title="Street address" value={address} onChange={setAddress}
                placeholder="123 Main St, City, ST" inputMode="text" maxLength={300}
                busy={busy} doneLabel="Save & pin"
                hint="Add city & state for an accurate pin — or paste a Google Maps link."
                help={{ label: "Where do I find this?", detail: (<>On Google Maps, find the spot → <b>Share</b> → <b>Copy link</b> and paste it here — or type the full street address with city &amp; state. We geocode it and drop the live-map pin guests follow.</>) }}
                onClose={() => setEditAddr(false)}
                onDone={async () => { if (await saveLocation()) setEditAddr(false); }}
              />
            )}
          </div>
          )}

          {showPoc && (
            <div className="ev-group">
              <div className="ev-group-h">Point of contact</div>
              <input className="ev-input" defaultValue={vendor?.poc_name ?? ""} placeholder="POC name" maxLength={120} onBlur={(e) => { if ((e.target.value.trim() || null) !== (vendor?.poc_name ?? null)) patch({ poc_name: e.target.value.trim() || null }, "Contact saved"); }} />
              <input className="ev-input" type="tel" defaultValue={vendor?.poc_phone ?? ""} placeholder="Phone" maxLength={40} onBlur={(e) => { if ((e.target.value.trim() || null) !== (vendor?.poc_phone ?? null)) patch({ poc_phone: e.target.value.trim() || null }, "Contact saved"); }} />
              <input className="ev-input" type="email" defaultValue={vendor?.poc_email ?? ""} placeholder="Email" maxLength={160} onBlur={(e) => { if ((e.target.value.trim() || null) !== (vendor?.poc_email ?? null)) patch({ poc_email: e.target.value.trim() || null }, "Contact saved"); }} />
            </div>
          )}

          {kind === "vendor" && (
            <div className="ev-group"><div className="ev-group-h">Dates of service</div><input className="ev-input" defaultValue={vendor?.service_dates ?? ""} placeholder="e.g. Saturdays · May – Aug" maxLength={200} onBlur={(e) => { if ((e.target.value.trim() || null) !== (vendor?.service_dates ?? null)) patch({ service_dates: e.target.value.trim() || null }, "Saved"); }} /></div>
          )}

          {kind === "vendor" && (
            <div className="ev-group">
              <div className="ev-group-h">Notes</div>
              <textarea className="ev-input ev-area" rows={2} maxLength={1000} defaultValue={row.notes ?? ""} placeholder="Anything to remember about this vendor" onBlur={(e) => { if (e.target.value !== (row.notes ?? "")) patch({ notes: e.target.value.trim() || null }, "Details saved"); }} />
            </div>
          )}

          <div className="ev-card-foot">
            {/* One door to the hub, not three. Used to also duplicate the Location group's button above,
                plus a second footer button styled and labeled as if "Wrap up in the hub" were a distinct
                complete-this-stop action — it wasn't: both buttons called this exact same onOpenPrep with
                no differentiating state, so the green "complete" styling and check icon promised something
                that never happened. */}
            {kind === "stop" && onOpenPrep && <button className="adm-btn" style={{ marginRight: "auto" }} onClick={onOpenPrep}>Full prep — menu, staffing, run-of-show ›</button>}
            {kind === "vendor" && <button className="ev-archive" onClick={onArchive}>Archive</button>}
            {kind === "vendor" && <button className="ev-delete" onClick={remove}>Delete</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── live truck control ─────────────────────────
