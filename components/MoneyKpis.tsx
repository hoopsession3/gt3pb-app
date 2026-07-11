"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// MONEY KPIs — the "how are we doing?" answer that opens the Money section, so it reads as a
// dashboard instead of a list of doors. Four live tiles: revenue this week, orders today, active
// subscribers, reserves on the books. Every query is defensive (fails to "—") so a schema gap or a
// missing table can never break the section — the number just goes quiet.
type Kpi = { k: string; v: string; sub: string };

const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const startOfWeek = () => { const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d.toISOString(); };

export default function MoneyKpis() {
  const [kpis, setKpis] = useState<Kpi[]>([
    { k: "week_rev", v: "—", sub: "Revenue · 7 days" },
    { k: "today_orders", v: "—", sub: "Orders today" },
    { k: "subs", v: "—", sub: "Active subscribers" },
    { k: "reserves", v: "—", sub: "Reserves on the books" },
  ]);

  useEffect(() => {
    if (!supabase) return;
    let live = true;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
    // Each read is isolated: a failure (missing table/column/permission) yields {}, never throws.
    type Q = { data?: { total_cents: number }[] | null; count?: number | null };
    const safe = async (run: () => PromiseLike<unknown>): Promise<Q> => {
      try { return (await run()) as Q; } catch { return {}; }
    };
    (async () => {
      const today = startOfToday();
      const week = startOfWeek();
      const [rev, orders, subs, reserves] = await Promise.all([
        safe(() => supabase!.from("orders").select("total_cents").eq("paid", true).neq("status", "void").gte("created_at", week)),
        safe(() => supabase!.from("orders").select("id", { count: "exact", head: true }).neq("status", "void").gte("created_at", today)),
        safe(() => supabase!.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active")),
        safe(() => supabase!.from("drop_orders").select("id", { count: "exact", head: true }).is("canceled_at", null).gte("drop_date", today.slice(0, 10))),
      ]);
      if (!live) return;
      const revCents = rev.data?.reduce((s, o) => s + num(o.total_cents), 0);
      setKpis([
        { k: "week_rev", v: rev.data ? money(revCents ?? 0) : "—", sub: "Revenue · 7 days" },
        { k: "today_orders", v: orders.count != null ? String(orders.count) : "—", sub: "Orders today" },
        { k: "subs", v: subs.count != null ? String(subs.count) : "—", sub: "Active subscribers" },
        { k: "reserves", v: reserves.count != null ? String(reserves.count) : "—", sub: "Reserves booked" },
      ]);
    })();
    return () => { live = false; };
  }, []);

  return (
    <div className="mkpi" role="group" aria-label="Money at a glance">
      {kpis.map((t) => (
        <div className="mkpi-tile" key={t.k}>
          <div className="mkpi-v">{t.v}</div>
          <div className="mkpi-k">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}
