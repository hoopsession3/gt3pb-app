// LIBRARY INTAKE (IMS6 A2) — the rules the research route runs on, apart from any network: how deep to look, what a
// run may spend, whether an asset already exists, and which found values may be written as draft facts. The database
// (0462) holds the same lines: a fact arrives pending, nothing here accepts or approves anything.
import { PRICING, SEARCH_CENTS, type Rate } from "./aiPricing";
import type { Category } from "./experienceLibrary";

// ── depth, by risk ──────────────────────────────────────────────────────────────────────────────────────────────────
export type Depth = "light" | "standard" | "deep";
/** Where people breathe, touch or eat from it: look hardest. */
export const EXPOSURE: readonly Category[] = ["paint", "adhesive", "coating", "flooring", "textile", "food_contact", "serviceware", "cleaning", "air", "water", "wall", "surface", "finish"];
export const LIGHT: readonly Category[] = ["signage", "artwork", "menu_board", "merchandising"];
export function depthFor(category: Category | null, mandatoryUnmet: number): Depth {
  if (category && EXPOSURE.includes(category)) return "deep";
  const base: Depth = category && LIGHT.includes(category) ? "light" : "standard";
  // Missing required evidence raises the effort one step.
  return mandatoryUnmet > 0 ? (base === "light" ? "standard" : "deep") : base;
}

// ── what a run may spend ────────────────────────────────────────────────────────────────────────────────────────────
// The reservation (0462) is GT3's ceiling, not the provider's: a run is planned so that everything the API lets us cap
// fits inside it, and what the API doesn't cap (the text a search returns) is given an allowance, measured in A4. A
// complete usage report is charged as it was — an overrun is reported, never hidden — and the provider-side guarantee
// is the Anthropic console's workspace spend limit (the owner's setting), not this code.
export { SEARCH_CENTS };
export const SEARCH_RESULT_TOKENS_ALLOWANCE = 3000; // per search: not capped by the API — an allowance until A4 measures it
export const PROMPT_TOKENS = 3500;                // system + instructions + the ask (measured in tests from the prompt itself)
export const PDF_PAGE_TOKENS = 3000;              // per page of an uploaded PDF (text and the page image): an allowance until A4 measures it
export const IMAGE_TOKENS = 1600;                 // one uploaded photo, at the size the route sends it
export type Plan = { depth: Depth; model: string; searches: number; fetches: number; fetchTokens: number; maxOutput: number; pdfPages: number; images: number; worstCents: number };
export type Budget = { per_run_cents: number; per_run_searches: number; per_run_fetches: number; per_run_tokens: number };
const DEPTH_SHAPE: Record<Depth, { searches: number; fetches: number; fetchTokens: number; maxOutput: number; pdfPages: number }> = {
  light: { searches: 2, fetches: 1, fetchTokens: 8000, maxOutput: 2000, pdfPages: 10 },
  standard: { searches: 3, fetches: 2, fetchTokens: 10000, maxOutput: 3000, pdfPages: 20 },
  deep: { searches: 5, fetches: 3, fetchTokens: 12000, maxOutput: 4000, pdfPages: 30 },
};
/** Worst case of a plan, in cents: every search used, every fetch at its cap, the output at its cap. */
export function worstCents(p: Omit<Plan, "worstCents" | "depth">, rate: Rate = PRICING[p.model]): number {
  const input = inputTokens(p);
  return (input * rate.in + p.maxOutput * rate.out) / 1_000_000 * 100 + p.searches * SEARCH_CENTS;
}
const inputTokens = (p: Omit<Plan, "worstCents" | "depth">) => PROMPT_TOKENS + p.searches * SEARCH_RESULT_TOKENS_ALLOWANCE + p.fetches * p.fetchTokens + p.pdfPages * PDF_PAGE_TOKENS + p.images * IMAGE_TOKENS;
/** The plan for a depth, shrunk until its worst case fits the per-run ceiling (searches first, then fetch size, then
 *  fetches). Never larger than the budget's own caps. Null if nothing useful fits. */
