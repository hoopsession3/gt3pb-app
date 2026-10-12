"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { loadMyTasks, myTaskDay } from "@/lib/myTasks";
import { comingUp, comingWords, COMING_DAYS, type ComingLine, type ComingStaff, type ComingTask } from "@/lib/home";
import { addDays, dayKey, localToday } from "@/lib/dates";
import AsyncSection from "./AsyncSection";
import { SectionHeader } from "./kit";
import { useAuth } from "./AuthProvider";
import { useRecord } from "./RecordSheet";
import { useTaskSheet } from "./TaskSheet";

// COMING UP (2026-10-12, the My Day audit, approved). My Day is three questions — what needs me, what
// should I do next, what's coming — and it answered the third nowhere: a task due in two days was out of
// sight until its day, and the event someone is crewing on Saturday showed on their home only once it was
// Saturday's op card. This is one line per commitment of theirs in the next seven days (lib/home comingUp):
// an event or stop they are on the crew of, an event or stop they have work for, or a dated task of theirs
// that belongs to neither. Each line opens its record or its task. At most three lines, with the week's
// count beside the head when there are more. Read only: Plan is still the record, and nothing here writes.
//
// The same plate as To do (lib/myTasks — one read of your tasks, so a task cannot be due in one list and not
// the other), the crew list (event_staff, staff-readable), and the events and stops named on it. A read that
// fails says so: an empty week and an unread one are different answers. It is on the app's refresh — a
// change to your tasks, your crew rows, events or stops reads it again, as do pull to refresh and coming back.

type Data = { lines: ComingLine[]; total: number; today: string };
type Crew = { event_id: string | null; stop_id: string | null; role_label: string | null };

export default function ComingUp() {
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const { openRecord } = useRecord();
  const { openTask } = useTaskSheet();

  const loader = useCallback(async (): Promise<Data> => {
    const today = localToday();
    if (!supabase || !meId) return { lines: [], total: 0, today };
    const sb = supabase;
    const from = addDays(today, 1), to = addDays(today, COMING_DAYS);
    const [mine, crew] = await Promise.all([
      loadMyTasks(meId),
      sb.from("event_staff").select("event_id, stop_id, role_label").eq("user_id", meId),
    ]);
    if (mine.error) throw new Error(mine.error);
    if (crew.error) throw new Error(crew.error.message);
    const rows = (crew.data as Crew[] | null) ?? [];
    const roleOn = new Map(rows.map((r) => [r.event_id ?? r.stop_id ?? "", r.role_label]));
    const evIds = rows.map((r) => r.event_id).filter((x): x is string => !!x);
    const stIds = rows.map((r) => r.stop_id).filter((x): x is string => !!x);
    // Only the ones in the window, and not archived. A stop's day is the one its tasks are dated by (lib/myTasks, dayKey).
    const [ev, st] = await Promise.all([
      evIds.length ? sb.from("events").select("id, title, day").in("id", evIds).is("archived_at", null).gte("day", from).lte("day", to) : null,
      stIds.length
        ? sb.from("stops").select("id, name, starts_at").in("id", stIds).is("archived_at", null)
            .gte("starts_at", new Date(`${from}T00:00:00`).toISOString()).lt("starts_at", new Date(`${addDays(to, 1)}T00:00:00`).toISOString())
        : null,
    ]);
    const failed = [ev?.error, st?.error].find(Boolean);
    if (failed) throw new Error(failed.message);
    const staffed: ComingStaff[] = [
      ...((ev?.data as { id: string; title: string | null; day: string | null }[] | null) ?? [])
        .map((e) => ({ kind: "event" as const, id: e.id, name: e.title ?? "Event", day: e.day, role: roleOn.get(e.id) ?? null })),
      ...((st?.data as { id: string; name: string | null; starts_at: string | null }[] | null) ?? [])
        .map((s) => ({ kind: "stop" as const, id: s.id, name: s.name ?? "Truck stop", day: s.starts_at ? dayKey(new Date(s.starts_at)) : null, role: roleOn.get(s.id) ?? null })),
    ];
    const tasks: ComingTask[] = mine.rows.map((t) => ({ id: t.id, source: t.source === "todo" ? "todo" : "event", title: t.label, day: myTaskDay(t), op: t.op ?? null }));
    return { ...comingUp(today, tasks, staffed), today };
  }, [meId]);
  const state = useAsyncData<Data>(loader, [loader]);
  useRealtimeTable([
    { table: "event_tasks", filter: `assignee=eq.${meId}` }, { table: "todos", filter: `assignee=eq.${meId}` },
    { table: "event_staff", filter: `user_id=eq.${meId}` }, "events", "stops",
  ], state.reload, { enabled: !!meId });

  const more = state.data && state.data.total > state.data.lines.length ? state.data.total : 0;
  return (
    <div className="adm-sec" id="coming-up">
      <SectionHeader label="Coming up" right={more ? <span className="k-count">{more} this week</span> : undefined} />
      <AsyncSection
        state={state}
        isEmpty={() => false}
        emptyTitle="Nothing coming up"
        loadingLabel="Checking the week…"
        errorTitle="Couldn't read what's coming"
        errorSub="This is not the same as nothing coming up — we could not read it just now."
      >
        {({ lines, today }) => lines.length === 0 ? (
          <p className="pnl-note" role="status">Nothing of yours in the next {COMING_DAYS} days — no event or stop you&rsquo;re on, and no task of yours dated in them.</p>
        ) : (
          <div className="owed">
            {lines.map((l) => {
              const w = comingWords(l, today);
              return (
                <button key={`${l.kind}:${l.id}`} type="button" className="owed-row"
                  onClick={() => (l.kind === "op" ? openRecord(l.op, l.id) : openTask(l.id, l.source))}>
                  <span className="owed-row-b"><b>{l.title}</b><i>{w.sub}</i></span>
                  <span className="owed-age">{w.when}</span>
                  <span className="owed-c" aria-hidden="true">›</span>
                </button>
              );
            })}
          </div>
        )}
      </AsyncSection>
    </div>
  );
}
