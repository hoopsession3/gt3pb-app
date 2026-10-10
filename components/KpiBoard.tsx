"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { SectionHeader, InfoRow } from "@/components/kit";
import Sheet, { CloseButton, LeaveButton } from "@/components/Sheet";
import { etToday, weekStartKey } from "@/lib/dates";
import { toMarket, MARKET_LABEL } from "@/lib/markets";

/* eslint-disable @typescript-eslint/no-explicit-any */
// THE TWELVE (0264 · Playbook v1 §12; 0268 flipped the board live) — every KPI in the strategy,
// defined once. Eleven now compute from their source objects (orders, the activity ledger, coupon
// codes on orders, the Loop ledger) exactly as p.14 mapped them; manual Monday entry remains for
// bottle_return (no per-bottle sales count exists yet — honesty over a proxy) and as the fallback
// whenever a live source has nothing to say. Same-week re-entry updates in place; history accrues.

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

// Live-computable metrics (2026-08-03, Ryan: "I can start tracking all"; 0268 flipped eight more).
// Eleven of the twelve now read straight from their source objects — orders, the activity ledger,
// recorded benefit codes, the Loop ledger — and show a LIVE chip with no manual entry. Each block
// is isolated: a missing table (pre-migration) or empty source just leaves that metric on Monday
// entry. bottle_return stays manual ON PURPOSE: its denominator is bottles SOLD, which no object
// counts per-bottle yet — wiring it to a proxy would be a prettier guess, not a measurement.
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
  try {   // MRR (monthly): the live/expand book, straight off the pipeline's per-account MRR fields
    const { data } = await supabase.from("opportunities").select("mrr_cents, stage").in("stage", ["live", "expand"]);
    const rows = ((data ?? []) as any[]).filter((o) => typeof o.mrr_cents === "number" && o.mrr_cents > 0);
    if (rows.length > 0) out.mrr = Math.round(rows.reduce((s, o) => s + o.mrr_cents, 0) / 100);
  } catch { /* stays manual */ }
  try {   // The activity-ledger family (0268): one fetch, five derivations
    const d35 = new Date(Date.now() - 35 * 864e5).toISOString().slice(0, 10);
    const { data, error } = await supabase.from("account_activities")
      .select("opportunity_id, type, on_date, bottles, pulled, stock_after, sampled, buyers, revenue_cents").gte("on_date", d35);
    if (!error && data) {
      const acts = data as any[];
      const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const d7 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      // Avg revenue / event: pop-ups + events with revenue, 30d
      const evs = acts.filter((a) => (a.type === "popup" || a.type === "event") && a.on_date >= d30 && typeof a.revenue_cents === "number");
      if (evs.length > 0) out.rev_event = Math.round(evs.reduce((s, a) => s + a.revenue_cents, 0) / 100 / evs.length);
      // Bottles/wk per cooler: restocked bottles ÷ distinct locations, 7d
      const rst7 = acts.filter((a) => a.type === "restock" && a.on_date >= d7 && typeof a.bottles === "number");
      if (rst7.length > 0) out.bottles_cooler = Math.round(rst7.reduce((s, a) => s + a.bottles, 0) / new Set(rst7.map((a) => a.opportunity_id)).size);
      // Sample → purchase: buyers ÷ sampled across activations, 30d
      const smp = acts.filter((a) => a.on_date >= d30 && typeof a.sampled === "number" && a.sampled > 0);
      const sampled = smp.reduce((s, a) => s + a.sampled, 0);
      if (sampled > 0) out.sample_purchase = Math.round((smp.reduce((s, a) => s + (a.buyers ?? 0), 0) / sampled) * 100);
      // Sell-through & spoilage: consecutive restock pairs per location — sold between visits =
      // (last visit's shelf + this visit's adds) − pulled − shelf on leaving. Needs shelf counts.
      const byOpp = new Map<string, any[]>();
      for (const a of acts.filter((x) => x.type === "restock")) { const l = byOpp.get(a.opportunity_id) ?? []; l.push(a); byOpp.set(a.opportunity_id, l); }
      let stocked = 0, sold = 0, pulled = 0;
      for (const rows of byOpp.values()) {
        rows.sort((a, b) => String(a.on_date).localeCompare(String(b.on_date)));
        for (let i = 1; i < rows.length; i++) {
          const prev = rows[i - 1], cur = rows[i];
          if (prev.stock_after == null || cur.stock_after == null) continue;
          const base = prev.stock_after + (cur.bottles ?? 0);
          const s = Math.max(0, base - (cur.pulled ?? 0) - cur.stock_after);
          stocked += base; sold += s; pulled += cur.pulled ?? 0;
        }
      }
      if (stocked > 0) { out.sell_through = Math.round((sold / stocked) * 100); out.spoilage = Math.round((pulled / stocked) * 100); }
    }
  } catch { /* stays manual */ }
  try {   // Coupon redemptions (weekly): VALIDATED codes recorded on orders at checkout (0268)
    const [a, b] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).not("benefit_code", "is", null).gte("created_at", week),
      supabase.from("drop_orders").select("id", { count: "exact", head: true }).not("benefit_code", "is", null).gte("created_at", week),
    ]);
    if (a.count != null || b.count != null) out.coupon_redeem = (a.count ?? 0) + (b.count ?? 0);
  } catch { /* stays manual */ }
  try {   // Loop participation (monthly): return transactions ÷ paid orders
    const [lt, ao] = await Promise.all([
      supabase.from("loop_txns").select("id", { count: "exact", head: true }).gte("on_date", monthStart),
      supabase.from("all_orders").select("total_cents, payment_status, created_at").gte("created_at", `${monthStart}T00:00:00`),
    ]);
    const paidN = ((ao.data ?? []) as any[]).filter((o) => o.payment_status === "paid").length;
    if (lt.count != null && paidN > 0) out.loop_part = Math.round((lt.count / paidN) * 100);
  } catch { /* stays manual */ }
  return out;
}

