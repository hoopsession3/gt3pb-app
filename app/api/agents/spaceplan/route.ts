import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { computeSpace, rigToBox, type TrailerProfile } from "@/lib/loadout";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// LOAD-OUT SPACE AGENT — "does it all fit, and where does it go?" The fit is computed
// DETERMINISTICALLY (each pack item's footprint vs the rig's usable interior volume + floor),
// so the numbers are always honest; the agent turns that into an actual arrangement: what rides
// where (front / over-axle / rear, floor vs stacked), what to nest/collapse to claw back space,
// what's at risk of not fitting, and the load order (last in = first out at service). Staff-gated.

const TOOL: ToolDef = {
  name: "space_plan",
  description: "A practical arrangement to fit this load in the rig's space. The fit numbers are given — don't recompute them.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One line: does it fit, and how tight (reference the cu ft used vs usable)." },
      zones: {
        type: "array",
        description: "Where each thing rides. For a trailer use front / over-axle / rear (heaviest low + over axle); for a vehicle bay use floor / on-top / footwells.",
        items: { type: "object", properties: {
          zone: { type: "string", description: "e.g. 'Over axle (floor)', 'Front (nose)', 'Rear by the door', 'On top / second layer'" },
          items: { type: "array", items: { type: "string" }, description: "items that ride here" },
          note: { type: "string", description: "why / how (secured, upright, last out)" },
        }, required: ["zone", "items"] },
      },
      stacking: { type: "array", items: { type: "string" }, description: "How to claw back space — nest coolers, collapse the canopy, kegs upright in a corner, etc." },
      at_risk: {
        type: "array",
        description: "Items that may not fit or are awkward — only if space is tight or over.",
        items: { type: "object", properties: { item: { type: "string" }, issue: { type: "string" }, fix: { type: "string" } }, required: ["item", "fix"] },
      },
      load_order: { type: "array", items: { type: "string" }, description: "Order to load so first-needed comes out first (last in, first out at the booth)." },
    },
    required: ["summary", "zones"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const eventId: string | undefined = body.event_id;
  const stopId: string | undefined = body.stop_id;
  if (!eventId && !stopId) return NextResponse.json({ ok: false, error: "event_id or stop_id required" }, { status: 400 });
  const ownerCol = eventId ? "event_id" : "stop_id";
  const ownerId = eventId || stopId;

  const [{ data: tp }, { data: tasks }, ownerRes] = await Promise.all([
    supabaseAdmin.from("trailer_profile").select("*").eq("id", 1).maybeSingle(),
    supabaseAdmin.from("event_tasks").select("label, kind").eq(ownerCol, ownerId),
    eventId
      ? supabaseAdmin.from("events").select("title, rig").eq("id", eventId).maybeSingle()
      : supabaseAdmin.from("stops").select("name, rig").eq("id", stopId).maybeSingle(),
  ]);
  if (!tp) return NextResponse.json({ ok: false, error: "trailer profile not set up" }, { status: 404 });

  const owner: any = ownerRes?.data ?? {};
  const ownerName = owner.title || owner.name || (eventId ? "Event" : "Stop");
  const rig = rigToBox(owner.rig);
  const labels = ((tasks as { label: string; kind: string }[]) ?? []).filter((t) => t.kind === "pack").map((t) => t.label);
  const space = computeSpace(labels, tp as TrailerProfile, rig);

  const fitNote = !space.hasDims
    ? "No interior dimensions set for this rig — add them to get a fit %."
    : `${space.usedCuft} of ${space.usableCuft} usable cu ft (${Math.round((space.usedCuft / (space.usableCuft || 1)) * 100)}%), floor ${space.usedSqft}/${space.usableSqft} sq ft. ${space.cuftLevel === "over" ? "OVER — something has to give." : space.cuftLevel === "warn" ? "Tight." : "Fits with room."}`;
  const base = { ok: true, rig, box_name: space.boxName, owner: ownerName, space, fit_note: fitNote };

  if (!anthropicEnabled() || labels.length === 0) {
    return NextResponse.json({ ...base, summary: fitNote, zones: [], stacking: [], at_risk: [], load_order: [] });
  }

  const fmt = {
    rig, box_name: space.boxName,
    usable_cu_ft: space.usableCuft, used_cu_ft: space.usedCuft, fit_level: space.cuftLevel,
    usable_floor_sq_ft: space.usableSqft, used_floor_sq_ft: space.usedSqft,
    items: space.items.map((i) => `${i.label} (~${i.cuft} cu ft, ~${i.sqft} sq ft)`),
  };
  let out: any = null;
  try {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 1100, temperature: 0.3,
      system:
        "You are GT3 Performance Bar's load-out lead, packing the rig to drive to an event. The FIT is already computed deterministically (used vs usable cu ft + floor sq ft, per-item footprints) — NEVER recompute or contradict those numbers; build the arrangement around them. " +
        "Give a real plan: which items ride where (a TRAILER: heaviest low and over the axle for tongue weight, light to the nose/tail, fragile/cold last so it's first out; a VEHICLE bay: floor first, stack light on top, long items along the side, nothing blocking the hatch); how to claw back space (nest coolers, collapse the canopy, kegs upright in a corner, break down the cart); anything at risk of not fitting and what to drop or how to nest it (ONLY if tight or over); and the load order so the first thing needed at the booth comes out first. Be concrete and brief. Don't invent gear that isn't in the list. Never make health claims. Always answer with the space_plan tool.",
      messages: [{ role: "user", content: `Plan the load-out arrangement for "${ownerName}".\n\n${JSON.stringify(fmt)}` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "space_plan" },
    });
    out = r.toolUses.find((t) => t.name === "space_plan")?.input ?? null;
  } catch (err: any) {
    return NextResponse.json({ ...base, summary: fitNote, zones: [], stacking: [], at_risk: [], load_order: [], ai_error: String(err?.message ?? err).slice(0, 200) });
  }

  return NextResponse.json({
    ...base,
    summary: out?.summary || fitNote,
    zones: Array.isArray(out?.zones) ? out.zones.slice(0, 8) : [],
    stacking: Array.isArray(out?.stacking) ? out.stacking.map((s: any) => String(s).slice(0, 240)) : [],
    at_risk: Array.isArray(out?.at_risk) ? out.at_risk.slice(0, 8) : [],
    load_order: Array.isArray(out?.load_order) ? out.load_order.map((s: any) => String(s).slice(0, 200)) : [],
  });
}
