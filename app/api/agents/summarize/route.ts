import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { callClaude, anthropicEnabled, MODELS } from "@/lib/anthropic";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
// SUMMARIZE — recreate a meeting note's recap from the transcript (or tighten the current summary).
// Plain, specific, no fluff. Cheap + fast (Haiku).
export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });

  let text = "";
  try { ({ text = "" } = await req.json()); } catch { /* */ }
  text = String(text).slice(0, 14000);
  if (!text.trim()) return NextResponse.json({ ok: false, error: "nothing to summarize" }, { status: 400 });

  try {
    const r = await callClaude({
      model: MODELS.haiku, maxTokens: 450, temperature: 0.3,
      system: "You summarize a beverage-truck team's meeting notes or transcript into a tight recap. 2–4 sentences capturing decisions made, the key points, and anything that needs follow-up. Specific and plain — no preamble, no headers, no bullet list, just the recap.",
      messages: [{ role: "user", content: text }],
    });
    return NextResponse.json({ ok: true, summary: r.text.trim() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}
