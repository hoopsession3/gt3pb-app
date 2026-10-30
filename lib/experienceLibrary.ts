// THE EXPERIENCE LIBRARY (IMS5b, 0461) — everything GT3 might place in a location, as one list: the Standard's material
// registry (std_materials), not a second catalog. The words, the order and the rules the screen shows; the database
// holds the same rules (an asset can't be qualified or approved while its judgement is incomplete — unknown is never
// approved — and approving is an owner's).
import type { Pillar } from "./vision";

export const STATUSES = ["candidate", "under_research", "evidence_incomplete", "qualified", "approved", "restricted", "rejected"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_WORD: Record<Status, string> = {
  candidate: "Candidate", under_research: "Under research", evidence_incomplete: "Evidence incomplete",
  qualified: "Qualified", approved: "Approved", restricted: "Restricted", rejected: "Rejected",
};
/** What each status means, in a line — said beside it, so no status is read as more than it is. */
export const STATUS_MEANS: Record<Status, string> = {
  candidate: "Proposed for GT3. Nothing about it is judged yet.",
  under_research: "Being looked into: evidence is being gathered.",
  evidence_incomplete: "Looked into, but the evidence isn't enough to judge it.",
  qualified: "Judged under the Standard with nothing failing, unknown or stale. Not yet approved.",
  approved: "Approved by an owner for GT3 locations, on a complete judgement.",
  restricted: "Allowed only where its reason says.",
  rejected: "Not for GT3, with the reason.",
};
/** Statuses that need the Standard's judgement complete (the database's std_material_blockers is empty). */
export const NEEDS_JUDGEMENT: readonly Status[] = ["qualified", "approved"];
/** Statuses an owner sets (and an approval only an owner takes back). */
export const OWNERS_WORD: readonly Status[] = ["approved"];
export const NEEDS_REASON: readonly Status[] = ["restricted", "rejected"];

export const CATEGORIES = [
  ["seating", "Seating"], ["furniture", "Furniture"], ["counter", "Counters"], ["equipment", "Equipment"], ["fixture", "Fixtures"],
  ["flooring", "Flooring"], ["wall", "Wall finishes"], ["surface", "Surfaces"], ["finish", "Finishes"], ["paint", "Paint"],
  ["adhesive", "Adhesives"], ["coating", "Coatings"], ["textile", "Textiles"], ["plant", "Plants & biophilic"],
  ["lighting", "Lighting"], ["acoustic", "Acoustic treatment"], ["air", "Air systems"], ["water", "Water systems"],
  ["signage", "GT3 signage & logos"], ["artwork", "Artwork & installations"], ["menu_board", "Menu boards"],
  ["merchandising", "Merchandising"], ["food_contact", "Food-contact surfaces"], ["serviceware", "Serviceware"],
  ["cleaning", "Cleaning & maintenance"], ["packaging", "Packaging"], ["ingredient", "Ingredients"], ["other", "Other"],
] as const;
export type Category = (typeof CATEGORIES)[number][0];
export const CATEGORY_WORD = Object.fromEntries(CATEGORIES) as Record<Category, string>;

export type CostBasis = "actual" | "estimated" | "scenario";
export type Asset = {
  id: string; name: string; category: Category; status: Status; status_reason: string | null; status_at: string | null;
  maker: string | null; product_ref: string | null; composition: string | null; watch_list: string[]; notes: string | null;
  studio_kind: string | null; w_in: number | null; d_in: number | null; h_in: number | null; finishes: string | null;
  supplier: string | null; supplier_url: string | null;
  cost_cents: number | null; cost_unit: string | null; cost_basis: CostBasis | null; cost_source: string | null; cost_as_of: string | null;
  install_notes: string | null; maintenance_notes: string | null; pillars: Pillar[]; image_url: string | null; archived_at: string | null;
};
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null || v === "" ? null : String(v));
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const PILLARS: readonly Pillar[] = ["movement", "stillness", "light", "fuel"];
export const toAsset = (r: Row): Asset => ({
  id: String(r.id), name: String(r.name ?? ""), category: (CATEGORIES.some(([k]) => k === r.category) ? r.category : "other") as Category,
  status: (STATUSES as readonly string[]).includes(String(r.status)) ? (r.status as Status) : "candidate",
  status_reason: s(r.status_reason), status_at: s(r.status_at), maker: s(r.maker), product_ref: s(r.product_ref), composition: s(r.composition),
  watch_list: Array.isArray(r.watch_list) ? r.watch_list.map(String) : [], notes: s(r.notes), studio_kind: s(r.studio_kind),
  w_in: num(r.w_in), d_in: num(r.d_in), h_in: num(r.h_in), finishes: s(r.finishes), supplier: s(r.supplier), supplier_url: s(r.supplier_url),
  cost_cents: num(r.cost_cents), cost_unit: s(r.cost_unit), cost_basis: (["actual", "estimated", "scenario"].includes(String(r.cost_basis)) ? r.cost_basis : null) as CostBasis | null,
  cost_source: s(r.cost_source), cost_as_of: s(r.cost_as_of), install_notes: s(r.install_notes), maintenance_notes: s(r.maintenance_notes),
  pillars: Array.isArray(r.pillars) ? (r.pillars.filter((p) => PILLARS.includes(p as Pillar)) as Pillar[]) : [],
  image_url: s(r.image_url), archived_at: s(r.archived_at),
});

