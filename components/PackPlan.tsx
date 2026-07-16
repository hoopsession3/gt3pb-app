"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import Sheet from "@/components/Sheet";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "@/components/Icon";

// PACK PLAN — the whole event/stop's pack-out in one view: take every batch brewing for it, split each
// between KEGS (poured on tap) and 10/16oz BOTTLES (grab-and-go in the cooler), and allocate the keg
// gallons across the REAL keg fleet (shared — a keg holds one product). Totals roll up to bottles +
// UVDTF labels + coolers needed, and it flags when you're short on bottle stock or keg space.
// Fetch state via useAsyncData — a failed load is a real error now, not a silent "No batches tied to
// this event yet" (which used to mean two very different things).

type Batch = { id: string; recipe_name: string | null; batch_gal: number; status: string };
type Board = { batches: Batch[]; fleet: { cap: number; qty: number }[] };

// Fill `need` gal from a SHARED, mutable fleet (decrements it): smallest keg that covers the
// remainder, else the largest available. Returns the kegs used for this batch + any shortfall.
function fillFromFleet(need: number, fleet: { cap: number; qty: number }[]) {
  const used: Record<number, number> = {};
  let remaining = need, guard = 0;
  while (remaining > 0.001 && guard++ < 100) {
    const avail = fleet.filter((k) => k.qty > 0);
    if (!avail.length) break;
    const covers = avail.filter((k) => k.cap >= remaining - 0.001).sort((a, b) => a.cap - b.cap);
    const pick = covers[0] ?? avail.slice().sort((a, b) => b.cap - a.cap)[0];
    pick.qty--; used[pick.cap] = (used[pick.cap] || 0) + 1; remaining -= pick.cap;
  }
  return { plan: Object.entries(used).map(([cap, count]) => ({ cap: Number(cap), count })), shortfall: Math.max(0, remaining) };
}
const kegStr = (plan: { cap: number; count: number }[]) => plan.map((k) => `${k.count}× ${k.cap}gal`).join(" + ");

