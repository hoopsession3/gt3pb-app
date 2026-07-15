import { NextResponse } from "next/server";
import { after } from "next/server";
import { staffFromRequest, userFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ClaudeMsg, type ToolDef } from "@/lib/anthropic";
import { claimSafeDeep } from "@/lib/claimGuard";

export const runtime = "nodejs";
export const maxDuration = 120;

/* eslint-disable @typescript-eslint/no-explicit-any */
// INSPECTION AGENT — "we have an inspection in <place>, what to expect?"
//
// Covered jurisdiction (we already have active rows): we brief synchronously FROM RECORDS — one
// fast Sonnet call, no web search — and return the result inline (status: "done").
//
// Uncovered jurisdiction: web research can't reliably finish inside one HTTP request. We QUEUE it —
// insert a job row, return its id immediately (status: "pending"), and run the research AFTER the
// response is flushed via Next `after()` (no gateway idle-timeout race). The work is kept LEAN so it
// finishes under the 120s function cap: ONE web search + at most one pause-turn resume, then a fast
// Haiku extract (see processResearchJob — the header there explains why earlier heavier versions, and a
// two-phase split, both blew the cap). The background run writes the brief + PROPOSED compliance rows
// (inactive/unverified until an admin approves) + optional event tasks; the Inspection Prep card polls
// `inspection_research_jobs` for the result. Stranded jobs are reaped (see reapStale).

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

