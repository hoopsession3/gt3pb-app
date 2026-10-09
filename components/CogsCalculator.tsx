"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  drinkCogs, batchCogs, margin, costByName,
  type InvCost, type Component, type ProductRow, type BrewRecipeRow,
} from "@/lib/cogs";
import { SectionHeader } from "@/components/kit";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import Icon from "@/components/Icon";
import { money } from "@/lib/money";
import { Segmented } from "@/components/controls";

// COGS CALCULATOR (Money) — one cohesive place for the cost side: cost per drink (from each
// product's recipe × ingredient costs), cost per batch (brews, broth — cost/gallon and per 10oz
// bottle), and the menu's blended margin. Derives everything from inventory unit costs + recipes
// already in the system, so adding goat milk (or any input) with a cost flows straight through.
// Fetch state via useAsyncData — a failed load is a real error now, not a silent "No products yet".

const marginCls = (pct: number) => (pct >= 60 ? "ok" : pct >= 30 ? "gold" : "red");
type Board = { inv: InvCost[]; products: ProductRow[]; components: Component[]; recipes: BrewRecipeRow[] };
// One empty board, not four fresh [] per render: the memos below key on these arrays.
const NO_BOARD: Board = { inv: [], products: [], components: [], recipes: [] };

export default function CogsCalculator() {
  const [tab, setTab] = useState<"drinks" | "batches">("drinks");
  const [openId, setOpenId] = useState<string | null>(null);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { inv: [], products: [], components: [], recipes: [] };
    const [i, p, comp, r] = await Promise.all([
      supabase.from("inventory_items").select("id, name, unit_cost, unit, market"),
      supabase.from("products").select("id, slug, name, line, price_cents").eq("active", true).order("sort"),
      supabase.from("product_components").select("product_id, inventory_item_id, qty_per_serving, unit"),
      supabase.from("brew_recipes").select("id, name, style, base_water_gal, ingredients, yield_factor").is("archived_at", null).order("sort"),
    ]);
    const firstErr = [i, p, comp, r].find((x) => x.error)?.error;
    if (firstErr) throw new Error(firstErr.message);
    return {
      inv: (i.data as InvCost[]) ?? [], products: (p.data as ProductRow[]) ?? [],
      components: (comp.data as Component[]) ?? [], recipes: (r.data as BrewRecipeRow[]) ?? [],
    };
  }, []);
  const board = useAsyncData(loader, []);
  const { inv, products, components, recipes } = board.data ?? NO_BOARD;

  const invById = useMemo(() => new Map(inv.map((x) => [x.id, x])), [inv]);
  // Two cities can stock one name (0347): the name finds the shelf with a cost, the founding city's first.
  const invByName = useMemo(() => costByName(inv), [inv]);

  const drinks = useMemo(() => products.map((p) => {
    const cogs = drinkCogs(p.id, components, invById);
    return { p, cogs, m: margin(p.price_cents, cogs.cents) };
  }), [products, components, invById]);

  const batches = useMemo(() => recipes.map((r) => ({ r, b: batchCogs(r, invByName, r.base_water_gal || 1, 10) })), [recipes, invByName]);

  const blended = useMemo(() => {
    const costed = drinks.filter((d) => d.cogs.hasRecipe && d.cogs.uncosted === 0 && d.p.price_cents > 0);
    if (!costed.length) return null;
    const price = costed.reduce((s, d) => s + d.p.price_cents, 0);
    const cost = costed.reduce((s, d) => s + d.cogs.cents, 0);
    return { pct: margin(price, cost).pct, n: costed.length };
  }, [drinks]);

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load COGS data" emptyTitle="Nothing here yet">
      {() => (
    <div className="adm-sec">
      <SectionHeader label="COGS calculator" />
      <div className="pnl-note" style={{ marginBottom: 10 }}>
        Cost of goods from your recipes × ingredient costs. Set an ingredient&apos;s cost in <b>inventory (unit cost)</b> and a drink&apos;s recipe in <b>Menu</b>; it flows here automatically.
        {blended != null && <> Blended menu margin (fully-costed lines): <b className={`cogs-bm ${marginCls(blended.pct)}`}>{blended.pct}%</b>.</>}
      </div>

      <Segmented label="COGS" fill className="mt-1 mb-2.5" value={tab} onChange={setTab}
        options={[{ key: "drinks", label: "Per drink" }, { key: "batches", label: "Per batch · brews & broth" }]} />

      {tab === "drinks" && (
        <>
          <div className="cogs-head"><span>Drink</span><span>Price</span><span>COGS</span><span>Margin</span></div>
          {drinks.map(({ p, cogs, m }) => (
            <div key={p.id} className="cogs-wrap">
              <button type="button" className="cogs-row" onClick={() => setOpenId(openId === p.id ? null : p.id)} aria-expanded={openId === p.id}>
                <span className="cogs-name">{p.name}{p.line ? <em> · {p.line}</em> : null}{!cogs.hasRecipe && <span className="cogs-flag">no recipe</span>}{cogs.hasRecipe && cogs.uncosted > 0 && <span className="cogs-flag">{cogs.uncosted} uncosted</span>}</span>
                <span className="cogs-v">{money(p.price_cents)}</span>
                <span className="cogs-v">{cogs.hasRecipe ? money(cogs.cents) : "—"}</span>
                <span className={`cogs-v cogs-${marginCls(m.pct)}`}>{cogs.hasRecipe && cogs.uncosted === 0 && p.price_cents > 0 ? `${m.pct}%` : "—"}</span>
              </button>
              {openId === p.id && (
                <div className="cogs-detail">
                  {!cogs.hasRecipe ? (
                    <EmptyState title="No recipe yet" sub="Add this drink's ingredients in Menu → recipe to cost it." />
                  ) : (
                    <>
                      {cogs.lines.map((l, i) => (
                        <div key={i} className={`cogs-line${l.costed ? "" : " un"}`}>
                          <span>{l.qty}{l.unit ? ` ${l.unit}` : ""} · {l.name}</span>
                          <span>{l.costed ? money(l.costCents) : "set cost"}</span>
                        </div>
                      ))}
                      <div className="cogs-line tot"><span>Cost per serving</span><span>{money(cogs.cents)}</span></div>
                      {p.price_cents > 0 && cogs.uncosted === 0 && <div className="cogs-line"><span>Profit / drink</span><span className={`cogs-${marginCls(m.pct)}`}>{money(m.profitCents)} · {m.pct}%</span></div>}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {drinks.length === 0 && <EmptyState title="No products yet" sub="Add them in Menu." />}
        </>
      )}

      {tab === "batches" && (
        <>
          <div className="cogs-head"><span>Batch</span><span>Cost</span><span>$/gal</span><span>$/10oz</span></div>
          {batches.map(({ r, b }) => (
            <div key={r.id} className="cogs-wrap">
              <button type="button" className="cogs-row" onClick={() => setOpenId(openId === r.id ? null : r.id)} aria-expanded={openId === r.id}>
                <span className="cogs-name">{r.name}{r.style ? <em> · {r.style}</em> : null}{b.uncosted > 0 && <span className="cogs-flag">{b.uncosted} uncosted</span>}</span>
                <span className="cogs-v">{money(b.batchCents)}</span>
                <span className="cogs-v">{money(b.perGalCents)}</span>
                <span className="cogs-v">{b.bottles > 0 ? money(b.perBottleCents) : "—"}</span>
              </button>
              {openId === r.id && (
                <div className="cogs-detail">
                  <div className="cogs-sub">Batch of {b.batchGal} gal <Icon name="arrowRight" /> {b.servableGal} gal servable · {b.bottles} × 10oz bottles</div>
                  {b.lines.map((l, i) => (
                    <div key={i} className={`cogs-line${l.costed ? "" : " un"}`}>
                      <span>{l.qty}{l.unit ? ` ${l.unit}` : ""} · {l.name}</span>
                      <span>{l.costed ? money(l.costCents) : "match in inventory"}</span>
                    </div>
                  ))}
                  <div className="cogs-line tot"><span>Batch cost</span><span>{money(b.batchCents)}</span></div>
                </div>
              )}
            </div>
          ))}
          {batches.length === 0 && <EmptyState title="No brew/broth recipes yet" sub="Add them in Production → Brew." />}
          <div className="pnl-note" style={{ marginTop: 8 }}>Batch costs match recipe ingredients to inventory by name — anything flagged <b>uncosted</b> needs a matching inventory item with a unit cost.</div>
        </>
      )}
    </div>
      )}
    </AsyncSection>
  );
}
