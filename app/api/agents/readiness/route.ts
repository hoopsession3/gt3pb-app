import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { raiseAlert } from "@/lib/serverAlerts";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// AGENT #2 — prep/readiness. Reads the next ~2 weeks of events + the inventory on hand, asks Claude
// what's at risk (low/critical stock vs what's coming), and RAISES an alert with the verdict so it
// rides the don't-miss spine. Returns the assessment for the in-app button too. Staff-gated.

const TOOL: ToolDef = {
  name: "report_readiness",
  description: "Report whether the truck is stocked for the upcoming events.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "One sentence: are we ready, or what's the top risk?" },
      severity: { type: "string", enum: ["critical", "important", "fyi"], description: "critical = will run out for a committed event; important = low/reorder soon; fyi = all good." },
      gaps: {
        type: "array",
        description: "Specific shortfalls. Empty if fully stocked.",
        items: {
          type: "object",
          properties: {
            item: { type: "string" },
            detail: { type: "string", description: "Why it's a risk + suggested action (e.g. 'below reorder point; order before Saturday Market')." },
          },
          required: ["item", "detail"],
        },
      },
    },
    required: ["headline", "severity", "gaps"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const [{ data: events }, { data: inv }] = await Promise.all([
    supabaseAdmin.from("events").select("title, day, day_label, menu_nitro, menu_bottles, menu_nature_aid, menu_salted_maple, menu_broth, expected_attendance, staff_count")
      .is("archived_at", null).gte("day", today).lte("day", horizon).order("day"),
    supabaseAdmin.from("inventory_items").select("name, qty, qty_event_ready, reorder_point, status, unit, use_cases, required_for, critical"),
  ]);
  if (!events || events.length === 0) return NextResponse.json({ ok: true, skipped: "no upcoming events" });

  const payload = {
    today,
    upcoming_events: events,
    inventory: (inv ?? []).map((i: any) => ({ name: i.name, on_hand: i.qty, event_ready: i.qty_event_ready, reorder_point: i.reorder_point, status: i.status, unit: i.unit, use_cases: i.use_cases, critical: i.critical })),
  };

  let out: { headline: string; severity: string; gaps: { item: string; detail: string }[] } | null = null;
  try {
    const r = await callClaude({ label: "readiness",
      model: MODELS.sonnet,
      maxTokens: 1200,
      system: "You are the prep lead for a mobile beverage truck (GT3 Performance Bar). Given upcoming events and current inventory, decide if stock covers what's coming. Flag items below reorder point or likely to run out given event count/attendance and menu. Be specific and practical. Always answer with the report_readiness tool.",
      messages: [{ role: "user", content: `Assess readiness for the next 14 days.\n\n${JSON.stringify(payload)}` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "report_readiness" },
    });
    out = r.toolUses.find((t) => t.name === "report_readiness")?.input ?? null;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
  if (!out) return NextResponse.json({ ok: false, error: "no assessment" }, { status: 502 });

  const severity = ["critical", "important", "fyi"].includes(out.severity) ? out.severity : "important";
  const body = out.gaps?.length ? out.gaps.map((g) => `• ${g.item}: ${g.detail}`).join("\n") : "All stocked for what's coming.";
  // Raise it on the spine (only when there's something to act on — don't ping for "all good").
  // Fan-out is the alerts INSERT trigger (0157) — no direct invoke here.
  if (severity !== "fyi") {
    await raiseAlert({ severity: severity as "critical" | "important", category: "prep", title: `Readiness: ${out.headline}`.slice(0, 180), body });
  }
  return NextResponse.json({ ok: true, headline: out.headline, severity, gaps: out.gaps ?? [] });
}
