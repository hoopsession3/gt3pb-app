"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { SectionHeader } from "@/components/kit";

/* eslint-disable @typescript-eslint/no-explicit-any */
// THE TWELVE (0264 · Playbook v1 §12) — every KPI in the strategy, defined once, entered on
// Mondays until each goes live-computed. Manual entry is the honest v1: the doc's own plan is
// "manual Monday entry until live," and the audit's Signal criterion reads THIS board. A value
// re-entered for the same week updates in place (unique metric+period); history accrues for
// trends. Live automation lands per-metric as its source object ships (restock activities →
// bottles/wk per cooler, etc.) — no speculative wiring.

const KPIS: { key: string; label: string; unit: string; cadence: string }[] = [
  { key: "mrr",              label: "MRR by account (total)",   unit: "$",        cadence: "monthly" },
  { key: "rev_op_day",       label: "Revenue / operating day",  unit: "$",        cadence: "weekly" },
  { key: "rev_event",        label: "Avg revenue / event",      unit: "$",        cadence: "per event" },
  { key: "bottles_cooler",   label: "Bottles / wk per cooler",  unit: "bottles",  cadence: "weekly" },
  { key: "sell_through",     label: "Sell-through",             unit: "%",        cadence: "weekly" },
  { key: "spoilage",         label: "Spoilage",                 unit: "%",        cadence: "monthly" },
  { key: "sample_purchase",  label: "Sample → purchase",        unit: "%",        cadence: "per pop-up" },
  { key: "coupon_redeem",    label: "Coupon redemptions",       unit: "count",    cadence: "weekly" },
  { key: "loop_part",        label: "Loop participation",       unit: "%",        cadence: "monthly" },
  { key: "bottle_return",    label: "Bottle return rate",       unit: "%",        cadence: "monthly" },
  { key: "repeat_rate",      label: "Repeat purchase rate",     unit: "%",        cadence: "monthly" },
  { key: "rev_route",        label: "Revenue / route",          unit: "$",        cadence: "weekly" },
];

type Snap = { metric: string; period: string; value: number };
type BoardData = { snaps: Snap[]; live: Record<string, number> };

// Live-computable metrics (2026-08-03, Ryan: "I can start tracking all") — three of the twelve
// already read straight from order data; they show a LIVE chip and take no manual entry. The
// rest stay Monday-entry until their source object ships (restock activities, coupon scans, …) —
// wiring a metric before its data exists would just be a prettier guess.
async function computeLive(): Promise<Record<string, number>> {
  if (!supabase) return {};
  const out: Record<string, number> = {};
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  const monthStart = `${new Date().toISOString().slice(0, 8)}01`;
  try {   // Revenue / route (weekly): paid delivery revenue ÷ distinct run days
    const { data } = await supabase.from("delivery_orders").select("total_cents, delivery_date, payment_status").gte("created_at", week).is("canceled_at", null);
    const paid = ((data ?? []) as any[]).filter((o) => o.payment_status === "paid");
    const days = new Set(paid.map((o) => o.delivery_date)).size;
    if (days > 0) out.rev_route = Math.round(paid.reduce((s, o) => s + (o.total_cents ?? 0), 0) / 100 / days);
  } catch { /* stays manual */ }
  try {   // Revenue / operating day (weekly): all paid revenue ÷ distinct days with sales
    const { data } = await supabase.from("all_orders").select("total_cents, payment_status, created_at").gte("created_at", week);
    const paid = ((data ?? []) as any[]).filter((o) => o.payment_status === "paid");
    const days = new Set(paid.map((o) => String(o.created_at).slice(0, 10))).size;
    if (days > 0) out.rev_op_day = Math.round(paid.reduce((s, o) => s + (o.total_cents ?? 0), 0) / 100 / days);
  } catch { /* stays manual */ }
  try {   // Repeat purchase rate (monthly): customers with 2+ paid orders ÷ customers with any
    const { data } = await supabase.from("orders").select("customer_id, paid").gte("created_at", `${monthStart}T00:00:00`).eq("paid", true).not("customer_id", "is", null);
    const counts = new Map<string, number>();
    for (const o of ((data ?? []) as any[])) counts.set(o.customer_id, (counts.get(o.customer_id) ?? 0) + 1);
    if (counts.size > 0) out.repeat_rate = Math.round(([...counts.values()].filter((n) => n >= 2).length / counts.size) * 100);
  } catch { /* stays manual */ }
  return out;
}

export default function KpiBoard() {
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const isAdmin = !!profile?.is_admin || ["owner", "admin"].includes(String((profile as any)?.role ?? ""));
  const [entry, setEntry] = useState<Record<string, string>>({});

  const loader = useCallback(async (): Promise<BoardData> => {
    if (!supabase) return { snaps: [], live: {} };
    const [{ data, error }, live] = await Promise.all([
      supabase.from("kpi_snapshots").select("metric, period, value").order("period", { ascending: false }).limit(96),
      computeLive(),
    ]);
    if (error) throw new Error(error.message);
    return { snaps: (data as Snap[]) ?? [], live };
  }, []);
  const state = useAsyncData(loader, []);
  useRealtimeTable(["kpi_snapshots"], state.reload);

  const save = async (key: string) => {
    if (!supabase) return;
    const raw = (entry[key] ?? "").trim();
    const v = Number(raw);
    if (!raw || !Number.isFinite(v)) { toast("Numbers only", "error"); return; }
    const period = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from("kpi_snapshots").upsert(
      { metric: key, period, value: v, created_by: user?.id ?? null }, { onConflict: "metric,period" });
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    setEntry((e) => ({ ...e, [key]: "" }));
    toast("Logged"); state.reload();
  };

  return (
    <div className="adm-sec" id="cmd-kpis">
      <SectionHeader label="The twelve" annotation="Monday entry until live" />
      <div className="h-sub">The Playbook's KPI framework — the audit's Signal criterion reads this board. Same week re-entry updates in place.</div>
      <AsyncSection state={state} isEmpty={() => false} emptyTitle="—" loadingLabel="Loading KPIs…" errorTitle="Couldn't load KPIs">
        {({ snaps, live }) => (
          <div className="kpib">
            {KPIS.map((k) => {
              const isLive = live[k.key] !== undefined;
              const mine = snaps.filter((s) => s.metric === k.key);
              const latest = mine[0]; const prior = mine[1];
              const shown = isLive ? live[k.key] : latest?.value;
              const trend = !isLive && latest && prior ? (latest.value > prior.value ? "↑" : latest.value < prior.value ? "↓" : "→") : "";
              return (
                <div key={k.key} className="kpib-row">
                  <span className="kpib-l">{k.label}<i>{k.cadence}{isLive && <em className="kpib-live">live</em>}</i></span>
                  <span className="kpib-v">{shown !== undefined ? `${k.unit === "$" ? "$" : ""}${Number(shown).toLocaleString()}${k.unit === "%" ? "%" : ""}` : "—"}{trend && <i className={`kpib-t${trend === "↓" ? " down" : ""}`}>{trend}</i>}</span>
                  {isAdmin && !isLive && (
                    <span className="kpib-in">
                      <input inputMode="decimal" placeholder={k.unit} value={entry[k.key] ?? ""} onChange={(e) => setEntry((s) => ({ ...s, [k.key]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") save(k.key); }} aria-label={`Enter ${k.label}`} />
                      <button type="button" onClick={() => save(k.key)} disabled={!(entry[k.key] ?? "").trim()}>Log</button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </AsyncSection>
    </div>
  );
}
