// Load-Out & Tow Plan math. Item weights are ESTIMATES for planning the load — not
// certified scale weights. The trailer/tow numbers come from the cert plate (0037).

export interface TrailerProfile {
  id: number; name: string | null; maker: string | null; size_label: string | null;
  gvwr_lb: number | null; empty_lb: number | null; cargo_cap_lb: number | null;
  axle: string | null; tire_spec: string | null; tire_psi: number | null;
  tow_vehicle: string | null; tow_rating_lb: number | null; tongue_limit_lb: number | null;
  vin: string | null; notes: string | null;
  // interior space (0105) — the packable box, so the load-out understands volume not just weight
  interior_len_in?: number | null; interior_width_in?: number | null; interior_height_in?: number | null; usable_pct?: number | null;
  veh_cargo_len_in?: number | null; veh_cargo_width_in?: number | null; veh_cargo_height_in?: number | null; veh_usable_pct?: number | null;
}

// Estimated gear weights (lb) by keyword — heaviest first wins on overlap.
const WEIGHTS: { match: string; lb: number }[] = [
  { match: "water jug", lb: 150 }, { match: "potable water", lb: 150 },
  { match: "cold-brew keg", lb: 120 }, { match: "keg", lb: 120 },
  { match: "ecoflow", lb: 99 }, { match: "bottle inventory", lb: 80 },
  { match: "canopy", lb: 80 }, { match: "ice", lb: 80 }, { match: "generator", lb: 75 },
  { match: "nitrogen tank", lb: 55 }, { match: "broth", lb: 50 }, { match: "handwash", lb: 40 },
  { match: "nature aid", lb: 40 }, { match: "salted maple", lb: 40 },
  { match: "bottles + lids", lb: 25 }, { match: "cooler", lb: 25 }, { match: "shore-power", lb: 20 },
  { match: "faucet kit", lb: 10 }, { match: "regulator", lb: 5 },
  { match: "kds tablet", lb: 2 }, { match: "square reader", lb: 1 },
];

export function weightFor(label: string): number {
  const l = label.toLowerCase();
  for (const w of WEIGHTS) if (l.includes(w.match)) return w.lb;
  return 0; // unknown / paperwork (permits, COI) = no load weight
}

export interface LoadoutItem { label: string; lb: number; zone: "nose" | "axle" | "tail" }
export interface Loadout {
  items: LoadoutItem[]; cargoLb: number; totalLb: number;
  tongueLb: number; tonguePct: number; overCargo: boolean;
}

// Heaviest items ride over the axle / nose to keep ~10-15% tongue weight; light to the tail.
export function computeLoadout(taskLabels: string[], p: TrailerProfile): Loadout {
  const weighed = taskLabels.map((label) => ({ label, lb: weightFor(label) }))
    .filter((x) => x.lb > 0).sort((a, b) => b.lb - a.lb);
  const cargoLb = weighed.reduce((s, x) => s + x.lb, 0);
  const empty = p.empty_lb ?? 1300;
  const totalLb = empty + cargoLb;
  const third = Math.ceil(weighed.length / 3) || 1;
  const items: LoadoutItem[] = weighed.map((x, i) => ({
    ...x, zone: i < third ? "axle" : i < third * 2 ? "nose" : "tail",
  }));
  const tonguePct = 12;
  const tongueLb = Math.round((totalLb * tonguePct) / 100);
  return { items, cargoLb, totalLb, tongueLb, tonguePct, overCargo: !!p.cargo_cap_lb && cargoLb > p.cargo_cap_lb };
}

export type Level = "ok" | "warn" | "over";
export const level = (used: number, limit: number): Level =>
  used / limit > 1 ? "over" : used / limit > 0.85 ? "warn" : "ok";

export interface TowCheck { label: string; used: number; limit: number; level: Level }
export function towChecks(lo: Loadout, p: TrailerProfile): TowCheck[] {
  const out: TowCheck[] = [];
  if (p.gvwr_lb) out.push({ label: "Loaded vs GVWR", used: lo.totalLb, limit: p.gvwr_lb, level: level(lo.totalLb, p.gvwr_lb) });
  if (p.tow_rating_lb) out.push({ label: "Loaded vs tow rating", used: lo.totalLb, limit: p.tow_rating_lb, level: level(lo.totalLb, p.tow_rating_lb) });
  if (p.tongue_limit_lb) out.push({ label: "Tongue vs hitch limit", used: lo.tongueLb, limit: p.tongue_limit_lb, level: level(lo.tongueLb, p.tongue_limit_lb) });
  if (p.cargo_cap_lb) out.push({ label: "Cargo vs capacity", used: lo.cargoLb, limit: p.cargo_cap_lb, level: level(lo.cargoLb, p.cargo_cap_lb) });
  return out;
}

