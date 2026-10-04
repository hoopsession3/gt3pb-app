// SPEND — budget, actual, and whether a receipt is owed.
//
// Pure and deterministic, same contract as the other lib modules, so the money arithmetic is
// unit-tested instead of trusted to a component. 0292 is the database half; this is the half the
// screen reads, and the two are kept honest by the same rule the deal explainer holds: a function
// here has to be as willing to report a problem as a clean bill.

import { moneyRound } from "./money";

export type CategorySlug = string;

export interface SpendCategory {
  slug: CategorySlug;
  label: string;
  sort?: number;
  active?: boolean;
  /** A receipt is owed at or above this amount. 0 = always. */
  receipt_required_over_cents?: number | null;
}

export interface ExpenseRow {
  id: string;
  market?: string | null;
  category: CategorySlug;
  amount_cents: number;
  spent_on: string;              // yyyy-mm-dd
  description?: string | null;
  receipt_path?: string | null;
  voided_at?: string | null;
}

export interface BudgetRow {
  market?: string | null;
  category: CategorySlug;
  monthly_limit_cents: number;
  effective_from?: string | null; // yyyy-mm-dd
}

const cents = (n: unknown) => Math.max(0, Math.round(Number(n) || 0));
export const monthKey = (d: string | Date): string => {
  const s = typeof d === "string" ? d : d.toISOString().slice(0, 10);
  return s.slice(0, 7);
};

/** A voided expense is not spend. Every total in this module goes through here first. */
export const isOpen = (e: ExpenseRow): boolean => !e.voided_at;

// ── the receipt rule ─────────────────────────────────────────────────────────────────────────────
/**
 * Does this expense owe a receipt? The threshold lives on the category because it differs in real
 * life — a $4 coffee for a customer is not a $400 grinder. An unknown category is treated as
 * always-required, which is the safe direction to be wrong in.
 */
export function needsReceipt(e: ExpenseRow, cats: readonly SpendCategory[]): boolean {
  if (!isOpen(e)) return false;
  if (e.receipt_path) return false;
  const c = cats.find((x) => x.slug === e.category);
  const over = c ? cents(c.receipt_required_over_cents ?? 0) : 0;
  return cents(e.amount_cents) >= over;
}

/** Everything owing a receipt, worst first — the biggest, then the oldest. */
export function receiptGaps(rows: readonly ExpenseRow[], cats: readonly SpendCategory[]): ExpenseRow[] {
  return rows
    .filter((e) => needsReceipt(e, cats))
    .sort((a, b) => (b.amount_cents - a.amount_cents) || a.spent_on.localeCompare(b.spent_on));
}

/** How much of the month's spend has nothing behind it. The number, not just the count. */
export function unreceiptedCents(rows: readonly ExpenseRow[], cats: readonly SpendCategory[]): number {
  return receiptGaps(rows, cats).reduce((n, e) => n + cents(e.amount_cents), 0);
}

// ── the budget in force for a month ──────────────────────────────────────────────────────────────
/**
 * The budget that applied IN a given month, not the one that applies now. Picks the latest row whose
 * effective_from is on or before the month — which is the whole reason 0292 gave budgets a date.
 */
export function budgetFor(
  category: CategorySlug, month: string, budgets: readonly BudgetRow[], market?: string | null,
): number {
  const start = `${month}-01`;
  const candidates = budgets
    .filter((b) => b.category === category)
    .filter((b) => (market == null ? true : (b.market ?? null) === market))
    .filter((b) => (b.effective_from ?? "0000-01-01") <= start)
    .sort((a, b) => (a.effective_from ?? "").localeCompare(b.effective_from ?? ""));
  const last = candidates[candidates.length - 1];
  return last ? cents(last.monthly_limit_cents) : 0;
}

// ── budget vs actual ─────────────────────────────────────────────────────────────────────────────
export interface VarianceLine {
  category: CategorySlug;
  label: string;
  budgetCents: number;
  spentCents: number;
  /** positive = under budget, negative = over. Named so the sign cannot be misread. */
  remainingCents: number;
  pctUsed: number | null;   // null when there is no budget to be a percentage of
  over: boolean;
}

export function variance(
  month: string,
  rows: readonly ExpenseRow[],
  budgets: readonly BudgetRow[],
  cats: readonly SpendCategory[],
  market?: string | null,
): VarianceLine[] {
  const inMonth = rows
    .filter(isOpen)
    .filter((e) => monthKey(e.spent_on) === month)
    .filter((e) => (market == null ? true : (e.market ?? null) === market));

  const spentBy = new Map<string, number>();
  for (const e of inMonth) spentBy.set(e.category, (spentBy.get(e.category) ?? 0) + cents(e.amount_cents));

  // Every category that is active OR has spend — so money in a retired category cannot hide.
  const slugs = new Set<string>([
    ...cats.filter((c) => c.active !== false).map((c) => c.slug),
    ...spentBy.keys(),
  ]);

  return [...slugs].map((slug) => {
    const c = cats.find((x) => x.slug === slug);
    const budgetCents = budgetFor(slug, month, budgets, market);
    const spentCents = spentBy.get(slug) ?? 0;
    return {
      category: slug,
      label: c?.label ?? slug,
      budgetCents,
      spentCents,
      remainingCents: budgetCents - spentCents,
      pctUsed: budgetCents > 0 ? Math.round((spentCents / budgetCents) * 100) : null,
      over: budgetCents > 0 && spentCents > budgetCents,
    };
  }).sort((a, b) => (b.spentCents - a.spentCents) || (a.label.localeCompare(b.label)));
}

export interface SpendTotals {
  spentCents: number;
  budgetCents: number;
  remainingCents: number;
  overCategories: number;
  unreceiptedCents: number;
  unreceiptedCount: number;
}

