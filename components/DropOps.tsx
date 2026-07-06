"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { FLAVORS, nextDrop, mixSummary, dollars, type GlassPath, type Mix } from "@/lib/orderAhead";

// DROP OPS — the order-ahead brew sheet + pickup checklist for Saturday's drop. Lives in the admin
// "Now" section right under the kitchen pass, so walk-up orders and reservations are one surface.
// Realtime like the KDS; staff-gated by RLS (staff read + manage on drop_orders, migration 0119).
type DropOrder = {
  id: string; name: string; phone: string | null; size: number; glass: GlassPath;
  mix: Mix; total_cents: number; drop_date: string; picked_up: boolean; bottles_returned: boolean;
};

export default function DropOps() {
  const [rows, setRows] = useState<DropOrder[]>([]);
  const sat = nextDrop().sat;
  const dropISO = sat.toISOString().slice(0, 10);
  const satLabel = sat.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("drop_orders").select("*").eq("drop_date", dropISO).order("created_at");
    if (data) setRows(data as DropOrder[]);
  }, [dropISO]);

  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("drop-ops")
      .on("postgres_changes", { event: "*", schema: "public", table: "drop_orders" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  const toggle = async (id: string, key: "picked_up" | "bottles_returned", val: boolean) => {
    if (!supabase) return;
    setRows((r) => r.map((o) => (o.id === id ? { ...o, [key]: val } : o))); // optimistic
    await supabase.from("drop_orders").update({ [key]: val }).eq("id", id);
  };

  const bottles = rows.reduce((a, o) => a + o.size, 0);
  const glassBack = rows.filter((o) => o.glass === "return").reduce((a, o) => a + o.size, 0);
  const revenue = rows.reduce((a, o) => a + o.total_cents, 0) / 100;
  const perF: Record<string, number> = { RISE: 0, FLOW: 0, DUSK: 0 };
  rows.forEach((o) => FLAVORS.forEach((f) => { perF[f] += o.mix?.[f] || 0; }));

  return (
    <div className="dops">
      <div className="dops-head"><span className="dops-kick">Order-ahead · pickup checklist</span><b>{satLabel}&rsquo;s drop</b></div>
      <div className="dops-stats">
        <div className="dops-stat"><div className="sv">{bottles}</div><div className="sk">Brew</div></div>
        <div className="dops-stat"><div className="sv">{glassBack}</div><div className="sk">Glass back</div></div>
        <div className="dops-stat"><div className="sv">{dollars(Math.round(revenue))}</div><div className="sk">Revenue</div></div>
      </div>
      {rows.length === 0 ? (
        <div className="dops-empty">No reservations yet for this drop.</div>
      ) : (
        <>
          <div className="dops-brew">Brew sheet: <b>{FLAVORS.map((f) => `${perF[f]}× ${f}`).join(" · ")}</b></div>
          {rows.map((o) => (
            <div className="dops-order" key={o.id}>
              <div className="dops-top">
                <span className="dops-name">{o.name}
                  <span className={`dops-chip ${o.glass === "return" ? "ret" : "new"}`}>{o.glass === "return" ? `GLASS BACK ×${o.size}` : "NEW GLASS"}</span>
                </span>
                <span className="dops-total">{dollars(o.total_cents / 100)} ✓</span>
              </div>
              <div className="dops-meta"><b>{o.size}-pack</b> — {mixSummary(o.mix)}{o.phone ? <><br />{o.phone}</> : null}</div>
              <div className="dops-actions">
                <button type="button" className={`dops-check${o.picked_up ? " done" : ""}`} onClick={() => toggle(o.id, "picked_up", !o.picked_up)}>{o.picked_up ? "✓ Picked up" : "Picked up"}</button>
                {o.glass === "return" && (
                  <button type="button" className={`dops-check${o.bottles_returned ? " done" : ""}`} onClick={() => toggle(o.id, "bottles_returned", !o.bottles_returned)}>{o.bottles_returned ? "✓ Bottles in" : "Bottles in"}</button>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
