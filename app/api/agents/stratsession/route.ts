import { NextResponse } from "next/server";
import { staffFromRequest, userFromRequest, tenantFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { addDays, etDayKey, etToday } from "@/lib/dates";
import { businessDaysSince, dayStartIso, isQuietGoal } from "@/lib/rhythm";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// STRATEGY SESSION KIT (2026-08-02 exec-rhythm P2) — "Start a strategy session" builds the agenda
// nobody has to remember. DETERMINISTIC: every agenda block is a live read — open strategy threads,
// goals gone quiet (lib/rhythm.QUIET_GOAL_DAYS — a week, as the card and the review say; it was
// 14 days here until 2026-10-12) or flagged at risk, GTM plays sitting in draft/proposed, program
// hygiene (undated + overdue milestones), blockers older than a week, and the decisions made since
// last time. The agenda lands as a MEETING NOTE (source 'strategy'): discuss on its thread, capture
// with addenda, and close every call with ⚖ Log a decision — append-only, follow-up attached.

// THE BUSINESS DAY, NOT UTC'S (2026-10-12). `day` was `d.toISOString().slice(0, 10)`, so from 8pm Eastern (7pm in
// winter) an agenda was dated tomorrow, called tomorrow's milestones overdue, and "one session note per day" checked
// tomorrow's date — a second tap that evening made a second agenda. And a timestamp was dated by cutting its UTC
// string, so a blocker logged at 9pm read "since" the next day. The day is the Eastern business day now
// (lib/dates.etToday), a timestamp is dated by its Eastern day, and the windows are lib/rhythm's.
const nice = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const niceAt = (iso: string) => nice(etDayKey(new Date(iso)));

async function post(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  // R-002: the service role bypasses RLS, so every read below names its own tenant. Without it
  // the route reads the whole table — harmless while one tenant exists, a cross-tenant read the
  // day a second one does, which is what 0305's guard is holding the door shut against.
  const tenant = await tenantFromRequest(req);
  if (!tenant) return NextResponse.json({ ok: false, error: "no tenant on this session" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  const caller = await userFromRequest(req);

  const today = etToday();
  const d30 = dayStartIso(addDays(today, -30));

  // One session note per day — a second tap the same day opens the standing agenda.
  const { data: existing } = await supabaseAdmin.from("meeting_notes").select("id, title").eq("tenant_id", tenant)
    .eq("source", "strategy").eq("met_on", today).limit(1).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, note_id: existing.id, title: existing.title, existing: true });

  // EVERY READ NAMES THE BUSINESS (2026-10-12). The agenda's open threads (comments, 0051) and its plays on the
  // table (gtm_drafts, 0140) both carry tenant_id, and were read across every business: another market's playbook
  // threads and draft plays would have been on this one's agenda. scripts/service-role.audit.mjs counted both as
  // filtered: inside Promise.all its 400-character window reached the NEXT line's tenant filter.
  const [thrQ, goalsQ, gtmQ, initsQ, milesQ, incQ, decQ] = await Promise.all([
    supabaseAdmin.from("comments").select("strategy_key, body, created_at").eq("tenant_id", tenant).not("strategy_key", "is", null).gte("created_at", d30).order("created_at", { ascending: false }).limit(200),
    supabaseAdmin.from("goals").select("title, unit, target_value, current_value, updated_at, checkin_status").eq("tenant_id", tenant).eq("status", "active"),
    supabaseAdmin.from("gtm_drafts").select("name, category, status").eq("tenant_id", tenant).in("status", ["draft", "proposed"]).order("updated_at", { ascending: false }).limit(10),
    supabaseAdmin.from("initiatives").select("id, title, emoji").eq("tenant_id", tenant).neq("status", "done"),
    supabaseAdmin.from("initiative_milestones").select("initiative_id, title, due_on, done").eq("tenant_id", tenant).eq("done", false),
    supabaseAdmin.from("incident_log").select("problem, severity, created_at").eq("tenant_id", tenant).eq("resolved", false),
    supabaseAdmin.from("strategy_decisions").select("key, decision, created_at").eq("tenant_id", tenant).gte("created_at", d30).order("created_at", { ascending: false }).limit(12),
  ]);

  // Threads: group the last 30 days of strategy comments by key — count + freshest line.
  const threads = new Map<string, { n: number; latest: string }>();
  for (const c of ((thrQ.data ?? []) as any[])) {
    const t = threads.get(c.strategy_key) ?? { n: 0, latest: String(c.body ?? "").slice(0, 90) };
    t.n += 1; threads.set(c.strategy_key, t);
  }
  const goals = (goalsQ.data ?? []) as any[];
  const atRisk = goals.filter((g) => g.checkin_status === "at_risk");
  const stale = goals.filter((g) => isQuietGoal(g.updated_at, today) && g.checkin_status !== "at_risk");
  const gtm = (gtmQ.data ?? []) as any[];
  const initName = new Map(((initsQ.data ?? []) as any[]).map((i) => [i.id, `${i.emoji ? `${i.emoji} ` : ""}${i.title}`]));
  const openMiles = (milesQ.data ?? []) as any[];
  const undated = openMiles.filter((m) => !m.due_on);
  const overdueMiles = openMiles.filter((m) => m.due_on && m.due_on < today);
  const oldBlockers = ((incQ.data ?? []) as any[]).filter((i) => i.severity === "blocker" && (businessDaysSince(i.created_at, today) ?? 0) >= 7);
  const decisions = (decQ.data ?? []) as any[];
  const gLine = (g: any) => `**${g.title}** — ${Number(g.current_value).toLocaleString()} / ${Number(g.target_value).toLocaleString()}${g.unit ? ` ${g.unit}` : ""}`;

  const sections: string[] = [];
  let n = 0;
  if (threads.size) sections.push(`## ${++n} · Open strategy threads\n${[...threads.entries()].slice(0, 8).map(([k, t]) => `- **${k}** — ${t.n} comment${t.n === 1 ? "" : "s"} this month · latest: “${t.latest}”`).join("\n")}\n_Threads live on the Playbook — settle them here, log the call._`);
  if (atRisk.length || stale.length) sections.push(`## ${++n} · Goals needing a call\n${[...atRisk.map((g) => `- 🔴 At risk: ${gLine(g)}`), ...stale.map((g) => `- 💤 Quiet a week+: ${gLine(g)}`)].join("\n")}\n_Rescue it, re-scope it, or archive it — a goal nobody moves is a decision waiting._`);
  if (gtm.length) sections.push(`## ${++n} · Plays on the table\n${gtm.map((p) => `- **${p.name}** (${p.category}, ${p.status}) — adopt, revise, or retire?`).join("\n")}`);
  if (undated.length || overdueMiles.length) sections.push(`## ${++n} · Program hygiene\n${[...overdueMiles.map((m) => `- ⏰ Overdue: **${m.title}**${initName.get(m.initiative_id) ? ` · ${initName.get(m.initiative_id)}` : ""} (was ${nice(m.due_on)})`), ...undated.map((m) => `- 📅 No date: **${m.title}**${initName.get(m.initiative_id) ? ` · ${initName.get(m.initiative_id)}` : ""}`)].slice(0, 10).join("\n")}`);
  if (oldBlockers.length) sections.push(`## ${++n} · Blockers older than a week\n${oldBlockers.map((b) => `- ${b.problem} (since ${niceAt(b.created_at)})`).join("\n")}`);

  const md = [
    `_Auto-assembled agenda — every block below is a live read from the system, right now._`,
    ``,
    sections.length ? sections.join("\n\n") : `**Clean slate.** No open threads, no stalled goals, no pending plays, no aging blockers. Rare air — spend the session on the long view: next quarter's one big bet.`,
    ``,
    decisions.length ? `## Decisions since last month\n${decisions.map((d) => `- **${d.key}** — ${d.decision} (${niceAt(d.created_at)})`).join("\n")}\n` : ``,
    `## Decide & log`,
    `Every call made in this session gets a line: tap **⚖ Log a decision** on this note. Append-only, with the follow-up task attached — no strategic call without a log line.`,
  ].join("\n").replace(/\n{3,}/g, "\n\n");

  const title = `Strategy Session · ${nice(today)}`;
  // The note names its business too (2026-10-12). 0134's stamp_tenant() fills tenant_id from current_tenant(), which
  // is null under the service role, so an agenda written here landed on the founding tenant whoever asked — and the
  // one-a-day check above, which reads by the caller's tenant, would never have found it again.
  const { data: note, error } = await supabaseAdmin.from("meeting_notes").insert({
    tenant_id: tenant, title, met_on: today, source: "strategy", visibility: "team",
    summary: md, created_by: caller?.id ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, note_id: (note as any).id, title, existing: false });
}

export const POST = route("agents/stratsession", post);
