import { NextResponse } from "next/server";
import { staffFromRequest, userFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// SMART INTAKE — drop ANY file. The agent reads it (vision for photos, text for PDFs/docs), figures
// out what it is, and proposes the right home: an ASSET (gear we own), an INVENTORY consumable (stock
// we use up), or a DOCUMENT to store (permit, COI, contract, receipt, manual, recipe). Two phases:
//   • scan   → POST { path, name, mime }  → reads the file, returns a proposal (no writes)
//   • commit → POST { commit: {...} }      → files it into assets / inventory_items / documents
// Staff-gated. The file lives in the private 'intake' bucket regardless.

const KINDS = ["asset", "inventory", "document", "recipe", "photo", "other"];

const TOOL: ToolDef = {
  name: "intake_read",
  description: "Classify a dropped file and propose where it belongs + the fields to file it with.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: KINDS, description: "asset = gear/equipment we own; inventory = a consumable we use up (beans, bottles, cups, ingredients); document = paperwork to store (permit, COI, contract, receipt, invoice, manual); recipe = a recipe/spec doc; photo = a general photo; other = anything else." },
      name: { type: "string", description: "A clear name/title for this item or document." },
      summary: { type: "string", description: "One or two lines: what it is and anything important read from it (amounts, dates, vendor)." },
      category: { type: "string", description: "For an asset or inventory item: a short category (e.g. 'dispense', 'packaging', 'coffee'). Empty if N/A." },
      qty: { type: ["number", "null"], description: "For inventory: the count/amount visible, else null." },
      unit: { type: "string", description: "For inventory: the unit (each, case, lb, oz, gal). Empty if N/A." },
      doc_kind: { type: "string", description: "For a document: permit | coi | contract | receipt | invoice | manual | compliance | other. Empty if N/A." },
      tags: { type: "array", items: { type: "string" }, description: "A few short tags." },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      action: { type: "string", description: "One line: the recommended next step / why this home." },
    },
    required: ["kind", "name", "summary", "action"],
  },
};

