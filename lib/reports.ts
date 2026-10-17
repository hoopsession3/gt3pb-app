import { supabase } from "./supabase";
import type { Channels, CostBasis } from "./home";
import { addDays, etDayKey } from "./dates";
import { etDayStart } from "./etDay";

// Sales-actuals report — one RPC (report_sales, owners' and admins' since 0384) returns everything the MONEY-tab
// dashboard needs: real revenue from orders, per-event actuals from the Square mirror, product
// mix, and a daily trend. Margin uses the blended COGS % from event_economics.
//
// A FAILED READ IS NOT AN EMPTY REPORT (2026-10-12). These three returned null on any failure — a PostgREST error, or
// the function's own { error: "unauthorized" } — and each panel drew null as its empty state: "No sales recorded in the
// last 30 days", "No snapshot data yet". A report that could not be read said there was nothing to report. They throw
// now, and the panels show the failure through useAsyncData, with Try again (components/AsyncSection).

export interface SalesReport {
  days: number;
  revenue_cents: number;
  order_count: number;
  cogs_pct: number;
  /** each channel's money: walk-ups, cups, packs, delivery, office — and the shop, since 0384 */
  by_channel?: Channels;
  /** each channel's own orders, counted by the rule its money is (0384); absent from an older report */
  orders_by_channel?: Channels;
  /** what cogs_pct rests on (0384); absent from an older report */
  cogs_basis?: CostBasis;
  by_product: { key: string; n: number; cents: number }[];
  by_event: { event: string; cents: number; orders: number }[];
  by_day: { day: string; cents: number }[];
  error?: string;
}

/** Where a report of the last `days` days begins: Eastern midnight of its first business day — report_sales' own window
 *  (0420: `business_day() - (days - 1)` at time zone America/New_York). The cash line beside the report counted from UTC
 *  midnight, 8 pm the evening before, so after dark it took in the evening's cash the report did not (R18 — the 10/10
 *  audit, DB F4). Pure. */
export function salesWindowStart(days: number, nowMs: number = Date.now()): string {
  return etDayStart(addDays(etDayKey(new Date(nowMs)), -(Math.max(Math.floor(days) || 1, 1) - 1))).toISOString();
}

/** The function's in-band refusal, in words a person can act on. */
const refusal = (what: string, e: string) => (e === "unauthorized" ? `${what} is for owners and admins.` : e);

export async function fetchSalesReport(days = 30): Promise<SalesReport> {
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase.rpc("report_sales", { p_days: days });
  if (error) throw new Error(error.message);
  const r = data as SalesReport | null;
  if (!r || typeof r !== "object") throw new Error("The sales report came back empty.");
  if (r.error) throw new Error(refusal("The sales report", r.error));
  return r;
}

export interface Snapshot {
  inventory: { item_count: number; value_cents: number; low_stock: number; by_category: { cat: string; value_cents: number }[] };
  subs: { active: number; past_due: number; paused: number; total: number; mrr_cents: number; by_plan: { plan: string; n: number }[] };
  loyalty: { members: number; points_out: number; buyers: number; repeat_customers: number };
  error?: string;
}

export async function fetchSnapshot(): Promise<Snapshot> {
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase.rpc("report_snapshot");
  if (error) throw new Error(error.message);
  const s = data as Snapshot | null;
  if (!s || typeof s !== "object") throw new Error("The snapshot came back empty.");
  if (s.error) throw new Error(refusal("The snapshot", s.error));
  return s;
}

export interface EventPnlRow {
  id?: string; // the source event/stop id — lets the P&L row link back to its prep hub
  kind?: "event" | "stop"; // stop rows joined the P&L in 0220
  event: string;
  actual_cents: number;
  orders: number;
  cogs_pct: number;
  fixed_cents: number;
  margin_cents: number;
  /** false when the event has no saved economics, so its net is the menu's blend and nothing else (0384) */
  costs_saved?: boolean;
}

export async function fetchEventPnl(): Promise<EventPnlRow[]> {
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase.rpc("report_events");
  if (error) throw new Error(error.message);
  // A list is the answer. Anything else is the function refusing ({ error: "unauthorized" }) or nothing at all.
  if (!Array.isArray(data)) {
    const e = (data as { error?: string } | null)?.error;
    throw new Error(e ? refusal("The P&L", e) : "The P&L came back empty.");
  }
  return data as EventPnlRow[];
}
