// A PLAN'S ASSESSMENTS (R56 one score; R59 five — Ryan, 2026-10-25: "Market Opportunity… Execution Feasibility…
// Financial Attractiveness… Evidence Confidence… Overall Investment Readiness… 0–100, with documented methodology,
// weighted criteria… Why this score? What evidence supports it? What assumptions are uncertain? What three actions would
// most improve the outcome?… Do not represent these scores as statistical probabilities").
//
// Pure. Each assessment is a handful of criteria, each 0–100 on a rubric written down here, weighted. A criterion with
// nothing to judge it by is left out and said — never a zero by stealth, never a number the model made up. The market is
// judged only from findings a person accepted and said bear for or against the plan (0450's bearing): with none, the
// market isn't scored — it needs validation. Readiness weighs the four and then holds a gate: a plan whose evidence is
// thin or whose market isn't validated is "Needs validation", however good its spreadsheet looks. These are GT3's
// rubrics — not benchmarks, not probabilities; ROI, payback and the investor's return are the money's, beside them.
import { effective, lineTotal, type Inputs, type MetricKey, type Model } from "./visionMoney";
import type { Bearing, Research, Topic } from "./visionResearch";
import { STALE_DAYS } from "./visionResearch";
import { traffic } from "./visionTraffic";

export type AssessKey = "market" | "execution" | "financial" | "evidence";
export type CriterionKey =
  | "demandSupport" | "channelsCover"
  | "needsDone" | "noBlockers" | "roomServes" | "staffCovers"
  | "payback" | "breakEven" | "roi" | "conservativeHolds"
  | "costs" | "researchDepth" | "researchFresh" | "researchReviewed";
export type Criterion = { key: CriterionKey; label: string; weight: number; points: number | null; says: string; rubric: string; about: MetricKey | null; action: string };
export type Assessment = { key: AssessKey; label: string; score: number | null; criteria: Criterion[]; why: string; evidence: string[]; uncertain: string[] };
// IP1.4 (Ryan, 2026-10-28: "Acknowledgment alone must not count as resolution… Define these classifications through
// explicit governance criteria, not an arbitrary score threshold… Version all scoring methodologies").
/** The method this score is worked out by. A change to the rubric, the weights or the stages gets a new version. */
export const SCORE_METHOD = {
  version: "2026-10-28.1",
  summary: "Four assessments (market 25, execution 25, finances 30, evidence 20), each a set of weighted criteria on written rubrics. A criterion with nothing to judge it by is left out of the score and counted against coverage. The stage comes from the blockers and the finances, never from the score.",
  changes: [
    { version: "2026-10-27.1", what: "Score over judged criteria only; coverage counted criterion by criterion; critical blockers (IP1.3)." },
    { version: "2026-10-28.1", what: "Blocker lifecycle; an owner's acknowledgement is a risk acceptance with a reason and a review date, never a resolution; stages by policy, not by score (IP1.4)." },
  ],
} as const;
/** The stage a plan is at — set by policy (STAGE_POLICY), not by the score. */
export type Readiness = "complete" | "discussion" | "internal" | "not_ready" | "unknown";
export const READINESS_WORD: Record<Readiness, string> = {
  complete: "Diligence complete", discussion: "Ready for investor discussion, with limitations disclosed",
  internal: "Ready for internal review", not_ready: "Not ready", unknown: "Not judged yet" };
export const STAGE_POLICY: Record<Exclude<Readiness, "unknown">, string> = {
  not_ready: "The finances or the execution assess below 40 — a weakness the numbers show, whatever the evidence.",
  internal: "At least one critical blocker is open, being worked on, waiting to be checked, or its accepted risk has lapsed.",
  discussion: "Every critical blocker is either resolved or accepted as a risk by an owner, with a reason and a review date — and investors see each accepted risk.",
  complete: "No critical blocker at all: demand validated, a downside case run, every startup cost priced, every input filled in, nothing waited on.",
};
/** IP1.3 — what must be resolved before a plan goes to investors; IP1.4 — and where each one stands. */
export type BlockerKey = "demand_unvalidated" | "evidence_against" | "no_downside" | "costs_unpriced" | "inputs_missing" | "waiting_on";
export type BlockerKind = "unvalidated demand" | "conflicting evidence" | "missing downside" | "incomplete assumptions" | "unfinished dependency";
export type BlockerStatus = "open" | "in_remediation" | "pending_verification" | "risk_accepted" | "acceptance_lapsed";
export const BLOCKER_STATUS_WORD: Record<BlockerStatus, string> = {
  open: "Open", in_remediation: "In remediation", pending_verification: "Pending verification", risk_accepted: "Risk accepted", acceptance_lapsed: "Acceptance lapsed" };