// ─────────────────────────────── SPACE / VOLUME ───────────────────────────────
// Estimated footprint per gear item — floor area (sq ft) + volume (cu ft), keyword-matched
// like the weights (most specific / largest first). Estimates for planning the pack, not exact
// measurements — tune as real dimensions are captured. cu ft is the primary "does it fit" metric;
// sq ft is the worst-case floor footprint if nothing is stacked.
const FOOTPRINTS: { match: string; sqft: number; cuft: number }[] = [
  { match: "dump cart", sqft: 4.0, cuft: 6.0 }, { match: "cart", sqft: 4.0, cuft: 6.0 },
  { match: "handwash", sqft: 2.0, cuft: 4.0 }, { match: "hand sink", sqft: 2.0, cuft: 4.0 },
  { match: "cooler", sqft: 2.5, cuft: 4.0 },
  { match: "canopy", sqft: 2.4, cuft: 3.5 }, { match: "tent", sqft: 2.4, cuft: 3.5 },
  { match: "generator", sqft: 1.6, cuft: 3.0 },
  { match: "folding table", sqft: 3.0, cuft: 2.5 }, { match: "table", sqft: 3.0, cuft: 2.5 },
  { match: "bottle inventory", sqft: 1.4, cuft: 2.0 },
  { match: "nitrogen tank", sqft: 0.6, cuft: 2.0 }, { match: "n2 tank", sqft: 0.6, cuft: 2.0 },
  { match: "nitro rig", sqft: 2.0, cuft: 1.5 }, { match: "kegerator", sqft: 2.2, cuft: 5.0 },
  { match: "water jug", sqft: 0.9, cuft: 1.5 }, { match: "potable water", sqft: 0.9, cuft: 1.5 },
  { match: "cold-brew keg", sqft: 0.6, cuft: 1.0 }, { match: "keg", sqft: 0.6, cuft: 1.0 },
  { match: "ecoflow", sqft: 0.8, cuft: 1.0 }, { match: "battery", sqft: 0.8, cuft: 1.0 },
  { match: "broth", sqft: 0.8, cuft: 1.2 }, { match: "cambro", sqft: 0.8, cuft: 1.2 },
  { match: "ice", sqft: 0.7, cuft: 1.0 },
  { match: "nature aid", sqft: 0.8, cuft: 1.0 }, { match: "salted maple", sqft: 0.8, cuft: 1.0 },
  { match: "bottles + lids", sqft: 0.8, cuft: 1.0 }, { match: "bottles", sqft: 0.8, cuft: 1.0 },
  { match: "handwash", sqft: 2.0, cuft: 4.0 },
  { match: "shore-power", sqft: 0.4, cuft: 0.4 }, { match: "cord", sqft: 0.4, cuft: 0.4 },
  { match: "faucet kit", sqft: 0.3, cuft: 0.4 }, { match: "regulator", sqft: 0.2, cuft: 0.2 },
  { match: "kds tablet", sqft: 0.2, cuft: 0.1 }, { match: "square reader", sqft: 0.1, cuft: 0.05 },
];
export function footprintFor(label: string): { sqft: number; cuft: number } {
  const l = label.toLowerCase();
  for (const f of FOOTPRINTS) if (l.includes(f.match)) return { sqft: f.sqft, cuft: f.cuft };
  return { sqft: 0, cuft: 0 }; // unknown / paperwork = no footprint
}

