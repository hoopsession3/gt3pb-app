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
//     dropped by the query before the rule sees it;
//   · and, when the switch names a stop that road does not have, that stop's own row (C1, 2026-10-12):
//     archived, done, a day old or another city's, it is no truck pouring here (lib/ordering
//     liveSwitchOn).
//
// A FAILED READ IS NOT AN EMPTY ROAD. A stops error returns { error } — never "nothing scheduled",
// which on the phone would say "cup orders open with the next stop" about a schedule it could not
// see. The server refuses on an error (better a refused order than a charge it cannot stand behind);
// the phone keeps its last answer and lets the server decide.

import type { SupabaseClient } from "@supabase/supabase-js";
import { orderingNow, orderingStop, preorderLeadMs, type NamedStop, type Ordering, type OrderingStop, type StopRow } from "./ordering";
import type { Market } from "./markets";

// `named` (C1, 2026-10-12): the stop the live switch names, read by id when the road does not have it — the road drops
// a stop once it is archived, done or a day old, which is exactly when a switch left on is wrong. null = no such stop in
// this city; absent = the switch names none, or the road has it. lib/ordering's liveSwitchOn judges it.
export type OrderingInputs = { isLive: boolean; liveStopId: string | null; stops: OrderingStop[]; named?: NamedStop | null };
export type OrderingRead = { inputs: OrderingInputs; error: null } | { inputs: null; error: string };

/** The rule over a read — the one call the phone and the server make, so neither can forget an input. */
export const orderingFrom = (i: OrderingInputs, nowMs: number): Ordering => orderingNow(nowMs, i.isLive, i.stops, i.liveStopId, i.named);

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
  const liveStopId = isLive ? ((single.data as Flags | null)?.current_stop_id ?? null) : null;
  if (!liveStopId || stops.some((s) => s.id === liveStopId)) return { inputs: { isLive, liveStopId, stops }, error: null };
  // The switch names a stop the road does not have: its own row says whether it is still a stop. This city's only — a
  // pointer to another city's stop is that city's truck, not a truck pouring here. (The pointer is the company's one
  // row, live_status: the day a second city runs its own truck on its own switch (markets.is_live, 0285) the pointer
  // has to be per city too.) A failed read is an error, as above: the server refuses rather than charge on a switch it
  // could not check.
  const r = await sb.from("stops").select("starts_at, ends_at, archived_at, status, completed_at")
    .eq("id", liveStopId).eq("market", market).maybeSingle();
  if (r.error) return { inputs: null, error: r.error.message };
  return { inputs: { isLive, liveStopId, stops, named: (r.data as NamedStop | null) ?? null }, error: null };
}

// A STOP'S MENU (2026-10-13, R2 of the customer audit — the Catalog is the menu): the drinks the stop an order is for
// pours, or null — no menu set, which limits nothing. The crew's menu table is staff-only (0173); stop_menu (0393) answers
// one stop's list to anyone, because the menu shows it. The phone reads it to say "Not at this stop" — on any error it
// limits nothing, and Pay decides; the server, before any charge, refuses on a failed read rather than sell what it could
// not check (app/api/checkout). The error comes back as PostgREST gave it, so the server can tell the one it forgives:
// arrives-with: 0393 — until stop_menu is pasted PostgREST answers PGRST202 (lib/schemaSkew isMissingFunction), and a
// stop's menu limits nothing, as before. (schemaSkew is the server's to load: this file rides in every page's bundle.)
export async function readStopMenu(sb: SupabaseClient, stopId: string): Promise<{ menu: string[] | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await sb.rpc("stop_menu", { p_stop: stopId });
  if (error) return { menu: null, error: { code: error.code, message: error.message } };
  return { menu: Array.isArray(data) && data.length ? (data as string[]) : null, error: null };
}