// Build the Anthropic content block for the file (image / pdf / text).
function fileBlock(mime: string, b64: string, name: string): any {
  const m = (mime || "").toLowerCase();
  if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(m)) {
    return { type: "image", source: { type: "base64", media_type: m, data: b64 } };
  }
  if (m === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } };
  }
  // text-ish: decode and inline (capped)
  try {
    const text = Buffer.from(b64, "base64").toString("utf8").slice(0, 12000);
    return { type: "text", text: `File "${name}" (${mime}) contents:\n${text}` };
  } catch {
    return { type: "text", text: `File "${name}" of type ${mime} (binary — classify from the name and type).` };
  }
}

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  // ── COMMIT: file it where the user confirmed ──
  if (body.commit) {
    const c = body.commit;
    const kind = KINDS.includes(c.kind) ? c.kind : "other";
    const name = String(c.name || "Untitled").slice(0, 200);
    const user = await userFromRequest(req).catch(() => null);
    try {
      if (kind === "asset") {
        const { data, error } = await supabaseAdmin.from("assets").insert({
          name, make_model: c.category || null, category: c.category ? [String(c.category)] : [],
          notes: c.summary || null, manual_url: c.path || null,
        }).select("id").maybeSingle();
        if (error) return NextResponse.json({ ok: false, error: error.code === "23505" ? "already on file" : error.message }, { status: error.code === "23505" ? 409 : 502 });
        return NextResponse.json({ ok: true, filed: "asset", id: data?.id ?? null });
      }
      if (kind === "inventory") {
        const { data, error } = await supabaseAdmin.from("inventory_items").insert({
          name, qty: typeof c.qty === "number" ? c.qty : null, unit: c.unit || null,
          category: c.category || null, status: "On Hand", notes: c.summary || null,
        }).select("id").maybeSingle();
        if (error) return NextResponse.json({ ok: false, error: error.code === "23505" ? "already on file" : error.message }, { status: error.code === "23505" ? 409 : 502 });
        return NextResponse.json({ ok: true, filed: "inventory", id: data?.id ?? null });
      }
      // document / recipe / photo / other → documents
      const docKind = String(c.doc_kind || (kind === "recipe" ? "recipe" : kind === "photo" ? "photo" : "other")).slice(0, 40);
      const { data, error: docErr } = await supabaseAdmin.from("documents").insert({
        title: name, kind: docKind, summary: c.summary || null,
        storage_path: c.path || null, file_name: c.name || null, mime: c.mime || null,
        tags: Array.isArray(c.tags) ? c.tags.slice(0, 8).map((t: any) => String(t).slice(0, 40)) : [],
        created_by: user?.id ?? null,
      }).select("id").maybeSingle();
      if (docErr) return NextResponse.json({ ok: false, error: docErr.message }, { status: 502 });
      return NextResponse.json({ ok: true, filed: "document", id: data?.id ?? null });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 500 });
    }
  }

  // ── SCAN: read the file and propose ──
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  const path = String(body.path ?? "");
  const name = String(body.name ?? "file").slice(0, 200);
  const mime = String(body.mime ?? "");
  if (!path) return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });

  let b64 = "";
  try {
    const { data, error } = await supabaseAdmin.storage.from("intake").download(path);
    if (error || !data) return NextResponse.json({ ok: false, error: "couldn't read the uploaded file" }, { status: 502 });
    b64 = Buffer.from(await data.arrayBuffer()).toString("base64");
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 502 });
  }

  let out: any = null;
  try {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 900, temperature: 0.2,
      system:
        "You are the intake assistant for GT3 Performance Bar, a mobile beverage truck. Someone dropped a file. Figure out WHAT it is and the single best home for it: an ASSET (gear/equipment the truck owns — a grinder, keg, faucet, cooler), an INVENTORY consumable (stock we use up — coffee beans, bottles, cups, ingredients, CO2/N2), or a DOCUMENT to store (permit, certificate of insurance, contract, receipt/invoice, equipment manual, recipe/spec). Read everything visible — labels, amounts, dates, vendor names. Give a clear name, a one-line summary with the key facts, and the fields for that kind (qty + unit for inventory; category for an asset; doc_kind + tags for a document). Recommend the action in one line. Be decisive but set confidence honestly. Never invent details you can't see. Always answer with the intake_read tool.",
      messages: [{ role: "user", content: [fileBlock(mime, b64, name), { type: "text", text: `Filename: ${name}. Classify it and tell me where it should go.` }] }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "intake_read" },
    });
    out = r.toolUses.find((t) => t.name === "intake_read")?.input ?? null;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Couldn't read that file: ${String(e?.message ?? e).slice(0, 180)}` }, { status: 502 });
  }
  if (!out) return NextResponse.json({ ok: false, error: "no read" }, { status: 502 });

  const proposal = {
    kind: KINDS.includes(out.kind) ? out.kind : "other",
    name: String(out.name || name).slice(0, 200),
    summary: String(out.summary || "").slice(0, 500),
    category: out.category ? String(out.category).slice(0, 60) : "",
    qty: typeof out.qty === "number" ? out.qty : null,
    unit: out.unit ? String(out.unit).slice(0, 24) : "",
    doc_kind: out.doc_kind ? String(out.doc_kind).slice(0, 40) : "",
    tags: Array.isArray(out.tags) ? out.tags.slice(0, 8).map((t: any) => String(t).slice(0, 40)) : [],
    confidence: ["high", "medium", "low"].includes(out.confidence) ? out.confidence : "medium",
    action: String(out.action || "").slice(0, 240),
  };

  // ANTICIPATE: if this looks like gear we already own, pull that asset's KB (manual + maintenance +
  // how-tos + what's due) so the most helpful thing surfaces instead of a blank "file as new".
  let knownAsset: any = null;
  if (proposal.kind === "asset" || proposal.kind === "inventory") {
    const tokens = proposal.name.split(/\s+/).filter((w) => w.length >= 3).slice(0, 3);
    const orClause = tokens.map((t) => `name.ilike.%${t.replace(/[%,()]/g, "")}%`).join(",");
    if (orClause) {
      const { data: hits } = await supabaseAdmin.from("assets").select("id, name, make_model, manual_url, notes").or(orClause).limit(1);
      const a = hits?.[0];
      if (a) {
        const { data: maint } = await supabaseAdmin.from("asset_maintenance").select("kind, summary, how_to, next_due_on, performed_on").eq("asset_id", a.id).order("performed_on", { ascending: false }).limit(8);
        const today = new Date().toISOString().slice(0, 10);
        const due = (maint ?? []).filter((m: any) => m.next_due_on).sort((x: any, y: any) => x.next_due_on.localeCompare(y.next_due_on));
        knownAsset = {
          id: a.id, name: a.name, make_model: a.make_model, manual_url: a.manual_url, notes: a.notes,
          next_due: due[0] ? { summary: due[0].summary, on: due[0].next_due_on, overdue: due[0].next_due_on < today } : null,
          how_tos: (maint ?? []).filter((m: any) => m.how_to).map((m: any) => ({ summary: m.summary, how_to: m.how_to })).slice(0, 4),
        };
      }
    }
  }

  return NextResponse.json({ ok: true, path, name, mime, proposal, knownAsset });
}
