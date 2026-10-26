"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { isMissingRelation, isMissingTable } from "@/lib/schemaSkew";
import { kindOf, type Issue, type Layout } from "@/lib/vision";
import { roomDiff } from "@/lib/visionRoom";
import { summaryWords, type Summary } from "@/lib/standard";
import type { Plan } from "@/lib/visionPlans";

// THE EVALUATE LENS (S1.1b, 2026-10-26 — Ryan: "Evaluate: focus on design quality and business consequences… surface the
// most consequential finding first… allow users to inspect, dismiss, defer, or resolve findings"). Three sources, each
// said for what it is, the most serious first:
//   1 · The Primal Standard (P1, 0456) — a judgement an owner recorded, with its evidence. A safety-critical failure or
//       a serious unknown leads.
//   2 · The plan reviewer — deterministic geometry: overlaps, things through a wall, aisles under 36 in. Automated
//       checks, not a code review; set one aside for this session, or Look to go to it.
//   3 · What the change does to the plans that read this room — the money engine's own roomDiff (registers, seats, the
//       counter's orders an hour) against the room as saved. Nothing is guessed from shape alone, and an approved
//       baseline never moves: the plans' working numbers recompute when the room is saved.
type Std = (Summary & { subject_type: string; subject_id: string })[] | "missing";

export default function Evaluate({ draft, saved, found, plans, onLook }: { draft: Layout; saved: Layout | null; found: Issue[]; plans: Plan[]; onLook: (id: string) => void }) {
  const ids = useMemo(() => [draft.id, ...draft.items.map((i) => i.id)], [draft.id, draft.items]);
  const key = ids.join(",");
  const loader = useCallback(async (): Promise<Std> => {
    if (!supabase) return [];
    // arrives-with: 0456 — std_subject_summary: before 0456 the lens says the Standard isn't there yet
    const { data, error } = await supabase.from("std_subject_summary").select("*").in("subject_id", key.split(","));
    if (error) { if (isMissingTable(error) || isMissingRelation(error)) return "missing"; throw new Error(error.message); }
    return (data ?? []).map((x) => ({ ...x, passes: Number(x.passes), conditionals: Number(x.conditionals), fails: Number(x.fails), unknowns: Number(x.unknowns), stale: Number(x.stale) })) as Std;
  }, [key]);
  const std = useAsyncData(loader, [loader]);
  const [aside, setAside] = useState<Set<string>>(() => new Set());
  const nameOf = (id: string) => (id === draft.id ? draft.name : (() => { const it = draft.items.find((i) => i.id === id); return it ? it.label || kindOf(it.kind).name : "A thing"; })());
  const serious = std.data && std.data !== "missing" ? std.data.filter((s) => s.critical_fail || s.fails > 0 || s.serious_unknown) : [];
  const stale = std.data && std.data !== "missing" ? std.data.filter((s) => s.stale > 0) : [];
  const shown = found.filter((f) => !aside.has(f.words));
  const readers = plans.filter((p) => p.layout_id === draft.id);
  const diff = saved ? roomDiff(saved, draft) : null;

  return (
    <section className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" aria-label="Evaluate — the most serious first">
      <b className="font-sans text-subhead">Evaluate</b>
      {serious.map((s) => { const w = summaryWords(s); return (
        <p key={s.subject_id} className="vz-issue error"><button type="button" className="btn-ter" onClick={() => s.subject_type === "object" ? onLook(s.subject_id) : undefined}>{s.subject_type === "object" ? "Look" : "Room"}</button> {nameOf(s.subject_id)} — <b>{w.word}</b> under the Primal Standard.</p>); })}
      {shown.map((f, i) => (
        <p key={i} className={f.level === "error" ? "vz-issue error" : "vz-issue warn"}>
          <button type="button" className="btn-ter" onClick={() => onLook(f.ids[0])}>Look</button> {f.words}{" "}
          <button type="button" className="btn-ter" onClick={() => setAside((a) => new Set(a).add(f.words))}>Set aside</button>
        </p>
      ))}
      {aside.size > 0 && <button type="button" className="btn-ter self-start" onClick={() => setAside(new Set())}>Show {aside.size} set aside</button>}
      {diff && diff.says.length > 0 && (
        <div className="flex flex-col gap-1">
          <b className="font-sans">What this change does{readers.length ? ` to ${readers.map((p) => p.name).join(", ")}` : ""}</b>
          {diff.says.map((x, i) => <p key={i} className="vz-card-s">{x}</p>)}
          <p className="vz-card-s">{readers.length ? "Their working numbers read the room when it's saved; an approved baseline doesn't move until an owner approves a new one." : "No plan reads this room yet."} Worked out from the room as drawn against the room as saved.</p>
        </div>
      )}
      {stale.length > 0 && <p className="vz-card-s">{stale.length} {stale.length === 1 ? "thing's" : "things'"} Standard judgement is stale — something it depended on changed. Reassess under Standard.</p>}
      {std.data === "missing" && <p className="vz-card-s">The Primal Standard arrives with the next database update (0456).</p>}
      {std.error && <p className="vz-issue warn">Couldn&apos;t read the Standard just now — this isn&apos;t an all-clear.</p>}
      {!serious.length && !shown.length && !(diff && diff.says.length) && !stale.length && std.data && std.data !== "missing" && (
        <p className="vz-card-s">Nothing found. The plan reviewer checks overlaps, walls and aisles; the Standard shows only what an owner has judged — unjudged isn&apos;t passed.</p>
      )}
      <p className="vz-card-s">Automated checks are a first read, not a code review or an inspector&apos;s finding.</p>
    </section>
  );
}
