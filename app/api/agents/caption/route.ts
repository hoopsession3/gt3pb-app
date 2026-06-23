import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { academyKnowledge } from "@/lib/operatorKb";

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

  const system = `You are GT3's brand copywriter — suave, modern, premium, and precise. Voice: "Pure Signal. No Noise." Measured, not hyped. Education-first: teach the WHY (primal, whole-food, non-toxic ingredients) so the product sells itself — "sell by talking less." Write for ${channel}, format ${kind}.

HARD RULES (health-adjacent brand): never invent or imply nutrition/health/caffeine claims beyond the GT3 knowledge below; nutrition is "estimated until lab-verified." No fake urgency, no clickbait, no generic AI filler. Stay in voice. Always answer with the draft_captions tool.

=== GT3 BRAND & PRODUCT KNOWLEDGE ===
${academyKnowledge()}`;

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