// THE NUMBERS AT REST (2026-10-10, the Command fold). The board opened as twelve fields with a Log button
// each — an editor left open, read once a week and typed into once a week — under a paragraph about the
// method. It is a read view now: each number, what it was set to, and how it moved since the period before
// (its last two entries), coloured by whether that is the good way. The Monday entry is one sheet with the
// numbers that do not compute themselves, opened from the head. Same writes as before: same-period re-entry
// updates in place, a weekly figure under its Monday, a monthly one under the 1st.
type Row = { key: string; label: string; unit: string; cadence: string; isLive: boolean; shown: number | undefined; change: { text: string; good: boolean } | null };
// Spoilage is the one where down is the good way.
const LOWER_IS_BETTER = new Set(["spoilage"]);
const fmt = (unit: string, v: number) => `${unit === "$" ? "$" : ""}${Number(v).toLocaleString()}${unit === "%" ? "%" : ""}`;
function changeOf(k: { key: string; unit: string }, latest?: Snap, prior?: Snap): Row["change"] {
  if (!latest || !prior) return null;
  const d = Math.round((latest.value - prior.value) * 100) / 100;
  if (d === 0) return { text: "no change", good: true };
  const sign = d > 0 ? "+" : "−";
  const a = Math.abs(d).toLocaleString();
  const text = k.unit === "$" ? `${sign}$${a}` : k.unit === "%" ? `${sign}${a} pts` : `${sign}${a}`;
  return { text, good: LOWER_IS_BETTER.has(k.key) ? d < 0 : d > 0 };
}