export function planFor(depth: Depth, b: Budget, model: string, input: { pdf?: boolean; image?: boolean } = {}): Plan | null {
  const s = DEPTH_SHAPE[depth];
  const p = { model, searches: Math.min(s.searches, b.per_run_searches), fetches: Math.min(s.fetches, b.per_run_fetches), fetchTokens: s.fetchTokens, maxOutput: s.maxOutput, pdfPages: input.pdf ? s.pdfPages : 0, images: input.image ? 1 : 0 };
  const tokens = () => inputTokens(p) + p.maxOutput;
  // Shrunk in this order: a document's pages past the first few, searches, fetch size, fetches, output.
  for (let k = 0; k < 80 && (worstCents(p) > b.per_run_cents || tokens() > b.per_run_tokens); k++) {
    if (p.pdfPages > 8) p.pdfPages -= 2; else if (p.searches > 1) p.searches--; else if (p.fetchTokens > 4000) p.fetchTokens -= 2000; else if (p.fetches > 0) p.fetches--; else if (p.maxOutput > 1500) p.maxOutput -= 500; else if (p.pdfPages > 1) p.pdfPages--; else return null;
  }
  if (worstCents(p) > b.per_run_cents || tokens() > b.per_run_tokens) return null;
  return { depth, ...p, worstCents: Math.round(worstCents(p) * 100) / 100 };
}

// ── does it already exist ───────────────────────────────────────────────────────────────────────────────────────────
/** A URL as a product's address: no scheme, no www, no tracking, no fragment, no trailing slash, lower-case host. */
export function normUrl(u: string): string | null {
  try {
    const x = new URL(u);
    if (x.protocol !== "https:") return null;
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|gclid|fbclid|ref$|mc_)/i.test(k)) x.searchParams.delete(k);
    const q = x.searchParams.toString();
    return `${x.hostname.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "") || "/"}${q ? `?${q}` : ""}`.slice(0, 1000);
  } catch { return null; }
}
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
export type Known = { id: string; name: string; maker: string | null; product_ref: string | null; source_url_norm: string | null; w_in: number | null; d_in: number | null; h_in: number | null; finishes: string | null; composition: string | null };
export type Found = { name?: string | null; maker?: string | null; product_ref?: string | null; url?: string | null; w_in?: number | null; d_in?: number | null; h_in?: number | null; finishes?: string | null; composition?: string | null };
export type Match = { id: string; kind: "same" | "variant" | "similar"; why: string };
/** Before anything is made: the same page, the same maker and product, or the same family in another finish or
 *  formulation (a variant: its own record, inheriting nothing). A similar name and size is offered, never assumed. */
export function matchAsset(f: Found, known: readonly Known[]): Match[] {
  const out: Match[] = [];
  const url = f.url ? normUrl(f.url) : null;
  const near = (a?: number | null, b?: number | null) => a == null || b == null || Math.abs(a - b) <= Math.max(1, 0.03 * Math.max(a, b));
  for (const k of known) {
    const sameRef = !!f.maker && !!f.product_ref && norm(f.maker) === norm(k.maker) && norm(f.product_ref) === norm(k.product_ref);
    const differs = (!!f.finishes && !!k.finishes && norm(f.finishes) !== norm(k.finishes)) || (!!f.composition && !!k.composition && norm(f.composition) !== norm(k.composition));
    if ((url && url === k.source_url_norm) || sameRef) out.push({ id: k.id, kind: differs ? "variant" : "same", why: url && url === k.source_url_norm ? "Read from the same product page" : "Same maker and product number" + (differs ? ", another finish or formulation" : "") });
    else if (norm(f.name) && norm(f.name) === norm(k.name) && near(f.w_in, k.w_in) && near(f.d_in, k.d_in) && near(f.h_in, k.h_in)) out.push({ id: k.id, kind: "similar", why: "Same name and size — check it isn't the same product" });
  }
  return out.sort((a, b) => ["same", "variant", "similar"].indexOf(a.kind) - ["same", "variant", "similar"].indexOf(b.kind));
}

// ── what research found → draft facts ───────────────────────────────────────────────────────────────────────────────
export const FIELDS = ["maker", "product_ref", "model", "w_in", "d_in", "h_in", "composition", "finishes", "supplier", "supplier_url", "cost_cents", "install_notes", "maintenance_notes", "image_url", "certification", "emissions", "food_contact", "care_chemicals", "claim", "discontinued"] as const;
export type Field = (typeof FIELDS)[number];
export const HEALTH: readonly Field[] = ["composition", "emissions", "food_contact", "care_chemicals", "certification", "claim"];
export type SourceClass = "manufacturer" | "supplier" | "independent" | "gt3" | "ai_inference";
export type RawFact = { field: string; value: unknown; unit?: string | null; source_class?: string; source_kind?: string; source_ref?: string | null; source_title?: string | null; source_locator?: string | null; source_revision?: string | null; method?: string; confidence?: string; quote?: string | null };
export type DraftFact = { field: Field; value: unknown; unit: string | null; source_class: SourceClass; source_kind: "url" | "document" | "image" | "description" | "manual"; source_ref: string | null; source_title: string | null; source_locator: string | null; source_revision: string | null; method: "quoted" | "extracted" | "inferred"; confidence: "low" | "medium" | "high"; risk: "low" | "high" };
export type Dropped = { field: string; why: string };
const CLASSES: readonly SourceClass[] = ["manufacturer", "supplier", "independent", "gt3", "ai_inference"];
/** What the model said, reduced to what may be written: a known field, a value of the right shape, a source for anything
 *  not inferred, an inference labelled as one. Anything else is dropped, with why — never repaired by guessing. */
