import { NextResponse } from "next/server";
import { adminFromRequest, callerClient, tenantFromRequest } from "@/lib/apiAuth";
import { callClaude, anthropicEnabled } from "@/lib/anthropic";
import { isJsonObject, route } from "@/lib/apiRoute";
import { runIntake, type Deps, type ModelRequest } from "@/lib/libraryResearch";
import type { Known } from "@/lib/libraryIntake";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// LIBRARY INTAKE (IMS6 A2, 0462) — "Ask → Research → Populate → Review exceptions → Save candidate". An owner or admin
// pastes a link, describes a need, or uploads a file; GT3 researches it once, within its budget, and writes draft facts
// for review. Every read and write here is the CALLER's (their session, so the database's row rules and checks apply);
// the server's own key is used only by the shared cost meter (ai_usage, lib/anthropic). Nothing here accepts a fact,
// qualifies or approves an asset, or writes a judgement — the database refuses those to anyone but a person, through
// their own review (std_accept_facts, the 0461 gate).
async function post(req: Request) {
  if (!(await adminFromRequest(req))) return NextResponse.json({ ok: false, error: "Only an owner or admin can research an asset." }, { status: 403 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI isn't configured here (ANTHROPIC_API_KEY)." }, { status: 503 });
  const sb = callerClient(req);
  const tenant = await tenantFromRequest(req);
  if (!sb || !tenant) return NextResponse.json({ ok: false, error: "Which business?" }, { status: 403 });
  let body: any = {};
  try { body = await req.json(); } catch { /* an empty body is a 400 below */ }
  if (!isJsonObject(body)) body = {};
  const kind = body.kind === "url" || body.kind === "describe" || body.kind === "upload" ? body.kind : null;
  if (!kind) return NextResponse.json({ ok: false, error: "Paste a link, describe it, or upload a file." }, { status: 400 });

  const must = <T,>(r: { data: T; error: { message: string } | null }, what: string): T => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
  const deps: Deps = {
    intakeByHash: async (hash, since) => (must(await sb.from("std_intakes").select("id, status, material_id").eq("request_hash", hash).gte("created_at", since).order("created_at", { ascending: false }).limit(1), "intakes") as any[])[0] ?? null,
    createIntake: async (row) => String((must(await sb.from("std_intakes").insert(row).select("id").single(), "intake") as any).id),
    updateIntake: async (id, patch) => { must(await sb.from("std_intakes").update({ ...patch, updated_at: new Date().toISOString() } as any).eq("id", id), "intake"); },
    known: async () => (must(await sb.from("std_materials").select("id, name, maker, product_ref, source_url_norm, w_in, d_in, h_in, finishes, composition").is("archived_at", null).limit(5000), "library") as any[])
      .map((k) => ({ ...k, w_in: k.w_in == null ? null : Number(k.w_in), d_in: k.d_in == null ? null : Number(k.d_in), h_in: k.h_in == null ? null : Number(k.h_in) })) as Known[],
    budget: async () => {
      const b = (must(await sb.from("std_research_budget").select("per_run_cents, per_run_searches, per_run_fetches, per_run_tokens").limit(1), "budget") as any[])[0];
      return b ?? { per_run_cents: 25, per_run_searches: 5, per_run_fetches: 3, per_run_tokens: 60000 };   // 0462's defaults, before the first reservation makes the row
    },
    criteria: async () => {
      const v = (must(await sb.from("std_versions").select("id").eq("status", "published").order("published_at", { ascending: false }).limit(1), "Standard") as any[])[0];
      if (!v) return [];
      return (must(await sb.from("std_criteria").select("code, title, mandatory, categories").eq("version_id", v.id).eq("applies_to", "material"), "criteria") as any[]).map((c) => ({ ...c, categories: c.categories ?? [] }));
    },
    reserve: async (intake, depth) => {
      const r = await sb.rpc("std_research_reserve", { p_intake: intake, p_depth: depth });
      return r.error ? { ok: false, code: String((r.error as any).code ?? ""), message: r.error.message } : { ok: true, run: String(r.data) };
    },
    settle: async (run, usage, cents, outcome, error) => {
      const r = await sb.rpc("std_research_settle", { p_run: run, p_usage: usage as any, p_cost_cents: cents as any, p_outcome: outcome, p_error: error ?? undefined });
      if (r.error) { console.warn(`[library-intake] couldn't settle run ${run} — ${r.error.message} (the next reservation closes it at full charge)`); return null; }
      return Number(r.data);
    },
    createAsset: async (row) => String((must(await sb.from("std_materials").insert(row as any).select("id").single(), "asset") as any).id),
    insertFacts: async (material, intake, facts) => {
      const rows = facts.map((f) => ({ ...f, material_id: material, intake_id: intake, value: f.value as any }));
      return (must(await sb.from("std_asset_facts").insert(rows as any).select("id"), "facts") as any[]).length;
    },
    readFile: async (path) => {
      const r = await sb.storage.from("library-intake").download(path);
      if (r.error || !r.data) return null;
      return { bytes: new Uint8Array(await r.data.arrayBuffer()), mime: r.data.type || (path.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream") };
    },
    model: async (q: ModelRequest) => {
      const r = await callClaude({ model: q.model, system: q.system, messages: q.messages as any, tools: q.tools as any, maxTokens: q.maxTokens, temperature: 0, label: "library-intake" });
      return { content: r.content, stop_reason: r.stop_reason, usage: r.usage ?? null };
    },
    now: () => Date.now(),
  };
  try {
    const out = await runIntake({ kind, input: typeof body.input === "string" ? body.input : null, file_path: typeof body.file_path === "string" ? body.file_path : null, category: typeof body.category === "string" ? body.category : null, tenant }, deps);
    const code = out.status === "budget_exhausted" ? 429 : out.status === "refused" ? 422 : out.status === "failed" ? 502 : 200;
    return NextResponse.json({ ok: code === 200, ...out }, { status: code });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Couldn't research it: ${(e as Error).message.slice(0, 300)}` }, { status: 500 });
  }
}

export const POST = route("library/intake", post);