// BACKGROUND — research an uncovered jurisdiction in ONE lean pass, then write the brief + PROPOSED
// compliance rows back to the job row. Two earlier attempts both blew Vercel's 120s function cap: the
// single-pass with 2 searches + 2 resume rounds, AND a two-phase split — because the AGENTIC WEB SEARCH
// itself is the >120s cost (proven live: phase 1's search alone orphaned at 'running' past the cap), not
// the extract. So we keep the search LEAN: one web search, at most one pause-turn resume, tight token
// budgets — comfortably under maxDuration. Never throws: failures land as status 'error' so the poller
// stops cleanly. The Inspection Prep card polls inspection_research_jobs for the result.
async function processResearchJob(jobId: string, j: { state: string; county: string; event_id: string; place: string }) {
  if (!supabaseAdmin) return;
  try {
    await touchJob(jobId, { status: "running" });

    // (1) ONE web search, lean. max_uses:1 + a single resume round keeps this well under the 120s cap.
    const webTool: any = { type: "web_search_20260209", name: "web_search", max_uses: 1 };
    const sys = "You research local regulations for a mobile beverage truck (GT3 Performance Bar — coffee, broth, bottled drinks). Find the TEMPORARY food service / mobile vendor permit and health-inspection requirements for the named jurisdiction. Prefer official sources (county health department, state agriculture/DPH). Make ONE focused search, then summarize concisely with sources. Note that requirements must be confirmed with the authority for the exact date.";
    let msgs: ClaudeMsg[] = [{ role: "user", content: `Research what's needed to legally operate and pass a health inspection for a temporary mobile beverage setup in ${j.place}. List the permits, certifications, inspection items, and insurance, with source links.` }];
    let r = await callClaude({ label: "inspection", model: MODELS.sonnet, maxTokens: 1600, system: sys, messages: msgs, tools: [webTool] });
    if (r.stop_reason === "pause_turn") {
      msgs = [...msgs, { role: "assistant", content: r.content }];
      r = await callClaude({ label: "inspection", model: MODELS.sonnet, maxTokens: 1600, system: sys, messages: msgs, tools: [webTool] });
    }
    const research = (r.text || "").trim() || "(no findings)";

    // (2) Extract structured rows (forced tool, no web search) — fast Haiku pass.
    const ex = await callClaude({ label: "inspection",
      model: MODELS.haiku, maxTokens: 1400,
      system: "Turn the research into clean compliance rows for a mobile beverage truck. One row per distinct requirement. Keep links from the research. If sources were thin, set confidence low. Always answer with save_requirements.",
      messages: [{ role: "user", content: `Jurisdiction: ${j.place}\n\nResearch findings:\n${research}` }],
      tools: [SAVE], tool_choice: { type: "tool", name: "save_requirements" },
    });
    const out: SaveOut | null = ex.toolUses.find((t) => t.name === "save_requirements")?.input ?? null;
    if (!out) { await touchJob(jobId, { status: "error", error: "could not extract requirements" }); return; }
    // Deterministic backstop (F5 — output claim-guard): this is unmoderated web research turned into
    // a saved brief + compliance rows — hold it to the bar before it's ever shown or proposed.
    const guard = claimSafeDeep(out);
    if (!guard.ok) {
      console.warn(`[inspection] claim-guard tripped on "${guard.hit}" (${guard.path}) — research blocked`);
      await touchJob(jobId, { status: "error", error: "Research needs review before it can be shown — try again." });
      return;
    }

    // Persist newly-researched rules as PROPOSED (inactive + unverified) for admin approval.
    let proposed: any[] = [];
    if (Array.isArray(out.rules) && out.rules.length) {
      const rows = out.rules.filter((x) => x?.label?.trim()).slice(0, 25).map((x, i) => ({
        state: j.state, county: j.county || null, label: String(x.label).trim().slice(0, 300),
        kind: ["permit", "cert", "inspection", "insurance", "other"].includes(x.kind) ? x.kind : "other",
        link: x.link ? String(x.link).slice(0, 500) : null, critical: !!x.critical,
        active: false, verified: false, source: "agent-research", sort: 500 + i,
      }));
      const { data } = await supabaseAdmin.from("compliance_rules").insert(rows).select("id, label, kind, critical, link");
      proposed = data ?? [];
    }

    const tasksAdded = await persistTasks(j.event_id, out.checklist);
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
      const r = await callClaude({ label: "inspection",
        model: MODELS.sonnet, maxTokens: 1200,
        system: "You brief a mobile beverage-truck operator on an upcoming health inspection using ONLY the requirements provided. Lead with what the inspector will check, then a short prep checklist. Always answer with save_requirements (echo the given rules).",
        messages: [{ role: "user", content: `Inspection in ${place}. Our known requirements:\n${known}\n\nBrief us.` }],
        tools: [SAVE], tool_choice: { type: "tool", name: "save_requirements" },
      });
      const out: SaveOut | null = r.toolUses.find((t) => t.name === "save_requirements")?.input ?? null;
      if (!out) return NextResponse.json({ ok: false, error: "no result" }, { status: 502 });
      // Deterministic backstop (F5 — output claim-guard).
      const guard = claimSafeDeep(out);
      if (!guard.ok) {
        console.warn(`[inspection] claim-guard tripped on "${guard.hit}" (${guard.path}) — brief blocked`);
        return NextResponse.json({ ok: false, error: "The brief needs review — try again." }, { status: 502 });
      }
      const tasksAdded = await persistTasks(event_id, out.checklist);
      return NextResponse.json({
        ok: true, status: "done", place, researched: false,
        summary: out.summary, checklist: out.checklist ?? [], confidence: out.confidence, proposed: [], tasksAdded,
      });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
    }
  }

  // RESEARCH PATH — the lean research runs after the response is flushed (see header note). Reap any of
  // this state's jobs stranded by a prior timeout before queueing a fresh one.
  await reapStale(state).catch(() => {});
  const me = await userFromRequest(req).catch(() => null);
  const { data: job, error } = await supabaseAdmin.from("inspection_research_jobs")
    .insert({ state, county: county || null, event_id: event_id || null, place, status: "pending", requested_by: me?.id ?? null })
    .select("id").single();
  if (error || !job) return NextResponse.json({ ok: false, error: "could not start research job" }, { status: 502 });

  after(() => processResearchJob(job.id, { state, county, event_id, place }));
  return NextResponse.json({ ok: true, status: "pending", job_id: job.id, place });
}
