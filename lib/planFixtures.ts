// THE ROOM'S FIXTURES AGAINST THE PLAN (IMS7-D). What the library knows about the things placed in a plan's room — their
// cost with its basis, their size as the library records it, whether GT3 has approved them — set beside the plan's own
// startup costs and the room as drawn. Pure: it reads, compares and says; it never changes a forecast, a line, a size
// or a status.
//
//   COST. Each library asset placed in the room once, however many times it's placed (a count, not a sum of rows), with
//   the library's price and its basis (0470: estimated · listed · quoted · actual · scenario — kept apart, never one sure
//   total). A price per square foot or per gallon can't be multiplied by a count of placements: it needs a quantity.
//   RECONCILED BY A PERSON, NEVER ADDED (Ryan, 2026-10-31). Each asset has a status for this plan's scenario:
//     unreviewed (the default) · its own line (a line names it — UseLine.libraryId) · in the allowance (the plan's
//     Equipment & fixtures already covers it) · incremental (a person confirmed it adds cost) · excluded (not this plan's).
//   Five figures, kept apart: the EXISTING ALLOWANCE (the plan's own Equipment & fixtures lines — visionMoney's lineTotal,
//   the authority); IDENTIFIED asset costs (the library's, by basis); UNKNOWN costs (no price, or needs a quantity);
//   POTENTIAL VARIANCE (what's identified and taken as inside the allowance — unreviewed, in the allowance, its own line —
//   against the allowance); CONFIRMED INCREMENTAL (only what a person marked so). None of them is written into the plan:
//   the plan keeps its number, and an incremental cost is said beside it.
//
//   SIZE. The library's size is the specification (std_materials: set only by an accepted research finding or by a person
//   entering it — never a pending finding). The room's is what was drawn. They're compared RAW, before any rounding for
//   display, and a difference of 1″ or more on a side is material (Ryan, 2026-10-31: the initial threshold for these
//   warnings — it relaxes nothing in the room's own clearance, door-swing, route or work-zone checks, which stay
//   lib/spatial's); a width and depth drawn the other way round (each within 1″) is said as turned, not wrong. The installation footprint and the clearance it needs aren't sizes the library records: the
//   first is said as not recorded, the second belongs to the room's checks (lib/spatial). Nothing is resized.
//
//   APPROVAL. Through the insight contract: an asset short of approved is the library's own insight (lib/insight
//   fromLibrary), and a plan marked ready, go or live with such assets in its room is said once, as a look — advice, since
//   no existing rule stops a plan for it.
import { lineTotal, toInputs, type FixtureRecon, type Inputs, type UseLine } from "./visionMoney";
import { ftIn, type Item, type Layout } from "./vision";
import { fromLibrary, fromSpace, insight, primary, type Insight, type Ref } from "./insight";
import type { Finding } from "./spatial/evaluate";
import type { Asset, CostBasis, Status } from "./experienceLibrary";

export type LibAsset = Pick<Asset, "id" | "name" | "status" | "status_reason" | "cost_cents" | "cost_unit" | "cost_basis" | "w_in" | "d_in" | "h_in">;
export type Placed = Pick<Item, "id" | "kind" | "label" | "w_in" | "d_in" | "h_in"> & { library_id?: string | null };

/** "each", "ea", "unit", "piece" or nothing: a price for one thing, so a count of placements multiplies it. */
const PER_ONE = /^(|each|ea|unit|units|piece|pieces|pc|pcs|one)$/i;
export const perOne = (unit: string | null | undefined): boolean => PER_ONE.test((unit ?? "").trim());

