"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { isBlank } from "@/lib/formGuard";
import { supabase } from "@/lib/supabase";
import { SectionHeader, InfoRow } from "@/components/kit";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";

// MENU / PRODUCT manager — the catalog as a managed, relational record. Edit every attribute
// (name, line, price, description, ingredients), set the recipe (which inventory items a serving
// consumes), and toggle active. Price here is what the app charges — card AND cash. Fetch state via
// useAsyncData — a failed load is a real error now, not a silent "No products yet."
/* eslint-disable @typescript-eslint/no-explicit-any */

type Product = { id: string; slug: string; name: string; line: string | null; price_cents: number; active: boolean; sold_out: boolean; sold_out_at: string | null; sort: number; what: string | null; why: string | null; ingredients: string[]; excludes: string[]; timing: string | null; square_item_id: string | null; bulk_orderable?: boolean; bulk_tier?: string | null };
type Inv = { id: string; name: string; unit: string | null };
type Comp = { id: string; inventory_item_id: string; qty_per_serving: number | null; unit: string | null };
type Board = { products: Product[]; inv: Inv[] };

export default function MenuManager() {
  const { toast } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { products: [], inv: [] };
    const [p, i] = await Promise.all([
      supabase.from("products").select("*").order("sort"),
      supabase.from("inventory_items").select("id, name, unit").order("name"),
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
            <button type="button" className="btn-sec" onClick={create}>+ New item</button>
          </div>
          <div className="h-sub">The catalog the app charges from — card &amp; cash. Edit every attribute, set each drink&apos;s recipe (the inventory a serving uses), toggle what&apos;s on the menu.</div>
          {products.map((p) => <ProductRow key={p.id} p={p} inv={inv} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} onSaved={reload} toast={toast} />)}
        </div>
      )}
    </AsyncSection>
  );
}

function ProductRow({ p, inv, open, onToggle, onSaved, toast }: { p: Product; inv: Inv[]; open: boolean; onToggle: () => void; onSaved: () => void; toast: (m: string, t?: any) => void }) {
  const [d, setD] = useState(p);
  const [comps, setComps] = useState<Comp[]>([]);
  const [addInv, setAddInv] = useState(""); const [addQty, setAddQty] = useState("");
  useEffect(() => { setD(p); }, [p]);
  useEffect(() => {
    if (!open || !supabase) return;
    supabase.from("product_components").select("id, inventory_item_id, qty_per_serving, unit").eq("product_id", p.id).then(({ data }) => setComps((data as Comp[]) ?? []));
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
    if (!supabase || !window.confirm(`Delete "${d.name}"?`)) return;
    await supabase.from("products").delete().eq("id", p.id); toast("Deleted"); onSaved();
  };
  const addComponent = async () => {
    if (!supabase || !addInv) return;
    const unit = inv.find((x) => x.id === addInv)?.unit ?? null;
    const { error } = await supabase.from("product_components").insert({ product_id: p.id, inventory_item_id: addInv, qty_per_serving: addQty ? Number(addQty) : null, unit });
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    setAddInv(""); setAddQty("");
    supabase.from("product_components").select("id, inventory_item_id, qty_per_serving, unit").eq("product_id", p.id).then(({ data }) => setComps((data as Comp[]) ?? []));
  };
  const rmComponent = async (id: string) => {
    if (!supabase) return;
    await supabase.from("product_components").delete().eq("id", id);
    setComps((c) => c.filter((x) => x.id !== id));
  };
  const invName = (id: string) => inv.find((x) => x.id === id)?.name ?? "item";

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
            <span className="prod-px">${(p.price_cents / 100).toFixed(2)}</span>
            {p.active && (
              <button type="button" className={`prod-86btn${p.sold_out ? " on" : ""}`} onClick={toggle86}>
                {p.sold_out ? "Back on" : "86"}
              </button>
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
            <label className="prod-f"><span>Timing</span><input value={d.timing ?? ""} onChange={(e) => setD({ ...d, timing: e.target.value })} placeholder="BEFORE / DURING / AFTER" /></label>
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
            {comps.map((c) => (
              <div key={c.id} className="prod-comp">
                <span>{c.qty_per_serving ?? ""}{c.unit ? ` ${c.unit}` : ""} · {invName(c.inventory_item_id)}</span>
                <button type="button" className="insp-no" onClick={() => rmComponent(c.id)}>Remove</button>
              </div>
            ))}
            <div className="prod-addc">
              <select value={addInv} onChange={(e) => setAddInv(e.target.value)}><option value="">+ inventory item…</option>{inv.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
              <input type="number" step="0.1" value={addQty} onChange={(e) => setAddQty(e.target.value)} placeholder="qty" style={{ maxWidth: 70 }} />
              <button type="button" className="insp-yes" onClick={addComponent} disabled={!addInv}>Add</button>
            </div>
          </div>

          {/* Save is the one true commit action while this row is open — the parent's openId
              guarantees at most one ProductRow is ever open at a time, so at most one .btn-pri
              renders across this whole screen. Delete is destructive/secondary → .btn-ter, same
              tier Studio.tsx and OfficeOrders.tsx use for Delete/Cancel. .btn-pri is a block,
              width:100% button; .prod-actions is a shared class (30+ other bespoke forms app-wide
              reuse it) with no flex-wrap in its CSS, so it's added locally here rather than in
              globals.css — otherwise Save would be squeezed shoulder-to-shoulder with Delete
              instead of taking its own full-width row. */}
          <div className="prod-actions" style={{ flexWrap: "wrap" }}>
            <button type="button" className="btn-ter" onClick={del}>Delete</button>
            <button type="button" className="btn-pri" onClick={save} disabled={isBlank(d.name) || (d.active && !(Number(d.price_cents) > 0))}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
