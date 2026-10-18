"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStable } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import LaunchReadiness, { useLaunchReadiness, type LaunchVerdict } from "./LaunchReadiness";
import { CommandFold } from "./CommandFold";
import { useOperatorSection } from "./OperatorNav";
import { prepHandoffKey, prepHandoffValue } from "@/lib/eventRecord";
import { useTaskSheet } from "./TaskSheet";
import { completeInitiative } from "@/lib/tasks";
import { SectionHeader, InfoRow } from "@/components/kit";
import InlineCreate from "./InlineCreate";
import InitiativeSheet from "./InitiativeSheet";
import Icon from "@/components/Icon";
import { addDays, localToday } from "@/lib/dates";
import { useConfirm } from "@/components/ConfirmSheet";
import dynamic from "next/dynamic";
import { type PortfolioStream, milestoneStream } from "@/lib/portfolio";
import Said from "./Said";
import { plainFailure, failureWords } from "@/lib/failureWords";

// The manage sheet is an admin's, opened from a milestone's ⋯ — loaded then, not with the board.
const MilestoneSheet = dynamic(() => import("./MilestoneSheet"), { ssr: false });

// COMMAND BOARD — the shared war room both founders see: the launch initiatives with a countdown and
// milestone progress, then This Week · Blockers · Done · Money in one glance. This is the digital twin
// of the physical magnetic board — one screen that answers "are we on track?" instead of a text thread.
// Reads across BOTH task engines (todos + event_tasks) + incidents + initiatives via useAsyncData — a
// failed query now surfaces as a real error state (AsyncSection) instead of silently rendering "Nothing
// blocked 🟢" on a request that actually errored. Admins (the owners) manage initiatives + milestones.
// ONE ROW FOR THE LAUNCH (2026-10-12, the Command audit, approved). At rest the board is the team's week
// and one row, Initiatives: how the soonest one stands, its milestones and the launch's verdict, in a line
// (components/CommandFold). The row opens the initiatives and the launch's gates as their own screen, as
// they were. The Blockers block is gone into the lines where each blocker is acted on: a stream's on its
// row in the portfolio, a goal at risk on the Goals row, an open blocking incident in the team's week.
type Initiative = { id: string; title: string; summary: string | null; target_date: string | null; status: string; emoji: string | null };
// workstream_id (0350) is the portfolio workstream the milestone is filed to; workstream keeps the
// words — the stream's name, written by the database when the link is set, or words from before.
type Milestone = { id: string; initiative_id: string; title: string; due_on: string | null; done: boolean; workstream: string | null; workstream_id?: string | null; sort: number };
// `who` is the assignee (2026-10-12): the overdue list names the person each late task waits on.
type Work = { id: string; title: string; due: string | null; src: "todo" | "task"; who: string | null };
type WorkRow = { id: string; title?: string | null; label?: string | null; due_on?: string | null; due_at?: string | null; assignee?: string | null };
// event_id / stop_id (2026-10-12): an open blocking incident opens the prep page whose log resolves it.
type Incident = { id: string; problem: string; severity: string; created_at: string; event_id: string | null; stop_id: string | null };
// 0263 — programs ↔ outcomes: the goals an initiative serves (an at-risk goal is named on Command's Goals row since 2026-10-12).
type GoalLite = { id: string; title: string; checkin_status: string | null; current_value: number; target_value: number; unit: string | null };
type BoardData = {
  inits: Initiative[]; miles: Milestone[]; links: { initiative_id: string; milestone_id: string }[];
  week: Work[]; incidents: Incident[]; overdue: Work[]; done: Work[];
  goals: GoalLite[]; goalLinks: { initiative_id: string; goal_id: string }[];
  // The portfolio a milestone is filed to (0350). A failed read is said in the pick, not thrown:
  // the board is the launch, and one list it can do without must not take it down.
  streams: PortfolioStream[]; streamsErr: string | null; linkable: boolean;
  // Who the late tasks wait on, by id (2026-10-12). Soft like the portfolio: a failed read is said
  // under the list, and the rows still open their tasks.
  names: Record<string, string>; namesErr: string | null;
};
const EMPTY_BOARD: BoardData = { inits: [], miles: [], links: [], week: [], incidents: [], overdue: [], done: [], goals: [], goalLinks: [], streams: [], streamsErr: null, linkable: false, names: {}, namesErr: null };

