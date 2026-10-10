// YOUR TASKS, ONE READ. The all_tasks spine (0210, enriched by 0225) for one person: event_tasks ∪
// todos with the op, note and goal joined in the database. It lived inside the crew page's My tasks;
// it moved here (2026-10-09, One home) when the home's Today list began reading the same plate, so
// a task cannot be due today in one place and not in the other.
//
// A FAILED READ IS NOT AN EMPTY PLATE (2026-10-04). The read's error comes back beside the rows, and
// every caller says so on screen rather than drawing "Nothing on your plate" about a list it never saw.
import { supabase } from "./supabase";
import { dayKey } from "./dates";
import type { EventTask } from "./db";

export type MyTaskRow = EventTask & {
  events: { title: string | null; day: string | null; is_live: boolean | null } | null;
  meeting_notes: { title: string | null } | null;
  goals: { title: string | null } | null;
  source?: "event" | "todo";      // 'todo' rows are delegated to-dos (0210) folded into one plate
  category?: string | null;       // todos carry a category instead of an event/goal parent
};

export async function loadMyTasks(userId: string | null): Promise<{ rows: MyTaskRow[]; error: string | null }> {
  if (!supabase || !userId) return { rows: [], error: null };
  const { data, error } = await supabase
    .from("all_tasks")
    .select("*")
    .eq("assignee", userId)
    .eq("done", false)
    .order("sort", { ascending: true, nullsFirst: false });   // events keep their sort; sortless to-dos land after, as before
  if (error) return { rows: [], error: error.message };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: MyTaskRow[] = ((data as any[]) ?? []).map((r) =>
    r.source === "todo"
      ? ({
          id: r.id, label: r.title, source: "todo", category: r.category,
          due_at: r.due ? new Date(`${r.due}T23:59:59`).toISOString() : null,   // local end-of-day as a REAL instant, so a to-do due today isn't "overdue" all evening (behind-UTC bug)
          critical: false, warn: false, events: null, meeting_notes: null, goals: null,
        } as MyTaskRow)
      : ({
          ...r, label: r.title, source: "event" as const,
          // != null (not truthiness): an empty-string title is still a real row — panel finding.
          // Stop dates bucket on the OPERATOR's wall clock (dayKey, the one-clock spine), not a UTC cast.
          events: r.op_name != null ? { title: r.op_kind === "stop" ? `🚚 ${r.op_name}` : r.op_name, day: r.op_day ?? (r.op_starts_at ? dayKey(new Date(r.op_starts_at)) : null), is_live: r.op_is_live } : null,
          meeting_notes: r.meeting_note_title != null ? { title: r.meeting_note_title } : null,
          goals: r.goal_title != null ? { title: r.goal_title } : null,
        } as MyTaskRow));
  return { rows, error: null };
}

/** The day a task of yours is due: its own due date, else the day of the event or stop it belongs to. */
export function myTaskDay(t: MyTaskRow): string | null {
  return t.due_at ? dayKey(new Date(t.due_at)) : t.events?.day ?? null;
}
