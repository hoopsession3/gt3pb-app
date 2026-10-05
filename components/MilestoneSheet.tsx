"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import Sheet from "@/components/Sheet";
import { useCrew } from "./useCrew";
import { writeAcrossSkew } from "@/lib/schemaSkew";
import { errorMessage } from "@/lib/errorMessage";
import { type PortfolioStream, streamOwner } from "@/lib/portfolio";
import { KEPT_WORDS, startingPick, streamChoices, streamNote, streamPatch } from "@/lib/milestonePick";

// ONE MILESTONE, MANAGED — rename it, re-date it, file it to a workstream, then MOVE or TIE it across
// initiatives via checkboxes (checking several = tied to several — one control for both), or delete
// it. Admins only. Moved out of components/CommandBoard (2026-10-05) so the board's first paint does
// not carry it: it is loaded when an admin opens a milestone's ⋯.
//
// THE WORKSTREAM IS PICKED FROM THE PORTFOLIO (the form audit, part 3e · 0350). It was a text box
// whose placeholder offered "content · events · delivery…" while the portfolio — the named
// workstreams, each with its owner — sat directly above the board, and a typed word linked to none of
// them. Words from before that spell a stream start on it, and saving links them; words that spell
// nothing stay as they are until someone picks. There is no "type one" here on purpose: a workstream
// that is not in the portfolio is added to the portfolio, where it gets an owner and a Monday audit.
//
// A save waits for the database and stays open, edits and all, when it is refused. It used to close
// first and drop the error, so a refused save looked like a saved one until the board reloaded.

export type SheetMilestone = { id: string; title: string; due_on: string | null; workstream: string | null; workstream_id?: string | null };
type Patch = { title?: string; due_on?: string | null; workstream?: string | null; workstream_id?: string | null };

export default function MilestoneSheet({ m, streams, streamsErr, linkable, initiatives, linkedIds, onToggleLink, onDelete, onSaved, onClose }: {
  m: SheetMilestone; streams: PortfolioStream[]; streamsErr: string | null; linkable: boolean;
  initiatives: { id: string; title: string; emoji: string | null }[]; linkedIds: string[];
  onToggleLink: (initId: string, on: boolean) => void; onDelete: () => void; onSaved: () => void; onClose: () => void;
}) {
  const crew = useCrew();
  const [title, setTitle] = useState(m.title);
  const [due, setDue] = useState(m.due_on ?? "");
  const [pick, setPick] = useState(() => startingPick(m, streams));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const linked = new Set(linkedIds);
  const { open, parked } = streamChoices(streams);
  const words = m.workstream?.trim() || null;
  const gone = !!m.workstream_id && !streams.some((s) => s.id === m.workstream_id);
  const note = streamNote({ pick, m, streams, failed: streamsErr, linkable, owner: (s) => streamOwner(s, crew) });

  const save = async () => {
    if (busy || !supabase) return;
    const patch: Patch = { ...streamPatch(pick, m, streams, linkable) };
    if (title.trim() && title.trim() !== m.title) patch.title = title.trim();
    if ((due || null) !== m.due_on) patch.due_on = due || null;
    if (!Object.keys(patch).length) { onClose(); return; }
    setBusy(true); setErr(null);
    try {
      // Before 0350 is pasted the link is dropped and the milestone keeps the workstream's name,
      // which 0350 links when it lands (lib/schemaSkew.writeAcrossSkew — that one condition).
      // arrives-with: 0350
      const { error } = await writeAcrossSkew((row) => supabase!.from("initiative_milestones").update(row).eq("id", m.id), patch, ["workstream_id"]);
      if (error) { setErr(`Couldn't save — ${error.message}`); return; }
      onSaved();
      onClose();
    } catch (e) {
      setErr(`Couldn't save — ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} label="Manage milestone" header={<div className="oa-kicker">Milestone</div>}>
      <label className="prod-f"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></label>
      <label className="prod-f" style={{ marginTop: 8 }}><span>Due</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      <div className="prod-f" style={{ marginTop: 8 }}>
        <span id={`ms-ws-${m.id}`}>Workstream</span>
        <select aria-labelledby={`ms-ws-${m.id}`} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">No workstream</option>
          {!m.workstream_id && words && <option value={KEPT_WORDS}>{`“${words}” — links to nothing`}</option>}
          {gone && <option value={m.workstream_id!}>{streamsErr ? (words ?? "Its workstream") : `${words ?? "Its workstream"} — not in the portfolio`}</option>}
          {open.length > 0 && <optgroup label="The portfolio">{open.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
          {parked.length > 0 && <optgroup label="Parked by decision">{parked.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
        </select>
        {note && <p className="lp-note">{note}</p>}
      </div>
      <div className="cmd-mng-h">Tied to — check every initiative this belongs to</div>
      <div className="cmd-mng-inits">
        {initiatives.map((it) => (
          <label key={it.id} className="cmd-mng-init">
            <input type="checkbox" checked={linked.has(it.id)} onChange={(e) => onToggleLink(it.id, e.target.checked)} />
            <span>{it.emoji ? `${it.emoji} ` : ""}{it.title}</span>
          </label>
        ))}
      </div>
      {err && <p className="load-failed" role="alert">{err}</p>}
      <div className="prod-actions" style={{ marginTop: 14, justifyContent: "space-between" }}>
        <button type="button" className="note-arch" onClick={onDelete}>Delete</button>
        <button type="button" className="note-save" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Sheet>
  );
}
