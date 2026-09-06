// SPEND — budget, actual, and whether a receipt is owed.
//
// Pure and deterministic, same contract as the other lib modules, so the money arithmetic is
// unit-tested instead of trusted to a component. 0292 is the database half; this is the half the
// screen reads, and the two are kept honest by the same rule the deal explainer holds: a function
// here has to be as willing to report a problem as a clean bill.

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
  const money = (c: number) => `$${Math.round(Math.abs(c) / 100).toLocaleString("en-US")}`;
  if (t.overCategories > 0) {
    return `${t.overCategories} ${t.overCategories === 1 ? "category is" : "categories are"} over budget — ${money(t.spentCents)} spent against ${money(t.budgetCents)}.`;
  }
  if (t.unreceiptedCount > 0) {
    return `${money(t.spentCents)} spent, on budget — but ${money(t.unreceiptedCents)} of it has no receipt (${t.unreceiptedCount} ${t.unreceiptedCount === 1 ? "item" : "items"}).`;
  }
  if (t.budgetCents === 0 && t.spentCents === 0) return "Nothing spent and no budgets set yet.";
  if (t.budgetCents === 0) return `${money(t.spentCents)} spent, against no budget — set one to make this mean something.`;
  return `${money(t.spentCents)} of ${money(t.budgetCents)} spent, everything receipted.`;
}
