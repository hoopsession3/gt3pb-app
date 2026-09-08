// MONEY — the one place this app turns an amount into something a person reads.
//
// Before this file there were THIRTY definitions of that job across app/, components/ and lib/,
// under three names (money ×14, dollars ×6, usd ×4, plus the lib copies), resolving to seven
// distinct behaviours. Run against the same inputs they disagreed in ways a customer could see:
//
//     cents    toFixed    toLocale    round    toFixed(2)    maxDigits0    abs+round    signed
//      1999     $19.99      $19.99      $20        $19.99           $20          $20       $20
//        50      $0.50       $0.5        $1         $0.50            $1           $1        $1
//     -1999    $-19.99     $-19.99     $-20       $-19.99          $-20          $20      -$20
//      null         $0         $0        $0         $0.00            $0           $0        $0
//
// So a $19.99 item read "$19.99" on one screen and "$20" on another; fifty cents read "$0.50",
// "$0.5" or "$1"; and a refund of -$19.99 rendered four ways, one of which DROPPED THE MINUS SIGN
// and showed a refund as a charge.
//
// ── TWO FUNCTIONS, NOT ONE ─────────────────────────────────────────────────────────────────────
// The thirty were not all wrong. They were two different intentions tangled together:
//
//   money()       an amount somebody pays or is owed — a price, a line item, an invoice total.
//                 Cents matter. $19.99 is not $20.
//   moneyRound()  an amount somebody reads at a glance — a KPI tile, a monthly total, a budget.
//                 Cents are noise. $12,340 beats $12,339.57.
//
// Collapsing those into one would have been the wrong kind of tidy: it would either print cents on
// a dashboard or hide them on an invoice. Both are kept, both are named for what they are for, and
// every call site was mapped to the one matching what it already did — so this consolidation is
// invisible on every screen EXCEPT where the old behaviour was a defect.
//
// ── WHAT DELIBERATELY CHANGED ──────────────────────────────────────────────────────────────────
//   · "$-19.99" and "$-20" now read "-$19.99" and "-$20". A minus between the symbol and the digits
//     is malformed currency in every style guide that has an opinion.
//   · The one implementation that used Math.abs() no longer silently drops the sign.
//   · "$0.5" now reads "$0.50". toLocaleString() with no minimum digits was printing half a cent
//     column.
//   · null was rendering as "$0" — asserting zero where the truth is "we do not know". It reads "—".
//
// ── THE UNIT ───────────────────────────────────────────────────────────────────────────────────
// money() and moneyRound() take CENTS, because every amount in this database is an integer of cents
// and floating-point dollars are how a total ends up a penny out. lib/orderAhead is the one
// deliberate exception — it computes pack pricing in dollars and converts at the boundary with
// toCents() — so moneyFromDollars() exists for it rather than forcing a conversion that would put
// a rounding step where that file already fixed one.

/** Cents → a whole-dollar figure with no sign or symbol. Shared by both formatters. */
const abs = (cents: number): number => Math.abs(Number(cents)) / 100;
const sign = (cents: number): string => (Number(cents) < 0 ? "-" : "");
const unknown = (cents: number | null | undefined): boolean =>
  cents == null || !Number.isFinite(Number(cents));

/**
 * An amount somebody pays. Cents shown only when there are cents: $60, $19.99, $0.50.
 * Negative reads -$19.99. Unknown reads "—", never "$0".
 */
export function money(cents: number | null | undefined): string {
  if (unknown(cents)) return "—";
  const n = abs(cents as number);
  // toFixed(2) then trim a trailing ".00" — cheaper to read than a modulo on a float, and it
  // cannot produce "$0.5" the way toLocaleString() with no minimumFractionDigits does.
  const s = n.toFixed(2);
  return `${sign(cents as number)}$${s.endsWith(".00") ? s.slice(0, -3) : s}`;
}

/**
 * An amount somebody reads at a glance. Whole dollars with separators: $12,340, $60, -$20.
 * Unknown reads "—". Use this on dashboards, budgets and reports; never on a price.
 */
export function moneyRound(cents: number | null | undefined): string {
  if (unknown(cents)) return "—";
  return `${sign(cents as number)}$${Math.round(abs(cents as number)).toLocaleString("en-US")}`;
}

/**
 * The same as money(), for the one module that computes in dollars (lib/orderAhead's pack pricing).
 * Named for its unit so nobody has to guess which of the two a `dollars()` in scope meant.
 */
export function moneyFromDollars(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return money(Math.round(Number(n) * 100));
}
