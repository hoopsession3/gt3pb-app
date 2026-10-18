"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { TaskSource } from "@/lib/tasks";

// TASKSHEET — the ONE task-detail sheet, opened from any task chip anywhere via useTaskSheet().
// The provider lives in the shell on every page; the sheet itself (components/TaskSheetBody.tsx —
// supabase, the crew list, the task adapter, the icons) loads on the first openTask(), so a guest
// reading the menu never downloads it. Split 2026-10-02; the body's own header carries the design
// brief. Every surface's job is still: render a chip → openTask(id, source).
const TaskSheetBody = dynamic(() => import("./TaskSheetBody"));

// ── context ───────────────────────────────────────────────────────────────────────────────────────
const Ctx = createContext<{ openTask: (id: string, source: TaskSource) => void }>({ openTask: () => {} });
export const useTaskSheet = () => useContext(Ctx);

/** HOW THE SHELL FENCES WHAT IT OPENS (R33 — the audit's FE11-07). A task or a record sheet that threw took the app to the
 *  last screen — these providers sit in the root layout, outside every page's boundary. The shell fences each
 *  (components/AppShell sheetFence → components/Fence): one that throws closes and says it didn't open. Passed in, not
 *  imported: an import of the fence here regrouped every route's shared download into one chunk more (+0.9 KB on the wire,
 *  the same modules split differently — R28 found the same of two other imports). */
export type SheetFence = (sheet: ReactNode, o: { name: string; again: unknown; close: () => void; what: string }) => ReactNode;
export const bare: SheetFence = (sheet) => sheet;

export function TaskSheetProvider({ children, fence }: { children: React.ReactNode; fence?: SheetFence }) {
  const [target, setTarget] = useState<{ id: string; source: TaskSource } | null>(null);
  const openTask = useCallback((id: string, source: TaskSource) => setTarget({ id, source }), []);
  const closeTask = useCallback(() => setTarget(null), []);
  // One value per change (R25 — the 10/10 audit, performance F19): a new object each render re-drew every reader of this
  // context whenever the shell drew again — the whole console among them.
  const value = useMemo(() => ({ openTask }), [openTask]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {/* fenced (R33 — FE11-07): a task sheet that throws closes and says so; the console under it keeps working */}
      {target && (fence ?? bare)(<TaskSheetBody id={target.id} source={target.source} onClose={closeTask} />, { name: "task-sheet", again: target, close: closeTask, what: "That task" })}
    </Ctx.Provider>
  );
}

