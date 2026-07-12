import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { callClaude, anthropicEnabled, MODELS } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// TRANSCRIBE — turn uploaded attachments into one clean transcript for the ops-plan / summarize
// agents. Reads photos of HANDWRITTEN notes, PDFs, and screenshots with Claude's vision/document
// support and returns faithful text (structure preserved, illegible bits flagged). Multiple files →
// one combined transcript, in order. Staff-gated. No writes.

const IMG = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_FILES = 8;
const MAX_TOTAL_B64 = 18_000_000; // ~13 MB of raw attachments across the batch

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });

  let files: { name?: string; media_type?: string; data?: string }[] = [];
  try { ({ files } = await req.json()); } catch { /* */ }
  files = (files ?? []).filter((f) => f?.data && f?.media_type).slice(0, MAX_FILES);
  if (files.length === 0) return NextResponse.json({ ok: false, error: "No readable files" }, { status: 400 });

  const total = files.reduce((s, f) => s + (f.data?.length ?? 0), 0);
  if (total > MAX_TOTAL_B64) return NextResponse.json({ ok: false, error: "Attachments too large — under ~12 MB total per batch." }, { status: 413 });

  const blocks: any[] = [{ type: "text", text: "Transcribe every attachment below into one faithful transcript." }];
  for (const f of files) {
    const name = String(f.name ?? "file").slice(0, 120);
    blocks.push({ type: "text", text: `\n--- ${name} ---` });
    if (f.media_type === "application/pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
    } else if (IMG.has(f.media_type!)) {
      blocks.push({ type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } });
    } else {
      blocks.push({ type: "text", text: "(unsupported file type — skipped)" });
    }
  }

  try {
    const r = await callClaude({ label: "transcribe",
      model: MODELS.sonnet,
      maxTokens: 4000,
      temperature: 0,
      system: [
        "You transcribe meeting materials for a mobile beverage business. Read every attachment — photos of HANDWRITTEN notes, PDFs, and screenshots — and produce ONE clean, faithful transcript.",
        "Preserve structure: names, dates, bullet points, decisions, action items. Transcribe handwriting as best you can; mark a truly illegible word as [illegible]. Keep each file's content under its '--- name ---' header, in order.",
        "Output ONLY the transcript text — no preamble, no summary, no commentary.",
      ].join("\n"),
      messages: [{ role: "user", content: blocks }],
    });
    const text = (r.text ?? "").trim();
    if (!text) return NextResponse.json({ ok: false, error: "Couldn't read the attachments" }, { status: 502 });
    return NextResponse.json({ ok: true, text: text.slice(0, 20000), files: files.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}
