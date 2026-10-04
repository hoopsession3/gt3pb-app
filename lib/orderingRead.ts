// THE ORDERING READ — the three rows lib/ordering decides from, read ONE way for the phone and the
// server (2026-10-04). components/useOrderingOpen calls this with the browser's client and
// app/api/checkout with the service client; before this file they read different things (the city's
// switch and the stop's own lead on the phone, the singleton and the global lead on the server) and
// so could answer the same customer two ways.
//
// What it reads:
//   · market_live — the city's switch and lead, resolved city → live_status → default (0285);
//     live_status when the city has no row, exactly the fallback the hook always had;
//   · live_status.current_stop_id — which stop the truck went live at (trusted by lib/ordering only
//     when that stop is one of this city's);
//   · the city's stops that may still be on the road: not archived, not done, not wrapped, started
//     inside the last day. lib/ordering decides which are over — by the close time when there is
//     one, by lib/road's 8-hour grace when there is not — so a nine-hour stop still under way is not
//     dropped by the query before the rule sees it.
//
// A FAILED READ IS NOT AN EMPTY ROAD. A stops error returns { error } — never "nothing scheduled",
// which on the phone would say "cup orders open with the next stop" about a schedule it could not
// see. The server refuses on an error (better a refused order than a charge it cannot stand behind);
// the phone keeps its last answer and lets the server decide.

import type { SupabaseClient } from "@supabase/supabase-js";
import { orderingStop, preorderLeadMs, type OrderingStop, type StopRow } from "./ordering";
import type { Market } from "./markets";

export type OrderingInputs = { isLive: boolean; liveStopId: string | null; stops: OrderingStop[] };
export type OrderingRead = { inputs: OrderingInputs; error: null } | { inputs: null; error: string };

const LOOK_BACK_MS = 24 * 60 * 60 * 1000;
type Flags = { is_live?: boolean | null; preorder_lead_h?: number | null; current_stop_id?: string | null };

export async function readOrdering(sb: SupabaseClient, market: Market, nowMs: number = Date.now()): Promise<OrderingRead> {
  const [city, single, road] = await Promise.all([
    sb.from("market_live").select("is_live, preorder_lead_h").eq("market", market).maybeSingle(),
    sb.from("live_status").select("is_live, preorder_lead_h, current_stop_id").maybeSingle(),
    sb.from("stops")
      .select("id, name, starts_at, ends_at, location_text, address, order_ahead_enabled, order_ahead_lead_min, pickup_enabled")
      .is("archived_at", null).neq("status", "done").is("completed_at", null).not("starts_at", "is", null)
      .eq("market", market)
      .gte("starts_at", new Date(nowMs - LOOK_BACK_MS).toISOString())
      .order("starts_at", { ascending: true }).limit(12),
  ]);
  if (road.error) return { inputs: null, error: road.error.message };
  const flags = (city.data as Flags | null) ?? (single.data as Flags | null);
  if (!flags && (city.error || single.error)) return { inputs: null, error: (city.error ?? single.error)!.message };
  const lead = preorderLeadMs(flags?.preorder_lead_h);
  const stops = ((road.data ?? []) as StopRow[]).map((r) => orderingStop(r, lead)).filter((s): s is OrderingStop => s !== null);
  const isLive = !!flags?.is_live;
  return { inputs: { isLive, liveStopId: isLive ? ((single.data as Flags | null)?.current_stop_id ?? null) : null, stops }, error: null };
}
