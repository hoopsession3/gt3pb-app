"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import Icon from "@/components/Icon";
import PourFill from "@/components/PourFill";
import { type OpSection } from "@/components/OperatorNav";
import type { Vendor, VendorLocation } from "@/lib/db";
import { resolveVendor, addVendorLocation, type VendorMatch, type ResolveDecision } from "@/lib/vendorLink";

// Same dynamic import the page used — the resolve sheet is heavy and only opens on demand.
const VendorResolve = dynamic(() => import("@/components/VendorResolve"), { loading: () => <PourFill label="Loading…" /> });

// VENDOR PICKER — link a stop or an event to the vendor whose place it happens at.
//
// Lifted verbatim from app/crew/page.tsx. It was rendered from two different places in that file
// (the stop prep sheet and the event card) while being declared in the middle of it, which is the
// shape that makes a 6,500-line page hard to work in: a shared component with no address.

export function VendorPicker({ vendors, vendorId, onLink, onCreated, onPickLocation }: { vendors: Vendor[]; vendorId: string | null | undefined; onLink: (v: Vendor | null) => void; onCreated?: () => void; onPickLocation?: (loc: VendorLocation) => void }) {
  const { toast } = useApp();
  const linked = vendors.find((v) => v.id === vendorId) || null;
  const [adding, setAdding] = useState(false);
  const [nm, setNm] = useState("");
  const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<VendorMatch[] | null>(null);
  const [locs, setLocs] = useState<VendorLocation[]>([]);
  const [addingLoc, setAddingLoc] = useState(false);
  const [locNm, setLocNm] = useState("");
  const [locAddr, setLocAddr] = useState("");

  // The linked vendor's places (0226) — one shows as the place; several ask which.
  useEffect(() => {
    let on = true;
    (async () => {
      if (!supabase || !vendorId) { if (on) setLocs([]); return; }
      const { data, error } = await supabase.from("vendor_locations").select("*").eq("vendor_id", vendorId).is("archived_at", null).order("is_primary", { ascending: false }).order("sort");
      // "One place" vs "which of these?" is decided by this list; an empty one on a failed read
      // silently picks the wrong branch. Keep what is there rather than assert the vendor has none.
      if (error) return;
      if (on) setLocs((data as VendorLocation[]) ?? []);
    })();
    return () => { on = false; };
  }, [vendorId]);

  const linkById = async (id: string): Promise<Vendor | null> => {
    let v = vendors.find((x) => x.id === id) ?? null;
    if (!v && supabase) v = ((await supabase.from("vendors").select("*").eq("id", id).single()).data as Vendor | null);
    if (v) onLink(v);
    return v;
  };

  // ONE resolver (0226): exact → link · look-alike → the confirm sheet · clean miss → pending create.
  const create = async (decision?: ResolveDecision) => {
    const name = nm.trim();
    if (!name || busy || !supabase) return;
    setBusy(true);
    const r = await resolveVendor(name, { source: "a truck stop", sort: vendors.length, decision });
    setBusy(false);
    if (r.kind === "similar") { setSimilar(r.candidates); return; }
    if (r.kind === "error") { toast(`Couldn't add venue: ${r.message}`, "error"); return; }
    setSimilar(null);
    const v = await linkById(r.id);
    toast(r.kind === "created" ? `${name} linked — pending owner approval` : `Linked to ${v?.name ?? name}`);
    setNm(""); setAdding(false); onCreated?.();
  };

  const addLoc = async () => {
    if (!vendorId || !locNm.trim() || !supabase) return;
    const made = await addVendorLocation(vendorId, { label: locNm.trim(), address: locAddr.trim() || null });
    if (!made) { toast("Couldn't add the location", "error"); return; }
    const { data } = await supabase.from("vendor_locations").select("*").eq("id", made.id).single();
    setLocNm(""); setLocAddr(""); setAddingLoc(false);
    if (data) {
      setLocs((p) => [...p, data as VendorLocation]);
      onPickLocation?.(data as VendorLocation);
      toast("Location added & set on this stop");
    }
  };
  return (
    <div className="ev-group">
      <div className="ev-group-h">Venue · vendor</div>
      <select className="ev-input" value={vendorId ?? ""} onChange={(e) => onLink(vendors.find((v) => v.id === e.target.value) || null)}>
        <option value="">— not linked —</option>
        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.status === "pending" ? " · pending" : ""}</option>)}
      </select>
      {linked?.status === "pending" && <div className="vpend">Pending owner approval — review it in Plan › Vendors.</div>}
      {linked && (linked.address || linked.location_text || linked.poc_name || linked.poc_phone || linked.poc_email || linked.service_dates) && (
        <div className="vlink">
          {(linked.address || linked.location_text) && <div className="vlink-row"><span>Address</span><b>{linked.address || linked.location_text}</b></div>}
          {linked.poc_name && <div className="vlink-row"><span>Liaison</span><b>{linked.poc_name}</b></div>}
          {linked.poc_phone && <div className="vlink-row"><span>Phone</span><a href={`tel:${linked.poc_phone}`}>{linked.poc_phone}</a></div>}
          {linked.poc_email && <div className="vlink-row"><span>Email</span><a href={`mailto:${linked.poc_email}`}>{linked.poc_email}</a></div>}
          {linked.service_dates && <div className="vlink-row"><span>Service</span><b>{linked.service_dates}</b></div>}
          <div className="vlink-note">Pulled from the vendor book — edits there update everywhere it&apos;s linked.</div>
        </div>
      )}
      {/* Multi-location vendor (0226): several places → ask which; one → it's simply the place. */}
      {linked && locs.length > 1 && (
        <div className="ev-group" style={{ marginTop: 8 }}>
          <div className="ev-group-h">Which location?</div>
          <select className="ev-input" value="" onChange={(e) => {
            const loc = locs.find((l) => l.id === e.target.value);
            if (loc) { onPickLocation?.(loc); toast(`Stop set to ${linked.name} — ${loc.label}`); }
          }}>
            <option value="">Pick the location for this stop…</option>
            {locs.map((l) => <option key={l.id} value={l.id}>{l.label}{l.is_primary ? " · primary" : ""}{l.address ? ` — ${l.address}` : ""}</option>)}
          </select>
        </div>
      )}
      {linked && locs.length === 1 && (locs[0].address || locs[0].label !== "Main") && (
        <div className="vlink" style={{ marginTop: 8 }}>
          <div className="vlink-row"><span>Place</span><b>{locs[0].label}{locs[0].address ? ` — ${locs[0].address}` : ""}</b></div>
        </div>
      )}
      {linked && (addingLoc ? (
        <div className="vnew-row">
          <input className="ev-input" value={locNm} onChange={(e) => setLocNm(e.target.value)} placeholder="Location name — e.g. Downtown" maxLength={80} autoFocus />
          <input className="ev-input" value={locAddr} onChange={(e) => setLocAddr(e.target.value)} placeholder="Address (optional)" maxLength={300} onKeyDown={(e) => { if (e.key === "Enter") addLoc(); }} />
          <button type="button" className="adm-btn" onClick={addLoc} disabled={!locNm.trim()}>Add</button>
          <button type="button" className="ev-arch-btn" onClick={() => { setAddingLoc(false); setLocNm(""); setLocAddr(""); }}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="vnew-btn" onClick={() => setAddingLoc(true)}><Icon name="plus" /> Add a location for {linked.name}</button>
      ))}
      {adding ? (
        <div className="vnew-row">
          <input className="ev-input" value={nm} onChange={(e) => setNm(e.target.value)} placeholder="New venue name" maxLength={120} autoFocus onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
          <button type="button" className="adm-btn" onClick={() => create()} disabled={busy || !nm.trim()}>{busy ? "Adding…" : "Add"}</button>
          <button type="button" className="ev-arch-btn" onClick={() => { setAdding(false); setNm(""); }}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="vnew-btn" onClick={() => setAdding(true)}><Icon name="plus" /> New venue — send for approval</button>
      )}
      {similar && (
        <VendorResolve name={nm.trim()} candidates={similar} busy={busy}
          onUse={async (c) => {
            setSimilar(null);
            const v = await linkById(c.id);
            toast(`Linked to ${v?.name ?? c.name}`);
            setNm(""); setAdding(false);
          }}
          onAddLocation={async (c) => {
            setSimilar(null);
            await linkById(c.id);
            const made = await addVendorLocation(c.id, { label: nm.trim() });
            if (made && supabase) {
              const { data } = await supabase.from("vendor_locations").select("*").eq("id", made.id).single();
              if (data) onPickLocation?.(data as VendorLocation);
            }
            toast(`Added “${nm.trim()}” as a location of ${c.name}`);
            setNm(""); setAdding(false); onCreated?.();
          }}
          onCreateDistinct={() => { setSimilar(null); create({ createDistinct: true }); }}
          onClose={() => setSimilar(null)}
        />
      )}
    </div>
  );
}

// ───────────────────────── section metadata (shared by header + the guide) ─────────────────────────
// Each section = one job at one moment. LABEL names it, WHEN says when to reach for it (header pill),
// SUB is the one-liner, MORE explains it, INSIDE lists what lives there. Order = the shift timeline.
