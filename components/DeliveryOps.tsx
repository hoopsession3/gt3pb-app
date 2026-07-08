"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { PERF_BASES, PERF_ADDINS, perfKey, type PerfMix } from "@/lib/delivery";

// SUNDAY DELIVERY OPS — the crew side of the delivery debrief, in DropOps' shape: one summary
// sentence (units, one hero thought), the Saturday brew totals (incl. Performance combos), and a
// name-by-name run list that folds until delivery day. Driver logs one of three outcomes per stop;
// "held" flips the order into the pickup queue and raises a crew alert. Realtime like everything
// else — channel name unique per subscription (the twice-shipped crash class).

type DOrder = {
  id: string; name: string; phone: string | null;
  address_street: string; address_city: string; address_zip: string; access_instructions: string | null;
  pack_size: number; rise_count: number; flow_count: number; dusk_count: number;
  performance_count: number; performance_mix: PerfMix; refill_count: number; new_count: number;
  total_cents: number; payment_status: string; status: string;
  driver_outcome: string | null; empties_expected: number; empties_collected: number | null;
  delivery_date: string; canceled_at: string | null;
};

const STATUS_NEXT: Record<string, string> = { received: "brewed", brewed: "out_for_delivery" };
const STATUS_LABEL: Record<string, string> = {
  received: "Received", brewed: "Brewed", out_for_delivery: "Out for delivery",
  delivered: "Delivered", held_for_pickup: "HELD — pickup", issue: "Issue",
};
const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const BASE_LABEL: Record<string, string> = { rise: "RISE", flow: "FLOW", dusk: "DUSK" };
const ADDIN_LABEL: Record<string, string> = { mct_oil: "MCT", grass_fed_butter: "butter" };

