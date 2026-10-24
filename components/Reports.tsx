"use client";

import { useCallback, useEffect, useState } from "react";
import { SectionHeader } from "@/components/kit";
import { fetchSalesReport, salesWindowStart, type SalesReport } from "@/lib/reports";
import { moneyPlain, moneyRound } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { supabase } from "@/lib/supabase";
import { Segmented } from "@/components/controls";
import { useAsyncData } from "@/lib/useAsyncData";
import { channelRows, costBasisWords, type Channels } from "@/lib/home";
import AsyncSection from "./AsyncSection";
import { useAppStable } from "./AppProvider";

// Sales actuals — the first reporting dashboard (MONEY tab). Real revenue + per-event actuals +
// product mix + daily trend, read from one owner-and-admin RPC. On-brand bars, no chart dependency.
//
// A FAILED READ IS NOT A QUIET MONTH (2026-10-12). This read the report with a helper that turned any failure into
// null, and null drew "No sales recorded in the last 30 days" — the sentence for a month with no sales, said about a
// month nobody could read. It loads through useAsyncData now: a failure is "Couldn't read sales — this is not zero",
// with Try again, and a range that fails after another loaded says so above the numbers it is still showing.
//
// EACH NUMBER SAYS WHAT IT IS (2026-10-12, 0384). The average was all revenue over cup orders alone; each channel now
// shows its own orders and its own average (lib/home channelRows). The margin is an estimate and says what it rests on:
// how many of the menu's products are costed, or that 30% is assumed (lib/home costBasisWords).

