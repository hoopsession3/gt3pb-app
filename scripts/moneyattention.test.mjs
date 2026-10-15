// WHAT NEEDS A PERSON, ON MONEY — every rule of lib/moneyAttention, run (release 3 of the Plan & Money audit; Ryan,
// 2026-10-15: "Yes, build it").
//
// The finding, as a sentence: Money's exceptions sat where each was built, and the one every critical shop alert points
// at was the last panel, 2,236 points down on an iPhone 17. Money's Needs attention lists them now, worst first, each
// with its level said in words. What is real here is compiled from lib/moneyAttention; the rows are what the database's
// views and tables hand the component (components/MoneyAttention), stood in for. The levels come from the database's own
// rules: a shop order waiting on us is critical from shop_order_stall_watchdog's 24 hours (0331); a chargeback with two
// days or fewer to answer is critical; an invoice past its date is urgent; a refund the two records disagree about and a
// budget over its line are action required.
import { libLoader } from "./fixtures/chargeonce.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const M = libLoader()("lib/moneyAttention.ts");
ok("compiled: lib/moneyAttention", typeof M.moneyAttention === "function" && typeof M.waitWords === "function");

const none = { waiting: [], disputes: [], invoices: [], drift: [], budgets: [] };
const run = (over) => M.moneyAttention({ ...none, ...over });

// ── nothing to say ──
ok("nothing waiting, nothing late, nothing over: no rows", run({}).length === 0);
ok("an invoice not yet due is Performance's, not a problem", run({ invoices: [{ id: "i1", amount_cents: 36000, who: "Peak Physio", days_out: 5 }] }).length === 0);
ok("an invoice due today is not late", run({ invoices: [{ id: "i1", amount_cents: 36000, who: "Peak Physio", days_out: 0 }] }).length === 0);
ok("an invoice with no date says nothing here (v_obligations keeps only dated ones too)", run({ invoices: [{ id: "i1", amount_cents: 36000, who: "Peak Physio", days_out: null }] }).length === 0);
ok("a budget inside its line, or with no line, is nothing", run({ budgets: [{ category: "supplies", budget_cents: 30000, spent_cents: 30000 }, { category: "misc", budget_cents: 0, spent_cents: 9000 }] }).length === 0);
ok("a refund the records agree on is nothing", run({ drift: [{ order_id: "o1", who: "Sam K.", gap_cents: 0, open_disputes: 0 }] }).length === 0);

// ── the shop's queue: one row, named by the oldest ──
{
  const fresh = run({ waiting: [{ id: "a", who: "Maya T.", total_cents: 6400, age_hours: 5, items: "1 tee, 1 cap" }] });
  ok("an order waiting on us under a day is action required, said with its hours", fresh.length === 1 && fresh[0].level === "action"
    && fresh[0].title === "A shop order is waiting on us" && fresh[0].detail === "Action required · Maya T. paid $64 for 1 tee, 1 cap" && fresh[0].side === "5 hours", fresh[0]);
  const stalled = run({ waiting: [{ id: "a", who: "Maya T.", total_cents: 6400, age_hours: 24, items: "1 tee" }] });
  ok("from the 24th hour it is critical — the hour the stall watchdog raises its alert (0331)", stalled[0].level === "critical" && stalled[0].side === "1 day" && /^Critical · /.test(stalled[0].detail), stalled[0]);
  const many = run({ waiting: [
    { id: "a", who: "Ana B.", total_cents: 3200, age_hours: 30, items: "1 cap" },
    { id: "b", who: "Maya T.", total_cents: 6400, age_hours: 264, items: "1 tee, 1 cap" },
    { id: "c", who: null, total_cents: 2800, age_hours: 2, items: null },
  ] });
  ok("three waiting are one row, counted, named by the one most at risk — before 0407, the oldest", many.length === 1 && many[0].title === "3 shop orders are waiting on us"
    && many[0].detail === "Critical · the first: Maya T. paid $64 for 1 tee, 1 cap" && many[0].side === "11 days", many[0]);
  ok("the shop's row opens its queue in the Catalog, where it is now", many[0].go.section === "catalog" && many[0].go.anchor === "shoporders", many[0].go);
  const nameless = run({ waiting: [{ id: "c", who: "  ", total_cents: 2800, age_hours: 2, items: "" }] });
  ok("no name and no items still reads as a sentence", nameless[0].detail === "Action required · A customer paid $28", nameless[0]);
}

