// THE ACTIVITY LOG, ONE LIST FROM TWO TRAILS (R49 — the console audit's point 8, and the Activity log's own point 2).
//
// Two triggers keep history: 0260's log_admin_audit writes admin_audit (the catalog, roles, budgets, copy, tiers) with a
// summary it computes; 0042's audit_row writes audit_log (orders, drops, deliveries, inventory, gear, offer letters,
// agreements, and since 0446 invoices, broadcasts, prep tasks, events, stops, shoots, office orders and to-dos) with the
// row before and after and no summary. No screen showed audit_log. Here both become one kind of line — who, did what, to
// which kind of thing, when, and what changed — newest first, searchable, and filtered by what and by who.

export type AdminAuditRow = { id: number; actor: string | null; action: string; table_name: string; row_pk: string | null; summary: string | null; created_at: string };
export type AuditLogRow = { id: number; actor: string | null; op: string; table_name: string; row_id: string | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; at: string };
export type Line = { key: string; at: string; actor: string | null; action: "INSERT" | "UPDATE" | "DELETE" | string; table: string; rowPk: string | null; summary: string | null; title: string | null };

// What each kind of thing is called on the screen. A table not named here shows its own name.
export const TABLE_LABEL: Record<string, string> = {
  products: "Menu product", deals: "Deal", budgets: "Budget", site_copy: "Copy line", profiles: "Role", customers: "Tier",
  product_86: "86 in one city", shop_products: "Shop product", subscription_plans: "Membership plan", member_benefits: "Code or perk",
  primal_lessons: "Lesson", primal_modules: "Course module", primal_pillars: "Course pillar", reserves: "Reserve drop",
  program_access: "GT3 Nutrition access", meeting_notes: "Meeting note",
  orders: "Order", drop_orders: "Drop pickup", delivery_orders: "Delivery", business_orders: "Office order", shop_orders: "Shop order",
  invoices: "Invoice", expenses: "Purchase", broadcasts: "Broadcast", reviews: "Review", offer_letters: "Offer letter",
  operator_agreements: "Operator agreement", event_tasks: "Prep task", events: "Event", stops: "Stop", shoots: "Shoot", shots: "Shot",
  option_sets: "List", brew_batches: "Brew batch", inventory_items: "Inventory item", assets: "Gear", todos: "To-do",
  subscriptions: "Subscription", event_approvals: "Event approval", promos: "Promo", goals: "Goal",
};
export const ACTION_LABEL: Record<string, string> = { INSERT: "added", UPDATE: "changed", DELETE: "removed" };
export const labelOf = (t: string) => TABLE_LABEL[t] ?? t.replace(/_/g, " ");

const SKIP = new Set(["updated_at", "created_at", "at", "updated_by", "search", "fts", "tsv"]);
const short = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "∅";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
};

/** What changed between two copies of a row, the way 0260's summary says it: "status: new → ready · total_cents: 1400 → 1600". */
export function diffWords(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string | null {
  if (!before || !after) return null;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !SKIP.has(k)).sort();
  const parts = keys.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)).map((k) => `${k}: ${short(before[k])} → ${short(after[k])}`);
  return parts.length ? parts.join(" · ") : null;
}

/** The row's own name, when it has one — what a person would call the thing that was added or removed. */
export function titleOf(row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  for (const k of ["title", "name", "label", "customer", "company", "headline", "description", "code"]) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return short(v.trim());
  }
  return null;
}

/** Both trails as one list, newest first. A change that touched only a timestamp is no line (0260's rule, both trails). */
export function mergeTrails(admin: readonly AdminAuditRow[], log: readonly AuditLogRow[]): Line[] {
  const a: Line[] = admin.map((r) => ({ key: `a${r.id}`, at: r.created_at, actor: r.actor, action: r.action, table: r.table_name, rowPk: r.row_pk, summary: r.summary, title: null }));
  const b: Line[] = [];
  for (const r of log) {
    const action = r.op.toUpperCase();
    const summary = action === "UPDATE" ? diffWords(r.old_data, r.new_data) : null;
    if (action === "UPDATE" && !summary) continue;
    b.push({ key: `l${r.id}`, at: r.at, actor: r.actor, action, table: r.table_name, rowPk: r.row_id, summary, title: titleOf(r.new_data ?? r.old_data) });
  }
  return [...a, ...b].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
}

/** Every typed word must be in who, what or the change. */
export function lineMatches(l: Line, who: string, q: string): boolean {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = `${who} ${labelOf(l.table)} ${ACTION_LABEL[l.action] ?? l.action} ${l.title ?? ""} ${l.summary ?? ""}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}
