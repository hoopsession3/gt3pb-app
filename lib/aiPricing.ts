// AI COST MODEL — one place to price every Claude call, so the spend meter and any budget logic read
// from a single source. Rates are USD per 1,000,000 tokens, per Anthropic's published pricing for the
// tiers this app uses. If Anthropic changes prices, edit HERE and the whole meter re-prices going
// forward (historical rows keep the cost that was computed when they were logged).
//
// Prompt caching changes the input math: writing to cache costs ~1.25× a normal input token, reading
// from cache costs ~0.1×. A grounded agent re-sends the same big system prefix every call — so once
// it's cached, that prefix bills at a tenth. That's the single biggest lever, and this model makes the
// savings visible (cache-read tokens priced at the cheap rate).

export type Rate = { in: number; out: number; cacheWrite: number; cacheRead: number };

// Keyed by the model id we send to the API (see lib/anthropic MODELS). Approximate published rates.
export const PRICING: Record<string, Rate> = {
  "claude-sonnet-4-6":        { in: 3.0, out: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-haiku-4-5-20251001":{ in: 1.0, out: 5.0,  cacheWrite: 1.25, cacheRead: 0.10 },
};
// Fallback so an unknown/renamed model still prices (uses the Sonnet tier — never silently $0).
const DEFAULT_RATE: Rate = PRICING["claude-sonnet-4-6"];

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_write_tokens?: number;
  cache_read_tokens?: number;
};

// Cost of one call, in whole-dollar cents (float — sub-cent precision preserved for summing).
export function costCents(model: string, u: Usage): number {
  const r = PRICING[model] ?? DEFAULT_RATE;
  const dollars =
    ((u.input_tokens ?? 0) * r.in +
      (u.output_tokens ?? 0) * r.out +
      (u.cache_write_tokens ?? 0) * r.cacheWrite +
      (u.cache_read_tokens ?? 0) * r.cacheRead) /
    1_000_000;
  return dollars * 100;
}

export const fmtUSD = (cents: number): string =>
  cents >= 100 ? `$${(cents / 100).toFixed(2)}` : `${cents.toFixed(2)}¢`;
