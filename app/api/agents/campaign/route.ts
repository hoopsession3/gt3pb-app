import { NextResponse } from "next/server";
import { staffFromRequest, userFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { studioSystem } from "@/lib/brandVoice";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// CAMPAIGN GENERATOR — turn an event into a planned content arc in one tap: a teaser (−3d), a
// day-of post, and a recap (+1d). Each is drafted on-brand (Academy voice), event-linked, and
// pre-scheduled relative to the event. They land as drafts in the Studio for review/edit.

const PHASES = [
  { key: "teaser", offset: -3, label: "Teaser" },
  { key: "day_of", offset: 0, label: "Day-of" },
  { key: "recap", offset: 1, label: "Recap" },
];

const TOOL: ToolDef = {
  name: "build_campaign",
  description: "Return the three campaign pieces for the event.",
  input_schema: {
    type: "object",
    properties: {
      pieces: {
        type: "array",
        description: "Exactly three, in order: teaser, day_of, recap.",
        items: {
          type: "object",
          properties: {
            phase: { type: "string", enum: ["teaser", "day_of", "recap"] },
            title: { type: "string" },
            hook: { type: "string" },
            caption: { type: "string" },
            hashtags: { type: "array", items: { type: "string" } },
          },
          required: ["phase", "title", "hook", "caption", "hashtags"],
        },
      },
    },
    required: ["pieces"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  const user = await userFromRequest(req);

  let event_id = "", channel = "instagram";
  try { ({ event_id = "", channel = "instagram" } = await req.json()); } catch { /* */ }
  if (!event_id) return NextResponse.json({ ok: false, error: "event_id required" }, { status: 400 });

  const { data: ev } = await supabaseAdmin.from("events").select("id, title, day, day_label").eq("id", event_id).maybeSingle();
  if (!ev || !ev.day) return NextResponse.json({ ok: false, error: "event not found" }, { status: 404 });

  const { data: approvedRows } = await supabaseAdmin.from("content_items")
    .select("caption").in("status", ["approved", "scheduled", "published"]).not("caption", "is", null)
    .order("updated_at", { ascending: false }).limit(4);
  const examples = ((approvedRows as { caption: string | null }[]) ?? []).map((r) => (r.caption ?? "").trim()).filter((c) => c.length > 40);
  const system = studioSystem({
    channel,
    examples,
    task: `THE CAMPAIGN — three distinct moves for one event on ${channel}:
- TEASER (−3 days): a 2-beat tease. Make them lean in. Name the why, not the what; let the date just sit there.
- DAY-OF: the shortest one. We're here. Come. Two beats, or a single landed line.
- RECAP (+1 day): a 3-beat reflection — what it felt like, one small specific, a quiet door to next time. Gratitude without the word "grateful."

Distinct angles, all unmistakably GT3. Always answer with the build_campaign tool.`,
  });

  let pieces: any[] = [];
  try {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 1800, temperature: 0.85,
      system,
      messages: [{ role: "user", content: `Event: ${ev.title || "GT3 event"}${ev.day_label ? ` (${ev.day_label})` : ""} on ${ev.day}.` }],
      tools: [TOOL], tool_choice: { type: "tool", name: "build_campaign" },
    });
    pieces = r.toolUses.find((t) => t.name === "build_campaign")?.input?.pieces ?? [];
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
  if (pieces.length === 0) return NextResponse.json({ ok: false, error: "no campaign generated" }, { status: 502 });

  const [y, m, d] = ev.day.split("-").map(Number);
  const rows = PHASES.map((ph) => {
    const p = pieces.find((x) => x.phase === ph.key) || pieces[PHASES.indexOf(ph)] || {};
    const dt = new Date(y, m - 1, d + ph.offset, 9, 0);
    return {
      kind: "post", channel, event_id, status: "draft",
      title: p.title || `${ev.title || "Event"} — ${ph.label}`,
      hook: p.hook || "", caption: p.caption || "",
      hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
      scheduled_for: dt.toISOString(), created_by: user?.id ?? null, updated_by: user?.id ?? null,
    };
  });
  const { data, error } = await supabaseAdmin.from("content_items").insert(rows).select("id");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, created: data?.length ?? 0 });
}
