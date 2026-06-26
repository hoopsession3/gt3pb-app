import { NextResponse, after } from "next/server";
import { staffFromRequest, userFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { academyKnowledge } from "@/lib/operatorKb";
/* eslint-disable @typescript-eslint/no-explicit-any */

export const runtime = "nodejs";
// Two sequential callClaude calls are possible (the empty-list retry below), so give the background
// job headroom under the function cap — same ceiling the inspection agent uses.
export const maxDuration = 120;

const PREP_SYSTEM =
  "You are the prep lead for GT3 Performance Bar, a mobile beverage truck. Build a COMPLETE, ready-to-work prep / to-do list for ONE specific event or truck stop. This is the crew's actual checklist for the day — it must stand on its own, so ALWAYS produce a full list (typically 10–18 items) that covers the whole operation end to end, even when little is known about the stop. Use the GT3 SOPs below and standard mobile-beverage-bar operations as your backbone, then TAILOR it with whatever specifics are provided: the event/stop config, the run of show, current INVENTORY, GEAR, the COMPLIANCE rules, and the crew's notes. " +
  "Always include, in order: (1) a TIMELINE of time-blocked items from leave-home through teardown/depart — e.g. 'Leave by 8:30a — ~90 min drive + buffer', 'On site & set up by 10:30a', 'Service 11a–3p', 'Teardown & load out by 3:30p' (estimate sensible times from the start time / run of show; if no times are given, still lay out the sequence and say which times to confirm); then (2) Pack, (3) Stock/reorder, (4) Setup, (5) Service, (6) Compliance, (7) Travel, (8) Teardown. " +
  "Flag any poured menu item whose stock is low / below reorder point / critical as a reorder task (critical if it would run out). Include the compliance items that apply. Honor the crew's notes — if they raise a concern, address it directly. " +
  "The 'already_on_the_list' field is ONLY so you avoid proposing an EXACT duplicate of something already there — it is NOT a signal that the list is done. A short or empty existing list means you must build the whole thing. Keep labels short and imperative; give each a one-line 'why' that points to the data or SOP. Never invent health/nutrition claims or facts not present. Always answer with the prep_list tool.\n\n=== GT3 SOPs / KNOWLEDGE ===\n";

// The crew's checklist must never come back empty. Below this many items we treat the answer as a
// non-answer and retry once with a corrective nudge (the model occasionally says "looks covered"
// despite the instruction, especially on a fresh stop with lots of gear already catalogued).
const MIN_TASKS = 8;

// Deterministic standard run-of-day checklist for a mobile beverage bar — the floor the operator
// always gets when the model under-delivers. `key` is a lowercase substring used to skip an item the
// model already covered, so the graft never obviously duplicates real, tailored output.
const BASELINE_TASKS: { key: string; label: string; section: string; critical: boolean; why: string }[] = [
  { key: "leave", label: "Confirm leave-by time — drive + load-in buffer", section: "Timeline", critical: false, why: "Back-timed from service start." },
  { key: "set up by", label: "On site & set up ~60 min before service", section: "Timeline", critical: false, why: "Time to level, plumb, and prime before doors." },
  { key: "service", label: "Service window — pour & serve", section: "Timeline", critical: false, why: "The pour window itself." },
  { key: "teardown", label: "Teardown & load out", section: "Timeline", critical: false, why: "Break down and pack out at the end." },
  { key: "load the rig", label: "Load the rig — taps/kegerator, cups, ice, tools", section: "Pack", critical: false, why: "Core service gear." },
  { key: "bottles", label: "Pack bottles + backups for the menu", section: "Pack", critical: false, why: "Bottled service + spares." },
  { key: "reorder", label: "Confirm stock for every poured item; reorder anything low", section: "Stock / reorder", critical: true, why: "Don't run out mid-service." },
  { key: "power/water", label: "Set up bar — power/water check, level, sanitize surfaces", section: "Setup", critical: false, why: "Health-code + a stable pour." },
  { key: "pos", label: "Open: test POS/Square, prime taps, first-pour check", section: "Service", critical: false, why: "Catch issues before the first customer." },
  { key: "permit", label: "Confirm permits + sanitation (handwash, gloves) for the jurisdiction", section: "Compliance", critical: true, why: "Required to operate." },
  { key: "parking", label: "Confirm route + parking / load-in access", section: "Travel", critical: false, why: "Know where to pull in." },
  { key: "count remaining", label: "Pack out — count remaining stock, clean, secure", section: "Teardown", critical: false, why: "Accurate carryover + clean gear." },
];

// Run the (slow, grounded) prep-list build in the background and write the result to the job row, so
// the client polls instead of holding a long request open. Never throws — failures land as error.
async function runPrep(jobId: string, fmt: any) {
  if (!supabaseAdmin) return;
  const touch = (patch: any) => supabaseAdmin!.from("agent_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", jobId);
  const ask = async (nudge?: string) => {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 1800, temperature: 0.2,
      system: PREP_SYSTEM + academyKnowledge().slice(0, 9000),
      messages: [{ role: "user", content: `Build the prep list.\n\n${JSON.stringify(fmt)}${nudge ? `\n\n${nudge}` : ""}` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "prep_list" },
    });
    const out: any = r.toolUses.find((t) => t.name === "prep_list")?.input ?? null;
    if (!out) return null;
    const tasks = (out.tasks ?? []).filter((t: any) => t?.label?.trim()).map((t: any) => ({
      label: String(t.label).slice(0, 300), section: SECTIONS.includes(t.section) ? t.section : "Prep",
      critical: !!t.critical, why: t.why ? String(t.why).slice(0, 200) : "",
    }));
    return { summary: out.summary ?? "", tasks };
  };
  try {
    await touch({ status: "running" });
    let res = await ask();
    // Empty / near-empty floor: a real working list, every time. Retry once and keep the fuller result.
    if (!res || res.tasks.length < MIN_TASKS) {
      const retry = await ask("Your last answer had too few items to be a usable checklist. Produce the COMPLETE list NOW — at least 10 items: the time-blocked Timeline (leave-home → teardown) plus Pack, Stock/reorder, Setup, Service, Compliance, Travel, Teardown. Do NOT say it looks covered or return an empty list.");
      if (retry && (!res || retry.tasks.length > res.tasks.length)) res = retry;
    }
    // HARD floor: if the model STILL under-delivers (it sometimes insists "looks covered"), graft a
    // deterministic standard run-of-day checklist so the crew always leaves with a real working list.
    // Grafted items are skipped when the model already covered that ground (keyword match).
    if (!res) res = { summary: "", tasks: [] };
    if (res.tasks.length < MIN_TASKS) {
      const have = res.tasks.map((t: any) => String(t.label).toLowerCase());
      for (const b of BASELINE_TASKS) {
        if (res.tasks.length >= MIN_TASKS) break;
        if (!have.some((h: string) => h.includes(b.key))) {
          res.tasks.push({ label: b.label, section: b.section, critical: b.critical, why: b.why });
          have.push(b.label.toLowerCase());
        }
      }
      if (!res.summary) res.summary = "Standard run-of-day checklist — tailor the times + stock to this stop.";
    }
    await touch({ status: "done", result: res });
  } catch (err: any) {
    await touch({ status: "error", error: String(err?.message ?? err).slice(0, 300) });
  }
}

