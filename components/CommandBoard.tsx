"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import LaunchReadiness from "./LaunchReadiness";
import { useOperatorSection } from "@/components/OperatorNav";
import { useTaskSheet } from "./TaskSheet";
import { completeInitiative } from "@/lib/tasks";
import { SectionHeader, InfoRow } from "@/components/kit";
import InlineCreate from "./InlineCreate";
import InitiativeSheet from "./InitiativeSheet";
import Icon from "@/components/Icon";
import { addDays, localToday } from "@/lib/dates";
import { useConfirm } from "@/components/ConfirmSheet";
import dynamic from "next/dynamic";
import { isMissingColumn } from "@/lib/schemaSkew";
import { type PortfolioStream, milestoneStream } from "@/lib/portfolio";

// The manage sheet is an admin's, opened from a milestone's ⋯ — loaded then, not with the board.
const MilestoneSheet = dynamic(() => import("./MilestoneSheet"), { ssr: false });

// COMMAND BOARD — the shared war room both founders see: the launch initiatives with a countdown and
// milestone progress, then This Week · Blockers · Done · Money in one glance. This is the digital twin
// of the physical magnetic board — one screen that answers "are we on track?" instead of a text thread.
// Reads across BOTH task engines (todos + event_tasks) + incidents + initiatives via useAsyncData — a
// failed query now surfaces as a real error state (AsyncSection) instead of silently rendering "Nothing
// blocked 🟢" on a request that actually errored. Admins (the owners) manage initiatives + milestones.
type Initiative = { id: string; title: string; summary: string | null; target_date: string | null; status: string; emoji: string | null };
// workstream_id (0350) is the portfolio workstream the milestone is filed to; workstream keeps the
// words — the stream's name, written by the database when the link is set, or words from before.
type Milestone = { id: string; initiative_id: string; title: string; due_on: string | null; done: boolean; workstream: string | null; workstream_id?: string | null; sort: number };
type Work = { id: string; title: string; due: string | null; src: "todo" | "task" };
type Incident = { id: string; problem: string; severity: string; created_at: string };
// 0263 — programs ↔ outcomes: the goals an initiative serves, and at-risk goals on the Blockers line.
type GoalLite = { id: string; title: string; checkin_status: string | null; current_value: number; target_value: number; unit: string | null };
type BoardData = {
  inits: Initiative[]; miles: Milestone[]; links: { initiative_id: string; milestone_id: string }[];
  week: Work[]; incidents: Incident[]; overdue: Work[]; done: Work[];
  goals: GoalLite[]; goalLinks: { initiative_id: string; goal_id: string }[];
  // The portfolio a milestone is filed to (0350). A failed read is said in the pick, not thrown:
  // the board is the launch, and one list it can do without must not take it down.
  streams: PortfolioStream[]; streamsErr: string | null; linkable: boolean;
};
const EMPTY_BOARD: BoardData = { inits: [], miles: [], links: [], week: [], incidents: [], overdue: [], done: [], goals: [], goalLinks: [], streams: [], streamsErr: null, linkable: false };

const todayKey = localToday;
const weekAheadKey = () => addDays(localToday(), 7);
const weekAgoISO = () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString(); };
const daysTo = (iso: string) => Math.round((new Date(`${iso}T12:00:00`).getTime() - Date.now()) / 864e5);
const countdown = (iso: string | null) => { if (!iso) return ""; const d = daysTo(iso); return d > 1 ? `${d} days left` : d === 1 ? "tomorrow" : d === 0 ? "today" : `${-d}d overdue`; };
const dnice = (iso: string | null) => iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
const localYMD = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const toWork = (rows: any[], src: "todo" | "task"): Work[] => rows.map((r) => ({ id: r.id, title: r.title ?? r.label ?? "—", due: r.due_on ?? (r.due_at ? localYMD(String(r.due_at)) : null), src }));

