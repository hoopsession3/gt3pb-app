"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useOperatorSection, VALID, sectionsForRole, type OpSection } from "./OperatorNav";
import { useRecord } from "./RecordSheet";
import { useAuth } from "./AuthProvider";
import { useAppStable } from "./AppProvider";
import InitiativeSheet from "./InitiativeSheet";
import { scrollToAnchor } from "@/lib/anchors";
import { obligationGo, obligationFor, OBLIGATION_WAYS, type ObligationRow, type Viewer } from "@/lib/obligations";
import { roleOf, canOf } from "@/lib/roles";
import { logDone } from "@/lib/upkeep";
import { completeTask } from "@/lib/tasks";
import { markInvoicePaid } from "@/lib/collect";
import { useConfirm } from "./ConfirmSheet";
import { fetchInventory, rollupLowStock, type InvItem } from "@/lib/inventory";
import { goPlanTab } from "@/lib/planNav";
import { useTaskSheet } from "./TaskSheet";
import AsyncSection from "./AsyncSection";
import { dayKey, localToday } from "@/lib/dates";
import { dueWord } from "@/lib/dayWords";
import Said from "./Said";
import { plainFailure } from "@/lib/failureWords";

// WHAT NEEDS YOU — one panel, because My Day was carrying two.
//
// ── WHAT THIS ABSORBED, AND WHY ────────────────────────────────────────────────────────────────
// My Day had TWO boxes both headed "here is what is behind": this one (v_obligations — permits,
// equipment service, initiatives, workstreams, offers, invoices, agreements, goals) and NeedsYou
// (booking replies, past-due team tasks, low stock). Different queries, different sort orders,
// different visual treatments, neither aware the other existed, stacked on one screen.
//
// Worth being precise, because an earlier pass of this audit was not: they are NOT duplicate data.
// Measured — 17 obligations and 7 past-due tasks, with ZERO rows in common, because 0320 excluded
// tasks from v_obligations on purpose. What was duplicated was the SHAPE: two panels answering
// "what am I behind on?" in two vocabularies. That is a real defect and it is the one fixed here.
//
// ── WHAT IT DELIBERATELY DID NOT DO ────────────────────────────────────────────────────────────
// It did not move tasks INTO v_obligations. 0320 excluded them with stated reasoning — they carry
// cron sweepers and reach a phone through the alert spine — and overturning a written decision
// wants better evidence than "two other screens show them anyway". So the task feed keeps its own
// query and its own rule (below), and the merge happens where the duplication actually was: on
// the screen.
//
// ── THE RULE THE TASK FEED CARRIES, KEPT INTACT ────────────────────────────────────────────────
// A task is past due if its own due_at has passed, OR — when it has no due_at — if the event or
// stop it belongs to is already behind it. That second half is why this is not a one-line query,
// and dropping it would silently shrink the list to tasks somebody remembered to date.
//
// ── FAILURE, BY TIER — AND VISIBLY ─────────────────────────────────────────────────────────────
// The obligations read IS the panel: if it fails, the panel says so. The other three degrade
// without taking it down, because a failed inventory fetch must not hide the overdue list to
// protect a restock line.
//
// But degrading is not the same as going quiet, and the first version of this got that wrong in
// production: a guessed column list asked events for "kind", which it does not have, PostgREST
// rejected the whole query, and a bare catch turned the failure into an absence. That is the
// false-empty defect this repo keeps a whole audit for, written in by hand while the header above
// claimed the opposite. So the extras now report their own failure on screen, and the reason the
// column list is select("*") is that guessing one is what broke it.
//
// A CORRECTION, because the commit that fixed the above blamed the wrong symptom: the seven
// missing past-due tasks were NOT caused by that query error. They were missing because of the
// bug directly below — no event, no stop, no row — and they would have been missing with a
// perfect query. The swallow was real and the column was wrong; the thing I pointed at as proof
// of them was not. Both fixed here, separately, because they are separate faults.
//
// ── THE TEAM'S LATE TASKS LEFT (2026-10-12, the My Day audit, approved: "only what's yours") ────
// The team feed — everybody else's past-due event tasks, for anyone who manages — is gone from this
// panel and from My Day's To do. In the audit's rebuild six of the eleven late things on the owner's
// My Day were somebody else's, and these rows said "Not attached to an event or stop" with no name.
// Everybody's late work is the team's week on Command now (components/CommandBoard), each row naming
// who it waits on and opening the task. What stays is this viewer's: the deadlines lib/obligations
// obligationFor keeps, booking replies for a manager, restock for whoever opens Assets.

