import { supabase } from "./supabase";

// Sales-actuals report — one staff-gated RPC (report_sales) returns everything the MONEY-tab
// dashboard needs: real revenue from orders, per-event actuals from the Square mirror, product
// mix, and a daily trend. Margin uses the blended COGS % from event_economics.

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

export async function fetchSalesReport(days = 30): Promise<SalesReport | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("report_sales", { p_days: days });
  if (error || !data) return null;
  return data as SalesReport;
}

export interface Snapshot {
  inventory: { item_count: number; value_cents: number; low_stock: number; by_category: { cat: string; value_cents: number }[] };
  subs: { active: number; past_due: number; paused: number; total: number; by_plan: { plan: string; n: number }[] };
  loyalty: { members: number; points_out: number; buyers: number; repeat_customers: number };
  error?: string;
}

export async function fetchSnapshot(): Promise<Snapshot | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("report_snapshot");
  if (error || !data) return null;
  return data as Snapshot;
}
