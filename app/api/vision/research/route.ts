import { NextResponse } from "next/server";
import { adminFromRequest, tenantFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef, type ClaudeMsg } from "@/lib/anthropic";
import { claimSafeDeep } from "@/lib/claimGuard";
import { isJsonObject, route } from "@/lib/apiRoute";
import { errorMessage } from "@/lib/errorMessage";
import { TOPICS, isDue, novel, searchedUrls, verify } from "@/lib/visionResearch";
import { raiseAlert } from "@/lib/serverAlerts";
import { isMissingColumn } from "@/lib/schemaSkew";
import { FORMAT } from "@/lib/visionPlans";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// WHAT THE MARKET SAYS (R56, phase D — Ryan, 2026-10-25: "continuous AI market research with citations, never
// invented"). An owner or admin asks for a plan's research: a few web searches about its market (who's there, what
// people buy, what things cost, the place, the rules), then a forced extraction into findings — each a claim, a figure if
// it has one, and the address it came from. Only findings whose address the search actually returned are kept
// (lib/visionResearch.verify); the rest are counted as dropped and never stored. What's kept lands "proposed" in 0450's
// vision_research for a person to accept or reject: nothing the model says counts until someone has read its source.

const FINDINGS: ToolDef = {
  name: "findings",
  description: "What the research found — only what a search result says, each with that result's address. Never invented.",
  input_schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string", enum: [...TOPICS] },
            claim: { type: "string", description: "One sentence: what the source says, in plain words." },
            figure: { type: "string", description: "The number in it, if it has one (\"$6.40 average\", \"12,000 members\")." },
            source_url: { type: "string", description: "The address of the search result it came from — exactly as returned." },
            source_title: { type: "string" },
            published: { type: "string", description: "When the source dates itself, if it does." },
          },
          required: ["topic", "claim", "source_url"],
        },
      },
    },
    required: ["findings"],
  },
};

