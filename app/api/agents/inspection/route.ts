import { NextResponse } from "next/server";
import { after } from "next/server";
import { staffFromRequest, userFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ClaudeMsg, type ToolDef } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 120;

/* eslint-disable @typescript-eslint/no-explicit-any */
// INSPECTION AGENT — "we have an inspection in <place>, what to expect?"
//
// Covered jurisdiction (we already have active rows): we brief synchronously FROM RECORDS — one
// fast Sonnet call, no web search — and return the result inline (status: "done").
//
// Uncovered jurisdiction: web research is too slow to finish inside one HTTP request — even the
// background `after()` version blew the maxDuration cap (web_search + the structured extract together
// ran >120s and the worker was killed mid-run, orphaning the job at 'running'). So we run it in TWO
// bounded background phases, each comfortably under maxDuration:
//   phase 1 (processSearchPhase): web_search the jurisdiction, save the raw findings, mark 'searched'.
//   phase 2 (processExtractPhase): turn the saved findings into the brief + PROPOSED compliance rows
//     (inactive/unverified until an admin approves) + optional event tasks, mark 'done'.
// The route returns the job id immediately (status: "pending"); the Inspection Prep card polls
// `inspection_research_jobs`, and the moment it sees 'searched' it POSTs back {phase:"extract"} to
// kick phase 2 off in its own fresh function budget. Stranded jobs are reaped (see reapStale).

const SAVE: ToolDef = {
  name: "save_requirements",
  description: "Return the researched permit/inspection requirements for the jurisdiction.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "2-4 sentences: what the inspector will check + the key permit(s) needed for a temporary mobile beverage operation here." },
      checklist: { type: "array", items: { type: "string" }, description: "Concrete prep steps to be inspection-ready (imperative, specific)." },
      rules: {
        type: "array",
        description: "Each distinct requirement, as a compliance row.",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            kind: { type: "string", enum: ["permit", "cert", "inspection", "insurance", "other"] },
            link: { type: "string", description: "Authoritative source URL if known, else empty." },
            critical: { type: "boolean", description: "true if missing it blocks operating." },
          },
          required: ["label", "kind", "critical"],
        },
      },
      confidence: { type: "string", enum: ["high", "medium", "low"], description: "How confident the research is; low when sources were thin." },
    },
    required: ["summary", "checklist", "rules", "confidence"],
  },
};

type SaveOut = { summary: string; checklist: string[]; rules: any[]; confidence: string };

// Drop the prep checklist onto an event's prep as Compliance tasks (deduped by the unique index).
async function persistTasks(event_id: string, checklist: string[] | undefined): Promise<number> {
  if (!supabaseAdmin || !event_id || !Array.isArray(checklist) || !checklist.length) return 0;
  const rows = checklist.filter((c) => String(c).trim()).slice(0, 30).map((c, i) => ({
    event_id, label: String(c).trim().slice(0, 300), section: "Compliance", kind: "task", critical: false, sort: 800 + i,
  }));
  const { data } = await supabaseAdmin.from("event_tasks").upsert(rows, { onConflict: "event_id,section,label", ignoreDuplicates: true }).select("id");
  return data?.length ?? 0;
}

const touchJob = (jobId: string, patch: Record<string, any>) =>
  supabaseAdmin!.from("inspection_research_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", jobId);

