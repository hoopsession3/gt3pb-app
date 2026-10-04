"use client";

import { useEffect, useState } from "react";
import { SectionHeader } from "@/components/kit";
import { fetchInventory, type InvItem, type InventoryResp } from "@/lib/inventory";
import { supabase } from "@/lib/supabase";
import InventoryAI from "./InventoryAI";
import { useOptions } from "./useOptions";
import { useSuggestions } from "./useSuggestions";
import { withCurrent } from "@/lib/options";
import EmptyState from "./EmptyState";
import Icon from "@/components/Icon";
import { useConfirm } from "@/components/ConfirmSheet";
import { useAuth } from "./AuthProvider";
import { MARKETS, MARKET_LABEL, FOUNDING_MARKET, marketsPresent, toMarket, type Market } from "@/lib/markets";
import { homeMarket } from "@/lib/homeMarket";

// Inventory — the GT3 stock register, read from Postgres (system-of-record). Staff add / edit /
// delete inline; writes go straight to `inventory_items` (RLS: staff-write). Lives next to the
// gear library in Production → Assets (moved out of Prep along with Brew/Garage — 0161; crew-console
// audit caught this comment still naming the old lane). Reuses the .gl-* styles.

// STATUS and UNITS used to be declared here and, differently, in InventoryAI — two vocabularies
// for the same two columns. Both now come from public.option_sets (0306) through useOptions, with
// lib/options.ts holding the constants as the seed and the offline fallback.
//
// A SHELF HAS A CITY, AND THE COUNT IS THE SHELF'S (2026-10-04, the form audit).
//   · A new item had no city, so it took the column default (0288: 'greenville') — an item an Atlanta
//     crew member added landed on Greenville's shelf, where receive_lot refuses an Atlanta delivery
//     for it. A new item now starts in the city its person works from (lib/markets.homeMarket), two
//     chips to change; an existing shelf says whose it is (it cannot move — its history is that city's).
//   · The register showed and edited `qty`, the hand count from before the ledger, while everything
//     else — readiness, the pack-out plan, the reorder alert — reads the shelf's effective on-hand
//     (0205: the ledger's balance, else the hand count). On a shelf with any movement the two differ,
//     and editing Qty changed a number nothing reads. The register now shows on-hand, and a changed
//     count is written as a correction through set_on_hand (0318) — the same path as a recount at an
//     event, under its lock — so the number typed is the number every screen sees. The hand count is
//     written with it, for the readers that still read `qty` (the brew planner, the agents).

type Draft = {
  name: string; qty: string; unit: string; status: string; category: string;
  vendor: string; reorderPoint: string; reorderLink: string; notes: string; critical: boolean;
  market: Market;
};
const blankDraft = (market: Market): Draft => ({ name: "", qty: "", unit: "", status: "On Hand", category: "", vendor: "", reorderPoint: "", reorderLink: "", notes: "", critical: false, market });
/** What the shelf holds: the ledger's balance, else the hand count (inventory_status.effective_on_hand). */
const onHandOf = (r: InvItem): number | null => r.onHand ?? r.qty;
const toDraft = (r: InvItem): Draft => ({
  name: r.name, qty: onHandOf(r) != null ? String(onHandOf(r)) : "", unit: r.unit || "", status: r.status || "On Hand",
  category: r.category || "", vendor: r.vendor || "", reorderPoint: r.reorderPoint != null ? String(r.reorderPoint) : "",
  reorderLink: r.reorderLink || "", notes: r.notes || "", critical: !!r.critical,
  market: toMarket(r.market),
});