export function toDraftFacts(raw: readonly RawFact[], ctx: { kind: DraftFact["source_kind"]; ref: string | null }): { facts: DraftFact[]; dropped: Dropped[] } {
  const facts: DraftFact[] = [], dropped: Dropped[] = [];
  for (const r of raw) {
    const field = r.field as Field;
    if (!FIELDS.includes(field)) { dropped.push({ field: String(r.field), why: "not a library field" }); continue; }
    const method = (["quoted", "extracted", "inferred"].includes(String(r.method)) ? r.method : null) as DraftFact["method"] | null;
    if (!method) { dropped.push({ field, why: "no method said" }); continue; }
    let cls = (CLASSES.includes(r.source_class as SourceClass) ? r.source_class : null) as SourceClass | null;
    if (method === "inferred") cls = "ai_inference";
    if (!cls || (cls === "ai_inference" && method !== "inferred")) { dropped.push({ field, why: "source class unclear" }); continue; }
    const ref = (r.source_ref ?? ctx.ref ?? "").trim() || null;
    if (method !== "inferred" && !ref) { dropped.push({ field, why: "no source to point to" }); continue; }
    if (ref && /^http/i.test(ref) && !/^https:\/\//.test(ref)) { dropped.push({ field, why: "source isn't https" }); continue; }
    let value = r.value;
    if (["w_in", "d_in", "h_in", "cost_cents"].includes(field)) {
      const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(n) || n <= 0 || (field !== "cost_cents" && n > 2400)) { dropped.push({ field, why: "not a usable number" }); continue; }
      value = field === "cost_cents" ? Math.round(n) : Math.round(n * 100) / 100;
    } else if (field === "image_url" || field === "supplier_url") {
      if (typeof value !== "string" || !/^https:\/\//.test(value)) { dropped.push({ field, why: "not an https link" }); continue; }
    } else if (typeof value !== "string" || !value.trim()) { dropped.push({ field, why: "empty" }); continue; }
    else value = value.trim().slice(0, field === "claim" ? 600 : 1000);
    // A health or safety statement from a seller is a claim to verify, not a specification.
    const f: Field = cls === "supplier" && HEALTH.includes(field) && field !== "composition" ? "claim" : field;
    facts.push({ field: f, value, unit: r.unit ?? null, source_class: cls, source_kind: method === "inferred" ? (ctx.kind) : ((r.source_kind as DraftFact["source_kind"]) ?? ctx.kind), source_ref: method === "inferred" ? null : ref,
      source_title: r.source_title?.slice(0, 300) ?? null, source_locator: r.source_locator?.slice(0, 200) ?? null, source_revision: r.source_revision?.slice(0, 120) ?? null,
      method, confidence: (["low", "medium", "high"].includes(String(r.confidence)) ? r.confidence : "low") as DraftFact["confidence"], risk: HEALTH.includes(f) ? "high" : "low" });
  }
  return { facts, dropped };
}

/** What's still missing for the card: the fields nobody found, and the Standard's mandatory criteria for this category
 *  with no evidence yet. */
export function missingFor(facts: readonly { field: string }[], criteria: readonly { code: string; title: string; mandatory: boolean; categories: string[] }[], category: Category | null): { fields: Field[]; evidence: string[] } {
  const have = new Set(facts.map((f) => f.field));
  const core: Field[] = ["maker", "product_ref", "w_in", "d_in", "h_in", "composition", "finishes", "supplier", "cost_cents", "image_url"];
  return { fields: core.filter((f) => !have.has(f)), evidence: criteria.filter((c) => c.mandatory && (!c.categories.length || (category && c.categories.includes(category)))).map((c) => `${c.code} ${c.title}`) };
}