const todayKey = localToday;
const weekAheadKey = () => addDays(localToday(), 7);
const weekAgoISO = () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString(); };
const daysTo = (iso: string) => Math.round((new Date(`${iso}T12:00:00`).getTime() - Date.now()) / 864e5);
const countdown = (iso: string | null) => { if (!iso) return ""; const d = daysTo(iso); return d > 1 ? `${d} days left` : d === 1 ? "tomorrow" : d === 0 ? "today" : `${-d}d overdue`; };
const dnice = (iso: string | null) => iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
const localYMD = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const toWork = (rows: readonly WorkRow[] | null, src: "todo" | "task"): Work[] => (rows ?? []).map((r) => ({ id: r.id, title: r.title ?? r.label ?? "—", due: r.due_on ?? (r.due_at ? localYMD(String(r.due_at)) : null), src, who: r.assignee ?? null }));
// The launch's verdict, in the Initiatives row's words (components/LaunchReadiness decides it).
const VERDICT_WORDS: Record<LaunchVerdict, string | null> = { "no-go": "readiness: no-go", "at-risk": "readiness at risk", go: "readiness: go", none: null };

export default function CommandBoard() {
  const confirm = useConfirm();
  const { toast } = useAppStable();
  const { user, profile } = useAuth();
  const isAdmin = !!profile?.is_admin;
  const { openTask } = useTaskSheet(); // the ONE task editor, on the spine
  const { setSection } = useOperatorSection();
  // The launch's gates (components/LaunchReadiness): read once, for the Initiatives row's verdict and its screen.
  const launch = useLaunchReadiness();
  // An open blocking incident is resolved in its event's or stop's incident log, on its prep page (Readiness).
  const openPrep = (i: Incident) => {
    const id = i.event_id ?? i.stop_id;
    if (!id) return;
    try { localStorage.setItem(prepHandoffKey, prepHandoffValue(i.event_id ? "event" : "stop", id)); } catch { /* ignore */ }
    setSection("prep");
  };
  const [manage, setManage] = useState<Milestone | null>(null);   // milestone open in the manage sheet
  // The initiative itself, opened (2026-10-04): its date, status and name had no editor anywhere —
  // only Finish, which completes every task under it. components/InitiativeSheet is that editor.
  const [openInit, setOpenInit] = useState<string | null>(null);
  // A READ VIEW AT REST (2026-10-10, the Command fold): an initiative reads — its date, its progress, the goals it
  // serves, its milestones (still checked off with a tap) — and Manage opens the board's editors on that one
  // initiative: link a goal, a milestone's ⋯, + Milestone, Finish. They stood open on every initiative.
  const [managing, setManaging] = useState<string | null>(null);
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
  //
  // THE TEAM'S LATE WORK IS HERE, BY NAME (2026-10-12, the My Day audit, approved). My Day kept other
  // people's late tasks for anyone who manages — "Not attached to an event or stop", with no name — and
  // in the audit's rebuild six of the eleven late things on the owner's My Day were somebody else's. My
  // Day is yours now; this count is where a manager finds everybody's. Its list names who each task is
  // waiting on and opens the task, and it is the whole list: "+N more overdue" was a line, not a door.
  const [weekOpen, setWeekOpen] = useState(false);
  const [allOverdue, setAllOverdue] = useState(false);

  // The milestones with their workstream's link (0350: initiative_milestones.workstream_id) — linkable: a milestone can be
  // linked to a workstream. (Before 0350 was pasted they were asked for again without it; R14 took that path out.)
  const milesRead = useCallback(async () => {
    const full = await supabase!.from("initiative_milestones").select("id, initiative_id, title, due_on, done, workstream, workstream_id, sort").order("sort");
    return { ...full, linkable: true };
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
      supabase.from("incident_log").select("id, problem, severity, created_at, event_id, stop_id").eq("resolved", false).eq("severity", "blocker").order("created_at", { ascending: false }),
      // The two overdue buckets had no lower date bound and no limit, so they could only grow
      // for the life of the install. Oldest-first with a cap: the point of an overdue list is
      // the oldest thing on it, and 200 of them is already a different conversation.
      supabase.from("todos").select("id, title, due_on, assignee").eq("done", false).not("due_on", "is", null).lt("due_on", today).order("due_on").limit(200),
      supabase.from("event_tasks").select("id, label, due_at, assignee").eq("done", false).not("due_at", "is", null).lt("due_at", today).order("due_at").limit(200),
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
    const overdue = [...toWork(tOver.data as WorkRow[] | null, "todo"), ...toWork(eOver.data as WorkRow[] | null, "task")].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
    // The names of the people the late tasks wait on — only theirs, by id. Profiles answer an owner or
    // an admin (0003); for anyone else the row says "someone on the crew" rather than guess.
    const ids = [...new Set(overdue.map((w) => w.who).filter((x): x is string => !!x))];
    const ppl = ids.length ? await supabase.from("profiles").select("id, display_name").in("id", ids) : null;
    const names: Record<string, string> = {};
    for (const p of ((ppl?.data as { id: string; display_name: string | null }[] | null) ?? [])) if (p.display_name?.trim()) names[p.id] = p.display_name.trim();
    return {
      inits: (ini.data as Initiative[]) ?? [],
      miles: (mil.data as Milestone[]) ?? [],
      links: (lnk.data as { initiative_id: string; milestone_id: string }[]) ?? [],
      goals: (gls.data as GoalLite[]) ?? [],
      goalLinks: (glnk.data as { initiative_id: string; goal_id: string }[]) ?? [],
      week: [...toWork(tThis.data as WorkRow[] | null, "todo"), ...toWork(eThis.data as WorkRow[] | null, "task")].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")),
      incidents: (inc.data as Incident[]) ?? [],
      overdue,
      done: [...toWork(tDone.data as WorkRow[] | null, "todo"), ...toWork(eDone.data as WorkRow[] | null, "task")],
      streams: pf.error ? [] : ((pf.data as PortfolioStream[]) ?? []),
      streamsErr: pf.error ? plainFailure(pf.error) : null,
      linkable: mil.linkable,
      names,
      namesErr: ppl?.error ? plainFailure(ppl.error) : null,
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
    if (error) toast(failureWords(error, "Couldn't link"), "error"); else reload();
  };
  const unlinkGoal = async (initiativeId: string, goalId: string) => {
    if (!supabase || !isAdmin) return;
    const { error } = await supabase.from("initiative_goals").delete().eq("initiative_id", initiativeId).eq("goal_id", goalId);
    if (error) toast(failureWords(error, "Couldn't unlink"), "error"); else reload();
  };

  // Memoised so the two maps below re-derive when the board does, not on every render.
  const miles = useMemo(() => board.data?.miles ?? [], [board.data]);
  const links = useMemo(() => board.data?.links ?? [], [board.data]);
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
    if (error) toast(`Couldn't ${m.done ? "reopen" : "check off"} “${m.title}” — ${plainFailure(error)}`, "error");
    reload();
  };
  const createInit = async (title: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("initiatives").insert({ title, status: "active", created_by: user?.id ?? null });
    if (error) toast(failureWords(error, "Couldn't add"), "error"); else { toast("Initiative added"); reload(); }
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
    if (error || !data) { toast(`Couldn't add — ${error ? plainFailure(error) : "nothing came back"}`, "error"); return; }
    const { error: tie } = await supabase.from("initiative_milestone_links").insert({ initiative_id: initId, milestone_id: (data as { id: string }).id });
    // It still shows under the initiative it was made in (milesByInit's created-under fallback).
    if (tie) toast(failureWords(tie, "Added, but not tied to the initiative"), "error");
    reload();
  };
  // Tie/untie a milestone to an initiative — this is BOTH "move" and "tie to multiple" in one control.
  const toggleLink = async (mId: string, initId: string, on: boolean) => {
    if (!supabase) return;
    const { error } = on
      ? await supabase.from("initiative_milestone_links").insert({ initiative_id: initId, milestone_id: mId })
      : await supabase.from("initiative_milestone_links").delete().eq("initiative_id", initId).eq("milestone_id", mId);
    if (error) toast(`Couldn't ${on ? "tie it to" : "untie it from"} that initiative — ${plainFailure(error)}`, "error");
    reload();
  };
  const deleteMile = async (m: Milestone) => {
    if (!supabase) return;
    if (!(await confirm({ title: `Delete “${m.title}”?`, confirmLabel: "Delete", danger: true }))) return;
    const { error } = await supabase.from("initiative_milestones").delete().eq("id", m.id);   // cascades its links
    if (error) { toast(`Couldn't delete “${m.title}” — ${plainFailure(error)}`, "error"); return; }
    setManage(null); reload();
  };

  return (
    <AsyncSection state={board} isEmpty={() => false} loadingLabel="Loading the board…" errorTitle="Couldn't load the board" emptyTitle="Nothing here yet">
      {(data) => {
        const cap = (a: Work[], n = 8) => ({ shown: a.slice(0, n), more: Math.max(0, a.length - n) });
        const wk = cap(data.week), ov = cap(data.overdue, allOverdue ? data.overdue.length : 8), dn = cap(data.done, 6);
        // Who a late task is waiting on, in words: their name, nobody yet, or — when this role cannot read
        // names — someone on the crew. Never a guess.
        const whoOf = (w: Work) => (!w.who ? "Nobody's yet" : data.names[w.who] ?? "Someone on the crew");
        // The Initiatives row's one line: the soonest initiative (the list is by date, the late first), how its
        // date stands, its open milestones, and the launch's verdict when it is the launch being gated.
        const lead = data.inits[0] ?? null;
        const leadMs = lead ? (milesByInit.get(lead.id) ?? []) : [];
        const leadOpen = leadMs.filter((m) => !m.done).length;
        const leadDays = lead?.target_date ? daysTo(lead.target_date) : null;
        const leadWhen = leadDays == null ? "no date" : leadDays < 0 ? `${-leadDays} day${leadDays === -1 ? "" : "s"} past its date`
          : leadDays === 0 ? "due today" : leadDays === 1 ? "due tomorrow" : `${leadDays} days left`;
        const leadName = lead ? `${lead.emoji ? `${lead.emoji} ` : ""}${lead.title} — ` : "";
        const leadRest = [leadMs.length ? `${leadOpen} of ${leadMs.length} milestone${leadMs.length === 1 ? "" : "s"} open` : null,
          lead && launch.launch?.id === lead.id ? VERDICT_WORDS[launch.verdict] : null].filter(Boolean).map((s) => ` · ${s}`).join("");
        return (
          <div className="cmd">
            {/* ── The team's week — one line; the lists open on a tap ── */}
            <SectionHeader label="The team's week" annotation="across the crew" />
            <button type="button" className={`cmd-week${weekOpen ? " open" : ""}`} onClick={() => setWeekOpen((o) => !o)} aria-expanded={weekOpen}>
              <span><b className="text-cream font-bold tabular-nums">{data.week.length}</b> due in the next 7 days</span>
              <span className={data.overdue.length ? "late" : undefined}><b className="text-cream font-bold tabular-nums">{data.overdue.length}</b> overdue</span>
              <span><b className="text-cream font-bold tabular-nums">{data.done.length}</b> done this week</span>
              {data.incidents.length > 0 && <span className="late"><b className="text-cream font-bold tabular-nums">{data.incidents.length}</b> blocking</span>}
              <span className={`ml-auto ev-chev${weekOpen ? " open" : ""}`} aria-hidden="true">›</span>
            </button>
            {weekOpen && (
              <div className="flex flex-col gap-3.5 mb-2.5">
                {/* AN OPEN BLOCKING INCIDENT IS THE WEEK'S (2026-10-12, the Command audit). It sat in a Blockers block of
                    its own, a row that opened nothing. It is counted in the line above, listed first here, and opens
                    the prep page whose incident log resolves it. */}
                {data.incidents.length > 0 && (
                  <div className="k-rows">
                    <div className="font-sans font-bold text-caption tracking-[.06em] uppercase text-cream-muted px-0.5 pt-0.5 pb-1.5">Blocking</div>
                    {data.incidents.map((i) => (
                      <InfoRow
                        key={i.id}
                        name={<><Icon name="warning" /> {i.problem}</>}
                        sub={`Logged ${dnice(localYMD(i.created_at))}${i.event_id ? " at an event" : i.stop_id ? " at a truck stop" : ""}`}
                        onClick={i.event_id || i.stop_id ? () => openPrep(i) : undefined}
                        ariaLabel={i.event_id || i.stop_id ? `Blocking: ${i.problem} — opens the ${i.event_id ? "event" : "stop"}'s prep, where it is resolved` : undefined}
                      />
                    ))}
                  </div>
                )}
                {ov.shown.length > 0 && (
                  <div className="k-rows">
                    <div className="font-sans font-bold text-caption tracking-[.06em] uppercase text-cream-muted px-0.5 pt-0.5 pb-1.5">Overdue</div>
                    {ov.shown.map((w) => (
                      <InfoRow
                        key={`ov-${w.src}-${w.id}`}
                        name={w.title}
                        sub={whoOf(w)}
                        trailing={<span className="cmd-row-due late">{dnice(w.due)} · overdue</span>}
                        onClick={() => openTask(w.id, w.src === "task" ? "event" : "todo")}
                        ariaLabel={`Open task: ${w.title} — ${whoOf(w)}`}
                      />
                    ))}
                    {ov.more > 0 && (
                      <button type="button" className="owed-more" onClick={() => setAllOverdue(true)}>
                        Show the other {ov.more} overdue <span aria-hidden="true">›</span>
                      </button>
                    )}
                    {data.namesErr && <Said as="p" className="pnl-note">Who each one is waiting on couldn&rsquo;t be read just now — the list is still current.</Said>}
                  </div>
                )}
                <div className="k-rows">
                  <div className="font-sans font-bold text-caption tracking-[.06em] uppercase text-cream-muted px-0.5 pt-0.5 pb-1.5">Due in the next 7 days</div>
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
                    <div className="font-sans font-bold text-caption tracking-[.06em] uppercase text-cream-muted px-0.5 pt-0.5 pb-1.5">Done this week</div>
                    {dn.shown.map((w) => <InfoRow key={`dn-${w.src}-${w.id}`} name={<span className="line-through text-cream-dim">{w.title}</span>} />)}
                    {dn.more > 0 && <div className="cmd-more">+{dn.more} more done</div>}
                  </div>
                )}
              </div>
            )}

            {/* ── Initiatives · the launch — one row; the initiatives and the launch's gates are its own screen ── */}
            <CommandFold id="initiatives" title="Initiatives" count={data.inits.length}
              status={lead ? <>{leadName}<span className={leadDays != null && leadDays < 0 ? "text-warn" : undefined}>{leadWhen}</span>{leadRest}</> : "None active"}
              label={`Initiatives, ${data.inits.length} active${lead ? ` — ${leadName}${leadWhen}${leadRest}` : ""}. Opens the initiatives and the launch's readiness`}>
            <div className="cmd">
            {data.inits.length === 0 && !isAdmin && <EmptyState title="No active initiatives" />}
            {data.inits.map((it) => {
              const ms = (milesByInit.get(it.id) ?? []).slice().sort((a, b) => a.sort - b.sort);
              const doneN = ms.filter((m) => m.done).length;
              const pct = ms.length ? Math.round((doneN / ms.length) * 100) : 0;
              const cd = it.target_date ? countdown(it.target_date) : "";
              const late = it.target_date ? daysTo(it.target_date) < 0 : false;
              const folded = !!it.target_date && daysTo(it.target_date) < -14 && !unfolded.has(it.id);
              const mng = isAdmin && managing === it.id;
              return (
                <div className={`cmd-init${folded ? " folded" : ""}`} key={it.id}>
                  <div className="k-rows">
                    <InfoRow
                      name={<>{it.emoji ? `${it.emoji} ` : ""}{it.title}</>}
                      sub={it.summary || undefined}
                      trailing={it.target_date ? <span className={`k-tag txt fill${late ? " crit" : " gold"}`}>{dnice(it.target_date)} · {cd}</span> : undefined}
                      onClick={() => setOpenInit(it.id)}
                      ariaLabel={`Open ${it.title}`}
                    />
                  </div>
                  <div className="cmd-prog"><span className="cmd-prog-bar"><span style={{ width: `${pct}%` }} /></span><span className="cmd-prog-n">{doneN}/{ms.length} · {pct}%</span></div>
                  {folded && (
                    <div className="flex flex-col gap-2.5 mt-0.5">
                      <p className="m-0 font-sans text-footnote leading-normal text-cream-muted">{-daysTo(it.target_date!)} days past its date with {ms.length - doneN} of {ms.length} milestone{ms.length === 1 ? "" : "s"} open. Finish it, give it a new date, or look at what&rsquo;s left.</p>
                      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2">
                        <button type="button" className="btn-sec btn-sm" onClick={() => unfold(it.id)}>Show the milestones</button>
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
                    if (!served.length && !mng) return null;
                    return (
                      <div className="cmd-serves">
                        <span className="cmd-serves-k">Serves</span>
                        {served.map((g) => (
                          <span key={g.id} className={`k-tag txt${g.checkin_status === "at_risk" ? " warn" : ""}`}>
                            🎯 {g.title} · {Math.min(100, Math.round((Number(g.current_value) / Math.max(1, Number(g.target_value))) * 100))}%
                            {mng && <button type="button" className="k-tag-x" onClick={() => unlinkGoal(it.id, g.id)} aria-label={`Unlink ${g.title}`}><Icon name="close" /></button>}
                          </span>
                        ))}
                        {served.length === 0 && <span className="cmd-serves-none">no goal linked yet</span>}
                        {mng && linkable.length > 0 && (
                          <select className="max-w-[120px] font-semibold" value="" onChange={(e) => linkGoal(it.id, e.target.value)} aria-label="Link a goal this initiative serves">
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
                        const trailing = (ties > 1 || ws || m.due_on || mng) ? (
                          <>
                            {ties > 1 && <span className="cmd-tie" title={`Tied to ${ties} initiatives`}>⧉{ties}</span>}
                            {ws && <span className={`cmd-ws${ws.linked ? "" : " loose"}`} title={ws.linked ? undefined : "Not linked to a workstream"}>{ws.text}</span>}
                            {m.due_on && <span className={`cmd-mile-due${mlate ? " late" : ""}`}>{dnice(m.due_on)}</span>}
                            {mng && <button type="button" className="cmd-mile-mng" onClick={() => setManage(m)} aria-label="Manage milestone">⋯</button>}
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
                  {mng && <InlineCreate label="+ Milestone" placeholder="Milestone" className="btn-ter self-start mt-2" onCreate={(t) => addMilestone(it.id, t)} />}
                  {late && unfolded.has(it.id) && <button type="button" className="btn-ter flex mt-1" onClick={() => unfold(it.id)}>Fold it back</button>}
                  </>}
                  {(mng || (isAdmin && folded)) && <button type="button" className="btn-ter flex mt-2.5" onClick={() => finishInit(it)}><Icon name="check" /> Finish initiative</button>}
                  {isAdmin && <button type="button" className="btn-ter flex mt-2" onClick={() => setManaging(mng ? null : it.id)} aria-expanded={mng}>{mng ? "Done" : "Manage"}</button>}
                </div>
              );
            })}
            {isAdmin && <InlineCreate label="+ New initiative" placeholder="Initiative name" className="btn-ter self-start mt-1 mb-2" onCreate={createInit} />}

            {/* ── Launch readiness · go/no-go ── */}
            <LaunchReadiness state={launch} />
            </div>
            </CommandFold>

            {/* ── Blockers ── no block of their own (2026-10-12, the Command audit): each is said on the line where it is
                acted on — a stream's under its stream, a goal at risk on the Goals row, an open incident in the week. */}

            {/* ── Money ── no pointer here (2026-10-10, the Command fold). It read "Money — the live glance · Money ›"
                between the team's week and the next column, and Money is one tap away anyway: Business opens on it
                (2026-10-09, the navigation round), and the home's three numbers lead it. */}

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
