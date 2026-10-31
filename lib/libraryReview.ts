// THE REVIEW, EXCEPTIONS FIRST (IMS6 A3). Which draft facts a person decides one at a time, in what order and why, which
// are safe to accept together, and how each is said. The database (0462, std_accept_facts) holds the same line: bulk
// acceptance refuses health and safety fields, inferences and conflicts, whatever the screen sends.
import { inches } from "./experienceLibrary";

export type Fact = { id: string; field: string; value: unknown; unit: string | null; source_class: string; source_kind: string; source_ref: string | null; source_title: string | null; source_locator: string | null; method: string; confidence: string; risk: string; review: string; retrieved_at: string };

const LABEL: Record<string, string> = {
  maker: "Maker", product_ref: "Product number", model: "Model", w_in: "Width", d_in: "Depth", h_in: "Height", composition: "Made of", finishes: "Finishes",
  supplier: "Supplier", supplier_url: "Supplier page", cost_cents: "Price", install_notes: "Installation", maintenance_notes: "Care", image_url: "Image",
  certification: "Certification", emissions: "Emissions", food_contact: "Food contact", care_chemicals: "Cleaning products", claim: "Claim", discontinued: "Discontinued",
};
const CLASS: Record<string, string> = { manufacturer: "the maker's specification", supplier: "a seller's listing", independent: "an independent source", gt3: "GT3's own measurement", ai_inference: "GT3's AI, inferred" };

/** A fact in words: its label, its value (sizes in feet and inches, a price in dollars), and its source. */
export function factWords(f: Fact): { label: string; value: string; source: string } {
  const v = f.value;
  const value = ["w_in", "d_in", "h_in"].includes(f.field) && typeof v === "number" ? inches(v)
    : f.field === "cost_cents" && typeof v === "number" ? `${(v / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}${f.unit ? ` ${f.unit}` : ""}`
    : typeof v === "string" ? v : JSON.stringify(v);
  let host = "";
  try { host = f.source_ref && /^https:\/\//.test(f.source_ref) ? new URL(f.source_ref).hostname.replace(/^www\./, "") : f.source_ref?.startsWith("storage:") ? "the uploaded file" : ""; } catch { host = ""; }
  const where = [f.source_title, host, f.source_locator].filter(Boolean).join(", ");
  return { label: LABEL[f.field] ?? f.field, value, source: `${CLASS[f.source_class] ?? f.source_class}${where ? ` — ${where}` : ""}${f.method === "quoted" ? " (quoted)" : f.method === "extracted" ? " (read from it)" : ""}` };
}

const HEALTH = ["composition", "emissions", "food_contact", "care_chemicals", "certification", "claim"];
/** Why a fact is decided on its own — empty when it's safe to accept with the rest. */
export function whyAlone(f: Fact, conflicts: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (conflicts.has(f.field)) out.push("sources disagree");
  if (f.field === "claim") out.push("a claim, not proven");
  else if (HEALTH.includes(f.field) || f.risk === "high") out.push("health or safety");
  if (f.method === "inferred" || f.source_class === "ai_inference") out.push("inferred, no source says it");
  if (f.source_class === "supplier" && HEALTH.includes(f.field)) out.push("a seller's word");
  if (f.confidence === "low" && !out.length) out.push("low confidence");
  return out;
}
const RANK = (w: string[]) => (w.includes("sources disagree") ? 0 : w.includes("a claim, not proven") ? 1 : w.includes("health or safety") ? 2 : w.includes("inferred, no source says it") ? 3 : w.length ? 4 : 5);
/** Pending facts, the exceptions first (conflicts, claims, health and safety, inferences), then the rest. */
export function reviewOrder(pending: readonly Fact[], conflicts: ReadonlySet<string>): { f: Fact; why: string[] }[] {
  return pending.map((f) => ({ f, why: whyAlone(f, conflicts) })).sort((a, b) => RANK(a.why) - RANK(b.why) || a.f.field.localeCompare(b.f.field));
}
/** What "Accept the safe rest" sends: sourced, low-risk, no disagreement, not low confidence. The database checks again. */
export function safeRest(pending: readonly Fact[], conflicts: ReadonlySet<string>): Fact[] {
  return pending.filter((f) => !whyAlone(f, conflicts).length);
}
/** The card's picture: only an https image a source carried (the maker's or a seller's page), said as theirs. */
export function imageFor(facts: readonly Fact[]): { url: string; from: string } | null {
  const f = facts.filter((x) => x.field === "image_url" && x.review !== "rejected" && x.review !== "superseded" && x.method !== "inferred" && typeof x.value === "string" && /^https:\/\//.test(x.value as string))
    .sort((a, b) => (a.review === "pending" ? 1 : 0) - (b.review === "pending" ? 1 : 0))[0];
  if (!f) return null;
  let from = "its source";
  try { from = new URL((f.source_ref && /^https:/.test(f.source_ref) ? f.source_ref : f.value) as string).hostname.replace(/^www\./, ""); } catch { /* keep "its source" */ }
  return { url: f.value as string, from };
}
