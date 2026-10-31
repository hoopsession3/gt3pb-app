// WHAT AN INVESTOR SEES OF GT3'S INTELLIGENCE (IMS7-F). Only what the investor view already shows, through the insight
// contract, in its fixed vocabulary: the plan's readiness blockers (BLOCKER_WORD — the engine's words, never an owner's
// free-text note), which are still to close and which an owner accepted as a risk, and the readiness stage. Nothing from
// the library, the Studio, the Advisor, money attention or alerts (none is investor-visible — lib/insight visibleTo), and
// no unresolved finding is ever said as a verified claim: a blocker is said as "still to close".
import { fromBlocker, visibleTo, type Insight, type Ref } from "./insight";
import { BLOCKER_WORD, READINESS_WORD, SCORE_METHOD, type Score } from "./visionScore";

export type InvestorReadiness = {
  /** Lower-case blocker names, in the score's order: still to close (open, being worked on, or a lapsed acceptance). */
  open: string[];
  /** Accepted by an owner as a risk (with a reason and a review date, kept with the approved baseline). */
  accepted: string[];
  readiness: string | null;
  /** Only the investor-visible insights, each reduced to fixed words. */
  insights: Pick<Insight, "id" | "rule" | "level" | "words" | "state" | "basis">[];
};

export function investorReadiness(sc: Score, plan: Ref): InvestorReadiness {
  const all = sc.blockers.map((b) => fromBlocker(b, plan, { scoreVersion: sc.method ?? SCORE_METHOD.version, readiness: READINESS_WORD[sc.readiness] }));
  const shown = visibleTo(all, ["investor"]).filter((i) => i.engine === "blocker");
  const word = (i: Insight) => BLOCKER_WORD[i.rule as keyof typeof BLOCKER_WORD] ?? "A readiness blocker";
  return {
    open: shown.filter((i) => i.state !== "risk_accepted").map((i) => word(i).toLowerCase()),
    accepted: shown.filter((i) => i.state === "risk_accepted").map((i) => word(i).toLowerCase()),
    readiness: READINESS_WORD[sc.readiness] ?? null,
    insights: shown.map((i) => ({ id: i.id, rule: i.rule, level: i.level, words: word(i), state: i.state, basis: { version: i.basis.version, asOf: null } })),
  };
}
