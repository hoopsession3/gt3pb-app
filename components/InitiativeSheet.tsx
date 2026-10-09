"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { useOperatorSection } from "./OperatorNav";
import { canOf } from "@/lib/roles";
import { localToday } from "@/lib/dates";
import { daysBetween, dueWord } from "@/lib/dayWords";
import { errorMessage } from "@/lib/errorMessage";
import Sheet, { CloseButton, useUnsaved } from "./Sheet";
import AsyncSection from "./AsyncSection";
import { WayButtons } from "./RecordWays";

// ONE INITIATIVE, OPENED — and the date it is held to, movable (2026-10-04).
//
// Ryan's My Day at 10:40 PM: "Aug 1 Launch — Initiative target · 64 days late", and no way to answer
// it. An initiative's own fields had no editor anywhere in the app. CommandBoard could create one,
// add milestones and FINISH it — which completes every open task under it — but it could not move
// the date, pause it, or fix its name. So the only way to clear a missed target was to declare the
// whole program done, tasks and all, whether it was or not; and the honest answers ("it moved to
// November", "it is on hold") had nowhere to go, so the row sat on My Day turning redder.
//
// This sheet is the one place an initiative's own fields change: name, what it is, the target date,
// and whether it is planning, active or paused. Finishing stays on the board, behind its confirm,
// because it is a different act — it closes out every task under the program. Writes are an admin's
// in the database ("initiatives admin write", 0201), so the fields are an admin's here; everyone
// else who can see an initiative reads it.

type Init = { id: string; title: string; summary: string | null; target_date: string | null; status: string; emoji: string | null };

// The three a person sets here. "done" is the board's Finish — see the header.
// vocab: initiatives.status
const SETTABLE = ["planning", "active", "paused"] as const;
const STATUS_WORD: Record<string, string> = { planning: "Planning", active: "Active", paused: "Paused", done: "Finished" };

export default function InitiativeSheet({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved?: () => void }) {
  const { profile } = useAuth();
  const { toast } = useApp();
  const { setSection } = useOperatorSection();
  const can = canOf(profile);

  const loader = useCallback(async (): Promise<Init | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase.from("initiatives").select("id, title, summary, target_date, status, emoji").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Init | null) ?? null;
  }, [id]);
  const state = useAsyncData(loader, [loader]);

  return (
    <Sheet open onClose={onClose} label="Initiative"
      header={<div className="cp-head"><b>Initiative</b><CloseButton onClick={onClose} /></div>}>
      <AsyncSection state={state} isEmpty={(it) => !it}
        emptyTitle="No such initiative" emptySub="It may have been removed, or the link is stale."
        loadingLabel="Loading…" errorTitle="Couldn't load this initiative">
        {(it) => (
          <InitiativeBody key={it!.id} it={it!} canEdit={can.admin} canOpenBoard={can.manage}
            onBoard={() => { onClose(); setSection("command"); }}
            onSaved={(msg) => { toast(msg); onSaved?.(); onClose(); }} />
        )}
      </AsyncSection>
    </Sheet>
  );
}

function InitiativeBody({ it, canEdit, canOpenBoard, onBoard, onSaved }: {
  it: Init; canEdit: boolean; canOpenBoard: boolean; onBoard: () => void; onSaved: (msg: string) => void;
}) {
  const [title, setTitle] = useState(it.title);
  const [summary, setSummary] = useState(it.summary ?? "");
  const [target, setTarget] = useState(it.target_date ?? "");
  const [status, setStatus] = useState(it.status);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const out = target ? daysBetween(localToday(), target) : null;
  const changed = title.trim() !== it.title || (summary.trim() || null) !== (it.summary ?? null)
    || (target || null) !== (it.target_date ?? null) || status !== it.status;
  // What `changed` already knows, the sheet is told: leaving with it unsaved asks first.
  useUnsaved(canEdit && changed);

  const save = async () => {
    if (!supabase || busy || !title.trim()) return;
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.from("initiatives")
        .update({ title: title.trim(), summary: summary.trim() || null, target_date: target || null, status }).eq("id", it.id);
      if (error) throw error;
      onSaved(status === "paused" && it.status !== "paused" ? `${title.trim()} is paused — off the late list until it resumes.`
        : target && target !== it.target_date ? `${title.trim()} now targets ${new Date(`${target}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}.`
        : "Saved.");
    } catch (e) {
      setErr(`Couldn't save — ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="so-id">
        <div className="cp-id-t">
          <b>{it.emoji ? `${it.emoji} ` : ""}{it.title}</b>
          <span>
            {it.target_date ? `Target ${new Date(`${it.target_date}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}` : "No target date"}
            {out != null && it.target_date === target ? ` · ${dueWord(out)}` : ""}
          </span>
        </div>
        <span className={`so-pill ${it.status === "active" ? "so-us" : "so-nobody"}`}>{STATUS_WORD[it.status] ?? it.status}</span>
      </div>

      {canEdit ? (
        <div className="cp-block">
          <label className="prod-f"><span>Target date — clear it if there is none</span>
            <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
          {target && out != null && target !== it.target_date && <p className="pnl-note">{dueWord(out) === "due today" ? "Due today." : out < 0 ? `That is already ${dueWord(out)}.` : `That is ${dueWord(out)}.`}</p>}
          <div className="ts-chips" role="group" aria-label="Status" style={{ marginTop: 10 }}>
            {SETTABLE.map((s) => (
              <button key={s} type="button" className={`k-chip${status === s ? " on" : ""}`} aria-pressed={status === s} onClick={() => setStatus(s)}>{STATUS_WORD[s]}</button>
            ))}
          </div>
          <label className="prod-f"><span>Name</span>
            <input className="note-in" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
          </label>
          <label className="prod-f" style={{ marginTop: 8 }}><span>What it is</span>
            <textarea className="note-in" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={2000} />
          </label>
          {err && <p className="load-failed" role="alert">{err}</p>}
          <div className="prod-actions" style={{ marginTop: 12 }}>
            {canOpenBoard ? <button type="button" className="note-arch" onClick={onBoard}>Open the board</button> : <span />}
            <button type="button" className="btn-pri" onClick={save} disabled={busy || !changed || !title.trim()}>{busy ? "Saving…" : "Save"}</button>
          </div>
          <p className="pnl-note">Finished? Finish it on the board — that also completes every open task under it.</p>
        </div>
      ) : (
        <>
          {it.summary && <p className="evr-owed">{it.summary}</p>}
          {canOpenBoard && <WayButtons ways={[{ label: "Open the board", go: true, onClick: onBoard }]} />}
        </>
      )}
    </>
  );
}
