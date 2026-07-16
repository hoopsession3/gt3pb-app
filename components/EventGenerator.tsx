"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import Markdown from "./Markdown";
import Sheet from "@/components/Sheet";
import Icon from "@/components/Icon";

// EVENT GENERATOR — say hey, feed it notes: the agent drafts the events + a team collaboration note
// (your house format) + an action-item to-do list, all linked. You get a quick review, untick
// anything that's off, then create it in one tap. Everything it makes stays editable after.
/* eslint-disable @typescript-eslint/no-explicit-any */

const CATC: Record<string, string> = { admin: "#8b5cf6", ops: "#e0892b", event: "#6fa8dc", content: "#2bb3a3" };

export default function EventGenerator({ onClose, onCreated, initialNotes }: { onClose: () => void; onCreated: () => void; initialNotes?: string }) {
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<any | null>(null);
  const [done, setDone] = useState<any | null>(null);

  const post = async (payload: any) => {
    const r = await authedFetch("/api/agents/event-generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return r.json();
  };

  const draft = async () => {
    if (!supabase || !notes.trim() || busy) return;
    setBusy(true); setErr(null);
    const j = await post({ notes }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!j.ok) setErr(j.error || "Couldn't read those notes."); else setPlan(j.plan);
    setBusy(false);
  };
  const create = async () => {
    if (!supabase || !plan || busy) return;
    setBusy(true); setErr(null);
    const j = await post({ commit: plan }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!j.ok) setErr(j.error || "Couldn't create it."); else { setDone(j.created); onCreated(); }
    setBusy(false);
  };
  const toggle = (arr: "events" | "action_items", i: number) =>
    setPlan((p: any) => ({ ...p, [arr]: p[arr].map((x: any, j: number) => j === i ? { ...x, _skip: !x._skip } : x) }));

  const ev = plan?.events ?? [];

  return (
    <Sheet open onClose={onClose} label="Create an event from notes" header={<div style={{ display: "flex", alignItems: "center" }}><div className="dp-head-l"><div className="dp-eyebrow">AI · from your notes</div><div className="dp-title">Create an event from your notes</div></div><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>}>
          {done ? (
            <div className="eg-done">
              <div className="eg-done-h"><Icon name="check" /> Done — here&apos;s what I made</div>
              <ul className="eg-list">
                <li>{done.events?.length ?? 0} event{(done.events?.length ?? 0) === 1 ? "" : "s"} &amp; stop{(done.events?.length ?? 0) === 1 ? "" : "s"}{done.events?.length ? `: ${done.events.map((e: any) => e.title).join(", ")}` : ""}</li>
                <li>{done.note ? `Team note: ${done.note.title}` : "No note"}</li>
                <li>{done.todos ?? 0} to-do{(done.todos ?? 0) === 1 ? "" : "s"} from your action items</li>
              </ul>
              <div className="dp-hint" style={{ marginTop: 8 }}>Events are under Events, the team note is in Plan → Notes, and the to-dos are on the Company Calendar. Edit or remove anything that&apos;s off.</div>
              <div className="prod-actions" style={{ marginTop: 12 }}><span /><button type="button" className="note-save" onClick={onClose}>Done</button></div>
            </div>
          ) : !plan ? (
            <>
              <div className="dp-hint">Say what you talked through. It&apos;ll draft the event(s), a team note in your format, and a to-do list from the action items — all linked. You review before anything is created.</div>
              <textarea className="note-in" rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Me & Kayla talked about the Beltline event and Mercedes-Benz Buckhead this weekend — coffee cart only at Beltline, trailer at Buckhead…" autoFocus disabled={busy} />
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="note-save" onClick={draft} disabled={busy || !notes.trim()}>{busy ? "Reading your notes…" : <><Icon name="sparkles" /> Draft the plan</>}</button>
              </div>
            </>
          ) : (
            <>
              <div className="eg-sec">Events &amp; stops</div>
              {ev.length === 0 ? <div className="dp-hint">No events or stops found in the notes.</div> : ev.map((e: any, i: number) => {
                const isStop = e.kind === "stop";
                return (
                <button key={i} type="button" className={`eg-row${e._skip ? "" : " on"}`} onClick={() => toggle("events", i)} style={{ ["--c" as string]: isStop ? "#5b9a6b" : "#6fa8dc" }}>
                  <span className="eg-ck">{e._skip ? <Icon name="dotOutline" /> : <Icon name="check" />}</span>
                  <span className="eg-main"><b>{isStop ? <Icon name="truck" /> : <Icon name="pin" />} {e.title} <span className="eg-kind">{isStop ? "Truck stop" : "Event"}</span></b><span>{[e.date || e.day_label, e.location].filter(Boolean).join(" · ") || "date TBD"}{e.blurb ? ` — ${e.blurb}` : ""}</span></span>
                </button>
                );
              })}

              {plan.collaboration_note && (
                <>
                  <div className="eg-sec">Team collaboration note</div>
                  <div className="eg-note"><b className="eg-note-t">{plan.collaboration_note.title}</b><Markdown source={plan.collaboration_note.summary || ""} /></div>
                </>
              )}

              <div className="eg-sec">Action items → to-dos</div>
              {(plan.action_items ?? []).length === 0 ? <div className="dp-hint">No action items found.</div> : plan.action_items.map((a: any, i: number) => (
                <button key={i} type="button" className={`eg-row${a._skip ? "" : " on"}`} onClick={() => toggle("action_items", i)} style={{ ["--c" as string]: CATC[a.category] || "#9a8f7c" }}>
                  <span className="eg-ck">{a._skip ? <Icon name="dotOutline" /> : <Icon name="check" />}</span>
                  <span className="eg-main"><b>{a.title}</b><span>{a.category}{typeof a.event_index === "number" && ev[a.event_index] ? ` · ${ev[a.event_index].title}` : ""}</span></span>
                </button>
              ))}

              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={() => setPlan(null)} disabled={busy}>‹ Redo</button>
                <button type="button" className="note-save" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create it →"}</button>
              </div>
            </>
          )}
    </Sheet>
  );
}
