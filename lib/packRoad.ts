import type { SupabaseClient } from "@supabase/supabase-js";
import { lacksHeld } from "./orderingRead";
import { FOUNDING_MARKET } from "./markets";
import { etDayKey } from "./dates";

// THE STOPS A PACK CAN BE PICKED UP AT (R7b re-audit, 2026-10-16 — 0412). A city held closed in Settings › Locations &
// markets takes no order of any kind — 0412 promised "no orders at all there, scheduled stops included" — and the pack
// routes read every city's stops and took a pack, card and all, at a stop in a city held closed. A city whose opening day
// has not come takes none for a stop before that day. /api/reserve, /api/reserve/move and /api/reserve/change read the
// road through here: a held city's stops are not offered, a stop named in one is refused, and the Saturday cadence — what
// is offered when no stop is left — is the founding city's, so it is offered only while that city is taking orders. A
// failed read of the cities is no answer: the route refuses (nothing is charged) rather than take a pack for a city it
// could not check; the funnel offers what the road has and lets the server say.
export type RoadStop = { id?: string; starts_at: string; market?: string | null };

/** The city a stop is in: its market, or the founding city's for a row from before markets (0275). */
export const cityOf = (st: { market?: string | null }): string => st.market || FOUNDING_MARKET;

export type PackRoad<T> =
  | { error: null; taking: T[]; heldCity: (st: { starts_at?: string | null; market?: string | null }) => boolean; foundingHeld: boolean }
  | { error: string };

export async function packRoad<T extends RoadStop>(sb: SupabaseClient, road: readonly T[]): Promise<PackRoad<T>> {
  const read = await cityHolds(sb, [FOUNDING_MARKET, ...road.map(cityOf)]);
  if (read.error !== null) return { error: read.error };
  // Held closed is every day; not open yet is every day before the opening day — a pack for a stop on or after it is a
  // pack for a city that will be open (a launch's first drops can be reserved ahead).
  const heldCity = (st: { starts_at?: string | null; market?: string | null }) => {
    const h = read.holds.get(cityOf(st));
    if (!h) return false;
    if (h.closed) return true;
    return h.opensOn !== null && (!st.starts_at || etDayKey(new Date(st.starts_at)) < h.opensOn);
  };
  const founding = read.holds.get(FOUNDING_MARKET);
  return { error: null, taking: road.filter((st) => !heldCity(st)), heldCity, foundingHeld: !!founding && (founding.closed || founding.opensOn !== null) };
}

/** What a pack route says when the road could not be checked, a stop's city is held, or no city is taking packs. */
export const PACK_ROAD_WORDS = {
  unread: "We couldn't check the pickup schedule just now — try again in a moment. Nothing was charged.",
  heldStop: "That stop's city isn't taking orders right now — pick another pickup.",
  none: "We're not taking pack orders right now — check back soon.",
} as const;

// THE CITIES HELD (R7b re-audit, 0412): held closed (the city's switch at false), or their opening day not come — and which
// day that is, so a stop on or after it can be reserved. One read for every city asked about; a failed read is no answer.
// Here, not in lib/orderingRead, which every page loads for a question it never asks.
// arrives-with: 0412 — held_closed is its column; until it is pasted only a city whose opening day has not come is held.
export type CityHold = { closed: boolean; opensOn: string | null };
export async function cityHolds(sb: SupabaseClient, markets: readonly string[]): Promise<{ holds: Map<string, CityHold>; error: null } | { holds: null; error: string }> {
  const asked = [...new Set(markets)];
  if (!asked.length) return { holds: new Map(), error: null };
  const first = await sb.from("market_live").select("market, pre_launch, opens_on, held_closed").in("market", asked);
  const r = lacksHeld(first.error) ? await sb.from("market_live").select("market, pre_launch, opens_on").in("market", asked) : first;
  if (r.error) return { holds: null, error: r.error.message };
  const rows = (r.data ?? []) as { market: string; pre_launch?: boolean | null; opens_on?: string | null; held_closed?: boolean | null }[];
  // pre_launch is "opens_on after today" (0285): its day, or — said without one — closed until it says.
  return { holds: new Map(rows.map((x) => [x.market, {
    closed: x.held_closed === true || (x.pre_launch === true && !x.opens_on),
    opensOn: x.pre_launch === true && x.opens_on ? String(x.opens_on).slice(0, 10) : null,
  }])), error: null };
}
