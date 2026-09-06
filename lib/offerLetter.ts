// OFFER LETTERS (0281) — an owner writes it, the co-owners approve it, the person signs it.
//
// The shape that matters is the middle step. An operator agreement (0277) goes owner → operator; an
// offer letter goes owner → CO-OWNERS → candidate, because handing someone a title, a salary and a
// database role is a decision the other owners live with too. Nothing reaches the candidate until
// every other owner has said yes, and the record shows who said it and when.
//
// This module is pure and deterministic: the state machine, the approval arithmetic, the validation,
// and the two things that make the letter honest rather than a form — what the chosen ROLE actually
// grants (audited, not guessed) and what the chosen EMPLOYMENT TYPE implies. All covered in
// scripts/smoke.cjs.

import { MARKETS, FOUNDING_MARKET, isMarket, type Market } from "./markets";

// ── the state machine ────────────────────────────────────────────────────────────────────────────
export const OFFER_STATUS = [
  "draft",              // being written; only the author sees it
  "in_review",          // with the co-owners
  "changes_requested",  // a co-owner wants it changed — back to the author
  "approved",           // every required approver said yes; not yet sent
  "sent",               // with the candidate
  "countered",          // the candidate proposed different terms
  "accepted",
  "declined",
  "withdrawn",
  "expired",
] as const;
export type OfferStatus = (typeof OFFER_STATUS)[number];

const TRANSITIONS: Record<OfferStatus, readonly OfferStatus[]> = {
  draft:             ["in_review", "withdrawn"],
  in_review:         ["approved", "changes_requested", "withdrawn"],
  changes_requested: ["draft", "in_review", "withdrawn"],
  approved:          ["sent", "draft", "withdrawn"],   // back to draft = a late edit, and re-approval
  sent:              ["accepted", "declined", "countered", "withdrawn", "expired"],
  countered:         ["draft", "in_review", "withdrawn"],
  accepted:          [],
  declined:          [],
  withdrawn:         [],
  expired:           [],
};

/** Never throws, never returns null — an unknown status reads as a draft, the least privileged. */
export const toOfferStatus = (v: unknown): OfferStatus =>
  (OFFER_STATUS as readonly string[]).includes(v as string) ? (v as OfferStatus) : "draft";

export const nextStatuses = (s: OfferStatus): readonly OfferStatus[] => TRANSITIONS[toOfferStatus(s)];
export const canAdvance = (from: OfferStatus, to: OfferStatus): boolean => nextStatuses(from).includes(to);
export const isTerminal = (s: OfferStatus): boolean => nextStatuses(s).length === 0;
/** Terms are editable only while nobody has committed to them. */
export const isEditable = (s: OfferStatus): boolean =>
  ["draft", "changes_requested", "countered"].includes(toOfferStatus(s));
/** Has the candidate seen it? Governs whether a change needs a fresh approval round. */
export const hasLeftTheBuilding = (s: OfferStatus): boolean =>
  ["sent", "countered", "accepted", "declined", "expired"].includes(toOfferStatus(s));

// ── approvals ────────────────────────────────────────────────────────────────────────────────────
export type Approval = { approver_id: string; decision?: string | null; note?: string | null; at?: string | null };
export type Decision = "approved" | "changes_requested";

export const toDecision = (v: unknown): Decision | null =>
  v === "approved" || v === "changes_requested" ? v : null;

/** Who must approve: every OTHER owner. The author's own signature is the offer, not an approval —
 *  requiring it would let a sole owner rubber-stamp themselves and call it review. */
export function requiredApprovers(ownerIds: readonly string[], authorId: string): string[] {
  return [...new Set(ownerIds.filter((id) => id && id !== authorId))];
}

export function approvalTally(approvals: readonly Approval[]) {
  let approved = 0, changes = 0, pending = 0;
  for (const a of approvals) {
    if (a.decision === "approved") approved++;
    else if (a.decision === "changes_requested") changes++;
    else pending++;
  }
  return { approved, changes, pending, total: approvals.length };
}

/** Unanimous, and one objection is enough to stop it. A split decision among owners is not a
 *  majority problem — it means the offer isn't ready. */
export function approvalOutcome(approvals: readonly Approval[]): "approved" | "changes_requested" | "pending" {
  const t = approvalTally(approvals);
  if (t.changes > 0) return "changes_requested";
  if (t.total > 0 && t.approved === t.total) return "approved";
  return "pending";
}