// ── the promise (0407): 5 business days from payment; critical once today reaches the weekday before it ──
{
  const inside = run({ today: "2026-10-15", waiting: [{ id: "a", who: "Maya T.", total_cents: 6400, age_hours: 70, items: "1 tee", ship_by: "2026-10-19", ship_risk: false }] });
  ok("inside its promise an order waiting three days is action required, said by its promise — no ringing during service", inside[0].level === "action"
    && inside[0].detail === "Action required · Maya T. paid $64 for 1 tee" && inside[0].side === "ships in 4 days", inside[0]);
  const risk = run({ today: "2026-10-16", waiting: [{ id: "a", who: "Maya T.", total_cents: 6400, age_hours: 94, items: "1 tee", ship_by: "2026-10-19", ship_risk: true }] });
  ok("the weekday before its promise it is critical", risk[0].level === "critical" && risk[0].side === "ships in 3 days", risk[0]);
  const late = run({ today: "2026-10-21", waiting: [{ id: "a", who: "Maya T.", total_cents: 6400, age_hours: 200, items: "1 tee", ship_by: "2026-10-19", ship_risk: true }] });
  ok("past it, critical, and how late", late[0].level === "critical" && late[0].side === "2 days late", late[0]);
  const due = run({ today: "2026-10-19", waiting: [{ id: "a", who: null, total_cents: 2800, age_hours: 150, items: null, ship_by: "2026-10-19", ship_risk: true }] });
  ok("on the day: ships today", due[0].side === "ships today", due[0]);
  const mixed = run({ today: "2026-10-15", waiting: [
    { id: "old", who: "Ana B.", total_cents: 3200, age_hours: 90, items: "1 cap", ship_by: "2026-10-20", ship_risk: false },
    { id: "risk", who: "Devon P.", total_cents: 4800, age_hours: 30, items: "1 hoodie", ship_by: "2026-10-16", ship_risk: true },
  ] });
  ok("the row is named by the order at risk, not the oldest one inside its promise", mixed[0].level === "critical" && /Devon P\./.test(mixed[0].detail) && mixed[0].side === "ships in 1 day", mixed[0]);
  ok("promiseWords: in N days, today, N days late", M.promiseWords(1) === "ships in 1 day" && M.promiseWords(0) === "ships today" && M.promiseWords(-1) === "1 day late" && M.promiseWords(-3) === "3 days late");
}

// ── chargebacks ──
{
  const soon = run({ disputes: [{ id: "d1", amount_cents: 3800, who: "Devon P.", days_out: 2 }] });
  ok("a chargeback with two days to answer is critical", soon[0].level === "critical" && soon[0].title === "Chargeback · $38 · Devon P." && soon[0].detail === "Critical · answer it in Square" && soon[0].side === "in 2 days", soon[0]);
  const later = run({ disputes: [{ id: "d1", amount_cents: 3800, who: null, days_out: 4 }] });
  ok("with more time it is urgent, and with no name it says only the amount", later[0].level === "urgent" && later[0].title === "Chargeback · $38" && later[0].side === "in 4 days", later[0]);
  const past = run({ disputes: [{ id: "d1", amount_cents: 3800, who: "Devon P.", days_out: -1 }] });
  ok("past its date it is critical and says how late", past[0].level === "critical" && past[0].side === "1 day late", past[0]);
  const undated = run({ disputes: [{ id: "d1", amount_cents: 3800, who: "Devon P.", days_out: null }] });
  ok("with no date from Square it is critical — nobody can say how long is left", undated[0].level === "critical" && undated[0].side === "no date", undated[0]);
  ok("a chargeback's row opens Get paid, where it is listed", later[0].go.section === "money" && later[0].go.anchor === "pay", later[0].go);
}

