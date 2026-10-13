import type { Drink } from "./drinks";
import { money } from "./money";

// Public, claim-safe knowledge for the guest concierge. Built from the menu customers order from — since 2026-10-13 the
// Catalog (lib/drinks: each drink's products row, the code list filling only what a row leaves empty): names, what each
// drink is, why it exists, what is in it and what never is, caffeine and what it contains, both only when the Catalog
// says. NO internal ops, costs, or recipes leak here; the route adds only public live data (events, hours).
export function menuKnowledge(drinks: readonly Drink[]): string {
  return drinks.map((d) => {
    const price = d.priceCents != null ? money(d.priceCents) : "price at the window";
    const when = d.when ? `best ${d.when.toLowerCase()}${d.whenText ? ` (${d.whenText})` : ""}` : d.whenText;
    const facts = [
      d.lines.length ? `  ${d.lines.join("; ")}` : "",
      d.why ? `  Why: ${d.why}` : "",
      d.has.length ? `  In it: ${d.has.join(", ")}` : "",
      d.no.length ? `  Free of: ${d.no.join(", ")}` : "",
      d.caffeine === true ? "  Caffeine: yes" : d.caffeine === false ? "  Caffeine: none" : "",
      d.contains?.length ? `  Contains (not a full allergen list — allergy questions still go to the crew): ${d.contains.join(", ")}` : "",
      d.tag ? `  Note: ${d.tag}` : "",
      d.soldOut ? "  86'd today — sold out until the next brew" : "",
    ].filter(Boolean).join("\n");
    return `## ${d.name} (${price})${when ? ` — ${when}` : ""} · ${d.line}\n${facts}`;
  }).join("\n\n");
}