/** The sole-owner case, stated deliberately rather than left to fall out of the arithmetic: with no
 *  co-owners there is nobody to review, so review is skipped — not silently auto-approved by a
 *  vacuous "all zero approvers agreed". */
export const needsReview = (requiredCount: number): boolean => requiredCount > 0;

// ── what the role actually grants ────────────────────────────────────────────────────────────────
// Audited 2026-09 against the live SQL gates, not inferred from the role's name. The app has seven
// role names and three gates — is_staff() is `role <> 'member'`, so server, contractor, operator and
// event_manager are the SAME principal to the database. An offer letter that names a role should say
// what that role can reach, because that is the part nobody discovers until afterwards.
export type RoleKey = "member" | "server" | "contractor" | "operator" | "event_manager" | "admin" | "owner";

export type RoleAccess = {
  label: string;
  gate: "none" | "staff" | "admin" | "owner";
  reaches: string[];        // plain-language, true today
  cannot: string[];
};

export const ROLE_ACCESS: Record<RoleKey, RoleAccess> = {
  member: { label: "Member", gate: "none",
    reaches: ["Their own orders, packs and loyalty"],
    cannot: ["Anything belonging to anyone else", "The crew console"] },
  server: { label: "Server", gate: "staff",
    reaches: ["The crew console", "Every customer record — name, phone, email, tier",
              "Company revenue, cost and margin reporting", "Expenses and budgets", "Product and merch prices"],
    cannot: ["Assign roles", "Read another person's profile", "Upload shop photos"] },
  contractor: { label: "Contractor", gate: "staff",
    reaches: ["Identical to Server — the database draws no distinction"],
    cannot: ["Assign roles", "Read another person's profile", "Upload shop photos"] },
  operator: { label: "Operator", gate: "staff",
    reaches: ["Identical to Server at the database — including BOTH markets",
              "Their own operator agreement, and the ability to accept or counter it"],
    cannot: ["Assign roles", "Edit their own agreement's terms", "Upload shop photos"] },
  event_manager: { label: "Event manager", gate: "staff",
    reaches: ["Identical to Server — treated as leadership in the app, as a server in the database"],
    cannot: ["Assign roles", "Read another person's profile", "The admin-gated tables the app implies they have"] },
  admin: { label: "Admin", gate: "admin",
    reaches: ["Everything a server reaches", "Read every profile", "Event and product economics",
              "Site copy, KPIs, the changelog", "Draft and send operator agreements"],
    cannot: ["Assign roles — that is owner-only", "Upload shop photos", "Rewrite an accepted agreement"] },
  owner: { label: "Owner", gate: "owner",
    reaches: ["Everything", "Assign roles, including making another owner", "Upload shop photos and video",
              "Approve offer letters"],
    cannot: ["Be the last owner and step down — the database refuses it"] },
};

export const toRoleKey = (v: unknown): RoleKey =>
  Object.prototype.hasOwnProperty.call(ROLE_ACCESS, v as string) ? (v as RoleKey) : "member";

/** Roles you can actually offer someone. Owner is excluded on purpose: making another owner is a
 *  deliberate act through role assignment, never a line item in a letter a candidate signs. */
export const OFFERABLE_ROLES: RoleKey[] =
  ["member", "server", "contractor", "operator", "event_manager", "admin"];

// ── employment type ──────────────────────────────────────────────────────────────────────────────
// The phrase "contract employee" is two different things, and which one it is is decided by how the
// work actually happens — not by what the letter calls it. These are the signals a letter can check
// itself against; they are not legal advice and the module says so at the call site.
export type EmploymentType = "employee" | "contractor";
export const toEmploymentType = (v: unknown): EmploymentType => (v === "contractor" ? "contractor" : "employee");

export type ClassificationFlag = { key: string; says: string; why: string };

/** Terms that pull a "contractor" toward looking like an employee. Returns [] for an employee offer:
 *  the question only exists when the letter claims contractor. */
