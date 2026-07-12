import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
// INVENTORY AI — describe an item (or paste a packing label) and it drafts a COMPLETE inventory record:
// every attribute filled or sensibly inferred — name, qty, unit, category, reorder point, status, the
// event use-cases, which event types need it, whether it's event-critical, a reorder link, and notes
// (specs / what to confirm / safety). Grounded in GT3's existing taxonomy so new items slot in cleanly.
// Staff-gated. Two paths on one route: PROPOSE (draft from a description) and COMMIT (save a reviewed
// record). Nothing is written until the user reviews + commits.

const TENANT = "00000000-0000-0000-0000-000000000001";
const EVENT_TYPES = ["Market", "Private event", "Pop-up", "Corporate", "Festival", "Wedding"];

const SAVE: ToolDef = {
  name: "save_item",
  description: "A complete GT3 inventory record for the described item — fill EVERY field, inferring sensible values.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Clear inventory name: brand + what it is + size, e.g. '16oz PET bottles (clear)'." },
      qty: { type: "number", description: "Quantity on hand now. Use the count/amount in the description; if unknown, your best estimate." },
      unit: { type: "string", description: "Unit of the qty: each | case | pack | box | roll | bag | set | lb | oz | gallon ..." },
      category: { type: "string", description: "Inventory category — match the house taxonomy below where it fits, else a sensible new one." },
      reorder_point: { type: "number", description: "Reorder when on-hand drops to this. Infer from how heavily a mobile bev bar uses it per event." },
      status: { type: "string", enum: ["On Hand", "In Transit", "Backorder", "Low", "Out"], description: "Current status." },
      use_cases: { type: "array", items: { type: "string" }, description: "Concrete ways GT3 uses this at events." },
      required_for: { type: "array", items: { type: "string" }, description: `Which event types need it. Choose from: ${EVENT_TYPES.join(", ")}.` },
      critical: { type: "boolean", description: "True if you genuinely can't serve without it (cups, lids, the drink, ice, sanitizer)." },
      reorder_link: { type: "string", description: "Where to rebuy — a URL if it's known or clearly derivable from the description, else empty." },
      notes: { type: "string", description: "Specs, supplier, storage/handling, any SAFETY note, and clearly mark what you INFERRED vs. should be confirmed." },
    },
    required: ["name", "qty", "unit", "category", "status", "use_cases", "required_for", "critical", "notes"],
  },
};

type ItemOut = { name: string; qty: number; unit: string; category: string; reorder_point?: number; status: string; use_cases: string[]; required_for: string[]; critical: boolean; reorder_link?: string; notes: string };

// Normalize the model output (or a reviewed payload) into a clean inventory_items row.
function norm(o: any) {
  const num = (v: any) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const arr = (v: any) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 12) : []);
  return {
    name: String(o.name ?? "").trim().slice(0, 200),
    qty: num(o.qty),
    unit: o.unit ? String(o.unit).trim().slice(0, 40) : null,
    category: o.category ? String(o.category).trim().slice(0, 80) : null,
    reorder_point: num(o.reorder_point),
    status: o.status ? String(o.status).trim().slice(0, 30) : "On Hand",
    use_cases: arr(o.use_cases).map((x) => x.slice(0, 140)),
    required_for: arr(o.required_for).map((x) => x.slice(0, 60)),
    critical: !!o.critical,
    reorder_link: o.reorder_link ? String(o.reorder_link).trim().slice(0, 500) : null,
    notes: o.notes ? String(o.notes).trim().slice(0, 2500) : null,
  };
}

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  // COMMIT — save a reviewed record to inventory.
  if (body.commit && body.item?.name?.trim()) {
    const row = norm(body.item);
    if (!row.name) return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
    const { data, error } = await supabaseAdmin.from("inventory_items")
      .insert({ ...row, tenant_id: TENANT }).select("id, name").single();
    if (error || !data) return NextResponse.json({ ok: false, error: (error?.message ?? "could not save").slice(0, 300) }, { status: 502 });
    return NextResponse.json({ ok: true, saved: data });
  }

  // PROPOSE — draft a complete record from a free-text description.
  const description = String(body.description ?? "").trim().slice(0, 2000);
  if (!description) return NextResponse.json({ ok: false, error: "describe the item" }, { status: 400 });

  // Ground in what's already stocked so categories + units match the house taxonomy.
  const { data: existing } = await supabaseAdmin.from("inventory_items").select("name, category, unit").limit(80);
  const known = (existing ?? []).map((r: any) => `- ${r.name}${r.category ? ` [${r.category}]` : ""}${r.unit ? ` (${r.unit})` : ""}`).join("\n");

  try {
    const r = await callClaude({ label: "inventory",
      model: MODELS.sonnet, maxTokens: 1200,
      system: `You catalog inventory for GT3 Performance Bar — a mobile beverage bar (cold-brew coffee, bottled drinks, bone broth, hydration) that works markets and private events out of an enclosed trailer. Turn the user's description of an item into ONE complete inventory record: fill EVERY field, inferring sensible values from how a mobile bev bar would actually use it. Reuse the existing house categories + units below wherever the item fits; only invent a new category when nothing matches. Be specific. In notes, separate what you INFERRED from what should be confirmed, and include any storage/handling or safety point. Always answer with save_item.\n\nAlready in inventory (for taxonomy):\n${known || "(empty — you're setting the taxonomy)"}`,
      messages: [{ role: "user", content: `Catalog this item:\n${description}` }],
      tools: [SAVE], tool_choice: { type: "tool", name: "save_item" },
    });
    const out: ItemOut | null = r.toolUses.find((t) => t.name === "save_item")?.input ?? null;
    if (!out) return NextResponse.json({ ok: false, error: "no draft from the model" }, { status: 502 });
    return NextResponse.json({ ok: true, item: norm(out) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}
