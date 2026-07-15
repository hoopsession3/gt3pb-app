import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef, type ClaudeMsg } from "@/lib/anthropic";
import { claimSafeDeep } from "@/lib/claimGuard";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// CHIEF OF SALES — scours the web for UPCOMING opportunities where GT3 could vend or get booked:
// fitness events/races/run clubs, festivals, farmers/makers markets, corporate parks, wellness expos,
// and local "things to do" newsletters (GVLtoday / ATLtoday, Visit Greenville, Eventbrite) across the
// chosen markets. Returns ranked opportunities with how to pitch + a source link. A found opportunity
// can be saved straight into the Bookings pipeline as a lead. Web search (like the inspection agent),
// then a forced extraction. Staff-gated, lean (a few searches) to stay under maxDuration.

const OPP: ToolDef = {
  name: "opportunities",
  description: "Concrete, real, findable opportunities for a mobile beverage truck — never invented. Each with a source link.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One line: the shape of the pipeline found." },
      opportunities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The event / venue / opportunity name." },
            date: { type: "string", description: "When — a date, range, or 'recurring Saturdays', etc." },
            location: { type: "string", description: "City + venue if known." },
            fit: { type: "string", description: "Why it fits GT3 (audience, foot traffic, wellness/fitness crowd)." },
            pitch: { type: "string", description: "How to approach — who to contact / where to apply (vendor form, organizer email)." },
            source: { type: "string", description: "A source URL." },
            score: { type: "string", enum: ["hot", "warm", "cold"], description: "hot = strong fit + actionable now." },
          },
          required: ["name", "location", "fit", "score"],
        },
      },
    },
    required: ["summary", "opportunities"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  // ── COMMIT: save selected opportunities into the Bookings pipeline as leads ──
  if (body.commit) {
    const opps = Array.isArray(body.commit.opportunities) ? body.commit.opportunities.filter((o: any) => o?.name?.trim()) : [];
    if (!opps.length) return NextResponse.json({ ok: true, added: 0 });
    const rows = opps.slice(0, 25).map((o: any) => ({
      name: String(o.name).slice(0, 160), status: "new",
      location_text: o.location ? String(o.location).slice(0, 200) : null,
      notes: [o.date ? `When: ${o.date}` : null, o.fit ? `Fit: ${o.fit}` : null, o.pitch ? `Pitch: ${o.pitch}` : null, o.source ? `Source: ${o.source}` : null, "(scouted by Chief of Sales)"].filter(Boolean).join("\n").slice(0, 1200),
    }));
    const { error } = await supabaseAdmin.from("booking_requests").insert(rows);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, added: rows.length });
  }

  // ── SCOUT: web-search the markets, then extract structured opportunities ──
  const markets: string[] = Array.isArray(body.markets) && body.markets.length
    ? body.markets.map((m: any) => String(m).slice(0, 60)).slice(0, 4)
    : ["Greenville, SC", "Atlanta, GA"];
  const focus = String(body.focus ?? "").slice(0, 200);

  const webTool: any = { type: "web_search_20260209", name: "web_search", max_uses: 4 };
  const sys =
    "You are the Chief of Sales for GT3 Performance Bar, a mobile beverage truck (clean cold-brew coffee, nitro, broth, bottled performance drinks; wellness/fitness positioning). " +
    "Scout UPCOMING opportunities where GT3 could vend, sponsor, or get booked. Look for: fitness events / races / run clubs / gyms / CrossFit, festivals & fairs, farmers & makers markets, corporate campuses & office parks, wellness expos, and local 'things to do' / newsletter roundups (e.g. GVLtoday, ATLtoday, Visit Greenville, Eventbrite, city event calendars). " +
    "Make a few focused searches across the markets given. Then list CONCRETE, real, findable opportunities with dates, venues, and source links, plus how to get in (vendor application, organizer contact). Only real events you actually found — never invent one. Note when something needs confirming with the organizer.";
  const ask = `Markets: ${markets.join("; ")}.${focus ? ` Focus: ${focus}.` : ""} Find upcoming opportunities for the next 1–3 months and tell me how to get booked.`;

  let research = "";
  try {
    let msgs: ClaudeMsg[] = [{ role: "user", content: ask }];
    let r = await callClaude({ label: "sales", model: MODELS.sonnet, maxTokens: 2000, system: sys, messages: msgs, tools: [webTool] });
    let rounds = 0;
    while (r.stop_reason === "pause_turn" && rounds < 2) {
      msgs = [...msgs, { role: "assistant", content: r.content }];
      r = await callClaude({ label: "sales", model: MODELS.sonnet, maxTokens: 2000, system: sys, messages: msgs, tools: [webTool] });
      rounds++;
    }
    research = (r.text || "").trim();
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: `Scout/web search failed: ${String(err?.message ?? err).slice(0, 200)}` }, { status: 502 });
  }
  if (!research) return NextResponse.json({ ok: true, summary: "No opportunities surfaced — try a broader focus.", opportunities: [] });
  // Deterministic backstop (F5 — output claim-guard): `research` is raw web-search text — an
  // opportunity's own marketing copy could carry a claim GT3 has no business repeating.

  let out: any = null;
  try {
    const ex = await callClaude({ label: "sales",
      model: MODELS.haiku, maxTokens: 1800,
      system: "Turn the sales research into clean opportunity rows for a mobile beverage truck. One row per real opportunity, keep the source links, rank fit (hot/warm/cold). Don't invent — only what's in the research. Always answer with the opportunities tool.",
      messages: [{ role: "user", content: `Markets: ${markets.join("; ")}\n\nResearch:\n${research}` }],
      tools: [OPP], tool_choice: { type: "tool", name: "opportunities" },
    });
    out = ex.toolUses.find((t) => t.name === "opportunities")?.input ?? null;
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 200) }, { status: 502 });
  }
  const safeResearchSummary = claimSafeDeep(research.slice(0, 300)).ok ? research.slice(0, 300) : "";
  if (!out) return NextResponse.json({ ok: true, summary: safeResearchSummary, opportunities: [] });

  const opportunities = (out.opportunities ?? []).filter((o: any) => o?.name?.trim()).slice(0, 20).map((o: any) => ({
    name: String(o.name).slice(0, 160), date: o.date ? String(o.date).slice(0, 80) : "",
    location: o.location ? String(o.location).slice(0, 120) : "", fit: o.fit ? String(o.fit).slice(0, 240) : "",
    pitch: o.pitch ? String(o.pitch).slice(0, 240) : "", source: o.source ? String(o.source).slice(0, 400) : "",
    score: ["hot", "warm", "cold"].includes(o.score) ? o.score : "warm",
  })).filter((o: any) => {
    const guard = claimSafeDeep(o);
    if (!guard.ok) console.warn(`[sales] claim-guard dropped "${o.name}" on "${guard.hit}" (${guard.path})`);
    return guard.ok;
  });
  const summaryGuard = claimSafeDeep(out.summary ?? "");
  if (!summaryGuard.ok) console.warn(`[sales] claim-guard dropped the summary on "${summaryGuard.hit}"`);
  return NextResponse.json({ ok: true, summary: summaryGuard.ok ? (out.summary ?? "") : safeResearchSummary, opportunities });
}
