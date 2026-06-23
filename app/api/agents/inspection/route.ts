import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ClaudeMsg, type ToolDef } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 120;

/* eslint-disable @typescript-eslint/no-explicit-any */
// INSPECTION AGENT — "we have an inspection in <place>, what to expect?" For a jurisdiction we
// haven't researched, Claude WEB-RESEARCHES the temporary food/mobile-vendor permit + inspection
// requirements, drafts compliance_rules rows (PROPOSED — inactive/unverified until an admin approves),
// and returns what-to-expect + a prep checklist. Optionally writes the checklist as event tasks.
// Two calls: (1) research with the web_search server tool, (2) extract structured rows with a forced tool.

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

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let state = "", county = "", event_id = "";
  try { ({ state = "", county = "", event_id = "" } = await req.json()); } catch { /* */ }
  state = String(state).trim().toUpperCase().slice(0, 4);
  county = String(county).trim().slice(0, 60);
  if (!state) return NextResponse.json({ ok: false, error: "state required" }, { status: 400 });
  const place = `${county ? `${county} County, ` : ""}${state}`;

  // Already researched? If we have active jurisdiction-specific rows, don't spend a web search.
  const { data: existing } = await supabaseAdmin.from("compliance_rules").select("id, label, kind, critical, link")
    .eq("active", true).eq("state", state).or(county ? `county.eq.${county},county.is.null` : "county.is.null");
  const haveJurisdiction = (existing ?? []).some((r: any) => r.label);

  let out: { summary: string; checklist: string[]; rules: any[]; confidence: string } | null = null;
  let researched = false;

  try {
    if (haveJurisdiction) {
      // Summarize from what we already have — no web search.
      const known = (existing ?? []).map((r: any) => `- (${r.kind}${r.critical ? ", critical" : ""}) ${r.label}${r.link ? ` [${r.link}]` : ""}`).join("\n");
      const r = await callClaude({
        model: MODELS.sonnet, maxTokens: 1200,
        system: "You brief a mobile beverage-truck operator on an upcoming health inspection using ONLY the requirements provided. Lead with what the inspector will check, then a short prep checklist. Always answer with save_requirements (echo the given rules).",
        messages: [{ role: "user", content: `Inspection in ${place}. Our known requirements:\n${known}\n\nBrief us.` }],
        tools: [SAVE], tool_choice: { type: "tool", name: "save_requirements" },
      });
      out = r.toolUses.find((t) => t.name === "save_requirements")?.input ?? null;
    } else {
      // RESEARCH with web search (server tool); resume through any pause_turn.
      researched = true;
      const webTool: any = { type: "web_search_20260209", name: "web_search", max_uses: 5 };
      const sys = "You research local regulations for a mobile beverage truck (GT3 Performance Bar — coffee, broth, bottled drinks). Find the TEMPORARY food service / mobile vendor permit and health-inspection requirements for the named jurisdiction. Prefer official sources (county health department, state agriculture/DPH). Be specific and cite where requirements come from. Note that requirements must be confirmed with the authority for the exact date.";
      let msgs: ClaudeMsg[] = [{ role: "user", content: `Research what's needed to legally operate and pass a health inspection for a temporary mobile beverage setup in ${place}. List the permits, certifications, inspection items, and insurance, with source links.` }];
      let r = await callClaude({ model: MODELS.sonnet, maxTokens: 2200, system: sys, messages: msgs, tools: [webTool] });
      let guard = 0;
      while (r.stop_reason === "pause_turn" && guard++ < 5) {
        msgs = [...msgs, { role: "assistant", content: r.content }];
        r = await callClaude({ model: MODELS.sonnet, maxTokens: 2200, system: sys, messages: msgs, tools: [webTool] });
      }
      const research = r.text || "(no findings)";
      // Extract structured rows (forced tool, no web search → forcing is allowed here).
      const ex = await callClaude({
        model: MODELS.sonnet, maxTokens: 1500,
        system: "Turn the research into clean compliance rows for a mobile beverage truck. One row per distinct requirement. Keep links from the research. If sources were thin, set confidence low. Always answer with save_requirements.",
        messages: [{ role: "user", content: `Jurisdiction: ${place}\n\nResearch findings:\n${research}` }],
        tools: [SAVE], tool_choice: { type: "tool", name: "save_requirements" },
      });
      out = ex.toolUses.find((t) => t.name === "save_requirements")?.input ?? null;
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
  if (!out) return NextResponse.json({ ok: false, error: "no result" }, { status: 502 });

  // Persist newly-researched rules as PROPOSED (inactive + unverified) for admin approval.
  let proposed: any[] = [];
  if (researched && Array.isArray(out.rules) && out.rules.length) {
    const rows = out.rules.filter((r) => r?.label?.trim()).slice(0, 25).map((r, i) => ({
      state, county: county || null, label: String(r.label).trim().slice(0, 300),
      kind: ["permit", "cert", "inspection", "insurance", "other"].includes(r.kind) ? r.kind : "other",
      link: r.link ? String(r.link).slice(0, 500) : null, critical: !!r.critical,
      active: false, verified: false, source: "agent-research", sort: 500 + i,
    }));
    const { data } = await supabaseAdmin.from("compliance_rules").insert(rows).select("id, label, kind, critical, link");
    proposed = data ?? [];
  }

  // Optionally drop the checklist onto the event's prep as Compliance tasks (deduped by the unique index).
  let tasksAdded = 0;
  if (event_id && Array.isArray(out.checklist) && out.checklist.length) {
    const rows = out.checklist.filter((c) => String(c).trim()).slice(0, 30).map((c, i) => ({
      event_id, label: String(c).trim().slice(0, 300), section: "Compliance", kind: "task", critical: false, sort: 800 + i,
    }));
    const { data } = await supabaseAdmin.from("event_tasks").upsert(rows, { onConflict: "event_id,section,label", ignoreDuplicates: true }).select("id");
    tasksAdded = data?.length ?? 0;
  }

  return NextResponse.json({ ok: true, place, researched, summary: out.summary, checklist: out.checklist ?? [], confidence: out.confidence, proposed, tasksAdded });
}