export type FixtureStatus = "unreviewed" | "named_line" | FixtureRecon;
export type FixtureCost = {
  asset: LibAsset; placed: number; itemIds: string[];
  /** How it's reconciled for this scenario; a line naming it wins over a status set beside it (counted once). */
  status: FixtureStatus;
  /** A status set beside a line that names it (incremental or excluded too): said, the line counted once. */
  conflict: FixtureRecon | null;
  unitCents: number | null; unit: string | null; basis: CostBasis | null;
  /** The library's figure for what's placed: unit × count, only for a per-one price. */
  libraryCents: number | null;
  /** Why there's no figure, when there isn't one. */
  noFigure: "no_cost" | "needs_quantity" | null;
  /** The plan's lines that name it, and their total (null when any of them is unpriced). */
  lines: string[]; planCents: number | null;
  /** library − plan, when both are known: what reconciling would move. */
  diffCents: number | null;
};
export type FixtureCosts = {
  rows: FixtureCost[];
  /** Placed things that name no library asset. */
  unlinked: number;
  /** The library's figures by basis, for what's placed and known — kept apart, never one total said as sure. */
  byBasis: Record<CostBasis | "unsaid", number>;
  missing: number; needsQuantity: number;
  inPlan: number; notInPlan: number;
  /** The library's known figure for assets no plan line names: what isn't in the plan's capital yet. */
  notInPlanCents: number;
  /** Plan lines naming an asset that isn't in this room (moved out, or another room's): said, not dropped. */
  strayLines: string[];
  /** Reconciliations kept for assets no longer in this room: said, not counted. */
  strayRecon: string[];
  figures: Figures;
};
/** The five figures, kept apart (cents; null where it can't be said). */
export type Figures = {
  /** The plan's own Equipment & fixtures lines; `unpriced` of them have no price yet. */
  allowance: { cents: number; lines: number; unpriced: number };
  identified: { cents: number; byBasis: Record<CostBasis | "unsaid", number> };
  unknown: number;
  /** identified-and-inside (unreviewed, in the allowance, its own line) − allowance: over (> 0) or within (≤ 0). */
  variance: number | null;
  incremental: number;
};

export function fixtureCosts(placed: readonly Placed[], assets: ReadonlyMap<string, LibAsset>, lines: readonly UseLine[], recon: Readonly<Record<string, FixtureRecon>> = {}): FixtureCosts {
  const groups = new Map<string, string[]>();
  let unlinked = 0;
  for (const p of placed) {
    const id = p.library_id ?? null;
    if (!id || !assets.has(id)) { unlinked++; continue; }
    groups.set(id, [...(groups.get(id) ?? []), p.id]);
  }
  const byBasis: FixtureCosts["byBasis"] = { estimated: 0, listed: 0, quoted: 0, actual: 0, scenario: 0, unsaid: 0 };
  let missing = 0, needsQuantity = 0, inPlan = 0, notInPlan = 0, notInPlanCents = 0;
  const rows: FixtureCost[] = [...groups.entries()].map(([id, itemIds]) => {
    const asset = assets.get(id)!;
    const unitCents = asset.cost_cents ?? null;
    const one = perOne(asset.cost_unit);
    const libraryCents = unitCents != null && one ? unitCents * itemIds.length : null;
    const noFigure: FixtureCost["noFigure"] = unitCents == null ? "no_cost" : !one ? "needs_quantity" : null;
    const mine = lines.filter((l) => l.libraryId === id);
    const totals = mine.map((l) => lineTotal(l));
    const planCents = mine.length && totals.every((t) => t != null) ? totals.reduce((a: number, t) => a + (t as number), 0) : null;
    const set: FixtureRecon | null = recon[id] ?? null;
    const status = (mine.length ? "named_line" : set ?? "unreviewed") as FixtureStatus;
    const conflict = mine.length && set && set !== "in_allowance" ? set : null;
    if (status !== "excluded") {
      if (noFigure === "no_cost") missing++;
      if (noFigure === "needs_quantity") needsQuantity++;
      if (libraryCents != null) byBasis[asset.cost_basis ?? "unsaid"] += libraryCents;
    }
    if (mine.length) inPlan++; else if (status === "unreviewed") { notInPlan++; if (libraryCents != null) notInPlanCents += libraryCents; }
    return { asset, placed: itemIds.length, itemIds, status, conflict, unitCents, unit: asset.cost_unit ?? null, basis: asset.cost_basis ?? null, libraryCents, noFigure,
      lines: mine.map((l) => l.id), planCents, diffCents: libraryCents != null && planCents != null ? libraryCents - planCents : null };
  }).sort((a, b) => a.asset.name.localeCompare(b.asset.name) || a.asset.id.localeCompare(b.asset.id));
  const strayLines = lines.filter((l) => l.libraryId && !groups.has(l.libraryId)).map((l) => l.id);
  const strayRecon = Object.keys(recon).filter((id) => !groups.has(id)).sort();
  const equip = lines.filter((l) => l.category === "equipment");
  const allowance = { cents: equip.reduce((t, l) => t + (lineTotal(l) ?? 0), 0), lines: equip.length, unpriced: equip.filter((l) => lineTotal(l) == null).length };
  const sum = (f: (r: FixtureCost) => boolean) => rows.filter((r) => f(r) && r.libraryCents != null).reduce((t, r) => t + (r.libraryCents as number), 0);
  const inside = sum((r) => r.status === "unreviewed" || r.status === "in_allowance" || r.status === "named_line");
  const figures: Figures = {
    allowance, identified: { cents: sum((r) => r.status !== "excluded"), byBasis }, unknown: missing + needsQuantity,
    variance: rows.some((r) => r.status !== "excluded" && r.status !== "incremental" && r.libraryCents != null) ? inside - allowance.cents : null,
    incremental: sum((r) => r.status === "incremental"),
  };
  return { rows, unlinked, byBasis, missing, needsQuantity, inPlan, notInPlan, notInPlanCents, strayLines, strayRecon, figures };
}

