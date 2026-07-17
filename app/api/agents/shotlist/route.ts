import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { claimSafeDeep } from "@/lib/claimGuard";

export const runtime = "nodejs";
export const maxDuration = 30;

/* eslint-disable @typescript-eslint/no-explicit-any */
// SHOT LIST DRAFT — given a shoot (title/location/notes) and a few freeform planning notes, Claude
// proposes a concrete, ordered shot list. Same "propose it, the crew approves what to keep" shape as
// the day planner's draft_day (app/api/agents/dayplan) and Studio's photo read (studio-photo) — this
// endpoint never writes to the DB; ShootPlanner.tsx's ShotDraftPanel adds only the shots the crew
// picks, same as any other shot added by hand. Staff-gated.

const TOOL: ToolDef = {
  name: "draft_shots",
  description: "Propose a concrete, ordered shot list for a content shoot.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One line: the shape of this shoot." },
      shots: {
        type: "array",
        description: "Concrete, specific, shootable frames in a sensible order — hero/must-have shots first, then supporting and detail shots. Not vague ideas ('get some good shots') — actual frames: subject, setting or angle, what's happening.",
        items: { type: "string", description: "One shot, e.g. 'Wide hero shot of the truck at golden hour, lake in the background.'" },
      },
    },
    required: ["summary", "shots"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const shootId: string | undefined = body.shoot_id;
  const notes: string = String(body.notes ?? "").slice(0, 2000);
  if (!shootId) return NextResponse.json({ ok: false, error: "shoot_id required" }, { status: 400 });

  const shoot = (await supabaseAdmin.from("shoots").select("title, location, notes, shoot_date").eq("id", shootId).maybeSingle()).data as any;
  if (!shoot) return NextResponse.json({ ok: false, error: "shoot not found" }, { status: 404 });

  let out: { summary: string; shots: string[] } | null = null;
  try {
    const r = await callClaude({ label: "shotlist",
      model: MODELS.sonnet, maxTokens: 900, temperature: 0.4,
      system:
        "You plan content shoots for GT3 Performance Bar, a mobile beverage truck's brand/social studio run by a small crew (Ryan & Kayla). " +
        "Given a shoot's title/location and the crew's notes, propose a concrete, specific, shootable shot list. " +
        "Order hero/must-have shots first, then supporting and detail shots. " +
        "Don't invent products, people, or claims that aren't implied by what you were given. Always answer with the draft_shots tool.",
      messages: [{ role: "user", content: `Shoot: ${JSON.stringify(shoot)}\n\nCrew notes: ${notes || "(none given — work from the shoot's own title/location)"}` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "draft_shots" },
    });
    out = r.toolUses.find((t) => t.name === "draft_shots")?.input ?? null;
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).slice(0, 300) }, { status: 502 });
  }
  if (!out) return NextResponse.json({ ok: false, error: "no draft" }, { status: 502 });

  // Deterministic backstop (F5 — output claim-guard) — same hard rule every agent in this app carries.
  const guard = claimSafeDeep(out);
  if (!guard.ok) {
    console.warn(`[shotlist] claim-guard tripped on "${guard.hit}" (${guard.path}) — draft blocked`);
    return NextResponse.json({ ok: false, error: "The draft needs review — try again." }, { status: 502 });
  }

  const shots = (out.shots ?? [])
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => s.trim().slice(0, 240))
    .slice(0, 20);
  return NextResponse.json({ ok: true, summary: String(out.summary ?? "").slice(0, 200), shots });
}
