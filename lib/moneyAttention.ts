import { moneyRound } from "./money";
import { dueWord } from "./dayWords";

// WHAT NEEDS A PERSON, ON MONEY (2026-10-15, release 3 of the Plan & Money audit: "Money answers three questions in
// order — how is the business doing, what needs attention, what do I do next"; Ryan, shown the mockups: "Yes, build it"). Money's exceptions sat where each
// was built: the shop's queue of paid orders waiting on us was the last panel on the page, 2,236 points down on an
// iPhone 17, although the critical alert for a stalled order links to it; a chargeback's evidence date was on My
// Day only; an invoice past its date said nothing on the screen about money; a refund Square made and this app
// never recorded lived in a view nothing opened (v_shop_money_drift, 0330); a budget over its line said so inside a
// closed panel. Here they are one list, worst first, each a sentence: what it is, then its level and the problem
// in words — the level a word first and a colour second, as the audit's five levels are.
//
// Only the levels a person must act on are used here (Critical, Urgent, Action required); Normal and
// Informational are what the rest of the page is. One rule per source, each the one the database already keeps:
//   · a shop order waiting on us is critical from 24 hours — shop_order_stall_watchdog's default (0331), which
//     raises its critical alert at the same hour — and action required before it;
//   · a chargeback still open (square_disputes, 0330: any state but won, lost or accepted) is critical with two days
//     or fewer to answer, and urgent before that — Square decides against us when the date passes; its day is the
//     business's, Eastern, as v_obligations cuts it;
//   · an invoice past its date (open or sent, 0187; dated since 0341) is urgent; one not yet due is Performance's
//     "Owed to you", not a problem;
//   · Square and this app disagreeing about a refund (v_shop_money_drift, without an open chargeback — that row is
//     the chargeback's) is action required;
//   · a budget over its line this month (report_spend) is action required.
// Kept apart from the component so the smoke can hold each rule to its words.

export type Level = "critical" | "urgent" | "action";

/** The level said in words, first; the colour follows it (owed-row's late class for the first two). */
export const LEVEL_WORD: Record<Level, string> = { critical: "Critical", urgent: "Urgent", action: "Action required" };

const RANK: Record<Level, number> = { critical: 0, urgent: 1, action: 2 };

/** shop_order_stall_watchdog(stale_hours int default 24), 0331: from here a waiting order is a critical alert. */
export const STALL_HOURS = 24;
/** A chargeback with this many days or fewer to answer is critical. */
export const DISPUTE_CRITICAL_DAYS = 2;

export type AttnGo = { section: string; anchor?: string };
export type AttnRow = {
  key: string;
  level: Level;
  title: string;
  /** "Critical · Jordan R. paid $64 for 1 tee" — the level first, then the problem. */
  detail: string;
  /** The fact on the right: how long, how late, how much. */
  side: string;
  go: AttnGo;
  /** An invoice's row carries its own answer, "Paid" (mark_invoice_paid, an owner's or admin's). */
  invoiceId?: string;
};

export type ShopWait = { id: string; who: string | null; total_cents: number | null; age_hours: number | null; items: string | null };
/** An open chargeback: its amount, who, and the whole days from today to its evidence date (Eastern). */
export type Dispute = { id: string; amount_cents: number; who: string | null; days_out: number | null };
/** An open invoice: its amount, the account, and the whole days from today to its due date. */
export type Invoice = { id: string; amount_cents: number; who: string | null; days_out: number | null };
export type Drift = { order_id: string; who: string | null; gap_cents: number; open_disputes: number };
export type BudgetLine = { category: string; budget_cents: number; spent_cents: number };