let dlChanSeq = 0;
export default function DeliveryOps() {
  const { toast } = useApp();
  const [rows, setRows] = useState<DOrder[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    // the next delivery day with anything on it (today counts — Sunday IS the run)
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase.from("delivery_orders").select("*")
      .gte("delivery_date", today).is("canceled_at", null)
      .order("delivery_date").order("address_zip").limit(200);
    const all = (data ?? []) as DOrder[];
    const d = all[0]?.delivery_date ?? null;
    setDate(d);
    setRows(all.filter((o) => o.delivery_date === d));
  }, []);

  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel(`delivery-ops-${++dlChanSeq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_orders" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  const setStatus = async (o: DOrder, status: string) => {
    if (!supabase) return;
    await supabase.from("delivery_orders").update({ status }).eq("id", o.id);
    load();
  };
  const outcome = async (o: DOrder, kind: "swap_completed" | "delivered_fresh_no_empties" | "held_no_empties") => {
    if (!supabase) return;
    if (kind === "swap_completed") {
      const got = typeof window !== "undefined" ? window.prompt(`Empties picked up? (expected ${o.empties_expected})`, String(o.empties_expected)) : null;
      if (got == null) return;
      await supabase.from("delivery_orders").update({ driver_outcome: kind, status: "delivered", empties_collected: Math.max(0, parseInt(got, 10) || 0) }).eq("id", o.id);
    } else if (kind === "delivered_fresh_no_empties") {
      const note = typeof window !== "undefined" ? window.prompt("No empties — delivering fresh anyway. Why? (logged)", "") : null;
      if (note == null) return;
      await supabase.from("delivery_orders").update({ driver_outcome: kind, status: "delivered", empties_collected: 0, driver_note: note.slice(0, 300) }).eq("id", o.id);
      toast("Logged — margin absorbed this once");
    } else {
      await supabase.from("delivery_orders").update({ driver_outcome: kind, status: "held_for_pickup", empties_collected: 0 }).eq("id", o.id);
      await supabase.from("alerts").insert({
        severity: "important", category: "orders", title: "Delivery held — pickup queue",
        body: `${o.name} — no empties out. ${o.pack_size} bottles held at GT3PB for pickup 10 AM – 2 PM. ${o.phone ?? ""}`.trim(),
        link: "/admin?s=now",
      });
      toast("Held for pickup — crew alerted");
    }
    load();
  };

  if (!date || rows.length === 0) return null; // quiet until a delivery exists

  const bottles = rows.reduce((a, o) => a + o.pack_size, 0);
  const refills = rows.reduce((a, o) => a + o.refill_count, 0);
  const fresh = rows.reduce((a, o) => a + o.new_count + o.performance_count, 0);
  const revenue = rows.reduce((a, o) => a + o.total_cents, 0);
  const perF = { RISE: 0, FLOW: 0, DUSK: 0 } as Record<string, number>;
  rows.forEach((o) => { perF.RISE += o.rise_count; perF.FLOW += o.flow_count; perF.DUSK += o.dusk_count; });
  const perfCombos: Record<string, number> = {};
  rows.forEach((o) => PERF_BASES.forEach((b) => PERF_ADDINS.forEach((a) => {
    const c = o.performance_mix?.[perfKey(b, a)] || 0;
    if (c) perfCombos[`${BASE_LABEL[b]} + ${ADDIN_LABEL[a]}`] = (perfCombos[`${BASE_LABEL[b]} + ${ADDIN_LABEL[a]}`] || 0) + c;
  })));
  const heldQueue = rows.filter((o) => o.status === "held_for_pickup");
  const doneCount = rows.filter((o) => o.status === "delivered" || o.status === "held_for_pickup").length;
  const isRunDay = date === new Date().toISOString().slice(0, 10);
  const showList = listOpen ?? isRunDay;
  const dLabel = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="dops zone-delivery">
      <div className="dops-head"><span className="dops-kick">🚚 Delivery · Sunday porch run</span><b>{dLabel} · {rows.length} order{rows.length === 1 ? "" : "s"}</b></div>
      <p className="dops-sum">
        <b>{bottles}</b> bottles ({refills} refills · {fresh} fresh) · <b>{dollars(revenue)}</b> paid on order
        {heldQueue.length > 0 && <> · <b className="dl-held">{heldQueue.length} held for pickup</b></>}
      </p>
      <div className="dops-brew">Brew: <b>{(["RISE", "FLOW", "DUSK"] as const).filter((f) => perF[f] > 0).map((f) => `${perF[f]}× ${f}`).join(" · ") || "—"}</b>
        {Object.keys(perfCombos).length > 0 && <> · Performance: <b>{Object.entries(perfCombos).map(([k, n]) => `${n}× ${k}`).join(" · ")}</b></>}
      </div>
      <button type="button" className="dops-prog" onClick={() => setListOpen(!showList)} aria-expanded={showList}>
        <span><b>{doneCount}/{rows.length}</b> stops done</span>
        <span>{showList ? "▾" : "▸"}</span>
      </button>
      {showList && rows.map((o) => (
        <div className={`dops-order${o.status === "delivered" ? " done" : ""}`} key={o.id}>
          <div className="dops-top">
            <span className="dops-name">{o.name}
              {o.refill_count > 0 && <span className="dops-chip ret">SWAP ×{o.refill_count}</span>}
              <span className={`dops-chip ${o.status === "held_for_pickup" ? "new" : "ret"}`}>{STATUS_LABEL[o.status]}</span>
            </span>
            <span className="dops-total">{dollars(o.total_cents)} ✓</span>
          </div>
          <div className="dops-meta">
            <b>{o.pack_size} bottles</b> — {[o.rise_count && `${o.rise_count}× RISE`, o.flow_count && `${o.flow_count}× FLOW`, o.dusk_count && `${o.dusk_count}× DUSK`, o.performance_count && `${o.performance_count}× PERF`].filter(Boolean).join(" · ")}
            <br />{o.address_street}, {o.address_city} {o.address_zip}{o.access_instructions ? <> · <em>{o.access_instructions}</em></> : null}
            {o.phone ? <> · <a className="dops-tel" href={`tel:${o.phone.replace(/[^\d+]/g, "")}`}>{o.phone}</a></> : null}
            {o.empties_collected != null && o.empties_collected !== o.empties_expected && (
              <><br /><em className="dl-held">Empties short: {o.empties_collected}/{o.empties_expected}</em></>
            )}
          </div>
          <div className="dops-actions">
            {STATUS_NEXT[o.status] && (
              <button type="button" className="dops-check" onClick={() => setStatus(o, STATUS_NEXT[o.status])}>→ {STATUS_LABEL[STATUS_NEXT[o.status]]}</button>
            )}
            {o.status === "out_for_delivery" && (
              <>
                <button type="button" className="dops-check" onClick={() => outcome(o, "swap_completed")}>✓ Swap done</button>
                <button type="button" className="dops-mini" onClick={() => outcome(o, "delivered_fresh_no_empties")}>Fresh anyway</button>
                <button type="button" className="dops-mini danger" onClick={() => outcome(o, "held_no_empties")}>No empties — hold</button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
