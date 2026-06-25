import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { academyKnowledge } from "@/lib/operatorKb";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
// BREW AI — scale a recipe to an exact batch size (gallons of water), hit the spec ("OG"/Signal
// Score), and SCHEDULE the batch back from when it's needed (cold extraction + hold lead time).
// The scaling MATH is deterministic in code (linear in water volume) — the agent never multiplies
// numbers, it does the judgment: the schedule, the servable yield, inventory flags, and the quality
// checkpoints that hold the standard. Two phases: plan (no writes) → commit (creates a brew_batch).

const SERVE_OZ = 10; // standard pour (academy: ~210 mg caffeine / 10 oz)
const OZ_PER_GAL = 128;
const round = (n: number) => Math.round(n * 10) / 10;

// Linear scale of a recipe's ingredient list to a target water volume. Exact, deterministic.
function scaleIngredients(ingredients: any[], factor: number) {
  return (ingredients ?? []).map((i: any) => ({
    name: String(i.name ?? "").slice(0, 80),
    qty: i.scales === false ? i.qty : round(Number(i.qty ?? 0) * factor),
    unit: String(i.unit ?? "").slice(0, 24),
    scales: i.scales !== false,
  }));
}

const TOOL: ToolDef = {
  name: "brew_plan",
  description: "The judgment around a brew batch whose ingredient scaling is ALREADY computed for you. Do not change the scaled quantities; reason about timing, yield, stock, and quality.",
  input_schema: {
    type: "object",
    properties: {
      spec: { type: "string", description: "The target to hit this batch — restate the recipe's OG/Signal-Score spec in one line." },
      brew_note: { type: "string", description: "One line on WHEN to start brewing to be ready in time, given the extraction + hold window (and the event date if provided)." },
      steps: { type: "array", items: { type: "string" }, description: "The method for THIS batch size, in order — concrete and scaled (reference the computed quantities, don't recompute)." },
      checks: { type: "array", items: { type: "string" }, description: "Quality checkpoints that hold the standard (e.g. 'taste at 18h before filtering', 'log Signal Score, target 8+')." },
      inventory_flags: { type: "array", items: { type: "string" }, description: "Stock you may be short on for this batch, given the inventory provided. Empty if covered." },
    },
    required: ["spec", "brew_note", "steps"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const recipeId: string | undefined = body.recipe_id;
  if (!recipeId) return NextResponse.json({ ok: false, error: "recipe_id required" }, { status: 400 });

  const { data: recipe } = await supabaseAdmin.from("brew_recipes").select("*").eq("id", recipeId).maybeSingle();
  if (!recipe) return NextResponse.json({ ok: false, error: "recipe not found" }, { status: 404 });

  const batchGal = Math.max(0.25, Number(body.batch_gal) || 1);
  const baseGal = Math.max(0.01, Number((recipe as any).base_water_gal) || 1);
  const factor = batchGal / baseGal;
  const scaled = scaleIngredients((recipe as any).ingredients, factor);

  // Deterministic yield + schedule.
  const yieldFactor = Number((recipe as any).yield_factor) || 0.92;
  const finishedOz = batchGal * OZ_PER_GAL * yieldFactor;
  const servings = Math.floor(finishedOz / SERVE_OZ);
  const extractionHours = Number((recipe as any).extraction_hours) || 0;

  // If tied to an event (or an explicit need-by date), back-schedule the brew start.
  let eventDay: string | null = null, eventTitle: string | null = null;
  if (body.event_id) {
    const { data: e } = await supabaseAdmin.from("events").select("title, day, day_label").eq("id", body.event_id).maybeSingle();
    if (e) { eventDay = (e as any).day; eventTitle = (e as any).title; }
  }
  const needBy: string | null = body.need_by || eventDay || null;
  let brewDate: string | null = null, readyAt: string | null = null;
  if (needBy) {
    const need = new Date(`${needBy}T08:00:00`);
    const start = new Date(need.getTime() - Math.ceil(extractionHours) * 3600 * 1000);
    brewDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
    readyAt = new Date(new Date(`${brewDate}T08:00:00`).getTime() + extractionHours * 3600 * 1000).toISOString();
  }

  // ── COMMIT: log the batch to the schedule ──
  if (body.commit) {
    const { data: ins, error } = await supabaseAdmin.from("brew_batches").insert({
      recipe_id: recipeId, recipe_name: (recipe as any).name, batch_gal: batchGal,
      brew_date: brewDate, ready_at: readyAt, event_id: body.event_id ?? null,
      target_spec: (recipe as any).target_spec ?? null, scaled, status: "planned",
      extraction_hours: extractionHours,
      og: typeof body.commit.og === "string" ? body.commit.og.slice(0, 60) : ((recipe as any).target_spec ?? null),
      notes: typeof body.commit.notes === "string" ? body.commit.notes.slice(0, 600) : null,
    }).select("id").maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, batch_id: ins?.id ?? null });
  }

  // ── PLAN: deterministic numbers + (if AI configured) the judgment around them ──
  const base = {
    ok: true,
    recipe: { id: recipeId, name: (recipe as any).name, style: (recipe as any).style, ratio: (recipe as any).ratio, target_spec: (recipe as any).target_spec },
    batch_gal: batchGal, factor: round(factor), scaled,
    servings, finished_oz: Math.round(finishedOz), serve_oz: SERVE_OZ,
    extraction_hours: extractionHours, brew_date: brewDate, ready_at: readyAt,
    event: eventTitle ? { title: eventTitle, day: eventDay } : null,
  };

  if (!anthropicEnabled()) {
    // Still fully usable without AI — return the exact scaling + a plain schedule note.
    return NextResponse.json({ ...base, spec: (recipe as any).target_spec ?? "", brew_note: brewDate ? `Start brewing ${brewDate} to be ready for ${needBy}.` : `Allow ${extractionHours}h extraction + hold.`, steps: (recipe as any).method ?? [], checks: [], inventory_flags: [] });
  }

  const { data: inv } = await supabaseAdmin.from("inventory_items").select("name, qty, unit, reorder_point, status").or("use_cases.cs.{coffee},name.ilike.%coffee%,name.ilike.%bean%,name.ilike.%water%,name.ilike.%coconut%");
  const fmt = {
    ...base,
    method_template: (recipe as any).method ?? [],
    recipe_notes: (recipe as any).notes ?? "",
    need_by: needBy,
    inventory_on_hand: (inv ?? []).map((i: any) => `${i.name}: ${i.qty ?? "?"} ${i.unit ?? ""}${i.reorder_point != null ? ` (reorder@${i.reorder_point})` : ""}${i.status ? ` [${i.status}]` : ""}`),
  };

  let out: any = null;
  try {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 1200, temperature: 0.2,
      system:
        "You are the brew lead for GT3 Performance Bar. A batch has ALREADY been scaled for you deterministically (the `scaled` ingredient list and `servings`/`finished_oz` are exact — NEVER change or recompute them). Your job is the judgment: confirm the spec to hit, give the schedule note (when to start so it's ready in time, using extraction_hours + the need-by/event date), write the method steps for THIS batch size referencing the computed quantities, list quality checkpoints that hold GT3's standard (Signal Score 8+, traceability/batch logging), and flag any inventory you may be short on from the on-hand list. Be exact and practical; hold the high standard. Never invent health/nutrition claims. Always answer with the brew_plan tool.\n\n=== GT3 SOPs / COOKBOOK ===\n" +
        academyKnowledge().slice(0, 6000),
      messages: [{ role: "user", content: `Plan this brew batch.\n\n${JSON.stringify(fmt)}` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "brew_plan" },
    });
    out = r.toolUses.find((t) => t.name === "brew_plan")?.input ?? null;
  } catch (err: any) {
    // AI down — still return the exact deterministic plan so the crew is never blocked.
    return NextResponse.json({ ...base, spec: (recipe as any).target_spec ?? "", brew_note: brewDate ? `Start ${brewDate} for ${needBy}.` : `Allow ${extractionHours}h extraction.`, steps: (recipe as any).method ?? [], checks: [], inventory_flags: [], ai_error: String(err?.message ?? err).slice(0, 200) });
  }

  return NextResponse.json({
    ...base,
    spec: out?.spec || (recipe as any).target_spec || "",
    brew_note: out?.brew_note || "",
    steps: Array.isArray(out?.steps) ? out.steps.map((s: any) => String(s).slice(0, 300)) : ((recipe as any).method ?? []),
    checks: Array.isArray(out?.checks) ? out.checks.map((s: any) => String(s).slice(0, 200)) : [],
    inventory_flags: Array.isArray(out?.inventory_flags) ? out.inventory_flags.map((s: any) => String(s).slice(0, 200)) : [],
  });
}
