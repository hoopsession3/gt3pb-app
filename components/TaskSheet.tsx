"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth, roleOf } from "@/components/AuthProvider";
import { useApp } from "@/components/AppProvider";
import Sheet from "@/components/Sheet";
import { updateTask, deleteTask, type TaskSource } from "@/lib/tasks";

// TASKSHEET — the ONE task-detail sheet, opened from any task chip anywhere via useTaskSheet().
// It reads the row from the all_tasks spine (0225) — so it doesn't care whether the task is an
// event_task or a todo — and writes back through lib/tasks' source-routed adapter. Every surface's
// job shrinks to: render a chip → openTask(id, source). See the design brief for the full rationale.

// The all_tasks columns TaskSheet renders (a subset of the 0225 view).
type AllTask = {
  source: TaskSource; id: string; title: string | null; assignee: string | null;
  due: string | null; done: boolean; done_at: string | null; created_at: string | null;
  critical: boolean | null; category: string | null; due_at: string | null; warn: boolean | null;
  op_kind: string | null; op_name: string | null; op_is_live: boolean | null;
  goal_title: string | null; meeting_note_title: string | null; goal_id: string | null;
};
type Crew = { id: string; display_name: string | null; role: string };

const OP_ICON: Record<string, string> = { event: "📅", stop: "📍", brew: "⚗️" };

// ── context ───────────────────────────────────────────────────────────────────────────────────────
const Ctx = createContext<{ openTask: (id: string, source: TaskSource) => void }>({ openTask: () => {} });
export const useTaskSheet = () => useContext(Ctx);

export function TaskSheetProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<{ id: string; source: TaskSource } | null>(null);
  const openTask = useCallback((id: string, source: TaskSource) => setTarget({ id, source }), []);
  return (
    <Ctx.Provider value={{ openTask }}>
      {children}
      {target && <TaskSheet id={target.id} source={target.source} onClose={() => setTarget(null)} />}
    </Ctx.Provider>
  );
}

