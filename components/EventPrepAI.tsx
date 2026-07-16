"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import Sheet from "@/components/Sheet";
import Icon from "@/components/Icon";

// EVENT PREP AI — tell it about a specific event and it builds a tailored prep / to-do list,
// grounded in the event's config + run of show, current inventory, gear, jurisdiction compliance,
// and GT3's SOPs. Review (untick anything), then add it to the event's prep. Lives on the event.
/* eslint-disable @typescript-eslint/no-explicit-any */

const SECTION_COLOR: Record<string, string> = {
  Timeline: "#d4a24e", Pack: "#6fa8dc", "Stock / reorder": "#e0892b", Setup: "#8b5cf6", Service: "#2bb3a3",
  Compliance: "#c4453c", Travel: "#6fa8dc", Teardown: "#a1887f", Prep: "#9a8f7c",
};

type Task = { label: string; section: string; critical: boolean; why?: string; due_offset_days?: number | null; _skip?: boolean };

export default function EventPrepAI({ ownerType, ownerId, title, onClose, onAdded }: { ownerType: "event" | "stop"; ownerId: string; title: string; onClose: () => void; onAdded: () => void }) {
  const ownerKey = ownerType === "event" ? "event_id" : "stop_id";
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const post = async (payload: any) => {
    const r = await authedFetch("/api/agents/eventprep", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [ownerKey]: ownerId, ...payload }) });
    const text = await r.text();
    try { return JSON.parse(text); }
    catch { return { ok: false, error: r.ok ? "Got an unexpected response — try again." : `The prep agent failed (${r.status}) — it may be timing out, or the API key needs attention.` }; }
  };

  // Poll the background job until the grounded build finishes (or fails / times out ~2 min).
  const waitForJob = async (jobId: string): Promise<any> => {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const { data } = await supabase!.from("agent_jobs").select("status, result, error").eq("id", jobId).maybeSingle();
      if (!data) continue;
      if (data.status === "done") return { ok: true, ...(data.result as any) };
      if (data.status === "error") return { ok: false, error: (data as any).error || "The prep build failed." };
    }
    return { ok: false, error: "Still building — give it a moment and try again." };
  };

  const generate = async () => {
    if (!supabase || busy) return;
    setBusy(true); setErr(null);
    let j = await post({ notes }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    // background-job flow: route returns a job id, then we poll for the result
    if (j.ok && j.status === "pending" && j.job_id) j = await waitForJob(j.job_id);
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
    <Sheet open onClose={onClose} label="Event prep" header={<div style={{ display: "flex", alignItems: "center" }}><div className="dp-head-l"><div className="dp-eyebrow">AI prep · grounded in your data</div><div className="dp-title">{title || "Event"} — prep list</div></div><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}><Icon name="close" /></button></div>}>
          {done !== null ? (
            <div className="eg-done">
              <div className="eg-done-h"><Icon name="check" /> Added {done} item{done === 1 ? "" : "s"} to this event&apos;s prep</div>
              <div className="dp-hint" style={{ marginTop: 8 }}>Find them on the event&apos;s pick list (Prep). Assign, flag, and check them off there.</div>
              <div className="prod-actions" style={{ marginTop: 12 }}><span /><button type="button" className="note-save" onClick={onClose}>Done</button></div>
            </div>
          ) : !tasks ? (
            <>
              <div className="dp-hint">Tell me about this event — anything beyond what&apos;s in the app (special menu, the venue, headcount, what you&apos;re worried about). I&apos;ll build the prep list from that plus the run of show, your inventory, gear, the jurisdiction&apos;s rules, and our SOPs.</div>
              <textarea className="note-in" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Outdoor, no power or water on site, expecting ~300, pouring nitro + Nature Aide + bottles, 2 of us…" autoFocus disabled={busy} />
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="note-save" onClick={generate} disabled={busy}>{busy ? "Building…" : <><Icon name="sparkles" /> Build the prep list</>}</button>
              </div>
            </>
          ) : (
            <>
              {summary && <div className="dp-hint">{summary}</div>}
              {tasks.length === 0 ? <div className="dp-hint">Nothing to add — looks covered.</div> : tasks.map((t, i) => (
                <button key={i} type="button" className={`eg-row${t._skip ? "" : " on"}`} onClick={() => toggle(i)} style={{ ["--c" as string]: SECTION_COLOR[t.section] || "#9a8f7c" }}>
                  <span className="eg-ck">{t._skip ? <Icon name="dotOutline" /> : <Icon name="check" />}</span>
                  <span className="eg-main">
                    <b>{t.critical ? <><Icon name="warning" /> </> : null}{t.label}</b>
                    <span>{t.section}{t.due_offset_days && t.due_offset_days >= 1 ? ` · due ${t.due_offset_days}d before` : ""}{t.why ? ` · ${t.why}` : ""}</span>
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
    </Sheet>
  );
}