export default function CommandBoard() {
  const confirm = useConfirm();
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const isAdmin = !!profile?.is_admin;
  const { openTask } = useTaskSheet(); // the ONE task editor, on the spine
  const { setSection } = useOperatorSection(); // for the Money pointer below
  const [manage, setManage] = useState<Milestone | null>(null);   // milestone open in the manage sheet
  // The initiative itself, opened (2026-10-04): its date, status and name had no editor anywhere —
  // only Finish, which completes every task under it. components/InitiativeSheet is that editor.
  const [openInit, setOpenInit] = useState<string | null>(null);
  // A PAST-DATE INITIATIVE FOLDS (2026-10-07, Ryan: "Ewww"). The July launch sat open at the top of
  // Command 65 days after its date — nine milestones in red, a goal picker, the Finish button — and
  // pushed the company's state below the fold. Past its date by two weeks, an initiative shows its
  // line and its progress and asks the one question it now raises (finish it, move the date, or look
  // at what's left); its milestones open on a tap. Nothing is taken away.
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set());
  const unfold = (id: string) => setUnfolded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // THE TEAM'S WEEK IS ONE LINE (2026-10-07). This Week, the overdue half of Blockers and Done this
  // week listed the same tasks My Day lists — for a two-founder crew, Command and My Day read as the
  // same screen twice. Command says the counts in one line and opens the lists on a tap; My Day stays
  // where you do them.
  const [weekOpen, setWeekOpen] = useState(false);

  // 0350 adds initiative_milestones.workstream_id. Until it is pasted the milestones are asked for
  // again without it, and the board knows (linkable: false): the pick is still offered and a
  // milestone keeps the workstream's name, which 0350 links when it lands. The forgiveness is
  // lib/schemaSkew's one condition; every other error still throws.
  const milesRead = useCallback(async () => {
    // arrives-with: 0350
    const full = await supabase!.from("initiative_milestones").select("id, initiative_id, title, due_on, done, workstream, workstream_id, sort").order("sort");
    if (!full.error || !isMissingColumn(full.error)) return { ...full, linkable: true };
    const prior = await supabase!.from("initiative_milestones").select("id, initiative_id, title, due_on, done, workstream, sort").order("sort");
    return { ...prior, linkable: false };
  }, []);

  const loader = useCallback(async (): Promise<BoardData> => {
    if (!supabase) return EMPTY_BOARD;
    const today = todayKey(), wk = weekAheadKey(), wago = weekAgoISO();
    const [ini, mil, lnk, tThis, eThis, inc, tOver, eOver, tDone, eDone] = await Promise.all([
      supabase.from("initiatives").select("id, title, summary, target_date, status, emoji").neq("status", "done").order("target_date", { nullsFirst: false }),
      milesRead(),
      supabase.from("initiative_milestone_links").select("initiative_id, milestone_id"),
      supabase.from("todos").select("id, title, due_on").eq("done", false).not("due_on", "is", null).gte("due_on", today).lte("due_on", wk),
      supabase.from("event_tasks").select("id, label, due_at").eq("done", false).not("due_at", "is", null).gte("due_at", today).lte("due_at", `${wk}T23:59:59`),
      supabase.from("incident_log").select("id, problem, severity, created_at").eq("resolved", false).eq("severity", "blocker").order("created_at", { ascending: false }),
      // The two overdue buckets had no lower date bound and no limit, so they could only grow
      // for the life of the install. Oldest-first with a cap: the point of an overdue list is
      // the oldest thing on it, and 200 of them is already a different conversation.
      supabase.from("todos").select("id, title, due_on").eq("done", false).not("due_on", "is", null).lt("due_on", today).order("due_on").limit(200),
      supabase.from("event_tasks").select("id, label, due_at").eq("done", false).not("due_at", "is", null).lt("due_at", today).order("due_at").limit(200),
      supabase.from("todos").select("id, title, due_on, done_at").eq("done", true).gte("done_at", wago),
      supabase.from("event_tasks").select("id, label, due_at, done_at").eq("done", true).gte("done_at", wago),
    ]);
    // 0263 additions ride a second Promise.all so the 0262-era harness order above stays byte-stable.
    const [gls, glnk, pf] = await Promise.all([
      supabase.from("goals").select("id, title, checkin_status, current_value, target_value, unit").eq("status", "active"),
      supabase.from("initiative_goals").select("initiative_id, goal_id"),
      // The portfolio a milestone is filed to — the same rows, in the same order, OsRegistry lists.
      supabase.from("os_workstreams").select("id, name, owner, owner_user_id, status, blocker, sort").order("sort"),
    ]);
    const firstErr = [ini, mil, lnk, tThis, eThis, inc, tOver, eOver, tDone, eDone].find((r) => r.error)?.error;
    if (firstErr) throw new Error(firstErr.message);
    return {
      inits: (ini.data as Initiative[]) ?? [],
      miles: (mil.data as Milestone[]) ?? [],
      links: (lnk.data as { initiative_id: string; milestone_id: string }[]) ?? [],
      goals: (gls.data as GoalLite[]) ?? [],
      goalLinks: (glnk.data as { initiative_id: string; goal_id: string }[]) ?? [],
      week: [...toWork(tThis.data ?? [], "todo"), ...toWork(eThis.data ?? [], "task")].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")),
      incidents: (inc.data as Incident[]) ?? [],
      overdue: [...toWork(tOver.data ?? [], "todo"), ...toWork(eOver.data ?? [], "task")].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")),
      done: [...toWork(tDone.data ?? [], "todo"), ...toWork(eDone.data ?? [], "task")],
      streams: pf.error ? [] : ((pf.data as PortfolioStream[]) ?? []),
      streamsErr: pf.error ? pf.error.message : null,
      linkable: mil.linkable,
    };
  }, [milesRead]);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  // os_workstreams too: a workstream renamed in the portfolio above renames its milestones' chips.
  useRealtimeTable(["initiatives", "initiative_milestones", "initiative_milestone_links", "initiative_goals", "goals", "todos", "event_tasks", "incident_log", "os_workstreams"], reload);

  // 0263 — link/unlink the goals a program serves (admin; the junction cascades on either delete).
  const linkGoal = async (initiativeId: string, goalId: string) => {
    if (!supabase || !isAdmin || !goalId) return;
    const { error } = await supabase.from("initiative_goals").insert({ initiative_id: initiativeId, goal_id: goalId });
    if (error) toast(`Couldn't link — ${error.message}`, "error"); else reload();
  };
  const unlinkGoal = async (initiativeId: string, goalId: string) => {
    if (!supabase || !isAdmin) return;
    const { error } = await supabase.from("initiative_goals").delete().eq("initiative_id", initiativeId).eq("goal_id", goalId);
    if (error) toast(`Couldn't unlink — ${error.message}`, "error"); else reload();
  };

  const miles = board.data?.miles ?? [];
  const links = board.data?.links ?? [];
  const mById = useMemo(() => new Map(miles.map((m) => [m.id, m])), [miles]);
  // Placement now comes from the many-to-many links (a milestone can sit under several initiatives).
  // Any milestone with no link at all still shows under its created-under initiative_id (defensive).
  const milesByInit = useMemo(() => {
    const m = new Map<string, Milestone[]>();
    const push = (initId: string, ms: Milestone) => (m.get(initId) ?? m.set(initId, []).get(initId)!).push(ms);
    for (const l of links) { const ms = mById.get(l.milestone_id); if (ms) push(l.initiative_id, ms); }
    for (const ms of miles) { if (ms.initiative_id && !links.some((l) => l.milestone_id === ms.id)) push(ms.initiative_id, ms); }
    return m;
  }, [links, miles, mById]);

  // Mutations reload() from the server rather than patching local state — the fetched board now lives
  // inside useAsyncData, which has no setter of its own (by design: it's the one place status/error live).
  // Every write below says when it fails (2026-10-05, the form audit): the milestone writes awaited
  // and dropped their errors, so a refused check-off, tie or delete looked done until the reload put
  // it back. The sheet's own save is components/MilestoneSheet's, and says so the same way.
  const toggleMile = async (m: Milestone) => {
    if (!supabase || !isAdmin) return;
    const { error } = await supabase.from("initiative_milestones").update({ done: !m.done, done_at: !m.done ? new Date().toISOString() : null }).eq("id", m.id);
    if (error) toast(`Couldn't ${m.done ? "reopen" : "check off"} “${m.title}” — ${error.message}`, "error");
    reload();
  };
  const createInit = async (title: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("initiatives").insert({ title, status: "active", created_by: user?.id ?? null });
    if (error) toast(`Couldn't add — ${error.message}`, "error"); else { toast("Initiative added"); reload(); }
  };
  // Finish the whole initiative — the true cascade: completes every open task assigned to it (both
  // engines) and closes the program. Admin-only, with a scope-explicit confirm (this is the deliberate
  // "finish an initiative → finishes all its tasks" home; the Prep board only clears what it shows).
  const finishInit = async (it: Initiative) => {
    if (!supabase || !isAdmin) return;
    if (!(await confirm({ title: `Finish “${it.title}”?`, body: "This completes every open task assigned to it and closes the initiative.", confirmLabel: "Finish it" }))) return;
    const { error } = await completeInitiative(it.id, user?.id);
    if (error) { toast(`Couldn't finish — ${error}`, "error"); return; }
    toast(`${it.title} finished — its tasks are done.`); reload();
  };
  const addMilestone = async (initId: string, title: string) => {
    if (!supabase) return;
    const n = (milesByInit.get(initId) ?? []).length;
    const { data, error } = await supabase.from("initiative_milestones").insert({ initiative_id: initId, title, sort: n }).select("id").single();
    if (error || !data) { toast(`Couldn't add — ${error?.message ?? "error"}`, "error"); return; }
    const { error: tie } = await supabase.from("initiative_milestone_links").insert({ initiative_id: initId, milestone_id: (data as { id: string }).id });
    // It still shows under the initiative it was made in (milesByInit's created-under fallback).
    if (tie) toast(`Added, but not tied to the initiative — ${tie.message}`, "error");
    reload();
  };
  // Tie/untie a milestone to an initiative — this is BOTH "move" and "tie to multiple" in one control.
  const toggleLink = async (mId: string, initId: string, on: boolean) => {
    if (!supabase) return;
    const { error } = on
      ? await supabase.from("initiative_milestone_links").insert({ initiative_id: initId, milestone_id: mId })
      : await supabase.from("initiative_milestone_links").delete().eq("initiative_id", initId).eq("milestone_id", mId);
    if (error) toast(`Couldn't ${on ? "tie it to" : "untie it from"} that initiative — ${error.message}`, "error");
    reload();
  };
  const deleteMile = async (m: Milestone) => {
    if (!supabase) return;
    if (!(await confirm({ title: `Delete “${m.title}”?`, confirmLabel: "Delete", danger: true }))) return;
    const { error } = await supabase.from("initiative_milestones").delete().eq("id", m.id);   // cascades its links
    if (error) { toast(`Couldn't delete “${m.title}” — ${error.message}`, "error"); return; }
    setManage(null); reload();
  };

  return (
    <AsyncSection state={board} isEmpty={() => false} loadingLabel="Loading the board…" errorTitle="Couldn't load the board" emptyTitle="Nothing here yet">
      {(data) => {
        const cap = (a: Work[], n = 8) => ({ shown: a.slice(0, n), more: Math.max(0, a.length - n) });
        const wk = cap(data.week), ov = cap(data.overdue), dn = cap(data.done, 6);
        return (
          <div className="cmd">
            {/* ── Initiatives · the launch ── */}
            <SectionHeader label="Initiatives" annotation="the launch" />
            {data.inits.length === 0 && !isAdmin && <EmptyState title="No active initiatives" />}
            {data.inits.map((it) => {
              const ms = (milesByInit.get(it.id) ?? []).slice().sort((a, b) => a.sort - b.sort);
              const doneN = ms.filter((m) => m.done).length;
              const pct = ms.length ? Math.round((doneN / ms.length) * 100) : 0;
              const cd = it.target_date ? countdown(it.target_date) : "";
              const late = it.target_date ? daysTo(it.target_date) < 0 : false;
              const folded = !!it.target_date && daysTo(it.target_date) < -14 && !unfolded.has(it.id);
              return (
                <div className={`cmd-init${folded ? " folded" : ""}`} key={it.id}>
                  <div className="k-rows">
                    <InfoRow
                      name={<>{it.emoji ? `${it.emoji} ` : ""}{it.title}</>}
                      sub={it.summary || undefined}
                      trailing={it.target_date ? <span className={`cmd-cd${late ? " late" : ""}`}>{dnice(it.target_date)} · {cd}</span> : undefined}
                      onClick={() => setOpenInit(it.id)}
                      ariaLabel={`Open ${it.title}`}
                    />
                  </div>
                  <div className="cmd-prog"><span className="cmd-prog-bar"><span style={{ width: `${pct}%` }} /></span><span className="cmd-prog-n">{doneN}/{ms.length} · {pct}%</span></div>
                  {folded && (
                    <div className="flex flex-col gap-2.5 mt-0.5">
                      <p className="m-0 font-sans text-[13.5px] leading-normal text-cream-muted">{-daysTo(it.target_date!)} days past its date with {ms.length - doneN} of {ms.length} milestone{ms.length === 1 ? "" : "s"} open. Finish it, give it a new date, or look at what&rsquo;s left.</p>
                      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2">
                        <button type="button" className="btn-sec px-4 py-[9px] text-[13.5px]" onClick={() => unfold(it.id)}>Show the milestones</button>
                        {isAdmin && <button type="button" className="btn-ter" onClick={() => setOpenInit(it.id)}>New date</button>}
                      </div>
                    </div>
                  )}
                  {!folded && <>
                  {/* 0263 — the goals this program serves: one story, program → numbers. */}
                  {(() => {
                    const served = data.goalLinks.filter((l) => l.initiative_id === it.id)
                      .map((l) => data.goals.find((g) => g.id === l.goal_id)).filter(Boolean) as GoalLite[];
                    const linkable = data.goals.filter((g) => !served.some((s) => s.id === g.id));
                    if (!served.length && !isAdmin) return null;
                    return (
                      <div className="cmd-serves">
                        <span className="cmd-serves-k">Serves</span>
                        {served.map((g) => (
                          <span key={g.id} className={`cmd-goalchip${g.checkin_status === "at_risk" ? " risk" : ""}`}>
                            🎯 {g.title} · {Math.min(100, Math.round((Number(g.current_value) / Math.max(1, Number(g.target_value))) * 100))}%
                            {isAdmin && <button type="button" onClick={() => unlinkGoal(it.id, g.id)} aria-label={`Unlink ${g.title}`}>×</button>}
                          </span>
                        ))}
                        {served.length === 0 && <span className="cmd-serves-none">no goal linked yet</span>}
                        {isAdmin && linkable.length > 0 && (
                          <select className="cmd-goalsel" value="" onChange={(e) => linkGoal(it.id, e.target.value)} aria-label="Link a goal this initiative serves">
                            <option value="">+ goal</option>
                            {linkable.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                          </select>
                        )}
                      </div>
                    );
                  })()}
                  {ms.length > 0 && (
                    <div className="k-rows">
                      {ms.map((m) => {
                        const mlate = !m.done && m.due_on && daysTo(m.due_on) < 0;
                        const ties = links.filter((l) => l.milestone_id === m.id).length;
                        // The workstream by its portfolio name; words that link to nothing are marked so.
                        const ws = milestoneStream(m, data.streams);
                        const trailing = (ties > 1 || ws || m.due_on || isAdmin) ? (
                          <>
                            {ties > 1 && <span className="cmd-tie" title={`Tied to ${ties} initiatives`}>⧉{ties}</span>}
                            {ws && <span className={`cmd-ws${ws.linked ? "" : " loose"}`} title={ws.linked ? undefined : "Not linked to a workstream"}>{ws.text}</span>}
                            {m.due_on && <span className={`cmd-mile-due${mlate ? " late" : ""}`}>{dnice(m.due_on)}</span>}
                            {isAdmin && <button type="button" className="cmd-mile-mng" onClick={() => setManage(m)} aria-label="Manage milestone">⋯</button>}
                          </>
                        ) : undefined;
                        return (
                          <InfoRow
                            key={m.id}
                            name={
                              <>
                                <span className={`cmd-check${m.done ? " on" : ""}`} aria-hidden>{m.done ? <Icon name="check" /> : ""}</span>
                                <span className="cmd-mile-t" style={{ fontWeight: 400, ...(m.done ? { textDecoration: "line-through", color: "var(--cream-m)" } : {}) }}>{m.title}</span>
                              </>
                            }
                            trailing={trailing}
                            bodyClick={isAdmin ? () => toggleMile(m) : undefined}
                            ariaLabel={m.title}
                          />
                        );
                      })}
                    </div>
                  )}
                  {isAdmin && <InlineCreate label="+ Milestone" placeholder="Milestone" className="cmd-add hit-y-44" onCreate={(t) => addMilestone(it.id, t)} />}
                  {late && unfolded.has(it.id) && <button type="button" className="btn-ter flex mt-1" onClick={() => unfold(it.id)}>Fold it back</button>}
                  </>}
                  {isAdmin && <button type="button" className="cmd-finish" onClick={() => finishInit(it)}><Icon name="check" /> Finish initiative — completes every task under it</button>}
                </div>
              );
            })}
            {isAdmin && <InlineCreate label="+ New initiative" placeholder="Initiative name" className="cmd-add big hit-y-44" onCreate={createInit} />}

            {/* ── Launch readiness · go/no-go ── */}
            <LaunchReadiness />

            {/* ── Blockers — the company's: an incident, a goal flagged at risk ── */}
            <SectionHeader label="Blockers" annotation="clear these first" />
            {data.incidents.length === 0 && data.goals.filter((g) => g.checkin_status === "at_risk").length === 0 ? <EmptyState title="Nothing blocked" /> : (
              <div className="k-rows">
                {/* 0263 — a goal its owner flagged at risk IS a blocker; it sits with the rest. */}
                {data.goals.filter((g) => g.checkin_status === "at_risk").map((g) => (
                  <InfoRow key={`risk-${g.id}`} name={<>🎯 {g.title} — <span className="cmd-risklab">at risk</span></>} trailing={<span className="cmd-row-due late">check-in</span>} onClick={() => document.getElementById("goals")?.scrollIntoView({ behavior: "smooth" })} ariaLabel={`At-risk goal: ${g.title}`} />
                ))}
                {data.incidents.map((i) => <InfoRow key={i.id} name={<><Icon name="warning" /> {i.problem}</>} />)}
              </div>
            )}

            {/* ── The team's week — one line; the lists open on a tap ── */}
            <SectionHeader label="The team's week" annotation="across the crew" />
            <button type="button" className={`cmd-week${weekOpen ? " open" : ""}`} onClick={() => setWeekOpen((o) => !o)} aria-expanded={weekOpen}>
              <span><b className="text-cream font-bold tabular-nums">{data.week.length}</b> due in the next 7 days</span>
              <span className={data.overdue.length ? "late" : undefined}><b className="text-cream font-bold tabular-nums">{data.overdue.length}</b> overdue</span>
              <span><b className="text-cream font-bold tabular-nums">{data.done.length}</b> done this week</span>
              <span className={`ml-auto ev-chev${weekOpen ? " open" : ""}`} aria-hidden="true">›</span>
            </button>
            {weekOpen && (
              <div className="flex flex-col gap-3.5 mb-2.5">
                {ov.shown.length > 0 && (
                  <div className="k-rows">
                    <div className="font-sans font-bold text-[11.5px] tracking-[.06em] uppercase text-cream-muted px-0.5 pt-0.5 pb-1.5">Overdue</div>
                    {ov.shown.map((w) => (
                      <InfoRow
                        key={`ov-${w.src}-${w.id}`}
                        name={w.title}
                        trailing={<span className="cmd-row-due late">{dnice(w.due)} · overdue</span>}
                        onClick={() => openTask(w.id, w.src === "task" ? "event" : "todo")}
                        ariaLabel={`Open task: ${w.title}`}
                      />
                    ))}
                    {ov.more > 0 && <div className="cmd-more">+{ov.more} more overdue</div>}
                  </div>
                )}
                <div className="k-rows">
                  <div className="font-sans font-bold text-[11.5px] tracking-[.06em] uppercase text-cream-muted px-0.5 pt-0.5 pb-1.5">Due in the next 7 days</div>
                  {wk.shown.length === 0 ? <div className="cmd-more">Nothing due in the next 7 days</div> : wk.shown.map((w) => (
                    <InfoRow
                      key={`${w.src}-${w.id}`}
                      name={w.title}
                      trailing={<span className="cmd-row-due">{dnice(w.due)}</span>}
                      onClick={() => openTask(w.id, w.src === "task" ? "event" : "todo")}
                      ariaLabel={`Open task: ${w.title}`}
                    />
                  ))}
                  {wk.more > 0 && <div className="cmd-more">+{wk.more} more</div>}
                </div>
                {dn.shown.length > 0 && (
                  <div className="k-rows">
                    <div className="font-sans font-bold text-[11.5px] tracking-[.06em] uppercase text-cream-muted px-0.5 pt-0.5 pb-1.5">Done this week</div>
                    {dn.shown.map((w) => <InfoRow key={`dn-${w.src}-${w.id}`} name={<span className="line-through text-cream-dim">{w.title}</span>} />)}
                    {dn.more > 0 && <div className="cmd-more">+{dn.more} more done</div>}
                  </div>
                )}
              </div>
            )}

            {/* ── Money ── a pointer, not a second KPI strip (2026-07-30 redundancy audit): the
                full MoneyKpis grid already opens the Money section — mounting it here duplicated
                all five tiles, and for event managers (Command is canManage, the money queries are
                admin-gated) they rendered as a block of dead "—"s. One strip, one home.
                And the pointer itself is an admin's (2026-10-04): Money is not a section an event
                manager can open, so for them it was a link to the screen they are already on. */}
            {isAdmin && <button type="button" className="adm-golink hit-y-44" onClick={() => setSection("money")}>Money — the live glance · Money ›</button>}

            {manage && (
              <MilestoneSheet
                key={manage.id}
                m={manage}
                streams={data.streams}
                streamsErr={data.streamsErr}
                linkable={data.linkable}
                initiatives={data.inits}
                linkedIds={links.filter((l) => l.milestone_id === manage.id).map((l) => l.initiative_id)}
                onToggleLink={(initId, on) => toggleLink(manage.id, initId, on)}
                onDelete={() => deleteMile(manage)}
                onSaved={reload}
                onClose={() => setManage(null)}
              />
            )}
            {openInit && <InitiativeSheet id={openInit} onClose={() => setOpenInit(null)} onSaved={reload} />}
          </div>
        );
      }}
    </AsyncSection>
  );
}
