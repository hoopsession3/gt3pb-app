// B2B OFFICE DELIVERY — pricing + scheduling for the Monday 5–8 AM bulk route (amber gallon jugs).
// Kept self-contained so the office channel never entangles the residential pack logic.
export const OFFICE = {
  pricePerGallonCents: 4500,   // $45/gal — premium cold-extract, delivered + jug service
  minGallons: 3,
  window: "mon_0500_0800",
  windowLabel: "Mon · 5–8 AM",
} as const;

export type OfficeQuote = { gallons: number; subtotalCents: number; deliveryFeeCents: number; taxCents: number; totalCents: number };

// Delivery fee is baked into the per-gallon margin (see ROI), so it's $0 to the office. Price + min
// default to the constants but can be overridden by owner-set values (live_status, Settings tab).
export function officeQuote(gallons: number, opts?: { priceCents?: number; minGallons?: number }): OfficeQuote {
  const price = opts?.priceCents ?? OFFICE.pricePerGallonCents;
  const min = opts?.minGallons ?? OFFICE.minGallons;
  const g = Math.max(min, Math.round(gallons || 0));
  const subtotalCents = g * price;
  return { gallons: g, subtotalCents, deliveryFeeCents: 0, taxCents: 0, totalCents: subtotalCents };
}

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The next Monday (local) as a YYYY-MM-DD key. Never today — same-day 5–8 AM has passed by order time,
// and a standing route delivers on the upcoming Mondays. The fallback only (2026-10-07, 0356): the
// date is the database's now, in the market's time with its cutoff (office_next_delivery,
// book_office_standing); this answers only while 0356 is not pasted yet.
export function nextMondayKey(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = ((1 - d.getDay() + 7) % 7) || 7; // days until next Monday (1 = Mon); never 0
  d.setDate(d.getDate() + add);
  return keyOf(d);
}

// A delivery window as the database writes it — 'mon_0500_0800': the day, then 24-hour start and end
// — read out the way the route says it: "5–8 AM", "6–9 AM", "11 AM–2 PM". The window comes from the
// program, its location or its market (0356); this is the one reader of the code, so no screen or
// alert has to hard-code "5–8 AM" again.
const DAYS: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
export function windowHours(code: string | null | undefined): string {
  const m = /^[a-z]{3}_(\d{2})(\d{2})_(\d{2})(\d{2})$/.exec(code ?? "");
  if (!m) return "5–8 AM";
  const [h1, m1, h2, m2] = [+m[1], +m[2], +m[3], +m[4]];
  const half = (h: number) => (h < 12 ? "AM" : "PM");
  const clock = (h: number, mi: number) => `${h % 12 === 0 ? 12 : h % 12}${mi ? `:${String(mi).padStart(2, "0")}` : ""}`;
  return half(h1) === half(h2) ? `${clock(h1, m1)}–${clock(h2, m2)} ${half(h2)}` : `${clock(h1, m1)} ${half(h1)}–${clock(h2, m2)} ${half(h2)}`;
}
export function windowLabel(code: string | null | undefined): string {
  return `${DAYS[(code ?? "mon").slice(0, 3)] ?? "Mon"} · ${windowHours(code)}`;
}

export function mondayLabel(key: string): string {
  const d = new Date(`${key}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}
