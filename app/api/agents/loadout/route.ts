import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { academyKnowledge } from "@/lib/operatorKb";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// BOTTLE LOADOUT — how to pack the bottles for the car, and what to pack them in. Bottle COUNT is
// computed deterministically from the batch gallons + bottle size; the agent produces the packing &
// transport plan: containers, ice strategy, layering to protect glass, cold-hold, vehicle placement,
// and a load-in checklist. Grounded in GT3 SOPs (glass 10/16 oz, cold-hold). Staff-gated, read-only.

const OZ_PER_GAL = 128;

// Fill `needGal` from the keg fleet, picking the smallest keg that covers the remainder (least waste),
// else the largest available. Falls back to an assumed corny size when no kegs are configured.
function allocateKegs(needGal: number, inv: { name: string; cap: number; qty: number }[], fallbackCap: number) {
  type Used = { name: string; capacity_gal: number; count: number };
  if (needGal <= 0.001) return { plan: [] as Used[], shortfall: 0 };
  const pool = inv.length ? inv.map((k) => ({ ...k })) : [{ name: `${fallbackCap} gal keg`, cap: fallbackCap, qty: 999 }];
  const used: Record<string, Used> = {};
  let need = needGal, guard = 0;
  while (need > 0.001 && guard++ < 100) {
    const avail = pool.filter((k) => k.qty > 0);
    if (!avail.length) break;
    const covers = avail.filter((k) => k.cap >= need - 0.001).sort((a, b) => a.cap - b.cap);
    const pick = covers[0] ?? avail.slice().sort((a, b) => b.cap - a.cap)[0];
    pick.qty--;
    const key = `${pick.name}|${pick.cap}`;
    (used[key] ??= { name: pick.name, capacity_gal: pick.cap, count: 0 }).count++;
    need -= pick.cap;
  }
  return { plan: Object.values(used), shortfall: Math.max(0, need) };
}

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
  const kegSizeGal = Number(body.keg_size_gal) > 0 ? Number(body.keg_size_gal) : 5; // corny keg default

  let gallons = Number(body.gallons) || 0;
  let recipeName: string | null = null;
  if (body.batch_id) {
    const { data: b } = await supabaseAdmin.from("brew_batches").select("batch_gal, recipe_name").eq("id", body.batch_id).maybeSingle();
    if (b) { gallons = Number((b as any).batch_gal) || gallons; recipeName = (b as any).recipe_name; }
  }
  if (gallons <= 0) return NextResponse.json({ ok: false, error: "gallons or batch_id required" }, { status: 400 });

  // Pack-out split: how much goes to keg vs bottle. Bottles each need one UVDTF label.
  const kegGal = Math.min(Math.max(0, Number(body.keg_gal) || 0), gallons);
  const bottleGal = Math.max(0, gallons - kegGal);
  const bottles = Math.floor((bottleGal * OZ_PER_GAL) / bottleOz); // exact count
  const uvdtf_labels = bottles;                                    // one UVDTF label per bottle
  const label_order = Math.ceil(bottles * 1.05);                   // suggest ~5% spares for misapplies

  // Allocate the keg gallons to the REAL keg fleet (mixed sizes), not an assumed 5-gal corny.
  const { data: kegRows } = await supabaseAdmin.from("kegs").select("name, capacity_gal, qty").is("archived_at", null).order("capacity_gal", { ascending: false });
  const inv = (kegRows ?? []).map((k: any) => ({ name: String(k.name), cap: Number(k.capacity_gal), qty: Number(k.qty) })).filter((k) => k.cap > 0 && k.qty > 0);
  const { plan: kegPlan, shortfall: kegShortfallGal } = allocateKegs(kegGal, inv, kegSizeGal);
  const kegs = kegPlan.reduce((s, k) => s + k.count, 0);
  const kegLabel = kegPlan.map((k) => `${k.count}× ${k.capacity_gal}gal`).join(" + ");

  const base = { ok: true, gallons, bottle_oz: bottleOz, keg_gal: kegGal, bottle_gal: bottleGal, kegs, keg_plan: kegPlan, keg_shortfall_gal: kegShortfallGal, keg_size_gal: kegSizeGal, bottles, uvdtf_labels, label_order, recipe_name: recipeName };

  const packSummary = `${bottles} × ${bottleOz}oz bottles (${uvdtf_labels} UVDTF labels)${kegs ? ` + ${kegLabel}` : ""}${kegShortfallGal > 0.01 ? ` — short ${kegShortfallGal.toFixed(1)} gal of keg space` : ""}.`;
  if (!anthropicEnabled()) {
    return NextResponse.json({ ...base, summary: packSummary, containers: [], ice: "Pre-chill bottles + coolers; gel/ice packs between rows; hold under 40°F.", layout: ["Bottles upright in dividers", "Gel packs between layers", "Pack snug so nothing shifts"], vehicle: "Load low and centered, braced, out of sun, AC on.", checklist: [] });
  }

  const fmt = { ...base, vehicle_notes: String(body.vehicle ?? "").slice(0, 300), bottle_type: "GT3 glass bottles (breakable; must stay cold)" };
  let out: any = null;
  try {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 1100, temperature: 0.2,
      system:
        "You are GT3 Performance Bar's pack-out & loadout lead. The crew (Ryan & Kayla) is packing out a finished cold-brew batch — some to KEGS, the rest to GLASS bottles — to drive to an event cold and unbroken. The split is already computed (keg_gal/kegs, bottle_gal/bottles, uvdtf_labels = one label per bottle); NEVER recompute counts. Give a practical pack-out & transport plan: bottle containers (hard coolers / insulated crates, with dividers — wine-shipper inserts or foam sleeves — for glass), the cold strategy (gel/ice packs, NOT loose ice, under 40°F, pre-chill), how to layer so glass stays upright and can't shift or clink, how to handle/transport the keg(s) cold and secured if kegs > 0, how to load and secure everything in the vehicle (low, centered, braced, shaded, AC on), and a short load-in checklist (include 'apply UVDTF labels — N bottles' and 'order ~label_order labels with spares'). Be specific to the counts given. Don't invent gear beyond standard cooler/divider/keg options. Never make health claims. Always answer with the loadout_plan tool.\n\n=== GT3 SOPs ===\n" +
        academyKnowledge().slice(0, 4000),
      messages: [{ role: "user", content: `Plan the bottle loadout.\n\n${JSON.stringify(fmt)}` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "loadout_plan" },
    });
    out = r.toolUses.find((t) => t.name === "loadout_plan")?.input ?? null;
  } catch (err: any) {
    return NextResponse.json({ ...base, summary: packSummary, containers: [], ice: "Gel/ice packs between rows; pre-chill; hold under 40°F.", layout: ["Upright in dividers", "Packs between layers", "Snug — no shift"], vehicle: "Low, centered, braced, shaded.", checklist: [], ai_error: String(err?.message ?? err).slice(0, 200) });
  }

  return NextResponse.json({
    ...base,
    summary: out?.summary || packSummary,
    containers: Array.isArray(out?.containers) ? out.containers.slice(0, 8) : [],
    ice: out?.ice || "",
    layout: Array.isArray(out?.layout) ? out.layout.map((s: any) => String(s).slice(0, 240)) : [],
    vehicle: out?.vehicle || "",
    checklist: Array.isArray(out?.checklist) ? out.checklist.map((s: any) => String(s).slice(0, 200)) : [],
  });
}
