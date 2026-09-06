"use client";

import { useEffect, useState } from "react";
import { SectionHeader } from "@/components/kit";
import { fetchAssets, type AssetItem, type AssetsResp } from "@/lib/assets";
import { supabase } from "@/lib/supabase";
import EmptyState from "./EmptyState";
import Icon from "@/components/Icon";
import { MARKETS, MARKET_LABEL, toMarket, type Market } from "@/lib/markets";
import {
  STATUS_LABEL, DISPOSITIONS, DISPOSITION_LABEL, CRITICALITY, CRITICALITY_LABEL,
  nextStates, toStatus, toCriticality, validateRetire, isDeployed, isOwned,
} from "@/lib/equipment";

// Gear & manuals — the GT3 asset register, read from Postgres (system-of-record). Staff can
// add / edit inline; writes go straight to the `assets` table (RLS: staff-write).
//
// EQUIPMENT IS RETIRED, NEVER DELETED (0276). This panel used to offer a hard delete behind a
// window.confirm(), which cascaded into asset_maintenance and destroyed the service history of the
// thing being removed. Retiring is now the only way out: the asset keeps its history, its provenance
// is written to asset_movements by a database trigger, and the database itself refuses the delete.

const BRAND_ORDER = ["GT3 Performance Bar", "GT3 Brew", "Shared"];
const KB_OPTS = ["Drafted", "Reviewed", "Needs manual"];

type Draft = {
  name: string; makeModel: string; brand: string; categoryStr: string;
  useCase: string; manual: string; kbStatus: string; qty: string; notes: string;
  lenIn: string; widthIn: string; heightIn: string; weightLb: string;
  market: Market; status: string; criticality: string; assetTag: string; serialNo: string;
};
const emptyDraft: Draft = {
  name: "", makeModel: "", brand: "GT3 Performance Bar", categoryStr: "", useCase: "", manual: "",
  kbStatus: "Drafted", qty: "", notes: "", lenIn: "", widthIn: "", heightIn: "", weightLb: "",
  market: "greenville", status: "active", criticality: "standard", assetTag: "", serialNo: "",
};
const toDraft = (a: AssetItem): Draft => ({
  name: a.name, makeModel: a.makeModel || "", brand: a.brand || "Shared", categoryStr: (a.category || []).join(", "),
  useCase: a.useCase || "", manual: a.manual || "", kbStatus: a.kbStatus || "Drafted", qty: a.qty != null ? String(a.qty) : "", notes: a.notes || "",
  lenIn: a.lenIn != null ? String(a.lenIn) : "", widthIn: a.widthIn != null ? String(a.widthIn) : "", heightIn: a.heightIn != null ? String(a.heightIn) : "", weightLb: a.weightLb != null ? String(a.weightLb) : "",
  market: toMarket(a.market), status: toStatus(a.status), criticality: toCriticality(a.criticality), assetTag: "", serialNo: "",
});
const cuft = (a: AssetItem) => (a.lenIn && a.widthIn && a.heightIn ? Math.round(((a.lenIn * a.widthIn * a.heightIn) / 1728) * 10) / 10 : null);

