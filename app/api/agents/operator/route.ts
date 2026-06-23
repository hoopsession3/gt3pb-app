import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ClaudeMsg } from "@/lib/anthropic";
import { academyKnowledge } from "@/lib/operatorKb";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
// OPERATOR MODE — the crew's pocket brain (primarily for Kayla). Answers questions about recipes,
// the products, WHY we serve what we serve (primal / whole-food / no oxalates), the gear we have,
// what's in stock, and process & procedures. Grounded ONLY on the governed Academy Source of Truth
// + live assets/inventory. Health-adjacent brand → it must never invent nutrition claims.

const SYSTEM = `You are the GT3 Performance Bar operator's assistant — a calm, fast pocket brain for the crew running the bar (primarily Kayla). You help with recipes, the products, WHY we serve what we serve (primal, whole-food, non-toxic, no oxalates), the gear/assets we have, what's in stock, and our process & procedures.

GROUND TRUTH: Answer ONLY from the GT3 KNOWLEDGE below (the governed Source of Truth) plus the live ASSETS and INVENTORY. Do not use outside knowledge.

HARD RULES (non-negotiable — this is a health-adjacent brand):
- NEVER invent or embellish nutrition, health, ingredient, or caffeine claims. If a fact isn't in the knowledge, say you don't have it verified and to check with Ryan. Caffeine/nutrition numbers are "estimated until lab-verified" — say so when you give them.
- Don't guess recipes, specs, or procedures you weren't given. "I don't have that written down — check with Ryan" is the right answer when you're unsure.
- Be concise and practical — she's often mid-shift and one-handed. Lead with the answer; use short numbered steps for procedures.
- Warm, calm, plain language. No hype.`;

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });

  let messages: any[] = [];
  try { ({ messages } = await req.json()); } catch { /* */ }
  if (!Array.isArray(messages) || messages.length === 0) return NextResponse.json({ ok: false, error: "messages required" }, { status: 400 });
  // Bound the context: last 10 turns, trimmed content.
  const trimmed: ClaudeMsg[] = messages.slice(-10).map((m) => ({ role: m?.role === "assistant" ? "assistant" : "user", content: String(m?.content ?? "").slice(0, 2000) }));

  // Live grounding (best-effort — the assistant still works on Academy knowledge alone).
  let assets = "", inv = "", rules = "";
  if (supabaseAdmin) {
    const [a, i, c] = await Promise.all([
      supabaseAdmin.from("assets").select("name, brand, use_case, qty").limit(200),
      supabaseAdmin.from("inventory_items").select("name, qty, unit, status, critical").limit(200),
      supabaseAdmin.from("compliance_rules").select("state, county, label, kind, critical, link").eq("active", true).order("sort").limit(300),
    ]);
    assets = (a.data ?? []).map((x: any) => `- ${x.name}${x.brand ? ` (${x.brand})` : ""}${x.qty != null ? ` ×${x.qty}` : ""}${x.use_case ? ` — ${x.use_case}` : ""}`).join("\n");
    inv = (i.data ?? []).map((x: any) => `- ${x.name}: ${x.qty ?? "?"}${x.unit ? ` ${x.unit}` : ""}${x.status ? ` (${x.status})` : ""}${x.critical ? " [critical]" : ""}`).join("\n");
    rules = (c.data ?? []).map((x: any) => `- [${x.state ?? "ANY"}${x.county ? `/${x.county}` : ""}] (${x.kind}${x.critical ? ", CRITICAL" : ""}) ${x.label}${x.link ? ` — ${x.link}` : ""}`).join("\n");
  }

  const system = `${SYSTEM}\n\n=== GT3 KNOWLEDGE ===\n${academyKnowledge()}\n\n=== ASSETS / GEAR WE HAVE ===\n${assets || "(none loaded)"}\n\n=== INVENTORY ON HAND ===\n${inv || "(none loaded)"}\n\n=== PERMIT / INSPECTION REQUIREMENTS BY JURISDICTION (researched; [STATE/County], ANY = universal) ===\n${rules || "(none loaded)"}\nWhen asked about permits or an inspection for a place, use the rows matching that state/county PLUS the ANY rows. If we have NO rows for that jurisdiction, say it isn't researched yet, give the universal items, and tell them to confirm with that county's health department (and flag Ryan to research it). For an inspection ask, lead with what the inspector will check, then a short prep checklist. Always remind them to confirm with the authority for the specific date.`;

  try {
    const r = await callClaude({ model: MODELS.sonnet, maxTokens: 700, temperature: 0.3, system, messages: trimmed });
    return NextResponse.json({ ok: true, reply: r.text });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}
