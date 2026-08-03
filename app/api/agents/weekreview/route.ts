import { NextResponse } from "next/server";
import { staffFromRequest, userFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// WEEKLY OPERATING REVIEW (2026-08-02 exec-rhythm P1) — the missing review step of the
// plan → execute → REVIEW → adjust loop, assembled on demand. DETERMINISTIC on purpose: every
// number and list below is read straight from the tables (the 0208 digest's revenue formula,
// the Command Board's task/incident reads, the goal tracker, the decision ledger) — no model in
// the loop, so the review can never hallucinate a number and never fails on a missing API key.
//
// The review lands as a MEETING NOTE (source 'review') — the continuation-ready record from
// 0262 — so the retro is captured with "＋ Add to this note" addenda, discussion happens on the
// note's own thread, and follow-ups ride ✦ Suggest onto the ONE task spine. One review per week
// (dedupe on source+met_on window): a second tap opens the existing one.

const money = (c: number) => `$${Math.round(c / 100).toLocaleString()}`;
const day = (d: Date) => d.toISOString().slice(0, 10);
const nice = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

async function sum(table: string, filter: (q: any) => any): Promise<number> {
  try {
    const { data } = await filter(supabaseAdmin!.from(table).select("total_cents"));
    return (data ?? []).reduce((s: number, r: any) => s + (Number(r.total_cents) || 0), 0);
  } catch { return 0; }
}
// The 0208 founder-digest revenue formula, windowed.
async function revenue(fromISO: string, toISO: string): Promise<number> {
  const win = (q: any) => q.gte("created_at", fromISO).lt("created_at", toISO);
  return (await sum("orders", (q) => win(q.eq("paid", true).neq("status", "void"))))
       + (await sum("drop_orders", (q) => win(q.eq("paid", true).is("canceled_at", null))))
       + (await sum("delivery_orders", (q) => win(q.eq("payment_status", "paid").is("canceled_at", null))))
       + (await sum("business_orders", (q) => win(q.eq("payment_status", "paid").is("canceled_at", null))));
}

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  const caller = await userFromRequest(req);

  const now = new Date();
  const today = day(now);
  const d7 = new Date(now.getTime() - 7 * 864e5), d14 = new Date(now.getTime() - 14 * 864e5);
  const ahead14 = day(new Date(now.getTime() + 14 * 864e5)), ahead7 = day(new Date(now.getTime() + 7 * 864e5));

  // One review per week — a second tap opens the standing one instead of forking the record.
  const { data: existing } = await supabaseAdmin.from("meeting_notes").select("id, title")
    .eq("source", "review").gte("met_on", day(new Date(now.getTime() - 6 * 864e5))).limit(1).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, note_id: existing.id, title: existing.title, existing: true });

  const [revThis, revPrior, goalsQ, initsQ, milesQ, eventsQ, incOpenQ, incFixedQ, decQ, overdueQ, next7Q, doneQ, portQ] = await Promise.all([
    revenue(d7.toISOString(), now.toISOString()),
    revenue(d14.toISOString(), d7.toISOString()),
    supabaseAdmin.from("goals").select("title, unit, target_value, current_value, updated_at, checkin_status").eq("status", "active"),
    supabaseAdmin.from("initiatives").select("id, title, emoji, target_date").neq("status", "done"),
    supabaseAdmin.from("initiative_milestones").select("initiative_id, title, due_on, done, done_at"),
    supabaseAdmin.from("events").select("title, day").is("archived_at", null).gte("day", day(d7)).lte("day", ahead14),
    supabaseAdmin.from("incident_log").select("problem, severity").eq("resolved", false),
    supabaseAdmin.from("incident_log").select("id", { count: "exact", head: true }).eq("resolved", true).gte("created_at", d7.toISOString()),
    supabaseAdmin.from("strategy_decisions").select("key, decision").gte("created_at", d7.toISOString()),
    supabaseAdmin.from("all_tasks").select("id", { count: "exact", head: true }).eq("done", false).lt("due", today),
    supabaseAdmin.from("all_tasks").select("id", { count: "exact", head: true }).eq("done", false).gte("due", today).lte("due", ahead7),
    supabaseAdmin.from("all_tasks").select("id", { count: "exact", head: true }).eq("done", true).gte("done_at", d7.toISOString()),
    supabaseAdmin.from("os_workstreams").select("name, owner, status, health, next_action, blocker, last_audited").order("sort"),
  ]);

  const goals = (goalsQ.data ?? []) as any[];
  const moved = goals.filter((g) => g.updated_at >= d7.toISOString());
  const quiet = goals.filter((g) => g.updated_at < d7.toISOString() && g.checkin_status !== "at_risk");
  const atRisk = goals.filter((g) => g.checkin_status === "at_risk");
  const inits = (initsQ.data ?? []) as any[];
  const miles = (milesQ.data ?? []) as any[];
  const ran = ((eventsQ.data ?? []) as any[]).filter((e) => e.day < today);
  const coming = ((eventsQ.data ?? []) as any[]).filter((e) => e.day >= today);
  const blockers = ((incOpenQ.data ?? []) as any[]).filter((i) => i.severity === "blocker");
  const decisions = (decQ.data ?? []) as any[];
  const overdue = overdueQ.count ?? 0, dueNext = next7Q.count ?? 0, doneCt = doneQ.count ?? 0;

  const delta = revPrior > 0 ? Math.round(((revThis - revPrior) / revPrior) * 100) : null;
  const gLine = (g: any) => `**${g.title}** — ${Number(g.current_value).toLocaleString()} / ${Number(g.target_value).toLocaleString()}${g.unit ? ` ${g.unit}` : ""}`;
  const initLine = (i: any) => {
    const mine = miles.filter((m) => m.initiative_id === i.id);
    const hit = mine.filter((m) => m.done && m.done_at && m.done_at >= d7.toISOString()).map((m) => m.title);
    const next = mine.filter((m) => !m.done).sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999"))[0];
    const dl = i.target_date ? ` · ${Math.round((new Date(`${i.target_date}T12:00:00`).getTime() - now.getTime()) / 864e5)}d to ${nice(i.target_date)}` : "";
    return `${i.emoji ? `${i.emoji} ` : ""}**${i.title}**${dl}${hit.length ? ` · hit this week: ${hit.join(", ")}` : ""}${next ? ` · next: ${next.title}${next.due_on ? ` (${nice(next.due_on)})` : ""}` : ""}`;
  };

  // The Monday audit writes the agenda (0264): the portfolio table + sub-8 streams named with
  // their blockers. Absent registry (pre-0264 environments) degrades to no section.
  const port = ((portQ?.data ?? []) as any[]);
  const portActive = port.filter((w) => w.status !== "parked");
  const portMean = portActive.length ? (portActive.reduce((s: number, w: any) => s + w.health, 0) / portActive.length) : null;
  const sub8 = portActive.filter((w) => w.health < 8);
  const wsLine = (w: any) => `- **${w.health}** · ${w.name} (${w.owner})${w.status === "blocked" ? " · BLOCKED" : ""} — ${w.next_action ?? "no next action"}${w.blocker ? ` · ⚠ ${w.blocker}` : ""}`;

  const focus: string[] = [];
  for (const w of sub8.slice(0, 2)) focus.push(`**${w.name}** (${w.health}/10): ${w.blocker ?? w.next_action ?? "name the next action"}`);
  for (const g of atRisk.slice(0, 2)) focus.push(`Get **${g.title}** back on track — it's flagged at risk.`);
  if (blockers.length) focus.push(`Clear the blocker: ${blockers[0].problem}`);
  if (overdue > 0) focus.push(`Work the overdue list down — ${overdue} task${overdue === 1 ? "" : "s"} past due.`);
  if (!focus.length && quiet.length) focus.push(`Move **${quiet[0].title}** — it's been quiet a week.`);
  if (!focus.length) focus.push("Nothing is on fire. Spend the week on the biggest initiative.");

  const md = [
    `## The week that was`,
    `- **Revenue (7d):** ${money(revThis)}${delta !== null ? ` — ${delta >= 0 ? "up" : "down"} ${Math.abs(delta)}% vs the week before (${money(revPrior)})` : revPrior === 0 && revThis === 0 ? " — pre-revenue week" : ""}`,
    `- **Tasks:** ${doneCt} finished · ${overdue} overdue right now`,
    ran.length ? `- **Events run:** ${ran.map((e) => `${e.title} (${nice(e.day)})`).join(" · ")}` : `- **Events run:** none this week`,
    `- **Incidents:** ${blockers.length ? blockers.map((b) => b.problem).join(" · ") : "no open blockers"}${(incFixedQ.count ?? 0) > 0 ? ` · ${incFixedQ.count} resolved this week` : ""}`,
    decisions.length ? `- **Decisions logged:** ${decisions.map((d) => `${d.key} — ${d.decision}`).join(" · ")}` : `- **Decisions logged:** none — if calls were made this week, they belong in the ledger`,
    ``,
    port.length ? `## Portfolio — the Monday audit${portMean !== null ? ` · mean ${portMean.toFixed(1)}` : ""}\n${port.map(wsLine).join("\n")}${sub8.length ? `\n\nBelow green: ${sub8.map((w) => `**${w.name}**`).join(" · ")} — the audit just wrote this week's agenda.` : "\n\nAll streams green or amber — rare air."}\n` : ``,
    `## Goals`,
    moved.length ? `Moved this week:\n${moved.map((g) => `- ${gLine(g)}`).join("\n")}` : `- No goal moved this week.`,
    quiet.length ? `\nQuiet for a week 💤:\n${quiet.map((g) => `- ${gLine(g)}`).join("\n")}` : ``,
    atRisk.length ? `\nAt risk 🔴:\n${atRisk.map((g) => `- ${gLine(g)}`).join("\n")}` : ``,
    ``,
    inits.length ? `## Initiatives\n${inits.map((i) => `- ${initLine(i)}`).join("\n")}\n` : ``,
    `## The week ahead`,
    coming.length ? `- **Events:** ${coming.map((e) => `${e.title} (${nice(e.day)})`).join(" · ")}` : `- **Events:** nothing on the calendar in the next two weeks — worth fixing in itself`,
    `- **Tasks due next 7 days:** ${dueNext}`,
    ``,
    `## Retro — keep · change · start · learned`,
    `Tap **＋ Add to this note** and leave yours — the additions are the retro record:`,
    `- **Keep:** what worked this week`,
    `- **Change:** what we do differently`,
    `- **Start:** what we begin`,
    `- **Learned:** market signal worth keeping — it feeds pitch scripts, pricing, and the risk register`,
    ``,
    `## Proposed focus`,
    focus.map((f, i) => `${i + 1}. ${f}`).join("\n"),
  ].join("\n").replace(/\n{3,}/g, "\n\n");

  const title = `Weekly Operating Review · ${nice(today)}`;
  const { data: note, error } = await supabaseAdmin.from("meeting_notes").insert({
    title, met_on: today, source: "review", visibility: "team",
    summary: md, created_by: caller?.id ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, note_id: (note as any).id, title, existing: false });
}