export default function KpiBoard() {
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const isAdmin = !!profile?.is_admin || ["owner", "admin"].includes(String((profile as any)?.role ?? ""));
  const [entry, setEntry] = useState<Record<string, string>>({});
  const [logging, setLogging] = useState(false);
  const [saving, setSaving] = useState(false);
  // ONE CITY'S TWELVE: the board reads the market it writes. 0275 keyed snapshots by market; the
  // read took the newest 96 of every city, so the moment a second city logged a figure the
  // "latest" here could be Atlanta's under Greenville's entry.
  const market = toMarket(profile?.market);

  const loader = useCallback(async (): Promise<BoardData> => {
    if (!supabase) return { snaps: [], live: {} };
    const [{ data, error }, live] = await Promise.all([
      supabase.from("kpi_snapshots").select("metric, period, value").eq("market", market).order("period", { ascending: false }).limit(96),
      computeLive(),
    ]);
    if (error) throw new Error(error.message);
    return { snaps: (data as Snap[]) ?? [], live };
  }, [market]);
  const state = useAsyncData(loader, [market]);
  useRealtimeTable(["kpi_snapshots"], state.reload);

  // FILED WHERE THE BOARD SAYS IT IS (2026-10-04, the form audit). 0275 widened the unique key to
  // (metric, period, market) so each city keeps its own KPIs; this upsert still named the old
  // (metric, period), which Postgres refuses outright (42P10, "no unique or exclusion constraint
  // matching the ON CONFLICT specification") — every "Log" since 0275 failed. And the period was
  // the day, so "same week re-entry updates in place" filed each entry beside the last: a weekly
  // figure goes under its week's Monday now, a monthly one under the 1st, the rest under the day.
  const periodOf = (key: string) => {
    const today = etToday();
    const cadence = KPIS.find((k) => k.key === key)?.cadence;
    return cadence === "weekly" ? weekStartKey(today) : cadence === "monthly" ? `${today.slice(0, 8)}01` : today;
  };
  const typed = Object.entries(entry).filter(([, raw]) => raw.trim() !== "");
  const saveAll = async () => {
    if (!supabase || saving || typed.length === 0) return;
    const bad = typed.filter(([, raw]) => !Number.isFinite(Number(raw.trim())));
    if (bad.length) { toast("Numbers only", "error"); return; }
    setSaving(true);
    const rows = typed.map(([key, raw]) => ({ metric: key, period: periodOf(key), value: Number(raw.trim()), market, created_by: user?.id ?? null }));
    const { error } = await supabase.from("kpi_snapshots").upsert(rows, { onConflict: "metric,period,market" });
    setSaving(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    setEntry({}); setLogging(false);
    toast(rows.length === 1 ? "Logged" : `Logged ${rows.length}`); state.reload();
  };

  return (
    <div className="adm-sec" id="cmd-kpis">
      <SectionHeader label="The twelve" annotation={MARKET_LABEL[market]}
        right={isAdmin ? <button type="button" className="btn-ter" onClick={() => setLogging(true)}>Log numbers</button> : undefined} />
      <AsyncSection state={state} isEmpty={() => false} emptyTitle="—" loadingLabel="Loading KPIs…" errorTitle="Couldn't load KPIs">
        {({ snaps, live }) => {
          const rows: Row[] = KPIS.map((k) => {
            const isLive = live[k.key] !== undefined;
            const mine = snaps.filter((s) => s.metric === k.key);
            return { ...k, isLive, shown: isLive ? live[k.key] : mine[0]?.value, change: isLive ? null : changeOf(k, mine[0], mine[1]) };
          });
          const manual = rows.filter((r) => !r.isLive);
          return (
            <>
              <div className="k-rows">
                {rows.map((r) => (
                  <InfoRow key={r.key} name={r.label}
                    sub={`${r.cadence[0].toUpperCase()}${r.cadence.slice(1)}${r.isLive ? " · live" : ""}`}
                    trailing={(
                      <span className="flex flex-col items-end tabular-nums">
                        <b className="font-mono text-cream">{r.shown !== undefined ? fmt(r.unit, r.shown) : "—"}</b>
                        {r.change && <span className={`text-caption ${r.change.good ? "text-ok" : "text-warn"}`}>{r.change.text}</span>}
                      </span>
                    )} />
                ))}
              </div>
              {logging && (
                <Sheet open onClose={() => setLogging(false)} label="Log the numbers" dirty={typed.length > 0}
                  header={<div className="note-lux-head"><span className="note-lux-eyb">The twelve · {MARKET_LABEL[market]}</span><CloseButton onClick={() => setLogging(false)} /></div>}
                  footer={<div className="note-actions"><LeaveButton className="btn-sec" onClick={() => setLogging(false)}>Cancel</LeaveButton><button type="button" className="btn-pri" disabled={saving || typed.length === 0} onClick={saveAll}>{saving ? "Saving…" : typed.length > 1 ? `Log ${typed.length}` : "Log it"}</button></div>}>
                  <p className="h-sub">The ones that don&apos;t compute themselves. A weekly number files under this week&apos;s Monday, a monthly one under the 1st; logging again in the same period replaces it.</p>
                  {manual.length === 0 ? <p className="h-sub">All twelve compute themselves right now.</p> : manual.map((r) => (
                    <label key={r.key} className="prod-f"><span>{r.label} · {r.cadence}{r.shown !== undefined ? ` · now ${fmt(r.unit, r.shown)}` : ""}</span>
                      <input inputMode="decimal" placeholder={r.unit} value={entry[r.key] ?? ""} onChange={(e) => setEntry((s) => ({ ...s, [r.key]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") void saveAll(); }} aria-label={`Enter ${r.label}`} /></label>
                  ))}
                </Sheet>
              )}
            </>
          );
        }}
      </AsyncSection>
    </div>
  );
}
