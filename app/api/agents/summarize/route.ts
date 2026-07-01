import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// SUMMARIZE — turn a meeting transcript into the whole note in one shot: a title, the house-format
// recap (Action Items → sections → Decisions), AND a structured action-item list the composer turns
// into assignable follow-up tasks. Grounded — only what's in the notes. Sonnet.

const CATS = ["admin", "ops", "event", "content"];
const TOOL: ToolDef = {
  name: "note_recap",
  description: "Title, structured recap, and action items extracted from a meeting transcript.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short, specific meeting title (a phrase, not a sentence)." },
      summary: { type: "string", description: "The full recap in GitHub-flavored Markdown, in the house format described in the system prompt (Action Items block, then numbered topic sections with Key Items / Questions / Decisions)." },
      action_items: {
        type: "array",
        description: "The concrete, owner-actionable follow-ups (the same ones in the Action Items block), as a structured task list. Skip pure discussion.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Imperative and specific, e.g. 'Order 4 cases of 16oz bottles before Thursday'." },
            category: { type: "string", enum: CATS },
            critical: { type: "boolean", description: "true if time-sensitive or blocks an event." },
          },
          required: ["title", "category"],
        },
      },
    },
    required: ["title", "summary", "action_items"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });

  let text = "";
  try { ({ text = "" } = await req.json()); } catch { /* */ }
  text = String(text).slice(0, 14000);
  if (!text.trim()) return NextResponse.json({ ok: false, error: "nothing to summarize" }, { status: 400 });

  try {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 2000, temperature: 0.2,
      system: SUMMARY_SYSTEM,
      messages: [{ role: "user", content: `Meeting notes / transcript:\n\n${text}` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "note_recap" },
    });
    const out = r.toolUses.find((t) => t.name === "note_recap")?.input;
    if (!out?.summary) return NextResponse.json({ ok: false, error: "no recap" }, { status: 502 });
    const actionItems = (out.action_items ?? []).filter((a: any) => a?.title?.trim()).map((a: any) => ({
      title: String(a.title).slice(0, 300), category: CATS.includes(a.category) ? a.category : "ops", critical: !!a.critical,
    }));
    return NextResponse.json({ ok: true, title: String(out.title ?? "").slice(0, 200), summary: String(out.summary).trim(), actionItems });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}

// House format for GT3 meeting summaries — Action Items first, then a titled, sectioned recap.
// Markdown (rendered by components/Markdown.tsx). Grounded: never invent items not in the notes.
const SUMMARY_SYSTEM = `You are the meeting scribe for GT3 Performance Bar, a mobile beverage-truck business. From the raw meeting notes or transcript, produce a title, a structured recap, and an action-item list, and return them with the note_recap tool.

The "summary" field must be GitHub-flavored Markdown in this EXACT structure and nothing else:

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

**Questions/Considerations:** (only if raised)
- question

**Decisions:** (only if decisions were made)
- decision

## 2. <Next topic>
...(repeat the section pattern for each major topic; number them)...

The "action_items" field is the SAME follow-ups from the Action Items block, as a structured list (title + category + critical) so they become assignable tasks. The "title" field is the meeting title (the same phrase you use in the "# " heading).

Rules:
- Use ONLY information present in the notes. Never invent tasks, items, numbers, decisions, or a title that isn't supported.
- Keep titles tight; keep bullets specific. The summary is only the Markdown document — no preamble or closing remarks.
- Omit any optional sub-block (Key Items / Questions / Decisions) when the notes have nothing for it.
- Match GT3's reality: real menu names (Nature Aide, salted maple latte, nitro cold brew), gear, and event types as written. We serve in glass bottles (10oz / 16oz).`;
