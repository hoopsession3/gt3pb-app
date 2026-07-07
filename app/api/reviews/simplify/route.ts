import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { cleanBody } from "@/lib/reviews";

export const runtime = "nodejs";

// REVIEW SIMPLIFY — a staffer can turn a rambling or off-brand quote into a clean, display-ready
// line without losing its truth. The model TRIMS and lightly polishes; it must NOT invent praise,
// change the sentiment, or keep a health/medical/nutrition claim (GT3 never makes those). Output is
// still run through cleanBody (PII/length) before it's shown — the AI is an editor, not the guard.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TOOL: ToolDef = {
  name: "simplify_review",
  description: "Return one short, display-ready version of the customer's review.",
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The cleaned quote — the customer's own sentiment, trimmed to one or two punchy sentences. Keep their voice." },
      dropped_claim: { type: "boolean", description: "True if you removed a health/medical/nutrition claim (e.g. helped a condition, less acidic, no crash)." },
      still_genuine: { type: "boolean", description: "True if the trimmed version still faithfully represents what they said. False if the review had nothing displayable once claims/noise were removed." },
    },
    required: ["text", "still_genuine"],
  },
};

const SYSTEM = `You are the GT3 Performance Bar review editor. GT3 is a premium whole-food beverage truck (cold-brew coffee, coconut-water hydration, bone broths).
Turn a raw customer review into ONE clean, display-ready quote for the truck's screen. Rules, in order:
1. NEVER invent, embellish, or add praise the customer didn't give. Only trim and lightly smooth.
2. REMOVE any health, medical, or nutrition claim — anything implying the drink treats/helps a condition, is "healthy", "less acidic", "no crash/jitters", aids a symptom, etc. Keep only taste, enjoyment, quality, experience. GT3 makes no health claims, ever.
3. Strip names of specific people, private details (illnesses, "my neighbor", school), logistics, and anything not about the drink itself.
4. Keep the customer's genuine voice and enthusiasm; one or two sentences; no hashtags, no emoji spam, no ALL CAPS.
5. If, after removing claims and noise, nothing real is left to show, set still_genuine=false.`;

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  if (!anthropicEnabled()) return NextResponse.json({ error: "AI isn't switched on yet." }, { status: 503 });
  let body: { text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const raw = (body.text || "").trim().slice(0, 1200);
  if (raw.length < 8) return NextResponse.json({ error: "Nothing to simplify." }, { status: 400 });
  try {
    const r = await callClaude({
      model: MODELS.haiku, maxTokens: 320, temperature: 0.3,
      system: SYSTEM,
      messages: [{ role: "user", content: `Raw review:\n"""${raw}"""` }],
      tools: [TOOL], tool_choice: { type: "tool", name: "simplify_review" },
    });
    const out = r.toolUses.find((t) => t.name === "simplify_review")?.input as any;
    if (!out?.text) return NextResponse.json({ error: "Couldn't simplify — edit it by hand." }, { status: 502 });
    // The AI is the editor; cleanBody is still the guard (PII + length) on whatever it returns.
    return NextResponse.json({ ok: true, text: cleanBody(out.text), droppedClaim: !!out.dropped_claim, stillGenuine: out.still_genuine !== false });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 200) }, { status: 502 });
  }
}
