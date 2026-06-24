"use client";

import { useEffect, useState } from "react";
import { fetchAssets, type AssetItem, type AssetsResp } from "@/lib/assets";
import { supabase } from "@/lib/supabase";

// Gear & manuals — the GT3 asset register, read from Postgres (system-of-record). Staff can
// add / edit / delete inline; writes go straight to the `assets` table (RLS: staff-write).
// Postgres is the sole source of truth — Notion is no longer in the loop.

const BRAND_ORDER = ["GT3 Performance Bar", "GT3 Brew", "Shared"];
const KB_OPTS = ["Drafted", "Reviewed", "Needs manual"];

type Draft = {
  name: string; makeModel: string; brand: string; categoryStr: string;
  useCase: string; manual: string; kbStatus: string; qty: string; notes: string;
};
const emptyDraft: Draft = { name: "", makeModel: "", brand: "GT3 Performance Bar", categoryStr: "", useCase: "", manual: "", kbStatus: "Drafted", qty: "", notes: "" };
const toDraft = (a: AssetItem): Draft => ({
  name: a.name, makeModel: a.makeModel || "", brand: a.brand || "Shared", categoryStr: (a.category || []).join(", "),
  useCase: a.useCase || "", manual: a.manual || "", kbStatus: a.kbStatus || "Drafted", qty: a.qty != null ? String(a.qty) : "", notes: a.notes || "",
});

export default function GearLibrary() {
  const [resp, setResp] = useState<AssetsResp | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // asset id, or "new", or null
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => fetchAssets().then(setResp);
  useEffect(() => { load(); }, []);
  if (!resp) return null;

  if (!resp.enabled) {
    return (
      <div className="adm-sec gl">
        <div className="sec">Gear &amp; manuals</div>
        <div className="gl-hint">Sign in as crew to see the gear library.</div>
      </div>
    );
  }

  const items = resp.items;
  const startNew = () => { setErr(null); setDraft(emptyDraft); setEditing("new"); setOpen(true); };
  const startEdit = (a: AssetItem) => { setErr(null); setDraft(toDraft(a)); setEditing(a.id); };
  const cancel = () => { setEditing(null); setErr(null); };

  const save = async () => {
    if (!supabase || !draft.name.trim()) { setErr("Name is required"); return; }
    setBusy(true); setErr(null);
    const row = {
      name: draft.name.trim(),
      make_model: draft.makeModel.trim() || null,
      brand: draft.brand || null,
      category: draft.categoryStr.split(",").map((s) => s.trim()).filter(Boolean),
      use_case: draft.useCase.trim() || null,
      manual_url: draft.manual.trim() || null,
      kb_status: draft.kbStatus || null,
      qty: draft.qty.trim() === "" ? null : Number(draft.qty),
      notes: draft.notes.trim() || null,
    };
    const { error } = editing === "new"
      ? await supabase.from("assets").insert(row)
      : await supabase.from("assets").update(row).eq("id", editing);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setEditing(null); load();
  };

  const del = async (a: AssetItem) => {
    if (!supabase || typeof window === "undefined" || !window.confirm(`Delete "${a.name}"? This can't be undone.`)) return;
    const { error } = await supabase.from("assets").delete().eq("id", a.id);
    if (error) { setErr(error.message); return; }
    load();
  };

  const form = (
    <div className="gl-form">
      <div className="gl-form-h">{editing === "new" ? "New gear" : "Edit gear"}</div>
      <label className="gl-f"><span>Name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Summit Nitro Kegerator" /></label>
      <label className="gl-f"><span>Make / model</span><input value={draft.makeModel} onChange={(e) => setDraft({ ...draft, makeModel: e.target.value })} /></label>
      <div className="gl-frow">
        <label className="gl-f"><span>Brand</span>
          <select value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })}>
            {BRAND_ORDER.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="gl-f"><span>Qty</span><input type="number" inputMode="numeric" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} /></label>
      </div>
      <label className="gl-f"><span>Category <i>(comma-separated)</i></span><input value={draft.categoryStr} onChange={(e) => setDraft({ ...draft, categoryStr: e.target.value })} placeholder="Event Equipment, Marketing" /></label>
      <label className="gl-f"><span>GT3 use case</span><textarea rows={2} value={draft.useCase} onChange={(e) => setDraft({ ...draft, useCase: e.target.value })} /></label>
      <label className="gl-f"><span>Specs &amp; safety <i>(instructions — how to use it + safety)</i></span><textarea rows={5} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Specs, how we use it, and the safety steps…" /></label>
      <label className="gl-f"><span>Manual / source URL</span><input value={draft.manual} onChange={(e) => setDraft({ ...draft, manual: e.target.value })} placeholder="https://…" /></label>
      <label className="gl-f"><span>KB status</span>
        <select value={draft.kbStatus} onChange={(e) => setDraft({ ...draft, kbStatus: e.target.value })}>
          {KB_OPTS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      {err && <div className="gl-err">{err}</div>}
      <div className="gl-form-actions">
        <button className="adm-btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button className="adm-btn ghost" onClick={cancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="adm-sec gl">
      <button className="gl-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="sec">Gear &amp; manuals · {items.length}</span>
        <span className="gl-chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="gl-body">
          <div className="gl-toolbar">
            <button className="adm-regen" onClick={startNew}>+ Add gear</button>
          </div>
          {editing === "new" && form}
          {resp.error ? (
            <div className="gl-hint">Couldn&apos;t reach the asset register: {resp.error}</div>
          ) : (
            BRAND_ORDER.map((b) => {
              const list = items.filter((i) => (i.brand ?? "Shared") === b);
              if (!list.length) return null;
              return (
                <div key={b} className="gl-brand">
                  <div className="gl-brand-h">{b}</div>
                  {list.map((it: AssetItem) => (
                    editing === it.id ? <div key={it.id}>{form}</div> : (
                      <div key={it.id} className="gl-item">
                        <div className="gl-item-main">
                          <b>{it.name}{it.qty && it.qty > 1 ? ` ×${it.qty}` : ""}</b>
                          {it.useCase && <span className="gl-uc">{it.useCase}</span>}
                          {it.notes && (
                            <details className="gl-notes">
                              <summary>Specs &amp; safety</summary>
                              <div className="gl-notes-body">{it.notes}</div>
                            </details>
                          )}
                        </div>
                        <div className="gl-links">
                          {it.manual && <a href={it.manual} target="_blank" rel="noopener noreferrer">Manual ↗</a>}
                          <button className="gl-edit" onClick={() => startEdit(it)}>Edit</button>
                          <button className="gl-del" onClick={() => del(it)} aria-label={`Delete ${it.name}`}>✕</button>
                        </div>
                      </div>
                    )
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
