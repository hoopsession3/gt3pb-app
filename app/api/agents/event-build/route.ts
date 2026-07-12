import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// EVENT BUILD (chief-of-staff, guided) — a staff member says it in plain words ("truck event at Wine
// Express this Saturday") and this reads out a structured DRAFT: is it a booked event or a truck stop,
// the title, the date (relative dates resolved against today), the venue, and whether to offer order-
// ahead / pickup. It never writes — it fills what it can and asks one warm line for whatever's missing.
// The client shows the draft as an editable confirm card; the human completes + commits (which binds
// the vendor via findOrCreatePendingVendor). Plan-only, staff-gated.

const TOOL: ToolDef = {
  name: "event_draft",
  description: "Read the request into a structured event/stop draft. Leave a field null if it isn't stated; don't invent it.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["event", "stop"], description: "'stop' = the truck parks & serves on the ground (market, popup, recurring spot). 'event' = a booked gig / party / catering / corporate booking." },
      title: { type: "string", description: "A short name for it, e.g. 'Wine Express Saturday'." },
      date: { type: ["string", "null"], description: "ISO YYYY-MM-DD. Resolve relative dates ('this Saturday', 'next Friday') against the provided today's date. Null if not stated." },
      venue: { type: ["string", "null"], description: "The place / host name (becomes the vendor). Null if not stated." },
      order_ahead: { type: "boolean", description: "Did they ask to let customers order ahead? Default false." },
      pickup: { type: "boolean", description: "Did they mention pickup? Default false." },
      notes: { type: ["string", "null"], description: "Any other detail worth keeping (time, contact, headcount)." },
      clarify: { type: "string", description: "ONE warm, short line asking for the single most important missing/ambiguous thing (usually the date or venue). Empty string if the draft is complete enough to create." },
    },
    required: ["kind", "title", "order_ahead", "pickup", "clarify"],
  },
};

export async function POST(req: Request) {
  const staff = await staffFromRequest(req);
  if (!staff) return NextResponse.json({ ok: false, error: "Staff only" }, { status: 403 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI isn't configured yet." }, { status: 400 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const text = typeof body.text === "string" ? body.text.slice(0, 2000) : "";
  if (!text.trim()) return NextResponse.json({ ok: false, error: "Tell me about the event first." }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  const system =
    `You are GT3's chief of staff helping a crew member create an event or truck stop. Today is ${today} (America/New_York). ` +
    `Read their request and fill the event_draft. Resolve relative dates against today. Classify carefully: a recurring on-the-ground ` +
    `serving spot or market is a 'stop'; a booked gig, party, catering job, or corporate booking is an 'event'. If the venue or date ` +
    `isn't stated, leave it null and put a single warm question in 'clarify'. If you have a title, a kind, and either a date or a venue, ` +
    `that's enough — set clarify to "" so they can review and create.`;

  try {
    const r = await callClaude({
      label: "event-build",
      model: MODELS.haiku, maxTokens: 500, temperature: 0.2,
      system, tools: [TOOL], tool_choice: { type: "tool", name: "event_draft" },
      messages: [{ role: "user", content: text }],
    });
    const draft = r.toolUses.find((t) => t.name === "event_draft")?.input;
    if (!draft) return NextResponse.json({ ok: false, error: "Couldn't read that — try rephrasing." }, { status: 502 });
    return NextResponse.json({ ok: true, draft });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Something went wrong." }, { status: 500 });
  }
}
