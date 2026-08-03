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

export default function KpiBoard() {
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const isAdmin = !!profile?.is_admin || ["owner", "admin"].includes(String((profile as any)?.role ?? ""));
  const [entry, setEntry] = useState<Record<string, string>>({});

  const loader = useCallback(async (): Promise<Snap[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("kpi_snapshots").select("metric, period, value").order("period", { ascending: false }).limit(96);
    if (error) throw new Error(error.message);
    return (data as Snap[]) ?? [];
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
        {(snaps) => (
          <div className="kpib">
            {KPIS.map((k) => {
              const mine = snaps.filter((s) => s.metric === k.key);
              const latest = mine[0]; const prior = mine[1];
              const trend = latest && prior ? (latest.value > prior.value ? "↑" : latest.value < prior.value ? "↓" : "→") : "";
              return (
                <div key={k.key} className="kpib-row">
                  <span className="kpib-l">{k.label}<i>{k.cadence}</i></span>
                  <span className="kpib-v">{latest ? `${k.unit === "$" ? "$" : ""}${latest.value.toLocaleString()}${k.unit === "%" ? "%" : ""}` : "—"}{trend && <i className={`kpib-t${trend === "↓" ? " down" : ""}`}>{trend}</i>}</span>
                  {isAdmin && (
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
