import { NextResponse } from "next/server";
import { staffFromRequest, userFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { claimSafeDeep } from "@/lib/claimGuard";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// AGENT #1 — meeting recap → action items. Reads a meeting note, asks Claude to pull out the
// concrete follow-ups, and files them as event_tasks owned by the note. Each is auto-assigned to the
// note's owner (falling back to whoever ran the recap) so nothing lands orphaned in an unassigned
// limbo — still fully reassignable/deletable in the UI. Human-in-the-loop, minus the dropped items.

const TOOL: ToolDef = {
  name: "propose_followups",
  description: "Return the concrete, actionable follow-ups found in the meeting recap. Only real action items — decisions to act on, things someone must do. Skip pure discussion/FYI.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "The follow-up, imperative and specific (e.g. 'Order 4 cases of 16oz bottles before Thursday')." },
            priority: { type: "string", enum: ["critical", "normal"], description: "critical = time-sensitive or blocks an event." },
          },
          required: ["label", "priority"],
        },
      },
    },
    required: ["items"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let note_id = "";
  try { ({ note_id } = await req.json()); } catch { /* */ }
  if (!note_id) return NextResponse.json({ ok: false, error: "note_id required" }, { status: 400 });

  const { data: note } = await supabaseAdmin.from("meeting_notes").select("id, title, summary, body, created_by").eq("id", note_id).maybeSingle();
  if (!note) return NextResponse.json({ ok: false, error: "note not found" }, { status: 404 });
  // Auto-assign the follow-ups to the note's owner, or whoever triggered the recap — never orphan them.
  const caller = await userFromRequest(req);
  const owner: string | null = (note as any).created_by ?? caller?.id ?? null;
  const text = [note.title, note.summary, note.body].filter(Boolean).join("\n\n").slice(0, 12000);
  if (!text.trim()) return NextResponse.json({ ok: true, added: 0, items: [] });

  let items: { label: string; priority: string }[] = [];
  try {
    const r = await callClaude({ label: "recap",
      model: MODELS.sonnet,
      maxTokens: 1024,
      system: "You turn a beverage-truck team's meeting recap into a clean follow-up list. Be concrete and concise. Never invent tasks that aren't supported by the recap. Always answer with the propose_followups tool.",
      messages: [{ role: "user", content: `Meeting recap:\n\n${text}` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "propose_followups" },
    });
    const raw = (r.toolUses.find((t) => t.name === "propose_followups")?.input?.items ?? []).filter((i: any) => i?.label?.trim());
    // Deterministic backstop (F5 — output claim-guard): a meeting recap can discuss a claim (to REJECT
    // it) — don't let that wording resurface as a task label a staffer might read as an instruction.
    items = raw.filter((i: any) => {
      const guard = claimSafeDeep(i.label);
      if (!guard.ok) console.warn(`[recap] claim-guard dropped a follow-up on "${guard.hit}"`);
      return guard.ok;
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
  if (items.length === 0) return NextResponse.json({ ok: true, added: 0, items: [] });

  // Don't duplicate suggestions the note already has.
  const { data: existing } = await supabaseAdmin.from("event_tasks").select("label").eq("meeting_note_id", note_id);
  const have = new Set((existing ?? []).map((t: any) => t.label.trim().toLowerCase()));
  const rows = items
    .filter((i) => !have.has(i.label.trim().toLowerCase()))
    .map((i, idx) => ({ meeting_note_id: note_id, label: i.label.trim().slice(0, 300), kind: "task", section: "Follow-up", critical: i.priority === "critical", assignee: owner, sort: 1000 + idx }));
  if (rows.length === 0) return NextResponse.json({ ok: true, added: 0, items: [] });

  const { error } = await supabaseAdmin.from("event_tasks").insert(rows);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, added: rows.length, items: rows.map((r) => ({ label: r.label, critical: r.critical })) });
}