// PHASE 1 (background) — web-research the jurisdiction and save the RAW findings, then mark 'searched'.
// This phase does the slow web_search work ONLY; the structured extract is split into phase 2 so each
// invocation finishes well under maxDuration (the single-pass version blew the 120s cap and orphaned
// jobs at 'running'). Never throws: any failure lands as status 'error' so the poller stops cleanly.
async function processSearchPhase(jobId: string, place: string) {
  if (!supabaseAdmin) return;
  try {
    await touchJob(jobId, { status: "running" });
    // web_search server tool; resume through any pause_turn. Capped (2 searches + 2 resume rounds).
    const webTool: any = { type: "web_search_20260209", name: "web_search", max_uses: 2 };
    const sys = "You research local regulations for a mobile beverage truck (GT3 Performance Bar — coffee, broth, bottled drinks). Find the TEMPORARY food service / mobile vendor permit and health-inspection requirements for the named jurisdiction. Prefer official sources (county health department, state agriculture/DPH). Be specific and cite where requirements come from. Note that requirements must be confirmed with the authority for the exact date.";
    let msgs: ClaudeMsg[] = [{ role: "user", content: `Research what's needed to legally operate and pass a health inspection for a temporary mobile beverage setup in ${place}. List the permits, certifications, inspection items, and insurance, with source links.` }];
    let r = await callClaude({ model: MODELS.sonnet, maxTokens: 2200, system: sys, messages: msgs, tools: [webTool] });
    let guard = 0;
    while (r.stop_reason === "pause_turn" && guard++ < 2) {
      msgs = [...msgs, { role: "assistant", content: r.content }];
      r = await callClaude({ model: MODELS.sonnet, maxTokens: 2200, system: sys, messages: msgs, tools: [webTool] });
    }
    const research = (r.text || "").trim();
    if (!research) { await touchJob(jobId, { status: "error", error: "no findings from research" }); return; }
    await touchJob(jobId, { status: "searched", research_raw: research.slice(0, 24000) });
  } catch (e: any) {
    await touchJob(jobId, { status: "error", error: String(e?.message ?? e).slice(0, 300) });
  }
}

// PHASE 2 (background) — turn the saved findings into the structured brief + PROPOSED compliance rows,
// then mark 'done'. No web search: a single fast Haiku extract, comfortably under maxDuration. Triggered
// by the card the moment the job reaches 'searched' (the route already claimed it → 'extracting').
async function processExtractPhase(jobId: string) {
  if (!supabaseAdmin) return;
  try {
    const { data: job } = await supabaseAdmin.from("inspection_research_jobs")
      .select("state, county, event_id, place, research_raw").eq("id", jobId).single();
    if (!job) return;
    const research = job.research_raw || "(no findings)";

    // Extract structured rows (forced tool, no web search). Haiku — extraction from given text is easy
    // and the faster model keeps this phase fast.
    const ex = await callClaude({
      model: MODELS.haiku, maxTokens: 1500,
      system: "Turn the research into clean compliance rows for a mobile beverage truck. One row per distinct requirement. Keep links from the research. If sources were thin, set confidence low. Always answer with save_requirements.",
      messages: [{ role: "user", content: `Jurisdiction: ${job.place}\n\nResearch findings:\n${research}` }],
      tools: [SAVE], tool_choice: { type: "tool", name: "save_requirements" },
    });
    const out: SaveOut | null = ex.toolUses.find((t) => t.name === "save_requirements")?.input ?? null;
    if (!out) { await touchJob(jobId, { status: "error", error: "could not extract requirements" }); return; }

    // Persist newly-researched rules as PROPOSED (inactive + unverified) for admin approval.
    let proposed: any[] = [];
    if (Array.isArray(out.rules) && out.rules.length) {
      const rows = out.rules.filter((x) => x?.label?.trim()).slice(0, 25).map((x, i) => ({
        state: job.state, county: job.county || null, label: String(x.label).trim().slice(0, 300),
        kind: ["permit", "cert", "inspection", "insurance", "other"].includes(x.kind) ? x.kind : "other",
        link: x.link ? String(x.link).slice(0, 500) : null, critical: !!x.critical,
        active: false, verified: false, source: "agent-research", sort: 500 + i,
      }));
      const { data } = await supabaseAdmin.from("compliance_rules").insert(rows).select("id, label, kind, critical, link");
      proposed = data ?? [];
    }

    const tasksAdded = await persistTasks(job.event_id, out.checklist);

    await touchJob(jobId, {
      status: "done",
      result: { researched: true, summary: out.summary, checklist: out.checklist ?? [], confidence: out.confidence, proposed, tasksAdded },
    });
  } catch (e: any) {
    await touchJob(jobId, { status: "error", error: String(e?.message ?? e).slice(0, 300) });
  }
}

