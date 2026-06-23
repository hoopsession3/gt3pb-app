import { MODULES, PRODUCTS } from "./academy";

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
    return `## ${p.name} (${p.line}${p.price ? `, ${p.price}` : ""})\n  What: ${p.what}\n  Why: ${p.why}\n  Ingredients: ${p.ingredients.join(", ")}\n  Benefits: ${p.benefits.join(", ")}\n  Talking points: ${p.talking.join(" | ")}\n  FAQs: ${p.faqs.map((f) => `${f.q} — ${f.a}`).join(" | ")}${recipe}`;
  }).join("\n\n");

  const mods = MODULES.map((m) =>
    `## ${m.title}  [${m.section}]\n${m.summary}\n${m.body.map((b) => `  • ${b.h}: ${b.p}`).join("\n")}`
  ).join("\n\n");

  return `# PRODUCTS & RECIPES\n${prods}\n\n# BRAND, NUTRITION, CX & OPS (Academy modules)\n${mods}`;
}
