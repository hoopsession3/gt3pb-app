"use client";

import { createContext, useCallback, useContext, useState } from "react";
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

export function TaskSheetProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<{ id: string; source: TaskSource } | null>(null);
  const openTask = useCallback((id: string, source: TaskSource) => setTarget({ id, source }), []);
  return (
    <Ctx.Provider value={{ openTask }}>
      {children}
      {target && <TaskSheetBody id={target.id} source={target.source} onClose={() => setTarget(null)} />}
    </Ctx.Provider>
  );
}