// Reap jobs cut off mid-run: the maxDuration cap kills the worker with no chance to write 'error', so a
// job can linger forever in a working status. Any of THIS state's jobs in a working status with a stale
// heartbeat (a live worker touches updated_at at each phase boundary) get marked errored. Best-effort.
async function reapStale(state: string) {
  if (!supabaseAdmin) return;
  const cutoff = new Date(Date.now() - 150000).toISOString(); // > maxDuration; alive workers are fresher
  await supabaseAdmin.from("inspection_research_jobs")
    .update({ status: "error", error: "timed out — research exceeded the time limit", updated_at: new Date().toISOString() })
    .eq("state", state).in("status", ["pending", "running", "searched", "extracting"]).lt("updated_at", cutoff);
}

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  // PHASE-2 TRIGGER — the card calls this once the job reaches 'searched'. Atomically CLAIM it
  // (searched → extracting) so concurrent polls can't double-run the extract, then finish in the
  // background. Idempotent: if it's already past 'searched', just acknowledge.
  if (body.phase === "extract" && body.job_id) {
    const jobId = String(body.job_id);
    const { data: claimed } = await supabaseAdmin.from("inspection_research_jobs")
      .update({ status: "extracting", updated_at: new Date().toISOString() })
      .eq("id", jobId).eq("status", "searched").select("id").maybeSingle();
    if (claimed) after(() => processExtractPhase(jobId));
    return NextResponse.json({ ok: true, status: claimed ? "extracting" : "accepted" });
  }

  const state = String(body.state ?? "").trim().toUpperCase().slice(0, 4);
  const county = String(body.county ?? "").trim().slice(0, 60);
  const event_id = String(body.event_id ?? "").trim();
  if (!state) return NextResponse.json({ ok: false, error: "state required" }, { status: 400 });
  const place = `${county ? `${county} County, ` : ""}${state}`;

  // Already researched? If we have active jurisdiction-specific rows, brief from records — no web search.
  const { data: existing } = await supabaseAdmin.from("compliance_rules").select("id, label, kind, critical, link")
    .eq("active", true).eq("state", state).or(county ? `county.eq.${county},county.is.null` : "county.is.null");
  const haveJurisdiction = (existing ?? []).some((r: any) => r.label);

  if (haveJurisdiction) {
    // FAST PATH — summarize from what we already have (one Sonnet call). Returns inline.
    try {
      const known = (existing ?? []).map((r: any) => `- (${r.kind}${r.critical ? ", critical" : ""}) ${r.label}${r.link ? ` [${r.link}]` : ""}`).join("\n");
      const r = await callClaude({
        model: MODELS.sonnet, maxTokens: 1200,
        system: "You brief a mobile beverage-truck operator on an upcoming health inspection using ONLY the requirements provided. Lead with what the inspector will check, then a short prep checklist. Always answer with save_requirements (echo the given rules).",
        messages: [{ role: "user", content: `Inspection in ${place}. Our known requirements:\n${known}\n\nBrief us.` }],
        tools: [SAVE], tool_choice: { type: "tool", name: "save_requirements" },
      });
      const out: SaveOut | null = r.toolUses.find((t) => t.name === "save_requirements")?.input ?? null;
      if (!out) return NextResponse.json({ ok: false, error: "no result" }, { status: 502 });
      const tasksAdded = await persistTasks(event_id, out.checklist);
      return NextResponse.json({
        ok: true, status: "done", place, researched: false,
        summary: out.summary, checklist: out.checklist ?? [], confidence: out.confidence, proposed: [], tasksAdded,
      });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
    }
  }

  // RESEARCH PATH — phase 1 runs after the response is flushed; the card triggers phase 2 (see header
  // note). Reap any of this state's jobs stranded by a prior timeout before queueing a fresh one.
  await reapStale(state).catch(() => {});
  const me = await userFromRequest(req).catch(() => null);
  const { data: job, error } = await supabaseAdmin.from("inspection_research_jobs")
    .insert({ state, county: county || null, event_id: event_id || null, place, status: "pending", requested_by: me?.id ?? null })
    .select("id").single();
  if (error || !job) return NextResponse.json({ ok: false, error: "could not start research job" }, { status: 502 });

  after(() => processSearchPhase(job.id, place));
  return NextResponse.json({ ok: true, status: "pending", job_id: job.id, place });
}
