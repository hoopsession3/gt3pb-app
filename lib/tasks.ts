"use client";

import { supabase } from "./supabase";

// THE task write path. Work lives in two tables — event_tasks (the rich per-event/goal/note engine)
// and todos (free-form delegated tasks) — unified at read by the all_tasks view (0210) and My Day's
// merge. This is the WRITE half of that spine: one helper to create a delegated to-do, one to
// complete a task wherever it lives, so table routing can never drift per-surface again.
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

export async function completeTask(source: TaskSource, id: string, userId?: string | null): Promise<boolean> {
  if (!supabase) return false;
  const done_at = new Date().toISOString();
  const { error } = source === "todo"
    ? await supabase.from("todos").update({ done: true, done_at }).eq("id", id)
    : await supabase.from("event_tasks").update({ done: true, done_by: userId ?? null, done_at }).eq("id", id);
  return !error;
}

// THE full write-adapter behind TaskSheet — the one place the two-table asymmetry is resolved, so no
// surface ever writes event_tasks/todos directly again. A neutral patch maps to each table's columns:
//   done   → event_tasks{done, done_by, done_at} · todos{done, done_at}
//   title  → event_tasks.label            · todos.title
//   dueISO → event_tasks.due_at (instant) · todos.due_on (date only — todos have no intraday time)
//   assignee is the same column on both.
export type TaskPatch = { done?: boolean; assignee?: string | null; dueISO?: string | null; title?: string };

export async function updateTask(source: TaskSource, id: string, patch: TaskPatch, userId?: string | null): Promise<{ error?: string }> {
  if (!supabase) return { error: "offline" };
  const row: Record<string, unknown> = {};
  if (patch.done !== undefined) {
    row.done = patch.done;
    row.done_at = patch.done ? new Date().toISOString() : null;
    if (source === "event") row.done_by = patch.done ? (userId ?? null) : null;
  }
  if (patch.assignee !== undefined) row.assignee = patch.assignee || null;
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (source === "event") row.label = t; else row.title = t;
  }
  if (patch.dueISO !== undefined) {
    if (source === "event") row.due_at = patch.dueISO || null;
    else row.due_on = patch.dueISO ? patch.dueISO.slice(0, 10) : null; // todos are date-only
  }
  if (Object.keys(row).length === 0) return {};
  const { error } = await supabase.from(source === "event" ? "event_tasks" : "todos").update(row).eq("id", id);
  return { error: error?.message };
}

// Delete routes to the source table. RLS decides: event_tasks delete is admin-only, todos is
// leadership — a denied delete returns an error the caller surfaces (never a silent no-op).
export async function deleteTask(source: TaskSource, id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "offline" };
  const { error } = await supabase.from(source === "event" ? "event_tasks" : "todos").delete().eq("id", id);
  return { error: error?.message };
}
