import { MODULES, PRODUCTS } from "./academy";
import { COOKBOOK } from "./academyCookbook";
import type { Cookbook } from "./academy";
import { sourceLine, resolveRecipe, type RecipeSource } from "./recipeEdit";
import { LESSONS } from "./academyLessons";

// BRAND IDENTITY — the house style, stated plainly so the crew AI can answer "what's our font?",
// "what red is that?", "how do we use the logo?" directly. These are the ACTUAL values the app
// renders (app/globals.css @font-face + CSS tokens, components/Gt3Mark.tsx, brand_kit seed 0057).
// Kept here (not only in the DB brand_kit) so the answer never depends on that table being loaded.
function brandFacts(): string {
  return `# BRAND IDENTITY (typography · color · logo — the house style)
Fonts, by role:
- Display / headlines: Archivo Black (headlines ONLY — never body copy).
- Body / UI text: Inter.
- Data, numbers, labels, timers, prices: DM Mono.
- Editorial accents / subheads / sign-offs: Fraunces (italic).
Palette:
- Signal Red #B82420 — the brand red (the "3", primary actions).
- Cream #F5F1E8 — light text/surfaces on dark.
- Charcoal / Ink #15120D — the dark base.
- Gold #A97C3F and Gold Light #C8A661 — accents and eyebrows.
Logo / wordmark:
- "GT" set in the context color (cream on dark, ink on light) + the brand red "3" as the REAL cropped glyph — never a font, never traced.
- Clear space around the mark ≥ the height of the "3"; don't render it below ~120px on a feed tile.
Taglines: "Only the best for you" · "Pure Signal, No Noise."`;
}

// Server-only. Builds a compact, claim-safe knowledge string from the GOVERNED Academy
// Source of Truth (lib/academy.ts) — products + recipes + brand/nutrition/ops modules.
// The operator assistant grounds ONLY on this + live assets/inventory, so every answer
// traces back to written, claim-checked content (no model freelancing on nutrition).
export function academyKnowledge(book: Record<string, Cookbook> = COOKBOOK, sources: Record<string, RecipeSource> = {}): string {
  // Every recipe as read: the batch line and any amount named in a step written out from the amounts (0476).
  book = Object.fromEntries(Object.entries(book).map(([k, v]) => [k, resolveRecipe(v)]));
  const prods = PRODUCTS.map((p) => {
    const cb = book[p.key];
    // `weighs` is carried through so the assistant knows which procedures put something on a scale
    // without having to find the word "weigh" in the prose — the same reason the Cookbook page keys
    // its scale band on the flag rather than on the sentence (see lib/academy.ts).
    // `byVolume` is the other half: every amount is a cup or a spoon, so the scale rules don't apply.
    const weighs = cb?.weighs
      ? " | THIS PROCEDURE WEIGHS INGREDIENTS — give the scale rules from the MEASURING block every time you explain it"
      : cb?.byVolume
        ? " | MEASURED BY VOLUME — every amount is fluid ounces or spoons: a measuring cup and spoons, never a scale. Give no scale rules and no grams for it"
        : "";
    // 0476: which version this is (published in the app, or built-in), the names it's also asked for by, and its exact
    // amounts with what they add up to — the same text the recipe screen shows.
    const ver = `\n  RECIPE VERSION: ${sourceLine(sources[p.key])}${cb?.aliases?.length ? ` | ALSO CALLED: ${cb.aliases.join(", ")}` : ""}`;
    const amts = cb?.amounts?.length ? ` | AMOUNTS (single mix / large batch): ${cb.amounts.map((a) => `${a.item} ${a.single ?? "—"} / ${a.large ?? "—"} ${a.unit}`).join("; ")}${cb.fill ? ` | FILL: ${cb.fill}` : ""}` : "";
    const recipe = cb
      ? `${ver}\n  RECIPE — batch: ${cb.batch ?? "—"}${amts} | brew: ${(cb.brew ?? []).join(" → ") || "—"}${weighs} | serve: ${(cb.serve ?? []).join(" → ") || "—"} | storage: ${cb.storage ?? "—"} | quality: ${cb.quality ?? "—"}${cb.troubleshoot?.length ? ` | troubleshoot: ${cb.troubleshoot.map((t) => `${t.issue} → ${t.fix}`).join("; ")}` : ""}`
      : "";
    const voices = p.voices ? `\n  Voices — Simple: ${p.voices.simple} | GT3: ${p.voices.gt3} | Founders: ${p.voices.founder}` : "";
    return `## ${p.name} (${p.line}${p.price ? `, ${p.price}` : ""})\n  What: ${p.what}\n  Why: ${p.why}\n  Ingredients: ${p.ingredients.join(", ")}\n  Benefits: ${p.benefits.join(", ")}\n  Talking points: ${p.talking.join(" | ")}${voices}\n  FAQs: ${p.faqs.map((f) => `${f.q} — ${f.a}`).join(" | ")}${recipe}`;
  }).join("\n\n");

  const mods = MODULES.map((outline) => {
    const m = { ...outline, ...LESSONS[outline.slug] };   // IP0b: the lesson's content is server-side
    const why = m.whyItMatters ? `\n  WHY IT MATTERS: ${m.whyItMatters}` : "";
    const mist = m.mistakes?.length ? `\n  COMMON MISTAKES: ${m.mistakes.join("; ")}` : "";
    const ins = m.founderInsight ? `\n  FOUNDERS: ${m.founderInsight}` : "";
    const scn = m.scenarios?.length ? `\n  SCENARIOS: ${m.scenarios.map((s) => `${s.situation} → ${s.doThis}`).join(" | ")}` : "";
    return `## ${m.title}  [${m.section}]\n${m.summary}${why}\n${m.body.map((b) => `  • ${b.h}: ${b.p}`).join("\n")}${mist}${scn}${ins}`;
  }).join("\n\n");

  // A recipe published in the app for a drink that isn't on the menu yet ("Create recipe draft" from Ask GT3).
  const known = new Set(PRODUCTS.map((p) => p.key));
  const extra = Object.entries(book).filter(([k]) => !known.has(k)).map(([k, cb]) => {
    const c = cb as Cookbook & { name?: string };
    return `## ${c.name ?? k} (recipe kept in the app)\n  RECIPE VERSION: ${sourceLine(sources[k])}${c.aliases?.length ? ` | ALSO CALLED: ${c.aliases.join(", ")}` : ""}\n  RECIPE — batch: ${c.batch ?? "—"}${c.amounts?.length ? ` | AMOUNTS: ${c.amounts.map((a) => `${a.item} ${a.single ?? "—"} / ${a.large ?? "—"} ${a.unit}`).join("; ")}` : ""} | brew: ${(c.brew ?? []).join(" → ") || "—"}`;
  }).join("\n\n");
  return `${brandFacts()}\n\n# PRODUCTS & RECIPES\n${prods}${extra ? `\n\n${extra}` : ""}\n\n# BRAND, NUTRITION, CX & OPS (Academy modules)\n${mods}`;
}
