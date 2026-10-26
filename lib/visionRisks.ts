// A PLAN'S RISKS AND ASSUMPTIONS (R61, 0454 — Ryan, 2026-10-25: "risks, assumptions, mitigation strategies, and
// supporting evidence"). Pure. Each is Ryan's words: what could go wrong (or what we're assuming), how likely and how much
// it would hurt, what we'd do, the evidence or the test. Ranked by likelihood × impact — a reading of his own ratings,
// not a model's; an unrated one sorts last and says it needs rating.
export const LEVELS = ["low", "medium", "high"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_WORD: Record<Level, string> = { low: "Low", medium: "Medium", high: "High" };
export const RISK_STATUS = { open: "Open", handled: "Handled", validated: "Validated", wrong: "Proved wrong" } as const;
export type RiskStatus = keyof typeof RISK_STATUS;
export type Risk = { id?: string; plan_id: string; kind: "risk" | "assumption"; words: string; likelihood: Level | null; impact: Level | null; mitigation: string | null; evidence: string | null; status: RiskStatus; sort: number };

const W: Record<Level, number> = { low: 1, medium: 2, high: 3 };
/** likelihood × impact, 1–9; null when either isn't rated. */
export const weight = (r: Pick<Risk, "likelihood" | "impact">): number | null => (r.likelihood && r.impact ? W[r.likelihood] * W[r.impact] : null);
/** The open ones that matter most, rated first: an assumption proved wrong is the most urgent of all. */
export function keyRisks(rs: readonly Risk[], n = 3): Risk[] {
  const open = rs.filter((r) => r.status === "open" || r.status === "wrong");
  return [...open].sort((a, b) => (b.status === "wrong" ? 1 : 0) - (a.status === "wrong" ? 1 : 0) || (weight(b) ?? -1) - (weight(a) ?? -1) || a.sort - b.sort).slice(0, n);
}
/** Read as stored; anything unknown falls to a safe value. */
export const toRisk = (r: Record<string, unknown>, planId?: string): Risk => ({
  id: r.id ? String(r.id) : undefined, plan_id: planId ?? String(r.plan_id), kind: r.kind === "assumption" ? "assumption" : "risk", words: String(r.words ?? ""),
  likelihood: (LEVELS as readonly string[]).includes(String(r.likelihood)) ? (r.likelihood as Level) : null,
  impact: (LEVELS as readonly string[]).includes(String(r.impact)) ? (r.impact as Level) : null,
  mitigation: (r.mitigation as string) ?? null, evidence: (r.evidence as string) ?? null,
  status: (Object.keys(RISK_STATUS) as string[]).includes(String(r.status)) ? (r.status as RiskStatus) : "open", sort: Number(r.sort) || 0,
});
