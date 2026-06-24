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
      model: MODELS.sonnet, maxTokens: 1900, temperature: 0.2,
      system: SUMMARY_SYSTEM,
      messages: [{ role: "user", content: `Meeting notes / transcript:\n\n${text}` }],
    });
    return NextResponse.json({ ok: true, summary: r.text.trim() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}

// House format for GT3 meeting summaries — Action Items first, then a titled, sectioned recap.
// Markdown only (rendered by components/Markdown.tsx). Grounded: never invent items not in the notes.
const SUMMARY_SYSTEM = `You are the meeting scribe for GT3 Performance Bar, a mobile beverage-truck business. Turn the raw meeting notes or transcript into a clean, structured recap in GitHub-flavored Markdown. Follow this EXACT structure and nothing else:

## Action Items
- **Short imperative title**
  One concise sentence on what to do / the outcome.
(4–7 of the most concrete, owner-actionable follow-ups. Each is a bold title line followed by a one-line description on the next line. Skip pure discussion.)

# <Title of the meeting — a short descriptive phrase>

## 1. <First major topic>
- Key discussion point, specific and plain.
- Another point. Preserve concrete details (quantities, names, places, recipes, logistics).

**Key <Topic> Items:** (only if the notes list concrete items — e.g. a packing list)
- item
- item

**Questions/Considerations:** (only if raised)
- question

**Decisions:** (only if decisions were made)
- decision

## 2. <Next topic>
...(repeat the section pattern for each major topic; number them)...

Rules:
- Use ONLY information present in the notes. Never invent tasks, items, numbers, or decisions.
- Keep titles tight; keep bullets specific. No preamble, no closing remarks, no meta commentary — output only the Markdown document.
- Omit any optional sub-block (Key Items / Questions / Decisions) when the notes have nothing for it.
- Match GT3's reality: real menu names (Nature Aid, salted maple latte, nitro cold brew), gear, and event types as written in the notes.`;
