// THE alert vocabulary — one place, shared by every producer (server routes, client components)
// and the one router (alertDest in the crew console). The audit found producers emitting 12 ad-hoc
// category strings while the router matched 6 (and its "order" branch matched a string nobody
// emitted — dead code while every real order ping misrouted). Categories are now a closed set;
// anything else is a type error at the producer.
export type AlertSeverity = "critical" | "important" | "fyi";

const ALERT_CATEGORIES = {
  order: "order",       // a customer order needs the pass (cup, pack, delivery)
  money: "money",       // payments, payouts, recording failures
  brew: "brew",         // brew ladder: start windows, ready, holds
  booking: "booking",   // B2B booking requests
  prep: "prep",         // readiness, stock, load-out
  content: "content",   // Studio: approvals, publishing
  task: "task",         // assignments and due tasks
  strategy: "strategy", // strategy collab pings
  system: "system",     // app errors, admin/dev notices
} as const;
export type AlertCategory = keyof typeof ALERT_CATEGORIES;

// Legacy strings still in old rows (and any producer not yet migrated) → canonical category.
// The router normalizes through this so historic alerts keep routing correctly.
export function normalizeCategory(raw: string | null | undefined): AlertCategory {
  const c = (raw || "").toLowerCase();
  if (c === "order" || c === "orders") return "order";
  if (c === "money" || c === "billing") return "money";
  if (c === "brew") return "brew";
  if (c.startsWith("booking")) return "booking";
  if (c === "prep") return "prep";
  if (c === "content" || c === "comment") return "content";
  if (c === "task" || c === "assignment") return "task";
  if (c === "strategy") return "strategy";
  if (c === "note") return "content"; // historic: notes were mostly content approvals; router also checks title
  return "system";
}

// ── WHICH MOMENT AN ALERT CARD SHOWS ──────────────────────────────────────────────────────────
// last_seen_at is "when this was last true" (0340 gave it that one meaning). For a condition that
// folds recurrences into one line, the latest one is the news — "×4 · 20m ago". For a single
// continuous episode it is the WRONG clock: a producer refreshes it on every run, so a stall raised
// five days ago read "12m ago", fresh, under a title about five days. A single episode shows when it
// was raised.
export function alertWhen(a: { created_at: string; last_seen_at?: string | null; occurrences?: number | null }): string {
  return (a.occurrences ?? 1) > 1 && a.last_seen_at ? a.last_seen_at : a.created_at;
}