type Row = {
  source: string; subject_id: string; area: string; kind: string;
  title: string; detail: string; due_on: string; days_out: number;
  severity: "overdue" | "soon" | "upcoming"; route: string; market: string | null;
  owner_user_id: string | null;
};
type Data = { rows: Row[]; low: InvItem[]; bookings: number; extrasFailed: boolean };
export type { Row as OwedRow, Data as OwedData };

const SHOW = 5;

// THE READ, ON ITS OWN (2026-10-09, One home). The home's Today list reads exactly what this panel
// reads — the same deadlines, the same viewer filter — so it calls this rather than a copy that could
// drift. (2026-10-12: the team's late tasks left it; see the header.)
export async function loadOwed(meId: string | null, role: string, manage: boolean): Promise<Data> {
  if (!supabase) return { rows: [], low: [], bookings: 0, extrasFailed: false };
  const today = dayKey(new Date());

  // The list itself. This one throws.
  const ob = await supabase.from("v_obligations")
    .select("source, subject_id, area, kind, title, detail, due_on, days_out, severity, route, market, owner_user_id")
    .neq("severity", "upcoming")
    .order("due_on", { ascending: true })
    .limit(100);
  if (ob.error) throw new Error(ob.error.message);
  const listed = (ob.data as Row[]) ?? [];

  // A GOAL'S OWNER (2026-10-12, "only what's yours"). v_obligations writes null for a goal's owner
  // (0320) though goals carry owner_user_id, and a goal is kept now for its owner alone — so the owners
  // of the goals on the list are read here, by id. It is part of the list: a failure fails the panel,
  // rather than a goal of yours going quietly missing. A view that carried the owner would retire it.
  const goalIds = listed.filter((r) => r.source === "goals").map((r) => r.subject_id);
  if (goalIds.length) {
    const g = await supabase.from("goals").select("id, owner_user_id").in("id", goalIds);
    if (g.error) throw new Error(g.error.message);
    const ownerOf = new Map(((g.data as { id: string; owner_user_id: string | null }[]) ?? []).map((x) => [x.id, x.owner_user_id]));
    for (const r of listed) if (r.source === "goals") r.owner_user_id = ownerOf.get(r.subject_id) ?? null;
  }

  // The two softer feeds. Anything that fails here returns empty rather than taking the panel
  // with it — see the header.
  //
  // And only for whoever can act on them (2026-10-04): new booking requests are a manager's to
  // triage (the leads tab is a manager's), and the restock line goes to Assets, which only the roles
  // that open Assets can. A server's My Day listed both, and they tapped through to screens she
  // cannot open. (The team's late tasks were the third; they are Command's now — 2026-10-12.)
  const wantBookings = manage, wantStock = sectionsForRole(role).includes("garage");
  let low: InvItem[] = [], bookings = 0, extrasFailed = false;
  if (wantBookings || wantStock) try {
    const [b, evs, inv] = await Promise.all([
      supabase.from("booking_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("events").select("*").order("day"),
      fetchInventory(),
    ]);
    // CHECKED FIRST, BEFORE ANYTHING READS .data. PostgREST returns an error OBJECT rather than
    // throwing, so a bad column name looks exactly like success with no rows. That is how this
    // shipped broken: "kind" was selected from events, which has no such column, PostgREST
    // rejected the whole query, and seven past-due tasks rendered as silence.
    const softErr = [b.error, evs.error].find(Boolean);
    if (softErr) throw new Error(softErr.message);
    bookings = b.count ?? 0;
    const allEv = ((evs.data as { id: string; title: string | null; day: string | null; archived_at: string | null }[]) ?? []).filter((e) => !e.archived_at);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    low = inv.enabled ? rollupLowStock(inv.items, allEv.filter((e) => e.day && e.day >= today) as any) : [];
  } catch { extrasFailed = true; low = []; bookings = 0; }
  if (!wantBookings) bookings = 0;
  if (!wantStock) low = [];

  // "Needs you" means you: only the rows that are this viewer's (lib/obligations obligationFor).
  const v: Viewer = { id: meId, sections: sectionsForRole(role), manage };
  const rows = listed.filter((r) => obligationFor(r, v));
  return { rows, low, bookings, extrasFailed };
}
// The day key and the "N days late" wording were private copies here; lib/dates and lib/dayWords
// own them now, so My Day's top three and this panel cannot say lateness two ways.

/**
 * Where a Needs-you row goes for this viewer, and whether it goes anywhere at all — shared with the
 * home's Today list (2026-10-09), so a deadline opens the same thing from either. A row goes where
 * lib/obligations says: the task, the person, or the panel that holds it — an in-app jump, never the
 * full reload the <a href> rows were (2026-10-04).
 */
export function useObligationGo(viewer: Viewer, onSaved?: () => void) {
  const { setSection } = useOperatorSection();
  const { openTask } = useTaskSheet();
  const { openRecord } = useRecord();
  const [initId, setInitId] = useState<string | null>(null);
  const go = (r: ObligationRow) => {
    const to = obligationGo(r, viewer);
    if (to.kind === "task") { openTask(to.id, to.source); return; }
    if (to.kind === "person") { openRecord("person", to.id); return; }
    if (to.kind === "initiative") { setInitId(to.id); return; }
    if (to.kind === "page") { window.location.assign(to.href); return; }
    if (to.kind === "rule") { openRecord("compliance_rule", to.id); return; }
    if (to.kind === "none") return;
    setSection((VALID as Set<string>).has(to.section) ? (to.section as OpSection) : "day");
    scrollToAnchor(to.anchor);
  };
  // Whether the row has somewhere to go for THIS viewer. Equipment upkeep is everybody's to log, but
  // only some roles can open Assets — for the rest the row is its one tap, and promises nothing more.
  const canGo = (r: ObligationRow) => {
    const to = obligationGo(r, viewer);
    if (to.kind === "none") return false;
    return to.kind !== "section" || viewer.sections.includes(to.section);
  };
  const sheet = initId ? <InitiativeSheet id={initId} onClose={() => setInitId(null)} onSaved={onSaved} /> : null;
  return { go, canGo, sheet };
}

export default function Owed({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { setSection } = useOperatorSection();
  const { user, profile } = useAuth();
  const { toast } = useAppStable();
  const confirm = useConfirm();
  const admin = canOf(profile).admin;
  // Who is looking decides what is theirs (lib/obligations obligationFor) — read once, as plain values,
  // so the loader below re-runs only when the person or their role actually changes.
  const meId = user?.id ?? null;
  const role = roleOf(profile);
  const manage = canOf(profile).manage;
  const viewer: Viewer = { id: meId, sections: sectionsForRole(role), manage };

  const loader = useCallback((): Promise<Data> => loadOwed(meId, role, manage), [meId, role, manage]);
  const state = useAsyncData<Data>(loader, [loader]);

  const [allLow, setAllLow] = useState(false);
  const { go, canGo, sheet: initiativeSheet } = useObligationGo(viewer, () => state.reload());

  // ── THE ONE TAP ON THE ROW (2026-10-04, Ryan's My Day at 10:40 PM) ─────────────────────────────
  // Four pieces of equipment 71–94 days "late" because saying "it's clean" took eight steps in
  // Assets; a to-do due today took opening its sheet to tick. Each now answers where it is listed.
  const [doing, setDoing] = useState<string | null>(null);
  const keyOf = (r: Row) => `${r.source}:${r.subject_id}`;
  const fmtDay = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const doneToday = async (r: Row) => {
    if (!supabase || doing) return;
    setDoing(keyOf(r));
    const res = await logDone(supabase, r.subject_id, localToday(), { userId: meId, name: profile?.display_name ?? null });
    setDoing(null);
    if (res.error === null) {
      toast(res.already ? `${r.title} — already logged for today.`
        : `${r.title} — ${res.kind} logged for today${res.next_due_on ? `. Next due ${fmtDay(res.next_due_on)}.` : "."}`);
      state.reload();
    } else toast(`Couldn't log it — ${plainFailure(res.error)}`, "error");
  };
  const markDone = async (r: Row) => {
    if (doing) return;
    setDoing(keyOf(r));
    const ok = await completeTask("todo", r.subject_id, meId);
    setDoing(null);
    if (ok) { toast(`${r.title} — done.`); state.reload(); } else toast("Couldn't mark it done — try again.", "error");
  };
  // An invoice is paid when the money is in — a cheque, a transfer — which only a person can see.
  // One tap and a question, because it closes the invoice AND its order (0341), and money said
  // received by a slip of the thumb is worse than a row left one more day.
  const invoicePaid = async (r: Row) => {
    if (!supabase || doing) return;
    if (!(await confirm({ title: `Mark ${r.title} paid?`, body: "When the money is in. It closes the invoice and marks its office order paid.", confirmLabel: "Mark paid" }))) return;
    setDoing(keyOf(r));
    const res = await markInvoicePaid(supabase, r.subject_id);
    setDoing(null);
    if (res.error) { toast(`Couldn't mark it paid — ${plainFailure(res.error)}`, "error"); return; }
    toast(res.already ? `${r.title} — already paid.` : `${r.title} — paid.`);
    state.reload();
  };
  // The answer is a tick — the same box My tasks ticks, because it is the same act: this is done.
  const answerFor = (r: Row): { label: string; busy: boolean; run: () => void } | null => {
    const way = OBLIGATION_WAYS[r.source];
    if (!way || (way === "admin" && !admin)) return null;
    const busy = doing === keyOf(r);
    if (r.source === "asset_maintenance") return { label: "Done today", busy, run: () => doneToday(r) };
    if (r.source === "todos") return { label: "Mark done", busy, run: () => markDone(r) };
    if (r.source === "invoices") return { label: "Paid", busy, run: () => invoicePaid(r) };
    return null;
  };

  return (
    <AsyncSection
      state={state}
      isEmpty={(d) => !d.extrasFailed && d.rows.length === 0 && d.low.length === 0 && d.bookings === 0}
      // An empty attention list is the system working, and should read that way rather than as an
      // absence of data.
      emptyTitle="Nothing waiting on you"
      emptySub="Every deadline is inside its date, stock is above reorder, and every booking has an answer."
      loadingLabel="Checking what's owed…"
      errorTitle="Couldn't check what's overdue"
      errorSub="This is not the same as nothing being overdue — we could not read it just now."
    >
      {({ rows, low, bookings, extrasFailed }) => {
        const late = rows.filter((r) => r.severity === "overdue");
        const soon = rows.filter((r) => r.severity === "soon");
        const shown = open ? rows : rows.slice(0, compact ? 3 : SHOW);
        // Every count in one sentence. Two panels meant two headlines and the reader did the
        // addition; the point of merging them is that they do not have to. And it has to be ONE
        // number for one idea: "11 overdue · 7 tasks past due" (Ryan's My Day, 2026-10-04) read as if
        // the seven were among the eleven — two words for late, and a sum left to the reader. The
        // team's seven are Command's since 2026-10-12, so late is this viewer's rows alone.
        const lateCount = late.length;

        return (
          <div className="owed">
            {/* The counts as the kit's count chips (2026-10-07, the pill round): late in red, due soon
                in amber — the same chip as every section count, so a number reads as a number. */}
            <div className="owed-head">
              <span className="owed-k">Needs you</span>
              <span className="owed-n">
                {lateCount > 0 && <span className="k-count due">{lateCount} late</span>}
                {soon.length > 0 && <span className="k-count soon">{soon.length} due soon</span>}
                {lateCount === 0 && soon.length === 0 && <span className="k-count ok">Nothing late</span>}
              </span>
            </div>

            {shown.map((r) => {
              const body = (
                <>
                  <span className="owed-row-b">
                    <b>{r.title}</b>
                    <i>{r.kind} · {r.detail}</i>
                  </span>
                  {/* The word, not just the colour — a red row that does not say "late" is a colour. */}
                  <span className="owed-age">{dueWord(Number(r.days_out))}</span>
                </>
              );
              const answer = answerFor(r);
              const lateCls = r.severity === "overdue" ? " late" : "";
              if (!answer) return canGo(r) ? (
                <button type="button" key={keyOf(r)} className={`owed-row${lateCls}`} onClick={() => go(r)}>
                  {body}
                  <span className="owed-c" aria-hidden="true">›</span>
                </button>
              ) : (
                // Nowhere to go and nothing this viewer may tap: the row is information, and says so
                // by not looking like a door.
                <div key={keyOf(r)} className={`owed-row${lateCls}`}>{body}</div>
              );
              // A row with its own answer: the tick in front, the row behind it still opening what
              // it names when this viewer can go there — and plain text when they cannot.
              return (
                <div key={keyOf(r)} className={`owed-row${lateCls}`}>
                  <button type="button" className="task-check" onClick={answer.run} disabled={answer.busy} aria-label={`${answer.label}: ${r.title}`} title={answer.label}>
                    <span className="task-box" aria-hidden="true">{answer.busy ? "…" : null}</span>
                  </button>
                  {canGo(r)
                    ? <button type="button" className="owed-row-go" onClick={() => go(r)}>{body}<span className="owed-c" aria-hidden="true">›</span></button>
                    : <div className="owed-row-go">{body}</div>}
                </div>
              );
            })}

            {rows.length > shown.length && (
              <button type="button" className="owed-more" onClick={() => setOpen(true)}>
                Show the other {rows.length - shown.length} <span aria-hidden="true">›</span>
              </button>
            )}
            {open && rows.length > (compact ? 3 : SHOW) && (
              <button type="button" className="owed-more" onClick={() => setOpen(false)}>Show fewer</button>
            )}

            {/* ── the team's late tasks are not here (2026-10-12) ─────────────────────────────
                Everybody else's late work is the team's week on Command, by name — see the header. */}

            {/* ── the two that are not deadlines ──────────────────────────────────────────────
                A booking with no reply and stock under its reorder point are both "waiting on
                you", and neither is a date. Kept as their own lines rather than forced into a
                list sorted by how late something is, which they cannot be. */}
            {bookings > 0 && (
              <button type="button" className="owed-more" onClick={() => goPlanTab("leads", { setSection })}>
                {bookings} new booking {bookings === 1 ? "request" : "requests"} to reply to <span aria-hidden="true">›</span>
              </button>
            )}
            {/* A read that failed and a read that found nothing are DIFFERENT ANSWERS, and this
                panel said the second when it meant the first: a guessed column name ("kind", which
                events does not have) made PostgREST reject the whole query, the catch below
                swallowed it, and seven past-due tasks rendered as silence. Never again silently —
                the overdue list above still stands on its own, and this says what is missing. */}
            {extrasFailed && (
              <Said as="p" className="pnl-note" assertive>
                Restock and booking replies couldn&rsquo;t be read just now — the overdue list above is
                still current.
              </Said>
            )}

            {low.length > 0 && (
              <>
                {/* The rule names a job, so it goes where the job is done — Assets, where stock lives. */}
                <button type="button" className="wrule wrule-go" onClick={() => setSection("garage")}><span>Restock · {low.length} low for upcoming events ›</span></button>
                <div className="ev-invlist">
                  {(allLow ? low : low.slice(0, 6)).map((it, i) => (
                    <div key={i} className={`ev-inv-row${(it.qty ?? 0) <= 0 ? " out" : ""}`}>
                      <span className="ev-inv-n">{it.qty ?? "—"}</span>
                      <span className="ev-inv-x"><b>{it.name}</b><span>reorder at {it.reorderPoint ?? "—"}{it.unit ? ` ${it.unit}` : ""}</span></span>
                      {it.reorderLink && <a className="ev-inv-link" href={it.reorderLink} target="_blank" rel="noreferrer">Reorder ›</a>}
                    </div>
                  ))}
                  {!allLow && low.length > 6 && (
                    <button type="button" className="owed-more" onClick={() => setAllLow(true)}>Show the other {low.length - 6} <span aria-hidden="true">›</span></button>
                  )}
                </div>
              </>
            )}
            {initiativeSheet}
          </div>
        );
      }}
    </AsyncSection>
  );
}