// A real, measured asset from the DB — its dimensions override the keyword estimate when a pack
// label matches it by name (so the load-out uses the EXACT gear size, not a guess).
export interface AssetDim { name: string; len_in?: number | null; width_in?: number | null; height_in?: number | null }
export function dimsToFootprint(len: number, wid: number, hei: number): { sqft: number; cuft: number } {
  return { sqft: Math.round(((len * wid) / 144) * 10) / 10, cuft: Math.round(((len * wid * hei) / 1728) * 10) / 10 };
}
const STOP = new Set(["with", "and", "the", "for", "set", "kit", "pro", "gt3", "stainless", "steel", "commercial"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w));
// Best asset whose distinctive words appear in the pack label (only dimensioned assets are passed in,
// which bounds false matches). Returns the matched asset's footprint, or null if nothing matches.
export function matchAsset(label: string, assets: AssetDim[]): { sqft: number; cuft: number; name: string } | null {
  const lw = new Set(words(label));
  let best: { score: number; a: AssetDim } | null = null;
  for (const a of assets) {
    if (a.len_in == null || a.width_in == null || a.height_in == null) continue;
    const aw = words(a.name);
    const score = aw.filter((w) => lw.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { score, a };
  }
  if (!best) return null;
  const a = best.a;
  return { ...dimsToFootprint(a.len_in!, a.width_in!, a.height_in!), name: a.name };
}

export type SpaceRig = "trailer" | "vehicle";
export interface SpaceItem { label: string; sqft: number; cuft: number; src: "measured" | "est"; asset?: string }
export interface SpacePlan {
  rig: SpaceRig; boxName: string; hasDims: boolean;
  grossCuft: number; usableCuft: number; usedCuft: number; cuftLevel: Level;
  grossSqft: number; usableSqft: number; usedSqft: number; sqftLevel: Level;
  items: SpaceItem[];
}
const r1 = (n: number) => Math.round(n * 10) / 10;
// Which box does an event/stop rig load into? Anything with a trailer → the trailer; else the vehicle.
export function rigToBox(rig: string | null | undefined): SpaceRig {
  return (rig ?? "").toLowerCase().includes("trailer") ? "trailer" : "vehicle";
}
export function spaceBox(p: TrailerProfile, rig: SpaceRig) {
  return rig === "vehicle"
    ? { name: p.tow_vehicle || "Vehicle cargo", len: p.veh_cargo_len_in, wid: p.veh_cargo_width_in, hei: p.veh_cargo_height_in, usable: p.veh_usable_pct }
    : { name: p.name || "Trailer", len: p.interior_len_in, wid: p.interior_width_in, hei: p.interior_height_in, usable: p.usable_pct };
}
export function computeSpace(labels: string[], p: TrailerProfile, rig: SpaceRig, assets: AssetDim[] = []): SpacePlan {
  const box = spaceBox(p, rig);
  const len = box.len ?? 0, wid = box.wid ?? 0, hei = box.hei ?? 0;
  const usable = (box.usable ?? 60) / 100;
  const grossCuft = (len * wid * hei) / 1728;
  const grossSqft = (len * wid) / 144;
  const usableCuft = r1(grossCuft * usable), usableSqft = r1(grossSqft * usable);
  // exact asset dims win over the keyword estimate when a pack label matches a real, measured asset
  const items: SpaceItem[] = labels.map((l) => {
    const m = matchAsset(l, assets);
    if (m) return { label: l, sqft: m.sqft, cuft: m.cuft, src: "measured" as const, asset: m.name };
    const est = footprintFor(l);
    return { label: l, sqft: est.sqft, cuft: est.cuft, src: "est" as const };
  }).filter((x) => x.cuft > 0).sort((a, b) => b.cuft - a.cuft);
  const usedCuft = r1(items.reduce((s, i) => s + i.cuft, 0));
  const usedSqft = r1(items.reduce((s, i) => s + i.sqft, 0));
  return {
    rig, boxName: box.name, hasDims: len > 0 && wid > 0 && hei > 0,
    grossCuft: r1(grossCuft), usableCuft, usedCuft, cuftLevel: level(usedCuft, usableCuft || 1),
    grossSqft: r1(grossSqft), usableSqft, usedSqft, sqftLevel: level(usedSqft, usableSqft || 1),
    items,
  };
}

// Tow & tire best-practice checklist, with the trailer's real numbers baked in.
export function towChecklist(p: TrailerProfile): string[] {
  const psi = p.tire_psi ?? 50;
  const single = (p.axle ?? "single") === "single";
  return [
    `Tires cold to ${psi} PSI before departure (${p.tire_spec ?? "trailer tires"})`,
    "Re-check tire pressure + hub temp after the first 10–15 mi, then every ~100 mi / fuel stop",
    "Coupler fully seated on the ball + locked (pin/lock in)",
    "Safety chains crossed under the coupler, hooked to the hitch",
    "Breakaway cable attached to the tow vehicle (not to the safety chains)",
    "Lights tested — running, brake, turn signals both sides",
    "Load secured + weight biased forward (tongue 10–15% of loaded weight)",
    single ? "Single axle — mind sway; ease off speed in wind/crosswind or when passed by trucks" : "Check both axles' tires + bearings",
  ];
}