export default function GearLibrary() {
  const [resp, setResp] = useState<AssetsResp | null>(null);
  const [open, setOpen] = useState(true); // renders inside the Garage fold — default open so it's one fold, not two
  const [editing, setEditing] = useState<string | null>(null); // asset id, or "new", or null
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [marketFilter, setMarketFilter] = useState<"all" | Market>("all");
  const [showRetired, setShowRetired] = useState(false);
  const [retiring, setRetiring] = useState<AssetItem | null>(null);
  const [retireDraft, setRetireDraft] = useState({ disposition: "", reason: "" });

  const load = () => fetchAssets().then(setResp);
  useEffect(() => { load(); }, []);
  if (!resp) return null;

  if (!resp.enabled) {
    return (
      <div className="adm-sec gl">
        <SectionHeader label="Gear & manuals" annotation="the library" />
        <div className="gl-hint">Sign in as crew to see the gear library.</div>
      </div>
    );
  }

  const all = resp.items;
  // The fleet readout answers the question a market lead actually has — not "how much gear do we
  // own" but "how much of it can we run on Saturday".
  const scoped = all.filter((a) => marketFilter === "all" || toMarket(a.market) === marketFilter);
  const deployed = scoped.filter((a) => isDeployed(toStatus(a.status))).length;
  const unavailable = scoped.filter((a) => { const s = toStatus(a.status); return isOwned(s) && !isDeployed(s); }).length;
  const retiredCount = scoped.filter((a) => toStatus(a.status) === "retired").length;
  const items = scoped.filter((a) => showRetired || toStatus(a.status) !== "retired");

  const startNew = () => { setErr(null); setDraft({ ...emptyDraft, market: marketFilter === "all" ? "greenville" : marketFilter }); setEditing("new"); setOpen(true); };
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
      len_in: draft.lenIn.trim() === "" ? null : Number(draft.lenIn),
      width_in: draft.widthIn.trim() === "" ? null : Number(draft.widthIn),
      height_in: draft.heightIn.trim() === "" ? null : Number(draft.heightIn),
      weight_lb: draft.weightLb.trim() === "" ? null : Number(draft.weightLb),
      market: draft.market,
      status: draft.status,
      criticality: draft.criticality,
      asset_tag: draft.assetTag.trim() || null,
      serial_no: draft.serialNo.trim() || null,
    };
    const { error } = editing === "new"
      ? await supabase.from("assets").insert(row)
      : await supabase.from("assets").update(row).eq("id", editing);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setEditing(null); load();
  };

  // Retirement, with its paperwork. The disposition is required by the database too — this is the
  // friendly half of a rule the schema enforces regardless.
  const doRetire = async () => {
    if (!supabase || !retiring) return;
    const v = validateRetire(retireDraft);
    if (!v.ok) { setErr(v.error); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.from("assets").update({
      status: "retired",
      disposition: retireDraft.disposition,
      retire_reason: retireDraft.reason.trim(),
      retired_on: new Date().toISOString().slice(0, 10),
    }).eq("id", retiring.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setRetiring(null); setRetireDraft({ disposition: "", reason: "" }); load();
  };

  // Retired gear comes back as a SPARE, never straight into service — putting it back to work is a
  // second, deliberate decision. Mirrors the transition table in lib/equipment.
  const reinstate = async (a: AssetItem) => {
    if (!supabase) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("assets")
      .update({ status: "reserve", disposition: null, retire_reason: null, retired_on: null })
      .eq("id", a.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    load();
  };

  const cur = toStatus(draft.status);
  const statusOpts = editing === "new"
    ? (["planned", "active", "reserve"] as const)
    : ([cur, ...nextStates(cur).filter((s) => s !== "retired")] as const);

  const form = (
    <div className="gl-form">
      <div className="gl-form-h">{editing === "new" ? "New gear" : "Edit gear"}</div>
      <label className="gl-f"><span>Name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Summit Nitro Kegerator" /></label>
      <label className="gl-f"><span>Make / model</span><input value={draft.makeModel} onChange={(e) => setDraft({ ...draft, makeModel: e.target.value })} /></label>
      <div className="gl-frow">
        <label className="gl-f"><span>Market</span>
          <select value={draft.market} onChange={(e) => setDraft({ ...draft, market: toMarket(e.target.value) })}>
            {MARKETS.map((m) => <option key={m} value={m}>{MARKET_LABEL[m]}</option>)}
          </select>
        </label>
        <label className="gl-f"><span>Status</span>
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            {statusOpts.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
      </div>
      <div className="gl-frow">
        <label className="gl-f"><span>If it&apos;s down, what happens?</span>
          <select value={draft.criticality} onChange={(e) => setDraft({ ...draft, criticality: e.target.value })}>
            {CRITICALITY.map((c) => <option key={c} value={c}>{CRITICALITY_LABEL[c]}</option>)}
          </select>
        </label>
        <label className="gl-f"><span>Brand</span>
          <select value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })}>
            {BRAND_ORDER.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
      </div>
      <div className="gl-frow">
        <label className="gl-f"><span>Asset tag</span><input value={draft.assetTag} onChange={(e) => setDraft({ ...draft, assetTag: e.target.value })} placeholder="GT3-ATL-014" /></label>
        <label className="gl-f"><span>Serial</span><input value={draft.serialNo} onChange={(e) => setDraft({ ...draft, serialNo: e.target.value })} /></label>
      </div>
      <label className="gl-f"><span>Qty</span><input type="number" inputMode="numeric" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} /></label>
      <div className="gl-f"><span>Load-out size <i>(inches — drives the trailer/vehicle fit)</i></span>
        <div className="gl-dims">
          <input type="number" inputMode="decimal" value={draft.lenIn} onChange={(e) => setDraft({ ...draft, lenIn: e.target.value })} placeholder="L" aria-label="Length (in)" />
          <span className="gl-dimx">×</span>
          <input type="number" inputMode="decimal" value={draft.widthIn} onChange={(e) => setDraft({ ...draft, widthIn: e.target.value })} placeholder="W" aria-label="Width (in)" />
          <span className="gl-dimx">×</span>
          <input type="number" inputMode="decimal" value={draft.heightIn} onChange={(e) => setDraft({ ...draft, heightIn: e.target.value })} placeholder="H" aria-label="Height (in)" />
          <input type="number" inputMode="decimal" className="gl-dimw" value={draft.weightLb} onChange={(e) => setDraft({ ...draft, weightLb: e.target.value })} placeholder="lb" aria-label="Weight (lb)" />
        </div>
        {draft.lenIn && draft.widthIn && draft.heightIn && <div className="gl-dim-note">≈ {Math.round(((Number(draft.lenIn) * Number(draft.widthIn) * Number(draft.heightIn)) / 1728) * 10) / 10} cu ft — packed (collapse handles/lids first)</div>}
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
        <SectionHeader label="Gear & manuals" annotation={`${deployed} in service${unavailable ? ` · ${unavailable} unavailable` : ""}`} />
        <span className={`ev-chev${open ? " open" : ""}`} aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="gl-body">
          <div className="gl-toolbar">
            <button className="adm-regen" onClick={startNew}>+ Add gear</button>
            <div className="gl-filters">
              <button type="button" className={`gl-chip${marketFilter === "all" ? " on" : ""}`} onClick={() => setMarketFilter("all")}>All markets</button>
              {MARKETS.map((m) => (
                <button key={m} type="button" className={`gl-chip${marketFilter === m ? " on" : ""}`} onClick={() => setMarketFilter(m)}>{MARKET_LABEL[m]}</button>
              ))}
              {retiredCount > 0 && (
                <button type="button" className={`gl-chip${showRetired ? " on" : ""}`} onClick={() => setShowRetired((v) => !v)}>
                  Retired ({retiredCount})
                </button>
              )}
            </div>
          </div>

          {retiring && (
            <div className="gl-form gl-retire">
              <div className="gl-form-h">Retire “{retiring.name}”</div>
              <p className="gl-retire-note">
                It keeps its service history and its record of where it&apos;s been. Nothing is deleted — it stops
                counting as capacity and moves out of the working list.
              </p>
              <label className="gl-f"><span>What happened to it?</span>
                <select value={retireDraft.disposition} onChange={(e) => setRetireDraft({ ...retireDraft, disposition: e.target.value })}>
                  <option value="">Choose…</option>
                  {DISPOSITIONS.map((d) => <option key={d} value={d}>{DISPOSITION_LABEL[d]}</option>)}
                </select>
              </label>
              <label className="gl-f"><span>Reason <i>(in a year this is the only explanation anyone will have)</i></span>
                <input value={retireDraft.reason} onChange={(e) => setRetireDraft({ ...retireDraft, reason: e.target.value })} placeholder="Compressor failed, past economical repair" />
              </label>
              {err && <div className="gl-err">{err}</div>}
              <div className="gl-form-actions">
                <button className="adm-btn primary" onClick={doRetire} disabled={busy}>{busy ? "Retiring…" : "Retire it"}</button>
                <button className="adm-btn ghost" onClick={() => { setRetiring(null); setErr(null); }} disabled={busy}>Cancel</button>
              </div>
            </div>
          )}

          {editing === "new" && form}
          {resp.error ? (
            <div className="gl-hint">Couldn&apos;t reach the asset register: {resp.error}</div>
          ) : items.length === 0 ? (
            editing !== "new" && <EmptyState title="No gear here yet" sub={marketFilter === "all" ? "Add your first piece — manuals, specs & maintenance live here." : `Nothing registered in ${MARKET_LABEL[marketFilter as Market]} yet. Add a piece, or move one over from another market by editing it.`} />
          ) : (
            BRAND_ORDER.map((b) => {
              const list = items.filter((i) => (i.brand ?? "Shared") === b);
              if (!list.length) return null;
              return (
                <div key={b} className="gl-brand">
                  <div className="gl-brand-h">{b}</div>
                  {list.map((it: AssetItem) => {
                    const st = toStatus(it.status);
                    const mk = toMarket(it.market);
                    return editing === it.id ? <div key={it.id}>{form}</div> : (
                      <div key={it.id} className={`gl-item${st === "retired" ? " gl-item-retired" : ""}`}>
                        <div className="gl-item-main">
                          <b>{it.name}{it.qty && it.qty > 1 ? ` ×${it.qty}` : ""}</b>
                          <span className="gl-tags">
                            <span className={`gl-status gl-status-${st}`}>{STATUS_LABEL[st]}</span>
                            <span className="gl-market">{MARKET_LABEL[mk]}</span>
                            {toCriticality(it.criticality) === "critical" && st !== "retired" && <span className="gl-crit">Critical</span>}
                          </span>
                          {cuft(it) != null && <span className="gl-dimtag" title="Used by the load-out space planner">{it.lenIn}×{it.widthIn}×{it.heightIn}in · {cuft(it)} cu ft{it.weightLb ? ` · ${it.weightLb} lb` : ""}</span>}
                          {it.useCase && <span className="gl-uc">{it.useCase}</span>}
                          {st === "retired" && (
                            <span className="gl-uc">
                              Retired{it.retiredOn ? ` ${it.retiredOn}` : ""}{it.disposition ? ` · ${DISPOSITION_LABEL[it.disposition as keyof typeof DISPOSITION_LABEL] ?? it.disposition}` : ""}
                            </span>
                          )}
                          {it.notes && (
                            <details className="gl-notes">
                              <summary>Specs &amp; safety</summary>
                              <div className="gl-notes-body">{it.notes}</div>
                            </details>
                          )}
                        </div>
                        <div className="gl-links">
                          {it.manual && <a href={it.manual} target="_blank" rel="noopener noreferrer">Manual <Icon name="externalLink" /></a>}
                          <button className="gl-edit" onClick={() => startEdit(it)}>Edit</button>
                          {st === "retired"
                            ? <button className="gl-edit" onClick={() => reinstate(it)} disabled={busy}>Reinstate</button>
                            : <button className="gl-edit" onClick={() => { setErr(null); setRetireDraft({ disposition: "", reason: "" }); setRetiring(it); }}>Retire</button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