// PREP AI — talk to it about a specific EVENT or on-the-ground TRUCK STOP and it builds a TAILORED
// prep / to-do list, grounded in that thing's config (+ run of show for events), current inventory
// (flags low/critical as reorder tasks), gear, jurisdiction compliance, and GT3's SOPs. Two phases
// (preview → commit), both staff-gated. Proposes event_tasks for review; nothing is written until commit.

const SECTIONS = ["Timeline", "Pack", "Stock / reorder", "Setup", "Service", "Compliance", "Travel", "Teardown", "Prep"];

const TOOL: ToolDef = {
  name: "prep_list",
  description: "A tailored, grounded prep / to-do list for this specific event or truck stop.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One line: the shape of this prep day, including the rough timeline." },
      tasks: {
        type: "array",
        description: "The COMPLETE prep checklist for THIS event/stop — typically 10–18 items, start to finish. Lead with the time-blocked Timeline items, then Pack/Stock/Setup/Service/Compliance/Travel/Teardown. Tailor to the data but always produce a full working list; never return an empty or near-empty list.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Short imperative. Timeline items carry a time, e.g. 'Leave by 8:30a — ~90 min drive + buffer' or 'Service 11a–3p'. Others e.g. 'Reorder 16oz bottles — below reorder point' or 'Load kegerator + 3 kegs'." },
            section: { type: "string", enum: SECTIONS },
            critical: { type: "boolean", description: "true if it blocks service (out-of-stock poured item, a required permit, water with none on site)." },
            why: { type: "string", description: "One short line of grounding (e.g. 'nitro is on the menu and stock is below reorder point')." },
          },
          required: ["label", "section", "critical"],
        },
      },
    },
    required: ["summary", "tasks"],
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
  const ownerId = eventId || stopId;
  if (!ownerCol || !ownerId) return NextResponse.json({ ok: false, error: "event_id or stop_id required" }, { status: 400 });

  // ── COMMIT: write the reviewed tasks as event_tasks (owned by the event OR the stop) ──
  if (body.commit) {
    const tasks = (body.commit.tasks ?? []).filter((t: any) => !t._skip && t.label?.trim());
    if (!tasks.length) return NextResponse.json({ ok: true, added: 0 });
    const { data: existing } = await supabaseAdmin.from("event_tasks").select("label").eq(ownerCol, ownerId);
    const have = new Set((existing ?? []).map((t: any) => t.label.trim().toLowerCase()));
    const rows = tasks
      .filter((t: any) => !have.has(t.label.trim().toLowerCase()))
      .map((t: any, i: number) => ({
        [ownerCol]: ownerId, label: String(t.label).trim().slice(0, 300),
        section: SECTIONS.includes(t.section) ? t.section : "Prep",
        kind: t.section === "Pack" ? "pack" : "task", critical: !!t.critical, sort: 500 + i,
      }));
    if (!rows.length) return NextResponse.json({ ok: true, added: 0 });
    const { error } = await supabaseAdmin.from("event_tasks").insert(rows);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, added: rows.length });
  }

  // ── PREVIEW: build the list, grounded in everything we know ──
  const notes = String(body.notes ?? "").slice(0, 3000);
  const [{ data: inv }, { data: assets }, { data: existing }] = await Promise.all([
    supabaseAdmin.from("inventory_items").select("name, qty, qty_event_ready, reorder_point, status, unit, critical, use_cases, required_for"),
    supabaseAdmin.from("assets").select("name, brand, use_case, qty"),
    supabaseAdmin.from("event_tasks").select("label").eq(ownerCol, ownerId),
  ]);

  // The target — an event (full config + run of show) or a truck stop (location/notes).
  let target: any = null, runOfShow: string[] = [], state: string | null = null, county: string | null = null, kind = "event";
  if (eventId) {
    const { data: e } = await supabaseAdmin.from("events").select("title, day, day_label, location_text, state, county, rig, menu_nitro, menu_nature_aid, menu_salted_maple, menu_bottles, menu_broth, power_available, water_available, expected_attendance, staff_count, duration_hrs, plan_days, blurb").eq("id", eventId).maybeSingle();
    if (!e) return NextResponse.json({ ok: false, error: "event not found" }, { status: 404 });
    target = e; state = (e as any).state; county = (e as any).county;
    const { data: sched } = await supabaseAdmin.from("event_schedule_items").select("day_index, start_time, title, location").eq("event_id", eventId).order("day_index").order("sort");
    runOfShow = (sched ?? []).map((s: any) => `D${s.day_index} ${s.start_time ?? ""} ${s.title}${s.location ? ` @ ${s.location}` : ""}`);
  } else {
    const { data: s } = await supabaseAdmin.from("stops").select("name, location_text, address, note, notes, starts_at, menu_tier, status").eq("id", stopId).maybeSingle();
    if (!s) return NextResponse.json({ ok: false, error: "stop not found" }, { status: 404 });
    target = s; kind = "truck stop (on-the-ground ops)";
    const { data: stopSched } = await supabaseAdmin.from("event_schedule_items").select("day_index, start_time, title, location").eq("stop_id", stopId).order("day_index").order("sort");
    runOfShow = (stopSched ?? []).map((s: any) => `D${s.day_index} ${s.start_time ?? ""} ${s.title}${s.location ? ` @ ${s.location}` : ""}`);
  }

  // Compliance: an event keys off its state (+ universal); a stop has no state column, so use the
  // universal (ANY) rules — the crew's notes can name the jurisdiction for the model to weigh.
  let rules: any[] = [];
  if (state) {
    const { data: c } = await supabaseAdmin.from("compliance_rules").select("state, county, label, kind, critical").eq("active", true).or(`state.eq.${state},state.is.null`);
    rules = c ?? [];
  } else {
    const { data: c } = await supabaseAdmin.from("compliance_rules").select("state, county, label, kind, critical").eq("active", true).is("state", null);
    rules = c ?? [];
  }

  const fmt = {
    kind, target, county,
    run_of_show: runOfShow,
    inventory: (inv ?? []).map((i: any) => ({ name: i.name, on_hand: i.qty, event_ready: i.qty_event_ready, reorder_point: i.reorder_point, status: i.status, unit: i.unit, critical: i.critical, use_cases: i.use_cases, required_for: i.required_for })),
    gear: (assets ?? []).map((a: any) => `${a.name}${a.brand ? ` (${a.brand})` : ""}${a.qty != null ? ` ×${a.qty}` : ""}${a.use_case ? ` — ${a.use_case}` : ""}`),
    compliance_rules: rules.map((r: any) => `[${r.state ?? "ANY"}${r.county ? `/${r.county}` : ""}] (${r.kind}${r.critical ? ", CRITICAL" : ""}) ${r.label}`),
    already_on_the_list: (existing ?? []).map((t: any) => t.label),
    crew_notes: notes,
  };

  // Kick the build into the background (after the response flushes) and hand back a job id to poll —
  // the grounded build can take ~30s and shouldn't hold the phone's request open.
  const me = await userFromRequest(req).catch(() => null);
  const { data: job, error: jErr } = await supabaseAdmin.from("agent_jobs")
    .insert({ kind: "eventprep", status: "pending", input: { owner: ownerCol, id: ownerId }, requested_by: me?.id ?? null })
    .select("id").single();
  if (jErr || !job) return NextResponse.json({ ok: false, error: "couldn't start the prep build" }, { status: 502 });
  after(() => runPrep(job.id, fmt));
  return NextResponse.json({ ok: true, status: "pending", job_id: job.id });
}
