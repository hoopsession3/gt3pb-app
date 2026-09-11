"use client";

import { supabase } from "./supabase";

// THE task write path. Work lives in two tables — event_tasks (the rich per-event/goal/note engine)
// and todos (free-form delegated tasks) — unified at read by the all_tasks view (0210) and My Day's
// merge. This is the WRITE half of that spine: helpers to create a delegated to-do or an event_task
// (a goal's "move," a stop/event's prep item), and to complete/update/delete a task wherever it
// lives, so table routing can never drift per-surface again.
//
// 2026-07-16: added createEventTask and closed out the last direct-write holdouts — PrepBoard,
// AssignTaskSheet, CompanyCalendar, and Goals each had at least one event_tasks/todos write that
// bypassed this file entirely (the crew-console audit's point: this file's own "can never drift"
// claim wasn't actually being enforced everywhere it should have been). All four now route through
// the helpers below.
export type TaskSource = "event" | "todo";

export async function createTodo(t: {
  title: string; category?: string; dueOn?: string | null; assignee?: string | null;
  eventId?: string | null; visibility?: "team" | "leadership" | "private"; createdBy?: string | null;
}): Promise<{ id?: string; error?: string }> {
  if (!supabase) return { error: "offline" };
  const { data, error } = await supabase.from("todos").insert({
    title: t.title.trim(), category: t.category ?? "ops", due_on: t.dueOn || null,
    assignee: t.assignee || null, event_id: t.eventId || null,
    visibility: t.visibility ?? "team", created_by: t.createdBy ?? null,
  }).select("id").single();
  if (error || !data) return { error: error?.message ?? "insert failed" };
  return { id: (data as { id: string }).id };
}

// event_tasks' side of the same job — a goal's "move," or a stop/event/note's own item. Kept
// separate from createTodo (rather than one mega-function branching on source) because the two
// tables' required fields genuinely differ — a todo needs a due-on/visibility/assignee; an event_task
// needs a parent binding and a kind — and every existing call site already knows which table it
// means, so a single always-both-shapes signature would just add unused fields.
//
// 2026-09-11: this helper USED to take goalId/eventId/stopId as three optional fields and knew
// nothing about the fourth parent, the prep columns, or writing more than one row. That was not a
// style problem — it is the whole reason two files still inserted directly, which the dupe ratchet
// had been holding at 2 ever since the spine was written. A write spine that cannot express what
// the table IS does not get adopted; it gets worked around. So the parent is a union now (exactly
// one, always one) and the bulk form is the implementation rather than a second path beside it.

/**
 * The four things an event_task can hang from. A union rather than four optional fields, because
 * "no parent" and "two parents" are both nonsense the database would happily store: event_tasks
 * has four nullable FK columns and no constraint saying pick one. Making it unrepresentable at the
 * one write path is cheaper and more honest than a CHECK retrofitted across four columns.
 */
export type TaskParent =
  | { event: string }
  | { stop: string }
  | { goal: string }
  | { note: string };

const PARENT_COLUMN = { event: "event_id", stop: "stop_id", goal: "goal_id", note: "meeting_note_id" } as const;

/** The column a parent writes to. Exported because the crew console reads back by the same key. */
export function parentColumn(p: TaskParent): string {
  return PARENT_COLUMN[Object.keys(p)[0] as keyof typeof PARENT_COLUMN];
}

export type NewEventTask = {
  parent: TaskParent;
  label: string;
  kind?: "task" | "pack";
  section?: string | null;
  sort?: number;
  critical?: boolean;
  warn?: boolean;
  link?: string | null;
  /** An instant, not a date — event_tasks.due_at is timestamptz. todos are the date-only side. */
  dueISO?: string | null;
  assignee?: string | null;
  targetQty?: number | null;
  /**
   * Attribution (0167), which is NOT the parent: a note's follow-up files under the event it is
   * about and still records the note it came from. Both columns exist because those facts differ.
   */
  originNoteId?: string | null;
};

export type CreatedTask = { id: string; label: string; assignee: string | null };

/** One row's worth of columns — the single place a NewEventTask becomes event_tasks' shape. */
function taskRow(t: NewEventTask): Record<string, unknown> {
  const row: Record<string, unknown> = {
    [parentColumn(t.parent)]: Object.values(t.parent)[0],
    label: t.label.trim().slice(0, 300),
    kind: t.kind ?? "task",
    sort: t.sort ?? 0,
    section: t.section ?? null,
    critical: t.critical ?? false,
  };
  // Sent only when the caller said something. These columns carry NOT NULL defaults or meaningful
  // nulls, and writing null over a default is a different statement from staying silent.
  if (t.warn !== undefined) row.warn = t.warn;
  if (t.link !== undefined) row.link = t.link;
  if (t.dueISO !== undefined) row.due_at = t.dueISO || null;
  if (t.assignee !== undefined) row.assignee = t.assignee || null;
  if (t.targetQty !== undefined) row.target_qty = t.targetQty;
  if (t.originNoteId !== undefined) row.origin_note_id = t.originNoteId || null;
  return row;
}

/**
 * Create many tasks in one statement, returning what landed. THE implementation — the single-row
 * helper below wraps it, so this file holds one insert rather than two that can drift. It returns
 * the created rows because callers that assign work need the ids to raise alerts against.
 */
export async function createEventTasks(ts: NewEventTask[]): Promise<{ rows: CreatedTask[]; error?: string }> {
  if (!supabase) return { rows: [], error: "offline" };
  if (ts.length === 0) return { rows: [] };
  const { data, error } = await supabase.from("event_tasks").insert(ts.map(taskRow)).select("id, label, assignee");
  if (error) return { rows: [], error: error.message };
  return { rows: (data as CreatedTask[]) ?? [] };
}

