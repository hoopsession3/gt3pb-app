import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// DAY PLANNER DRAFT — given an event and a few freeform notes ("leaving Greenville 9am, market opens
// at noon, Airbnb 2 nights"), Claude proposes a time-by-time run of show for ONE day. It PROPOSES;
// the crew reviews and adds what they want in the planner. Nothing is written here. Staff-gated.

const KINDS = ["travel", "lodging", "setup", "service", "meal", "meeting", "teardown", "personal", "other"];

const TOOL: ToolDef = {
  name: "draft_day",
  description: "Propose a realistic, time-ordered run of show for one day of an event.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One line: the shape of this day." },
      items: {
        type: "array",
        description: "Time blocks in chronological order. Be concrete and practical — include travel, setup, service windows, meals, teardown.",
        items: {
          type: "object",
          properties: {
            start_time: { type: "string", description: "e.g. '9:00a', 'noon', '2:30p'" },
            end_time: { type: "string", description: "Optional end time." },
            title: { type: "string", description: "Short action, e.g. 'Leave home', 'Arrive Airbnb', 'Doors / service'." },
            kind: { type: "string", enum: KINDS },
            location: { type: "string", description: "Place name if known, else empty." },
            details: { type: "string", description: "Helpful specifics to confirm: parking, contact, what to load. Empty if none." },
            who: { type: "string", description: "Who's responsible if implied, else empty." },
          },
          required: ["start_time", "title", "kind"],
        },
      },
    },
    required: ["summary", "items"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const eventId: string | undefined = body.event_id;
  const stopId: string | undefined = body.stop_id;
  const ownerCol = eventId ? "event_id" : stopId ? "stop_id" : null;
  const ownerId = eventId || stopId;
  const dayIndex: number = Math.max(1, parseInt(body.day_index) || 1);
  const notes: string = String(body.notes ?? "").slice(0, 2000);
  if (!ownerCol || !ownerId) return NextResponse.json({ ok: false, error: "event_id or stop_id required" }, { status: 400 });

  // ── DEPARTURE SUMMARY mode — read the day's EXISTING slots and say when to leave ──
  if (body.summarize) {
    const ev2 = eventId
      ? (await supabaseAdmin.from("events").select("title, day_label, location_text").eq("id", eventId).maybeSingle()).data
      : (await supabaseAdmin.from("stops").select("name, location_text, address, starts_at").eq("id", stopId).maybeSingle()).data;
    const { data: slots } = await supabaseAdmin.from("event_schedule_items")
      .select("start_time, end_time, title, kind, location, address").eq(ownerCol, ownerId).eq("day_index", dayIndex).order("sort");
    const list = (slots ?? []).filter((s: any) => s.start_time || s.title);
    if (list.length === 0) return NextResponse.json({ ok: true, leave_by: "", summary: "", risks: [] });
    const DEP_TOOL: ToolDef = {
      name: "departure_summary",
      description: "From a day's time blocks, say when the crew needs to leave / start, anchored on the first fixed commitment.",
      input_schema: {
        type: "object",
        properties: {
          leave_by: { type: "string", description: "The time to leave or start the day, e.g. '8:15a'. Echo the earliest travel/leave block's time if it has one; otherwise reason back from the first hard commitment (load-in / doors / service) with a realistic buffer." },
          summary: { type: "string", description: "1–2 plain sentences: when to leave and why, tied to the first fixed commitment and the drive." },
          buffer_min: { type: "number", description: "Total minutes between leave_by and the first SERVICE start (drive + setup) — the buffer to block on the calendar. Only when you can derive it from a given drive time; omit if drive time is unknown." },
          risks: { type: "array", items: { type: "string" }, description: "Tight transitions or missing info (e.g. 'no drive time between leave and load-in — confirm it')." },
        },
        required: ["leave_by", "summary"],
      },
    };
    try {
      const r = await callClaude({ label: "dayplan",
        model: MODELS.sonnet, maxTokens: 500, temperature: 0.2,
        system: "You are the logistics scheduler for GT3 Performance Bar (a small crew, Ryan & Kayla). Given a day's existing time blocks in order, produce a crisp 'when to leave' summary. Anchor on the earliest travel/'leave' block if it has a time; otherwise reason backward from the first hard commitment (load-in, doors, service) allowing a realistic buffer for the drive and setup. Be concrete and brief. If drive time isn't given, do NOT invent a number — tell them to confirm it. Always answer with the departure_summary tool.",
        messages: [{ role: "user", content: `Day ${dayIndex}. Event: ${JSON.stringify(ev2 ?? {})}\n\nTime blocks (in order):\n${JSON.stringify(list)}` }],
        tools: [DEP_TOOL],
        tool_choice: { type: "tool", name: "departure_summary" },
      });
      const o = r.toolUses.find((t) => t.name === "departure_summary")?.input ?? null;
      if (!o) return NextResponse.json({ ok: true, leave_by: "", summary: "", risks: [] });
      return NextResponse.json({
        ok: true,
        leave_by: String(o.leave_by ?? "").slice(0, 40),
        summary: String(o.summary ?? "").slice(0, 400),
        buffer_min: typeof o.buffer_min === "number" && o.buffer_min > 0 ? Math.round(o.buffer_min) : null,
        risks: Array.isArray(o.risks) ? o.risks.map((s: any) => String(s).slice(0, 160)).slice(0, 4) : [],
      });
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 502 });
    }
  }

  let e: any = null, ofDays = 1;
  if (eventId) {
    e = (await supabaseAdmin.from("events")
      .select("title, day, day_label, start_time, end_time, location_text, state, county, rig, expected_attendance, staff_count, plan_days")
      .eq("id", eventId).maybeSingle()).data;
    ofDays = e?.plan_days ?? 1;
  } else {
    const s = (await supabaseAdmin.from("stops").select("name, location_text, address, starts_at, notes, menu_tier, plan_days").eq("id", stopId).maybeSingle()).data as any;
    if (s) { e = { title: s.name, day: s.starts_at ? String(s.starts_at).slice(0, 10) : null, location_text: s.location_text, address: s.address, notes: s.notes, menu_tier: s.menu_tier, kind: "truck stop (on-the-ground ops)" }; ofDays = s.plan_days ?? 1; }
  }
  if (!e) return NextResponse.json({ ok: false, error: `${eventId ? "event" : "stop"} not found` }, { status: 404 });

  const payload = { event: e, day_index: dayIndex, of_days: ofDays, planner_notes: notes };

  let out: { summary: string; items: any[] } | null = null;
  try {
    const r = await callClaude({ label: "dayplan",
      model: MODELS.sonnet,
      maxTokens: 1400,
      temperature: 0.3,
      system:
        "You plan logistics for GT3 Performance Bar, a mobile beverage truck run by a small crew (Ryan & Kayla). " +
        "Given an event and the crew's notes, draft a practical, time-ordered run of show for the requested day only. " +
        "Cover the real-world arc: leaving home, drive/fuel, lodging check-in, load-in & setup, service window, breaks/meals, teardown, load-out. " +
        "Keep titles short and actionable. Put confirmable specifics (parking, gate code, contact, what to load) in details. " +
        "Don't invent addresses or codes you weren't given — leave those for the crew to fill. Always answer with the draft_day tool.",
      messages: [{ role: "user", content: `Draft day ${dayIndex} of ${ofDays}.\n\n${JSON.stringify(payload)}` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "draft_day" },
    });
    out = r.toolUses.find((t) => t.name === "draft_day")?.input ?? null;
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 502 });
  }
  if (!out) return NextResponse.json({ ok: false, error: "no draft" }, { status: 502 });

  const items = (out.items ?? []).filter((i) => i && i.title && i.start_time).map((i) => ({
    start_time: String(i.start_time).slice(0, 40),
    end_time: i.end_time ? String(i.end_time).slice(0, 40) : "",
    title: String(i.title).slice(0, 200),
    kind: KINDS.includes(i.kind) ? i.kind : "other",
    location: i.location ? String(i.location).slice(0, 200) : "",
    details: i.details ? String(i.details).slice(0, 600) : "",
    who: i.who ? String(i.who).slice(0, 60) : "",
  }));
  return NextResponse.json({ ok: true, summary: out.summary ?? "", items });
}