// ── invoices ──
{
  const late = run({ invoices: [{ id: "i1", amount_cents: 42000, who: "Northside Dental", days_out: -6 }] });
  ok("an invoice past its date is urgent, with its account and amount, and carries its Paid answer", late.length === 1 && late[0].level === "urgent"
    && late[0].title === "Northside Dental · $420" && late[0].detail === "Urgent · invoice past its date" && late[0].side === "6 days late" && late[0].invoiceId === "i1", late[0]);
  ok("an invoice's row opens Get paid", late[0].go.section === "money" && late[0].go.anchor === "pay");
  const anon = run({ invoices: [{ id: "i2", amount_cents: 10000, who: null, days_out: -1 }] });
  ok("an invoice with no account name says so", anon[0].title === "An office account · $100", anon[0]);
}

// ── refunds the two records disagree about ──
{
  const sq = run({ drift: [{ order_id: "o1", who: "Sam K.", gap_cents: 2200, open_disputes: 0 }] });
  ok("Square refunded more than the app recorded: action required, with the gap", sq[0].level === "action" && sq[0].title === "Refund in Square, not recorded here"
    && sq[0].detail === "Action required · Sam K.’s shop order" && sq[0].side === "$22", sq[0]);
  const app = run({ drift: [{ order_id: "o1", who: "Sam K.", gap_cents: -2200, open_disputes: 0 }] });
  ok("the app recorded more than Square refunded: said the other way round", app[0].title === "Refund recorded here, not in Square" && app[0].side === "$22", app[0]);
  ok("an order with an open chargeback is the chargeback's row, not a second one", run({ drift: [{ order_id: "o1", who: "Sam K.", gap_cents: 2200, open_disputes: 1 }] }).length === 0);
  ok("a refund's row opens the order, in the Catalog", sq[0].go.section === "catalog" && sq[0].go.anchor === "shoporders");
}

// ── budgets ──
{
  const over = run({ budgets: [{ category: "ingredients", budget_cents: 50000, spent_cents: 61200 }], label: (s) => (s === "ingredients" ? "Ingredients" : s) });
  ok("a budget over its line: action required, by its label, with how far over", over[0].level === "action" && over[0].title === "Ingredients over budget"
    && over[0].detail === "Action required · $612 of $500 this month" && over[0].side === "+$112", over[0]);
  ok("a budget's row opens Spend vs budget", over[0].go.section === "money" && over[0].go.anchor === "spend");
}

// ── worst first, and the counts ──
{
  const rows = run({
    budgets: [{ category: "ingredients", budget_cents: 50000, spent_cents: 61200 }],
    drift: [{ order_id: "o1", who: "Sam K.", gap_cents: 2200, open_disputes: 0 }],
    invoices: [{ id: "i1", amount_cents: 42000, who: "Northside Dental", days_out: -6 }],
    disputes: [{ id: "d1", amount_cents: 3800, who: "Devon P.", days_out: 4 }],
    waiting: [{ id: "a", who: "Maya T.", total_cents: 6400, age_hours: 264, items: "1 tee, 1 cap" }],
  });
  ok("worst first: critical, then urgent, then action required — and within a level, the shop, chargebacks, invoices, refunds, budgets",
    rows.map((r) => r.key).join(",") === "shop,dispute:d1,invoice:i1,drift:o1,budget:ingredients", rows.map((r) => r.key));
  ok("every row's detail starts with its level, in words", rows.every((r) => r.detail.startsWith(`${M.LEVEL_WORD[r.level]} · `)), rows.map((r) => r.detail));
  const c = M.attentionCounts(rows);
  ok("the head counts each level", c.critical === 1 && c.urgent === 2 && c.action === 2, c);
  const twoCritical = run({ waiting: [{ id: "a", who: "Maya T.", total_cents: 6400, age_hours: 2, items: null }], disputes: [{ id: "d1", amount_cents: 3800, who: null, days_out: 1 }] });
  ok("a critical chargeback goes above a young shop order", twoCritical[0].key === "dispute:d1" && twoCritical[1].key === "shop", twoCritical.map((r) => r.key));
}

// ── waitWords ──
ok("waitWords: hours under a day, days after", M.waitWords(0) === "0 hours" && M.waitWords(1) === "1 hour" && M.waitWords(23.9) === "23 hours" && M.waitWords(24) === "1 day" && M.waitWords(264) === "11 days");

console.log(`MONEY ATTENTION: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