// ── SIZE ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Dim = "w_in" | "d_in" | "h_in";
export type SizeTruth = {
  spec: Record<Dim, number | null>; drawn: Record<Dim, number>;
  /** Differences of 1″ or more (raw), by dimension. */
  differs: Dim[];
  /** Width and depth drawn the other way round (and otherwise the same). */
  turned: boolean;
  /** What the library doesn't say. */
  unknown: Dim[];
  footprint: "not_recorded";
  clearance: "the_room_checks";
};
const DIMS: Dim[] = ["w_in", "d_in", "h_in"];
/** A difference of 1″ or more on a side is material (the initial threshold, Ryan 2026-10-31) — compared raw, never after
 *  the display has rounded both. */
export const SIZE_TOLERANCE_IN = 1;
const sameInch = (a: number, b: number) => Math.abs(a - b) < SIZE_TOLERANCE_IN;

export function sizeTruth(p: Placed, a: LibAsset): SizeTruth {
  const spec = { w_in: a.w_in ?? null, d_in: a.d_in ?? null, h_in: a.h_in ?? null };
  const drawn = { w_in: p.w_in, d_in: p.d_in, h_in: p.h_in };
  const unknown = DIMS.filter((k) => spec[k] == null);
  const off = DIMS.filter((k) => spec[k] != null && !sameInch(spec[k] as number, drawn[k]));
  const turned = spec.w_in != null && spec.d_in != null && off.includes("w_in") && off.includes("d_in")
    && sameInch(spec.w_in, drawn.d_in) && sameInch(spec.d_in, drawn.w_in);
  return { spec, drawn, differs: turned ? off.filter((k) => k === "h_in") : off, turned, unknown, footprint: "not_recorded", clearance: "the_room_checks" };
}

const DIM_WORD: Record<Dim, string> = { w_in: "wide", d_in: "deep", h_in: "tall" };
/** "The library says 8′ wide; drawn 7′." — the words, one dimension at a time. */
export function sizeWords(t: SizeTruth, name: string): string | null {
  if (t.turned && !t.differs.length) return `${name} is drawn turned: the library says ${ftIn(t.spec.w_in!)} wide × ${ftIn(t.spec.d_in!)} deep.`;
  if (!t.differs.length) return null;
  return `${name}: the library says ${t.differs.map((k) => `${ftIn(t.spec[k]!)} ${DIM_WORD[k]}`).join(", ")}; drawn ${t.differs.map((k) => ftIn(t.drawn[k])).join(", ")}.`;
}

// ── INSIGHTS ────────────────────────────────────────────────────────────────────────────────────────────────────────
const STARTING = ["ready", "go", "live"];
export type PlanRef = { id: string; name: string; status: string };

/** What the room's fixtures say about a plan, through the contract: each asset's status (the library's), each size that
 *  differs, each asset not in the plan's capital, what has no cost, and — once — a plan going ahead with assets not yet
 *  approved. Deterministic for the same input. */
