import type { EventRow } from "./db";

// Event ROI engine. Pure functions — no I/O — so the UI can recompute a live
// projection on every keystroke and the math stays testable. "Layered" model:
// each menu line uses its catalog unit cost when set, else falls back to the
// event's blended COGS %.

export interface ProductEcon {
  product_key: string;
  label: string;
  price_cents: number;
  unit_cost_cents: number | null; // null → blended fallback
  active: boolean;
  sort: number;
}

export interface EventEcon {
  capture_pct: number;       // share of attendance that buys (0..1)
  items_per_guest: number;   // units per buying guest
  cogs_pct: number;          // blended COGS fallback (0..1)
  labor_rate_cents: number;  // $/hr per crew member
  booth_cents: number;
  transport_cents: number;
  permit_cents: number;
  consumables_cents: number;
}

export const DEFAULT_ECON: EventEcon = {
  capture_pct: 0.35, items_per_guest: 1.2, cogs_pct: 0.3,
  labor_rate_cents: 1800, booth_cents: 0, transport_cents: 0, permit_cents: 0, consumables_cents: 0,
};

// event menu flags → catalog keys (what this event actually sells)
const MENU_KEYS: { flag: keyof EventRow; key: string }[] = [
  { flag: "menu_nitro", key: "nitro" },
  { flag: "menu_nature_aid", key: "nature_aid" },
  { flag: "menu_salted_maple", key: "salted_maple" },
  { flag: "menu_bottles", key: "bottles" },
  { flag: "menu_broth", key: "broth" },
];

export interface ProjLine {
  key: string; label: string; units: number;
  revenueCents: number; cogsCents: number; costed: boolean;
}

export interface Projection {
  revenueCents: number; cogsCents: number; grossCents: number; grossMarginPct: number;
  laborCents: number; fixedCents: number; totalCostCents: number;
  netCents: number; netMarginPct: number; roiPct: number;
  projectedGuests: number; projectedUnits: number;
  breakEvenGuests: number | null; breakEvenUnits: number | null;
  lines: ProjLine[]; enabledLines: number;
}

const unitCostOf = (c: ProductEcon | undefined, cogsPct: number) =>
  c && c.unit_cost_cents != null ? c.unit_cost_cents : Math.round((c?.price_cents ?? 0) * cogsPct);

export function projectEvent(e: EventRow, econ: EventEcon, catalog: ProductEcon[]): Projection {
  const attendance = Math.max(0, e.expected_attendance ?? 0);
  const hours = Math.max(0, e.duration_hrs ?? 0);
  const staff = Math.max(0, e.staff_count ?? 0);
  const guests = attendance * econ.capture_pct;
  const totalUnits = guests * econ.items_per_guest;

  const byKey = new Map(catalog.map((c) => [c.product_key, c]));
  const keys = MENU_KEYS.filter((m) => e[m.flag]).map((m) => m.key);
  const n = keys.length;

  const lines: ProjLine[] = keys.map((k) => {
    const c = byKey.get(k);
    const price = c?.price_cents ?? 0;
    const units = n ? totalUnits / n : 0; // even split across enabled lines
    const cost = unitCostOf(c, econ.cogs_pct);
    return { key: k, label: c?.label ?? k, units, revenueCents: units * price, cogsCents: units * cost, costed: !!(c && c.unit_cost_cents != null) };
  });

  const revenueCents = lines.reduce((s, l) => s + l.revenueCents, 0);
  const cogsCents = lines.reduce((s, l) => s + l.cogsCents, 0);
  const grossCents = revenueCents - cogsCents;
  const laborCents = staff * hours * econ.labor_rate_cents;
  const fixedCents = econ.booth_cents + econ.transport_cents + econ.permit_cents + econ.consumables_cents;
  const totalCostCents = cogsCents + laborCents + fixedCents;
  const netCents = revenueCents - totalCostCents;

  // break-even from contribution margin — independent of attendance, so it
  // holds even before you've entered a crowd estimate.
  const contribPerUnit = n
    ? keys.reduce((s, k) => { const c = byKey.get(k); return s + ((c?.price_cents ?? 0) - unitCostOf(c, econ.cogs_pct)); }, 0) / n
    : 0;
  const fixedPlusLabor = laborCents + fixedCents;
  const breakEvenUnits = contribPerUnit > 0 ? fixedPlusLabor / contribPerUnit : null;
  const breakEvenGuests = breakEvenUnits != null ? breakEvenUnits / Math.max(econ.items_per_guest, 0.01) : null;

  return {
    revenueCents, cogsCents, grossCents,
    grossMarginPct: revenueCents > 0 ? grossCents / revenueCents : 0,
    laborCents, fixedCents, totalCostCents,
    netCents, netMarginPct: revenueCents > 0 ? netCents / revenueCents : 0,
    roiPct: totalCostCents > 0 ? netCents / totalCostCents : 0,
    projectedGuests: guests, projectedUnits: totalUnits,
    breakEvenGuests, breakEvenUnits, lines, enabledLines: n,
  };
}

// Reconcile a real gross (event_sales + orders) against the plan. We only have
// actual revenue, so COGS is estimated at the projection's effective ratio.
export interface Reconciliation {
  actualRevenueCents: number; actualCogsCents: number;
  actualNetCents: number; actualRoiPct: number;
  revenueVsPlanPct: number; // actual / projected revenue - 1
}

export function reconcile(p: Projection, actualRevenueCents: number, econ: EventEcon): Reconciliation {
  const cogsRatio = p.revenueCents > 0 ? p.cogsCents / p.revenueCents : econ.cogs_pct;
  const actualCogsCents = actualRevenueCents * cogsRatio;
  const fixedPlusLabor = p.laborCents + p.fixedCents;
  const actualNetCents = actualRevenueCents - actualCogsCents - fixedPlusLabor;
  const actualCostCents = actualCogsCents + fixedPlusLabor;
  return {
    actualRevenueCents, actualCogsCents, actualNetCents,
    actualRoiPct: actualCostCents > 0 ? actualNetCents / actualCostCents : 0,
    revenueVsPlanPct: p.revenueCents > 0 ? actualRevenueCents / p.revenueCents - 1 : 0,
  };
}
