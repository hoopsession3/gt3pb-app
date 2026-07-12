// B2B OFFICE DELIVERY — pricing + scheduling for the Monday 5–8 AM bulk route (amber gallon jugs).
// Kept self-contained so the office channel never entangles the residential pack logic.
export const OFFICE = {
  pricePerGallonCents: 4500,   // $45/gal — premium cold-extract, delivered + jug service
  minGallons: 3,
  window: "mon_0500_0800",
  windowLabel: "Mon · 5–8 AM",
} as const;

export type OfficeQuote = { gallons: number; subtotalCents: number; deliveryFeeCents: number; taxCents: number; totalCents: number };

// Delivery fee is baked into the per-gallon margin (see ROI), so it's $0 to the office.
export function officeQuote(gallons: number): OfficeQuote {
  const g = Math.max(OFFICE.minGallons, Math.round(gallons || 0));
  const subtotalCents = g * OFFICE.pricePerGallonCents;
  return { gallons: g, subtotalCents, deliveryFeeCents: 0, taxCents: 0, totalCents: subtotalCents };
}

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The next Monday (local) as a YYYY-MM-DD key. Never today — same-day 5–8 AM has passed by order time,
// and a standing route delivers on the upcoming Mondays.
export function nextMondayKey(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = ((1 - d.getDay() + 7) % 7) || 7; // days until next Monday (1 = Mon); never 0
  d.setDate(d.getDate() + add);
  return keyOf(d);
}

export function mondayLabel(key: string): string {
  const d = new Date(`${key}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}
