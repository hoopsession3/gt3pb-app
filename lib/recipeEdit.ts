// RECIPE EDITING, THE PURE HALF (0476, 2026-11-20). What a recipe version holds, the yield its amounts add up to, and
// what changed between two versions — the same code for the editor on a phone, the publisher's review, and the tests.
// No I/O here: lib/recipeBook.ts reads and writes; components/RecipeEditor.tsx shows it.
import type { Cookbook } from "./academy";

/** One ingredient line: its amount in the single mix and the large batch, in a unit a cup or spoon measures. */
export type Amount = { item: string; single: number | null; large: number | null; unit: AmountUnit };
export type AmountUnit = "fl oz" | "tbsp" | "tsp" | "cup";
export const UNITS: AmountUnit[] = ["fl oz", "tbsp", "tsp", "cup"];

/** A version's body: the cookbook's own fields, plus the structured amounts and fill the editor keeps exact. */
export type RecipeBody = Cookbook & { amounts?: Amount[]; fill?: string; aliases?: string[]; name?: string; batchNote?: string };

/** Fluid ounces in one of each unit (US): 1 tbsp = ½ fl oz, 1 tsp = ⅙ fl oz, 1 cup = 8 fl oz. */
export const FL_OZ: Record<AmountUnit, number> = { "fl oz": 1, tbsp: 0.5, tsp: 1 / 6, cup: 8 };

