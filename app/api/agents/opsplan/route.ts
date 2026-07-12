import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// OPS PLAN — the chief-of-staff read of a meeting note. Where `recap` only pulls follow-up TASKS,
// this reads the note as an operations expert and maps every commitment to the RIGHT operation in
// the app — a truck event/stop, a vendor, a pipeline opportunity, prep tasks, a brew — grounded in
// a live snapshot of what already exists (so it reuses a known vendor/stop instead of duplicating).
// AND it names GAPS: things the note implies the business should handle but has no built feature for.
// Plan-only (no writes) — the human reviews and taps "Create" on each op in the UI. Staff-gated.
//
// Example ("Kayla's texting Sandy to set up a truck event at Wine Express Sat"):
//   → event/stop: Wine Express, this Saturday
//   → vendor: Wine Express (contact: Sandy) — new, not in the book
//   → pipeline: Wine Express — truck event (opportunity)
//   → tasks: confirm date with Sandy · brew to cover the event · load-out
//   → gaps: (if the note wanted, say, a signed venue agreement and there's no contracts feature)

const TOOL: ToolDef = {
  name: "operations_plan",
  description:
    "Turn the meeting note into a concrete operations plan for a mobile beverage business. For each real commitment or decision, emit ONE operation of the right type, grounded in the snapshot (reuse an existing vendor/stop by exact name if it matches; otherwise mark new:true). Skip pure discussion. Then list gaps — needs the note implies that the app has no operation for.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "One sentence: what this note means for operations." },
      operations: {
        type: "array",
        description: "The operations to run, most time-sensitive first.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["event", "stop", "vendor", "pipeline", "task", "brew"], description: "event=a scheduled happening; stop=a truck location/date; vendor=a partner/venue to add; pipeline=a sales opportunity; task=a prep follow-up; brew=a production batch." },
            title: { type: "string", description: "Short label for the operation (e.g. 'Wine Express — Saturday truck event')." },
            when: { type: "string", description: "Date or day if the note implies one (YYYY-MM-DD or 'this Saturday'); else empty." },
            who: { type: "string", description: "Vendor / venue / contact name if relevant (e.g. 'Wine Express (Sandy)')." },
            details: { type: "string", description: "One line: what to do / key specifics from the note." },
            critical: { type: "boolean", description: "true if time-sensitive or blocks an event." },
            isNew: { type: "boolean", description: "For vendor/stop: true if it is NOT already in the snapshot." },
          },
          required: ["type", "title", "details"],
        },
      },
      gaps: {
        type: "array",
        description: "Things the note implies the business should handle but the app has no operation for. Empty if none.",
        items: { type: "object", properties: {
          need: { type: "string", description: "The capability the note calls for." },
          why: { type: "string", description: "The line in the note that implies it." },
        }, required: ["need"] },
      },
    },
    required: ["operations"],
  },
};

const list = (rows: any[] | null, key = "name") => (rows ?? []).map((r) => r[key]).filter(Boolean).slice(0, 80).join(", ");

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let note_id = "", raw = "";
  try { ({ note_id, text: raw } = await req.json()); } catch { /* */ }

  let text = String(raw ?? "").slice(0, 14000);
  if (note_id) {
    const { data: note } = await supabaseAdmin.from("meeting_notes").select("title, summary, body").eq("id", note_id).maybeSingle();
    if (note) text = [note.title, note.summary, note.body].filter(Boolean).join("\n\n").slice(0, 14000);
  }
  if (!text.trim()) return NextResponse.json({ ok: true, plan: { operations: [], gaps: [] } });

  // Live snapshot so the agent reuses what exists and can flag "new".
  const [vendors, stops] = await Promise.all([
    supabaseAdmin.from("vendors").select("name").limit(120),
    supabaseAdmin.from("stops").select("name").is("archived_at", null).limit(60),
  ]);
  const snapshot = `Known vendors/venues: ${list(vendors.data) || "(none yet)"}\nKnown truck stops/locations: ${list(stops.data) || "(none yet)"}\nPipeline stages: prospect → contacted → talking → proposal → won/lost.`;

  const system = [
    "You are GT3 Performance Bar's chief of staff — an operations expert for a mobile whole-food beverage business (a coffee/juice truck + delivery + B2B office route).",
    "Read the meeting note and produce an OPERATIONS PLAN: map every real commitment to the correct operation type, grounded in the snapshot below. Reuse an existing vendor/stop by EXACT name if it clearly matches; otherwise set isNew:true.",
    "A 'truck event at <venue> <day>' typically implies FOUR ops: the event/stop, the vendor/venue (if new), a pipeline opportunity, and prep tasks (confirm date, brew to cover, load-out).",
    "Be concrete and specific; never invent commitments the note doesn't support. Then flag GAPS — anything the note implies the business should do that these operation types can't capture.",
    "",
    "SNAPSHOT:",
    snapshot,
  ].join("\n");

  try {
    const r = await callClaude({ label: "opsplan",
      model: MODELS.sonnet,
      maxTokens: 1500,
      system,
      messages: [{ role: "user", content: `Meeting note:\n\n${text}` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "operations_plan" },
    });
    const plan = r.toolUses.find((t) => t.name === "operations_plan")?.input ?? { operations: [], gaps: [] };
    const operations = (plan.operations ?? []).filter((o: any) => o?.type && o?.title?.trim()).slice(0, 20);
    const gaps = (plan.gaps ?? []).filter((g: any) => g?.need?.trim()).slice(0, 8);
    return NextResponse.json({ ok: true, plan: { headline: plan.headline ?? "", operations, gaps } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}