async function post(req: Request) {
  if (!(await adminFromRequest(req))) return NextResponse.json({ ok: false, error: "Only an owner or admin can research a plan." }, { status: 403 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  if (!isJsonObject(body)) body = {};   // a literal null is valid JSON (R18): no plan named, a 400 below — not a TypeError
  const planId = typeof body?.planId === "string" ? body.planId : "";
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return NextResponse.json({ ok: false, error: "Which plan?" }, { status: 400 });
  const tenant = await tenantFromRequest(req);
  if (!tenant) return NextResponse.json({ ok: false, error: "Which business?" }, { status: 403 });
  const { data: plan, error: pe } = await supabaseAdmin.from("vision_plans").select("id, name, format, place, summary, sqft").eq("id", planId).eq("tenant_id", tenant).maybeSingle();
  if (pe) return NextResponse.json({ ok: false, error: pe.message }, { status: 500 });
  if (!plan) return NextResponse.json({ ok: false, error: "No such plan." }, { status: 404 });
  // arrives-with: 0453  — the schedule: before 0453 the plan has none (never due), and a run doesn't stamp when it ran
  const sch = await supabaseAdmin.from("vision_plans").select("research_every_days, research_last_at, research_by").eq("id", planId).eq("tenant_id", tenant).maybeSingle();
  const hasSchedule = !sch.error;
  if (sch.error && !isMissingColumn(sch.error)) return NextResponse.json({ ok: false, error: sch.error.message }, { status: 500 });
  const p = { ...(plan as { id: string; name: string; format: keyof typeof FORMAT; place: string | null; summary: string | null; sqft: number | null }),
    research_every_days: 0, research_last_at: null as string | null, research_by: null as string | null, ...((sch.data as object | null) ?? {}) };
  // A scheduled check (R60, 0453) runs only when due — a second open of the vision the same day spends nothing.
  const scheduled = body?.scheduled === true;
  if (scheduled && !isDue(p)) return NextResponse.json({ ok: true, kept: 0, dropped: 0, notDue: true, says: "Not due yet." });
  // The stamp is read: a stamp that didn't land leaves the check due, and the next visit runs it again — said in the log.
  const ran = async () => {
    if (!hasSchedule) return;
    const { error } = await supabaseAdmin!.from("vision_plans").update({ research_last_at: new Date().toISOString() }).eq("id", p.id).eq("tenant_id", tenant);
    if (error) console.warn(`[vision-research] couldn't stamp when it ran — ${error.message}`);
  };
  const focus = typeof body?.focus === "string" ? body.focus.slice(0, 200) : "";
  const place = p.place || "Greenville, SC";

  const webTool: any = { type: "web_search_20260209", name: "web_search", max_uses: 5 };
  const sys =
    "You research the market for a plan of GT3 Performance Bar — clean cold brew, nitro, broth and bottled performance drinks for people who train. " +
    "Search for what a person deciding on this plan needs: the demand for it there (who goes, how many, what they buy), who else is there and what they charge, what things cost (rent, equipment, wages), the place itself, the rules and permits, and trends. " +
    "Only report what a search result says, with that result's address. Never estimate, never fill a gap from what you know, never invent a number or a source. Say plainly when you found nothing on a topic.";
  const ask = `The plan: ${p.name} — ${FORMAT[p.format]?.name ?? p.format}${p.sqft ? `, about ${p.sqft} sq ft` : ""}, in ${place}.${p.summary ? ` ${p.summary.slice(0, 400)}` : ""}${focus ? ` Focus: ${focus}.` : ""}`;

  let research = "";
  const blocks: any[] = [];
  try {
    let msgs: ClaudeMsg[] = [{ role: "user", content: ask }];
    let r = await callClaude({ label: "vision-research", model: MODELS.sonnet, maxTokens: 2200, system: sys, messages: msgs, tools: [webTool] });
    blocks.push(...r.content);
    let rounds = 0;
    while (r.stop_reason === "pause_turn" && rounds < 2) {
      msgs = [...msgs, { role: "assistant", content: r.content }];
      r = await callClaude({ label: "vision-research", model: MODELS.sonnet, maxTokens: 2200, system: sys, messages: msgs, tools: [webTool] });
      blocks.push(...r.content);
      rounds++;
    }
    research = blocks.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  } catch (err) {
    return NextResponse.json({ ok: false, error: `The research didn't run: ${errorMessage(err, 200)}` }, { status: 502 });
  }
  const seen = searchedUrls(blocks);
  if (!research || !seen.size) await ran();
  if (!research || !seen.size) return NextResponse.json({ ok: true, kept: 0, dropped: 0, says: "The search found nothing to report on this plan — try a narrower focus." });

  // The research names its sources inline; the extraction is given the list of addresses actually returned, and the
  // check after it holds it to them.
  let raw: unknown[] = [];
  try {
    const ex = await callClaude({ label: "vision-research", model: MODELS.haiku, maxTokens: 2000,
      system: "Turn the research into findings. One finding per claim a source makes; keep its address exactly as listed. Only what the research says — no claim without one of the listed addresses. Always answer with the findings tool.",
      messages: [{ role: "user", content: `Addresses the search returned:\n${[...seen].slice(0, 60).join("\n")}\n\nResearch:\n${research.slice(0, 12000)}` }],
      tools: [FINDINGS], tool_choice: { type: "tool", name: "findings" } });
    const out = ex.toolUses.find((t) => t.name === "findings")?.input;
    raw = Array.isArray(out?.findings) ? out.findings.slice(0, 40) : [];
  } catch (err) {
    return NextResponse.json({ ok: false, error: errorMessage(err, 200) }, { status: 502 });
  }
  const { kept, dropped } = verify(raw, seen);
  const safe = kept.filter((f) => { const g = claimSafeDeep(f); if (!g.ok) console.warn(`[vision-research] claim-guard dropped a finding on "${g.hit}"`); return g.ok; });
  if (!safe.length) { await ran(); return NextResponse.json({ ok: true, kept: 0, dropped: dropped.length + kept.length, says: "Nothing found that a source backs — nothing was stored." }); }
  // Change detection (R60): only what's new — a source and claim already stored for this plan, in any state, isn't again.
  // arrives-with: 0450
  const { data: known, error: ke } = await supabaseAdmin.from("vision_research").select("source_url, claim").eq("plan_id", p.id).eq("tenant_id", tenant);
  if (ke) return NextResponse.json({ ok: false, error: ke.message }, { status: 500 });
  const fresh = novel(safe, (known ?? []) as { source_url: string; claim: string }[]);
  const already = safe.length - fresh.length;
  const runId = crypto.randomUUID();
  if (fresh.length) {
    const { error } = await supabaseAdmin.from("vision_research").insert(fresh.map((f) => ({ ...f, plan_id: p.id, run_id: runId, status: "proposed", tenant_id: tenant })));
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  await ran();
  // A scheduled check that found something new says so, once, quietly, to whoever set the schedule.
  if (scheduled && fresh.length) await raiseAlert({ severity: "fyi", category: "strategy", link: "/vision", targetUserId: p.research_by,
    title: `New research on ${p.name}`.slice(0, 180), body: `The scheduled check found ${fresh.length} new finding${fresh.length === 1 ? "" : "s"} with a source — review them in the plan's Money.` });
  return NextResponse.json({ ok: true, kept: fresh.length, already, dropped: dropped.length + (kept.length - safe.length), runId,
    says: fresh.length ? `${fresh.length} new finding${fresh.length === 1 ? "" : "s"} with a source, proposed for you to accept or reject${already ? ` · ${already} already known` : ""}${dropped.length ? ` · ${dropped.length} dropped (no source the search returned)` : ""}.`
      : `Nothing new — ${already} finding${already === 1 ? "" : "s"} already known.` });
}

export const POST = route("vision/research", post);