export function fixtureInsights(o: { plan: PlanRef; room: Ref; placed: readonly Placed[]; assets: ReadonlyMap<string, LibAsset>; lines: readonly UseLine[];
  blockers?: ReadonlyMap<string, readonly string[]>; pending?: ReadonlyMap<string, number>;
  /** Other plans whose room this is: the same fixtures, so a sum across plans would count them twice — said, once. */
  roomAlsoFor?: readonly string[];
  /** The scenario's reconciliation (Inputs.fixtures). */
  fixtures?: Readonly<Record<string, FixtureRecon>> }): Insight[] {
  const plan: Ref = { kind: "plan", id: o.plan.id, name: o.plan.name };
  const room: Ref = { ...o.room, kind: "layout" };
  const costs = fixtureCosts(o.placed, o.assets, o.lines, o.fixtures ?? {});
  const out: Insight[] = [];
  for (const r of costs.rows) {
    out.push(...fromLibrary(r.asset, { blockers: o.blockers?.get(r.asset.id) ?? [], placedIn: room, pending: o.pending?.get(r.asset.id) ?? 0 })
      .map((i) => ({ ...i, related: [...i.related, plan] })));
    const subject: Ref = { kind: "asset", id: r.asset.id, name: r.asset.name };
    // Only what nobody has reconciled is said as not in the plan: in the allowance, extra, or not this plan's is a person's answer.
    if (r.status === "unreviewed") out.push(insight({
      engine: "library", rule: "not_in_plan", about: o.plan.id, subject, related: [room, plan], native: { scale: "library", value: "not_in_plan" }, level: "look",
      words: `${r.asset.name}${r.placed > 1 ? ` (${r.placed})` : ""} is in the room but not in the plan's startup costs.`,
      action: "Say whether the allowance covers it, it's extra, or it isn't this plan's", go: { section: "plans", anchor: o.plan.id },
      visibility: ["owner", "editor"], mark: `not_in_plan|${r.placed}|${r.libraryCents ?? "?"}`, approval: r.asset.status,
      evidence: r.libraryCents != null ? [{ says: `The library: ${r.basis ?? "basis not said"}`, source: "the library" }] : [],
    }));
    else if (r.diffCents) out.push(insight({
      engine: "library", rule: "cost_differs", about: o.plan.id, subject, related: [room, plan], native: { scale: "library", value: "cost_differs" }, level: "look",
      words: `${r.asset.name}: the library's price and the plan's line differ.`, action: "Reconcile the line — the plan keeps its number until you do",
      go: { section: "plans", anchor: o.plan.id }, visibility: ["owner", "editor"], mark: `cost_differs|${r.diffCents}`, approval: r.asset.status, order: Math.abs(r.diffCents),
    }));
    if (r.conflict) out.push(insight({
      engine: "library", rule: "recon_conflict", about: o.plan.id, subject, related: [room, plan], native: { scale: "library", value: r.conflict }, level: "note",
      words: `${r.asset.name} has its own line and is also marked ${r.conflict === "incremental" ? "extra" : "not this plan's"} — counted once, as its line.`,
      action: "Keep one", go: { section: "plans", anchor: o.plan.id }, visibility: ["owner", "editor"], mark: `conflict|${r.conflict}`,
    }));
    if (r.noFigure && r.status !== "excluded") out.push(insight({
      engine: "library", rule: r.noFigure, about: o.plan.id, subject, related: [room, plan], native: { scale: "library", value: r.noFigure }, level: "note",
      words: r.noFigure === "no_cost" ? `${r.asset.name} has no cost in the library.` : `${r.asset.name} is priced per ${r.unit} — it needs a quantity to count.`,
      action: null, go: { section: "library", anchor: r.asset.id }, visibility: ["owner", "editor"], mark: r.noFigure, approval: r.asset.status,
    }));
    for (const id of r.itemIds) {
      const p = o.placed.find((x) => x.id === id)!;
      const t = sizeTruth(p, r.asset);
      const w = sizeWords(t, p.label || r.asset.name);
      if (w) out.push(insight({
        engine: "library", rule: t.turned && !t.differs.length ? "size_turned" : "size_differs", about: id, subject: { kind: "item", id, name: p.label ?? r.asset.name },
        related: [subject, room], native: { scale: "library", value: "size" }, level: t.turned && !t.differs.length ? "note" : "look", words: w,
        action: "Check it on the drawing — nothing is resized for you", go: { section: "store", anchor: room.id }, visibility: ["member", "owner", "editor"],
        mark: `size|${t.differs.join(",")}|${t.turned}|${DIMS.map((k) => t.spec[k]).join("x")}`,
      }));
    }
  }
  if (o.roomAlsoFor?.length && costs.rows.length) out.push(insight({
    engine: "library", rule: "shared_room", subject: plan, related: [room], native: { scale: "library", value: "shared_room" }, level: "note",
    words: `This room is also ${o.roomAlsoFor.join(", ")}'s — its fixtures belong to one build-out; count them in one plan's startup costs.`,
    action: null, go: { section: "plans", anchor: o.plan.id }, visibility: ["owner", "editor"], mark: `shared|${[...o.roomAlsoFor].sort().join(",")}`,
  }));
  // The allowance: said once, never as a sum written into it.
  if (costs.figures.variance != null && costs.figures.variance > 0) out.push(insight({
    engine: "library", rule: "over_allowance", subject: plan, related: [room], native: { scale: "library", value: "over_allowance" }, level: "look",
    words: "The fixtures identified in its room may cost more than its Equipment & fixtures allowance.",
    action: "Review the allowance against them — the plan keeps its number until you change it", go: { section: "plans", anchor: o.plan.id },
    visibility: ["owner", "editor"], mark: `over|${Math.round(costs.figures.variance / 10000)}`, order: costs.figures.variance,
  }));
  const short = costs.rows.filter((r) => r.asset.status !== "approved" && r.status !== "excluded");
  if (STARTING.includes(o.plan.status) && short.length) out.push(insight({
    engine: "library", rule: "going_unapproved", subject: plan, related: [room, ...short.map((r) => ({ kind: "asset" as const, id: r.asset.id, name: r.asset.name }))],
    native: { scale: "library", value: o.plan.status }, level: "look",
    words: `It's marked ${o.plan.status} with ${short.length} asset${short.length === 1 ? "" : "s"} in its room not approved for GT3.`,
    action: "Approve them, or take them out of the room", go: { section: "library" }, visibility: ["owner", "editor"],
    mark: `going|${short.map((r) => `${r.asset.id}:${r.asset.status as Status}`).sort().join(",")}`,
  }));
  return out;
}