export default function InventoryLibrary() {
  const confirm = useConfirm();
  const { profile } = useAuth();
  const [resp, setResp] = useState<InventoryResp | null>(null);
  const [open, setOpen] = useState(true); // renders inside the Garage fold — default open so it's one fold, not two
  const [editing, setEditing] = useState<string | null>(null);
  const units = useOptions("inventory_unit");
  const statuses = useOptions("inventory_status");
  const sugg = useSuggestions();
  const [draft, setDraft] = useState<Draft>(() => blankDraft(FOUNDING_MARKET));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ai, setAi] = useState(false);

  const load = () => fetchInventory().then(setResp);
  useEffect(() => { load(); }, []);
  if (!resp) return null;

  if (!resp.enabled) {
    return (
      <div className="adm-sec gl">
        <SectionHeader label="Inventory" annotation="stock & reorder" />
        <div className="gl-hint">Sign in as crew to see inventory.</div>
      </div>
    );
  }

  const items = [...resp.items].sort((a, b) => a.name.localeCompare(b.name));
  const startNew = () => { setErr(null); setDraft(blankDraft(homeMarket(profile) ?? FOUNDING_MARKET)); setEditing("new"); setOpen(true); };
  const editingItem = editing && editing !== "new" ? items.find((i) => i.id === editing) ?? null : null;
  const manyCities = marketsPresent(items).length > 1;
  const startEdit = (r: InvItem) => { setErr(null); setDraft(toDraft(r)); setEditing(r.id); };
  const cancel = () => { setEditing(null); setErr(null); };

  const save = async () => {
    if (!supabase || !draft.name.trim()) { setErr("Name is required"); return; }
    setBusy(true); setErr(null);
    const count = draft.qty.trim() === "" ? null : Number(draft.qty);
    const row = {
      name: draft.name.trim(),
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
      ? await supabase.from("inventory_items").insert({ ...row, qty: count, market: draft.market })
      // The hand count follows too: the brew planner and the agents still read `qty`, and a recount
      // made here should not leave them a number behind the shelf.
      : await supabase.from("inventory_items").update(count != null && Number.isFinite(count) ? { ...row, qty: count } : row).eq("id", editing);
    if (error) { setBusy(false); setErr(error.message); return; }
    // A changed count on an existing shelf is a correction to the shelf, not a new hand count.
    if (editingItem && count != null && Number.isFinite(count) && count !== onHandOf(editingItem)) {
      const { error: countErr } = await supabase.rpc("set_on_hand", {
        p_item: row.name, p_want: count, p_market: toMarket(editingItem.market), p_note: "Counted on the inventory register",
      });
      if (countErr) { setBusy(false); setErr(`Saved, but the count did not move — ${countErr.message}`); load(); return; }
    }
    setBusy(false);
    setEditing(null); load();
  };

  const del = async (r: InvItem) => {
    if (!supabase) return;
    if (!(await confirm({ title: `Delete “${r.name}”?`, body: "This can't be undone.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await supabase.from("inventory_items").delete().eq("id", r.id);
    if (error) { setErr(error.message); return; }
    load();
  };

  const form = (
    <div className="gl-form">
      <div className="gl-form-h">{editing === "new" ? "New inventory item" : "Edit item"}</div>
      <label className="gl-f"><span>Name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. 10 oz Stout Bottle" /></label>
      {editing === "new" ? (MARKETS.length > 1 && (
        <div className="gl-f" role="group" aria-label="Whose shelf">
          <span>Whose shelf</span>
          <div className="ts-chips">
            {MARKETS.map((m) => (
              <button type="button" key={m} className={`ts-chip${draft.market === m ? " on" : ""}`} aria-pressed={draft.market === m}
                onClick={() => setDraft({ ...draft, market: m })}>{MARKET_LABEL[m]}</button>
            ))}
          </div>
        </div>
      )) : editingItem && manyCities && (
        <div className="gl-hint">{`${MARKET_LABEL[toMarket(editingItem.market)]}'s shelf — its count and history are that city's.`}</div>
      )}
      <div className="gl-frow">
        <label className="gl-f"><span>On hand</span><input type="number" inputMode="decimal" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} /></label>
        <label className="gl-f"><span>Unit</span>
          <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
            <option value="">—</option>
            {withCurrent(units, draft.unit).map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </label>
        <label className="gl-f"><span>Status</span>
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            {withCurrent(statuses, draft.status).map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
          </select>
        </label>
      </div>
      <div className="gl-frow">
        {/* Open sets, so a suggest-list rather than a picker: you can still add a category or buy
            from a new vendor, you just stop creating a second spelling of an existing one. */}
        <label className="gl-f"><span>Category</span><input value={draft.category} list="gt3-inv-cats-lib" onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="Brewing Equipment" /></label>
        <datalist id="gt3-inv-cats-lib">{sugg.categories.map((c) => <option key={c} value={c} />)}</datalist>
        <label className="gl-f"><span>Vendor</span><input value={draft.vendor} list="gt3-vendors" onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} /></label>
        <datalist id="gt3-vendors">{sugg.vendors.map((v) => <option key={v} value={v} />)}</datalist>
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

  const isLow = (r: InvItem) => { const n = onHandOf(r); return n != null && r.reorderPoint != null && n <= r.reorderPoint; };
  const low = items.filter(isLow).length;

  return (
    <div className="adm-sec gl">
      <button className="gl-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <SectionHeader label="Inventory" annotation={`${items.length} item${items.length === 1 ? "" : "s"}${low ? ` · ${low} low` : ""}`} />
        <span className={`ev-chev${open ? " open" : ""}`} aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="gl-body">
          <div className="gl-toolbar">
            <button className="adm-regen" onClick={startNew}>+ Add item</button>
            <button className="adm-regen" onClick={() => setAi(true)}><Icon name="sparkles" /> AI draft</button>
          </div>
          {ai && <InventoryAI onClose={() => setAi(false)} onAdded={load} />}
          {editing === "new" && form}
          {resp.error ? (
            <div className="gl-hint">Couldn&apos;t reach inventory: {resp.error}</div>
          ) : items.length === 0 ? (
            editing !== "new" && <EmptyState title="No inventory items yet" sub="Add what you stock — counts, costs & pars start here." />
          ) : (
            items.map((it) => (
              editing === it.id ? <div key={it.id}>{form}</div> : (
                <div key={it.id} className={`gl-item${isLow(it) ? " low" : ""}`}>
                  <div className="gl-item-main">
                    <b>{it.name}{onHandOf(it) != null ? ` · ${onHandOf(it)}${it.unit ? " " + it.unit : ""}` : ""}</b>
                    <span className="gl-uc">{[manyCities ? MARKET_LABEL[toMarket(it.market)] : null, it.status, it.category, it.vendor].filter(Boolean).join(" · ")}</span>
                  </div>
                  <div className="gl-links">
                    {it.reorderLink && <a href={it.reorderLink} target="_blank" rel="noopener noreferrer">Reorder <Icon name="externalLink" /></a>}
                    <button className="gl-edit" onClick={() => startEdit(it)}>Edit</button>
                    <button className="gl-del" onClick={() => del(it)} aria-label={`Delete ${it.name}`}><Icon name="close" /></button>
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
