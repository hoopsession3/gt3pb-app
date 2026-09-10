"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useOperatorSection } from "./OperatorNav";
import { prepHandoffKey, prepHandoffValue } from "@/lib/eventRecord";
import { fetchInventory, rollupLowStock, type InvItem } from "@/lib/inventory";
import { goPlanTab } from "@/lib/planNav";
import { useTaskSheet } from "./TaskSheet";
import AsyncSection from "./AsyncSection";

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

type Row = {
  source: string; subject_id: string; area: string; kind: string;
  title: string; detail: string; due_on: string; days_out: number;
  severity: "overdue" | "soon" | "upcoming"; route: string; market: string | null;
};
// `owner` is nullable, and that turned out to be the whole point. Both this panel and the NeedsYou
// it replaced pushed a task ONLY when it had an event or a stop to name — so a past-due task
// attached to neither was skipped by both, silently, forever. Measured in production: all SEVEN
// past-due tasks are exactly that shape. They were visible on Command and nowhere on My Day.
type Task = { id: string; label: string; owner: { kind: "event" | "stop"; id: string; name: string } | null; late: number | null };
type Data = { rows: Row[]; tasks: Task[]; low: InvItem[]; bookings: number; extrasFailed: boolean };

const SHOW = 5;
const localYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const ageWord = (d: number) =>
  d < 0 ? `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} late`
  : d === 0 ? "due today"
  : `in ${d} day${d === 1 ? "" : "s"}`;

