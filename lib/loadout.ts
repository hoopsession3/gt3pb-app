// Load-Out & Tow Plan math. Item weights are ESTIMATES for planning the load — not
// certified scale weights. The trailer/tow numbers come from the cert plate (0037).

export interface TrailerProfile {
  id: number; name: string | null; maker: string | null; size_label: string | null;
  gvwr_lb: number | null; empty_lb: number | null; cargo_cap_lb: number | null;
  axle: string | null; tire_spec: string | null; tire_psi: number | null;
  tow_vehicle: string | null; tow_rating_lb: number | null; tongue_limit_lb: number | null;
  vin: string | null; notes: string | null;
}

// Estimated gear weights (lb) by keyword — heaviest first wins on overlap.
const WEIGHTS: { match: string; lb: number }[] = [
  { match: "water jug", lb: 150 }, { match: "potable water", lb: 150 },
  { match: "cold-brew keg", lb: 120 }, { match: "keg", lb: 120 },
  { match: "ecoflow", lb: 99 }, { match: "bottle inventory", lb: 80 },
  { match: "canopy", lb: 80 }, { match: "ice", lb: 80 }, { match: "generator", lb: 75 },
  { match: "nitrogen tank", lb: 55 }, { match: "broth", lb: 50 }, { match: "handwash", lb: 40 },
  { match: "nature aid", lb: 40 }, { match: "salted maple", lb: 40 },
  { match: "cups + lids", lb: 25 }, { match: "cooler", lb: 25 }, { match: "shore-power", lb: 20 },
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
