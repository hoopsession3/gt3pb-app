"use client";

import { useEffect, useState } from "react";
import Sheet from "@/components/Sheet";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { useApp } from "./AppProvider";
import { useAuth, roleOf } from "./AuthProvider";
import { useOperatorSection } from "./OperatorNav";
import { findOrCreatePendingVendor } from "@/lib/vendorLink";
import { haptic, HAPTIC } from "@/lib/haptics";

// EVENT COPILOT (chief-of-staff, guided) — say it in plain words, the agent reads it into a draft, you
// review/complete the card, and it creates the event OR truck stop bound to the vendor book (pending
// approval if the venue is new). Opens from the ✦ launcher ("Create an event, guided"). Staff-only.
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

  useEffect(() => {
    const onOpen = (e: Event) => { if ((e as CustomEvent).detail === "event-build") { reset(); setOpen(true); } };
    window.addEventListener("gt3-copilot", onOpen);
    return () => window.removeEventListener("gt3-copilot", onOpen);
  }, []);
  const reset = () => { setText(""); setDraft(null); setBusy(false); setCreating(false); };

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

  const create = async () => {
    if (!draft || !supabase || creating) return;
    if (!draft.title.trim()) { toast("Give it a name first", "error"); return; }
    setCreating(true);
    try {
      const venue = (draft.venue || "").trim();
      const v = venue ? await findOrCreatePendingVendor(venue, { source: "the event copilot" }) : null;
      if (draft.kind === "stop") {
        const startsAt = draft.date ? new Date(`${draft.date}T11:00:00`).toISOString() : null;
        const { error } = await supabase.from("stops").insert({ name: draft.title.trim().slice(0, 120), location_text: venue || null, starts_at: startsAt, status: "upcoming", vendor_id: v?.id ?? null, order_ahead_enabled: draft.order_ahead, pickup_enabled: draft.pickup, sort: 0 });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("events").insert({ title: draft.title.trim().slice(0, 160), day: draft.date || null, category: "event", location_text: venue || null, vendor_id: v?.id ?? null });
        if (error) throw error;
      }
      haptic(HAPTIC.success);
      toast(`${draft.kind === "stop" ? "Truck stop" : "Event"} created${v?.created ? " — venue sent for approval" : ""}`);
      setOpen(false);
      setSection(draft.kind === "stop" ? "prep" : "plan");
    } catch (e) { toast(`Couldn't create it — ${(e as { message?: string })?.message ?? "try again"}`, "error"); }
    setCreating(false);
  };

  if (!open) return null;
  return (
    <Sheet open onClose={() => setOpen(false)} header={<div style={{ display: "flex", alignItems: "center" }}><span className="ec-eye">✦ Chief of staff · create an event</span><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)} aria-label="Close">✕</button></div>}>
      {!draft ? (
        <div className="ec-start">
          <p className="ec-lead">Tell me about it in your own words — I&apos;ll draft it and you review.</p>
          <textarea className="note-in" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Truck event at Wine Express this Saturday, let people order ahead" autoFocus onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) analyze(); }} />
          <button type="button" className="oa-send" onClick={analyze} disabled={busy || !text.trim()}>{busy ? "Reading…" : "Draft it →"}</button>
        </div>
      ) : (
        <div className="ec-draft">
          {draft.clarify ? <div className="ec-clarify">💬 {draft.clarify}</div> : <div className="ec-ready">Looks good — review and create.</div>}
          <div className="ec-typ">
            <button type="button" className={`ec-typ-b${draft.kind === "event" ? " on" : ""}`} onClick={() => set("kind", "event")}>Event</button>
            <button type="button" className={`ec-typ-b${draft.kind === "stop" ? " on" : ""}`} onClick={() => set("kind", "stop")}>🚚 Truck stop</button>
          </div>
          <label className="prod-f"><span>Name</span><input value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Event name" /></label>
          <div className="prod-grid" style={{ marginTop: 8 }}>
            <label className="prod-f"><span>Date</span><input type="date" value={draft.date ?? ""} onChange={(e) => set("date", e.target.value || null)} /></label>
            <label className="prod-f"><span>Venue</span><input value={draft.venue ?? ""} onChange={(e) => set("venue", e.target.value || null)} placeholder="Host / place" /></label>
          </div>
          {draft.kind === "stop" && (
            <div className="oa-toggles" style={{ marginTop: 10 }}>
              <button type="button" role="switch" aria-checked={draft.order_ahead} className={`oa-toggle${draft.order_ahead ? " on" : ""}`} onClick={() => set("order_ahead", !draft.order_ahead)}>🕐 Order ahead<span>{draft.order_ahead ? "On" : "Off"}</span></button>
              <button type="button" role="switch" aria-checked={draft.pickup} className={`oa-toggle${draft.pickup ? " on" : ""}`} onClick={() => set("pickup", !draft.pickup)}>🥡 Pickup<span>{draft.pickup ? "On" : "Off"}</span></button>
            </div>
          )}
          <p className="ec-note">{draft.venue ? "The venue links to your vendor book — a new one is created pending approval." : "Add a venue to bind it to your vendor book."}</p>
          <div className="prod-actions" style={{ marginTop: 12 }}>
            <button type="button" className="note-arch" onClick={() => setDraft(null)} disabled={creating}>← Back</button>
            <button type="button" className="note-save" onClick={create} disabled={creating || !draft.title.trim()}>{creating ? "Creating…" : `Create ${draft.kind === "stop" ? "truck stop" : "event"}`}</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