/** An owner's risk acceptance, stored with the approved baseline (owners only — 0449's guard). A reason and a review date
 *  are both required; without either it isn't an acceptance. Investors on a link always see it. */
export type Acknowledgement = { key: string; note: string; at?: string | null; reviewBy?: string | null };
/** The plan's own needs, as the remediation workflow (vision_plan_needs): a need whose note is `blocker:<key>` works on that blocker. */
export type NeedRef = { label: string; owner: string | null; due_on: string | null; done_on: string | null; note: string | null };
export type Remedy = { criterion: string; missing: string; section: string; action: string; acceptance: string; verifier: string };
export type Blocker = { key: BlockerKey; kind: BlockerKind; says: string; effect: string; criterion: CriterionKey | null;
  status: BlockerStatus; acknowledged: Acknowledgement | null; need: NeedRef | null; remedy: Remedy };
export const BLOCKER_WORD: Record<BlockerKey, string> = {
  demand_unvalidated: "Demand isn't validated", evidence_against: "Research weighs against the plan", no_downside: "No downside case",
  costs_unpriced: "Startup costs not priced", inputs_missing: "Inputs missing", waiting_on: "Waits on another plan" };
/** What closes each blocker, and who says it's closed. Written down here, the same for every plan. */
export const REMEDY: Record<BlockerKey, Remedy> = {
  demand_unvalidated: { criterion: "What the market's sources say", missing: "Accepted research on demand, competition, the location or trends, marked for or against the plan", section: "Research", action: "Add market evidence", acceptance: "At least one such finding accepted and marked for or against", verifier: "An owner or admin accepts the finding" },
  evidence_against: { criterion: "What the market's sources say", missing: "An answer to each accepted finding against the plan", section: "Research and risks", action: "Answer the findings against", acceptance: "Each finding answered by a change to the plan, or accepted as a risk with a reason", verifier: "An owner" },
  no_downside: { criterion: "Conservative still breaks even", missing: "A Conservative scenario", section: "Money · scenarios", action: "Create the downside case", acceptance: "The Conservative scenario filled in and approved with the baseline", verifier: "An owner approves the baseline" },
  costs_unpriced: { criterion: "Startup costs priced and sure", missing: "A price on every startup line", section: "Money · what the money buys", action: "Price the missing startup cost", acceptance: "Every startup line priced, and approved with the baseline", verifier: "An owner approves the baseline" },
  inputs_missing: { criterion: "All", missing: "The inputs the money needs", section: "Money", action: "Fill in the missing inputs", acceptance: "The money works out", verifier: "An owner approves the baseline" },
  waiting_on: { criterion: "Nothing it waits on is unfinished", missing: "The plans it waits on, underway or live", section: "The plan · waits on", action: "Move what it waits on forward", acceptance: "Each plan it waits on is underway or live", verifier: "The roadmap's status" },
};
export const needNoteFor = (k: BlockerKey) => `blocker:${k}`;
export type Score = {
  /** Assessed readiness score, 0–100, on the criteria that can be judged (null until the money is set). Not the same as
   *  being ready: the stage (readiness) says that, by policy. */
  total: number | null; readiness: Readiness; says: string;
  /** Evidence coverage, 0–100: the share of the score's weight (criterion by criterion) that has something to judge it by. */
  coverage: number;
  /** Critical readiness blockers, each with where it stands and what closes it. */
  blockers: Blocker[];
  /** Blockers not resolved and not under a live risk acceptance. */
  open: number;
  /** The method version this was worked out by. */
  method: string;
  assessments: Record<AssessKey, Assessment>;
  /** The three changes that would raise the outcome most, each with the criterion it moves. */
  actions: { text: string; criterion: CriterionKey; gain: number }[];
};
/** What the plan's money alone can't say: its needs, what it waits on, its Conservative run. */
export type ScoreContext = { needs?: { done: number; all: number }; waitingOn?: readonly string[];
  /** The Conservative run beside a Base: null when it isn't set (a missing downside); left out where it doesn't apply. */
  conservative?: Model | null; now?: number;
  /** Owner risk acceptances, stored with the approved baseline (only an owner can write it — 0449's guard). */
  acknowledged?: readonly Acknowledgement[];
  /** The plan's needs, to see which blockers are being worked on (IP1.4). */
  needList?: readonly NeedRef[] };
