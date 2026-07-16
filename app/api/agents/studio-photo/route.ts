import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";
import { claimSafeDeep } from "@/lib/claimGuard";

export const runtime = "nodejs";
export const maxDuration = 30;

/* eslint-disable @typescript-eslint/no-explicit-any */
// STUDIO PHOTO CLASSIFY — the first photo dropped on a brand-new piece gets read (vision) and
// proposes a title/hook/tags, same shape as Smart Intake (app/api/agents/intake) but scoped to
// content pieces instead of assets/inventory/documents. Fired once per piece — on the FIRST photo of
// a still-"Untitled" piece, from Studio.tsx's uploadMedia — not on every photo in a carousel, so this
// stays cheap. Haiku, not Sonnet: this is the high-volume/low-complexity tier per lib/anthropic.ts's
// own model comment. Proposal only — the client pre-fills empty fields and the human can edit or
// clear any of it before the piece ever leaves draft; nothing here writes to the DB or advances status.

const MAX_BYTES = 8 * 1024 * 1024; // a phone photo is a few MB; refuse anything unreasonable rather than pass it to the model

const TOOL: ToolDef = {
  name: "studio_photo_read",
  description: "Read a photo dropped on a new content piece and propose a title, a short hook line, and a few tags.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "A short, specific title for this piece (what's actually in the photo — not a generic label like 'Photo' or 'Post'). Under 60 characters." },
      hook: { type: "string", description: "One short attention-grabbing line this photo could open a post with. Empty string if nothing fits." },
      tags: { type: "array", items: { type: "string" }, description: "2-5 short lowercase tags describing what's shown (subject, setting, product, mood). No hashtag symbol." },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["title", "tags", "confidence"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const url = String(body.url ?? "");
  const mime = String(body.mime ?? "");
  const channel = body.channel ? String(body.channel).slice(0, 40) : "";
  if (!url) return NextResponse.json({ ok: false, error: "url required" }, { status: 400 });
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime.toLowerCase())) {
    return NextResponse.json({ ok: false, error: "not a classifiable image" }, { status: 400 });
  }

  let b64 = "";
  try {
    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ ok: false, error: "couldn't read the uploaded photo" }, { status: 502 });
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ ok: false, error: "photo too large to classify" }, { status: 413 });
    b64 = Buffer.from(buf).toString("base64");
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 502 });
  }

  let out: any = null;
  try {
    const r = await callClaude({ label: "studio-photo",
      model: MODELS.haiku, maxTokens: 400, temperature: 0.4,
      system:
        "You are the content-intake assistant for GT3 Performance Bar, a mobile beverage truck's social/brand studio. Someone just dropped a photo onto a brand-new content piece with no title yet. Look at what's actually in the frame — product, people, setting, mood, text visible on packaging or signage — and propose a short, specific title (not a generic placeholder), an optional one-line hook, and a few descriptive tags. Never invent a health, nutrition, or ingredient claim that isn't visibly on the label in the photo — if you're not sure what a product is, describe it generically (e.g. \"bottled drink\") rather than guessing a name or benefit. Be decisive but honest about confidence. Always answer with the studio_photo_read tool.",
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mime.toLowerCase(), data: b64 } }, { type: "text", text: channel ? `Channel: ${channel}. Propose a title, hook, and tags for this photo.` : "Propose a title, hook, and tags for this photo." }] }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "studio_photo_read" },
    });
    out = r.toolUses.find((t) => t.name === "studio_photo_read")?.input ?? null;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Couldn't read that photo: ${String(e?.message ?? e).slice(0, 180)}` }, { status: 502 });
  }
  if (!out) return NextResponse.json({ ok: false, error: "no read" }, { status: 502 });

  // Deterministic backstop (F5 — output claim-guard) — same hard rule every agent in this app carries.
  const guard = claimSafeDeep(out);
  if (!guard.ok) {
    console.warn(`[studio-photo] claim-guard tripped on "${guard.hit}" (${guard.path}) — proposal blocked`);
    return NextResponse.json({ ok: false, error: "Couldn't classify that photo safely — title/tags it manually." }, { status: 502 });
  }

  const proposal = {
    title: String(out.title || "").slice(0, 60),
    hook: String(out.hook || "").slice(0, 140),
    tags: Array.isArray(out.tags) ? out.tags.slice(0, 5).map((t: any) => String(t).toLowerCase().replace(/^#/, "").slice(0, 30)) : [],
    confidence: ["high", "medium", "low"].includes(out.confidence) ? out.confidence : "medium",
  };
  if (!proposal.title) return NextResponse.json({ ok: false, error: "no confident read" }, { status: 502 });

  return NextResponse.json({ ok: true, proposal });
}
