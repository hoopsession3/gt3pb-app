import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { academyKnowledge } from "@/lib/operatorKb";

export const runtime = "nodejs";
export const maxDuration = 30;

/* eslint-disable @typescript-eslint/no-explicit-any */
// TROUBLESHOOT AI — the field-ops first responder. The crew describes what's going wrong RIGHT NOW
// at an event or truck stop (generator tripped, no hot water, CO2 out, reader offline, ran out of
// stock), and the agent returns: the most likely cause(s), an ORDERED do-this-now fix, and prevention
// items. Grounded in that event/stop's config (power/water/rig/load), the gear list, and GT3 SOPs.
// Two phases: diagnose (no writes) → commit (logs the incident to incident_log + turns prevention into
// event_tasks). Staff-gated. Born from a real failure: a generator that couldn't carry the water
// heater + AC at once, so the heater's startup surge tripped the breaker until the AC was shed.

const SYMPTOMS: Record<string, string> = {
  power: "Power / generator (breaker tripped, generator stalling, not enough power, surge on startup)",
  water: "Water / hot water (no flow, no hot water, water heater, pump, tank empty)",
  gas: "Nitro / keg / gas (no cascade, flat pour, lost pressure, regulator, clogged stout faucet, pure N2 not CO2)",
  pos: "POS / payments / connectivity (card reader offline, no signal, app won't load)",
  stock: "Ran out of stock mid-service (a poured item, cups/bottles, ice)",
  other: "Other on-the-ground problem",
};