/** What the amounts add up to, in fluid ounces, for the single mix and the large batch (null when a column is empty). */
export function yields(amounts: Amount[] | undefined): { single: number | null; large: number | null } {
  const col = (k: "single" | "large") => {
    const xs = (amounts ?? []).filter((a) => a.item.trim() && typeof a[k] === "number" && Number.isFinite(a[k]));
    return xs.length ? round2(xs.reduce((s, a) => s + (a[k] as number) * FL_OZ[a.unit], 0)) : null;
  };
  return { single: col("single"), large: col("large") };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "10.5 fl oz", "127 fl oz", "—". */
export const flOz = (n: number | null) => (n == null ? "—" : `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")} fl oz`);

export type Change = { field: string; before: string; after: string };
const S = (v: unknown) => (v == null ? "" : Array.isArray(v) ? v.join(" · ") : String(v));
const amountLine = (a: Amount) => `${a.single ?? "—"} / ${a.large ?? "—"} ${a.unit}`;

/** What a draft changes against the version it was based on, field by field and line by line. */
export function changes(before: RecipeBody | null, after: RecipeBody): Change[] {
  const out: Change[] = [];
  const b = before ?? ({} as RecipeBody);
  const ba = new Map((b.amounts ?? []).map((a) => [a.item.trim().toLowerCase(), a]));
  const aa = new Map((after.amounts ?? []).map((a) => [a.item.trim().toLowerCase(), a]));
  for (const [k, a] of aa) { const o = ba.get(k); if (!o) out.push({ field: `Amount · ${a.item}`, before: "", after: amountLine(a) }); else if (amountLine(o) !== amountLine(a)) out.push({ field: `Amount · ${a.item}`, before: amountLine(o), after: amountLine(a) }); }
  for (const [k, o] of ba) if (!aa.has(k)) out.push({ field: `Amount · ${o.item}`, before: amountLine(o), after: "" });
  const yb = yields(b.amounts), ya = yields(after.amounts);
  if (yb.single !== ya.single) out.push({ field: "Yield · single mix", before: flOz(yb.single), after: flOz(ya.single) });
  if (yb.large !== ya.large) out.push({ field: "Yield · large batch", before: flOz(yb.large), after: flOz(ya.large) });
  for (const f of ["fill", "batch", "batchNote", "storage", "quality"] as const) if (S(b[f]) !== S(after[f])) out.push({ field: label(f), before: S(b[f]), after: S(after[f]) });
  const bb = b.brew ?? [], ab = after.brew ?? [];
  for (let i = 0; i < Math.max(bb.length, ab.length); i++) if ((bb[i] ?? "") !== (ab[i] ?? "")) out.push({ field: `Method · step ${i + 1}`, before: bb[i] ?? "", after: ab[i] ?? "" });
  if (S(b.aliases) !== S(after.aliases)) out.push({ field: "Also called", before: S(b.aliases), after: S(after.aliases) });
  return out;
}
const label = (f: string) => ({ fill: "Bottle fill", batch: "Batch", batchNote: "Batch note", storage: "Storage", quality: "Quality" } as Record<string, string>)[f] ?? f;

/** A body worth saving: something to make, and every amount a real, non-negative number in a known unit. */
export function problems(body: RecipeBody): string[] {
  const p: string[] = [];
  if (!(body.brew ?? []).some((x) => x.trim()) && !(body.amounts ?? []).some((a) => a.item.trim())) p.push("Add at least one ingredient or one method step.");
  for (const a of body.amounts ?? []) {
    if (!a.item.trim()) continue;
    if (!UNITS.includes(a.unit)) p.push(`${a.item}: pick a unit (fl oz, tbsp, tsp or cup).`);
    for (const k of ["single", "large"] as const) if (a[k] != null && !(Number.isFinite(a[k]) && (a[k] as number) >= 0)) p.push(`${a.item}: the ${k === "single" ? "single mix" : "large batch"} amount isn't a number.`);
  }
  if (JSON.stringify(body).length > 19000) p.push("This recipe is too long to save — shorten the notes.");
  return p;
}

/** Which recipe a question (or answer) is about: its product name, key, or one of its "also called" names. */
export function matchRecipe(text: string, book: Record<string, { name?: string; aliases?: string[] }>, names: Record<string, string> = {}): string | null {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ")} `;
  let best: { key: string; len: number } | null = null;
  for (const [key, cb] of Object.entries(book)) {
    const words = [names[key], cb.name, key.replace(/_/g, " "), ...(cb.aliases ?? [])].filter(Boolean) as string[];
    for (const w of words) {
      const n = w.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").trim();
      if (n.length >= 3 && (t.includes(` ${n} `) || t.includes(` ${n}s `) || t.includes(` ${n.replace(/'s$/, "")} `)) && (!best || n.length > best.len)) best = { key, len: n.length };
    }
  }
  return best?.key ?? null;
}

/** A question about how a drink is made (so a "Create recipe draft" makes sense when no recipe is on file). */
export const isRecipeAsk = (text: string) => /\b(recipe|how (do|to) (i |we )?(make|build|mix|batch)|how much|ratio|batch|syrup|ingredients?|fl ?oz)\b/i.test(text);

/** Where a recipe's text came from: the built-in cookbook, or a published version with its number, date and decider. */
export type RecipeSource = { source: "built-in" } | { source: "published"; id: string; version: number | null; publishedAt: string; publishedBy: string | null };

/** "Published v3 · Nov 20, 2026" or "Built-in recipe" — the line the recipe screen and Ask GT3 both show. */
export function sourceLine(s: RecipeSource | undefined): string {
  if (!s || s.source === "built-in") return "Built-in recipe (not yet edited in the app)";
  const when = new Date(s.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  return `Published v${s.version ?? "?"} · ${when}${s.publishedBy ? ` · by ${s.publishedBy}` : ""}`;
}

/** Things worth a second look before submitting — a written batch line saying one yield while the amounts add up to
 *  another, or a method step that types an amount the table already holds. The single mix and the large batch are
 *  separate formulas, each specified as written: one is never checked as a multiple of the other. */
export function warnings(body: RecipeBody): string[] {
  const w: string[] = [];
  const y = yields(body.amounts);
  const said = [...(body.amounts?.length ? "" : body.batch ?? "").matchAll(/makes\s+([\d.]+)\s*fl\s*oz/gi)].map((m) => Number(m[1]));
  const sums = [y.single, y.large].filter((n): n is number => n != null);
  for (const n of said) if (sums.length && !sums.some((s) => Math.abs(s - n) < 0.01)) w.push(`The batch line says it makes ${n} fl oz, but the amounts add up to ${sums.map((s) => flOz(s)).join(" and ")}.`);
  w.push(...repeatedQuantities(body));
  return w;
}

// ── THE AMOUNTS ARE THE SOURCE (2026-11-20, Ryan: "Make structured ingredient amounts and calculated yields the source for
// any quantities repeated in the method.") A step, the batch note or a troubleshooting fix names the amounts instead of
// retyping them: {{single}} / {{large}} is that formula — each amount, then what it makes — and {{single:Item}} /
// {{large:Item}} is one amount. resolveRecipe writes them out, and the batch line is written from the table too, so an
// edited amount changes the table, the method, the yield and every answer together. Each formula is specified on its
// own: the large batch is not derived from the single mix.

/** One amount as the crew reads it: "7 fl oz"; a small half-ounce measure also in tablespoons, "1.5 fl oz (3 tbsp)". */
export function amountText(n: number | null, unit: AmountUnit): string {
  if (n == null) return "—";
  const v = `${round2(n)} ${unit}`;
  return unit === "fl oz" && n > 0 && n < 2 && Number.isInteger(n * 2) ? `${v} (${n * 2} tbsp)` : v;
}
/** A formula written out: "7 fl oz DUSK cold brew, 2 fl oz A2 goat milk, … — makes 10.5 fl oz". */
export function formulaText(amounts: Amount[] | undefined, col: "single" | "large"): string {
  const rows = (amounts ?? []).filter((a) => a.item.trim() && a[col] != null);
  const y = yields(amounts)[col];
  return `${rows.map((a) => `${amountText(a[col], a.unit)} ${a.item}`).join(", ")}${y != null ? ` — makes ${flOz(y)}` : ""}`;
}
const TOKEN = /\{\{(single|large)(?::([^}]+))?\}\}/g;
/** Write out the {{…}} names in one line of text from the amounts. An item the table doesn't have is left as written. */
export function renderText(text: string, amounts: Amount[] | undefined): string {
  return text.replace(TOKEN, (whole, col: "single" | "large", item?: string) => {
    if (!item) return formulaText(amounts, col);
    const a = (amounts ?? []).find((x) => x.item.trim().toLowerCase() === item.trim().toLowerCase());
    return a ? amountText(a[col], a.unit) : whole;
  });
}
/** Does this line take its quantities from the amounts? */
export const usesAmounts = (text: string) => /\{\{(single|large)(:[^}]+)?\}\}/.test(text);

