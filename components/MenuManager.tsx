"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "./AppProvider";
import { isBlank } from "@/lib/formGuard";
import { supabase } from "@/lib/supabase";
import { SectionHeader, InfoRow } from "@/components/kit";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { useOptions } from "./useOptions";
import { withCurrent } from "@/lib/options";
import { drinkCogs, margin, shelfLabel, type InvCost } from "@/lib/cogs";
import { money } from "@/lib/money";
import { useConfirm } from "@/components/ConfirmSheet";
import Button from "./Button";

// MENU / PRODUCT manager — the catalog as a managed, relational record. Edit every attribute
// (name, line, price, description, ingredients), set the recipe (which inventory items a serving
// consumes), and toggle active. Price here is what the app charges — card AND cash. Fetch state via
// useAsyncData — a failed load is a real error now, not a silent "No products yet."
/* eslint-disable @typescript-eslint/no-explicit-any */

type Product = { id: string; slug: string; name: string; line: string | null; price_cents: number; active: boolean; sold_out: boolean; sold_out_at: string | null; sort: number; what: string | null; why: string | null; ingredients: string[]; excludes: string[]; timing: string | null; square_item_id: string | null; bulk_orderable?: boolean; bulk_tier?: string | null };
type Inv = { id: string; name: string; unit: string | null; market?: string | null };
type Comp = { id: string; inventory_item_id: string; qty_per_serving: number | null; unit: string | null };
type Board = { products: Product[]; inv: Inv[] };