/** A cost, always with its basis: "$120 each · estimated". Unknown is said, never zero. */
export function costWords(a: Pick<Asset, "cost_cents" | "cost_unit" | "cost_basis">): string {
  if (a.cost_cents == null) return "Cost not known";
  const d = a.cost_cents / 100;
  const money = d.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: d % 1 ? 2 : 0 });
  return `${money}${a.cost_unit ? ` ${a.cost_unit}` : ""} · ${a.cost_basis ?? "basis not said"}`;
}

export const inches = (v: number | null) => (v == null ? "—" : v % 12 === 0 ? `${v / 12}′` : v >= 12 ? `${Math.floor(v / 12)}′ ${Math.round(v % 12)}″` : `${Math.round(v)}″`);
export const sizeWords = (a: Pick<Asset, "w_in" | "d_in" | "h_in">) => (a.w_in == null && a.d_in == null && a.h_in == null ? "Size not said" : `${inches(a.w_in)} × ${inches(a.d_in)} × ${inches(a.h_in)}`);

/** The list's order: what can be used first, what can't last. */
export const LIST_ORDER: readonly Status[] = ["approved", "qualified", "evidence_incomplete", "under_research", "candidate", "restricted", "rejected"];
export type Filter = { text?: string; category?: Category | ""; status?: Status | ""; pillar?: Pillar | ""; kind?: string | "" };
/** The list, as asked for: words match the name, maker, supplier, product and finishes; archived assets are left out. */
export function filterAssets(list: readonly Asset[], f: Filter): Asset[] {
  const t = (f.text ?? "").trim().toLowerCase();
  return list.filter((a) => !a.archived_at
    && (!t || [a.name, a.maker, a.supplier, a.product_ref, a.finishes, CATEGORY_WORD[a.category]].some((x) => x?.toLowerCase().includes(t)))
    && (!f.category || a.category === f.category) && (!f.status || a.status === f.status)
    && (!f.pillar || a.pillars.includes(f.pillar)) && (!f.kind || a.studio_kind === f.kind))
    .sort((x, y) => LIST_ORDER.indexOf(x.status) - LIST_ORDER.indexOf(y.status) || x.name.localeCompare(y.name));
}

/** Side by side: the same rows for each asset, an unknown said as unknown. */
export function compareRows(list: readonly Asset[]): { label: string; values: string[] }[] {
  const row = (label: string, f: (a: Asset) => string) => ({ label, values: list.map(f) });
  return [
    row("Status", (a) => STATUS_WORD[a.status]),
    row("Category", (a) => CATEGORY_WORD[a.category]),
    row("Size (w × d × h)", sizeWords),
    row("Cost", costWords),
    row("Maker / product", (a) => [a.maker, a.product_ref].filter(Boolean).join(" · ") || "Not said"),
    row("Supplier", (a) => a.supplier ?? "Not said"),
    row("Made of", (a) => a.composition ?? "Not said"),
    row("Finishes", (a) => a.finishes ?? "Not said"),
    row("Watch-list substances declared", (a) => (a.watch_list.length ? a.watch_list.join(", ") : "None declared")),
    row("Meant to serve (intent)", (a) => (a.pillars.length ? a.pillars.join(", ") : "Not said")),
    row("Installed", (a) => a.install_notes ?? "Not said"),
    row("Kept", (a) => a.maintenance_notes ?? "Not said"),
  ];
}

/** The steps the screen offers from a status. Qualified and approved also need the judgement complete and approved an
 *  owner — the database refuses either way; the screen says so first. */
export function nextSteps(a: Pick<Asset, "status">, opts: { isOwner: boolean; blockers: readonly string[] }): { to: Status; ready: boolean; why?: string }[] {
  const all: Status[] = ["candidate", "under_research", "evidence_incomplete", "qualified", "approved", "restricted", "rejected"];
  return all.filter((to) => to !== a.status && !(a.status === "approved" && !opts.isOwner)).map((to) => {
    if (OWNERS_WORD.includes(to) && !opts.isOwner) return { to, ready: false, why: "An owner approves." };
    if (NEEDS_JUDGEMENT.includes(to) && opts.blockers.length) return { to, ready: false, why: opts.blockers[0] };
    return { to, ready: true };
  });
}

/** A spec is ready to approve when it lists something and every asset on it is approved. */
export function specReady(items: readonly { status: Status }[]): { ready: boolean; why: string | null } {
  if (!items.length) return { ready: false, why: "Nothing on it yet." };
  const not = items.filter((i) => i.status !== "approved").length;
  return not ? { ready: false, why: `${not} asset${not === 1 ? " isn't" : "s aren't"} approved yet.` } : { ready: true, why: null };
}