const TOOL: ToolDef = {
  name: "troubleshoot",
  description: "Diagnose a live field problem at a mobile beverage unit and give an immediate, ordered fix plus prevention. Be practical and specific to the data; when you don't know an exact spec (e.g. a wattage), give the procedure and what to check rather than inventing a number.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One line: the single most likely thing wrong, in plain language." },
      causes: {
        type: "array",
        description: "Ranked likely causes — most likely first.",
        items: {
          type: "object",
          properties: {
            cause: { type: "string", description: "The cause, short." },
            likelihood: { type: "string", enum: ["likely", "possible"] },
            why: { type: "string", description: "One line grounding it in the situation/data." },
          },
          required: ["cause", "likelihood"],
        },
      },
      steps: {
        type: "array",
        description: "Do-this-NOW fix, in order. Each step a single concrete action the crew can take in the field with what they have. Safety first (electrical/gas).",
        items: { type: "string" },
      },
      prevention: {
        type: "array",
        description: "What to change so this doesn't happen again — these become follow-up tasks. Empty if none.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Short imperative, e.g. 'Stagger water-heater and AC startup — never inrush both at once' or 'Size up to a 5000W+ generator for full load'." },
            critical: { type: "boolean", description: "true if leaving it unfixed will block a future service." },
          },
          required: ["label", "critical"],
        },
      },
    },
    required: ["summary", "causes", "steps"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const eventId: string | undefined = body.event_id;
  const stopId: string | undefined = body.stop_id;
  const ownerCol = eventId ? "event_id" : stopId ? "stop_id" : null;
  const ownerId = eventId || stopId || null;

  // ── COMMIT: log the incident + (optionally) write kept prevention items as event_tasks ──
  if (body.commit) {
    const c = body.commit;
    const problem = String(c.problem ?? "").trim().slice(0, 2000);
    if (!problem) return NextResponse.json({ ok: false, error: "problem required" }, { status: 400 });
    const { data: inc, error: incErr } = await supabaseAdmin.from("incident_log").insert({
      event_id: eventId ?? null, stop_id: stopId ?? null,
      symptom: typeof c.symptom === "string" ? c.symptom.slice(0, 40) : null,
      problem, diagnosis: c.diagnosis ?? null,
      severity: c.severity === "blocker" ? "blocker" : "issue",
      resolved: !!c.resolved, resolved_at: c.resolved ? new Date().toISOString() : null,
    }).select("id").maybeSingle();
    if (incErr) return NextResponse.json({ ok: false, error: incErr.message }, { status: 500 });

    let added = 0;
    const prevention = Array.isArray(c.prevention) ? c.prevention.filter((p: any) => !p._skip && p.label?.trim()) : [];
    if (ownerCol && ownerId && prevention.length) {
      const { data: existing } = await supabaseAdmin.from("event_tasks").select("label").eq(ownerCol, ownerId);
      const have = new Set((existing ?? []).map((t: any) => t.label.trim().toLowerCase()));
      const rows = prevention
        .filter((p: any) => !have.has(p.label.trim().toLowerCase()))
        .map((p: any, i: number) => ({ [ownerCol]: ownerId, label: String(p.label).trim().slice(0, 300), section: "Setup", kind: "task", critical: !!p.critical, warn: !p.critical, sort: 900 + i }));
      if (rows.length) {
        const { error } = await supabaseAdmin.from("event_tasks").insert(rows);
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        added = rows.length;
      }
    }
    return NextResponse.json({ ok: true, incident_id: inc?.id ?? null, added });
  }

  // ── DIAGNOSE: ground in the situation, return causes + ordered fix + prevention (no writes) ──
  const symptom: string = typeof body.symptom === "string" ? body.symptom : "other";
  const problem = String(body.problem ?? "").trim().slice(0, 2000);
  if (!problem) return NextResponse.json({ ok: false, error: "Describe what's going wrong." }, { status: 400 });

  // Grounding: the event/stop config (power/water/rig matter most for field failures) + the gear list.
  const { data: assets } = await supabaseAdmin.from("assets").select("name, brand, make_model, use_case, qty, notes");
  let target: any = null, kind = "general (no event/stop attached)";
  if (eventId) {
    const { data: e } = await supabaseAdmin.from("events").select("title, day_label, location_text, state, county, rig, power_available, water_available, expected_attendance, staff_count, duration_hrs, menu_nitro, menu_nature_aid, menu_salted_maple, menu_bottles, menu_broth, blurb").eq("id", eventId).maybeSingle();
    if (e) { target = e; kind = "event"; }
  } else if (stopId) {
    const { data: s } = await supabaseAdmin.from("stops").select("name, location_text, address, notes, menu_tier, starts_at").eq("id", stopId).maybeSingle();
    if (s) { target = s; kind = "truck stop (on-the-ground ops)"; }
  }

  const fmt = {
    kind, target,
    symptom_category: SYMPTOMS[symptom] ?? SYMPTOMS.other,
    problem,
    gear: (assets ?? []).map((a: any) => `${a.name}${a.make_model ? ` [${a.make_model}]` : ""}${a.brand ? ` (${a.brand})` : ""}${a.qty != null ? ` ×${a.qty}` : ""}${a.use_case ? ` — ${a.use_case}` : ""}${a.notes ? ` · ${a.notes}` : ""}`),
  };

  let out: { summary: string; causes: any[]; steps: string[]; prevention?: any[] } | null = null;
  try {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 1600, temperature: 0.2,
      system:
        "You are the field-ops troubleshooter for GT3 Performance Bar, a mobile beverage truck/cart. The crew is on site with a problem RIGHT NOW and needs to get back to serving fast and safely. Diagnose from the data given (the event/stop config — especially power/water/rig/load — the gear list, GT3's SOPs below, and the crew's description). " +
        "Think like an experienced mobile-unit operator. Common field failures and how to reason about them: " +
        "POWER — a generator carries the sum of RUNNING watts plus the biggest STARTUP surge; appliances with motors/heating elements (water heater, AC, blender, ice maker) spike 2–4× on startup. If a breaker trips when a second high-draw appliance kicks on, the load exceeded the generator — shed or stagger loads (don't inrush two big draws at once), bring them up one at a time, or size up the generator. WATER/HOT WATER — check the heater's own breaker/reset, power or propane supply, that the tank isn't empty and the pump is primed. CO2/KEG — check tank level, regulator set pressure, lines/connections, temperature (warm keg foams). POS — connectivity/signal, reader battery/pairing, offline mode. STOCK — substitute, ration, or send a runner; flag the reorder. " +
        "Be SAFETY-FIRST with electrical and gas. Give an ORDERED do-this-now fix the crew can actually perform with what they have. When you don't know an exact spec (a wattage, a model's behavior), give the procedure and what to check — never invent a number. Then give prevention items that would stop a repeat. Always answer with the troubleshoot tool.\n\n=== GT3 SOPs / KNOWLEDGE ===\n" +
        academyKnowledge().slice(0, 7000),
      messages: [{ role: "user", content: `Field problem to troubleshoot:\n\n${JSON.stringify(fmt)}` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "troubleshoot" },
    });
    out = r.toolUses.find((t) => t.name === "troubleshoot")?.input ?? null;
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 502 });
  }
  if (!out) return NextResponse.json({ ok: false, error: "Couldn't diagnose — try adding a detail." }, { status: 502 });

  const causes = (out.causes ?? []).filter((c) => c?.cause?.trim()).map((c) => ({
    cause: String(c.cause).slice(0, 240), likelihood: c.likelihood === "possible" ? "possible" : "likely", why: c.why ? String(c.why).slice(0, 200) : "",
  }));
  const steps = (out.steps ?? []).filter((s) => typeof s === "string" && s.trim()).map((s) => String(s).slice(0, 300));
  const prevention = (out.prevention ?? []).filter((p) => p?.label?.trim()).map((p) => ({ label: String(p.label).slice(0, 300), critical: !!p.critical }));
  return NextResponse.json({ ok: true, summary: out.summary ?? "", causes, steps, prevention });
}
