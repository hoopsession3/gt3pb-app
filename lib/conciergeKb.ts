import { DRINKS } from "./menu";

// Public, claim-safe knowledge for the guest concierge. Built from the canonical customer menu copy
// (lib/menu.ts) — names, what each drink is, why it exists, what it contains / is free of. NO internal
// ops, costs, or recipes leak here; the route adds only public live data (prices, events, hours).
export function menuKnowledge(): string {
  return Object.values(DRINKS).map((d) =>
    `## ${d.n} (${d.px}) — best ${d.when.toLowerCase()} (${d.whenT})\n  ${d.lines.join("; ")}\n  Why: ${d.why}\n  Contains: ${d.has.join(", ")}\n  Free of: ${d.no.join(", ")}${d.tag ? `\n  Note: ${d.tag}` : ""}`
  ).join("\n\n");
}
