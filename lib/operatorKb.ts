import { MODULES, PRODUCTS } from "./academy";

// BRAND IDENTITY — the house style, stated plainly so the crew AI can answer "what's our font?",
// "what red is that?", "how do we use the logo?" directly. These are the ACTUAL values the app
// renders (app/globals.css @font-face + CSS tokens, components/Gt3Mark.tsx, brand_kit seed 0057).
// Kept here (not only in the DB brand_kit) so the answer never depends on that table being loaded.
export function brandFacts(): string {
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
export function academyKnowledge(): string {
  const prods = PRODUCTS.map((p) => {
    const cb = p.cookbook;
    const recipe = cb
      ? `\n  RECIPE — batch: ${cb.batch ?? "—"} | brew: ${(cb.brew ?? []).join(" → ") || "—"} | serve: ${(cb.serve ?? []).join(" → ") || "—"} | storage: ${cb.storage ?? "—"} | quality: ${cb.quality ?? "—"}${cb.troubleshoot?.length ? ` | troubleshoot: ${cb.troubleshoot.map((t) => `${t.issue} → ${t.fix}`).join("; ")}` : ""}`
      : "";
    const voices = p.voices ? `\n  Voices — Simple: ${p.voices.simple} | GT3: ${p.voices.gt3} | Founder: ${p.voices.founder}` : "";
    return `## ${p.name} (${p.line}${p.price ? `, ${p.price}` : ""})\n  What: ${p.what}\n  Why: ${p.why}\n  Ingredients: ${p.ingredients.join(", ")}\n  Benefits: ${p.benefits.join(", ")}\n  Talking points: ${p.talking.join(" | ")}${voices}\n  FAQs: ${p.faqs.map((f) => `${f.q} — ${f.a}`).join(" | ")}${recipe}`;
  }).join("\n\n");

  const mods = MODULES.map((m) => {
    const why = m.whyItMatters ? `\n  WHY IT MATTERS: ${m.whyItMatters}` : "";
    const mist = m.mistakes?.length ? `\n  COMMON MISTAKES: ${m.mistakes.join("; ")}` : "";
    const ins = m.founderInsight ? `\n  FOUNDER: ${m.founderInsight}` : "";
    const scn = m.scenarios?.length ? `\n  SCENARIOS: ${m.scenarios.map((s) => `${s.situation} → ${s.doThis}`).join(" | ")}` : "";
    return `## ${m.title}  [${m.section}]\n${m.summary}${why}\n${m.body.map((b) => `  • ${b.h}: ${b.p}`).join("\n")}${mist}${scn}${ins}`;
  }).join("\n\n");

  return `${brandFacts()}\n\n# PRODUCTS & RECIPES\n${prods}\n\n# BRAND, NUTRITION, CX & OPS (Academy modules)\n${mods}`;
}