/** "5 hours" under a day, "1 day", "11 days" after it. */
export function waitWords(hours: number): string {
  const h = Math.max(0, Math.floor(hours));
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

export function moneyAttention(input: {
  waiting: readonly ShopWait[];
  disputes: readonly Dispute[];
  invoices: readonly Invoice[];
  drift: readonly Drift[];
  budgets: readonly BudgetLine[];
  label?: (slug: string) => string;
}): AttnRow[] {
  const rows: AttnRow[] = [];
  const label = input.label ?? ((s: string) => s);

  // Paid shop orders waiting on us: one row, named by the oldest — it is the one the alert rings for.
  const waiting = [...input.waiting].sort((a, b) => Number(b.age_hours ?? 0) - Number(a.age_hours ?? 0));
  if (waiting.length) {
    const oldest = waiting[0];
    const hours = Number(oldest.age_hours ?? 0);
    const level: Level = hours >= STALL_HOURS ? "critical" : "action";
    const who = oldest.who?.trim() || "A customer";
    const what = oldest.items?.trim() ? ` for ${oldest.items.trim()}` : "";
    rows.push({
      key: "shop",
      level,
      title: waiting.length === 1 ? "A shop order is waiting on us" : `${waiting.length} shop orders are waiting on us`,
      detail: `${LEVEL_WORD[level]} · ${waiting.length === 1 ? "" : "the oldest: "}${who} paid ${moneyRound(oldest.total_cents ?? 0)}${what}`,
      side: waitWords(hours),
      go: { section: "catalog", anchor: "shoporders" },
    });
  }

  for (const d of input.disputes) {
    const days = d.days_out;
    const level: Level = days === null || days <= DISPUTE_CRITICAL_DAYS ? "critical" : "urgent";
    rows.push({
      key: `dispute:${d.id}`,
      level,
      title: `Chargeback · ${moneyRound(d.amount_cents)}${d.who?.trim() ? ` · ${d.who.trim()}` : ""}`,
      detail: `${LEVEL_WORD[level]} · answer it in Square`,
      side: days === null ? "no date" : dueWord(days),
      go: { section: "money", anchor: "pay" },
    });
  }

  for (const v of input.invoices) {
    if (v.days_out === null || v.days_out >= 0) continue;
    rows.push({
      key: `invoice:${v.id}`,
      level: "urgent",
      title: `${v.who?.trim() || "An office account"} · ${moneyRound(v.amount_cents)}`,
      detail: `${LEVEL_WORD.urgent} · invoice past its date`,
      side: dueWord(v.days_out),
      go: { section: "money", anchor: "pay" },
      invoiceId: v.id,
    });
  }

  // A refund the two records disagree about. An order with an open chargeback is the chargeback's row above.
  for (const r of input.drift) {
    if (r.open_disputes > 0 || !r.gap_cents) continue;
    const who = r.who?.trim() || "A customer";
    rows.push({
      key: `drift:${r.order_id}`,
      level: "action",
      title: r.gap_cents > 0 ? "Refund in Square, not recorded here" : "Refund recorded here, not in Square",
      detail: `${LEVEL_WORD.action} · ${who}’s shop order`,
      side: moneyRound(Math.abs(r.gap_cents)),
      go: { section: "catalog", anchor: "shoporders" },
    });
  }

  for (const b of input.budgets) {
    if (!(b.budget_cents > 0) || b.spent_cents <= b.budget_cents) continue;
    rows.push({
      key: `budget:${b.category}`,
      level: "action",
      title: `${label(b.category)} over budget`,
      detail: `${LEVEL_WORD.action} · ${moneyRound(b.spent_cents)} of ${moneyRound(b.budget_cents)} this month`,
      side: `+${moneyRound(b.spent_cents - b.budget_cents)}`,
      go: { section: "money", anchor: "spend" },
    });
  }

  // Worst first; within a level, in the order above (the shop, chargebacks, invoices, refunds, budgets).
  return rows.map((r, i) => ({ r, i })).sort((a, b) => RANK[a.r.level] - RANK[b.r.level] || a.i - b.i).map((x) => x.r);
}

/** The counts for the head: "2 critical", "1 urgent", "3 to do" — each only when there is one. */
export function attentionCounts(rows: readonly AttnRow[]): { critical: number; urgent: number; action: number } {
  return {
    critical: rows.filter((r) => r.level === "critical").length,
    urgent: rows.filter((r) => r.level === "urgent").length,
    action: rows.filter((r) => r.level === "action").length,
  };
}
