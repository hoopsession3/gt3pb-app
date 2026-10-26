// THE ADVISOR (R61 — Ryan, 2026-10-25: "The system should think several steps ahead… if projected traffic exceeds
// service capacity, recommend operational changes before forecasting additional sales; if rent makes a location
// financially unattractive, flag it before committing to a lease; if customer acquisition costs increase, recalculate
// profitability and recommend alternative channels; if an initiative depends on another unfinished milestone, surface the
// dependency before execution. Prioritize actionable insights over notifications and dashboard clutter.")
//
// Pure. Across every plan with money, a short ranked list of what to do next — each an action, the plan, and the
// arithmetic on that plan's own numbers that says why. Stops first (something that would mislead a decision), then the
// biggest gains the assessments name. Nothing here is a benchmark: rent is flagged when it is what stands between the plan
// and breaking even, not when it passes somebody's percentage.
import { effective, project, type Context, type Inputs, type Model, type Structure } from "./visionMoney";
import { score, type ScoreContext } from "./visionScore";
import { traffic, trafficFlags } from "./visionTraffic";
import { isDue, type Research } from "./visionResearch";
import { keyRisks, type Risk } from "./visionRisks";
import type { Plan } from "./visionPlans";
import { dollars } from "./finance";

export type Advice = { planId: string; plan: string; level: "stop" | "look"; words: string; action: string; gain: number };
export type PlanState = { plan: Plan; i: Inputs; structure: Structure; ctx: Context; research: readonly (Pick<Research, "topic" | "status"> & { bearing?: Research["bearing"]; retrieved_at?: string })[];
  progress: ScoreContext; risks: readonly Risk[]; status: Plan["status"]; waitingOn: readonly string[] };

const STARTING: readonly Plan["status"][] = ["ready", "go", "live"];

export function advise(states: readonly PlanState[], now = Date.now()): Advice[] {
  const out: Advice[] = [];
  for (const s0 of states) {
    const s = { ...s0, i: effective(s0.i) };
    const m: Model = project(s.i, s.structure, s.ctx);
    const P = { planId: s.plan.id, plan: s.plan.name };
    // A dependency before execution: going ahead while what it waits on isn't done.
    if (STARTING.includes(s.status) && s.waitingOn.length)
      out.push({ ...P, level: "stop", gain: 100, words: `It's marked ${s.status} but waits on ${s.waitingOn.join(", ")}, still unfinished.`, action: `Finish ${s.waitingOn[0]} first — or say why this can go without it.` });
    if (!m.ok) continue;
    // Demand past capacity: the room can't take the sales the plan counts on.
    const asked = m.months.reduce((n, x) => n + x.ordersAsked, 0);
    if (m.capPerMonth != null && m.ordersLost > 0)
      out.push({ ...P, level: "stop", gain: 90, words: `The counter can't take ${Math.round((m.ordersLost / Math.max(1, asked)) * 100)}% of the orders the plan asks for — ${dollars(m.salesLost)} over 36 months.`, action: "Add a register or a walk-up window, or time a faster order, before counting those sales." });
    else if (m.capPerMonth == null && s.plan.layout_id)
      out.push({ ...P, level: "look", gain: 30, words: "Its sales aren't checked against what its room can serve.", action: "Turn on The room › At most the counter's to see whether the room can take the plan's orders." });
    // Rent that decides it: without the rent it would break even; with it, it doesn't.
    if (m.breakEvenMonth == null && (s.i.rentCents > 0 || s.i.rentPctOfSales > 0)) {
      const free = project({ ...s.i, rentCents: 0, rentPctOfSales: 0 }, s.structure, s.ctx);
      if (free.ok && free.breakEvenMonth != null)
        out.push({ ...P, level: "stop", gain: 95, words: `The rent is what keeps it from breaking even — without it, it would from month ${free.breakEvenMonth}.`, action: "Negotiate the rent (or a share-of-sales deal), or look at another site, before signing a lease." });
    }
    // A channel that loses money on every guest it brings.
    if (s.i.channels.length && s.i.cogsPct != null) {
      const t = traffic(s.i.channels, { repeatPerMonth: s.i.repeatPerMonth, keptPct: s.i.keptPct }, s.i.avgOrderCents, 100 - s.i.cogsPct - s.i.cardFeePct, s.i.daysOpenPerMonth);
      for (const f of trafficFlags(t, s.i.channels, null, 0).filter((x) => x.level === "stop"))
        out.push({ ...P, level: "stop", gain: 80, words: f.words, action: "Move that channel's spend to the channels that bring guests for less than they're worth." });
    }
    // A risk rated high and high with nothing planned for it; an assumption proved wrong.
    for (const r of keyRisks(s.risks, 5)) {
      if (r.status === "wrong") out.push({ ...P, level: "stop", gain: 85, words: `An assumption proved wrong: ${r.words}`, action: "Change the numbers it fed — the money still counts on it." });
      else if (r.likelihood === "high" && r.impact === "high" && !r.mitigation) out.push({ ...P, level: "look", gain: 60, words: `A likely, costly risk with no plan: ${r.words}`, action: "Write what you'd do about it — or what would tell you early." });
    }
    // Research due again.
    if (isDue(s.plan, now)) out.push({ ...P, level: "look", gain: 20, words: "Its scheduled research check is due.", action: "Open the vision — the check runs on its own — or run it from the plan's Money." });
    // The assessments' own top action.
    const sc = score(s.i, m, s.research, { ...s.progress, now });
    const top = sc.actions[0];
    if (top) out.push({ ...P, level: "look", gain: top.gain, words: `Readiness ${sc.total ?? "—"}: ${sc.readiness === "ready" ? "ready to present" : sc.readiness === "validate" ? "needs validation" : sc.readiness === "not_ready" ? "not ready" : "not judged yet"}.`, action: top.text });
  }
  // Stops first, then what would move the most; one line per plan and action.
  const seen = new Set<string>();
  return out.sort((a, b) => (a.level === b.level ? b.gain - a.gain : a.level === "stop" ? -1 : 1))
    .filter((x) => { const k = `${x.planId}|${x.action}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
