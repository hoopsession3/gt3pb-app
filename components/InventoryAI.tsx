"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import Sheet from "@/components/Sheet";

// INVENTORY AI — describe an item and it drafts a COMPLETE inventory record (every attribute filled /
// inferred). Review + tweak ANY field, then add it to the stock register. Reuses the .gl-* / .dp-*
// styles. Talks to /api/agents/inventory (propose → commit); nothing is saved until you add it.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Item = {
  name: string; qty: number | null; unit: string | null; category: string | null;
  reorder_point: number | null; status: string; use_cases: string[]; required_for: string[];
  critical: boolean; reorder_link: string | null; notes: string | null;
};

const STATUS = ["On Hand", "In Transit", "Backorder", "Low", "Out"];
const stack: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 9 };

export default function InventoryAI({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [done, setDone] = useState(false);

  const token = async () => (await supabase!.auth.getSession()).data.session?.access_token;
  const post = async (payload: any) => {
    const t = await token();
    const r = await fetch("/api/agents/inventory", { method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(payload) });
    return r.json();
  };

  const draft = async () => {
    if (!supabase || busy || !desc.trim()) return;
    setBusy(true); setErr(null);
    const j = await post({ description: desc }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!j.ok) setErr(j.error || "Couldn't draft it."); else setItem(j.item);
    setBusy(false);
  };
  const save = async () => {
    if (!supabase || !item || busy || !item.name.trim()) return;
    setBusy(true); setErr(null);
    const j = await post({ commit: true, item }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!j.ok) setErr(j.error || "Couldn't save."); else { setDone(true); onAdded(); }
    setBusy(false);
  };
  const set = (k: keyof Item, v: any) => setItem((p) => p ? { ...p, [k]: v } : p);

  return (
    <Sheet open onClose={onClose} header={<div style={{ display: "flex", alignItems: "center" }}><div className="dp-head-l"><div className="dp-eyebrow">AI inventory · drafts every attribute</div><div className="dp-title">Add an item</div></div><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>}>
          {done ? (
            <div className="eg-done">
              <div className="eg-done-h">✓ Added &ldquo;{item?.name}&rdquo; to inventory</div>
              <div className="dp-hint" style={{ marginTop: 8 }}>It&apos;s in the stock register now — edit qty, reorder point, or anything else inline anytime.</div>
              <div className="prod-actions" style={{ marginTop: 12 }}><span /><button type="button" className="note-save" onClick={onClose}>Done</button></div>
            </div>
          ) : !item ? (
            <>
              <div className="dp-hint">Describe an item — a box you just opened, a label, whatever. I&apos;ll draft a complete record (qty, unit, category, reorder point, what it&apos;s for, whether it&apos;s event-critical, a reorder link, and notes) for you to check.</div>
              <textarea className="note-in" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. EcoFlow Delta 2 power station, 1 unit, runs the trailer when there's no shore power…" autoFocus disabled={busy} />
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="note-save" onClick={draft} disabled={busy || !desc.trim()}>{busy ? "Drafting…" : "✨ Draft it"}</button>
              </div>
            </>
          ) : (
            <>
              <div className="dp-hint">Drafted every attribute — check each, fix anything, then add it.</div>
              <div style={stack}>
                <label className="gl-f"><span>Name</span><input value={item.name} onChange={(e) => set("name", e.target.value)} /></label>
                <label className="gl-f"><span>Qty</span><input type="number" inputMode="decimal" value={item.qty ?? ""} onChange={(e) => set("qty", e.target.value === "" ? null : Number(e.target.value))} /></label>
                <label className="gl-f"><span>Unit</span><input value={item.unit ?? ""} onChange={(e) => set("unit", e.target.value)} /></label>
                <label className="gl-f"><span>Category</span><input value={item.category ?? ""} onChange={(e) => set("category", e.target.value)} /></label>
                <label className="gl-f"><span>Status</span><select value={item.status} onChange={(e) => set("status", e.target.value)}>{STATUS.map((s) => <option key={s}>{s}</option>)}</select></label>
                <label className="gl-f"><span>Reorder point</span><input type="number" inputMode="decimal" value={item.reorder_point ?? ""} onChange={(e) => set("reorder_point", e.target.value === "" ? null : Number(e.target.value))} /></label>
                <label className="gl-f gl-check"><input type="checkbox" checked={item.critical} onChange={(e) => set("critical", e.target.checked)} /><span>Event-critical</span></label>
                <label className="gl-f"><span>Use cases</span><input value={item.use_cases.join(", ")} onChange={(e) => set("use_cases", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} placeholder="comma-separated" /></label>
                <label className="gl-f"><span>Required for</span><input value={item.required_for.join(", ")} onChange={(e) => set("required_for", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} placeholder="Market, Festival…" /></label>
                <label className="gl-f"><span>Reorder link</span><input value={item.reorder_link ?? ""} onChange={(e) => set("reorder_link", e.target.value)} placeholder="https://…" /></label>
                <label className="gl-f"><span>Notes</span><textarea rows={4} value={item.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></label>
              </div>
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={() => setItem(null)} disabled={busy}>‹ Redo</button>
                <button type="button" className="note-save" onClick={save} disabled={busy || !item.name.trim()}>{busy ? "Adding…" : "Add to inventory"}</button>
              </div>
            </>
          )}
    </Sheet>
  );
}
