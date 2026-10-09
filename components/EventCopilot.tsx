"use client";

import { useEffect, useState } from "react";
import Sheet, { CloseButton } from "@/components/Sheet";
import Icon from "@/components/Icon";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { useApp } from "./AppProvider";
import { useAuth, roleOf } from "./AuthProvider";
import { useOperatorSection } from "./OperatorNav";
import VenuePick from "./VenuePickLazy";
import type { VenueFill } from "@/lib/venues";
import { haptic } from "@/lib/haptics";

// EVENT COPILOT (chief-of-staff, guided) — say it in plain words, the agent reads it into a draft, you
// review/complete the card, and it creates the event OR truck stop at the venue picked from the book
// (components/VenuePick: a venue the draft names exactly is taken, a look-alike is offered, a new one
// is added from the pick by name — the draft's words are never turned into a vendor on Create).
// Opens from the ✦ launcher ("Create an event, guided"). Staff-only.
type Draft = { kind: "event" | "stop"; title: string; date: string | null; venue: string | null; order_ahead: boolean; pickup: boolean; notes: string | null; clarify: string };

export default function EventCopilot() {
  const { toast } = useApp();
  const { profile } = useAuth();
  const { setSection } = useOperatorSection();
  const isStaff = roleOf(profile) !== "member";

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [creating, setCreating] = useState(false);
  // The venue picked for the draft, and what it brought: a stop takes the venue's address and pin.
  const [venueId, setVenueId] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => { if ((e as CustomEvent).detail === "event-build") { reset(); setOpen(true); } };
    window.addEventListener("gt3-copilot", onOpen);
    return () => window.removeEventListener("gt3-copilot", onOpen);
  }, []);
  const reset = () => { setText(""); setDraft(null); setBusy(false); setCreating(false); setVenueId(null); setAddress(""); setPin(null); };

  if (!isStaff) return null;

  const analyze = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const r = await authedFetch("/api/agents/event-build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) });
      const d = await r.json();
      if (!d?.ok) { toast(d?.error || "Couldn't read that", "error"); setBusy(false); return; }
      setDraft(d.draft as Draft);
    } catch { toast("Something went wrong — try again", "error"); }
    setBusy(false);
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((p) => (p ? { ...p, [k]: v } : p));
  // A venue picked: its words into the draft (the stop's name follows it while untouched), its
  // address and pin aside for a stop.
  const onVenue = (fill: VenueFill) => {
    setVenueId(fill.text.vendor_id);
    setDraft((p) => (p ? {
      ...p,
      ...(fill.text.name !== undefined ? { title: fill.text.name } : {}),
      ...(fill.text.location_text !== undefined ? { venue: fill.text.location_text || null } : {}),
    } : p));
    if (fill.text.address !== undefined) setAddress(fill.text.address);
    if (fill.pin !== undefined) setPin(fill.pin);
  };

  const create = async () => {
    if (!draft || !supabase || creating) return;
    if (!draft.title.trim()) { toast("Give it a name first", "error"); return; }
    setCreating(true);
    try {
      const venue = (draft.venue || "").trim();
      if (draft.kind === "stop") {
        const startsAt = draft.date ? new Date(`${draft.date}T11:00:00`).toISOString() : null;
        const { error } = await supabase.from("stops").insert({ name: draft.title.trim().slice(0, 120), location_text: venue || null, address: address.trim() || null, lat: pin?.lat ?? null, lng: pin?.lng ?? null,
          starts_at: startsAt, status: "upcoming", vendor_id: venueId, order_ahead_enabled: draft.order_ahead, pickup_enabled: draft.pickup, sort: 0 });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("events").insert({ title: draft.title.trim().slice(0, 160), day: draft.date || null, category: "event", location_text: venue || null, vendor_id: venueId });
        if (error) throw error;
      }
      haptic("success");
      toast(`${draft.kind === "stop" ? "Truck stop" : "Event"} created`);
      setOpen(false);
      setSection(draft.kind === "stop" ? "prep" : "plan");
    } catch (e) { toast(`Couldn't create it — ${(e as { message?: string })?.message ?? "try again"}`, "error"); }
    setCreating(false);
  };

  if (!open) return null;
  return (
    <Sheet open onClose={() => setOpen(false)} label="Create an event" dirty={!!draft && !creating} header={<div style={{ display: "flex", alignItems: "center" }}><span className="ec-eye"><Icon name="star" /> Chief of staff · create an event</span><CloseButton onClick={() => setOpen(false)} /></div>}>
      {!draft ? (
        <div className="ec-start">
          <p className="ec-lead">Tell me about it in your own words — I&apos;ll draft it and you review.</p>
          <textarea className="note-in" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Truck event at Wine Express this Saturday, let people order ahead" autoFocus onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) analyze(); }} />
          <button type="button" className="btn-pri" onClick={analyze} disabled={busy || !text.trim()}>{busy ? "Reading…" : <>Draft it <Icon name="arrowRight" /></>}</button>
        </div>
      ) : (
        <div className="ec-draft">
          {draft.clarify ? <div className="ec-clarify"><Icon name="chat" /> {draft.clarify}</div> : <div className="ec-ready">Looks good — review and create.</div>}
          <div className="ec-typ">
            <button type="button" className={`ec-typ-b${draft.kind === "event" ? " on" : ""}`} onClick={() => set("kind", "event")}>Event</button>
            <button type="button" className={`ec-typ-b${draft.kind === "stop" ? " on" : ""}`} onClick={() => set("kind", "stop")}><Icon name="truck" /> Truck stop</button>
          </div>
          <label className="prod-f"><span>Name</span><input value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Event name" /></label>
          <label className="prod-f" style={{ marginTop: 8 }}><span>Date</span><input type="date" value={draft.date ?? ""} onChange={(e) => set("date", e.target.value || null)} /></label>
          <VenuePick kind={draft.kind} source="the event copilot" onChange={onVenue} style={{ marginTop: 8 }}
            rec={{ vendor_id: venueId, name: draft.title, location_text: draft.venue, address, lat: pin?.lat ?? null, lng: pin?.lng ?? null }} />
          <label className="prod-f" style={{ marginTop: 8 }}><span>Where</span><input value={draft.venue ?? ""} onChange={(e) => set("venue", e.target.value || null)} placeholder="Host / place" /></label>
          {draft.kind === "stop" && (
            <div className="oa-toggles" style={{ marginTop: 10 }}>
              <button type="button" role="switch" aria-checked={draft.order_ahead} className={`oa-toggle${draft.order_ahead ? " on" : ""}`} onClick={() => { if (draft.order_ahead) haptic("toggleOff"); else haptic("toggleOn"); set("order_ahead", !draft.order_ahead); }}><Icon name="clock" /> Order ahead<span>{draft.order_ahead ? "On" : "Off"}</span></button>
              <button type="button" role="switch" aria-checked={draft.pickup} className={`oa-toggle${draft.pickup ? " on" : ""}`} onClick={() => { if (draft.pickup) haptic("toggleOff"); else haptic("toggleOn"); set("pickup", !draft.pickup); }}><Icon name="package" /> Pickup<span>{draft.pickup ? "On" : "Off"}</span></button>
            </div>
          )}
          <div className="prod-actions" style={{ marginTop: 12 }}>
            <button type="button" className="note-arch" onClick={() => { setDraft(null); setVenueId(null); setAddress(""); setPin(null); }} disabled={creating}>← Back</button>
            <button type="button" className="btn-pri" onClick={create} disabled={creating || !draft.title.trim()}>{creating ? "Creating…" : `Create ${draft.kind === "stop" ? "truck stop" : "event"}`}</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