export default function Owed({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [openTasks, setOpenTasks] = useState(false);
  const { setSection } = useOperatorSection();

  const loader = useCallback(async (): Promise<Data> => {
    if (!supabase) return { rows: [], tasks: [], low: [], bookings: 0, extrasFailed: false };
    const today = localYMD(new Date());
    const nowIso = new Date().toISOString();

    // The list itself. This one throws.
    const ob = await supabase.from("v_obligations")
      .select("source, subject_id, area, kind, title, detail, due_on, days_out, severity, route, market")
      .neq("severity", "upcoming")
      .order("due_on", { ascending: true })
      .limit(100);
    if (ob.error) throw new Error(ob.error.message);

    // The three softer feeds. Anything that fails here returns empty rather than taking the panel
    // with it — see the header.
    let tasks: Task[] = [], low: InvItem[] = [], bookings = 0, extrasFailed = false;
    try {
      const [b, evs, st, tk, inv] = await Promise.all([
        supabase.from("booking_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
        supabase.from("events").select("*").order("day"),
        supabase.from("stops").select("id, name, starts_at, status, archived_at").order("starts_at"),
        supabase.from("event_tasks").select("id, label, event_id, stop_id, due_at").eq("done", false).eq("kind", "task"),
        fetchInventory(),
      ]);
      // CHECKED FIRST, BEFORE ANYTHING READS .data. PostgREST returns an error OBJECT rather than
      // throwing, so a bad column name looks exactly like success with no rows. That is how this
      // shipped broken: "kind" was selected from events, which has no such column, PostgREST
      // rejected the whole query, and seven past-due tasks rendered as silence.
      const softErr = [b.error, evs.error, st.error, tk.error].find(Boolean);
      if (softErr) throw new Error(softErr.message);
      bookings = b.count ?? 0;

      const allEv = ((evs.data as { id: string; title: string | null; day: string | null; archived_at: string | null }[]) ?? []).filter((e) => !e.archived_at);
      const allSt = ((st.data as { id: string; name: string | null; starts_at: string | null; status: string | null; archived_at: string | null }[]) ?? []).filter((x) => !x.archived_at);
      const evName = new Map(allEv.map((e) => [e.id, e.title ?? "Event"]));
      const stName = new Map(allSt.map((x) => [x.id, x.name ?? "Stop"]));
      const evDay = new Map(allEv.map((e) => [e.id, e.day]));
      const stDay = new Map(allSt.map((x) => [x.id, x.starts_at ? localYMD(new Date(x.starts_at)) : null]));
      const dueEv = new Set(allEv.filter((e) => e.day && e.day < today).map((e) => e.id));
      const dueSt = new Set(allSt.filter((x) => x.status === "done" || (x.starts_at && localYMD(new Date(x.starts_at)) < today)).map((x) => x.id));

      const daysLate = (ymd: string | null | undefined) => {
        if (!ymd) return null;
        return Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${ymd}T12:00:00`)) / 86400000);
      };

      for (const t of ((tk.data as { id: string; label: string; event_id: string | null; stop_id: string | null; due_at: string | null }[]) ?? [])) {
        const isPast = t.due_at ? t.due_at < nowIso : ((t.event_id && dueEv.has(t.event_id)) || (t.stop_id && dueSt.has(t.stop_id)));
        if (!isPast) continue;
        const own = t.due_at ? localYMD(new Date(t.due_at)) : (t.event_id ? evDay.get(t.event_id) : t.stop_id ? stDay.get(t.stop_id) : null);
        const owner = t.event_id ? { kind: "event" as const, id: t.event_id, name: evName.get(t.event_id) ?? "Event" }
                    : t.stop_id ? { kind: "stop" as const, id: t.stop_id, name: stName.get(t.stop_id) ?? "Stop" }
                    : null;
        tasks.push({ id: t.id, label: t.label, owner, late: daysLate(own) });
      }
      tasks.sort((a, b) => (b.late ?? 0) - (a.late ?? 0));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      low = inv.enabled ? rollupLowStock(inv.items, allEv.filter((e) => e.day && e.day >= today) as any) : [];
    } catch { extrasFailed = true; tasks = []; low = []; bookings = 0; }

    return { rows: (ob.data as Row[]) ?? [], tasks, low, bookings, extrasFailed };
  }, []);
  const state = useAsyncData<Data>(loader, []);

  const { openTask } = useTaskSheet();
  const openTarget = (kind: "event" | "stop", id: string) => {
    try { localStorage.setItem(prepHandoffKey, prepHandoffValue(kind, id)); } catch { /* ignore */ }
    setSection("prep");
  };

  return (
    <AsyncSection
      state={state}
      isEmpty={(d) => !d.extrasFailed && d.rows.length === 0 && d.tasks.length === 0 && d.low.length === 0 && d.bookings === 0}
      // An empty attention list is the system working, and should read that way rather than as an
      // absence of data.
      emptyTitle="Nothing waiting on you"
      emptySub="Equipment service, permits, certifications, offers, invoices, agreements, goals and team tasks are all inside their dates, stock is above its reorder points, and every booking request has an answer."
      loadingLabel="Checking what's owed…"
      errorTitle="Couldn't check what's overdue"
      errorSub="This is not the same as nothing being overdue — we could not read it just now."
    >
      {({ rows, tasks, low, bookings, extrasFailed }) => {
        const late = rows.filter((r) => r.severity === "overdue");
        const soon = rows.filter((r) => r.severity === "soon");
        const shown = open ? rows : rows.slice(0, compact ? 3 : SHOW);
        // Every count in one sentence. Two panels meant two headlines and the reader did the
        // addition; the point of merging them is that they do not have to.
        const bits = [
          late.length > 0 ? `${late.length} overdue` : "",
          tasks.length > 0 ? `${tasks.length} task${tasks.length === 1 ? "" : "s"} past due` : "",
          soon.length > 0 ? `${soon.length} due soon` : "",
        ].filter(Boolean);

        return (
          <div className="owed">
            <div className="owed-head">
              <span className="owed-k">Needs you</span>
              <b>{bits.length ? bits[0] : "Nothing late"}
                {bits.length > 1 && <span className="dim"> · {bits.slice(1).join(" · ")}</span>}
              </b>
            </div>

            {shown.map((r) => (
              <a key={`${r.source}:${r.subject_id}`} className={`owed-row${r.severity === "overdue" ? " late" : ""}`} href={r.route}>
                <span className="owed-row-b">
                  <b>{r.title}</b>
                  <i>{r.kind} · {r.detail}</i>
                </span>
                {/* The word, not just the colour — a red row that does not say "late" is a colour. */}
                <span className="owed-age">{ageWord(Number(r.days_out))}</span>
                <span className="owed-c" aria-hidden="true">›</span>
              </a>
            ))}

            {rows.length > shown.length && (
              <button type="button" className="owed-more" onClick={() => setOpen(true)}>
                Show the other {rows.length - shown.length} <span aria-hidden="true">›</span>
              </button>
            )}
            {open && rows.length > (compact ? 3 : SHOW) && (
              <button type="button" className="owed-more" onClick={() => setOpen(false)}>Show fewer</button>
            )}

            {/* ── team tasks ──────────────────────────────────────────────────────────────────
                Same row shape as everything above, deliberately. They used to sit in a second box
                with their own look, which is what made one screen read as two. */}
            {tasks.length > 0 && (
              <>
                <button type="button" className="owed-more" onClick={() => setOpenTasks((v) => !v)} aria-expanded={openTasks}>
                  {tasks.length} team task{tasks.length === 1 ? "" : "s"} past due <span aria-hidden="true">{openTasks ? "⌄" : "›"}</span>
                </button>
                {openTasks && tasks.slice(0, 8).map((t) => (
                  <button key={t.id} type="button" className="owed-row late"
                          onClick={() => (t.owner ? openTarget(t.owner.kind, t.owner.id) : openTask(t.id, "event"))}>
                    <span className="owed-row-b">
                      <b>{t.label}</b>
                      {/* A task with no event or stop is not a broken row — it is a task somebody
                          wrote down on its own. Say that, and open the task itself rather than a
                          prep screen it does not belong to. */}
                      <i>{t.owner ? `${t.owner.kind} · ${t.owner.name}` : "not attached to an event or stop"}</i>
                    </span>
                    <span className="owed-age">{t.late != null && t.late > 0 ? ageWord(-t.late) : "past due"}</span>
                    <span className="owed-c" aria-hidden="true">›</span>
                  </button>
                ))}
                {openTasks && tasks.length > 8 && <div className="pnl-note">+ {tasks.length - 8} more past due.</div>}
              </>
            )}

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
              <p className="pnl-note" role="status">
                Team tasks, restock and booking replies couldn&rsquo;t be read just now — the overdue
                list above is still current.
              </p>
            )}

            {low.length > 0 && (
              <>
                <div className="wrule"><span>Restock · {low.length} low for upcoming events</span></div>
                <div className="ev-invlist">
                  {low.slice(0, 6).map((it, i) => (
                    <div key={i} className={`ev-inv-row${(it.qty ?? 0) <= 0 ? " out" : ""}`}>
                      <span className="ev-inv-n">{it.qty ?? "—"}</span>
                      <span className="ev-inv-x"><b>{it.name}</b><span>reorder at {it.reorderPoint ?? "—"}{it.unit ? ` ${it.unit}` : ""}</span></span>
                      {it.reorderLink && <a className="ev-inv-link" href={it.reorderLink} target="_blank" rel="noreferrer">Reorder ›</a>}
                    </div>
                  ))}
                  {low.length > 6 && <div className="pnl-note">+ {low.length - 6} more below reorder point.</div>}
                </div>
              </>
            )}
          </div>
        );
      }}
    </AsyncSection>
  );
}
