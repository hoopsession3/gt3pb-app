"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "./Icon";
import { useRecord } from "./RecordSheet";
import { ageLabel, money, queueHeadline, statusLabel, waitingOn } from "@/lib/shopOrder";

// THE SHOP · ORDERS (0313) — the queue that /api/shop/checkout has been telling people to use.
//
// Its failure path raises an alert saying "It's paid and queued — submit it by hand." There was no
// queue. This is it, and it leads with the only number that asks anything of anyone: how many
// orders are waiting on US, and how long the oldest has been waiting. Everything else on this
// screen is context for that sentence.
//
// Deliberately NOT a table of every column. The row says who, what, how much and how old; the whole
// order opens in a sheet, addressed by ?r=shop_order:<id>, so it can be linked to from an alert, a
// customer record, or a message to somebody else. That addressability is the entire point of the
// record spine — a shop order was previously reachable from nowhere because it existed nowhere.

type Row = {
  id: string; created_at: string; status: string; who: string;
  customer_id: string | null; total_cents: number | null; items: string | null;
  unit_count: number | null; age_hours: number | null;
  tracking_number: string | null;
  waiting_on_us: boolean; waiting_on_printer: boolean; waiting_on_carrier: boolean; closed: boolean;
};
type Queue = {
  orders: number; on_us: number; on_printer: number; on_carrier: number; closed: number;
  gross_cents: number; refunded_cents: number; oldest_on_us_hours: number | null;
};
type Data = { queue: Queue | null; rows: Row[] };

const FILTERS = [
  { key: "open", label: "Needs us" },
  { key: "moving", label: "In flight" },
  { key: "all", label: "Everything" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

export default function ShopOrders() {
  const { openRecord } = useRecord();
  const [filter, setFilter] = useState<FilterKey>("open");

  const loader = useCallback(async (): Promise<Data> => {
    if (!supabase) return { queue: null, rows: [] };
    const [q, r] = await Promise.all([
      supabase.from("v_shop_queue").select("*").maybeSingle(),
      supabase.from("v_shop_orders").select(
        "id, created_at, status, who, customer_id, total_cents, items, unit_count, age_hours, tracking_number, waiting_on_us, waiting_on_printer, waiting_on_carrier, closed",
      ).order("created_at", { ascending: false }).limit(200),
    ]);
    if (r.error) throw new Error(r.error.message);
    return { queue: (q.data as Queue) ?? null, rows: (r.data as Row[]) ?? [] };
  }, []);
  const state = useAsyncData<Data>(loader, []);

  return (
    <>
      {/* NO SectionHeader here, deliberately. globals.css:4652 hides `.mpanel-body > * > .k-sec`
          — inside a Panel, the Panel's own title IS the section header, and a second one is dead
          markup. I shipped one anyway and only found out by looking at the rendered page: it was in
          the DOM, computing to display:none, and the one sentence explaining the panel was invisible.
          The sentence lives where it renders now — the headline below when there are orders, the
          empty state when there are none. */}
      {/* One empty state, from the shared component — not a second one written inline. The default
          isEmpty would see a truthy {queue, rows} object and never fire, which is exactly how a
          screen ends up with an unreachable empty state and a live one that looks different. */}
      <AsyncSection state={state} loadingLabel="Loading orders…" errorTitle="Couldn't load the orders"
                    isEmpty={({ rows }) => rows.length === 0}
                    emptyTitle="The shop is quiet"
                    emptySub="No merch orders yet. When one lands it shows up here — which is new: until today nothing in this console could display a shop order at all.">
        {({ queue, rows }) => {
          const shown = rows.filter((r) =>
            filter === "all" ? true
              : filter === "open" ? r.waiting_on_us
                : !r.closed && !r.waiting_on_us);

          return (
            <>
              {/* the one line that asks something of somebody ─────────────────────────────── */}
              <p className={`so-head${Number(queue?.on_us ?? 0) > 0 ? " due" : ""}`}>
                {queueHeadline(queue)}
              </p>

              <div className="so-kpis">
                <span className="so-kpi"><b>{queue?.on_us ?? 0}</b><i>on us</i></span>
                <span className="so-kpi"><b>{queue?.on_printer ?? 0}</b><i>at the printer</i></span>
                <span className="so-kpi"><b>{queue?.on_carrier ?? 0}</b><i>in transit</i></span>
                <span className="so-kpi"><b>{money(queue?.gross_cents ?? 0)}</b><i>taken</i></span>
                {Number(queue?.refunded_cents ?? 0) > 0 &&
                  <span className="so-kpi"><b>{money(queue?.refunded_cents ?? 0)}</b><i>refunded</i></span>}
              </div>

              <div className="so-filters">
                {FILTERS.map((f) => (
                  <button type="button" key={f.key}
                          className={`so-filter${filter === f.key ? " on" : ""}`}
                          onClick={() => setFilter(f.key)}>
                    {f.label}
                  </button>
                ))}
              </div>

              {shown.length === 0 ? (
                <p className="cp-line dim">
                  {filter === "open" ? "Nothing waiting on us." : "Nothing here right now."}
                </p>
              ) : (
                <div className="so-rows">
                  {shown.map((r) => {
                    const owed = waitingOn(r.status);
                    return (
                      <button type="button" key={r.id} className="so-row"
                              onClick={() => openRecord("shop_order", r.id)}>
                        <span className="so-row-b">
                          <b>{r.who}</b>
                          <i>{r.items || `${r.unit_count ?? 0} item(s)`}</i>
                        </span>
                        <span className="so-row-m">
                          <b>{money(r.total_cents)}</b>
                          <i>{ageLabel(r.age_hours)}</i>
                        </span>
                        <span className={`so-pill so-${owed}`}>{statusLabel(r.status)}</span>
                        <span className="so-row-c" aria-hidden="true"><Icon name="arrowRight" /></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          );
        }}
      </AsyncSection>
    </>
  );
}