/** The batch line, written from the amounts: each formula with its yield, then the fill (apart from the yield), then the note. */
export function batchText(body: RecipeBody): string {
  if (!body.amounts?.length) return body.batch ?? "";
  const y = yields(body.amounts);
  const part = (label: string, col: "single" | "large") => {
    const rows = body.amounts!.filter((a) => a.item.trim() && a[col] != null);
    return rows.length ? `${label} — makes ${flOz(y[col])}: ${rows.map((a) => `${amountText(a[col], a.unit)} ${a.item}`).join(", ")}.` : "";
  };
  const fill = body.fill ? `Fill: ${body.fill.replace(/^About/, "about")} — the yield and the fill are separate; count bottles from the fill.` : "";
  return [part("Single mix", "single"), part("Large batch", "large"), fill, body.batchNote ? renderText(body.batchNote, body.amounts) : ""].filter(Boolean).join(" ");
}

/** The recipe as every screen and assistant reads it: the batch line and every {{…}} written out from the amounts. */
export function resolveRecipe<T extends RecipeBody>(body: T): T {
  if (!body.amounts?.length) return body;
  const r = (t: string) => renderText(t, body.amounts);
  return {
    ...body,
    batch: batchText(body),
    brew: body.brew?.map(r),
    serve: body.serve?.map(r),
    storage: body.storage != null ? r(body.storage) : body.storage,
    troubleshoot: body.troubleshoot?.map((t) => ({ issue: r(t.issue), fix: r(t.fix) })),
  };
}