export function classificationFlags(o: {
  employmentType?: unknown;
  setsSchedule?: boolean;      // we set their hours
  requiresTraining?: boolean;  // our onboarding is mandatory
  suppliesEquipment?: boolean; // we provide the gear
  exclusive?: boolean;         // they can't work for anyone else
  baseCents?: number | null;   // a guaranteed draw regardless of production
}): ClassificationFlag[] {
  if (toEmploymentType(o.employmentType) !== "contractor") return [];
  const f: ClassificationFlag[] = [];
  if (o.setsSchedule) f.push({ key: "schedule", says: "We set the hours",
    why: "Control over when the work happens is one of the two factors weighed most heavily." });
  if (o.requiresTraining) f.push({ key: "training", says: "Our training is mandatory",
    why: "Required company training reads as control over method, not just outcome." });
  if (o.suppliesEquipment) f.push({ key: "equipment", says: "We supply the equipment",
    why: "Who invests in the tools speaks to whether they run their own business." });
  if (o.exclusive) f.push({ key: "exclusive", says: "They can't work for anyone else",
    why: "Exclusivity cuts against an independent trade and limits their own market." });
  if ((o.baseCents ?? 0) > 0) f.push({ key: "guaranteed", says: "There's a guaranteed base",
    why: "No opportunity for loss is the other most heavily weighed factor." });
  return f;
}

// ── the offer itself ─────────────────────────────────────────────────────────────────────────────
export type OfferTerms = {
  candidateName: string;
  candidateEmail: string;
  title: string;
  role: RoleKey;
  market: Market;
  employmentType: EmploymentType;
  baseCents?: number | null;      // annual for employee, or a draw for contractor; null = none
  ratePer?: "year" | "hour" | null;
  commissionPct?: number | null;  // 0..100
  startOn?: string | null;        // yyyy-mm-dd
  reportsTo?: string | null;
  package?: { label: string; included: boolean; note?: string }[];
};

export const money = (cents: number | null | undefined): string =>
  cents == null ? "—" : `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Everything that must be true before this can go to the co-owners. Returns every problem at once —
 *  a form that reveals its objections one at a time wastes the writer's afternoon. */
export function validateOffer(t: Partial<OfferTerms>): { ok: boolean; problems: string[] } {
  const p: string[] = [];
  if (!t.candidateName?.trim()) p.push("Who is this for? Add their name.");
  if (!t.candidateEmail?.trim()) p.push("Add their email — that's how they receive it.");
  else if (!EMAIL_RE.test(t.candidateEmail.trim())) p.push("That email doesn't look right.");
  if (!t.title?.trim()) p.push("Give the role a title.");
  if (!isMarket(t.market)) p.push("Pick which market this is for.");
  if (!OFFERABLE_ROLES.includes(toRoleKey(t.role))) p.push("Pick the access level they'll be given.");
  const base = t.baseCents ?? 0, comm = t.commissionPct ?? 0;
  if (base <= 0 && comm <= 0) p.push("An offer needs pay: a base, a commission, or both.");
  if (base > 0 && !t.ratePer) p.push("Is the base per year or per hour?");
  if (comm < 0 || comm > 100) p.push("Commission has to be between 0 and 100%.");
  if (t.startOn && !/^\d{4}-\d{2}-\d{2}$/.test(t.startOn)) p.push("Start date should be a real date.");
  return { ok: p.length === 0, problems: p };
}

/** One line a person can read back to themselves. Used in the review card and the trail, so a
 *  co-owner approving at a glance sees the same summary the candidate will. */
export function summarize(t: Partial<OfferTerms>): string {
  const parts: string[] = [];
  if (t.title?.trim()) parts.push(t.title.trim());
  if (isMarket(t.market)) parts.push(t.market === FOUNDING_MARKET ? "Greenville" : "Atlanta");
  const base = t.baseCents ?? 0;
  if (base > 0) parts.push(`${money(base)}${t.ratePer === "hour" ? "/hr" : "/yr"}`);
  if ((t.commissionPct ?? 0) > 0) parts.push(`${t.commissionPct}% commission`);
  parts.push(toEmploymentType(t.employmentType) === "contractor" ? "contractor" : "employee");
  return parts.join(" · ");
}

export const emptyOffer = (): OfferTerms => ({
  candidateName: "", candidateEmail: "", title: "", role: "server",
  market: FOUNDING_MARKET, employmentType: "employee",
  baseCents: null, ratePer: "year", commissionPct: null, startOn: null, reportsTo: null,
  package: [
    { label: "Paid training through the GT3 Academy", included: true },
    { label: "Uniform and gear provided", included: true },
    { label: "Mileage reimbursed for market travel", included: false },
    { label: "Phone stipend", included: false },
  ],
});

export { MARKETS, FOUNDING_MARKET };
export type { Market };
