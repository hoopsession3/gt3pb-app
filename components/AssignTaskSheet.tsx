"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { useApp } from "@/components/AppProvider";
import { createTodo } from "@/lib/tasks";
import Sheet from "@/components/Sheet";

// REUSABLE buildout → task. Drop this after any buildout (bottle loadout, delivery loadout, event
// prep) to offer "Create a task? Assign to…" without leaving the flow. It writes to the existing
// `todos` table (so it lands in the assignee's day + Plan › Calendar) and lets you manage it —
// reassign, mark done — inline in the same popout. No page navigation.

type Crew = { id: string; display_name: string | null; role: string };

export default function AssignTaskSheet({
  defaultTitle, eventId = null, dueOn = null, category = "ops", onClose, onCreated,
}: {
  defaultTitle: string;
  eventId?: string | null;
  dueOn?: string | null; // "YYYY-MM-DD"
  category?: string;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useApp();
  const [crew, setCrew] = useState<Crew[]>([]);
  const [title, setTitle] = useState(defaultTitle);
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState(dueOn || "");
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [visibility, setVisibility] = useState<"team" | "leadership" | "private">("team");

  useEffect(() => {
    if (!supabase) return;
    supabase.from("profiles").select("id, display_name, role").neq("role", "member").order("display_name")
      .then(({ data }) => setCrew((data as Crew[]) ?? []));
  }, []);

  const nameOf = (id: string) => crew.find((c) => c.id === id)?.display_name || (id ? "Assigned" : "the team");

  const create = async () => {
    if (!supabase || !title.trim() || busy) return;
    setBusy(true);
    // ONE write path (lib/tasks) — the same helper every delegated-task surface uses.
    const r = await createTodo({ title, category, dueOn: due, assignee, eventId, visibility, createdBy: user?.id });
    setBusy(false);
    if (r.error || !r.id) { toast(`Couldn't create the task — ${r.error ?? "try again"}`, "error"); return; }
    setCreatedId(r.id);
    onCreated?.();
  };
  const reassign = async (id: string) => {
    setAssignee(id);
    if (supabase && createdId) await supabase.from("todos").update({ assignee: id || null }).eq("id", createdId);
  };
  const toggleDone = async () => {
    if (!supabase || !createdId) return;
    const nd = !done; setDone(nd);
    await supabase.from("todos").update({ done: nd, done_at: nd ? new Date().toISOString() : null }).eq("id", createdId);
  };

  const crewOptions = (
    <>
      <option value="">Unassigned</option>
      {crew.map((c) => <option key={c.id} value={c.id}>{c.display_name || c.role} · {c.role.replace("_", " ")}</option>)}
    </>
  );

  return (
    <Sheet open onClose={onClose} header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>{createdId ? "Task assigned ✓" : "Create a task?"}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>}>
          {!createdId ? (
            <>
              <label className="prod-f"><span>Task</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} /></label>
              <label className="prod-f" style={{ marginTop: 8 }}><span>Assign to</span><select value={assignee} onChange={(e) => setAssignee(e.target.value)}>{crewOptions}</select></label>
              <label className="prod-f" style={{ marginTop: 8 }}><span>Due</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
              <label className="prod-f" style={{ marginTop: 8 }}><span>Visible to</span>
                <select value={visibility} onChange={(e) => setVisibility(e.target.value as "team" | "leadership" | "private")}>
                  <option value="team">Whole team</option>
                  <option value="leadership">Leadership only</option>
                  <option value="private">Just the assignee</option>
                </select>
              </label>
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={onClose}>Not now</button>
                <button type="button" className="note-save" disabled={busy || !title.trim()} onClick={create}>{busy ? "Creating…" : "Create & assign"}</button>
              </div>
            </>
          ) : (
            <>
              <div className="brew-spec">✓ {title}{due ? ` · due ${due}` : ""} · <b>{nameOf(assignee)}</b></div>
              <label className="prod-f" style={{ marginTop: 10 }}><span>Reassign</span><select value={assignee} onChange={(e) => reassign(e.target.value)}>{crewOptions}</select></label>
              <label className="prod-toggle" style={{ marginTop: 12 }}><input type="checkbox" checked={done} onChange={toggleDone} /> Mark it done</label>
              <div className="oa-window" style={{ marginTop: 10 }}>It&rsquo;s in {assignee ? `${nameOf(assignee)}’s` : "the team’s"} day now — and in Plan &rsaquo; Calendar to manage anytime.</div>
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-save" onClick={onClose}>Done</button>
              </div>
            </>
          )}
    </Sheet>
  );
}
