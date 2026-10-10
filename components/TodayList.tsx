"use client";

import { useCallback, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { loadMyTasks, myTaskDay, type MyTaskRow } from "@/lib/myTasks";
import { splitHome, STALE_DAYS, type HomeItem } from "@/lib/home";
import { completeTask, updateTask } from "@/lib/tasks";
import { logDone } from "@/lib/upkeep";
import { roleOf, canOf } from "@/lib/roles";
import { daysBetween, dueWord } from "@/lib/dayWords";
import { addDays, localToday } from "@/lib/dates";
import { goPlanTab } from "@/lib/planNav";
import { prepBucket } from "@/lib/readiness";
import type { Viewer } from "@/lib/obligations";
import AsyncSection from "./AsyncSection";
import Sheet, { CloseButton } from "./Sheet";
import Icon from "./Icon";
import { SectionHeader } from "./kit";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { useOperatorSection, sectionsForRole } from "./OperatorNav";
import { useTaskSheet } from "./TaskSheet";
import { loadOwed, useObligationGo, type OwedData, type OwedRow } from "./Owed";

// TODAY, ON THE HOME (2026-10-09, One home — round 2 of the UX plan, approved). My Day opened on two
// panels and thirty-one rows: My tasks, all of them, and Needs you, with "18 late · 6 due soon" and
// "7 team tasks late" under it. Most of the late ones were months old (the oldest 99 days, equipment
// cleans from the Aug 1 launch), so the screen said "behind" every morning and the crew learned to
// skip it. A list that can be cleared gets cleared.
//
// What the home shows now, from the same two reads (lib/myTasks, Owed's loadOwed — no copies):
//   · at most three things due today or late by two weeks or less, critical first, then the latest
//   · one row for equipment upkeep, however many pieces are due — logged from one sheet
//   · one row for everything more than two weeks late — reviewed, done or moved, in bulk
//   · the booking and restock lines, when there are any
//   · "All tasks", which opens the two full panels exactly as they were
// Nothing is deleted to make it calm; everything folded is one tap away.

type Mine = { kind: "mine"; row: MyTaskRow };
type Owe = { kind: "owed" | "upkeep"; row: OwedRow };
type Team = { kind: "team"; id: string };
type Ref = Mine | Owe | Team;
type Item = HomeItem & { ref: Ref };
type Data = { items: Item[]; owed: OwedData };

const STALE_LABEL = `More than ${STALE_DAYS / 7} weeks late`;
const STALE_SHORT = `${STALE_DAYS / 7}+ weeks late`;

function mineSub(t: MyTaskRow): string {
  if (t.source === "todo") return `To-do${t.category ? ` · ${t.category}` : ""}`;
  if (t.meeting_notes) return `Follow-up · ${t.meeting_notes.title ?? "Meeting"}`;
  if (t.goals) return `Goal · ${t.goals.title ?? "Goal"}`;
  return `${t.events?.title ?? "Event"}${t.events?.is_live ? " · LIVE" : t.events?.day ? ` · ${prepBucket(t.events.day, localToday()).label}` : ""}`;
}

export default function TodayList({ allTasks }: { allTasks: ReactNode }) {
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const { setSection } = useOperatorSection();
  const { openTask } = useTaskSheet();
  const meId = user?.id ?? null;
  const role = roleOf(profile);
  const manage = canOf(profile).manage;
  const viewer: Viewer = { id: meId, sections: sectionsForRole(role), manage };

  const loader = useCallback(async (): Promise<Data> => {
    const [mine, owed] = await Promise.all([loadMyTasks(meId), loadOwed(meId, role, manage)]);
    // A failed read is not a quiet day: either half failing fails the list, and the list says so.
    if (mine.error) throw new Error(mine.error);
    const today = localToday();
    const items: Item[] = [];
    for (const t of mine.rows) {
      const day = myTaskDay(t);
      items.push({ key: `mine:${t.source ?? "event"}:${t.id}`, title: t.label, sub: mineSub(t), daysOut: day ? daysBetween(today, day) : null, critical: !!t.critical, kind: "mine", ref: { kind: "mine", row: t } });
    }
    for (const r of owed.rows) {
      const kind = r.source === "asset_maintenance" ? "upkeep" : "owed";
      items.push({ key: `owed:${r.source}:${r.subject_id}`, title: r.title, sub: `${r.kind} · ${r.detail}`, daysOut: Number(r.days_out), critical: false, kind, ref: { kind, row: r } });
    }
    for (const t of owed.tasks) {
      items.push({ key: `team:${t.id}`, title: t.label, sub: t.owner ? `${t.owner.kind} · ${t.owner.name}` : "Not attached to an event or stop", daysOut: t.late != null ? -t.late : null, critical: t.critical, kind: "team", ref: { kind: "team", id: t.id } });
    }
    return { items, owed };
  }, [meId, role, manage]);
  const state = useAsyncData<Data>(loader, [loader]);
  useRealtimeTable({ table: "event_tasks", filter: `assignee=eq.${meId}` }, state.reload, { enabled: !!meId });
  useRealtimeTable({ table: "todos", filter: `assignee=eq.${meId}` }, state.reload, { enabled: !!meId });

  const { go, canGo, sheet: initiativeSheet } = useObligationGo(viewer, () => state.reload());
  const [sheet, setSheet] = useState<null | "all" | "due" | "stale" | "upkeep">(null);
  const [busy, setBusy] = useState<string | null>(null);

  // ── the one tap on a row: tick it, or open what it names ─────────────────────────────────────
  const tickOf = (i: Item): ((() => Promise<boolean>) | null) => {
    const r = i.ref;
    if (r.kind === "mine") return () => completeTask(r.row.source === "todo" ? "todo" : "event", r.row.id, meId);
    if (r.kind === "owed" && r.row.source === "todos") return () => completeTask("todo", r.row.subject_id, meId);
    if (r.kind === "upkeep") return async () => {
      if (!supabase) return false;
      const res = await logDone(supabase, r.row.subject_id, localToday(), { userId: meId, name: profile?.display_name ?? null });
      return res.error === null;
    };
    return null;
  };
  const open = (i: Item) => {
    const r = i.ref;
    if (r.kind === "mine") openTask(r.row.id, r.row.source === "todo" ? "todo" : "event");
    else if (r.kind === "team") openTask(r.id, "event");
    else if (canGo(r.row)) go(r.row);
    else setSheet("all");   // its answer (a payment, say) lives on the full panel
  };
  const tick = async (i: Item) => {
    const run = tickOf(i);
    if (!run || busy) return;
    setBusy(i.key);
    const ok = await run();
    setBusy(null);
    if (ok) { toast(`${i.title} — done.`); state.reload(); } else toast(`Couldn't mark "${i.title}" done — try again.`, "error");
  };
  // Bulk, for the stale fold and the equipment row: one write per item, and the count of what took.
  const bulk = async (items: Item[], how: "done" | "later") => {
    if (busy) return;
    setBusy(how);
    const nextWeek = new Date(`${addDays(localToday(), 7)}T17:00:00`).toISOString();
    let took = 0;
    for (const i of items) {
      const r = i.ref;
      if (how === "done") { const run = tickOf(i); if (run && (await run())) took++; continue; }
      const src = r.kind === "mine" ? (r.row.source === "todo" ? "todo" : "event") : r.kind === "owed" && r.row.source === "todos" ? "todo" : null;
      const id = r.kind === "mine" ? r.row.id : r.kind === "owed" ? r.row.subject_id : null;
      if (src && id && !(await updateTask(src, id, { dueISO: nextWeek }, meId)).error) took++;
    }
    setBusy(null);
    const missed = items.length - took;
    toast(`${took} ${how === "done" ? "marked done" : "moved to next week"}${missed ? ` — ${missed} didn't save, try again` : ""}.`, missed ? "error" : undefined);
    state.reload();
  };

  const row = (i: Item) => {
    const canTick = !!tickOf(i);
    const late = i.daysOut !== null && i.daysOut < 0;
    const body = (
      <>
        <span className="owed-row-b">
          <b>{i.critical && <Icon name="warning" />}{i.title}</b>
          <i>{i.sub}</i>
        </span>
        {i.daysOut !== null && <span className="owed-age">{dueWord(i.daysOut)}</span>}
      </>
    );
    if (!canTick) return (
      <button key={i.key} type="button" className={`owed-row${late ? " late" : ""}`} onClick={() => open(i)}>
        {body}<span className="owed-c" aria-hidden="true">›</span>
      </button>
    );
    return (
      <div key={i.key} className={`owed-row${late ? " late" : ""}`}>
        <button type="button" className="task-check" onClick={() => tick(i)} disabled={busy === i.key} aria-label={`${i.kind === "upkeep" ? "Done today" : "Mark done"}: ${i.title}`}>
          <span className="task-box" aria-hidden="true">{busy === i.key ? "…" : null}</span>
        </button>
        <button type="button" className="owed-row-go" onClick={() => open(i)} aria-label={`Open: ${i.title}`}>{body}<span className="owed-c" aria-hidden="true">›</span></button>
      </div>
    );
  };
  const fold = (key: string, title: string, sub: string, onClick: () => void, late = false) => (
    <button key={key} type="button" className={`owed-row${late ? " late" : ""}`} onClick={onClick}>
      <span className="owed-row-b"><b>{title}</b><i>{sub}</i></span>
      <span className="owed-c" aria-hidden="true">›</span>
    </button>
  );
  const sheetHead = (title: string) => (
    <div className="flex items-center"><b className="text-subhead">{title}</b><CloseButton onClick={() => setSheet(null)} /></div>
  );

  // The head stays put while the list loads; its count arrives with the list.
  const head = state.data ? splitHome(state.data.items) : null;
  const due = head ? head.today.length + head.moreToday : null;
  return (
    <div className="adm-sec" id="my-day-tasks">
      {/* "To do", not "Today" (2026-10-09, the navigation round): the screen's title names the lane, Today, now. */}
      <SectionHeader label="To do" right={due === null ? undefined : <span className={`k-count${due ? "" : " ok"}`}>{due ? `${due} due` : "Clear"}</span>} />
      <AsyncSection
        state={state}
        isEmpty={(d) => d.items.length === 0 && d.owed.bookings === 0 && d.owed.low.length === 0 && !d.owed.extrasFailed}
        emptyTitle="Nothing waiting on you"
        emptySub="No task is due, every deadline is inside its date, and stock is above reorder."
        loadingLabel="Checking today…"
        errorTitle="Couldn't check today's work"
        errorSub="This is not the same as nothing being due — we could not read it just now."
      >
        {({ items, owed }) => {
          const s = splitHome(items);
          const upkeepLate = s.upkeep.filter((i) => (i.daysOut ?? 0) < 0).length;
          return (
            <div className="owed">
              {s.today.map((i) => row(i))}
              {s.today.length === 0 && <p className="pnl-note" role="status">Nothing due today.</p>}
              {/* The rest of today, counted where it opens: the head's number is these rows plus this one's. */}
              {s.moreToday > 0 && fold("due", `${s.moreToday} more due today`, "Every one, in the same order", () => setSheet("due"))}

              {/* WAITING, ON ONE LINE (2026-10-10, the Today round). Five rows stood under the three things due —
                  equipment, the stale, bookings, restock, all tasks — each a full-width door, each asking whether to
                  look. They are one line of chips now: what is waiting and how much, one tap each, the late in the
                  warning colour. Each opens what its row opened; the sheets say the rest. */}
              <div className="flex flex-wrap gap-2 pt-3" role="group" aria-label="Also waiting">
                {s.upkeep.length > 0 && <button type="button" className={`k-chip sm${upkeepLate ? " warn" : ""}`} onClick={() => setSheet("upkeep")}
                  aria-label={`Equipment upkeep, ${s.upkeep.length}${upkeepLate ? `, ${upkeepLate} past ${upkeepLate === 1 ? "its" : "their"} service date` : ""}`}>Equipment · {s.upkeep.length} ›</button>}
                {s.stale.length > 0 && <button type="button" className="k-chip sm" onClick={() => setSheet("stale")} aria-label={`${STALE_LABEL}, ${s.stale.length}`}>{STALE_SHORT} · {s.stale.length} ›</button>}
                {owed.bookings > 0 && <button type="button" className="k-chip sm" onClick={() => goPlanTab("leads", { setSection })}
                  aria-label={`${owed.bookings} booking ${owed.bookings === 1 ? "request" : "requests"} to answer`}>Bookings · {owed.bookings} ›</button>}
                {owed.low.length > 0 && <button type="button" className="k-chip sm warn" onClick={() => setSection("garage")} aria-label={`Restock, ${owed.low.length} low`}>Restock · {owed.low.length} ›</button>}
                <button type="button" className="k-chip sm" onClick={() => setSheet("all")} aria-label={`All tasks, ${s.total}`}>All tasks · {s.total} ›</button>
              </div>
              {owed.extrasFailed && (
                <p className="pnl-note" role="status">Team tasks, restock and booking replies couldn&rsquo;t be read just now — the rest is current.</p>
              )}

              {sheet === "all" && (
                <Sheet open onClose={() => setSheet(null)} label="All tasks" header={sheetHead("All tasks")}>{allTasks}</Sheet>
              )}
              {sheet === "due" && (
                <Sheet open onClose={() => setSheet(null)} label="Due today" header={sheetHead(`Due today · ${s.due.length}`)}>
                  <div className="owed">{s.due.map((i) => row(i))}</div>
                </Sheet>
              )}
              {sheet === "stale" && (
                <Sheet open onClose={() => setSheet(null)} label={STALE_LABEL} header={sheetHead(STALE_LABEL)}>
                  <p className="pnl-note">Each was due more than {STALE_DAYS} days ago. Done, moved, or opened to decide.</p>
                  <div className="owed">{s.stale.map((i) => row(i))}</div>
                  {(() => {
                    const tickable = s.stale.filter((i) => i.kind !== "team" && !!tickOf(i));
                    if (!tickable.length) return null;
                    return (
                      <div className="flex flex-wrap gap-2 mt-4">
                        <button type="button" className="btn-pri" disabled={!!busy} onClick={() => bulk(tickable, "done")}>Mark {tickable.length} done</button>
                        <button type="button" className="btn-sec" disabled={!!busy} onClick={() => bulk(tickable, "later")}>Move {tickable.length} to next week</button>
                      </div>
                    );
                  })()}
                </Sheet>
              )}
              {sheet === "upkeep" && (
                <Sheet open onClose={() => setSheet(null)} label="Equipment upkeep" header={sheetHead("Equipment upkeep")}>
                  <div className="owed">{s.upkeep.map((i) => row(i))}</div>
                  {s.upkeep.length > 1 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                      <button type="button" className="btn-pri" disabled={!!busy} onClick={() => bulk(s.upkeep, "done")}>Log all {s.upkeep.length} done today</button>
                    </div>
                  )}
                </Sheet>
              )}
              {initiativeSheet}
            </div>
          );
        }}
      </AsyncSection>
    </div>
  );
}

