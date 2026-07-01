import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { BRAND_VOICE } from "@/lib/brandVoice";

export const runtime = "nodejs";
export const maxDuration = 30;

/* eslint-disable @typescript-eslint/no-explicit-any */
// FLYER TEMPLATE PICKER — the studio art director. Given the flyer's content + occasion, it picks the
// single GT3 template whose mood best fits, and says why in one line. Staff-gated. Deterministic
// fallback lives client-side, so the button still works if AI isn't switched on.

// Kept in lockstep with THEMES in components/RoadFlyer.tsx.
const TEMPLATES: { id: string; when: string }[] = [
  { id: "marquee", when: "the clean, safe default — cream + gold, refined and premium. When in doubt." },
  { id: "blackout", when: "charcoal night mode — evening drops, dramatic, premium after-dark." },
  { id: "redline", when: "a full signal-red field — loud, urgent, a can't-miss announcement or a big launch." },
  { id: "press", when: "editorial masthead + rules — news, an announcement stated with authority, a menu." },
  { id: "goldleaf", when: "gilded, opulent — a reserve pour, a members/VIP moment, something special." },
  { id: "checker", when: "bold motorsport checker — racing/speed energy, an event with a competitive hook." },
  { id: "split", when: "charcoal/cream split with a red seam — bold, graphic, a statement post." },
  { id: "neon", when: "red-glow headline on charcoal — nightlife, late hours, urban heat." },
  { id: "monogram", when: "oversized crest, minimal — quiet luxury, a single strong line, lots of space." },
  { id: "reserve", when: "cinematic film grain — moody, story-driven, a photo-forward or atmospheric post." },
  { id: "carbon", when: "woven carbon-fiber dark — motorsport craft, a premium gear/performance angle." },
  { id: "ticket", when: "an event ticket with perforation — RSVPs, 'you're invited', a dated happening." },
  { id: "amber", when: "warm sunrise gradient — mornings, coffee warmth, a daytime market." },
  { id: "proof", when: "editorial press-proof with registration marks — precise, technical, behind-the-craft, a process story." },
  { id: "deco", when: "art-deco gilded rays on charcoal — elegant, celebratory, a 'golden hour' or anniversary moment." },
  { id: "offset", when: "riso duotone with a handmade misprint — artful, indie, small-batch craft energy." },
  { id: "nocturne", when: "spotlit charcoal — intimate, evening, a single hero line under a warm glow." },
  { id: "terrazzo", when: "speckled terrazzo on cream — organic, whole-food, playful-premium." },
  { id: "halftone", when: "pop-art halftone dots — bold, graphic, high-energy, youthful." },
];
const IDS = TEMPLATES.map((t) => t.id);

const TOOL: ToolDef = {
  name: "pick_template",
  description: "Choose the one GT3 flyer template that best fits this post.",
  input_schema: {
    type: "object",
    properties: {
      template: { type: "string", enum: IDS, description: "The chosen template id." },
      reason: { type: "string", description: "One short line (GT3 voice, measured) on why this template fits — no hype." },
    },
    required: ["template", "reason"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const tile = String(body.tile ?? "announce");
  const ctx = [
    `Slide: ${tile}`,
    body.headline1 || body.headline2 ? `Headline: ${[body.headline1, body.headline2].filter(Boolean).join(" ")}` : "",
    body.place ? `Place: ${body.place}` : "",
    body.date ? `When: ${body.date}${body.time ? ` ${body.time}` : ""}` : "",
    body.text ? `Copy: ${String(body.text).slice(0, 400)}` : "",
    body.occasion ? `Occasion: ${body.occasion}` : "",
  ].filter(Boolean).join("\n");

  const system = `You are GT3 Performance Bar's art director. Pick the ONE flyer template whose mood best fits the post below.

${BRAND_VOICE}

TEMPLATES (all share the same GT3 crest, wordmark, tagline and type — they differ in mood/framing):
${TEMPLATES.map((t) => `- ${t.id}: ${t.when}`).join("\n")}

Match the template's mood to the content and the moment. Prefer restraint over spectacle; reach for the loud cuts (redline, neon, checker) only when the moment truly calls for it. Always answer with the pick_template tool.`;

  try {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 300, temperature: 0.4, system,
      messages: [{ role: "user", content: ctx || "Slide: announce" }],
      tools: [TOOL], tool_choice: { type: "tool", name: "pick_template" },
    });
    const out: any = r.toolUses.find((t) => t.name === "pick_template")?.input ?? null;
    if (!out || !IDS.includes(out.template)) return NextResponse.json({ ok: false, error: "no pick returned — try again" }, { status: 502 });
    return NextResponse.json({ ok: true, template: out.template, reason: String(out.reason ?? "").slice(0, 200) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 502 });
  }
}