export default function MenuManager() {
  const { toast } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { products: [], inv: [] };
    const [p, i] = await Promise.all([
      supabase.from("products").select("*").order("sort"),
      // unit_cost joins the existing select so the drink row can price its OWN recipe. It was the
      // only thing missing: lib/cogs already owns the math, the row already has the components,
      // and the cost still lived two panels away in the COGS calculator.
      supabase.from("inventory_items").select("id, name, unit, unit_cost, market").order("name"),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (i.error) throw new Error(i.error.message);
    return { products: (p.data as Product[]) ?? [], inv: (i.data as Inv[]) ?? [] };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  const products = board.data?.products ?? [];
  const inv = board.data?.inv ?? [];

  const create = async () => {
    if (!supabase) return;
    const slug = `item-${Math.random().toString(36).slice(2, 7)}`;
    // New products start as an OFF-menu draft with a blank name — they can't be charged from until
    // they're named, priced (> $0) and switched on, so a stray "+ New" click can't put junk on the live menu.
    const { data } = await supabase.from("products").insert({ slug, name: "", line: "Activation", price_cents: 0, active: false, sort: (products.at(-1)?.sort ?? 0) + 1 }).select("id").single();
    if (data?.id) { await reload(); setOpenId(data.id); }
  };

  return (
    <AsyncSection state={board} isEmpty={(data) => data.products.length === 0} emptyTitle="No products yet" emptySub="Run migration 0062, or add one." errorTitle="Couldn't load the menu">
      {() => (
        <div className="adm-sec">
          <div className="studio-top">
            <SectionHeader label="Menu & products" />
            {/* "+New item" just opens a blank draft row — it doesn't commit anything, so it's not
                the primary action (see ProductRow's Save for that). .btn-sec, same tier Studio.tsx
                uses for its own deliberate-but-not-committing actions. Kept inside .studio-top
                (not folded into SectionHeader's own `right` slot) on purpose: when this screen is
                Panel-wrapped (it always is, via app/crew/page.tsx), the CSS rule
                `.mpanel-body > .adm-sec > .studio-top > .k-sec{display:none}` hides the dupe
                SectionHeader title but relies on the button staying a SIBLING of .k-sec, not a
                child of it — moving the button inside SectionHeader's `right` would hide it too. */}
            <button type="button" className="btn-sec btn-sm" onClick={create}>+ New item</button>
          </div>
          <div className="h-sub">The catalog the app charges from — card &amp; cash. Edit every attribute, set each drink&apos;s recipe (the inventory a serving uses), toggle what&apos;s on the menu.</div>
          {products.map((p) => <ProductRow key={p.id} p={p} inv={inv} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} onSaved={reload} toast={toast} />)}
        </div>
      )}
    </AsyncSection>
  );
}

function ProductRow({ p, inv, open, onToggle, onSaved, toast }: { p: Product; inv: Inv[]; open: boolean; onToggle: () => void; onSaved: () => void; toast: (m: string, t?: any) => void }) {
  const confirm = useConfirm();
  const timings = useOptions("menu_timing");
  const [d, setD] = useState(p);
  const [comps, setComps] = useState<Comp[]>([]);
  const [addInv, setAddInv] = useState(""); const [addQty, setAddQty] = useState("");
  useEffect(() => { setD(p); }, [p]);
  useEffect(() => {
    if (!open || !supabase) return;
    // Keep whatever is on screen if the read fails: an empty component list reads as "this drink
    // has no ingredients", which is what COGS and the inventory deduction are built on.
    supabase.from("product_components").select("id, inventory_item_id, qty_per_serving, unit").eq("product_id", p.id).then(({ data, error }) => { if (!error) setComps((data as Comp[]) ?? []); });
  }, [open, p.id]);

  const save = async () => {
    if (!supabase) return;
    if (isBlank(d.name)) { toast("Give it a name first", "error"); return; }
    if (d.active && !(Number(d.price_cents) > 0)) { toast("Set a price above $0 before putting it on the menu", "error"); return; }
    const { error } = await supabase.from("products").update({
      name: d.name.trim(), line: d.line, price_cents: Math.round(Number(d.price_cents) || 0), active: d.active, what: d.what, why: d.why,
      ingredients: (d.ingredients || []), excludes: (d.excludes || []), timing: d.timing, slug: d.slug.trim(),
      bulk_orderable: !!d.bulk_orderable, bulk_tier: d.bulk_tier || "premium",
    }).eq("id", p.id);
    if (error) toast(`Error: ${error.message}`, "error"); else { toast("Saved"); onSaved(); }
  };
  const del = async () => {
    if (!supabase) return;
    if (!(await confirm({ title: `Delete “${d.name}”?`, confirmLabel: "Delete", danger: true }))) return;
    await supabase.from("products").delete().eq("id", p.id); toast("Deleted"); onSaved();
  };
  const addComponent = async () => {
    if (!supabase || !addInv) return;
    const unit = inv.find((x) => x.id === addInv)?.unit ?? null;
    const { error } = await supabase.from("product_components").insert({ product_id: p.id, inventory_item_id: addInv, qty_per_serving: addQty ? Number(addQty) : null, unit });
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    setAddInv(""); setAddQty("");
    supabase.from("product_components").select("id, inventory_item_id, qty_per_serving, unit").eq("product_id", p.id).then(({ data, error }) => { if (!error) setComps((data as Comp[]) ?? []); });
  };
  const rmComponent = async (id: string) => {
    if (!supabase) return;
    await supabase.from("product_components").delete().eq("id", id);
    setComps((c) => c.filter((x) => x.id !== id));
  };
  const invName = (id: string) => inv.find((x) => x.id === id)?.name ?? "item";
  // What a person reads: the name, and its city when two cities stock one of that name (0347).
  const invLabel = (id: string) => { const it = inv.find((x) => x.id === id); return it ? shelfLabel(it, inv) : "item"; };

  // WHAT THIS DRINK COSTS, computed where its recipe is edited. Same lib/cogs functions the COGS
  // calculator and Product economics use — not a second implementation, the same one. The point is
  // not to replace those panels (a calculator and a roll-up are real, separate jobs) but to stop
  // the price of a drink being a fact you have to leave the drink to learn.
  const invById = useMemo(() => new Map(inv.map((i) => [i.id, i as InvCost])), [inv]);
  const cogs = useMemo(
    () => drinkCogs(p.id, comps.map((c) => ({ ...c, product_id: p.id })), invById),
    [p.id, comps, invById]);
  const m = margin(d.price_cents, cogs.cents);

  // 86 / un-86 in one tap, right from the list — the live menu and every open cart update in
  // realtime, and both checkout paths refuse the item at the database until it's flipped back.
  const toggle86 = async () => {
    if (!supabase) return;
    const next = !p.sold_out;
    const { error } = await supabase.from("products").update({ sold_out: next }).eq("id", p.id);
    if (error) toast(`Error: ${error.message}`, "error");
    else { toast(next ? `${p.name} 86'd — marked SOLD OUT on the live menu` : `${p.name} is back on the menu`); onSaved(); }
  };

  return (
    <div className={`prod${open ? " open" : ""}`}>
      {/* Collapsed summary as a kit InfoRow: name (+ the timing dot) on the left; off/sold-out
          badges as nameExtra; line + price + the 86 quick-toggle grouped as trailing, preserving
          the original single-line, right-aligned arrangement (.prod-head used margin-left:auto to
          push line+price to the right of the same row). bodyClick (not onClick) because trailing
          holds its OWN interactive button (86/Back on) — onClick would wrap the entire row,
          86-button included, in one outer <button>, nesting buttons and double-firing clicks.
          Wrapped in .k-rows purely so the existing `.k-rows>.k-row:last-child{border-bottom:0}`
          rule zeroes this row's border — the closed .prod-headrow never had a divider of its own,
          and when open, the one hairline between header and form still comes from .prod-body's
          own border-top below (unchanged), so this avoids a doubled line. */}
      <div className="k-rows">
        <InfoRow
          bodyClick={onToggle}
          expanded={open}
          ariaLabel={p.name ? `${p.name} — edit item` : "Edit item"}
          name={<>
            {/* was `p.timing ? undefined : undefined` — both branches identical, so the live timing
                field never rendered anything. Daypart colors match the customer pillars. */}
            <span className="prod-dot" data-on={p.timing || undefined} style={{ background: { BEFORE: "#B8902F", DURING: "#3f7d6e", AFTER: "#B82420" }[(p.timing || "").trim().toUpperCase()] }} />
            {p.name}
          </>}
          nameExtra={<>
            {!p.active && <span className="prod-off">off</span>}
            {p.active && p.sold_out && <span className="prod-86tag">SOLD OUT{p.sold_out_at ? ` · ${new Date(p.sold_out_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span>}
          </>}
          trailing={<>
            <span className="prod-line">{p.line}</span>
            <span className="prod-px">{money(p.price_cents)}</span>
            {p.active && (
              <Button type="button" kind="secondary" compact className="shrink-0" onClick={toggle86}>
                {p.sold_out ? "Back on" : "86"}
              </Button>
            )}
          </>}
        />
      </div>
      {open && (
        <div className="prod-body">
          <div className="prod-grid">
            <label className="prod-f"><span>Name</span><input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
            <label className="prod-f"><span>Price ($)</span><input type="number" step="0.50" value={(d.price_cents / 100).toString()} onChange={(e) => setD({ ...d, price_cents: Math.round((Number(e.target.value) || 0) * 100) })} /></label>
            <label className="prod-f"><span>Line</span><input value={d.line ?? ""} onChange={(e) => setD({ ...d, line: e.target.value })} /></label>
            {/* The placeholder used to read "BEFORE / DURING / AFTER" — when a placeholder has to
                enumerate the valid answers, the control is wrong. lib/menu.ts already types this
                as exactly those three. */}
            <label className="prod-f"><span>Timing</span>
              <select value={d.timing ?? ""} onChange={(e) => setD({ ...d, timing: e.target.value })}>
                <option value="">—</option>
                {withCurrent(timings, d.timing).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <label className="prod-f"><span>Description</span><textarea rows={2} value={d.what ?? ""} onChange={(e) => setD({ ...d, what: e.target.value })} /></label>
          <label className="prod-f"><span>Why</span><input value={d.why ?? ""} onChange={(e) => setD({ ...d, why: e.target.value })} /></label>
          <label className="prod-f"><span>Ingredients (comma)</span><input value={(d.ingredients || []).join(", ")} onChange={(e) => setD({ ...d, ingredients: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></label>
          <label className="prod-f"><span>Free of (comma)</span><input value={(d.excludes || []).join(", ")} onChange={(e) => setD({ ...d, excludes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></label>
          <label className="prod-toggle"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /> On the menu</label>
          {/* Bulk order = show this item in the delivery pack builder. 'brew' = the refillable
              daypart core (Loop $8 / new $10); 'premium' = a flat $14 add like the Salted Latte. */}
          <label className="prod-toggle"><input type="checkbox" checked={!!d.bulk_orderable} onChange={(e) => setD({ ...d, bulk_orderable: e.target.checked })} /> Available for bulk / delivery pack</label>
          {d.bulk_orderable && (
            <label className="prod-f"><span>Bulk tier</span>
              <select value={d.bulk_tier || "premium"} onChange={(e) => setD({ ...d, bulk_tier: e.target.value })}>
                <option value="premium">Premium add ($14)</option>
                <option value="brew">Brew (refillable core — Loop $8 / new $10)</option>
              </select>
            </label>
          )}

          <div className="prod-recipe">
            <div className="insp-lbl">Recipe — inventory a serving uses</div>
            {/* The cost of what is listed below, and what it leaves. An uncosted ingredient is
                named rather than quietly treated as free — a margin that silently omits an input
                reads as better than it is, which is the expensive direction to be wrong in. */}
            {cogs.hasRecipe && (
              <div className={`prod-cogs${cogs.uncosted > 0 ? " partial" : ""}`}>
                <span>Cost <b>{money(cogs.cents)}</b></span>
                {cogs.uncosted === 0 && d.price_cents > 0
                  ? <span>Margin <b>{money(m.profitCents)}</b> · {m.pct}%</span>
                  : cogs.uncosted > 0
                    ? <span className="prod-cogs-warn">{cogs.uncosted} ingredient{cogs.uncosted === 1 ? "" : "s"} have no unit cost — set it in Inventory</span>
                    : null}
              </div>
            )}
            {comps.map((c) => (
              <div key={c.id} className="prod-comp">
                <span>{c.qty_per_serving ?? ""}{c.unit ? ` ${c.unit}` : ""} · {invLabel(c.inventory_item_id)}
                  {(() => { const ln = cogs.lines.find((l) => l.name === invName(c.inventory_item_id));
                    if (!ln) return null;
                    return ln.costed
                      ? <i className="prod-comp-c">{money(ln.costCents)}</i>
                      : <i className="prod-comp-c none">no cost set</i>; })()}
                </span>
                <button type="button" className="insp-no" onClick={() => rmComponent(c.id)}>Remove</button>
              </div>
            ))}
            <div className="prod-addc">
              <select value={addInv} onChange={(e) => setAddInv(e.target.value)}><option value="">+ inventory item…</option>{inv.map((i) => <option key={i.id} value={i.id}>{shelfLabel(i, inv)}</option>)}</select>
              <input type="number" step="0.1" value={addQty} onChange={(e) => setAddQty(e.target.value)} placeholder="qty" style={{ maxWidth: 70 }} />
              <button type="button" className="insp-yes" onClick={addComponent} disabled={!addInv}>Add</button>
            </div>
          </div>

          {/* Save is the one true commit action while this row is open — the parent's openId
              guarantees at most one ProductRow is ever open at a time, so at most one .btn-pri
              renders across this whole screen. Delete is destructive → .btn-del, red words (2026-10-09,
              the button round). .btn-pri .btn-wide is a block, width:100% button; .prod-actions is a shared class (30+ other bespoke forms app-wide
              reuse it) with no flex-wrap in its CSS, so it's added locally here rather than in
              globals.css — otherwise Save would be squeezed shoulder-to-shoulder with Delete
              instead of taking its own full-width row. */}
          <div className="prod-actions" style={{ flexWrap: "wrap" }}>
            <button type="button" className="btn-del" onClick={del}>Delete</button>
            <button type="button" className="btn-pri btn-wide" onClick={save} disabled={isBlank(d.name) || (d.active && !(Number(d.price_cents) > 0))}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
