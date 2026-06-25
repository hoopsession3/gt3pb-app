import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// CHIEF OF STAFF — the executive-assistant briefing. Pulls the WHOLE org snapshot for a period
// (week / month / quarter) — events, truck stops, brew batches, open + overdue work, incidents,
// content, bookings, gear maintenance due, low stock — and produces a sharp briefing that ORGANIZES
// and LEADS the period: the headline, ranked priorities, an ordered "lead the week" plan, the risks
// needing a decision, and a by-area status. Read-only, leadership-gated. Nothing is written.

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const TOOL: ToolDef = {
  name: "briefing",
  description: "An executive chief-of-staff briefing that organizes and leads the period. Ground everything in the snapshot; name specifics; rank by impact; no padding.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "One sharp sentence: the state of the business this period and the single most important thing." },
      priorities: {
        type: "array", description: "The top 3–5 priorities, ranked most-important first.",
        items: { type: "object", properties: {
          title: { type: "string" },
          why: { type: "string", description: "One line grounding it in the data." },
          urgency: { type: "string", enum: ["high", "medium", "low"] },
        }, required: ["title", "urgency"] },
      },
      lead_plan: { type: "array", items: { type: "string" }, description: "The ordered do-this plan to lead the period — concrete steps in the sequence to do them." },
      risks: {
        type: "array", description: "What's at risk or needs a decision now.",
        items: { type: "object", properties: { risk: { type: "string" }, action: { type: "string", description: "The recommended call." } }, required: ["risk", "action"] },
      },
      by_area: {
        type: "array", description: "Status by area — events, brew, ops, content, bookings, gear, stock.",
        items: { type: "object", properties: {
          area: { type: "string" },
          status: { type: "string", enum: ["good", "watch", "behind"] },
          note: { type: "string" },
        }, required: ["area", "status", "note"] },
      },
      watch: { type: "array", items: { type: "string" }, description: "Things to keep an eye on but not act on yet." },
    },
    required: ["headline", "priorities", "lead_plan", "by_area"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const period: "week" | "month" | "quarter" = ["week", "month", "quarter"].includes(body.period) ? body.period : "week";
  const days = period === "week" ? 7 : period === "month" ? 31 : 92;
  const now = new Date();
  const from = ymd(now);
  const end = new Date(now); end.setDate(end.getDate() + days);
  const to = ymd(end);
  const fromTs = `${from}T00:00:00`, toTs = `${to}T23:59:59`;

  const db = supabaseAdmin;
  const [events, stops, brews, todos, critTasks, incidents, content, bookings, maint, lowStock, noteFollowups] = await Promise.all([
    db.from("events").select("title, day, stage, location_text").is("archived_at", null).gte("day", from).lte("day", to).order("day"),
    db.from("stops").select("name, starts_at, status").not("starts_at", "is", null).neq("status", "done").gte("starts_at", fromTs).lte("starts_at", toTs).order("starts_at"),
    db.from("brew_batches").select("recipe_name, batch_gal, ready_at, status, event_id").not("status", "in", "(served,dumped)").order("ready_at", { nullsFirst: false }),
    db.from("todos").select("title, due_on, category, done").eq("done", false).not("due_on", "is", null).lte("due_on", to).order("due_on"),
    db.from("event_tasks").select("label, critical, done").eq("done", false).eq("critical", true).limit(25),
    db.from("incident_log").select("problem, severity, created_at, resolved").eq("resolved", false).order("created_at", { ascending: false }).limit(15),
    db.from("content_items").select("title, scheduled_for, status").is("archived_at", null).not("scheduled_for", "is", null).neq("status", "published").gte("scheduled_for", fromTs).lte("scheduled_for", toTs).order("scheduled_for"),
    db.from("booking_requests").select("name, event_date, status, created_at").eq("status", "new").order("created_at", { ascending: false }).limit(15),
    db.from("asset_maintenance").select("summary, next_due_on, assets(name)").not("next_due_on", "is", null).lte("next_due_on", to).order("next_due_on"),
    db.from("inventory_items").select("name, qty, reorder_point, status").in("status", ["low", "critical"]).limit(30),
    db.from("event_tasks").select("label, done, meeting_note_id").eq("done", false).not("meeting_note_id", "is", null).limit(20),
  ]);

  const todayStr = from;
  const overdue = (d: string | null) => !!d && d < todayStr;
  const snapshot = {
    period, window: { from, to, days }, today: todayStr,
    events: (events.data ?? []).map((e: any) => `${e.day} · ${e.title}${e.stage ? ` [${e.stage}]` : ""}${e.location_text ? ` @ ${e.location_text}` : ""}`),
    truck_stops: (stops.data ?? []).map((s: any) => `${ymd(new Date(s.starts_at))} · ${s.name}`),
    brew_batches: (brews.data ?? []).map((b: any) => `${b.recipe_name} ${b.batch_gal}gal — ${b.status}${b.ready_at ? ` (ready ${ymd(new Date(b.ready_at))})` : ""}`),
    todos_open: (todos.data ?? []).map((t: any) => `${t.due_on}${overdue(t.due_on) ? " ⚠OVERDUE" : ""} · [${t.category}] ${t.title}`),
    critical_open_tasks: (critTasks.data ?? []).map((t: any) => t.label),
    open_incidents: (incidents.data ?? []).map((i: any) => `[${i.severity}] ${i.problem}`),
    content_scheduled: (content.data ?? []).map((c: any) => `${ymd(new Date(c.scheduled_for))} · ${c.title} [${c.status}]`),
    new_bookings: (bookings.data ?? []).map((b: any) => `${b.name ?? "—"}${b.event_date ? ` · ${b.event_date}` : ""}`),
    gear_maintenance_due: (maint.data ?? []).map((m: any) => `${m.next_due_on}${overdue(m.next_due_on) ? " ⚠OVERDUE" : ""} · ${m.assets?.name ?? "asset"}: ${m.summary}`),
    low_stock: (lowStock.data ?? []).map((i: any) => `${i.name} [${i.status}]${i.qty != null ? ` qty ${i.qty}` : ""}`),
    open_note_followups: (noteFollowups.data ?? []).length,
  };

  const periodWord = period === "week" ? "WEEK" : period === "month" ? "MONTH" : "QUARTER";
  let out: any = null;
  try {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 1700, temperature: 0.25,
      system:
        `You are the Chief of Staff / executive assistant for GT3 Performance Bar, a mobile beverage truck run by Ryan & Kayla. You produce the ${periodWord} briefing — your job is to ORGANIZE and LEAD the ${period}, like an elite EA who has read everything and tells the owners exactly what to focus on and in what order. ` +
        `Given the full snapshot below, deliver: a sharp headline; the ranked priorities (most important first); an ORDERED 'lead plan' (the concrete do-this sequence for the ${period}); the risks that need a decision now (overdue work, gaps, gear due, low stock, unanswered bookings); and a by-area status (events, brew, ops, content, bookings, gear, stock). ` +
        `Be decisive and specific — name the events, batches, and overdue items. Rank by real impact (committed events and revenue first, then prep, then nice-to-haves). Call out anything OVERDUE loudly. Don't pad, don't invent — if an area is quiet, say it's quiet. ` +
        (period === "week"
          ? "This is the week ahead: make it executable day-by-day. "
          : "This is a longer horizon: frame it as what's ahead, what's slipping, and what decisions to make now to stay ahead. ") +
        "Always answer with the briefing tool.",
      messages: [{ role: "user", content: `${periodWord} snapshot:\n\n${JSON.stringify(snapshot, null, 1)}` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "briefing" },
    });
    out = r.toolUses.find((t) => t.name === "briefing")?.input ?? null;
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 502 });
  }
  if (!out) return NextResponse.json({ ok: false, error: "no briefing" }, { status: 502 });

  return NextResponse.json({ ok: true, period, window: { from, to }, briefing: out, counts: {
    events: snapshot.events.length, stops: snapshot.truck_stops.length, brews: snapshot.brew_batches.length,
    todos: snapshot.todos_open.length, incidents: snapshot.open_incidents.length, maintenance: snapshot.gear_maintenance_due.length, low_stock: snapshot.low_stock.length,
  } });
}
