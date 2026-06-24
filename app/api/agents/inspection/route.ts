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
// Uncovered jurisdiction: web research is too slow to finish inside one HTTP request (web_search +
// several Sonnet calls ran ~100s and tripped the gateway/serverless limit). So we QUEUE it: insert a
// job row, return its id immediately (status: "pending"), and finish the research AFTER the response
// is flushed via Next `after()` (kept alive by Vercel waitUntil, bounded by maxDuration above — but no
// longer racing the client/gateway idle timeout). The background run writes the brief + PROPOSED
// compliance_rows (inactive/unverified until an admin approves) + optional event tasks back to the job
// row; the Inspection Prep card polls `inspection_research_jobs` for the result.

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

// BACKGROUND — web-research an uncovered jurisdiction, then write the result onto the job row.
// Never throws to the caller: any failure is recorded as status: "error" so the poller stops cleanly.
async function processResearchJob(jobId: string, j: { state: string; county: string; event_id: string; place: string }) {
  if (!supabaseAdmin) return;
  const touch = (patch: Record<string, any>) =>
    supabaseAdmin!.from("inspection_research_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", jobId);
  try {
    await touch({ status: "running" });

    // (1) Research with the web_search server tool; resume through any pause_turn. Capped (2 searches +
    // 2 resume rounds) to stay well under maxDuration even though we now run off the request's critical path.
    const webTool: any = { type: "web_search_20260209", name: "web_search", max_uses: 2 };
    const sys = "You research local regulations for a mobile beverage truck (GT3 Performance Bar — coffee, broth, bottled drinks). Find the TEMPORARY food service / mobile vendor permit and health-inspection requirements for the named jurisdiction. Prefer official sources (county health department, state agriculture/DPH). Be specific and cite where requirements come from. Note that requirements must be confirmed with the authority for the exact date.";
    let msgs: ClaudeMsg[] = [{ role: "user", content: `Research what's needed to legally operate and pass a health inspection for a temporary mobile beverage setup in ${j.place}. List the permits, certifications, inspection items, and insurance, with source links.` }];
    let r = await callClaude({ model: MODELS.sonnet, maxTokens: 2200, system: sys, messages: msgs, tools: [webTool] });
    let guard = 0;
    while (r.stop_reason === "pause_turn" && guard++ < 2) {
      msgs = [...msgs, { role: "assistant", content: r.content }];
      r = await callClaude({ model: MODELS.sonnet, maxTokens: 2200, system: sys, messages: msgs, tools: [webTool] });
    }
    const research = r.text || "(no findings)";

    // (2) Extract structured rows (forced tool, no web search). Haiku — extraction from given text is
    // easy and the faster model buys headroom under the duration budget.
    const ex = await callClaude({
      model: MODELS.haiku, maxTokens: 1500,
      system: "Turn the research into clean compliance rows for a mobile beverage truck. One row per distinct requirement. Keep links from the research. If sources were thin, set confidence low. Always answer with save_requirements.",
      messages: [{ role: "user", content: `Jurisdiction: ${j.place}\n\nResearch findings:\n${research}` }],
      tools: [SAVE], tool_choice: { type: "tool", name: "save_requirements" },
    });
    const out: SaveOut | null = ex.toolUses.find((t) => t.name === "save_requirements")?.input ?? null;
    if (!out) { await touch({ status: "error", error: "no result from research" }); return; }

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

    await touch({
      status: "done",
      result: { researched: true, summary: out.summary, checklist: out.checklist ?? [], confidence: out.confidence, proposed, tasksAdded },
    });
  } catch (e: any) {
    await touch({ status: "error", error: String(e?.message ?? e).slice(0, 300) });
  }
}

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let state = "", county = "", event_id = "";
  try { ({ state = "", county = "", event_id = "" } = await req.json()); } catch { /* */ }
  state = String(state).trim().toUpperCase().slice(0, 4);
  county = String(county).trim().slice(0, 60);
  event_id = String(event_id).trim();
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

  // RESEARCH PATH — queue it and run after the response is flushed (see header note).
  const me = await userFromRequest(req).catch(() => null);
  const { data: job, error } = await supabaseAdmin.from("inspection_research_jobs")
    .insert({ state, county: county || null, event_id: event_id || null, place, status: "pending", requested_by: me?.id ?? null })
    .select("id").single();
  if (error || !job) return NextResponse.json({ ok: false, error: "could not start research job" }, { status: 502 });

  after(() => processResearchJob(job.id, { state, county, event_id, place }));
  return NextResponse.json({ ok: true, status: "pending", job_id: job.id, place });
}
