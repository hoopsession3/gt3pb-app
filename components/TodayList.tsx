"use client";

import { useCallback, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { loadMyTasks, myTaskDay, type MyTaskRow } from "@/lib/myTasks";
import { splitHome, STALE_DAYS, dayHead, nextUp, reasonWords, ageWords, homeTier, type HomeItem } from "@/lib/home";
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
//
// ONLY WHAT'S YOURS (2026-10-12, the My Day audit, approved). For anyone who manages, this list also
// carried other people's late tasks ("Not attached to an event or stop", no name) and, through Needs
// you's rule, every workstream, initiative and goal of the company's: in the audit's rebuild six of
// the eleven late things here were not the owner's. The rows are yours now — your tasks, deadlines that
// are yours (lib/obligations obligationFor), equipment and the compliance rules your role confirms.
// Everybody's late work is the team's week on Command, by name (components/CommandBoard).
//
// WHAT'S TRUE, AND WHAT'S NEXT (2026-10-12, the My Day audit, approved). The head said "Clear", green,
// over eleven things more than two weeks late, and the list said "Nothing due today." while they sat in a
// chip. The head has four states now (lib/home dayHead); the list leads with up to three of your things
// in a fixed rank, each saying why it is there — "for Sat · ISI Elite Training", "critical", "due today",
// "3 days late", "due Wed" (lib/home homeTier, reasonWords) — and with nothing nearer, the newest thing
// more than two weeks late leads as "To decide", the rest of them one row that opens the sheet it always
// opened. Ticking, opening, the sheets and their bulk Done and Move are as they were.

type Mine = { kind: "mine"; row: MyTaskRow };
type Owe = { kind: "owed" | "upkeep" | "rule"; row: OwedRow };
type Ref = Mine | Owe;
// `subIsOp`: the row's second line is its event's own line, which a tier-1 reason already names.
type Item = HomeItem & { ref: Ref; subIsOp?: boolean };
type Data = { items: Item[]; owed: OwedData; doneToday: number; today: string };

const STALE_LABEL = `More than ${STALE_DAYS / 7} weeks late`;
// The head's tone, in the kit's count chip: plain, the warning amber, or the done green.
const TONE = { plain: "", warn: " soon", ok: " ok" } as const;
const sentence = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

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
    const today = localToday();
    // What I finished today, from both task tables' done_at — the head counts it beside what is left. A
    // count that fails is zero: it is a courtesy, and the list is the answer.
    const since = new Date(`${today}T00:00:00`).toISOString();
    const doneIn = async (table: "todos" | "event_tasks"): Promise<number> => {
      if (!supabase || !meId) return 0;
      try {
        const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("assignee", meId).eq("done", true).gte("done_at", since);
        return error ? 0 : count ?? 0;
      } catch { return 0; }
    };
    const [mine, owed, doneTodos, doneEvent] = await Promise.all([loadMyTasks(meId), loadOwed(meId, role, manage), doneIn("todos"), doneIn("event_tasks")]);
    // A failed read is not a quiet day: either half failing fails the list, and the list says so.
    if (mine.error) throw new Error(mine.error);
    const items: Item[] = [];
    for (const t of mine.rows) {
      const day = myTaskDay(t);
      // The event or stop it belongs to, and how far off — the rank's first question (lib/home homeTier).
      const op = t.op?.day ? { name: t.op.name, daysOut: daysBetween(today, t.op.day) } : null;
      items.push({ key: `mine:${t.source ?? "event"}:${t.id}`, title: t.label, sub: mineSub(t), daysOut: day ? daysBetween(today, day) : null, critical: !!t.critical, kind: "mine", op,
        subIsOp: t.source !== "todo" && !t.meeting_notes && !t.goals, ref: { kind: "mine", row: t } });
    }
    for (const r of owed.rows) {
      // A compliance rule nobody ever confirmed is dated today by v_obligations (0330), every day: it is
      // "never confirmed", not "due today", so it carries no day. One confirmed and gone stale keeps its lateness.
      const kind = r.source === "asset_maintenance" ? "upkeep" : r.source === "compliance_rules" ? "rule" : "owed";
      const daysOut = kind === "rule" && Number(r.days_out) >= 0 ? null : Number(r.days_out);
      items.push({ key: `owed:${r.source}:${r.subject_id}`, title: r.title, sub: `${r.kind} · ${r.detail}`, daysOut, critical: false, kind, ref: { kind, row: r } });
    }
    return { items, owed, doneToday: doneTodos + doneEvent, today };
  }, [meId, role, manage]);
  const state = useAsyncData<Data>(loader, [loader]);
  useRealtimeTable({ table: "event_tasks", filter: `assignee=eq.${meId}` }, state.reload, { enabled: !!meId });
  useRealtimeTable({ table: "todos", filter: `assignee=eq.${meId}` }, state.reload, { enabled: !!meId });

  const { go, canGo, sheet: initiativeSheet } = useObligationGo(viewer, () => state.reload());
  const [sheet, setSheet] = useState<null | "all" | "due" | "stale" | "upkeep" | "rules">(null);
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

  // A row says why it stands where it does, first, in words (lib/home reasonWords) — then what it is, unless
  // the reason already named it — and its age beside it when the reason has not said when (ageWords).
  const row = (i: Item, today: string) => {
    const canTick = !!tickOf(i);
    const late = i.daysOut !== null && i.daysOut < 0;
    const reason = reasonWords(i, today), age = ageWords(i);
    const sub = homeTier(i) === 1 && i.subIsOp ? null : i.sub;
    const body = (
      <>
        <span className="owed-row-b">
          <b>{i.critical && <Icon name="warning" />}{i.title}</b>
          <i>{[reason && sentence(reason), sub].filter(Boolean).join(" · ")}</i>
        </span>
        {age && <span className="owed-age">{age}</span>}
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

  // The head stays put while the list loads; its words arrive with the list. Four states (lib/home dayHead):
  // what is due counts as before; with nothing due it says what is left to decide, or what else is waiting —
  // equipment, compliance, bookings, restock, or a part that could not be read — and "Clear" only when nothing is.
  const loaded = state.data;
  const split = loaded ? splitHome(loaded.items) : null;
  const head = loaded && split ? dayHead({
    done: loaded.doneToday, due: split.due.length, decide: split.stale.length,
    waiting: split.upkeep.length + split.rules.length + loaded.owed.bookings + loaded.owed.low.length, unread: loaded.owed.extrasFailed,
  }) : null;
  const doneToday = loaded?.doneToday ?? 0;
  return (
    <div className="adm-sec" id="my-day-tasks">
      {/* "To do", not "Today" (2026-10-09, the navigation round): the screen's title names the lane, Today, now. */}
      <SectionHeader label="To do" right={head ? <span className={`k-count${TONE[head.tone]}`}>{head.words}</span> : undefined} />
      <AsyncSection
        state={state}
        isEmpty={(d) => d.items.length === 0 && d.owed.bookings === 0 && d.owed.low.length === 0 && !d.owed.extrasFailed}
        emptyTitle="Nothing waiting on you"
        emptySub="No task is due, every deadline is inside its date, and stock is above reorder."
        loadingLabel="Checking today…"
        errorTitle="Couldn't check today's work"
        errorSub="This is not the same as nothing being due — we could not read it just now."
      >
        {({ items, owed, today }) => {
          const s = splitHome(items);
          const upkeepLate = s.upkeep.filter((i) => (i.daysOut ?? 0) < 0).length;
          const leadsToDecide = s.next.length === 0 && s.shown.length > 0;
          return (
            <div className="owed">
              {/* Up to three of yours, by the fixed rank — or, with nothing nearer, the newest to decide. */}
              {s.shown.map((i) => row(i, today))}
              {/* Nothing ranked and nothing to decide: a finished day says so, and points at what comes next —
                  "Nothing due today." said the same of a clear morning and a done one. */}
              {s.shown.length === 0 && (() => {
                const next = nextUp(items);
                return (
                  <>
                    <p className="pnl-note" role="status">{doneToday > 0 ? "Today's done." : "Nothing due today."}</p>
                    {next && fold("next", `Next: ${next.title}`, `${dueWord(next.daysOut as number)} · ${next.sub}`, () => open(next))}
                  </>
                );
              })()}
              {/* The rest of what is due, counted where it opens: the head's number is the due rows above plus this one's. */}
              {s.moreToday > 0 && fold("due", `${s.moreToday} more due today`, "Every one due, in the same order", () => setSheet("due"))}
              {/* THE REST TO DECIDE (2026-10-12): one row, into the sheet that has always held them — its bulk Done and
                  Move to next week as they were. "More" when the newest of them leads the list above. */}
              {s.moreStale > 0 && fold("decide", `${s.moreStale} ${leadsToDecide ? "more " : ""}to decide`, STALE_LABEL, () => setSheet("stale"))}

              {/* WAITING, ON ONE LINE (2026-10-10, the Today round). Five rows stood under the three things due —
                  equipment, the stale, bookings, restock, all tasks — each a full-width door, each asking whether to
                  look. They are one line of chips now: what is waiting and how much, one tap each, the late in the
                  warning colour. Each opens what its row opened; the sheets say the rest. (2026-10-12: the stale left
                  the line for the list itself, as the row "N to decide" — a decision is the list's, not a chip's.
                  "All tasks" counts only what is yours: everything here is.) */}
              <div className="flex flex-wrap gap-2 pt-3" role="group" aria-label="Also waiting">
                {s.upkeep.length > 0 && <button type="button" className={`k-chip sm${upkeepLate ? " warn" : ""}`} onClick={() => setSheet("upkeep")}
                  aria-label={`Equipment upkeep, ${s.upkeep.length}${upkeepLate ? `, ${upkeepLate} past ${upkeepLate === 1 ? "its" : "their"} service date` : ""}`}>Equipment · {s.upkeep.length} ›</button>}
                {s.rules.length > 0 && <button type="button" className="k-chip sm" onClick={() => setSheet("rules")}
                  aria-label={`Compliance, ${s.rules.length} ${s.rules.length === 1 ? "rule" : "rules"} to confirm with the authority`}>Compliance · {s.rules.length} ›</button>}
                {owed.bookings > 0 && <button type="button" className="k-chip sm" onClick={() => goPlanTab("leads", { setSection })}
                  aria-label={`${owed.bookings} booking ${owed.bookings === 1 ? "request" : "requests"} to answer`}>Bookings · {owed.bookings} ›</button>}
                {owed.low.length > 0 && <button type="button" className="k-chip sm warn" onClick={() => setSection("garage")} aria-label={`Restock, ${owed.low.length} low`}>Restock · {owed.low.length} ›</button>}
                <button type="button" className="k-chip sm" onClick={() => setSheet("all")} aria-label={`All tasks, ${s.total}`}>All tasks · {s.total} ›</button>
              </div>
              {owed.extrasFailed && (
                <p className="pnl-note" role="status">Restock and booking replies couldn&rsquo;t be read just now — the rest is current.</p>
              )}

              {sheet === "all" && (
                <Sheet open onClose={() => setSheet(null)} label="All tasks" header={sheetHead("All tasks")}>{allTasks}</Sheet>
              )}
              {sheet === "due" && (
                <Sheet open onClose={() => setSheet(null)} label="Due today" header={sheetHead(`Due today · ${s.due.length}`)}>
                  <div className="owed">{s.due.map((i) => row(i, today))}</div>
                </Sheet>
              )}
              {sheet === "stale" && (
                <Sheet open onClose={() => setSheet(null)} label={STALE_LABEL} header={sheetHead(STALE_LABEL)}>
                  <p className="pnl-note">Each was due more than {STALE_DAYS} days ago. Done, moved, or opened to decide.</p>
                  <div className="owed">{s.stale.map((i) => row(i, today))}</div>
                  {(() => {
                    const tickable = s.stale.filter((i) => !!tickOf(i));
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
              {sheet === "rules" && (
                <Sheet open onClose={() => setSheet(null)} label="Compliance to confirm" header={sheetHead(`Compliance · ${s.rules.length} to confirm`)}>
                  <p className="pnl-note">Each is a rule nobody has confirmed with its authority, or confirmed more than a year ago. Open one to confirm it — with whom, and when.</p>
                  <div className="owed">{s.rules.map((i) => row(i, today))}</div>
                </Sheet>
              )}
              {sheet === "upkeep" && (
                <Sheet open onClose={() => setSheet(null)} label="Equipment upkeep" header={sheetHead("Equipment upkeep")}>
                  <div className="owed">{s.upkeep.map((i) => row(i, today))}</div>
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

