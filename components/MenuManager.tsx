"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";

// MENU / PRODUCT manager — the catalog as a managed, relational record. Edit every attribute
// (name, line, price, description, ingredients), set the recipe (which inventory items a serving
// consumes), and toggle active. Price here is what the app charges — card AND cash.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Product = { id: string; slug: string; name: string; line: string | null; price_cents: number; active: boolean; sold_out: boolean; sold_out_at: string | null; sort: number; what: string | null; why: string | null; ingredients: string[]; excludes: string[]; timing: string | null; square_item_id: string | null };
type Inv = { id: string; name: string; unit: string | null };
type Comp = { id: string; inventory_item_id: string; qty_per_serving: number | null; unit: string | null };

export default function MenuManager() {
  const { toast } = useApp();
  const [products, setProducts] = useState<Product[]>([]);
  const [inv, setInv] = useState<Inv[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [p, i] = await Promise.all([
      supabase.from("products").select("*").order("sort"),
      supabase.from("inventory_items").select("id, name, unit").order("name"),
    ]);
    setProducts((p.data as Product[]) ?? []); setInv((i.data as Inv[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!supabase) return;
    const slug = `item-${Math.random().toString(36).slice(2, 7)}`;
    const { data } = await supabase.from("products").insert({ slug, name: "New item", line: "Activation", price_cents: 0, sort: (products.at(-1)?.sort ?? 0) + 1 }).select("id").single();
    if (data?.id) { await load(); setOpenId(data.id); }
  };

  return (
    <div className="adm-sec">
      <div className="studio-top">
        <div className="sec" style={{ margin: 0 }}>Menu &amp; products</div>
        <button type="button" className="rdy-run" onClick={create}>+ New item</button>
      </div>
      <div className="h-sub">The catalog the app charges from — card &amp; cash. Edit every attribute, set each drink&apos;s recipe (the inventory a serving uses), toggle what&apos;s on the menu.</div>
      {products.map((p) => <ProductRow key={p.id} p={p} inv={inv} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} onSaved={load} toast={toast} />)}
      {products.length === 0 && <div className="h-sub" style={{ marginTop: 14 }}>No products yet — run migration 0062, or add one.</div>}
    </div>
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
    const { error } = await supabase.from("products").update({
      name: d.name.trim(), line: d.line, price_cents: Math.round(Number(d.price_cents) || 0), active: d.active, what: d.what, why: d.why,
      ingredients: (d.ingredients || []), excludes: (d.excludes || []), timing: d.timing, slug: d.slug.trim(),
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
      <div className="prod-headrow">
        <button type="button" className="prod-head" onClick={onToggle}>
          <span className="prod-dot" style={{ background: p.timing ? undefined : undefined }} />
          <span className="prod-n">{p.name}{!p.active && <span className="prod-off">off</span>}{p.active && p.sold_out && <span className="prod-86tag">SOLD OUT{p.sold_out_at ? ` · ${new Date(p.sold_out_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span>}</span>
          <span className="prod-line">{p.line}</span>
          <span className="prod-px">${(p.price_cents / 100).toFixed(2)}</span>
        </button>
        {p.active && (
          <button type="button" className={`prod-86btn${p.sold_out ? " on" : ""}`} onClick={toggle86}>
            {p.sold_out ? "Back on" : "86"}
          </button>
        )}
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

          <div className="prod-actions">
            <button type="button" className="note-arch" onClick={del}>Delete</button>
            <button type="button" className="note-save" onClick={save}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