type Finding = Pick<Research, "topic" | "status"> & { bearing?: Bearing | null; retrieved_at?: string };

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const CONF_POINTS = { quoted: 100, estimated: 60, guess: 20 } as const;
const MARKET: readonly Topic[] = ["demand", "competition", "location", "trends"];
export const ASSESS_WEIGHT: Record<AssessKey, number> = { market: 25, execution: 25, financial: 30, evidence: 20 };
export const ASSESS_WORD: Record<AssessKey, string> = { market: "Market opportunity", execution: "Execution feasibility", financial: "Financial attractiveness", evidence: "Evidence confidence" };

function weigh(key: AssessKey, criteria: Criterion[], evidence: string[], uncertain: string[]): Assessment {
  const live = criteria.filter((c) => c.points != null);
  const w = live.reduce((n, c) => n + c.weight, 0);
  const score = w > 0 ? clamp(live.reduce((n, c) => n + c.points! * c.weight, 0) / w) : null;
  const left = criteria.filter((c) => c.points == null).map((c) => c.label.toLowerCase());
  const why = score == null ? `Not scored — ${criteria.map((c) => c.says).find((s) => s) ?? "nothing to judge it by yet"}`
    : `${score} on ${live.length} of ${criteria.length} criteria${left.length ? ` (not judged: ${left.join(", ")})` : ""}. Lowest: ${[...live].sort((a, b) => a.points! - b.points!)[0].label.toLowerCase()}.`;
  return { key, label: ASSESS_WORD[key], score, criteria, why, evidence, uncertain };
}

