"use client";

import { supabase } from "./supabase";
import { etToday } from "./dates";

// Data-bound goal metrics — a goal with a metric_source reads its number from LIVE data instead
// of manual logging, so the board can't drift from reality. Months are ET business months.
export const METRIC_SOURCES: Record<string, { label: string; unit: string; hint: string }> = {
  bottles_month:   { label: "Bottles this month",  unit: "bottles",   hint: "packs + delivery, live from orders" },
  revenue_month:   { label: "Revenue this month",  unit: "$",         hint: "paid orders, all channels" },
  events_month:    { label: "Events this month",   unit: "events",    hint: "non-archived events on the calendar" },
  customers_total: { label: "Customers",           unit: "customers", hint: "everyone in the CRM" },
};

export async function computeMetric(source: string): Promise<number | null> {
  if (!supabase) return null;
  const monthStart = `${etToday().slice(0, 8)}01`;
  try {
    if (source === "revenue_month") {
      const { data } = await supabase.from("all_orders")
        .select("total_cents, payment_status").gte("created_at", `${monthStart}T00:00:00`);
      const cents = ((data ?? []) as { total_cents: number | null; payment_status: string | null }[])
        .filter((o) => o.payment_status === "paid").reduce((s, o) => s + (o.total_cents ?? 0), 0);
      return Math.round(cents / 100);
    }
    if (source === "bottles_month") {
      const [dr, de] = await Promise.all([
        supabase.from("drop_orders").select("size").gte("drop_date", monthStart).is("canceled_at", null),
        supabase.from("delivery_orders").select("pack_size").gte("delivery_date", monthStart).is("canceled_at", null),
      ]);
      const packs = ((dr.data ?? []) as { size: number | null }[]).reduce((s, o) => s + (o.size ?? 0), 0);
      const porch = ((de.data ?? []) as { pack_size: number | null }[]).reduce((s, o) => s + (o.pack_size ?? 0), 0);
      return packs + porch;
    }
    if (source === "events_month") {
      const { count } = await supabase.from("events").select("id", { count: "exact", head: true })
        .is("archived_at", null).gte("day", monthStart);
      return count ?? 0;
    }
    if (source === "customers_total") {
      const { count } = await supabase.from("customers").select("id", { count: "exact", head: true });
      return count ?? 0;
    }
  } catch { /* fall through */ }
  return null;
}
