// ACTUAL AGAINST THE PLAN (R58 — the financial traceability audit's gap 8: "no actual-vs-projected for a live plan").
// Pure. A plan that has opened names the day it opened and the order channel that records its sales (0452); its real
// months are read from the order ledger — paid orders, not canceled — and set beside the months its approved baseline
// projected. Month 1 is the opening day to the same day a month later. A month still running is shown as "so far" and
// isn't counted in the to-date comparison: comparing half a month with a whole one would say nothing true.
import type { Model } from "./visionMoney";

export type ActualMonth = { m: number; from: string; through: string; orders: number; revenueCents: number; complete: boolean };
const addMonths = (day: string, k: number): string => {
  const [y, mo, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + k, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
};

/** The plan's real months, from its opening day through today (business days, "YYYY-MM-DD"), up to 36. */
export function actualMonths(lines: readonly { channel: string; day: string; totalCents: number; isPaid: boolean; canceled: boolean }[], channel: string, openedOn: string, today: string): ActualMonth[] {
  const out: ActualMonth[] = [];
  for (let m = 1; m <= 36; m++) {
    const from = addMonths(openedOn, m - 1), next = addMonths(openedOn, m);
    if (from > today) break;
    const mine = lines.filter((l) => l.channel === channel && l.isPaid && !l.canceled && l.day >= from && l.day < next);
    out.push({ m, from, through: next, orders: mine.length, revenueCents: mine.reduce((n, l) => n + l.totalCents, 0), complete: next <= today });
  }
  return out;
}

export type AgainstRow = { m: number; projected: number; actual: number; diff: number; pct: number | null; complete: boolean };
/** Each real month beside the month projected; and to date, over the complete months only. */
export function againstPlan(actual: readonly ActualMonth[], model: Model): { rows: AgainstRow[]; toDate: { months: number; projected: number; actual: number; diff: number; pct: number | null } } {
  const rows = actual.map((a) => {
    const projected = model.ok ? model.months[a.m - 1]?.revenue ?? 0 : 0;
    return { m: a.m, projected, actual: a.revenueCents, diff: a.revenueCents - projected, pct: projected > 0 ? ((a.revenueCents - projected) / projected) * 100 : null, complete: a.complete };
  });
  const done = rows.filter((r) => r.complete);
  const p = done.reduce((n, r) => n + r.projected, 0), a = done.reduce((n, r) => n + r.actual, 0);
  return { rows, toDate: { months: done.length, projected: p, actual: a, diff: a - p, pct: p > 0 ? ((a - p) / p) * 100 : null } };
}
