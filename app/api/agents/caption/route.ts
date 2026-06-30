import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { studioSystem } from "@/lib/brandVoice";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Recent captions the team approved/published — the live voice the agents learn from.
async function approvedCaptions(limit = 4): Promise<string[]> {
  if (!supabaseAdmin) return [];
  const { data } = await supabaseAdmin.from("content_items")
    .select("caption").in("status", ["approved", "scheduled", "published"]).not("caption", "is", null)
    .order("updated_at", { ascending: false }).limit(limit);
  return ((data as { caption: string | null }[]) ?? []).map((r) => (r.caption ?? "").trim()).filter((c) => c.length > 40);
}

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
// CAPTION ENGINE — the Studio's suave, on-brand copywriter. Drafts a few distinct options
// (title + hook + caption + hashtags) from a brief, grounded ONLY in the GT3 brand Source of
// Truth (Academy brand voice, product talking points, the "why"). Education-first ("sell by
// talking less"), premium, measured — and claim-safe: never invents nutrition/health claims.

const TOOL: ToolDef = {
  name: "draft_captions",
  description: "Return distinct on-brand content options for the brief.",
  input_schema: {
    type: "object",
    properties: {
      options: {
        type: "array",
        description: "2-3 distinct directions — vary the angle, not just the words.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short internal title for this piece." },
            hook: { type: "string", description: "The scroll-stopping first line — earns the next second." },
            caption: { type: "string", description: "The body copy. Educate first; let the product sell itself. No hype, no fake urgency." },
            hashtags: { type: "array", items: { type: "string" }, description: "5-10 relevant tags, lowercase, no # prefix." },
          },
          required: ["title", "hook", "caption", "hashtags"],
        },
      },
    },
    required: ["options"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });

  let brief = "", kind = "post", channel = "instagram";
  try { ({ brief = "", kind = "post", channel = "instagram" } = await req.json()); } catch { /* */ }
  brief = String(brief).slice(0, 1500);
  if (!brief.trim()) return NextResponse.json({ ok: false, error: "brief required" }, { status: 400 });

  const system = studioSystem({
    channel, kind,
    examples: await approvedCaptions(),
    task: `THE BRIEF — draft 2-3 distinct content options for this piece. Vary the ANGLE, not just the words: a different way in each time (a truth, a detail, a moment). Each option is title + hook + caption + hashtags. Educate first; let the product sell itself. Always answer with the draft_captions tool.`,
  });

  try {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 1400, temperature: 0.7,
      system,
      messages: [{ role: "user", content: `Brief: ${brief}` }],
      tools: [TOOL], tool_choice: { type: "tool", name: "draft_captions" },
    });
    const options = (r.toolUses.find((t) => t.name === "draft_captions")?.input?.options ?? []).filter((o: any) => o?.caption?.trim());
    return NextResponse.json({ ok: true, options });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}
