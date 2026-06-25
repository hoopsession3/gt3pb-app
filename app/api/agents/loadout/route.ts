import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { academyKnowledge } from "@/lib/operatorKb";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
// BOTTLE LOADOUT — how to pack the bottles for the car, and what to pack them in. Bottle COUNT is
// computed deterministically from the batch gallons + bottle size; the agent produces the packing &
// transport plan: containers, ice strategy, layering to protect glass, cold-hold, vehicle placement,
// and a load-in checklist. Grounded in GT3 SOPs (glass 10/16 oz, cold-hold). Staff-gated, read-only.

const OZ_PER_GAL = 128;

const TOOL: ToolDef = {
  name: "loadout_plan",
  description: "A practical plan to pack and transport finished GT3 bottles safely and cold. The bottle COUNT is given — don't recompute it.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One line: the shape of this load (counts + how many coolers)." },
      containers: { type: "array", description: "What to pack the bottles in.", items: { type: "object", properties: { what: { type: "string", description: "e.g. 'Hard cooler (48qt)', 'Wine-shipper insert (12-bottle)'" }, count: { type: "string", description: "how many, e.g. '3'" }, note: { type: "string", description: "why / how to use it" } }, required: ["what", "count"] } },
      ice: { type: "string", description: "Cold strategy — gel/ice packs (not loose ice for glass), how many, where they go, target temp." },
      layout: { type: "array", items: { type: "string" }, description: "Ordered steps to pack a cooler so glass doesn't shift or break (dividers, upright, layers)." },
      vehicle: { type: "string", description: "How to load and secure the coolers in the car (low, centered, braced, out of sun, AC on)." },
      checklist: { type: "array", items: { type: "string" }, description: "A short load-in checklist to run before pulling off." },
    },
    required: ["summary", "containers", "ice", "layout"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const bottleOz = [10, 16].includes(Number(body.bottle_oz)) ? Number(body.bottle_oz) : 10;

  let gallons = Number(body.gallons) || 0;
  let recipeName: string | null = null;
  if (body.batch_id) {
    const { data: b } = await supabaseAdmin.from("brew_batches").select("batch_gal, recipe_name").eq("id", body.batch_id).maybeSingle();
    if (b) { gallons = Number((b as any).batch_gal) || gallons; recipeName = (b as any).recipe_name; }
  }
  if (gallons <= 0) return NextResponse.json({ ok: false, error: "gallons or batch_id required" }, { status: 400 });

  const bottles = Math.floor((gallons * OZ_PER_GAL) / bottleOz); // exact count
  const base = { ok: true, gallons, bottle_oz: bottleOz, bottles, recipe_name: recipeName };

  if (!anthropicEnabled()) {
    return NextResponse.json({ ...base, summary: `${bottles} × ${bottleOz}oz bottles to pack.`, containers: [], ice: "Pre-chill bottles + coolers; gel/ice packs between rows; hold under 40°F.", layout: ["Bottles upright in dividers", "Gel packs between layers", "Pack snug so nothing shifts"], vehicle: "Load low and centered, braced, out of sun, AC on.", checklist: [] });
  }

  const fmt = { ...base, vehicle_notes: String(body.vehicle ?? "").slice(0, 300), bottle_type: "GT3 glass bottles (breakable; must stay cold)" };
  let out: any = null;
  try {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 1100, temperature: 0.2,
      system:
        "You are GT3 Performance Bar's loadout lead. The crew (Ryan & Kayla) is packing finished GLASS bottles to drive to an event — they must arrive cold and unbroken. The bottle COUNT is given; never recompute it. Give a practical packing & transport plan: what to pack them in (hard coolers / insulated crates, with dividers — wine-shipper inserts or foam sleeves — for glass), the cold strategy (gel/ice packs, NOT loose ice, target under 40°F, pre-chill), how to layer so glass stays upright and can't shift or clink, how to load and secure the coolers in the vehicle (low, centered, braced, shaded, AC on), and a short load-in checklist. Be specific to the count given (how many coolers/inserts). Don't invent gear they didn't mention beyond standard cooler/divider options. Never make health claims. Always answer with the loadout_plan tool.\n\n=== GT3 SOPs ===\n" +
        academyKnowledge().slice(0, 4000),
      messages: [{ role: "user", content: `Plan the bottle loadout.\n\n${JSON.stringify(fmt)}` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "loadout_plan" },
    });
    out = r.toolUses.find((t) => t.name === "loadout_plan")?.input ?? null;
  } catch (err: any) {
    return NextResponse.json({ ...base, summary: `${bottles} × ${bottleOz}oz bottles.`, containers: [], ice: "Gel/ice packs between rows; pre-chill; hold under 40°F.", layout: ["Upright in dividers", "Packs between layers", "Snug — no shift"], vehicle: "Low, centered, braced, shaded.", checklist: [], ai_error: String(err?.message ?? err).slice(0, 200) });
  }

  return NextResponse.json({
    ...base,
    summary: out?.summary || `${bottles} × ${bottleOz}oz bottles.`,
    containers: Array.isArray(out?.containers) ? out.containers.slice(0, 8) : [],
    ice: out?.ice || "",
    layout: Array.isArray(out?.layout) ? out.layout.map((s: any) => String(s).slice(0, 240)) : [],
    vehicle: out?.vehicle || "",
    checklist: Array.isArray(out?.checklist) ? out.checklist.map((s: any) => String(s).slice(0, 200)) : [],
  });
}