// ── THE STUDIO'S ONE LINE (IMS7-E) ────────────────────────────────────────────────────────────────────────────────────
/** What a thing picked in the Studio says: the one most useful line (the room's checks and the library, through the
 *  contract, the library's word first), how many more, and three short facts — its size against the library, GT3's
 *  approval, its cost in the plans this room belongs to — each only when it's known. */
export function thingSays(o: { item: Placed; room: Pick<Layout, "id" | "name"> & { items: readonly Placed[] }; found: readonly Finding[]; asset: LibAsset | null;
  named: string | null; loaded: boolean; blockers: readonly string[]; pending: number; plans: readonly { plan: PlanRef; base: Inputs }[] }): { top: Insight | null; more: number; all: Insight[]; facts: string[] } {
  const { item, asset } = o;
  const roomRef: Ref = { kind: "layout", id: o.room.id, name: o.room.name };
  const space = o.found.filter((f) => f.ids.includes(item.id)).map((f) => fromSpace(f, roomRef));
  const assets = new Map(asset ? [[asset.id, asset]] : []);
  const here = o.room.items.filter((x) => !!x.library_id && x.library_id === asset?.id);
  // No plan reads this room: the library's own word (status, size) still holds; there's no plan to cost it against.
  const noPlan = { plan: { id: "", name: "", status: "draft" }, base: toInputs({}) };
  const fix: Insight[] = asset ? (o.plans.length ? o.plans : [noPlan]).flatMap(({ plan, base }) =>
    fixtureInsights({ plan, room: roomRef, placed: here, assets, lines: base.uses, fixtures: base.fixtures, blockers: new Map([[asset.id, o.blockers]]), pending: new Map([[asset.id, o.pending]]) })
      .filter((i) => (plan.id ? true : !["not_in_plan", "cost_differs", "going_unapproved", "shared_room"].includes(i.rule))))
    // About this thing: its own size, its asset, the plan going ahead with it — not another placement's size.
    .filter((i) => (i.rule === "size_differs" || i.rule === "size_turned" ? i.subject.id === item.id : true)) : [];
  // The Studio's line (lib/insight primary): ranked by tier, the thing in hand first; another screen's lesser finding
  // (a plan's money look) is never the line here — it waits under "n more".
  const { top, more, all } = primary([...space, ...fix], { surface: "store", subject: item.id, prefer: ["library", "space"] });
  const facts: string[] = [];
  if (asset) {
    const t = sizeTruth(item, asset);
    facts.push(t.unknown.length === 3 ? "Size: not in the library" : t.differs.length ? "Size: differs from the library" : t.turned ? "Size: matches, drawn turned" : "Size: matches the library");
    facts.push(asset.status === "approved" ? (o.blockers.length ? "Approved — judgement no longer complete" : "Approved for GT3") : "Not approved for GT3 yet");
    if (!o.plans.length) facts.push("In no plan yet");
    else {
      // Represented: its own line, inside the allowance, or a confirmed extra — a person's answer, never assumed.
      const st = o.plans.map(({ base }) => fixtureCosts(here, assets, base.uses, base.fixtures ?? {}).rows[0]?.status ?? "unreviewed");
      const counted = st.map((x) => x === "named_line" || x === "in_allowance" || x === "incremental");
      facts.push(counted.every(Boolean) ? "Cost: in the plan" : counted.some(Boolean) ? "Cost: in some plans" : st.every((x) => x === "excluded") ? "Not this plan's" : "Cost: not reviewed in the plan");
    }
  } else if (o.named && o.loaded) facts.push("Its library asset couldn't be found");
  return { top, more, all, facts };
}