export function score(raw: Inputs, m: Model, research: readonly Finding[] = [], ctx: ScoreContext = {}): Score {
  const now = ctx.now ?? Date.now();
  const i = effective(raw);
  const accepted = research.filter((r) => r.status === "accepted");
  const rev = m.ok ? m.months.reduce((n, x) => n + x.revenue, 0) : 0;

  // ── market: only from accepted findings a person said bear for or against ──
  const marketFound = accepted.filter((r) => MARKET.includes(r.topic) && (r.bearing === "for" || r.bearing === "against"));
  const forN = marketFound.filter((r) => r.bearing === "for").length, againstN = marketFound.length - forN;
  // Typed demand checked against the channels set beside it (when the channels ARE the demand, there's nothing to check).
  const plannedPerDay = i.demandFrom === "channels" ? null : i.ordersPerDay;
  const tr = i.demandFrom === "typed" && i.channels.length && i.cogsPct != null ? traffic(i.channels, { repeatPerMonth: i.repeatPerMonth, keptPct: i.keptPct }, i.avgOrderCents, 100 - i.cogsPct - i.cardFeePct, i.daysOpenPerMonth) : null;
  const channelsPerDay = tr?.ok ? tr.perDay12 : null;
  const market = weigh("market", [
    { key: "demandSupport", label: "What the market's sources say", weight: 70, about: null,
      rubric: "Accepted findings on demand, competition, the location and trends that a person marked for or against the plan: the share for, as a percentage. None marked — not judged.",
      points: marketFound.length ? clamp((forN / marketFound.length) * 100) : null,
      says: marketFound.length ? `${forN} finding${forN === 1 ? "" : "s"} for it, ${againstN} against.` : "No accepted research marked for or against it — the market needs validating.",
      action: marketFound.length && againstN ? "Answer the findings that weigh against the plan — or change the plan where they're right." : "Research the market and mark each accepted finding for or against the plan." },
    { key: "channelsCover", label: "The channels bring the plan's orders", weight: 30, about: "revenue",
      rubric: "Orders a day the traffic channels bring by month 12, against the orders a day the plan counts on (100 at or above). Judged when both are set.",
      points: channelsPerDay != null && plannedPerDay ? clamp((channelsPerDay / plannedPerDay) * 100) : null,
      says: channelsPerDay != null && plannedPerDay ? `The channels bring ${Math.round(channelsPerDay * 10) / 10} a day of the ${plannedPerDay} the plan counts on.` : "",
      action: "Set the traffic channels so they bring the orders the plan counts on — or plan for the orders they bring." },
  ], marketFound.map((r) => `${r.bearing === "for" ? "For" : "Against"}: a ${r.topic} finding`), marketFound.length ? [] : ["Whether people there want it — no source has been read and marked yet."]);

  // ── execution ──
  const needs = ctx.needs;
  const lostShare = m.ok && rev + m.salesLost > 0 ? m.salesLost / (rev + m.salesLost) : 0;
  const staffShort = i.staffHoursPerDay != null && i.hoursOpenPerDay ? i.staffHoursPerDay / i.hoursOpenPerDay : null;
  const execution = weigh("execution", [
    { key: "needsDone", label: "Its needs, done", weight: 30, about: null,
      rubric: "Needs marked done ÷ needs listed. No needs listed — not judged.",
      points: needs && needs.all > 0 ? clamp((needs.done / needs.all) * 100) : null,
      says: needs && needs.all > 0 ? `${needs.done} of ${needs.all} needs done.` : "No needs listed for it.",
      action: "Close the next open need on the plan — financing, the site, the permit, the build." },
    { key: "noBlockers", label: "Nothing it waits on is unfinished", weight: 25, about: null,
      rubric: "100 when every plan it waits on is underway or live; 0 when one isn't.",
      points: ctx.waitingOn ? (ctx.waitingOn.length ? 0 : 100) : null,
      says: ctx.waitingOn?.length ? `Waits on ${ctx.waitingOn.join(", ")}.` : ctx.waitingOn ? "Waits on nothing unfinished." : "",
      action: `Finish what it waits on first${ctx.waitingOn?.length ? ` — ${ctx.waitingOn[0]}` : ""}.` },
    { key: "roomServes", label: "The room can serve it", weight: 25, about: "revenue",
      rubric: "Sales the counter can't take, as a share of what the plan asks: none = 100, a fifth or more = 0. Judged when sales are capped by the room.",
      points: !m.ok || m.capPerMonth == null ? null : clamp(100 - lostShare * 500),
      says: !m.ok || m.capPerMonth == null ? "" : m.salesLost > 0 ? `${Math.round(lostShare * 100)}% of the sales asked for are past the counter.` : "The counter takes every order the plan asks for.",
      action: "Add a register or a walk-up window (or time a faster order) so the room takes the orders the plan asks for." },
    { key: "staffCovers", label: "Someone's on every hour it's open", weight: 20, about: "operatingExpenses",
      rubric: "Staff hours a day ÷ hours open, as a percentage (100 at one person every hour or more).",
      points: staffShort == null ? null : clamp(staffShort * 100),
      says: staffShort == null ? "" : staffShort >= 1 ? "Staffed every hour it's open." : `Staffed for ${Math.round(staffShort * 100)}% of the hours it's open.`,
      action: "Add staff hours to cover every hour open — the money will say what that costs." },
  ], [needs && needs.all ? `${needs.done}/${needs.all} needs done` : "", m.capPerMonth != null ? "Capacity from the room as drawn (simulated)" : ""].filter(Boolean),
    [m.capPerMonth == null ? "Whether the room can serve the plan's orders — cap sales by the room to check." : "", "Flow's timings are assumed until timed on the truck."].filter(Boolean));

  // ── financial ──
  const roiPct = m.roiBusiness == null ? null : m.roiBusiness * 100;
  const financial = weigh("financial", [
    { key: "payback", label: "Earns back its startup", weight: 35, about: "payback",
      rubric: "Month 6 or sooner = 100; month 36 or not within 36 = 0; straight between. Before the investor.",
      points: !m.ok || m.startupSpend <= 0 ? null : m.paybackMonth == null ? 0 : clamp(100 - ((m.paybackMonth - 6) * 100) / 30),
      says: !m.ok ? "The money isn't set yet." : m.startupSpend <= 0 ? "No startup spending to earn back." : m.paybackMonth == null ? "Doesn't earn back its startup within 36 months." : `Earns back its startup in month ${m.paybackMonth}.`,
      action: "Bring payback forward: lower the startup lines that aren't quoted yet, or raise the average order." },
    { key: "breakEven", label: "Carries itself", weight: 25, about: "breakEven",
      rubric: "Breaks even (and stays there) from month 1 = 100; month 24 or not within 36 = 0; straight between.",
      points: !m.ok ? null : m.breakEvenMonth == null ? 0 : clamp(100 - ((m.breakEvenMonth - 1) * 100) / 23),
      says: !m.ok ? "" : m.breakEvenMonth == null ? "Doesn't break even within 36 months." : `Breaks even from month ${m.breakEvenMonth}.`,
      action: "Reach break-even sooner: the biggest monthly cost first (What moves it most)." },
    { key: "roi", label: "Business ROI, 36 months", weight: 20, about: "roiBusiness",
      rubric: "Business-level, before financing: 0% or less = 0; 200% or more = 100; straight between.",
      points: roiPct == null ? null : clamp(roiPct / 2),
      says: roiPct == null ? "" : `${Math.round(roiPct)}% over 36 months, before financing and tax.`,
      action: "Lift the 36-month return: the driver at the top of What moves it most." },
    { key: "conservativeHolds", label: "Conservative still breaks even", weight: 20, about: "breakEven",
      rubric: "100 when the Conservative scenario breaks even within 36 months; 0 when it doesn't. Judged when Conservative is set.",
      points: ctx.conservative?.ok ? (ctx.conservative.breakEvenMonth != null ? 100 : 0) : null,
      says: ctx.conservative?.ok ? (ctx.conservative.breakEvenMonth != null ? `Conservative breaks even from month ${ctx.conservative.breakEvenMonth}.` : "Conservative doesn't break even within 36 months.") : "",
      action: "Make the Conservative case hold: a smaller first phase, a lower rent, or a revenue-share deal." },
  ], [m.ok ? "The plan's own numbers, through the one engine" : ""].filter(Boolean), ["Every input is an assumption until it's quoted or observed."]);

  // ── evidence ──
  const lines = i.uses.filter((l) => l.category !== "reserve");
  const priced = lines.filter((l) => lineTotal(l) != null);
  const dollars = priced.reduce((n, l) => n + Math.max(0, lineTotal(l)!), 0);
  const sure = dollars > 0 ? priced.reduce((n, l) => n + Math.max(0, lineTotal(l)!) * (l.confidence ? CONF_POINTS[l.confidence] : 0), 0) / dollars : 0;
  const share = lines.length ? priced.length / lines.length : 0;
  const fresh = accepted.filter((r) => r.retrieved_at && (now - Date.parse(r.retrieved_at)) / 86_400_000 <= STALE_DAYS).length;
  const reviewed = research.filter((r) => r.status !== "proposed").length;
  const evidence = weigh("evidence", [
    { key: "costs", label: "Startup costs priced and sure", weight: 35, about: "startupSpend",
      rubric: "The startup dollars weighted by how sure each line is (quoted 100, estimated 60, a guess 20, not said 0), × the share of lines priced.",
      points: lines.length ? clamp(sure * share) : 0,
      says: !lines.length ? "No startup lines yet." : `${Math.round(share * 100)}% of the lines priced; ${priced.filter((l) => l.confidence === "quoted").length} quoted.`,
      action: "Get quotes for the biggest startup lines still estimated or guessed." },
    { key: "researchDepth", label: "Accepted research", weight: 35, about: null,
      rubric: "Accepted findings: none = 0, one = 30, two = 55, three = 75, four = 90, five or more = 100.",
      points: [0, 30, 55, 75, 90, 100][Math.min(5, accepted.length)],
      says: `${accepted.length} accepted finding${accepted.length === 1 ? "" : "s"}.`,
      action: "Run the research and accept the findings whose sources hold up." },
    { key: "researchFresh", label: "Research read in the last 90 days", weight: 15, about: null,
      rubric: "Accepted findings read within 90 days ÷ accepted findings. None accepted — not judged.",
      points: accepted.length ? clamp((fresh / accepted.length) * 100) : null,
      says: accepted.length ? `${fresh} of ${accepted.length} read within ${STALE_DAYS} days.` : "",
      action: "Run the research again — some of what it read is older than 90 days." },
    { key: "researchReviewed", label: "Research reviewed", weight: 15, about: null,
      rubric: "Findings accepted or rejected ÷ findings proposed. None proposed — not judged.",
      points: research.length ? clamp((reviewed / research.length) * 100) : null,
      says: research.length ? `${reviewed} of ${research.length} findings reviewed.` : "",
      action: "Review the proposed findings — accept what the source says, reject what it doesn't." },
  ], [`${priced.filter((l) => l.confidence === "quoted").length} quoted cost line${priced.filter((l) => l.confidence === "quoted").length === 1 ? "" : "s"}`, `${accepted.length} accepted finding${accepted.length === 1 ? "" : "s"}`],
    [lines.length - priced.length > 0 ? `${lines.length - priced.length} startup line${lines.length - priced.length === 1 ? "" : "s"} not priced.` : ""].filter(Boolean));

  const assessments = { market, execution, financial, evidence };
  const keys = Object.keys(assessments) as AssessKey[];
  // IP1.3 (Ryan, 2026-10-27: "without conflating missing evidence with demonstrated business weakness… Do not arbitrarily
  // change scoring weights"). Each criterion carries its share of its assessment's weight — the same weights as before.
  // The score is the weighted mean of the criteria that are judged; coverage is the weight that is. S1.1c counted an
  // unjudged assessment as zero, which read missing research as a weak business; what it guarded against (one strong
  // assessment and three unknowns reading as ready) is held now by coverage and the blockers, not by a zero.
  const ew = (k: AssessKey, c: Criterion) => (c.weight / assessments[k].criteria.reduce((n, x) => n + x.weight, 0)) * ASSESS_WEIGHT[k];
  const allW = keys.reduce((n, k) => n + ASSESS_WEIGHT[k], 0);
  const judged = keys.flatMap((k) => assessments[k].criteria.filter((c) => c.points != null).map((c) => ({ w: ew(k, c), p: c.points! })));
  const judgedW = judged.reduce((n, x) => n + x.w, 0);
  const coverage = Math.round((judgedW / allW) * 100);
  const total = m.ok && judgedW > 0 ? clamp(judged.reduce((n, x) => n + x.p * x.w, 0) / judgedW) : null;
  const weightOf = (key: CriterionKey) => { for (const k of keys) { const c = assessments[k].criteria.find((x) => x.key === key); if (c) return Math.round(ew(k, c)); } return 0; };
  // ── the blockers: each says what it is and what it does to the result ──
  const acks = ctx.acknowledged ?? [];
  const found: Omit<Blocker, "acknowledged" | "status" | "need" | "remedy">[] = [];
  const unsupported = accepted.filter((r) => MARKET.includes(r.topic) && r.bearing !== "for" && r.bearing !== "against").length;
  if (!marketFound.length) found.push({ key: "demand_unvalidated", kind: "unvalidated demand", criterion: "demandSupport",
    says: accepted.length ? `${accepted.length} accepted finding${accepted.length === 1 ? "" : "s"}, but none marked for or against the plan${unsupported ? ` (${unsupported} on the market left unmarked)` : ""} — demand is still an assumption.` : "No accepted research says whether people there want it — demand is an assumption.",
    effect: `"What the market's sources say" isn't judged: ${weightOf("demandSupport")} of 100 points of weight wait on it, so coverage can't pass ${100 - weightOf("demandSupport")}%.` });
  if (againstN > 0) found.push({ key: "evidence_against", kind: "conflicting evidence", criterion: "demandSupport",
    says: `${againstN} accepted finding${againstN === 1 ? "" : "s"} weigh${againstN === 1 ? "s" : ""} against the plan, ${forN} for it.`,
    effect: `What the market's sources say scores ${market.criteria[0].points}/100. Answer each one against — or change the plan where it's right.` });
  if (ctx.conservative !== undefined && !ctx.conservative?.ok) found.push({ key: "no_downside", kind: "missing downside", criterion: "conservativeHolds",
    says: "The plan hasn't been run with lower sales — there's no Conservative case.",
    effect: `"Conservative still breaks even" isn't judged: ${weightOf("conservativeHolds")} of 100 points of weight wait on it.` });
  const unpriced = lines.length - priced.length;
  if (unpriced > 0) found.push({ key: "costs_unpriced", kind: "incomplete assumptions", criterion: "costs",
    says: `${unpriced} startup line${unpriced === 1 ? "" : "s"} not priced — the opening cost is understated by whatever ${unpriced === 1 ? "it costs" : "they cost"}.`,
    effect: `Counted in the score: "Startup costs priced and sure" is ${evidence.criteria[0].points}/100, and every figure built on the opening cost leaves ${unpriced === 1 ? "it" : "them"} out.` });
  if (m.missing?.length) found.push({ key: "inputs_missing", kind: "incomplete assumptions", criterion: null,
    says: `Not filled in: ${m.missing.join(", ")}.`, effect: "The money can't be worked out until they are, so nothing is scored." });
  if (ctx.waitingOn?.length) found.push({ key: "waiting_on", kind: "unfinished dependency", criterion: "noBlockers",
    says: `Waits on ${ctx.waitingOn.join(", ")}.`, effect: `"Nothing it waits on is unfinished" scores 0/100 until ${ctx.waitingOn.length === 1 ? "it's" : "they're"} underway.` });
  const today = new Date(now).toISOString().slice(0, 10);
  const blockers: Blocker[] = found.map((b) => {
    const ack = acks.find((a) => a.key === b.key && a.note.trim() && a.reviewBy) ?? null;
    const need = (ctx.needList ?? []).find((n) => n.note === needNoteFor(b.key)) ?? null;
    // Acknowledging is never resolving: a blocker that's still true stays listed. An acceptance holds until its review date.
    const status: BlockerStatus = ack ? (ack.reviewBy! < today ? "acceptance_lapsed" : "risk_accepted")
      : need ? (need.done_on ? "pending_verification" : "in_remediation") : "open";
    return { ...b, acknowledged: ack, need, status, remedy: REMEDY[b.key] };
  });
  const open = blockers.filter((b) => b.status !== "risk_accepted").length;
  // The stage, by policy (STAGE_POLICY) — not by the score. A weakness the numbers show → not ready; a blocker not
  // resolved and not under a live acceptance → internal review; every one accepted → investor discussion, disclosed;
  // none at all → diligence complete.
  const readiness: Readiness = total == null ? "unknown"
    : (financial.score ?? 0) < 40 || (execution.score ?? 100) < 40 ? "not_ready"
    : open > 0 ? "internal" : blockers.length > 0 ? "discussion" : "complete";
  // The three actions that would raise readiness most: each criterion's room to rise × its weight in its assessment ×
  // the assessment's weight. An unjudged market criterion counts as all room to rise — validating it is the step.
  const actions = keys.flatMap((k) => {
    const a = assessments[k], cw = a.criteria.reduce((n, c) => n + c.weight, 0);
    return a.criteria.filter((c) => (c.points ?? (k === "market" ? 0 : null)) != null && (c.points ?? 0) < 100)
      .map((c) => ({ text: c.action, criterion: c.key, gain: Math.round(((100 - (c.points ?? 0)) * (c.weight / cw) * ASSESS_WEIGHT[k]) / 100) }));
  }).sort((a, b) => b.gain - a.gain).slice(0, 3);
  const acceptedN = blockers.length - open;
  return { total, coverage, readiness, assessments, actions, blockers, open, method: SCORE_METHOD.version,
    says: total == null ? "Set the money to see the assessment." : `${READINESS_WORD[readiness]}. Assessed score ${total} of 100 on what can be judged, with evidence for ${coverage}% of the weight — not the same as being ready. ${open ? `${open} critical blocker${open === 1 ? "" : "s"} still to close` : blockers.length ? "Every critical blocker is accepted as a risk" : "No critical blockers"}${open && acceptedN ? `; ${acceptedN} accepted as a risk` : ""}. GT3's written rubrics, not a probability of success.` };
}
