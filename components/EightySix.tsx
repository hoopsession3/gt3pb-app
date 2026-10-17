"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { homeMarket } from "@/lib/homeMarket";
import { FOUNDING_MARKET, MARKET_LABEL } from "@/lib/markets";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { haptic } from "@/lib/haptics";
import { SectionHeader } from "@/components/kit";
import { useLatestRead } from "@/lib/useLatestRead";

// THE 86 BOARD — sell out of an item from where the rush actually happens (the Now screen, right
// under the pass), not three taps deep in Money. One chip per active product: tap to 86, tap to
// bring back. Realtime both ways; the flip stamps who/when (0130) and clears itself at 4am Eastern.
//
// AN 86 IS FOR ONE CITY (2026-10-15, 0408 — Ryan: "Pass: its city. Catalog: all"). A tap here sells the item out in this
// crew member's city only (set_eighty_six → product_86), so the day a second city pours, one truck running out never
// empties another's menu. An item the Catalog sold out everywhere (products.sold_out) shows as out in every city, and a
// tap here still brings it back, as the board always could.
type Prod = { id: string; slug: string; name: string; sold_out: boolean; sold_out_at: string | null };

export default function EightySix() {
  const { toast } = useApp();
  const { profile } = useAuth();
  const market = homeMarket(profile) ?? FOUNDING_MARKET;
  const [rows, setRows] = useState<Prod[]>([]);
  const [here, setHere] = useState<ReadonlyMap<string, string>>(new Map());   // product id → when it was 86'd in this city
  // Read, then set — the newest read's answer only (R17, lib/useLatestRead). A switch of city mid-read never lands the last city's 86s.
  const read = useLatestRead();
  const load = useCallback(() => read(async () => (supabase ? await Promise.all([
    supabase.from("products").select("id, slug, name, sold_out, sold_out_at").eq("active", true).order("sort"),
    supabase.from("product_86").select("product_id, sold_out_at").eq("market", market),
  ]) : null), (r) => {
    if (!r) return;
    const [p, c] = r;
    if (p.data) setRows(p.data as Prod[]);
    // A city's 86s that did not answer keep what the board last knew — never "none out here".
    if (!c.error) setHere(new Map(((c.data as { product_id: string; sold_out_at: string }[] | null) ?? []).map((x) => [x.product_id, x.sold_out_at])));
  }), [read, market]);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["products", "product_86"], load);

  const flip = async (p: Prod) => {
    if (!supabase) return;
    const outHere = here.has(p.id);
    // Out everywhere (the Catalog's 86): the tap brings it back everywhere, as it always did.
    if (p.sold_out) {
      const next = !p.sold_out;
      if (next) haptic("toggleOn"); else haptic("toggleOff");
      setRows((r) => r.map((x) => (x.id === p.id ? { ...x, sold_out: next } : x))); // optimistic
      const { error } = await supabase.from("products").update({ sold_out: next }).eq("id", p.id);
      if (error) { toast(`Couldn't flip ${p.name} — ${error.message}`, "error"); load(); return; }
      toast(next ? `${p.name} 86'd — live menu updated` : `${p.name} back on`);
      return;
    }
    const next = !outHere;
    // A chip is a switch (aria-pressed): 86'ing an item turns it on, bringing it back turns it off.
    if (next) haptic("toggleOn"); else haptic("toggleOff");
    setHere((m) => { const n = new Map(m); if (next) n.set(p.id, new Date().toISOString()); else n.delete(p.id); return n; }); // optimistic
    const { data, error } = await supabase.rpc("set_eighty_six", { p_product: p.id, p_market: market, p_out: next });
    const r = (data ?? {}) as { ok?: boolean; words?: string };
    if (error || !r.ok) { toast(`Couldn't flip ${p.name} — ${error?.message ?? r.words ?? "try again"}`, "error"); load(); return; }
    toast(next ? `${p.name} 86'd in ${MARKET_LABEL[market]} — its menu updated` : `${p.name} back on in ${MARKET_LABEL[market]}`);
  };

  if (rows.length === 0) return null;
  const isOut = (p: Prod) => p.sold_out || here.has(p.id);
  const outCount = rows.filter(isOut).length;
  return (
    <div className="adm-sec">
      <SectionHeader label="86 board" />
      {outCount > 0 && <span className="k-count due">{outCount} out</span>}
      <div className="es-note">Tap what you&rsquo;ve run out of — {MARKET_LABEL[market]}&rsquo;s menu updates instantly, orders for it there are refused, and everything resets at 4am.</div>
      <div className="k-chips">
        {rows.map((p) => {
          const out = isOut(p);
          const at = p.sold_out ? p.sold_out_at : here.get(p.id) ?? null;
          return (
            <button key={p.id} type="button" className={`k-chip${out ? " crit on" : ""}`} onClick={() => flip(p)} aria-pressed={out}
              aria-label={p.sold_out ? `${p.name}, 86'd in every city` : undefined}>
              {out ? <s>{p.name}</s> : p.name}
              {p.sold_out && <span className="font-mono text-caption2 opacity-80">all cities</span>}
              {out && at && <span className="font-mono text-caption2 opacity-80">{new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
