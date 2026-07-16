"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// MONEY KPIs — the "how are we doing?" answer that opens the Money section, so it reads as a
// dashboard instead of a list of doors. The headline revenue tile prefers the reconciled report_sales
// figure (0216) and falls back to summing all four app-recorded order channels client-side — cup +
// pack pickup + delivery + office, never just cups (it used to read `orders` alone, silently omitting
// three revenue streams) — only when that RPC is unavailable. See the comment at the RPC call below
// for the exact precedence. (An earlier version of THIS comment said the opposite — headline
// "deliberately NOT" the reconciled figure — true before 0216 existed, false since; only the comment
// hadn't caught up. Crew-console audit finding.) Every query is defensive (fails to "—"/skips) so a
// schema gap or missing table can never break the section — the number just goes quiet.
type Kpi = { k: string; v: string; sub: string };

const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const startOfWeek = () => { const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d.toISOString(); };

export default function MoneyKpis() {
  const [kpis, setKpis] = useState<Kpi[]>([
    { k: "week_rev", v: "—", sub: "Revenue · all channels · 7d" },
    { k: "today_orders", v: "—", sub: "Orders today" },
    { k: "subs", v: "—", sub: "Active subscribers" },
    { k: "reserves", v: "—", sub: "Pack pickups" },
    { k: "office_rev", v: "—", sub: "Office · 7 days" },
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
      // Headline = report_sales (0216): the ONE reconciled revenue basis — Square on-event + app
      // off-event + packs/delivery/office. The client-side channel sum below is the FALLBACK (and
      // still feeds the office tile). One definition of revenue everywhere; see 0216 for the basis.
      const rpc = await safe(() => supabase!.rpc("report_sales", { p_days: 7 }));
      const [cup, packs, deliv, office, orders, subs, reserves] = await Promise.all([
        safe(() => supabase!.from("orders").select("total_cents").eq("paid", true).neq("status", "void").gte("created_at", week)),
        safe(() => supabase!.from("drop_orders").select("total_cents").eq("paid", true).is("canceled_at", null).gte("created_at", week)),
        safe(() => supabase!.from("delivery_orders").select("total_cents").eq("payment_status", "paid").is("canceled_at", null).gte("created_at", week)),
        safe(() => supabase!.from("business_orders").select("total_cents").eq("payment_status", "paid").is("canceled_at", null).gte("created_at", week)),
        safe(() => supabase!.from("orders").select("id", { count: "exact", head: true }).neq("status", "void").gte("created_at", today)),
        safe(() => supabase!.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active")),
        safe(() => supabase!.from("drop_orders").select("id", { count: "exact", head: true }).is("canceled_at", null).gte("drop_date", today.slice(0, 10))),
      ]);
      if (!live) return;
      const sum = (q: Q) => (q.data ? q.data.reduce((s, o) => s + num(o.total_cents), 0) : null);
      const cupC = sum(cup), packC = sum(packs), delivC = sum(deliv), officeC = sum(office);
      // Headline: reconciled RPC first; else every channel that answered (never a silent cup-only total).
      const rec = (rpc as { data?: { revenue_cents?: number; error?: string } | null }).data;
      const recCents = rec && !rec.error && typeof rec.revenue_cents === "number" ? rec.revenue_cents : null;
      const anyRev = [cupC, packC, delivC, officeC].some((c) => c != null);
      const allRevOk = [cupC, packC, delivC, officeC].every((c) => c != null);
      const totalC = (cupC ?? 0) + (packC ?? 0) + (delivC ?? 0) + (officeC ?? 0);
      const revSub = anyRev && !allRevOk ? "Revenue · partial, a channel failed · 7d" : "Revenue · all channels · 7d";
      setKpis([
        recCents != null
          ? { k: "week_rev", v: money(recCents), sub: "Revenue · reconciled · 7d" }
          : { k: "week_rev", v: anyRev ? money(totalC) : "—", sub: revSub },
        { k: "today_orders", v: orders.count != null ? String(orders.count) : "—", sub: "Orders today" },
        { k: "subs", v: subs.count != null ? String(subs.count) : "—", sub: "Active subscribers" },
        { k: "reserves", v: reserves.count != null ? String(reserves.count) : "—", sub: "Pack pickups" },
        { k: "office_rev", v: officeC != null ? money(officeC) : "—", sub: "Office · 7 days" },
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
