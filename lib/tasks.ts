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
