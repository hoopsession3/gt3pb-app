// THE PROPOSITION, FROM APPROVED FACTS (IMS8 P12). Ryan, 2026-11-02: "make the investor's core questions easy to answer —
// What is being funded? How much is sought, and how will it be used? What terms or return structure are being proposed?
// What milestones and dependencies remain? … Do not invent terms, returns, dates, or numbers. Distinguish 'Being priced',
// confirmed zero, and a specified amount. Avoid presenting an approved scenario as an approved investment offer unless that
// approval actually exists."
//
// Every answer is read from what the link sends (a Vision from toVision): the programs and plans it was given, the asks
// (three states, 0471), each plan's approved money case (its use-of-funds lines by category, and the structure modeled in
// it), the plans' gates, open needs and what each waits on. Nothing is computed that the case doesn't hold but sums of its
// own lines; nothing is said where the link holds nothing. The structure is said as MODELED in the approved case — there is
// no approved offer in GT3's records, so none is claimed. Pure.
import { askTotals, shortMoney } from "./vision";
import { CATEGORIES, CATEGORY_WORD, lineTotal, toLines, type Structure } from "./visionMoney";
import type { Vision } from "./visionRead";
import { propositionHas, type PropositionHas } from "./propositionHas";

export type UseOfFunds = { category: string; word: string; cents: number; lines: number; unpriced: number };
export type PlanTerms = { plan: string; version: number | null; approved: string | null; kind: Structure["kind"]; says: string };
export type Milestone = { plan: string; gate: string | null; needs: { label: string; due: string | null }[]; waitsOn: string[] };
export type Proposition = {
  funded: { program: string; plans: string[] }[];
  sought: { label: string; amount: string; state: string; program: string }[];
  soughtTotal: { specified: number; beingPriced: number; noneNeeded: number; open: number; committed: number; funded: number };
  uses: { plan: string; lines: UseOfFunds[]; total: number; unpriced: number }[];
  terms: PlanTerms[];
  milestones: Milestone[];
  /** Whether there's anything to say for each question — a slide shows only questions the link can answer. */
  has: PropositionHas;
};

/** An ask's amount in the presenter's own words (the cover and the board say these): a figure, "Being priced", or "None needed". */
export const soughtWord = (cents: number | null) => (cents == null ? "Being priced" : cents === 0 ? "None needed" : shortMoney(cents));
const STATE_WORD: Record<string, string> = { open: "open", committed: "committed", funded: "funded" };
const day = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);

/** The structure modeled in an approved case, in words, from its own numbers only. */
export function termsWords(s: Structure): string {
  switch (s.kind) {
    case "loan": return `A loan of ${shortMoney(s.amountCents)} at ${s.aprPct}% a year over ${s.termMonths} months`;
    case "rev_share": return `${shortMoney(s.amountCents)} for ${s.sharePct}% of sales until ${s.capMultiple}× (${shortMoney(Math.round(s.amountCents * s.capMultiple))}) is repaid`;
    case "equity": return `${shortMoney(s.amountCents)} for ${s.ownershipPct}% ownership, with ${s.payoutPct}% of profit paid out`;
    case "safe": return `${shortMoney(s.amountCents)} as a SAFE or convertible note, cap ${shortMoney(s.capCents)}, ${s.discountPct}% discount`;
    default: return "No terms in the approved case";
  }
}

export function propositionOf(v: Pick<Vision, "programs" | "plans" | "asks" | "needs" | "deps" | "cases">): Proposition {
  const name = new Map(v.plans.map((p) => [p.id, p.name]));
  const prog = new Map(v.programs.map((p) => [p.id, p.title]));
  const funded = v.programs.map((p) => ({ program: p.title, plans: v.plans.filter((x) => x.program_id === p.id).sort((a, b) => a.phase - b.phase || a.sort - b.sort).map((x) => `${x.name} (phase ${x.phase})`) }));
  const sought = v.asks.map((a) => ({ label: a.label, amount: soughtWord(a.amount_cents), state: STATE_WORD[a.state] ?? a.state, program: prog.get(a.program_id) ?? "" }));
  const t = askTotals(v.asks);
  const uses = v.plans.filter((p) => v.cases?.[p.id]).map((p) => {
    const lines = toLines((v.cases![p.id].scenarios.base as Record<string, unknown>).uses);
    const by = CATEGORIES.map((c) => {
      const mine = lines.filter((l) => l.category === c);
      return { category: c, word: CATEGORY_WORD[c], cents: mine.reduce((n, l) => n + (lineTotal(l) ?? 0), 0), lines: mine.length, unpriced: mine.filter((l) => lineTotal(l) == null).length };
    }).filter((x) => x.lines > 0);
    return { plan: p.name, lines: by, total: by.reduce((n, x) => n + x.cents, 0), unpriced: by.reduce((n, x) => n + x.unpriced, 0) };
  }).filter((u) => u.lines.length > 0);
  const terms = v.plans.filter((p) => v.cases?.[p.id]).map((p) => {
    const c = v.cases![p.id];
    return { plan: p.name, version: c.version ?? null, approved: day(c.approvedAt), kind: c.structure.kind, says: termsWords(c.structure) };
  });
  const milestones = v.plans.map((p) => ({
    plan: p.name, gate: p.gate?.trim() || null,
    needs: v.needs.filter((n) => n.plan_id === p.id && !n.done_on).sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") || a.sort - b.sort).map((n) => ({ label: n.label, due: day(n.due_on) })),
    waitsOn: v.deps.filter((d) => d.plan_id === p.id).map((d) => name.get(d.needs_plan_id)).filter((x): x is string => !!x),
  })).filter((m) => m.gate || m.needs.length || m.waitsOn.length);
  return {
    funded, sought, uses, terms, milestones,
    soughtTotal: { specified: t.total, beingPriced: t.unset, noneNeeded: t.none, open: t.open, committed: t.committed, funded: t.funded },
    has: propositionHas(v),
  };
}
