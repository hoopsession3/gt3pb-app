"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

// EVENT PREP AI — tell it about a specific event and it builds a tailored prep / to-do list,
// grounded in the event's config + run of show, current inventory, gear, jurisdiction compliance,
// and GT3's SOPs. Review (untick anything), then add it to the event's prep. Lives on the event.
/* eslint-disable @typescript-eslint/no-explicit-any */

const SECTION_COLOR: Record<string, string> = {
  Pack: "#6fa8dc", "Stock / reorder": "#e0892b", Setup: "#8b5cf6", Service: "#2bb3a3",
  Compliance: "#c4453c", Travel: "#6fa8dc", Teardown: "#a1887f", Prep: "#9a8f7c",
};

type Task = { label: string; section: string; critical: boolean; why?: string; _skip?: boolean };

export default function EventPrepAI({ ownerType, ownerId, title, onClose, onAdded }: { ownerType: "event" | "stop"; ownerId: string; title: string; onClose: () => void; onAdded: () => void }) {
  const ownerKey = ownerType === "event" ? "event_id" : "stop_id";
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const token = async () => (await supabase!.auth.getSession()).data.session?.access_token;
  const post = async (payload: any) => {
    const t = await token();
    const r = await fetch("/api/agents/eventprep", { method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ [ownerKey]: ownerId, ...payload }) });
    const text = await r.text();
    try { return JSON.parse(text); }
    catch { return { ok: false, error: r.ok ? "Got an unexpected response — try again." : `The prep agent failed (${r.status}) — it may be timing out, or the API key needs attention.` }; }
  };

  const generate = async () => {
    if (!supabase || busy) return;
    setBusy(true); setErr(null);
    const j = await post({ notes }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!j.ok) setErr(j.error || "Couldn't build the list."); else { setSummary(j.summary || ""); setTasks(j.tasks ?? []); }
    setBusy(false);
  };
  const add = async () => {
    if (!supabase || !tasks || busy) return;
    setBusy(true); setErr(null);
    const j = await post({ commit: { tasks } }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!j.ok) setErr(j.error || "Couldn't add."); else { setDone(j.added ?? 0); onAdded(); }
    setBusy(false);
  };
  const toggle = (i: number) => setTasks((p) => p!.map((t, j) => j === i ? { ...t, _skip: !t._skip } : t));

  const keepCount = tasks?.filter((t) => !t._skip).length ?? 0;

  return (
    <div className="qd-scrim" onClick={onClose}>
      <div className="qd-sheet dp" onClick={(e) => e.stopPropagation()}>
        <div className="dp-head">
          <div className="dp-head-l"><div className="dp-eyebrow">AI prep · grounded in your data</div><div className="dp-title">{title || "Event"} — prep list</div></div>
          <button type="button" className="qd-x" onClick={onClose}>✕</button>
        </div>

        <div className="dp-body">
          {done !== null ? (
            <div className="eg-done">
              <div className="eg-done-h">✓ Added {done} item{done === 1 ? "" : "s"} to this event&apos;s prep</div>
              <div className="dp-hint" style={{ marginTop: 8 }}>Find them on the event&apos;s pick list (Prep). Assign, flag, and check them off there.</div>
              <div className="prod-actions" style={{ marginTop: 12 }}><span /><button type="button" className="note-save" onClick={onClose}>Done</button></div>
            </div>
          ) : !tasks ? (
            <>
              <div className="dp-hint">Tell me about this event — anything beyond what&apos;s in the app (special menu, the venue, headcount, what you&apos;re worried about). I&apos;ll build the prep list from that plus the run of show, your inventory, gear, the jurisdiction&apos;s rules, and our SOPs.</div>
              <textarea className="note-in" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Outdoor, no power or water on site, expecting ~300, pouring nitro + Nature Aid + bottles, 2 of us…" autoFocus disabled={busy} />
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="note-save" onClick={generate} disabled={busy}>{busy ? "Building…" : "✨ Build the prep list"}</button>
              </div>
            </>
          ) : (
            <>
              {summary && <div className="dp-hint">{summary}</div>}
              {tasks.length === 0 ? <div className="dp-hint">Nothing to add — looks covered.</div> : tasks.map((t, i) => (
                <button key={i} type="button" className={`eg-row${t._skip ? "" : " on"}`} onClick={() => toggle(i)} style={{ ["--c" as string]: SECTION_COLOR[t.section] || "#9a8f7c" }}>
                  <span className="eg-ck">{t._skip ? "○" : "✓"}</span>
                  <span className="eg-main">
                    <b>{t.critical ? "⚠️ " : ""}{t.label}</b>
                    <span>{t.section}{t.why ? ` · ${t.why}` : ""}</span>
                  </span>
                </button>
              ))}
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={() => setTasks(null)} disabled={busy}>‹ Redo</button>
                <button type="button" className="note-save" onClick={add} disabled={busy || keepCount === 0}>{busy ? "Adding…" : `Add ${keepCount} to prep`}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
