// MARKETS — the single source of truth for which cities GT3 operates in.
//
// Pure + deterministic (no DOM, no env, no I/O), the same contract lib/orderAhead and lib/delivery
// hold, so this runs identically on the server, in the client UI, and under the smoke suite.
//
// WHY THIS IS NOT A TENANT. A tenant (0040/0134) is a different BUSINESS on the platform, and 0134
// enforces it with restrictive RLS — tenant A physically cannot see tenant B. That isolation is the
// opposite of what a second city of the SAME business needs: Atlanta's numbers have to be tellable
// apart from Greenville's AND still roll up into one company total. A market is a segment inside one
// tenant. Adding a second tenant row would also wake the unscoped service-role routes, which are
// harmless today only because exactly one tenant exists.
//
// ZERO-REGRESSION CONTRACT: every market-aware function in this codebase takes market as an OPTIONAL
// argument defaulting to FOUNDING_MARKET. Code written before markets existed passes nothing and
// therefore behaves exactly as it did before. `toMarket` never throws and never returns null, so an
// absent or unrecognised value can only ever resolve to the founding market — never to an error and
// never to the wrong city.

export const MARKETS = ["greenville", "atlanta"] as const;
export type Market = (typeof MARKETS)[number];

/** The original market. Every pre-market row and every pre-market caller means this. */
export const FOUNDING_MARKET: Market = "greenville";

export const MARKET_LABEL: Record<Market, string> = {
  greenville: "Greenville",
  atlanta: "Atlanta",
};

export const MARKET_REGION: Record<Market, string> = {
  greenville: "Greenville, SC",
  atlanta: "Atlanta, GA",
};

// Both markets are US Eastern today, so nothing in the date math changes. Declared explicitly anyway
// so that a future Central or Mountain market is a one-line data change here rather than a hunt
// through lib/dates.ts and every cutoff calculation that currently assumes ET.
export const MARKET_TZ: Record<Market, string> = {
  greenville: "America/New_York",
  atlanta: "America/New_York",
};

// What each market actually FULFILS today — deliberately narrower than what it could sell.
//
// Atlanta opens on corporate standing orders only. Consumer Sunday delivery stays Greenville-only on
// purpose: turning it on for a market with no Sunday route would let customers buy something nobody
// is scheduled to deliver, which is a worse failure than the ZIP being rejected. Stops are off for
// the same reason — Atlanta has no scheduled truck stops at this stage.
export type Channel = "corporate" | "consumerDelivery" | "stops";
export const MARKET_CHANNELS: Record<Market, Record<Channel, boolean>> = {
  greenville: { corporate: true, consumerDelivery: true, stops: true },
  atlanta: { corporate: true, consumerDelivery: false, stops: false },
};

export const isMarket = (v: unknown): v is Market =>
  typeof v === "string" && (MARKETS as readonly string[]).includes(v);

/** Never throws, never null: anything unrecognised resolves to the founding market. */
export const toMarket = (v: unknown): Market => (isMarket(v) ? v : FOUNDING_MARKET);

/** Does this market currently fulfil this channel? Unknown markets fall back to the founding one. */
export const marketServes = (market: Market, channel: Channel): boolean =>
  (MARKET_CHANNELS[market] ?? MARKET_CHANNELS[FOUNDING_MARKET])[channel];

// ── WHICH MARKET IS THE VIEWER LOOKING AT? (0279) ────────────────────────────────────────────────
//
// The audit's step 02 — filter Find Us and the ordering window by city — needs an answer to "which
// city is this person in", and the honest answer is that the app cannot know. It has no reliable
// signal: geolocation is a permission prompt for a question most people would rather just be asked,
// and an IP guess is wrong often enough to be worse than a default.
//
// So the rule is deliberately dumb, and dumb in the safe direction:
//   1. If the viewer has chosen a city, use it — as long as that city still has something on.
//   2. Otherwise the founding market, if it has something on. Today that is always true, which is
//      exactly why nothing changes for anyone until a second city genuinely has a stop.
//   3. Otherwise the first market that does have something on — so a viewer is never shown an empty
//      road while another city is running.
//   4. Otherwise the founding market. Never null, never a crash.
//
// `available` is derived from the rows the screen ALREADY loaded, not from a second query — which is
// why a switcher can only appear when a second market really is on the road, and why this costs
// nothing while Greenville runs alone.

export const MARKET_CHOICE_KEY = "gt3.market";

export function pickViewerMarket(stored: unknown, available: readonly string[] = []): Market {
  const live = available.filter(isMarket);
  if (isMarket(stored) && live.includes(stored)) return stored;
  if (live.includes(FOUNDING_MARKET)) return FOUNDING_MARKET;
  return live[0] ?? FOUNDING_MARKET;
}

/** The distinct markets present in a set of loaded rows, in MARKETS order so the switcher is stable
 *  (a switcher whose buttons reorder as data loads is worse than no switcher). */
export function marketsPresent(rows: readonly { market?: unknown }[]): Market[] {
  const seen = new Set<Market>();
  for (const r of rows) if (isMarket(r?.market)) seen.add(r.market);
  return MARKETS.filter((m) => seen.has(m));
}

/** Show a city switcher only when the choice is real. One market on the road = no chrome. */
export const shouldOfferMarketChoice = (present: readonly Market[]): boolean => present.length > 1;

/** Keep a row if it belongs to this market. Rows with no market read as the founding market, so a
 *  row written before 0275 (or by a path that never set it) stays visible where it always was. */
export const rowInMarket = (row: { market?: unknown }, market: Market): boolean =>
  toMarket(row?.market) === market;