export default function PackPlan({ ownerType, ownerId, title, onClose }: { ownerType: "event" | "stop"; ownerId: string; title: string; onClose: () => void }) {
  const ownerCol = ownerType === "stop" ? "stop_id" : "event_id";
  const [oz, setOz] = useState(10);
  const [stock, setStock] = useState("122");      // 10/16oz bottles on hand
  const [coolerCap, setCoolerCap] = useState("45"); // 10oz bottles that fit one cooler w/ ice
  const [kegGal, setKegGal] = useState<Record<string, string>>({}); // per-batch gallons → keg

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { batches: [], fleet: [] };
    const [b, k] = await Promise.all([
      supabase.from("brew_batches").select("id, recipe_name, batch_gal, status").eq(ownerCol, ownerId).neq("status", "archived").order("created_at"),
      supabase.from("kegs").select("capacity_gal, qty").is("archived_at", null),
    ]);
    if (b.error) throw new Error(b.error.message);
    if (k.error) throw new Error(k.error.message);
    const batches = (b.data as Batch[]) ?? [];
    const fleet = ((k.data as { capacity_gal: number; qty: number }[]) ?? []).map((x) => ({ cap: Number(x.capacity_gal), qty: Number(x.qty) })).filter((x) => x.cap > 0 && x.qty > 0);
    return { batches, fleet };
  }, [ownerCol, ownerId]);
  const board = useAsyncData(loader, [ownerCol, ownerId]);
  const batches = board.data?.batches ?? [];
  const fleet = board.data?.fleet ?? [];

  // Sequential allocation across the SHARED fleet — earlier batches claim kegs first.
  const plan = useMemo(() => {
    const mut = fleet.map((k) => ({ ...k }));
    const rows = batches.map((b) => {
      const kg = Math.min(Math.max(0, Number(kegGal[b.id] || 0)), b.batch_gal);
      const bottleGal = Math.max(0, b.batch_gal - kg);
      const bottles = Math.floor((bottleGal * 128) / oz);
      const { plan: kp, shortfall } = fillFromFleet(kg, mut); // mutates `mut` — earlier batches claim kegs first
      return { b, kg, bottleGal, bottles, kp, shortfall };
    });
    return { rows, totalBottles: rows.reduce((s, r) => s + r.bottles, 0), totalKegShort: rows.reduce((s, r) => s + r.shortfall, 0) };
  }, [batches, kegGal, fleet, oz]);

  const stockN = Number(stock) || 0;
  const coolerN = Math.max(1, Number(coolerCap) || 45);
  const coolers = Math.ceil(plan.totalBottles / coolerN);
  const shortBottles = Math.max(0, plan.totalBottles - stockN);
  const totalGal = batches.reduce((s, b) => s + (Number(b.batch_gal) || 0), 0);
  const kegFleetStr = fleet.length ? fleet.map((k) => `${k.qty}× ${k.cap}gal`).join(" + ") : "no kegs configured";

  const setKeg = (id: string, v: string) => setKegGal((p) => ({ ...p, [id]: v }));
  const allKeg = () => setKegGal(Object.fromEntries(batches.map((b) => [b.id, String(b.batch_gal)])));
  const allBottle = () => setKegGal(Object.fromEntries(batches.map((b) => [b.id, "0"])));

  return (
    <Sheet open onClose={onClose} label="Pack-out plan" header={<div style={{ display: "flex", alignItems: "center" }}><div className="dp-head-l"><div className="dp-eyebrow"><Icon name="package" /> Pack-out plan · kegs vs bottles</div><div className="dp-title">{title || "Event"} — {totalGal} gal across {batches.length} batch{batches.length === 1 ? "" : "es"}</div></div><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}><Icon name="close" /></button></div>}>
      <AsyncSection state={board} isEmpty={(data) => data.batches.length === 0} emptyTitle={`No batches tied to this ${ownerType} yet`} emptySub="Plan a batch in Brew and tie it here, then come back to split it between kegs and bottles." errorTitle="Couldn't load the pack-out plan">
        {() => (
          <>
            <div className="pp-cfg">
              <div className="ts-chips">{[10, 16].map((n) => <button key={n} type="button" className={`ts-chip${oz === n ? " on" : ""}`} onClick={() => setOz(n)}>{n}oz</button>)}</div>
              <label className="prod-f"><span>{oz}oz bottles on hand</span><input type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} /></label>
              <label className="prod-f"><span>Bottles per cooler</span><input type="number" min="1" value={coolerCap} onChange={(e) => setCoolerCap(e.target.value)} /></label>
            </div>
            <div className="pp-quick"><span>Fleet: {kegFleetStr}</span><span /><button type="button" className="pp-mini" onClick={allKeg}>All to keg</button><button type="button" className="pp-mini" onClick={allBottle}>All to bottles</button></div>

            {plan.rows.map((r) => (
              <div key={r.b.id} className="pp-row">
                <div className="pp-row-h"><b>{r.b.recipe_name || "Batch"}</b><span>{r.b.batch_gal} gal · {r.b.status}</span></div>
                <div className="pp-split">
                  <label className="pp-keg"><span>To keg (gal)</span>
                    <input type="number" min="0" step="0.5" max={String(r.b.batch_gal)} value={kegGal[r.b.id] ?? "0"} onChange={(e) => setKeg(r.b.id, e.target.value)} />
                  </label>
                  <div className="pp-out">
                    <span>{r.kg > 0 ? (r.kp.length ? kegStr(r.kp) : "—") : "—"}{r.shortfall > 0.01 && <b className="pp-short"> · short {r.shortfall.toFixed(1)}gal</b>}</span>
                    <span><b>{r.bottles}</b> × {oz}oz</span>
                  </div>
                </div>
              </div>
            ))}

            <div className="pp-totals">
              <div className="pp-tot-row"><span>Bottles to cooler</span><b>{plan.totalBottles} × {oz}oz</b></div>
              <div className="pp-tot-row"><span>UVDTF labels</span><b>{plan.totalBottles}{plan.totalBottles ? ` (order ~${Math.ceil(plan.totalBottles * 1.05)})` : ""}</b></div>
              <div className="pp-tot-row"><span>Coolers needed</span><b>{coolers}</b></div>
              {shortBottles > 0 && <div className="pp-tot-row warn"><span><Icon name="warning" /> Short on bottles</span><b>need {shortBottles} more {oz}oz</b></div>}
              {plan.totalKegShort > 0.01 && <div className="pp-tot-row warn"><span><Icon name="warning" /> Not enough keg space</span><b>{plan.totalKegShort.toFixed(1)} gal won&apos;t fit</b></div>}
            </div>
            <div className="dp-hint" style={{ marginTop: 10 }}>Tip: tune each batch&apos;s keg gallons until the cooler count and bottle stock work. The fleet is shared — earlier batches claim kegs first.</div>
            <div className="prod-actions" style={{ marginTop: 14 }}><span /><button type="button" className="note-save" onClick={onClose}>Done</button></div>
          </>
        )}
      </AsyncSection>
    </Sheet>
  );
}
