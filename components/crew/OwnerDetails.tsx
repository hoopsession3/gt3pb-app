"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "@/components/AsyncSection";
import AddToCalendar from "@/components/AddToCalendar";
import Icon from "@/components/Icon";
import { calFromEvent, calFromStop } from "@/lib/ics";
import { geocode } from "@/lib/geocode";
import { derivedStopStatus } from "@/lib/stopRecord";

// OWNER DETAILS — the edit sheet behind a truck stop or an event.
//
// Lifted verbatim out of app/crew/page.tsx (6,858 lines) as the first of F4's extractions. Nothing
// about the component changed: same props, same behaviour, same code. What changed is that it now
// has a file of its own, so a person looking for "where do I edit a stop" has somewhere to look,
// and a change here cannot accidentally touch the nine other screens the page also renders.
//
// It was chosen first because it was the cheapest honest move: of the 64 top-level functions in
// that file, this one referenced only ONE thing declared alongside it (derivedStopStatus, which had
// already moved to lib/stopRecord in the commit before this).

export function OwnerDetails({ ownerType, ownerId, isAdmin, onSaved, onRemoved }: { ownerType: "event" | "stop"; ownerId: string; isAdmin: boolean; onSaved: (name: string) => void; onRemoved: () => void }) {
  const { toast } = useApp();
  const isEvent = ownerType === "event";
  const table = isEvent ? "events" : "stops";
  // recap now lives on the staff-only sibling (event_ops / stop_ops, 0181), off the public row.
  const opsTable = isEvent ? "event_ops" : "stop_ops";
  const opsKey = isEvent ? "event_id" : "stop_id";
  const nameCol = isEvent ? "title" : "name";
  const what = isEvent ? "event" : "truck stop";
  const [f, setF] = useState<Record<string, string | null> | null>(null);
  const [edit, setEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wrapping, setWrapping] = useState(false); // capturing the after-action to complete an event
  const [recap, setRecap] = useState("");
  const [dupWarn, setDupWarn] = useState<string | null>(null);
  // Per-stop order-ahead / pickup (0191) — kept out of `f` so the boolean/number types stay clean.
  const [oa, setOa] = useState(false);
  const [pk, setPk] = useState(false);
  const [lead, setLead] = useState("");
  // What starts_at was when loaded — if a save CHANGES the schedule, the stale hand-set
  // when/time labels are cleared so guests see the new time (same rule as FieldOpSheet).
  const origStartsAt = useRef<string | null>(null);
  // stage/status as of when edit mode opened — only written back if the USER changed it from
  // there, so lifecycle automation (or the date-derived default seeded on open, for stops) can't
  // be clobbered by an unrelated quick-edit (same rule as FieldOpSheet; was previously unguarded
  // here, so every save silently rewrote status/stage even when neither was touched).
  const origStage = useRef<string | null>(null);

  // Remove from the active lists (keeps the record, reversible). The standard "delete" for a real
  // event/stop — same as the calendar's Remove and Live truck's Archive.
  const archive = async () => {
    if (!supabase) return;
    if (typeof window !== "undefined" && !window.confirm(`Archive this ${what}?\n\nIt comes off the active lists (calendar, prep, route) but the record is kept — you can restore it.`)) return;
    setSaving(true);
    await supabase.from(table).update({ archived_at: new Date().toISOString() }).eq("id", ownerId);
    setSaving(false); toast(`${isEvent ? "Event" : "Stop"} archived`); onRemoved();
  };
  // Hard delete — gone for good, plus its prep, schedule, crew, links (FK cascade).
  const del = async () => {
    if (!supabase) return;
    if (typeof window !== "undefined" && !window.confirm(`DELETE this ${what} for good?\n\nThis permanently removes it AND its prep list, schedule, crew, and brew links. This can't be undone. (Use Archive instead if you just want it off the lists.)`)) return;
    setSaving(true);
    const { error } = await supabase.from(table).delete().eq("id", ownerId);
    setSaving(false);
    if (error) { toast(`Couldn't delete — ${error.message}`, "error"); return; }
    toast(`${isEvent ? "Event" : "Stop"} deleted`); onRemoved();
  };

  // Change the item's TYPE (event ↔ truck stop). They're separate tables, so this re-creates the row
  // in the target table with the shared fields (name, date, location, vendor, buffer) and archives the
  // original — the fix for "I picked the wrong type." Prep lists / brew links stay with the archived
  // copy (they'd need re-pointing across tables), so this is cleanest right after creation.
  const convertType = async () => {
    if (!supabase) return;
    const toEvent = !isEvent;
    const toLabel = toEvent ? "event" : "truck stop";
    if (typeof window !== "undefined" && !window.confirm(`Change this ${what} into a ${toLabel}?\n\nIt's re-created as a ${toLabel} with the same name, date, location & vendor. The original is archived — any prep list or brew links stay with the archived copy.`)) return;
    setSaving(true);
    const { data: src } = await supabase.from(table).select("*").eq("id", ownerId).maybeSingle();
    const s = (src as Record<string, unknown>) ?? {};
    let error = null;
    if (toEvent) {
      const day = s.starts_at ? new Date(String(s.starts_at)).toLocaleDateString("en-CA") : null;
      const r = await supabase.from("events").insert({ title: String(s.name || "Event"), day, location_text: (s.location_text as string) ?? null, category: "event", vendor_id: (s.vendor_id as string) ?? null, default_buffer_min: (s.default_buffer_min as number) ?? null }).select("id").single();
      error = r.error;
    } else {
      const startsAt = s.day ? new Date(`${String(s.day)}T11:00:00`).toISOString() : null;
      const r = await supabase.from("stops").insert({ name: String(s.title || "Stop"), starts_at: startsAt, location_text: (s.location_text as string) ?? null, status: "upcoming", vendor_id: (s.vendor_id as string) ?? null, default_buffer_min: (s.default_buffer_min as number) ?? null, sort: 0 }).select("id").single();
      error = r.error;
    }
    if (error) { setSaving(false); toast(`Couldn't convert — ${error.message}`, "error"); return; }
    await supabase.from(table).update({ archived_at: new Date().toISOString() }).eq("id", ownerId);
    setSaving(false); toast(`Changed to ${toLabel} — the original is archived`); onRemoved();
  };

  // Complete (wrap) an event OR a stop: mark it done, stamp when, and file the after-action.
  // Optionally archive it off the active lists in the same move. DB triggers keep the world
  // consistent: a completed event can't stay is_live, and completing the live STOP takes the
  // truck offline (0125).
  const complete = async (alsoArchive: boolean) => {
    if (!supabase) return;
    setSaving(true);
    const now = new Date().toISOString();
    const patch: Record<string, string | boolean | null> = isEvent
      ? { stage: "done", completed_at: now, is_live: false }
      : { status: "done", completed_at: now };
    if (alsoArchive) patch.archived_at = now;
    const { error } = await supabase.from(table).update(patch).eq("id", ownerId);
    // recap lives on the staff-only ops sibling now — write it there (best-effort; the completion
    // status is the important part, and it already committed above).
    await supabase.from(opsTable).upsert({ [opsKey]: ownerId, recap: recap.trim() || null }, { onConflict: opsKey });
    setSaving(false);
    if (error) { toast(`Couldn't complete — ${error.message}`, "error"); return; }
    setWrapping(false);
    toast(alsoArchive ? `${isEvent ? "Event" : "Stop"} completed + archived` : `${isEvent ? "Event" : "Stop"} completed — nice work`);
    if (alsoArchive) { onRemoved(); return; }
    origStage.current = "done"; // this write already committed above — keep the edit-guard baseline in sync
    setF((p) => ({ ...(p ?? {}), ...(isEvent ? { stage: "done" } : { status: "done" }), completed_at: now, recap: recap.trim() || null }));
  };

  const ownerState = useAsyncData<{ d: Record<string, unknown>; recap: string | null }>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    // recap moved to the staff-only ops sibling (event_ops / stop_ops, 0181); the per-stop order-ahead
    // columns stay on the public stop row. Fetch both in parallel and merge so the UI is unchanged.
    const sel = isEvent ? "title, day, location_text, stage, default_buffer_min, completed_at" : "name, starts_at, ends_at, location_text, address, status, default_buffer_min, completed_at, order_ahead_enabled, pickup_enabled, order_ahead_lead_min";
    const [{ data }, { data: ops }] = await Promise.all([
      supabase.from(table).select(sel).eq("id", ownerId).maybeSingle(),
      supabase.from(opsTable).select("recap").eq(opsKey, ownerId).maybeSingle(),
    ]);
    const d = (data as unknown as Record<string, unknown>) ?? {};
    return { d, recap: (ops as { recap?: string | null } | null)?.recap ?? null };
  }, [table, opsTable, opsKey, ownerId, isEvent]);
  // Seed the local edit-draft from the fetch, and re-seed on every reload (Cancel, or the row
  // changing underneath an open card) — f/oa/pk/lead stay the editable copy throughout.
  useEffect(() => {
    if (!ownerState.data) return;
    const { d, recap } = ownerState.data;
    setF({ ...(d as Record<string, string | null>), recap });
    if (!isEvent) { origStartsAt.current = (d.starts_at as string | null) ?? null; setOa(!!d.order_ahead_enabled); setPk(!!d.pickup_enabled); setLead(d.order_ahead_lead_min != null ? String(d.order_ahead_lead_min) : ""); }
  }, [ownerState.data, isEvent]);

  const set = (k: string, v: string | null) => setF((p) => ({ ...(p ?? {}), [k]: v }));
  // date <-> column: events.day is a plain date; stops.starts_at is a timestamp (preserve time of day)
  const dateVal = !f ? "" : isEvent ? (f.day || "") : (f.starts_at ? new Date(f.starts_at).toLocaleDateString("en-CA") : "");
  const onDate = (v: string) => {
    if (isEvent) { set("day", v || null); return; }
    if (!v) { set("starts_at", null); return; }
    const old = f?.starts_at ? new Date(f.starts_at) : null;
    const hh = old ? `${String(old.getHours()).padStart(2, "0")}:${String(old.getMinutes()).padStart(2, "0")}` : "11:00";
    set("starts_at", new Date(`${v}T${hh}:00`).toISOString());
  };
  // Start time — stops carry a real timestamp; this finally lets you SET the time of day, not just the date.
  const timeVal = !f || isEvent || !f.starts_at ? "" : (() => { const d = new Date(f.starts_at); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })();
  // Same-day-same-place guard — warn (never block) if another ACTIVE event OR stop already sits at
  // this location on this date. Events and stops live in two tables, so it checks both; this is the
  // common "did I already make this?" duplicate the two-table split makes easy to miss.
  const locKey = (f?.location_text ?? "").trim();
  useEffect(() => {
    if (!supabase || !edit || !locKey || !dateVal) { setDupWarn(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const [{ data: evs }, { data: sts }] = await Promise.all([
          supabase.from("events").select("id, title").is("archived_at", null).eq("day", dateVal).ilike("location_text", locKey),
          supabase.from("stops").select("id, name").is("archived_at", null).ilike("location_text", locKey).gte("starts_at", `${dateVal}T00:00:00`).lte("starts_at", `${dateVal}T23:59:59`),
        ]);
        if (cancelled) return;
        const other = [
          ...((evs as { id: string; title: string }[]) ?? []).filter((e) => e.id !== ownerId).map((e) => e.title || "an event"),
          ...((sts as { id: string; name: string }[]) ?? []).filter((s) => s.id !== ownerId).map((s) => s.name || "a stop"),
        ][0];
        setDupWarn(other ? `“${other}” is already at ${locKey} that day — same place, same date. Duplicate?` : null);
      } catch { setDupWarn(null); }
    })();
    return () => { cancelled = true; };
  }, [edit, locKey, dateVal, ownerId]);
  const onTime = (v: string) => {
    if (isEvent || !v) return;
    const dayKey = f?.starts_at ? new Date(f.starts_at).toLocaleDateString("en-CA") : new Date().toLocaleDateString("en-CA");
    set("starts_at", new Date(`${dayKey}T${v}:00`).toISOString());
  };
  // Close time (stops.ends_at) — the customer truck page auto-closes online ordering 60 min before
  // this and drops "Live" 45 min before it. Empty = no auto wind-down. Shares the start's date.
  const endTimeVal = !f || isEvent || !f.ends_at ? "" : (() => { const d = new Date(f.ends_at); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })();
  const onEndTime = (v: string) => {
    if (isEvent) return;
    if (!v) { set("ends_at", null); return; }
    const dayKey = f?.starts_at ? new Date(f.starts_at).toLocaleDateString("en-CA") : new Date().toLocaleDateString("en-CA");
    set("ends_at", new Date(`${dayKey}T${v}:00`).toISOString());
  };

  const save = async () => {
    if (!supabase || !f) return;
    setSaving(true);
    const nm = (f[nameCol] || "").trim() || (isEvent ? "Event" : "Stop");
    const buf = f.default_buffer_min != null && String(f.default_buffer_min).trim() !== "" ? Math.max(0, Number(f.default_buffer_min)) : null;
    const patch: Record<string, string | number | boolean | null> = isEvent
      ? { title: nm, day: f.day || null, location_text: f.location_text?.trim() || null, default_buffer_min: buf }
      : { name: nm, starts_at: f.starts_at || null, ends_at: f.ends_at || null, location_text: f.location_text?.trim() || null, address: f.address?.trim() || null, default_buffer_min: buf,
          order_ahead_enabled: oa, pickup_enabled: pk, order_ahead_lead_min: oa && lead.trim() !== "" ? Math.max(0, Number(lead)) : null };
    // stage/status: write ONLY a deliberate change from what the form opened with (same rule as
    // FieldOpSheet) — every save used to rewrite this unconditionally, which could clobber
    // lifecycle automation (or the seeded date-derived default) with a value nobody actually chose.
    const stageNow = (isEvent ? f.stage : f.status) ?? null;
    if (stageNow !== origStage.current) patch[isEvent ? "stage" : "status"] = stageNow;
    // For stops, geocode the address (or location) so it pins on the map + customer directions work.
    if (!isEvent) {
      // schedule changed → derived values must beat stale hand-set labels on the guest page
      if ((f.starts_at || null) !== origStartsAt.current) { patch.when_label = null; patch.time_label = null; }
      const q = (f.address?.trim() || f.location_text?.trim() || "");
      if (q) { const g = await geocode(q).catch(() => null); if (g) { patch.lat = g.lat; patch.lng = g.lng; } }
    }
    const { error } = await supabase.from(table).update(patch).eq("id", ownerId);
    setSaving(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    // Re-sync the local draft with the server row BEFORE leaving edit mode — a skipped
    // stage/status write (guard just above) must not leave the read-only view showing a
    // derived-only default that was never actually persisted (it would otherwise hide the
    // Complete/recap prompt on a stop nobody has actually completed yet).
    await ownerState.reload();
    setEdit(false); onSaved(nm); toast(isEvent ? "Details saved" : "Saved — address pinned on the map");
  };

  return (
    <AsyncSection
      state={ownerState}
      isEmpty={() => false}
      emptyTitle={`Couldn't find this ${what}`}
      emptySub="It may have been deleted or archived."
      loadingLabel={`Loading ${what} details…`}
      errorTitle={`Couldn't load ${what} details`}
    >
      {() => {
        if (!f) return null;
        if (!edit) {
    const date = dateVal ? new Date(`${dateVal}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "No date set";
    const place = f.location_text || f.address || "";
    const status = isEvent ? f.stage : f.status;
    const cal = isEvent
      ? calFromEvent({ id: ownerId, title: f.title ?? "", day: f.day ?? null, location_text: f.location_text })
      : calFromStop({ id: ownerId, name: f.name ?? "", starts_at: f.starts_at ?? null, location_text: f.location_text, address: f.address });
    const STAGE_LABEL: Record<string, string> = { lead: "Lead", confirmed: "Confirmed", prep: "Prep", live: "Live", done: "Done", upcoming: "Upcoming" };
    const done = f.completed_at != null || (isEvent ? f.stage === "done" : f.status === "done");
    return (
      <div className="ownerdet">
        <span className="ownerdet-meta"><Icon name="calendar" /> {date}{place ? <> · <Icon name="pin" /> {place}</> : ""}</span>
        <div className="ownerdet-life">
          <span className={`ownerdet-stage st-${status ?? (isEvent ? "confirmed" : "upcoming")}`}>{STAGE_LABEL[status ?? ""] ?? status}</span>
          {done ? (
            <span className="ownerdet-completed"><Icon name="check" /> Completed{f.completed_at ? ` ${new Date(f.completed_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}</span>
          ) : isAdmin ? (
            <button type="button" className="ownerdet-complete" onClick={() => { setRecap(f.recap ?? ""); setWrapping((w) => !w); }}><Icon name="check" /> Complete {isEvent ? "event" : "stop"}</button>
          ) : null}
        </div>
        {wrapping && (
          <div className="ownerdet-wrap">
            <div className="ownerdet-wrap-lbl">After-action <span>optional — what sold, what ran short, one change for next time</span></div>
            <textarea className="note-in" rows={3} value={recap} onChange={(e) => setRecap(e.target.value)} placeholder="e.g. Rise + Tide sold out by noon; ran short on ice; bring a second cooler next time." />
            <div className="ownerdet-wrap-actions">
              <button type="button" className="ownerdet-complete" onClick={() => complete(false)} disabled={saving}>Mark complete</button>
              <button type="button" className="ownerdet-arch" onClick={() => complete(true)} disabled={saving}>Complete &amp; archive</button>
              <button type="button" className="ownerdet-cancel" onClick={() => setWrapping(false)} disabled={saving}>Cancel</button>
            </div>
          </div>
        )}
        {done && f.recap && !wrapping && <div className="ownerdet-recap"><b>Recap</b> {f.recap}{isAdmin && <button type="button" className="ownerdet-recap-edit" onClick={() => { setRecap(f.recap ?? ""); setWrapping(true); }}>edit</button>}</div>}
        <AddToCalendar ev={cal} defaultBuffer={Number(f.default_buffer_min) || 0} />
        {isAdmin && <button type="button" className="ownerdet-edit" onClick={() => {
          // Seed the edit-guard baseline NOW, from what's about to show in the form — for stops,
          // that's the date-derived default (not the raw column); see derivedStopStatus above.
          const derived = isEvent ? (f.stage ?? null) : derivedStopStatus(f.status ?? null, f.starts_at ?? null, f.completed_at ?? null);
          origStage.current = derived;
          if (!isEvent && derived !== f.status) setF((p) => (p ? { ...p, status: derived } : p));
          setEdit(true);
        }}>Edit details</button>}
      </div>
    );
  }
  return (
    <div className="ownerdet editing">
      <input className="note-in" value={f[nameCol] ?? ""} onChange={(e) => set(nameCol, e.target.value)} placeholder={isEvent ? "Event name" : "Stop name"} aria-label={isEvent ? "Event name" : "Stop name"} />
      <div className="ownerdet-typehint">{isEvent
        ? <><Icon name="calendar" /> Event — a booked gig with prep, a crew & a run-of-show. (A quick roll-up-and-serve visit is a Truck stop.)</>
        : <><Icon name="pin" /> Truck stop — you roll up, serve, and leave. (A booked gig with prep & crew should be an Event.)</>}</div>
      {dupWarn && <div className="ownerdet-warn" role="status"><Icon name="warning" /> {dupWarn}</div>}
      <div className="prod-grid" style={{ marginTop: 8 }}>
        <label className="prod-f"><span>Date</span><input type="date" value={dateVal} onChange={(e) => onDate(e.target.value)} /></label>
        {isEvent
          ? <label className="prod-f"><span>Location</span><input value={f.location_text ?? ""} onChange={(e) => set("location_text", e.target.value)} placeholder="Where" /></label>
          : <label className="prod-f"><span>Start time</span><input type="time" value={timeVal} onChange={(e) => onTime(e.target.value)} /></label>}
        {!isEvent && <label className="prod-f"><span>End time</span><input type="time" value={endTimeVal} onChange={(e) => onEndTime(e.target.value)} /></label>}
      </div>
      {!isEvent && <label className="prod-f" style={{ marginTop: 8 }}><span>Where</span><input value={f.location_text ?? ""} onChange={(e) => set("location_text", e.target.value)} placeholder="Where" /></label>}
      {!isEvent && <label className="prod-f" style={{ marginTop: 8 }}><span>Address (tap-to-map)</span><input value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} placeholder="123 Peach St, Atlanta GA" /></label>}
      <label className="prod-f" style={{ marginTop: 8 }}><span>Status</span>
        {isEvent ? (
          <select value={f.stage ?? "confirmed"} onChange={(e) => set("stage", e.target.value)}>
            <option value="lead">Lead</option><option value="confirmed">Confirmed</option><option value="prep">Prep</option><option value="live">Live</option><option value="done">Done</option>
          </select>
        ) : (
          <select value={f.status ?? "upcoming"} onChange={(e) => set("status", e.target.value)}>
            <option value="upcoming">Upcoming</option><option value="done">Done</option>
          </select>
        )}
      </label>
      <label className="prod-f" style={{ marginTop: 8 }}><span>Calendar buffer (min) — travel + setup blocked before service</span><input type="number" min={0} step={15} value={f.default_buffer_min ?? ""} onChange={(e) => set("default_buffer_min", e.target.value)} placeholder="e.g. 90" /></label>
      {!isEvent && (
        <div className="oa-set">
          <div className="oa-set-h">Ordering at this stop</div>
          <div className="oa-toggles">
            <button type="button" role="switch" aria-checked={oa} className={`oa-toggle${oa ? " on" : ""}`} onClick={() => setOa((v) => !v)}><Icon name="clock" /> Order ahead<span>{oa ? "On" : "Off"}</span></button>
            <button type="button" role="switch" aria-checked={pk} className={`oa-toggle${pk ? " on" : ""}`} onClick={() => setPk((v) => !v)}><Icon name="package" /> Pickup<span>{pk ? "On" : "Off"}</span></button>
          </div>
          {oa && <label className="prod-f" style={{ marginTop: 8 }}><span>Order-ahead lead time (min) — blank uses the global window</span><input type="number" min={0} step={15} value={lead} onChange={(e) => setLead(e.target.value)} placeholder="e.g. 240" /></label>}
          <div className="ownerdet-hint">When on, guests can order ahead{pk ? " and choose pickup" : ""} for this stop. Off = the truck’s global setting applies.</div>
        </div>
      )}
      {!isEvent && <div className="ownerdet-hint">Go live &amp; broadcast GPS in Now ▸ Live truck.</div>}
      <div className="ownerdet-convert">
        <span className="ownerdet-convert-l">Wrong type?</span>
        <button type="button" className="ownerdet-convert-b" onClick={convertType} disabled={saving}>Change to {isEvent ? "truck stop" : "event"} ⇄</button>
      </div>
      <div className="ownerdet-danger">
        <button type="button" className="ownerdet-arch" onClick={archive} disabled={saving}>Archive {what}</button>
        <button type="button" className="ownerdet-del" onClick={del} disabled={saving}>Delete for good</button>
      </div>
      <div className="prod-actions" style={{ marginTop: 12 }}>
        <button type="button" className="note-arch" onClick={() => { setEdit(false); ownerState.reload(); }} disabled={saving}>Cancel</button>
        <button type="button" className="note-save" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save details"}</button>
      </div>
    </div>
        );
      }}
    </AsyncSection>
  );
}

// INCIDENT LOG — every field problem the Troubleshoot agent logged for this event/stop. Read it back,
// flip resolved, or delete one. Self-contained; owner-generic.
