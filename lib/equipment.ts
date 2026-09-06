// EQUIPMENT LIFECYCLE — the state machine behind introducing and retiring gear in a market.
//
// Pure + deterministic (no DOM, no env, no I/O), the same contract lib/markets, lib/delivery and
// lib/orderAhead hold, so this runs identically on the server, in the client UI, and under the
// smoke suite.
//
// WHY A STATE MACHINE AND NOT A BOOLEAN
// Before this, an asset was simply a row that existed until somebody hard-deleted it — and that
// delete CASCADED into asset_maintenance, so "retiring" a piece of equipment silently destroyed the
// record of every service it had ever had. That record is precisely what you want the day the
// second one fails the same way, or the day an inspector asks when the unit was last calibrated.
//
// Equipment does not have an on/off life. It is planned, commissioned into a market, pulled out for
// service, held as a spare, moved to another market, and eventually retired. Each of those is a
// state, each move between them is an event worth keeping, and none of them is a deletion.
//
// RETIRED IS NOT DELETED. Retirement is a state the asset rests in, so the asset, its service log
// and its movement history all survive it. The database refuses the hard delete outright
// (guard_asset_delete, migration 0276) rather than trusting every future caller to remember.

import { type Market } from "./markets";

// ── the states ────────────────────────────────────────────────────────────────────────────────────
export const EQUIPMENT_STATUS = ["planned", "active", "maintenance", "reserve", "retired"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUS)[number];

export const STATUS_LABEL: Record<EquipmentStatus, string> = {
  planned: "Planned",
  active: "In service",
  maintenance: "Out for service",
  reserve: "Spare",
  retired: "Retired",
};

export const STATUS_BLURB: Record<EquipmentStatus, string> = {
  planned: "Ordered or committed to, not yet working in a market.",
  active: "Working in its market. Counts toward what that market can actually run.",
  maintenance: "Temporarily out — being repaired, serviced or calibrated. Still owned, not available.",
  reserve: "On hand and serviceable, deliberately not deployed. The spare you can pull forward.",
  retired: "Permanently out of service. Kept, with its whole history, and never counted as capacity.",
};

// ── legal moves ───────────────────────────────────────────────────────────────────────────────────
// Deliberately strict in one direction and forgiving in the other: anything can be retired (gear
// fails at any point in its life, including before it ever ships), but a retired asset can only come
// back as a spare — never straight back into service — so a reinstatement is always a decision
// someone makes on purpose rather than a slip of a dropdown.
const TRANSITIONS: Record<EquipmentStatus, readonly EquipmentStatus[]> = {
  planned: ["active", "reserve", "retired"],
  active: ["maintenance", "reserve", "retired"],
  maintenance: ["active", "reserve", "retired"],
  reserve: ["active", "maintenance", "retired"],
  retired: ["reserve"], // correction / reinstatement path only
};

export const isEquipmentStatus = (v: unknown): v is EquipmentStatus =>
  typeof v === "string" && (EQUIPMENT_STATUS as readonly string[]).includes(v);

/** Never throws: anything unrecognised reads as `active`, which is what every pre-lifecycle row means. */
export const toStatus = (v: unknown): EquipmentStatus => (isEquipmentStatus(v) ? v : "active");

/** Is this a legal move? A state is never a legal transition to itself. */
export const canTransition = (from: EquipmentStatus, to: EquipmentStatus): boolean =>
  from !== to && TRANSITIONS[from].includes(to);

/** Every state this asset can legally move to right now — the exact set a UI should offer. */
export const nextStates = (from: EquipmentStatus): readonly EquipmentStatus[] => TRANSITIONS[from];

// ── what a state means operationally ──────────────────────────────────────────────────────────────
/** Deployed and counting toward what a market can run today. */
export const isDeployed = (s: EquipmentStatus): boolean => s === "active";
/** Still on the books — owned, insurable, worth maintaining. */
export const isOwned = (s: EquipmentStatus): boolean => s !== "retired";
/** Could be put to work without a repair first. */
export const isServiceable = (s: EquipmentStatus): boolean => s === "active" || s === "reserve";

// ── retirement ────────────────────────────────────────────────────────────────────────────────────
// A disposition is mandatory. "Where did it go" is the question you cannot answer later if nobody
// answered it at the time, and it is the difference between an asset register and a list of names.
export const DISPOSITIONS = ["sold", "scrapped", "returned", "lost", "donated", "replaced"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  sold: "Sold",
  scrapped: "Scrapped",
  returned: "Returned to supplier",
  lost: "Lost or stolen",
  donated: "Donated",
  replaced: "Replaced by newer unit",
};

export const isDisposition = (v: unknown): v is Disposition =>
  typeof v === "string" && (DISPOSITIONS as readonly string[]).includes(v);

export interface RetireInput { disposition?: unknown; reason?: unknown }
export type Validation = { ok: true } | { ok: false; error: string };

/** Retirement is the one transition that demands its paperwork before it will proceed. */
export function validateRetire(input: RetireInput): Validation {
  if (!isDisposition(input.disposition)) return { ok: false, error: "Pick what happened to it — sold, scrapped, returned, lost, donated or replaced." };
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 3) return { ok: false, error: "Add a short reason. In a year this is the only explanation anyone will have." };
  return { ok: true };
}

// ── criticality ───────────────────────────────────────────────────────────────────────────────────
// Not a priority label — an answer to one question: if this is down on a service morning, does the
// market still open? That is what should decide whether a market needs a spare before it launches.
export const CRITICALITY = ["critical", "important", "standard"] as const;
export type Criticality = (typeof CRITICALITY)[number];

export const CRITICALITY_LABEL: Record<Criticality, string> = {
  critical: "Critical — no service without it",
  important: "Important — service is degraded",
  standard: "Standard — inconvenient",
};

export const isCriticality = (v: unknown): v is Criticality =>
  typeof v === "string" && (CRITICALITY as readonly string[]).includes(v);
export const toCriticality = (v: unknown): Criticality => (isCriticality(v) ? v : "standard");

// ── movements ─────────────────────────────────────────────────────────────────────────────────────
// Every market change and every status change is written to asset_movements by a database trigger,
// not by whichever screen happened to make the edit. Provenance that depends on a UI remembering to
// log it is provenance you will discover you don't have at the worst possible moment.
export const MOVEMENT_KINDS = ["commission", "transfer", "status", "retire", "reinstate"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** Classify a change the same way the database trigger does — so UI copy and the ledger agree. */
export function movementKind(
  fromStatus: EquipmentStatus, toStatus: EquipmentStatus, fromMarket: Market | null, toMarket: Market | null
): MovementKind {
  if (toStatus === "retired") return "retire";
  if (fromStatus === "retired") return "reinstate";
  if (fromMarket && toMarket && fromMarket !== toMarket) return "transfer";
  if (fromStatus === "planned" && toStatus !== "planned") return "commission";
  return "status";
}

/** A market's working fleet: what it can actually run, not what it owns. */
export const deployedCount = (statuses: readonly EquipmentStatus[]): number =>
  statuses.filter(isDeployed).length;

/** Gear a market owns but cannot use right now — the honest gap between the two numbers above. */
export const unavailableCount = (statuses: readonly EquipmentStatus[]): number =>
  statuses.filter((s) => isOwned(s) && !isDeployed(s)).length;
