"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import Icon from "@/components/Icon";
import FieldOpSheet from "@/components/FieldOpSheet";
import InputSheet from "@/components/InputSheet";
import type { Stop, Vendor } from "@/lib/db";
import { geocode } from "@/lib/geocode";
import { VendorPicker } from "@/components/crew/VendorPicker";

// LOCATION EDITOR — the address / pin / vendor-link row for a stop or a vendor place.
//
// Lifted verbatim from app/crew/page.tsx, where it was rendered from two unrelated screens (the
// live-truck control and the vendors admin) while living in the middle of a 6,400-line file.

export function LocationEditor({ kind, row, index, open, onToggle, onChanged, onArchive, isCur, onGoLive, onGoOffline, vendors, onLinkVendor, onOpenPrep, nameOverride }: {
  kind: "stop" | "vendor"; row: Stop | Vendor; index: number; isCur?: boolean; open: boolean; onToggle: () => void;
  onArchive: () => void; onChanged: () => void;
  // onGoOffline is optional on top of onGoLive: without it the live banner below just stays a status
  // readout (today's Go-offline-only-from-elsewhere behavior); with it, the banner itself becomes the
  // one-tap way to end service on the live stop — see the ev-golive button.
  onGoLive?: (id: string) => void; onGoOffline?: () => void; vendors?: Vendor[]; onLinkVendor?: (v: Vendor | null) => void; onOpenPrep?: () => void;
  // When a stop is vendor-linked, the VENDOR is the place's identity — show its canonical name on
  // every visit row so two visits to one place can't read as two different names (panel finding).
  nameOverride?: string | null;
}) {
  const { toast } = useApp();
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
    toast(error ? `Error: ${error.message}` : msg);
    if (!error) onChanged();
  };
  const saveName = () => { const nm = name.trim(); if (nm && nm !== row.name) patch({ name: nm }, "Name saved"); };
  const saveLocation = async (): Promise<boolean> => {
    const q = address.trim(); if (!q) return false;
    setBusy(true);
    const geo = await geocode(q);
    if (!geo) { setBusy(false); toast("Couldn't find that address — add city & state, then retry."); return false; }
    const { error } = await supabase!.from(table).update({ address: q, location_text: q, lat: geo.lat, lng: geo.lng }).eq("id", row.id);
    // A vendor's location is the source of truth — push it to every linked stop/event so directions
    // stay accurate everywhere the venue is used (audit P1·7: the "edit once, updates everywhere"
    // promise was only half-true — POC read live, but address/coords were snapshotted and went stale).
    if (!error && kind === "vendor") {
      await supabase!.from("stops").update({ address: q, location_text: q, lat: geo.lat, lng: geo.lng }).eq("vendor_id", row.id);
      await supabase!.from("events").update({ location_text: q }).eq("vendor_id", row.id);
    }
    setBusy(false);
    toast(error ? `Error: ${error.message}` : kind === "vendor" ? "Location saved — linked stops & events updated" : "Location pinned — directions are now accurate");
    if (!error) onChanged();
    return !error;
  };
  const remove = async () => {
    const ask = kind === "stop" ? `Delete ${row.name}? This removes the record.` : `Delete ${row.name}? Linked stops/events will unlink.`;
    if (typeof window !== "undefined" && !window.confirm(ask)) return;
    const { error } = await supabase!.from(table).delete().eq("id", row.id);
    toast(error ? `Error: ${error.message}` : kind === "stop" ? "Location deleted" : "Vendor deleted");
    if (!error) onChanged();
  };
  const showPoc = kind === "vendor";
  const stopWhen = kind === "stop" && (row as { starts_at?: string | null }).starts_at
    ? new Date((row as { starts_at?: string | null }).starts_at as string).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;
  const sub = [stopWhen, vendor?.poc_name, vendor?.service_dates, hasCoords ? "pinned" : "no pin"].filter(Boolean).join("  ·  ");
  const tag = kind === "stop" ? `Location ${String(index + 1).padStart(2, "0")}${isCur ? " · Live" : ""}` : `Vendor ${String(index + 1).padStart(2, "0")}`;
  return (
    <div className={`ev-card${isCur ? " live" : ""}${open ? " open" : ""}`}>
      <button className="ev-head" onClick={onToggle} aria-expanded={open}>
        <span className="ev-led" />
        <span className="ev-head-main">
          <span className="ev-tag">{tag}</span>
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
              {/* the facts change HERE, in two taps (FieldOpSheet) — the prep hub stays the deep surface.
                  The one door to the hub lives in the footer below (ev-card-foot) — this group used to
                  ALSO carry its own "Full prep" button, on top of two more in the footer. Three buttons,
                  one destination — exactly the "why is prep on the screen twice" complaint that opened
                  this audit. FieldOpSheet still offers its own single door to the hub on demand; that one
                  stays (different surface, on-demand only, already correctly singular). */}
              <button type="button" className="adm-btn" onClick={() => setEditFacts(true)}>Edit name, date, time &amp; address ›</button>
              {editFacts && (
                <FieldOpSheet kind="stop" id={row.id} onClose={() => setEditFacts(false)}
                  onSaved={() => { setEditFacts(false); onChanged(); }} onOpenPrep={onOpenPrep} />
              )}
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

          {kind === "stop" && vendors && onLinkVendor && (
            <VendorPicker vendors={vendors} vendorId={stop?.vendor_id} onLink={onLinkVendor} onCreated={onChanged}
              onPickLocation={(loc) => patch({ address: loc.address ?? null, location_text: loc.location_text ?? loc.label, lat: loc.lat ?? null, lng: loc.lng ?? null }, `Stop set to ${loc.label}`)} />
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