const QTY = /\b\d+(?:\.\d+)?\s*(?:fl\s*oz|tbsp|tsp|cups?)\b/i;
/** A line that types an amount the table already holds — an item from the table and a quantity in the same line, not
 *  written from the amounts. The syrup's own preparation (its own ingredients) doesn't name a table item, so it passes. */
export function repeatedQuantities(body: RecipeBody): string[] {
  const items = (body.amounts ?? []).map((a) => a.item.trim().toLowerCase()).filter(Boolean);
  if (!items.length) return [];
  const lines: [string, string][] = [
    ...(body.brew ?? []).map((t, i) => [`Method step ${i + 1}`, t] as [string, string]),
    ...(body.troubleshoot ?? []).map((t) => [`Troubleshooting (${t.issue})`, t.fix] as [string, string]),
    ...(body.batchNote ? [["Batch note", body.batchNote] as [string, string]] : []),
  ];
  return lines.filter(([, t]) => !usesAmounts(t) && QTY.test(t) && items.some((it) => t.toLowerCase().includes(it)))
    .map(([where]) => `${where} types an amount the table holds — use “Fill from amounts” so it follows the table.`);
}
/** How a cookbook entry stands: are its quantities structured, and does any line repeat one by hand? (The rollout check.) */
export function quantityReport(body: RecipeBody): { structured: boolean; repeated: number; typedQuantities: number } {
  const lines = [body.batch ?? "", ...(body.brew ?? []), ...(body.troubleshoot ?? []).map((t) => t.fix)];
  return { structured: !!body.amounts?.length, repeated: repeatedQuantities(body).length, typedQuantities: lines.filter((t) => !usesAmounts(t) && QTY.test(t)).length };
}

/** Who publishes recipes (0476's is_admin): an owner or an admin. Only words the buttons — the database decides. */
export const canPublishRecipes = (p: { role?: string | null } | null | undefined) => p?.role === "owner" || p?.role === "admin";

// ── THE ANSWER FIRST (2026-11-21, Ryan: "For 'How much goat milk goes in the Salted Maple Latte?', lead with '2 fl oz for
// one mix, or 24 fl oz for the large batch.'"). A question about one ingredient's amount is answered from the recipe's
// own table — the published version, or the built-in one before the first publish — word for word, not by the model;
// the method stays behind View recipe.
const AMOUNT_ASK = /\b(how much|how many|what amount|amount of|quantity of|how much of)\b/i;
/** The names an amount line is asked for by: its full name, and without a leading brand or grade ("A2 goat milk" → "goat milk"). */
const askedAs = (item: string) => {
  const w = item.trim().toLowerCase().split(/\s+/);
  return [...new Set([w.join(" "), w.length > 2 ? w.slice(1).join(" ") : "", w.length > 2 ? w.slice(-2).join(" ") : ""].filter((x) => x.length >= 4))];
};
/** "2 fl oz for one mix, or 24 fl oz for the large batch." — or null when the question isn't one ingredient's amount. */
export function ingredientAnswer(question: string, body: RecipeBody | null | undefined): { item: string; lead: string } | null {
  if (!body?.amounts?.length || !AMOUNT_ASK.test(question)) return null;
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `;
  let best: { a: Amount; len: number } | null = null;
  for (const a of body.amounts) for (const n of askedAs(a.item)) if (q.includes(` ${n} `) && (!best || n.length > best.len)) best = { a, len: n.length };
  if (!best) return null;
  const { a } = best;
  const parts = [a.single != null ? `${amountText(a.single, a.unit)} for one mix` : "", a.large != null ? `${amountText(a.large, a.unit)} for the large batch` : ""].filter(Boolean);
  return parts.length ? { item: a.item, lead: `${parts.join(", or ")}.` } : null;
}

/** The line the main screens show: "Current recipe" — version and publication details live in the recipe's History. */
export const CURRENT = "Current recipe";
