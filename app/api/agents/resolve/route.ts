import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { academyKnowledge } from "@/lib/operatorKb";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
// RESOLVE — propose how to COMPLETE a follow-up. If GT3's own data/knowledge already answers it
// (e.g. the inventory list lives in our DB), give the answer directly; otherwise propose concrete
// steps. Grounded on the Academy + live inventory/assets. Persists the proposal on the task.

const TOOL: ToolDef = {
  name: "propose_completion",
  description: "Propose how to complete the follow-up.",
  input_schema: {
    type: "object",
    properties: {
      have_answer: { type: "boolean", description: "true if GT3's own knowledge/data already answers or completes this (you could just hand it over)." },
      proposal: { type: "string", description: "If have_answer: give the answer/result directly (e.g. the actual inventory we have). Else: concrete steps to complete it. Brief and specific. Never invent facts." },
    },
    required: ["have_answer", "proposal"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let task_id = "";
  try { ({ task_id = "" } = await req.json()); } catch { /* */ }
  if (!task_id) return NextResponse.json({ ok: false, error: "task_id required" }, { status: 400 });

  const { data: task } = await supabaseAdmin.from("event_tasks").select("id, label").eq("id", task_id).maybeSingle();
  if (!task) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const [a, i] = await Promise.all([
    supabaseAdmin.from("assets").select("name, brand, use_case, qty").limit(250),
    supabaseAdmin.from("inventory_items").select("name, qty, qty_event_ready, reorder_point, status, unit, category, critical").limit(250),
  ]);
  const assets = (a.data ?? []).map((x: any) => `- ${x.name}${x.brand ? ` (${x.brand})` : ""}${x.qty != null ? ` ×${x.qty}` : ""}${x.use_case ? ` — ${x.use_case}` : ""}`).join("\n");
  const inv = (i.data ?? []).map((x: any) => `- ${x.name}: ${x.qty ?? "?"}${x.unit ? ` ${x.unit}` : ""}${x.status ? ` (${x.status})` : ""}${x.critical ? " [critical]" : ""}`).join("\n");

  const system = `You help a beverage-truck team (GT3 Performance Bar) COMPLETE a follow-up action. Using ONLY GT3's knowledge + live data below, either:
(a) if we ALREADY have what's needed, hand it over — set have_answer true and put the answer/result in the proposal (e.g. our actual inventory, the recipe, the procedure); or
(b) propose a concrete, specific way to complete it — short numbered steps.
Be brief and practical. NEVER invent facts (no nutrition/health claims, no made-up stock). If our data doesn't cover it, say what's still needed. Always answer with propose_completion.

=== GT3 KNOWLEDGE ===
${academyKnowledge()}

=== INVENTORY ON HAND ===
${inv || "(none loaded)"}

=== ASSETS / GEAR ===
${assets || "(none loaded)"}`;

  let out: { have_answer: boolean; proposal: string } | null = null;
  try {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 700, temperature: 0.3, system,
      messages: [{ role: "user", content: `Follow-up: ${task.label}` }],
      tools: [TOOL], tool_choice: { type: "tool", name: "propose_completion" },
    });
    out = r.toolUses.find((t) => t.name === "propose_completion")?.input ?? null;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
  if (!out) return NextResponse.json({ ok: false, error: "no proposal" }, { status: 502 });

  await supabaseAdmin.from("event_tasks").update({ ai_proposal: out.proposal, ai_has_answer: !!out.have_answer }).eq("id", task_id);
  return NextResponse.json({ ok: true, proposal: out.proposal, have_answer: !!out.have_answer });
}