export async function createEventTask(t: NewEventTask): Promise<{ id?: string; error?: string }> {
  const { rows, error } = await createEventTasks([t]);
  if (error) return { error };
  return rows[0] ? { id: rows[0].id } : { error: "insert failed" };
}

export async function completeTask(source: TaskSource, id: string, userId?: string | null): Promise<boolean> {
  if (!supabase) return false;
  const done_at = new Date().toISOString();
  const { error } = source === "todo"
    ? await supabase.from("todos").update({ done: true, done_at }).eq("id", id)
    : await supabase.from("event_tasks").update({ done: true, done_by: userId ?? null, done_at }).eq("id", id);
  return !error;
}

// Finish an initiative: cascade every open task under it to done (both engines), then close the
// program. Completing the tasks is the intent and hard-fails on error; flipping the initiative's
// status is best-effort (admin-gated by RLS), so a lead who can clear tasks isn't blocked by it.
export async function completeInitiative(initiativeId: string, userId?: string | null): Promise<{ error?: string }> {
  if (!supabase) return { error: "offline" };
  const done_at = new Date().toISOString();
  // All three writes run; the FIRST error is surfaced (no silent partial-success). RLS still gates
  // each write, so a caller who lacks admin sees the denial rather than a false "done".
  const e1 = await supabase.from("event_tasks").update({ done: true, done_by: userId ?? null, done_at }).eq("initiative_id", initiativeId).eq("done", false);
  const e2 = await supabase.from("todos").update({ done: true, done_at }).eq("initiative_id", initiativeId).eq("done", false);
  const e3 = await supabase.from("initiatives").update({ status: "done" }).eq("id", initiativeId);
  const err = e1.error?.message || e2.error?.message || e3.error?.message;
  return err ? { error: err } : {};
}

// THE full write-adapter behind TaskSheet — the one place the two-table asymmetry is resolved, so no
// surface ever writes event_tasks/todos directly again. A neutral patch maps to each table's columns:
//   done   → event_tasks{done, done_by, done_at} · todos{done, done_at}
//   title  → event_tasks.label            · todos.title
//   dueISO → event_tasks.due_at (instant) · todos.due_on (date only — todos have no intraday time)
//   assignee is the same column on both.
export type TaskPatch = {
  done?: boolean; assignee?: string | null; dueISO?: string | null; title?: string;
  // the program a task rolls up to — both tables carry initiative_id (0201); null clears the link
  initiativeId?: string | null;
  // event-only prep fields (silently ignored for todos): section / type / priority / plan-qty
  section?: string | null; kind?: "task" | "pack"; critical?: boolean; warn?: boolean; targetQty?: number | null;
  // todos-only
  category?: string;
};

export async function updateTask(source: TaskSource, id: string, patch: TaskPatch, userId?: string | null): Promise<{ error?: string }> {
  if (!supabase) return { error: "offline" };
  const row: Record<string, unknown> = {};
  if (patch.done !== undefined) {
    row.done = patch.done;
    row.done_at = patch.done ? new Date().toISOString() : null;
    if (source === "event") row.done_by = patch.done ? (userId ?? null) : null;
  }
  if (patch.assignee !== undefined) row.assignee = patch.assignee || null;
  if (patch.initiativeId !== undefined) row.initiative_id = patch.initiativeId || null; // both tables (0201)
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (source === "event") row.label = t; else row.title = t;
  }
  if (patch.dueISO !== undefined) {
    if (source === "event") row.due_at = patch.dueISO || null;
    else row.due_on = patch.dueISO ? patch.dueISO.slice(0, 10) : null; // todos are date-only
  }
  if (source === "event") {
    if (patch.section !== undefined) row.section = patch.section?.trim() || null;
    if (patch.kind !== undefined) row.kind = patch.kind;
    if (patch.critical !== undefined) row.critical = patch.critical;
    if (patch.warn !== undefined) row.warn = patch.warn;
    if (patch.targetQty !== undefined) row.target_qty = patch.targetQty;
  } else if (patch.category !== undefined) row.category = patch.category;
  if (Object.keys(row).length === 0) return {};
  const { error } = await supabase.from(source === "event" ? "event_tasks" : "todos").update(row).eq("id", id);
  return { error: error?.message };
}

// Delete routes to the source table. RLS decides: event_tasks delete is admin-only, todos is
// leadership — a denied delete returns an error the caller surfaces (never a silent no-op).
export async function deleteTask(source: TaskSource, id: string): Promise<{ error?: string }> {
  return deleteTasks(source, [id]);
}

/**
 * Delete several at once. Same routing and the same RLS verdict as the single form — which is the
 * reason it lives here rather than as an `.in("id", ids)` inlined at the one call site that needs
 * it: a delete is a write, and a write spine that covers only the writes that happen to be
 * single-row is a spine with a hole in it. The pack-list refresh is that call site.
 */
export async function deleteTasks(source: TaskSource, ids: string[]): Promise<{ error?: string }> {
  if (!supabase) return { error: "offline" };
  if (ids.length === 0) return {};
  const { error } = await supabase.from(source === "event" ? "event_tasks" : "todos").delete().in("id", ids);
  return { error: error?.message };
}

/**
 * Clear every event_task hanging off one parent — what "Reset this event" means. Deliberately has
 * no todos form: a todo is delegated work that belongs to a person, and resetting an event's prep
 * checklist has never meant cancelling somebody's to-do list.
 */
export async function deleteTasksForParent(parent: TaskParent): Promise<{ error?: string }> {
  if (!supabase) return { error: "offline" };
  const { error } = await supabase.from("event_tasks").delete().eq(parentColumn(parent), Object.values(parent)[0]);
  return { error: error?.message };
}
