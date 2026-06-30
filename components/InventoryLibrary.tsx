"use client";

import { useEffect, useState } from "react";
import { fetchInventory, type InvItem, type InventoryResp } from "@/lib/inventory";
import { supabase } from "@/lib/supabase";
import InventoryAI from "./InventoryAI";

// Inventory — the GT3 stock register, read from Postgres (system-of-record). Staff add / edit /
// delete inline; writes go straight to `inventory_items` (RLS: staff-write). Lives next to the
// gear library in Crew Mode → Prep. Reuses the .gl-* styles.

const STATUS = ["On Hand", "In Transit", "Backorder", "Consumed", "Returned"];
const UNITS = ["", "each", "case", "pack", "gallon", "lb", "oz", "set", "box"];

type Draft = {
  name: string; qty: string; unit: string; status: string; category: string;
  vendor: string; reorderPoint: string; reorderLink: string; notes: string; critical: boolean;
};
const emptyDraft: Draft = { name: "", qty: "", unit: "", status: "On Hand", category: "", vendor: "", reorderPoint: "", reorderLink: "", notes: "", critical: false };
const toDraft = (r: InvItem): Draft => ({
  name: r.name, qty: r.qty != null ? String(r.qty) : "", unit: r.unit || "", status: r.status || "On Hand",
  category: r.category || "", vendor: r.vendor || "", reorderPoint: r.reorderPoint != null ? String(r.reorderPoint) : "",
  reorderLink: r.reorderLink || "", notes: r.notes || "", critical: !!r.critical,
});

export default function InventoryLibrary() {
  const [resp, setResp] = useState<InventoryResp | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ai, setAi] = useState(false);

  const load = () => fetchInventory().then(setResp);
  useEffect(() => { load(); }, []);
  if (!resp) return null;

  if (!resp.enabled) {
    return (
      <div className="adm-sec gl">
        <div className="sec">Inventory</div>
        <div className="gl-hint">Sign in as crew to see inventory.</div>
      </div>
    );
  }

  const items = [...resp.items].sort((a, b) => a.name.localeCompare(b.name));
  const startNew = () => { setErr(null); setDraft(emptyDraft); setEditing("new"); setOpen(true); };
  const startEdit = (r: InvItem) => { setErr(null); setDraft(toDraft(r)); setEditing(r.id); };
  const cancel = () => { setEditing(null); setErr(null); };

  const save = async () => {
    if (!supabase || !draft.name.trim()) { setErr("Name is required"); return; }
    setBusy(true); setErr(null);
    const row = {
      name: draft.name.trim(),
      qty: draft.qty.trim() === "" ? null : Number(draft.qty),
      unit: draft.unit || null,
      status: draft.status || null,
      category: draft.category.trim() || null,
      vendor: draft.vendor.trim() || null,
      reorder_point: draft.reorderPoint.trim() === "" ? null : Number(draft.reorderPoint),
      reorder_link: draft.reorderLink.trim() || null,
      notes: draft.notes.trim() || null,
      critical: draft.critical,
    };
    const { error } = editing === "new"
      ? await supabase.from("inventory_items").insert(row)
      : await supabase.from("inventory_items").update(row).eq("id", editing);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setEditing(null); load();
  };

  const del = async (r: InvItem) => {
    if (!supabase || typeof window === "undefined" || !window.confirm(`Delete "${r.name}"? This can't be undone.`)) return;
    const { error } = await supabase.from("inventory_items").delete().eq("id", r.id);
    if (error) { setErr(error.message); return; }
    load();
  };

  const form = (
    <div className="gl-form">
      <div className="gl-form-h">{editing === "new" ? "New inventory item" : "Edit item"}</div>
      <label className="gl-f"><span>Name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. 10 oz Stout Bottle" /></label>
      <div className="gl-frow">
        <label className="gl-f"><span>Qty</span><input type="number" inputMode="decimal" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} /></label>
        <label className="gl-f"><span>Unit</span>
          <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
            {UNITS.map((u) => <option key={u} value={u}>{u || "—"}</option>)}
          </select>
        </label>
        <label className="gl-f"><span>Status</span>
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="gl-frow">
        <label className="gl-f"><span>Category</span><input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="Brewing Equipment" /></label>
        <label className="gl-f"><span>Vendor</span><input value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} /></label>
      </div>
      <div className="gl-frow">
        <label className="gl-f"><span>Reorder point</span><input type="number" inputMode="decimal" value={draft.reorderPoint} onChange={(e) => setDraft({ ...draft, reorderPoint: e.target.value })} /></label>
        <label className="gl-f gl-check"><input type="checkbox" checked={draft.critical} onChange={(e) => setDraft({ ...draft, critical: e.target.checked })} /><span>Event-critical</span></label>
      </div>
      <label className="gl-f"><span>Reorder link</span><input value={draft.reorderLink} onChange={(e) => setDraft({ ...draft, reorderLink: e.target.value })} placeholder="https://…" /></label>
      <label className="gl-f"><span>Notes</span><textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
      {err && <div className="gl-err">{err}</div>}
      <div className="gl-form-actions">
        <button className="adm-btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button className="adm-btn ghost" onClick={cancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );

  const low = items.filter((r) => r.qty != null && r.reorderPoint != null && r.qty <= r.reorderPoint).length;

  return (
    <div className="adm-sec gl">
      <button className="gl-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="sec">Inventory · {items.length}{low ? ` · ${low} low` : ""}</span>
        <span className={`ev-chev${open ? " open" : ""}`} aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="gl-body">
          <div className="gl-toolbar">
            <button className="adm-regen" onClick={startNew}>+ Add item</button>
            <button className="adm-regen" onClick={() => setAi(true)}>✨ AI draft</button>
          </div>
          {ai && <InventoryAI onClose={() => setAi(false)} onAdded={load} />}
          {editing === "new" && form}
          {resp.error ? (
            <div className="gl-hint">Couldn&apos;t reach inventory: {resp.error}</div>
          ) : (
            items.map((it) => (
              editing === it.id ? <div key={it.id}>{form}</div> : (
                <div key={it.id} className={`gl-item${it.qty != null && it.reorderPoint != null && it.qty <= it.reorderPoint ? " low" : ""}`}>
                  <div className="gl-item-main">
                    <b>{it.name}{it.qty != null ? ` · ${it.qty}${it.unit ? " " + it.unit : ""}` : ""}</b>
                    <span className="gl-uc">{[it.status, it.category, it.vendor].filter(Boolean).join(" · ")}</span>
                  </div>
                  <div className="gl-links">
                    {it.reorderLink && <a href={it.reorderLink} target="_blank" rel="noopener noreferrer">Reorder ↗</a>}
                    <button className="gl-edit" onClick={() => startEdit(it)}>Edit</button>
                    <button className="gl-del" onClick={() => del(it)} aria-label={`Delete ${it.name}`}>✕</button>
                  </div>
                </div>
              )
            ))
          )}
        </div>
      )}
    </div>
  );
}
