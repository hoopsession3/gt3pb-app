"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import { useTaskSheet } from "./TaskSheet";
import AsyncSection from "./AsyncSection";
import Icon from "@/components/Icon";

/* eslint-disable @typescript-eslint/no-explicit-any */
// DISCUSSIONS (2026-08-02 exec-rhythm P5) — collaboration's front door. Threads already live
// everywhere (tasks, notes, alerts, strategy blocks) and reply-alerts already push — what was
// missing is ONE rail showing every recent thread with its latest word. This reads the last 120
// comments (RLS trims what you can't see), groups them by subject, resolves each subject's real
// title, and taps through to where the thread lives. Read-only by design: replying happens on
// the subject, where the context is.

type Row = {
  kind: "task" | "note" | "alert" | "strategy";
  id: string;                 // subject id (or strategy key)
  title: string;
  latest: string;
  who: string;
  when: string;
  n: number;
};

const KIND_LABEL: Record<Row["kind"], string> = { task: "task", note: "note", alert: "alert", strategy: "playbook" };
const ago = (iso: string) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};

export default function Discussions({ onOpenNotes }: { onOpenNotes: () => void }) {
  const { openTask } = useTaskSheet(); // the ONE task editor, on the spine

  const loader = useCallback(async (): Promise<Row[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("comments")
      .select("id, body, author_id, created_at, event_task_id, meeting_note_id, alert_id, strategy_key")
      .order("created_at", { ascending: false }).limit(120);
    if (error) throw new Error(error.message);
    const cs = (data ?? []) as any[];
    if (!cs.length) return [];

    // Group newest-first comments by subject; the first hit per subject is its latest word.
    const groups = new Map<string, { kind: Row["kind"]; id: string; latest: any; n: number }>();
    for (const c of cs) {
      const [kind, id]: [Row["kind"], string] | [null, null] =
        c.event_task_id ? ["task", c.event_task_id] : c.meeting_note_id ? ["note", c.meeting_note_id]
        : c.alert_id ? ["alert", c.alert_id] : c.strategy_key ? ["strategy", c.strategy_key] : [null, null];
      if (!kind || !id) continue;
      const key = `${kind}:${id}`;
      const g = groups.get(key);
      if (g) g.n += 1; else groups.set(key, { kind, id, latest: c, n: 1 });
    }
    const top = [...groups.values()].slice(0, 12);

    // Resolve real titles + author names in three batched reads (RLS applies on each).
    const ids = (k: Row["kind"]) => top.filter((g) => g.kind === k).map((g) => g.id);
    const [tasks, notes, alerts, people] = await Promise.all([
      ids("task").length ? supabase.from("event_tasks").select("id, label").in("id", ids("task")) : Promise.resolve({ data: [] }),
      ids("note").length ? supabase.from("meeting_notes").select("id, title").in("id", ids("note")) : Promise.resolve({ data: [] }),
      ids("alert").length ? supabase.from("alerts").select("id, title").in("id", ids("alert")) : Promise.resolve({ data: [] }),
      supabase.from("profiles").select("id, display_name").neq("role", "member"),
    ]);
    const tTitle = new Map(((tasks.data ?? []) as any[]).map((r) => [r.id, r.label]));
    const nTitle = new Map(((notes.data ?? []) as any[]).map((r) => [r.id, r.title]));
    const aTitle = new Map(((alerts.data ?? []) as any[]).map((r) => [r.id, r.title]));
    const name = new Map(((people.data ?? []) as any[]).map((r) => [r.id, (r.display_name || "Crew").split(" ")[0]]));

    return top.map((g) => ({
      kind: g.kind, id: g.id, n: g.n,
      title: g.kind === "strategy" ? g.id : (g.kind === "task" ? tTitle.get(g.id) : g.kind === "note" ? nTitle.get(g.id) : aTitle.get(g.id)) ?? "…",
      latest: String(g.latest.body ?? "").slice(0, 110),
      who: name.get(g.latest.author_id) ?? "Crew",
      when: ago(g.latest.created_at),
    })).filter((r) => r.title !== "…");   // a subject RLS hid from you doesn't belong on your rail
  }, []);
  const state = useAsyncData(loader, []);
  useRealtimeTable(["comments"], state.reload);

  const go = (r: Row) => {
    if (r.kind === "task") openTask(r.id, "event");
    else if (r.kind === "note") onOpenNotes();
    else if (r.kind === "alert") window.dispatchEvent(new Event("gt3-open-inbox"));
    else window.location.href = "/playbook";
  };

  return (
    <AsyncSection state={state} isEmpty={(rows) => rows.length === 0} emptyTitle="No discussions yet" emptySub="Start one anywhere — a task's Discuss, a note's thread, a playbook block." loadingLabel="Loading discussions…" errorTitle="Couldn't load discussions">
      {(rows) => (
        <div className="disc-rail">
          {rows.map((r) => (
            <button key={`${r.kind}:${r.id}`} type="button" className="disc-row" onClick={() => go(r)}>
              <div className="disc-top"><i className={`disc-kind ${r.kind}`}>{KIND_LABEL[r.kind]}</i><b className="disc-title">{r.title}</b><span className="disc-n"><Icon name="chat" />{r.n}</span></div>
              <div className="disc-latest"><b>{r.who}</b> · {r.when} — {r.latest}</div>
            </button>
          ))}
        </div>
      )}
    </AsyncSection>
  );
}
