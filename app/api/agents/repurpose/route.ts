import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { studioSystem } from "@/lib/brandVoice";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// REPURPOSE ENGINE — one piece → every format. Takes an existing caption/idea and spins it, in the
// GT3 voice, into a Story version, a Reel script (hook → beats → CTA), an email, and a site blurb,
// so a single idea ships across the whole funnel. Staff-gated.

const TOOL: ToolDef = {
  name: "repurpose",
  description: "Recast one content idea into every format, all in the GT3 voice.",
  input_schema: {
    type: "object",
    properties: {
      story: { type: "string", description: "Instagram Story version — 1-2 punchy lines for an overlay; short." },
      reel_script: {
        type: "object",
        properties: {
          hook: { type: "string", description: "First 1.5 seconds — the line that stops the scroll." },
          beats: { type: "array", items: { type: "string" }, description: "3-5 on-screen beats / spoken lines, in order." },
          cta: { type: "string", description: "The close — what to do next." },
        },
        required: ["hook", "beats", "cta"],
      },
      email: { type: "object", properties: { subject: { type: "string" }, body: { type: "string", description: "Short email, 2-4 short paragraphs." } }, required: ["subject", "body"] },
      site_blurb: { type: "string", description: "A tight website/blog blurb — 1-2 sentences." },
    },
    required: ["story", "reel_script", "email", "site_blurb"],
  },
};

async function approvedCaptions(limit = 4): Promise<string[]> {
  if (!supabaseAdmin) return [];
  const { data } = await supabaseAdmin.from("content_items").select("caption").in("status", ["approved", "scheduled", "published"]).not("caption", "is", null).order("updated_at", { ascending: false }).limit(limit);
  return ((data as { caption: string | null }[]) ?? []).map((r) => (r.caption ?? "").trim()).filter((c) => c.length > 40);
}

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  let title = String(body.title ?? "").slice(0, 200);
  let caption = String(body.caption ?? "").slice(0, 2000);
  if (body.content_id && supabaseAdmin) {
    const { data } = await supabaseAdmin.from("content_items").select("title, caption").eq("id", body.content_id).maybeSingle();
    if (data) { title = (data as any).title || title; caption = (data as any).caption || caption; }
  }
  const source = (caption || title).trim();
  if (!source) return NextResponse.json({ ok: false, error: "nothing to repurpose — write a caption first" }, { status: 400 });

  const system = studioSystem({
    examples: await approvedCaptions(),
    task: "REPURPOSE — recast the SOURCE idea below into a Story, a Reel script (hook → beats → CTA), an email, and a site blurb. Keep the substance; change the shape and length to fit each format. Stay in the GT3 voice. Always answer with the repurpose tool.",
  });
  try {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 1400, temperature: 0.7, system,
      messages: [{ role: "user", content: `SOURCE${title ? ` (titled "${title}")` : ""}:\n${source}` }],
      tools: [TOOL], tool_choice: { type: "tool", name: "repurpose" },
    });
    const out: any = r.toolUses.find((t) => t.name === "repurpose")?.input ?? null;
    if (!out) return NextResponse.json({ ok: false, error: "no variants returned — try again" }, { status: 502 });
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 502 });
  }
}
