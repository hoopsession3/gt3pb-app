import { supabase } from "./supabase";

// Sales-actuals report — one staff-gated RPC (report_sales) returns everything the MONEY-tab
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
  by_product: { key: string; n: number; cents: number }[];
  by_event: { event: string; cents: number; orders: number }[];
  by_day: { day: string; cents: number }[];
  error?: string;
}

/** The function's in-band refusal, in words a person can act on. */
const refusal = (what: string, e: string) => (e === "unauthorized" ? `This account cannot read ${what}.` : e);

export async function fetchSalesReport(days = 30): Promise<SalesReport> {
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase.rpc("report_sales", { p_days: days });
  if (error) throw new Error(error.message);
  const r = data as SalesReport | null;
  if (!r || typeof r !== "object") throw new Error("The sales report came back empty.");
  if (r.error) throw new Error(refusal("the sales report", r.error));
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
  if (s.error) throw new Error(refusal("the snapshot", s.error));
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
}

export async function fetchEventPnl(): Promise<EventPnlRow[]> {
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase.rpc("report_events");
  if (error) throw new Error(error.message);
  // A list is the answer. Anything else is the function refusing ({ error: "unauthorized" }) or nothing at all.
  if (!Array.isArray(data)) {
    const e = (data as { error?: string } | null)?.error;
    throw new Error(e ? refusal("the P&L", e) : "The P&L came back empty.");
  }
  return data as EventPnlRow[];
}
