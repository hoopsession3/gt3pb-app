"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// CUSTOMER KPIs — the glance that opens the Customers section, mirroring MoneyKpis so the tab reads as
// a dashboard, not a stack of panels. Five live tiles: total customers, members, founding, new this
// week, and live discount codes. Every query is defensive (fails to "—") so a schema gap can never
// break the section — the number just goes quiet.
type Kpi = { k: string; v: string; sub: string };

const startOfWeek = () => { const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d.toISOString(); };

export default function CustomerKpis() {
  const [kpis, setKpis] = useState<Kpi[]>([
    { k: "total", v: "—", sub: "Customers" },
    { k: "members", v: "—", sub: "Members" },
    { k: "founding", v: "—", sub: "Founding" },
    { k: "new", v: "—", sub: "New · 7 days" },
    { k: "codes", v: "—", sub: "Live codes" },
  ]);

  useEffect(() => {
    if (!supabase) return;
    let live = true;
    type Q = { count?: number | null };
    const safe = async (run: () => PromiseLike<unknown>): Promise<Q> => {
      try { return (await run()) as Q; } catch { return {}; }
    };
    (async () => {
      const week = startOfWeek();
      const [total, members, founding, fresh, codes] = await Promise.all([
        safe(() => supabase!.from("customers").select("id", { count: "exact", head: true })),
        safe(() => supabase!.from("customers").select("id", { count: "exact", head: true }).not("user_id", "is", null)),
        safe(() => supabase!.from("customers").select("id", { count: "exact", head: true }).eq("tier", "founding")),
        safe(() => supabase!.from("customers").select("id", { count: "exact", head: true }).gte("created_at", week)),
        safe(() => supabase!.from("member_benefits").select("id", { count: "exact", head: true }).eq("scope", "code").eq("active", true)),
      ]);
      if (!live) return;
      const v = (q: Q) => (q.count != null ? String(q.count) : "—");
      setKpis([
        { k: "total", v: v(total), sub: "Customers" },
        { k: "members", v: v(members), sub: "Members" },
        { k: "founding", v: v(founding), sub: "Founding" },
        { k: "new", v: v(fresh), sub: "New · 7 days" },
        { k: "codes", v: v(codes), sub: "Live codes" },
      ]);
    })();
    return () => { live = false; };
  }, []);

  return (
    <div className="mkpi" role="group" aria-label="Customers at a glance">
      {kpis.map((t) => (
        <div className="mkpi-tile" key={t.k}>
          <div className="mkpi-v">{t.v}</div>
          <div className="mkpi-k">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}