const usd2 = (cents: number) => "$" + ((cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const RANGES = [7, 30, 90];

export default function Reports() {
  // A product's name is the Catalog's (R2, 2026-10-13: the report kept its own seven-drink list, so KING ME read "KINGME"
  // and a drink added in the Catalog its slug).
  const { nameOf } = useAppStable();
  const label = (k: string) => (k ? nameOf(k) : "—");
  const [days, setDays] = useState(30);
  const loader = useCallback(() => fetchSalesReport(days), [days]);
  const sales = useAsyncData<SalesReport>(loader, [loader]);

  // CASH AT THE WINDOW (2026-10-04, 0341). It is inside the revenue above — cash sets paid — and
  // said on its own because it is the one part of that number in a till rather than a bank: the
  // count to check the drawer against. Same window (lib/reports salesWindowStart) and same exclusions as report_sales. Its own
  // read, apart from the report's: a read that fails draws no line — never a zero that looks like a count.
  const [cash, setCash] = useState<{ cents: number; n: number } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      if (!supabase) return;
      const since = salesWindowStart(days);   // Eastern midnight of the report's first day, as report_sales counts (R18)
      const [o, p] = await Promise.all([
        supabase.from("orders").select("total_cents").eq("collected_via", "cash").neq("status", "void").gte("created_at", since),
        supabase.from("drop_orders").select("total_cents").eq("collected_via", "cash").is("canceled_at", null).gte("created_at", since),
      ]);
      if (!live) return;
      if (o.error || p.error) { setCash(null); return; }
      const got = [...((o.data ?? []) as { total_cents: number }[]), ...((p.data ?? []) as { total_cents: number }[])];
      setCash({ cents: got.reduce((a, r) => a + (r.total_cents || 0), 0), n: got.length });
    })();
    return () => { live = false; };
  }, [days]);

  return (
    <div className="adm-sec rpt">
      <SectionHeader label="Sales" annotation="the number" right={
        <Segmented label="Range" kind="choice" size="sm" value={String(days)} onChange={(k) => setDays(Number(k))}
          options={RANGES.map((d) => ({ key: String(d), label: `${d}d`, title: `The last ${d} days` }))} />
      } />

      <AsyncSection
        state={sales}
        isEmpty={(r) => (r.revenue_cents ?? 0) === 0 && (r.order_count ?? 0) === 0 && (r.by_event?.length ?? 0) === 0}
        emptyTitle={`No sales recorded in the last ${days} days`}
        emptySub="This fills in as orders come through."
        loadingLabel="Reading sales…"
        errorTitle="Couldn't read sales"
        errorSub="This is not zero — we could not read the sales report just now."
      >
        {(rep) => {
          const rev = rep.revenue_cents ?? 0;
          const cogs = rep.cogs_pct ?? 0.3;
          const margin = Math.round(rev * (1 - cogs));
          const basis = costBasisWords(rep.cogs_basis, cogs);
          // Each channel beside its own orders. A report from before 0384 counts cup orders alone, so only cups get an
          // average from it — never all revenue over the cups.
          const counts: Channels = rep.orders_by_channel ?? { cup: rep.order_count };
          const channels = channelRows(rep.by_channel ?? {}, counts);
          const orders = rep.orders_by_channel ? channels.reduce((n, c) => n + (c.orders ?? 0), 0) : null;
          const chMax = Math.max(1, ...channels.map((c) => c.cents));
          const evMax = Math.max(1, ...(rep.by_event ?? []).map((e) => e.cents));
          const prMax = Math.max(1, ...(rep.by_product ?? []).map((p) => p.n));
          const dayMax = Math.max(1, ...(rep.by_day ?? []).map((d) => d.cents));
          return (
            <>
              {/* A range that failed after another loaded: what follows is the last good read, and it says which. */}
              {sales.error && rep.days !== days && (
                <p className="rpt-hint" role="alert">
                  Couldn&apos;t read the last {days} days — still showing the last {rep.days}.{" "}
                  <button type="button" className="btn-ter" onClick={sales.reload}>Try again</button>
                </p>
              )}
              {/* R50: the rows shown, as a file (the console audit's point 10). */}
              <div className="flex justify-end mb-2">
                <button type="button" className="btn-sec btn-sm shrink-0" disabled={!(channels.length || rep.by_event?.length || rep.by_product?.length || rep.by_day?.length)}
                  onClick={() => void downloadCsv(`gt3-sales-${rep.days}d.csv`, [
                    ...channels.map((c) => ({ Section: "Channel", Name: c.label, Revenue: moneyPlain(c.cents), Count: c.orders ?? "" })),
                    ...(rep.by_event ?? []).map((e) => ({ Section: "Event", Name: e.event, Revenue: moneyPlain(e.cents), Count: "" })),
                    ...(rep.by_product ?? []).map((p) => ({ Section: "Product units", Name: label(p.key), Revenue: "", Count: p.n })),
                    ...(rep.by_day ?? []).map((d) => ({ Section: "Day", Name: d.day, Revenue: moneyPlain(d.cents), Count: "" })),
                  ])}>Export CSV</button>
              </div>
              {/* revenue is the hero; the rest is one quiet line (zero-tiles never render) */}
              <div className="rpt-hero"><b>{moneyRound(rev)}</b><span>revenue · {rep.days}d</span></div>
              {/* "estimate · 3 of 9 products costed" or "assumed 30%" says what kind of estimate; a report from before
                  0384 cannot say, and the line keeps its "est." */}
              <p className="rpt-line">
                {orders !== null ? `${orders.toLocaleString()} orders · ` : ""}{basis ? "margin" : "est. margin"} {moneyRound(margin)} at {Math.round((1 - cogs) * 100)}%{basis ? ` · ${basis}` : ""}
              </p>
              {cash && cash.cents > 0 && <p className="rpt-line">{usd2(cash.cents)} of it cash at the window · {cash.n} pre-order{cash.n === 1 ? "" : "s"}</p>}

              {channels.length > 0 && (
                <div className="rpt-block">
                  <div className="rpt-bh">By channel · each average from its own orders</div>
                  {channels.map((c) => (
                    <div key={c.channel} className="rpt-bar">
                      <div className="rpt-bar-l"><span>{c.label}</span><b>{moneyRound(c.cents)}</b></div>
                      <div className="rpt-track"><div className="rpt-fill" style={{ width: `${Math.max(3, (Math.max(0, c.cents) / chMax) * 100)}%` }} /></div>
                      {c.orders !== null && (
                        <div className="rpt-sub">
                          {c.orders.toLocaleString()} {c.channel === "square_walkup" ? (c.orders === 1 ? "sale" : "sales") : (c.orders === 1 ? "order" : "orders")}
                          {c.avgCents !== null ? ` · ${usd2(c.avgCents)} avg` : ""}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {(rep.by_event?.length ?? 0) > 0 && (
                <div className="rpt-block">
                  <div className="rpt-bh">Revenue by event</div>
                  {rep.by_event.map((e, i) => (
                    <div key={i} className="rpt-bar">
                      <div className="rpt-bar-l"><span>{e.event}</span><b>{moneyRound(e.cents)}</b></div>
                      <div className="rpt-track"><div className="rpt-fill" style={{ width: `${Math.max(3, (e.cents / evMax) * 100)}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}

              {(rep.by_product?.length ?? 0) > 0 && (
                <div className="rpt-block">
                  <div className="rpt-bh">Product mix · units</div>
                  {rep.by_product.map((p, i) => (
                    <div key={i} className="rpt-bar">
                      <div className="rpt-bar-l"><span>{label(p.key)}</span><b>{p.n.toLocaleString()}</b></div>
                      <div className="rpt-track"><div className="rpt-fill alt" style={{ width: `${Math.max(3, (p.n / prMax) * 100)}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}

              {(rep.by_day?.length ?? 0) > 0 && (
                <div className="rpt-block">
                  <div className="rpt-bh">Daily revenue</div>
                  <div className="rpt-spark">
                    {rep.by_day.map((d, i) => (
                      <div key={i} className="rpt-col" title={`${d.day}: ${moneyRound(d.cents)}`}>
                        <div className="rpt-colbar" style={{ height: `${Math.max(2, (d.cents / dayMax) * 100)}%` }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="rpt-foot">
                Live from orders + Square. Each channel&apos;s average is its own revenue over its own orders. The margin is an
                estimate: revenue × (1 − the menu&apos;s blended ingredient cost, {Math.round(cogs * 100)}%){basis ? ` — ${basis}` : ""}.
                A drink is costed when every ingredient in its recipe has a unit cost in inventory; the COGS calculator shows which.
              </div>
            </>
          );
        }}
      </AsyncSection>
    </div>
  );
}
