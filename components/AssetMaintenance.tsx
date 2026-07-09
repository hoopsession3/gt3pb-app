"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Sheet from "@/components/Sheet";

// ASSET MAINTENANCE — upkeep log for the gear. Each asset shows its last service and what's due next
// (or overdue); tap to see the full history and log a new service/repair/clean/inspection. Staff-gated
// via RLS. Lives under the gear library.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Asset = { id: string; name: string; make_model: string | null; brand: string | null };
type Log = { id: string; asset_id: string; kind: string; performed_on: string; summary: string; how_to: string | null; next_due_on: string | null; cost_cents: number | null; performed_by: string | null };

const KINDS = ["service", "repair", "clean", "inspect", "calibrate", "note"];
const KIND_ICON: Record<string, string> = { service: "🔧", repair: "🛠️", clean: "🧽", inspect: "🔍", calibrate: "🎚️", note: "📝" };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmt = (s: string | null) => s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

export default function AssetMaintenance() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<Asset | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: a }, { data: l }] = await Promise.all([
      supabase.from("assets").select("id, name, make_model, brand").order("name"),
      supabase.from("asset_maintenance").select("id, asset_id, kind, performed_on, summary, how_to, next_due_on, cost_cents, performed_by").order("performed_on", { ascending: false }),
    ]);
    setAssets((a as Asset[]) ?? []); setLogs((l as Log[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const delLog = async (id: string) => {
    if (!supabase) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this maintenance record?")) return;
    setLogs((p) => p.filter((x) => x.id !== id)); // optimistic
    await supabase.from("asset_maintenance").delete().eq("id", id);
  };

  const tdy = today();
  const statusOf = (id: string) => {
    const mine = logs.filter((x) => x.asset_id === id);
    const last = mine[0]?.performed_on ?? null;
    const dues = mine.map((x) => x.next_due_on).filter(Boolean) as string[];
    const nextDue = dues.length ? dues.sort()[0] : null;
    const overdue = !!nextDue && nextDue < tdy;
    return { last, nextDue, overdue, count: mine.length };
  };
  // sort: overdue first, then soonest-due, then by name
  const sorted = [...assets].sort((a, b) => {
    const sa = statusOf(a.id), sb = statusOf(b.id);
    if (sa.overdue !== sb.overdue) return sa.overdue ? -1 : 1;
    if (sa.nextDue && sb.nextDue) return sa.nextDue.localeCompare(sb.nextDue);
    if (sa.nextDue) return -1; if (sb.nextDue) return 1;
    return a.name.localeCompare(b.name);
  });
  const overdueCount = assets.filter((a) => statusOf(a.id).overdue).length;

  return (
    <div className="adm-sec">
      <div className="sec">Asset maintenance{overdueCount > 0 && <span className="subnav-badge hot" style={{ marginLeft: 8 }}>{overdueCount} due</span>}</div>
      <div className="pnl-note" style={{ marginBottom: 8 }}>Upkeep log for the gear — last service, what&apos;s due next, full history. Tap an asset to log a service or see its record.</div>
      {assets.length === 0 ? <div className="ev-empty">No assets yet — add gear in the library first.</div> : (
        <div className="brew-list">
          {sorted.map((a) => {
            const s = statusOf(a.id); const open = openId === a.id;
            const mine = logs.filter((x) => x.asset_id === a.id);
            return (
              <div key={a.id} className={`am-card${s.overdue ? " overdue" : ""}`}>
                <button type="button" className="am-head" onClick={() => setOpenId(open ? null : a.id)} aria-expanded={open}>
                  <span className="am-head-main"><b>{a.name}</b><span>{[a.make_model || a.brand, s.last ? `last ${fmt(s.last)}` : "no log yet", s.nextDue ? `${s.overdue ? "overdue" : "due"} ${fmt(s.nextDue)}` : null].filter(Boolean).join(" · ")}</span></span>
                  {s.overdue ? <span className="am-flag">DUE</span> : s.nextDue ? <span className="am-flag soon">{fmt(s.nextDue)}</span> : null}
                  <span className={`ev-chev${open ? " open" : ""}`} aria-hidden="true">›</span>
                </button>
                {open && (
                  <div className="am-body">
                    {mine.length === 0 ? <div className="dp-hint" style={{ margin: "4px 0" }}>No maintenance logged yet.</div> : (
                      <div className="am-log">
                        {mine.map((m) => (
                          <div key={m.id} className="am-row">
                            <span className="am-row-k">{KIND_ICON[m.kind] || "•"}</span>
                            <span className="am-row-main">
                              <b>{m.summary}</b>
                              <span>{fmt(m.performed_on)}{m.performed_by ? ` · ${m.performed_by}` : ""}{m.cost_cents != null ? ` · $${(m.cost_cents / 100).toFixed(2)}` : ""}{m.next_due_on ? ` · next ${fmt(m.next_due_on)}` : ""}</span>
                              {m.how_to && (
                                <details className="am-how"><summary>How to do this</summary>
                                  <div className="am-how-steps">{m.how_to.split("\n").map((s) => s.trim()).filter(Boolean).map((s, i) => <div key={i}>{s}</div>)}</div>
                                </details>
                              )}
                            </span>
                            <button type="button" className="am-row-x" onClick={() => delLog(m.id)} aria-label="Delete record">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button type="button" className="brew-pack-btn" style={{ marginTop: 8 }} onClick={() => setLogFor(a)}>+ Log maintenance</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {logFor && <LogSheet asset={logFor} onClose={() => setLogFor(null)} onSaved={() => { setLogFor(null); load(); }} />}
    </div>
  );
}

function LogSheet({ asset, onClose, onSaved }: { asset: Asset; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState("service");
  const [summary, setSummary] = useState("");
  const [performedOn, setPerformedOn] = useState(today());
  const [nextDue, setNextDue] = useState("");
  const [cost, setCost] = useState("");
  const [who, setWho] = useState("");
  const [howTo, setHowTo] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!supabase || !summary.trim() || busy) return;
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("asset_maintenance").insert({
      asset_id: asset.id, kind, summary: summary.trim(), how_to: howTo.trim() || null, performed_on: performedOn || today(),
      next_due_on: nextDue || null, cost_cents: cost ? Math.round(parseFloat(cost) * 100) : null,
      performed_by: who.trim() || null, created_by: user?.id ?? null,
    });
    setBusy(false); onSaved();
  };
  return (
    <Sheet open onClose={onClose} header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>Log · {asset.name}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>}>
          <div className="ts-chips">
            {KINDS.map((k) => <button key={k} type="button" className={`ts-chip${kind === k ? " on" : ""}`} onClick={() => setKind(k)}>{KIND_ICON[k]} {k}</button>)}
          </div>
          <input className="note-in" style={{ marginTop: 10 }} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What was done? e.g. Replaced CO2 regulator, cleaned lines" autoFocus />
          <div className="prod-grid" style={{ marginTop: 10 }}>
            <label className="prod-f"><span>Done on</span><input type="date" value={performedOn} onChange={(e) => setPerformedOn(e.target.value)} /></label>
            <label className="prod-f"><span>Next due (optional)</span><input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} /></label>
            <label className="prod-f"><span>Cost (optional)</span><input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" /></label>
            <label className="prod-f"><span>By (optional)</span><input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Ryan / shop" /></label>
          </div>
          <label className="prod-f" style={{ marginTop: 8 }}><span>How-to / steps (optional — one per line)</span><textarea className="note-in" rows={3} value={howTo} onChange={(e) => setHowTo(e.target.value)} placeholder="Steps to do this next time" /></label>
          <div className="prod-actions" style={{ marginTop: 14 }}>
            <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
            <button type="button" className="note-save" onClick={save} disabled={busy || !summary.trim()}>{busy ? "Saving…" : "Log it"}</button>
          </div>
    </Sheet>
  );
}