export function totals(
  month: string,
  rows: readonly ExpenseRow[],
  budgets: readonly BudgetRow[],
  cats: readonly SpendCategory[],
  market?: string | null,
): SpendTotals {
  const lines = variance(month, rows, budgets, cats, market);
  const inMonth = rows.filter(isOpen).filter((e) => monthKey(e.spent_on) === month)
    .filter((e) => (market == null ? true : (e.market ?? null) === market));
  const gaps = receiptGaps(inMonth, cats);
  const spentCents = lines.reduce((n, l) => n + l.spentCents, 0);
  const budgetCents = lines.reduce((n, l) => n + l.budgetCents, 0);
  return {
    spentCents, budgetCents,
    remainingCents: budgetCents - spentCents,
    overCategories: lines.filter((l) => l.over).length,
    unreceiptedCents: gaps.reduce((n, e) => n + cents(e.amount_cents), 0),
    unreceiptedCount: gaps.length,
  };
}

/**
 * One line a person can read. Deliberately leads with the bad news when there is bad news — a
 * summary that opens with "on track" while three categories are over is a summary that lies.
 */
export function headline(t: SpendTotals): string {
  if (t.overCategories > 0) {
    return `${t.overCategories} ${t.overCategories === 1 ? "category is" : "categories are"} over budget — ${moneyRound(t.spentCents)} spent against ${moneyRound(t.budgetCents)}.`;
  }
  if (t.unreceiptedCount > 0) {
    return `${moneyRound(t.spentCents)} spent, on budget — but ${moneyRound(t.unreceiptedCents)} of it has no receipt (${t.unreceiptedCount} ${t.unreceiptedCount === 1 ? "item" : "items"}).`;
  }
  if (t.budgetCents === 0 && t.spentCents === 0) return "Nothing spent and no budgets set yet.";
  if (t.budgetCents === 0) return `${moneyRound(t.spentCents)} spent, against no budget — set one to make this mean something.`;
  return `${moneyRound(t.spentCents)} of ${moneyRound(t.budgetCents)} spent, everything receipted.`;
}

// ── what a person reads and picks (2026-10-04) ───────────────────────────────────────────────────
// Ryan, of the Spend panel: "Should you have an open field like this or should it be architected
// differently?" It was a five-field form parked under the month's report, defaulted to "supplies"
// and to Greenville, beside three different sentences that all said nothing had been spent. These
// are the pieces the capture sheet and the report now share, so neither re-derives them.

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

/** "2026-10" → "October" in the current year, "October 2025" otherwise. The panel printed the key. */
export function monthLabel(key: string | null | undefined, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key ?? "").trim());
  const name = m ? MONTH_NAMES[Number(m[2]) - 1] : undefined;
  if (!m || !name) return String(key ?? "");
  return Number(m[1]) === now.getFullYear() ? name : `${name} ${m[1]}`;
}

/** A category's own words. The panel printed the slug ("supplies"); the table has had labels since 0292. */
export function categoryLabel(slug: string | null | undefined, cats: readonly SpendCategory[]): string {
  const s = String(slug ?? "").trim();
  const c = cats.find((x) => x.slug === s);
  if (c?.label?.trim()) return c.label.trim();
  return s ? s.replace(/_/g, " ").replace(/^\w/, (ch) => ch.toUpperCase()) : "Uncategorised";
}

/**
 * The categories a purchase can go in, the ones this business actually uses FIRST (most-used in
 * `recent`), then the house order. Inactive ones are not offered. Nothing is pre-selected by the
 * caller: a default category is a silent miscategorisation of everything that is not that category.
 */
export function categoryOrder(cats: readonly SpendCategory[], recent: readonly { category: string }[] = []): SpendCategory[] {
  const uses = new Map<string, number>();
  for (const r of recent) uses.set(r.category, (uses.get(r.category) ?? 0) + 1);
  return cats.filter((c) => c.active !== false).slice()
    .sort((a, b) => ((uses.get(b.slug) ?? 0) - (uses.get(a.slug) ?? 0)) || ((a.sort ?? 0) - (b.sort ?? 0)));
}

/**
 * The day a purchase is filed under (spent_on, local yyyy-mm-dd). "Today" and "yesterday" are the
 * two that matter at a register; anything else is picked. The old form could only ever say today,
 * so a receipt logged the morning after was filed under the wrong day — and at month's end, the
 * wrong month.
 */
export function purchaseDay(choice: "today" | "yesterday" | "pick", picked: string, now: Date): string {
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (choice === "today") return key(now);
  if (choice === "yesterday") { const y = new Date(now); y.setDate(y.getDate() - 1); return key(y); }
  return /^\d{4}-\d{2}-\d{2}$/.test(picked) ? picked : "";
}

/**
 * What to say about the receipt BEFORE the purchase is saved, or null when nothing is owed. The same
 * rule the missing-receipt list applies afterwards (needsReceipt), asked at the one moment the
 * receipt is usually still in someone's hand.
 */
export function receiptAsk(amountCents: number, slug: string, cats: readonly SpendCategory[], hasReceipt: boolean): string | null {
  if (hasReceipt || !(amountCents > 0) || !slug) return null;
  const owed = needsReceipt({ id: "", category: slug, amount_cents: amountCents, spent_on: "", receipt_path: null, voided_at: null }, cats);
  if (!owed) return null;
  const c = cats.find((x) => x.slug === slug);
  const over = cents(c?.receipt_required_over_cents ?? 0);
  return over > 0
    ? `${categoryLabel(slug, cats)} needs a receipt from ${moneyRound(over)} — photograph it now and it is done.`
    : `${categoryLabel(slug, cats)} always needs a receipt — photograph it now and it is done.`;
}
