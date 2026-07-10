"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { uploadToBucket } from "@/lib/uploads";

// SMART INTAKE — drop any file (photo of gear, a permit, a receipt, a manual). It's read by the
// intake agent, which proposes where it belongs: an asset, an inventory consumable, or a stored
// document. Review/adjust, then file it. The file is kept in the private 'intake' bucket either way.
/* eslint-disable @typescript-eslint/no-explicit-any */

const KINDS: { key: string; label: string; icon: string }[] = [
  { key: "asset", label: "Asset / gear", icon: "🔧" },
  { key: "inventory", label: "Inventory", icon: "📦" },
  { key: "document", label: "Document", icon: "📄" },
  { key: "recipe", label: "Recipe", icon: "🧪" },
  { key: "photo", label: "Photo", icon: "🖼️" },
  { key: "other", label: "Other", icon: "•" },
];
const rand = (n: string) => `${Date.now()}-${n.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`.slice(0, 80);

export default function SmartIntake() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scan, setScan] = useState<any | null>(null); // { path, name, mime, proposal }
  const [p, setP] = useState<any | null>(null);        // editable proposal
  const [done, setDone] = useState<string | null>(null);

  const api = async (payload: any) => {
    const r = await authedFetch("/api/agents/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return r.json();
  };

  const onFile = async (file: File) => {
    if (!supabase) return;
    setErr(null); setDone(null); setScan(null); setP(null);
    setBusy("Uploading…");
    const path = rand(file.name);
    const res = await uploadToBucket({ bucket: "intake", file, path });
    if ("error" in res) { setErr(`Upload failed: ${res.error}`); setBusy(null); return; }
    setBusy("Reading the file…");
    const j = await api({ path, name: file.name, mime: file.type }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    setBusy(null);
    if (!j.ok) { setErr(j.error || "Couldn't read it."); return; }
    setScan(j); setP({ ...j.proposal });
  };

  const file = async () => {
    if (!p || !scan || busy) return;
    setBusy("Filing…"); setErr(null);
    const j = await api({ commit: { ...p, path: scan.path, name: p.name, mime: scan.mime } }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    setBusy(null);
    if (!j.ok) { setErr(j.error || "Couldn't file it."); return; }
    setDone(j.filed || "filed"); setScan(null); setP(null);
  };

  const set = (k: string, v: any) => setP((x: any) => ({ ...x, [k]: v }));
  const reset = () => { setScan(null); setP(null); setDone(null); setErr(null); if (fileRef.current) fileRef.current.value = ""; };

  return (
    <div className="intake">
      <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        accept="image/*,application/pdf,.txt,.csv,.md,.heic" />

      {done ? (
        <div className="eg-done">
          <div className="eg-done-h">✓ Filed to {done === "asset" ? "Assets / gear" : done === "inventory" ? "Inventory" : "Documents"}</div>
          <button type="button" className="cos-redo" onClick={reset}>Drop another file</button>
        </div>
      ) : !p ? (
        <button type="button" className="intake-drop" onClick={() => fileRef.current?.click()} disabled={!!busy}>
          <span className="intake-i">📎</span>
          <b>{busy || "Drop a file — I'll figure out where it goes"}</b>
          <span>Photo of gear, a permit, a receipt, a manual… anything</span>
        </button>
      ) : (
        <div className="intake-review">
          <div className="intake-readhead">
            <span className="intake-conf" data-c={p.confidence}>{p.confidence}</span>
            <b>Looks like {KINDS.find((k) => k.key === p.kind)?.icon} {KINDS.find((k) => k.key === p.kind)?.label}</b>
          </div>
          {p.action && <div className="dp-hint" style={{ marginTop: 0 }}>{p.action}</div>}

          {scan.knownAsset && (
            <div className="intake-kb">
              <div className="intake-kb-h">📖 You already have this — {scan.knownAsset.name}</div>
              {scan.knownAsset.next_due && (
                <div className={`intake-kb-due${scan.knownAsset.next_due.overdue ? " over" : ""}`}>
                  {scan.knownAsset.next_due.overdue ? "⚠ Overdue" : "Next"}: {scan.knownAsset.next_due.summary} · {scan.knownAsset.next_due.on}
                </div>
              )}
              {scan.knownAsset.manual_url && <a className="intake-kb-link" href={scan.knownAsset.manual_url} target="_blank" rel="noreferrer">Open manual ↗</a>}
              {scan.knownAsset.how_tos?.map((h: any, i: number) => (
                <details key={i} className="am-how"><summary>{h.summary}</summary>
                  <div className="am-how-steps">{String(h.how_to).split("\n").map((s: string) => s.trim()).filter(Boolean).map((s: string, j: number) => <div key={j}>{s}</div>)}</div>
                </details>
              ))}
              <div className="intake-kb-note">Already on file — only file again if this is a different unit.</div>
            </div>
          )}

          <div className="ts-chips" style={{ marginTop: 10 }}>
            {KINDS.map((k) => <button key={k.key} type="button" className={`ts-chip${p.kind === k.key ? " on" : ""}`} onClick={() => set("kind", k.key)}>{k.icon} {k.label}</button>)}
          </div>

          <input className="note-in" style={{ marginTop: 10 }} value={p.name} onChange={(e) => set("name", e.target.value)} placeholder="Name" />
          <textarea className="note-in" rows={2} style={{ marginTop: 8 }} value={p.summary} onChange={(e) => set("summary", e.target.value)} placeholder="Summary" />

          <div className="prod-grid" style={{ marginTop: 8 }}>
            {(p.kind === "asset" || p.kind === "inventory") && <label className="prod-f"><span>Category</span><input value={p.category} onChange={(e) => set("category", e.target.value)} /></label>}
            {p.kind === "inventory" && <label className="prod-f"><span>Qty</span><input type="number" value={p.qty ?? ""} onChange={(e) => set("qty", e.target.value === "" ? null : Number(e.target.value))} /></label>}
            {p.kind === "inventory" && <label className="prod-f"><span>Unit</span><input value={p.unit} onChange={(e) => set("unit", e.target.value)} placeholder="each / case / lb" /></label>}
            {["document", "recipe", "photo", "other"].includes(p.kind) && <label className="prod-f"><span>Doc type</span><input value={p.doc_kind} onChange={(e) => set("doc_kind", e.target.value)} placeholder="permit / coi / receipt…" /></label>}
          </div>

          {err && <div className="dp-err" style={{ marginTop: 8 }}>{err}</div>}
          <div className="prod-actions" style={{ marginTop: 12 }}>
            <button type="button" className="note-arch" onClick={reset} disabled={!!busy}>Cancel</button>
            <button type="button" className="note-save" onClick={file} disabled={!!busy}>{busy || `File it → ${p.kind === "asset" ? "Assets" : p.kind === "inventory" ? "Inventory" : "Documents"}`}</button>
          </div>
        </div>
      )}
      {err && !p && <div className="dp-err" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
