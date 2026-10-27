"use client";

import { money } from "@/lib/money";
import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { Segmented } from "@/components/controls";
import { dollars, mixOf, type Inputs, type MixLine } from "@/lib/visionMoney";
import Num from "./Num";
import Said from "@/components/Said";
import { failureWords } from "@/lib/failureWords";

// THE PRODUCT MIX (R62 — the audit's gap 7). What sells, in what share, at what price, and what each costs to make and to
// pack — picked from GT3's own catalog (its price and its unit cost, as the catalog keeps them) or typed for a product the
// plan would add. When the mix drives, the money's average order and cost of goods are worked out from it, live; the
// gross margin then drills down product by product. Nothing is filled in for a product without its price and cost.
type Cat = { product_key: string; label: string; price_cents: number | null; unit_cost_cents: number | null; active: boolean };

export default function MixEditor({ i, set }: { i: Inputs; set: (p: Partial<Inputs>) => void }) {
  const load = useCallback(async (): Promise<Cat[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("product_economics_live").select("product_key, label, price_cents, unit_cost_cents, active").order("sort");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Cat[]).filter((c) => c.active !== false);
  }, []);
  const cat = useAsyncData(load, []);
  const mx = mixOf(i);
  const put = (k: number, patch: Partial<MixLine>) => set({ mix: i.mix.map((l, j) => (j === k ? { ...l, ...patch } : l)) });
  const add = (key: string) => {
    const c = (cat.data ?? []).find((x) => x.product_key === key);
    set({ mix: [...i.mix, c ? { key: c.product_key, label: c.label, sharePct: 0, priceCents: c.price_cents, unitCostCents: c.unit_cost_cents, packagingCents: null }
      : { key: `typed-${i.mix.length + 1}`, label: "", sharePct: 0, priceCents: null, unitCostCents: null, packagingCents: null }] });
  };
  return (
    <details className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" open={i.mixDrives || undefined}>
      <summary className="font-sans font-bold text-subhead cursor-pointer py-2">What sells · the product mix{mx && !mx.problems.length ? ` · ${dollars(mx.aovCents)} an order, ${mx.cogsPct.toFixed(1)}% goods` : ""}</summary>
      <Segmented label="The average order and cost of goods" kind="choice" value={i.mixDrives ? "mix" : "typed"} onChange={(v) => set({ mixDrives: v === "mix" })}
        options={[{ key: "typed", label: "Typed" }, { key: "mix", label: "From the mix" }]} />
      {i.mix.map((l, k) => (
        <div key={`${l.key}-${k}`} className="vz-ask">
          <label className="prod-f col-span-2"><span>Product</span><input value={l.label} maxLength={80} onChange={(e) => put(k, { label: e.target.value })} /></label>
          <Num label="Share of items" unit="%" value={l.sharePct || null} set={(v) => put(k, { sharePct: v ?? 0 })} />
          <Num label="Price" unit="$" cents value={l.priceCents} set={(v) => put(k, { priceCents: v })} />
          <Num label="Ingredients" unit="$ each" cents value={l.unitCostCents} set={(v) => put(k, { unitCostCents: v })} />
          <Num label="Packing" unit="$ each" cents value={l.packagingCents} set={(v) => put(k, { packagingCents: v })} />
          <p className="vz-line-total col-span-2">{l.priceCents != null && l.unitCostCents != null ? `${money(l.priceCents)} − ${dollars(l.unitCostCents + (l.packagingCents ?? 0))} = ${dollars(l.priceCents - l.unitCostCents - (l.packagingCents ?? 0))} each (${l.priceCents ? Math.round(((l.priceCents - l.unitCostCents - (l.packagingCents ?? 0)) / l.priceCents) * 100) : 0}%)` : "Needs a price and a cost"}</p>
          <div className="vz-ask-x"><button type="button" className="btn-ter" onClick={() => set({ mix: i.mix.filter((_, j) => j !== k) })}>Remove</button></div>
        </div>
      ))}
      <label className="prod-f"><span>Add from the catalog</span>
        <select value="" onChange={(e) => e.target.value && add(e.target.value)}>
          <option value="">Choose a product…</option>
          {(cat.data ?? []).map((c) => <option key={c.product_key} value={c.product_key}>{c.label}{c.price_cents != null ? ` · ${dollars(c.price_cents)}` : ""}</option>)}
          <option value="__typed">A product we&apos;d add (typed)</option>
        </select></label>
      {cat.status === "error" && <Said as="p" className="vz-issue warn">{`${failureWords(cat.error as Error, "Couldn't read the catalog")} — type the products instead; the mix still works.`}</Said>}
      <Num label="Items in an order" value={i.itemsPerOrder || null} set={(v) => set({ itemsPerOrder: Math.max(1, v ?? 1) })} />
      {mx?.problems.length ? <Said as="p" className="vz-issue warn">{`The mix can't drive the money yet: ${mx.problems.join("; ")}.`}</Said>
        : mx ? <p className="vz-card-s">The mix works out to {dollars(mx.aovCents)} an order and {mx.cogsPct.toFixed(1)}% cost of goods{i.mixDrives ? " — the money runs on these." : " — switch to From the mix to run the money on them."}</p>
        : <p className="vz-card-s">Add what sells to work out the average order and the cost of goods product by product.</p>}
    </details>
  );
}
