import { NextResponse } from "next/server";
import { staffFromRequest, userFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { claimSafeDeep } from "@/lib/claimGuard";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// SESSION EXTRACTOR (2026-08-03 — the OS's Post-Session Pipeline, automated). "Every strategy
// session ends the way the cooler session did: five extractions, same order, same day" — except
// the 8/2 ones were extracted BY HAND into PDFs. Paste the transcript here instead and the five
// land on their spines in one pass: decisions → the append-only ledger (with provenance to the
// session note this creates) · open items → the note's dated follow-ups · calendar deltas →
// events · pipeline moves → accounts (matched through the 0226-style resolver rules; unmatched
// names are REPORTED, never guessed into new accounts) · the session itself → a strategy note.
// Claim-guarded like every other agent; grounded-only extraction; the response says exactly what
// was filed and what was skipped.

const STAGES = ["lead", "warm", "sampled", "pilot", "live", "expand", "lost"];
const TOOL: ToolDef = {
  name: "session_extraction",
  description: "The five extractions from a strategy-session transcript. Ground every item in the transcript — never invent.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short session title, e.g. 'Strategy Session · the pricing call'." },
      summary_md: { type: "string", description: "GitHub-flavored Markdown recap: ## Decided (bullet per decision) · ## Open (bullets) · ## Notes (key discussion). Concise, grounded." },
      decisions: { type: "array", items: { type: "object", properties: {
        key: { type: "string", description: "Short kebab/colon key, e.g. 'pricing:commission'." },
        decision: { type: "string", description: "The call, one sentence, past-tense definitive." },
        why: { type: "string" } }, required: ["key", "decision"] } },
      open_items: { type: "array", items: { type: "object", properties: {
        label: { type: "string" }, critical: { type: "boolean", description: "true if it blocks a dependent move." },
        due: { type: "string", description: "YYYY-MM-DD if a date was stated; omit otherwise." } }, required: ["label"] } },
      calendar: { type: "array", items: { type: "object", properties: {
        title: { type: "string" }, day: { type: "string", description: "YYYY-MM-DD" }, location: { type: "string" } }, required: ["title", "day"] } },
      pipeline_moves: { type: "array", items: { type: "object", properties: {
        account: { type: "string", description: "Account/vendor name as spoken." },
        stage: { type: "string", enum: STAGES },
        next_move: { type: "string" },
        next_move_at: { type: "string", description: "YYYY-MM-DD if stated." } }, required: ["account"] } },
      activities: { type: "array", items: { type: "object", properties: {
        account: { type: "string", description: "Account/vendor name as spoken." },
        type: { type: "string", enum: ["popup", "sampler", "event", "restock", "other"] },
        date: { type: "string", description: "YYYY-MM-DD if stated; omit otherwise." },
        sampled: { type: "number", description: "Pours given, if a number was stated." },
        buyers: { type: "number", description: "Pours that converted to purchases, if stated." },
        bottles: { type: "number", description: "Bottles stocked/restocked, if stated." },
        revenue: { type: "number", description: "Dollars taken at the activation, if stated." },
        cost: { type: "number", description: "Dollars SPENT on the activation, if stated." },
        note: { type: "string" } }, required: ["account", "type"] },
        description: "Activation touches the transcript reports as HAVING HAPPENED (a pop-up run, a sampler dropped, a restock done) — with any numbers actually stated. Plans for future activations are next moves, not activities." },
    },
    required: ["title", "summary_md", "decisions", "open_items", "calendar", "pipeline_moves"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  const caller = await userFromRequest(req);

  let text = "";
  try { ({ text = "" } = await req.json()); } catch { /* */ }
  text = String(text).slice(0, 24000);
  if (!text.trim()) return NextResponse.json({ ok: false, error: "paste the transcript" }, { status: 400 });

  let out: any;
  try {
    const r = await callClaude({ label: "session-extract",
      model: MODELS.sonnet, maxTokens: 3000, temperature: 0.1,
      system: "You are the post-session pipeline for GT3 Performance Bar (mobile beverage business, two operators). Extract ONLY what the transcript supports: decisions actually made (definitive calls, not discussion), open items explicitly left open, calendar commitments with dates, pipeline account moves, and activation activities that ALREADY HAPPENED (a pop-up run, a sampler dropped, a restock done — with any counts, revenue, or spend actually stated; planned activations are next moves, not activities). Known pipeline stages: lead → warm → sampled → pilot → live → expand (+ lost). Always answer with the session_extraction tool. Never invent an item, a number, a date, or an account name.",
      messages: [{ role: "user", content: `Session transcript:\n\n${text}` }],
      tools: [TOOL], tool_choice: { type: "tool", name: "session_extraction" },
    });
    out = r.toolUses.find((t) => t.name === "session_extraction")?.input;
    if (!out?.title) return NextResponse.json({ ok: false, error: "no extraction" }, { status: 502 });
    const guard = claimSafeDeep(out);
    if (!guard.ok) return NextResponse.json({ ok: false, error: "The extraction needs review before filing — try again." }, { status: 502 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const okDate = (s: any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;

  // 1 · the session note — the record everything below hangs off
  const { data: note, error: ne } = await supabaseAdmin.from("meeting_notes").insert({
    title: String(out.title).slice(0, 160), met_on: today, source: "strategy", visibility: "team",
    summary: String(out.summary_md).slice(0, 12000), body: text, created_by: caller?.id ?? null,
  }).select("id").single();
  if (ne) return NextResponse.json({ ok: false, error: ne.message }, { status: 500 });
  const noteId = (note as any).id;

  // 2 · decisions → the ledger (append-only; identical text dedupes)
  let dec = 0;
  for (const d of (out.decisions ?? []).filter((d: any) => d?.decision?.trim())) {
    const { data: dup } = await supabaseAdmin.from("strategy_decisions").select("id").eq("decision", d.decision.trim()).limit(1).maybeSingle();
    if (dup) continue;
    const { error } = await supabaseAdmin.from("strategy_decisions").insert({
      key: String(d.key || "session").slice(0, 60), decision: d.decision.trim().slice(0, 500),
      why: d.why?.trim()?.slice(0, 500) || null, author_name: "Session", author_id: caller?.id ?? null, note_id: noteId,
    });
    if (!error) dec++;
  }

  // 3 · open items → the note's follow-ups (dated at 5pm ET when a date was stated)
  let items = 0;
  for (const [i, o] of ((out.open_items ?? []) as any[]).filter((o) => o?.label?.trim()).entries()) {
    const due = okDate(o.due);
    const { error } = await supabaseAdmin.from("event_tasks").insert({
      meeting_note_id: noteId, label: o.label.trim().slice(0, 300), kind: "task", section: "Follow-up",
      critical: !!o.critical, due_at: due ? `${due}T17:00:00-04:00` : null, sort: 500 + i,
    });
    if (!error) items++;
  }

  // 4 · calendar deltas → events (guarded on title+day)
  let evs = 0;
  for (const c of ((out.calendar ?? []) as any[]).filter((c) => c?.title?.trim() && okDate(c.day))) {
    const { data: dup } = await supabaseAdmin.from("events").select("id").eq("title", c.title.trim()).eq("day", c.day).limit(1).maybeSingle();
    if (dup) continue;
    const { error } = await supabaseAdmin.from("events").insert({ title: c.title.trim().slice(0, 160), day: c.day, location_text: c.location?.trim()?.slice(0, 160) || null });
    if (!error) evs++;
  }

  // 5 · pipeline moves — resolver rules (0226 spirit): exact / space-insensitive / containment.
  // A uniquely matched vendor updates its open account (or opens one at the stated stage).
  // No match = SKIPPED and reported — the extractor never mints accounts from a heard name.
  const { data: vends } = await supabaseAdmin.from("vendors").select("id, name").is("archived_at", null);
  const flat = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const vendorHit = (nm: string) => {
    const hits = ((vends ?? []) as any[]).filter((v) =>
      v.name === nm || flat(v.name) === flat(nm) || nm.toLowerCase().includes(v.name.toLowerCase()) || v.name.toLowerCase().includes(nm.toLowerCase()));
    return hits.length === 1 ? hits[0].id : null;
  };
  let moves = 0; const skipped: string[] = [];
  for (const m of ((out.pipeline_moves ?? []) as any[]).filter((m) => m?.account?.trim())) {
    const nm = m.account.trim();
    const vid = vendorHit(nm);
    if (!vid) { skipped.push(nm); continue; }
    const stage = STAGES.includes(m.stage) ? m.stage : null;
    const patch: any = {};
    if (stage) patch.stage = stage;
    if (m.next_move?.trim()) patch.next_step = m.next_move.trim().slice(0, 300);
    const at = okDate(m.next_move_at); if (at) patch.next_step_at = at;
    if (stage === "live") patch.won_at = new Date().toISOString();
    const { data: opp } = await supabaseAdmin.from("opportunities").select("id").eq("vendor_id", vid).neq("stage", "lost").limit(1).maybeSingle();
    if (opp) { const { error } = await supabaseAdmin.from("opportunities").update(patch).eq("id", (opp as any).id); if (!error) moves++; }
    else { const { error } = await supabaseAdmin.from("opportunities").insert({ vendor_id: vid, stage: stage ?? "lead", ...patch, source: "manual" }); if (!error) moves++; }
  }

  // 6 · activities that already happened → the uplift ledger (0268). Same resolver, same rule:
  // an ambiguous or unknown account name is SKIPPED and reported, never guessed onto a card.
  let actsFiled = 0;
  const cents = (v: any) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null);
  const cnt = (v: any) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  for (const a of ((out.activities ?? []) as any[]).filter((a) => a?.account?.trim() && ["popup", "sampler", "event", "restock", "other"].includes(a?.type))) {
    const nm = a.account.trim();
    const vid = vendorHit(nm);
    if (!vid) { if (!skipped.includes(nm)) skipped.push(nm); continue; }
    const { data: opp } = await supabaseAdmin.from("opportunities").select("id").eq("vendor_id", vid).neq("stage", "lost").limit(1).maybeSingle();
    if (!opp) { if (!skipped.includes(nm)) skipped.push(nm); continue; }
    const { error } = await supabaseAdmin.from("account_activities").insert({
      opportunity_id: (opp as any).id, type: a.type, on_date: okDate(a.date) ?? today,
      sampled: cnt(a.sampled), buyers: cnt(a.buyers), bottles: cnt(a.bottles),
      revenue_cents: cents(a.revenue), cost_cents: cents(a.cost),
      note: a.note?.trim()?.slice(0, 240) || null, created_by: caller?.id ?? null,
    });
    if (!error) actsFiled++;
  }

  return NextResponse.json({ ok: true, note_id: noteId, title: out.title, decisions: dec, open_items: items, events: evs, pipeline_moves: moves, activities: actsFiled, skipped });
}