// ── the sheet ───────────────────────────────────────────────────────────────────────────────────
function TaskSheet({ id, source, onClose }: { id: string; source: TaskSource; onClose: () => void }) {
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const router = useRouter();
  const [t, setT] = useState<AllTask | null>(null);
  const [missing, setMissing] = useState(false);
  const [crew, setCrew] = useState<Crew[]>([]);
  const [editing, setEditing] = useState(false);
  const [prep, setPrep] = useState<{ section: string | null; kind: string | null; target_qty: number | null } | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = ["admin", "owner"].includes(roleOf(profile));

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("all_tasks").select("*").eq("id", id).eq("source", source).maybeSingle();
    if (!data) { setMissing(true); return; }
    setT(data as AllTask);
    if (source === "event") {
      const { data: e } = await supabase.from("event_tasks").select("section, kind, target_qty").eq("id", id).maybeSingle();
      if (e) setPrep(e as { section: string | null; kind: string | null; target_qty: number | null });
    }
  }, [id, source]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!supabase) return;
    supabase.from("profiles").select("id, display_name, role").neq("role", "member").order("display_name")
      .then(({ data }) => setCrew((data as Crew[]) ?? []));
  }, []);
  // Live: if someone else changes this task, reflect it (writes hit the base table).
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel(`task-${source}-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: source === "event" ? "event_tasks" : "todos", filter: `id=eq.${id}` }, () => load())
      .subscribe();
    return () => { try { void Promise.resolve(supabase?.removeChannel(ch)).catch(() => {}); } catch { /* */ } };
  }, [id, source, load]);

  const nameOf = (uid: string | null) => (uid ? crew.find((c) => c.id === uid)?.display_name || "Assigned" : "Unassigned");
  const dueLocal = useMemo(() => {
    const iso = source === "event" ? t?.due_at : t?.due;
    if (!iso) return "";
    const d = new Date(source === "event" ? iso : `${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + (source === "event" ? ` · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "");
  }, [t, source]);

  // Optimistic write helper — apply locally, persist, revert+toast on failure.
  const write = async (patch: Parameters<typeof updateTask>[2], optimistic: Partial<AllTask>) => {
    if (!t || busy) return;
    const prev = t; setT({ ...t, ...optimistic }); setBusy(true);
    const { error } = await updateTask(source, id, patch, user?.id);
    setBusy(false);
    if (error) { setT(prev); toast("Couldn't save that — check your access or connection.", "error"); }
  };

  const toggleDone = () => t && write({ done: !t.done }, { done: !t.done, done_at: !t.done ? new Date().toISOString() : null });
  const reassign = (uid: string) => write({ assignee: uid || null }, { assignee: uid || null });
  const reschedule = (val: string) => {
    // event input is datetime-local; todo input is date. Empty clears the due date.
    const iso = val ? new Date(source === "event" ? val : `${val}T12:00:00`).toISOString() : null;
    write({ dueISO: iso }, source === "event" ? { due_at: iso } : { due: iso ? iso.slice(0, 10) : null });
  };
  const saveTitle = async () => {
    if (!draft.trim()) { setEditing(false); return; }
    await write({ title: draft.trim() }, { title: draft.trim() });
    setEditing(false);
  };
  const remove = async () => {
    if (!window.confirm("Delete this task? This can't be undone.")) return;
    setBusy(true);
    const { error } = await deleteTask(source, id);
    setBusy(false);
    if (error) { toast("Only a lead/admin can delete this task.", "error"); return; }
    toast("Task deleted"); onClose();
  };

  const header = (
    <div className="tsheet-h">
      {t?.critical && <span className="tsheet-flame" title="Critical">🔥</span>}
      <b id="tasksheet-title">{t?.title || (missing ? "Task removed" : "…")}</b>
    </div>
  );

  return (
    <Sheet open onClose={onClose} labelledBy="tasksheet-title" header={header} className="tsheet">
      {missing ? (
        <p className="tsheet-empty">This task was removed or you no longer have access.</p>
      ) : !t ? (
        <p className="tsheet-empty">Loading…</p>
      ) : (
        <div className="tsheet-body">
          {/* context — what this task is FOR (from the spine's joins) */}
          {(t.op_name || t.goal_title || t.meeting_note_title) && (
            <div className="tsheet-ctx">
              {t.op_name && <span>{OP_ICON[t.op_kind ?? ""] ?? "•"} {t.op_name}{t.op_is_live ? " · 🔴 live" : ""}</span>}
              {t.goal_title && <button type="button" className="tsheet-ctx-link" onClick={() => { onClose(); router.push("/crew?section=goals"); }}>↳ {t.goal_title}</button>}
              {t.meeting_note_title && <span>📝 {t.meeting_note_title}</span>}
            </div>
          )}

          {/* edit title */}
          {editing ? (
            <div className="tsheet-edit">
              <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveTitle()} className="auth-input" />
              <button type="button" className="note-save" onClick={saveTitle} disabled={busy}>Save</button>
            </div>
          ) : (
            <button type="button" className="tsheet-editlink" onClick={() => { setDraft(t.title ?? ""); setEditing(true); }}>Edit title</button>
          )}

          {/* when */}
          <label className="tsheet-field">
            <span className="tsheet-k">When</span>
            <input
              type={source === "event" ? "datetime-local" : "date"}
              className="auth-input"
              value={source === "event"
                ? (t.due_at ? new Date(t.due_at).toISOString().slice(0, 16) : "")
                : (t.due ?? "")}
              onChange={(e) => reschedule(e.target.value)}
            />
          </label>
          {dueLocal && <div className={`tsheet-due${t.warn ? " warn" : ""}`}>Due {dueLocal}</div>}

          {/* who */}
          <label className="tsheet-field">
            <span className="tsheet-k">Owner</span>
            <select className="auth-input" value={t.assignee ?? ""} onChange={(e) => reassign(e.target.value)}>
              <option value="">Unassigned</option>
              {crew.map((c) => <option key={c.id} value={c.id}>{c.display_name || c.role} · {c.role.replace("_", " ")}</option>)}
            </select>
          </label>

          {/* prep details — event tasks only (section / type / priority / plan-qty), same
              adapter (lib/tasks), so the prep hub's old TaskEditSheet is fully replaced */}
          {source === "event" && prep && (
            <>
              <div className="tsheet-prep-grid">
                <label className="tsheet-field"><span className="tsheet-k">Section</span>
                  <input className="auth-input" value={prep.section ?? ""} maxLength={60} placeholder="Task"
                    onChange={(e) => setPrep({ ...prep, section: e.target.value })}
                    onBlur={() => write({ section: prep.section }, {})} />
                </label>
                <label className="tsheet-field"><span className="tsheet-k">Type</span>
                  <select className="auth-input" value={prep.kind === "pack" ? "pack" : "task"}
                    onChange={(e) => { const k = e.target.value === "pack" ? "pack" as const : "task" as const; setPrep({ ...prep, kind: k }); write({ kind: k }, {}); }}>
                    <option value="task">To-do</option><option value="pack">Pack / supply</option>
                  </select>
                </label>
              </div>
              <div className="tsheet-prep-grid">
                <label className="tsheet-field"><span className="tsheet-k">Priority</span>
                  <select className="auth-input" value={t.critical ? "critical" : t.warn ? "important" : "normal"}
                    onChange={(e) => { const v = e.target.value; write({ critical: v === "critical", warn: v === "important" }, { critical: v === "critical", warn: v === "important" }); }}>
                    <option value="normal">Normal</option><option value="important">Important</option><option value="critical">Critical</option>
                  </select>
                </label>
                <label className="tsheet-field"><span className="tsheet-k">Plan qty</span>
                  <input type="number" min={0} className="auth-input" value={prep.target_qty ?? ""} placeholder="blank = plain to-do"
                    onChange={(e) => setPrep({ ...prep, target_qty: e.target.value === "" ? null : Number(e.target.value) })}
                    onBlur={() => write({ targetQty: prep.target_qty }, {})} />
                </label>
              </div>
            </>
          )}

          {/* meta */}
          <div className="tsheet-meta">
            {t.category && <span>{t.category}</span>}
            {t.done && t.done_at && <span>✓ done {new Date(t.done_at).toLocaleDateString()}</span>}
            <span>owner: {nameOf(t.assignee)}</span>
          </div>

          {/* actions */}
          <div className="tsheet-actions">
            <button type="button" className={`tsheet-done${t.done ? " on" : ""}`} onClick={toggleDone} disabled={busy}>
              {t.done ? "↩ Reopen" : "✓ Mark done"}
            </button>
            {isAdmin && <button type="button" className="tsheet-del" onClick={remove} disabled={busy}>Delete</button>}
          </div>
        </div>
      )}
    </Sheet>
  );
}
