"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

// CHIEF OF SALES — scouts the web for upcoming opportunities (fitness events, festivals, markets,
// corporate, wellness expos, local newsletters) in the chosen markets, ranks the fit, and lets you
// save the good ones straight into the Bookings pipeline as leads. Lives at the top of Plan → Bookings.
/* eslint-disable @typescript-eslint/no-explicit-any */

const MARKETS = ["Greenville, SC", "Atlanta, GA"];
const SCORE: Record<string, { c: string; t: string }> = { hot: { c: "#c4453c", t: "HOT" }, warm: { c: "#e0892b", t: "WARM" }, cold: { c: "#6fa8dc", t: "COLD" } };

type Opp = { name: string; date: string; location: string; fit: string; pitch: string; source: string; score: string; _skip?: boolean };

export default function ChiefOfSales({ onLeads }: { onLeads?: () => void }) {
  const [markets, setMarkets] = useState<string[]>(MARKETS);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [opps, setOpps] = useState<Opp[] | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const toggleMarket = (m: string) => setMarkets((p) => p.includes(m) ? p.filter((x) => x !== m) : [...p, m]);
  const token = async () => (await supabase!.auth.getSession()).data.session?.access_token;
  const call = async (payload: any) => {
    const t = await token();
    const r = await fetch("/api/agents/sales", { method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(payload) });
    // parse defensively — a timeout/500 can return an HTML page, which would otherwise throw a cryptic
    // "string did not match the expected pattern" instead of a useful message
    const text = await r.text();
    try { return JSON.parse(text); }
    catch { return { ok: false, error: r.ok ? "The scout returned an unexpected response — try again." : `Scout failed (${r.status}) — the AI may be timing out or the API key needs attention.` }; }
  };

  const scout = async () => {
    if (!supabase || busy || markets.length === 0) return;
    setBusy(true); setErr(null); setDone(null);
    const j = await call({ markets, focus }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!j.ok) setErr(j.error || "Scout failed."); else { setSummary(j.summary || ""); setOpps(j.opportunities ?? []); }
    setBusy(false);
  };
  const save = async () => {
    if (!opps || busy) return;
    const keep = opps.filter((o) => !o._skip);
    if (!keep.length) return;
    setBusy(true); setErr(null);
    const j = await call({ commit: { opportunities: keep } }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!j.ok) setErr(j.error || "Couldn't save."); else { setDone(j.added ?? 0); setOpps(null); onLeads?.(); }
    setBusy(false);
  };
  const toggle = (i: number) => setOpps((p) => p!.map((o, j) => j === i ? { ...o, _skip: !o._skip } : o));
  const keepN = opps?.filter((o) => !o._skip).length ?? 0;

  return (
    <div className="cos cos-sales">
      <button type="button" className="cossales-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="cos-eyebrow">🎯 Chief of Sales</span>
        <span className="cossales-sub">scout events &amp; opportunities → leads</span>
        <span className={`ev-chev${open ? " open" : ""}`} aria-hidden="true">›</span>
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          {done !== null ? (
            <div className="eg-done">
              <div className="eg-done-h">✓ Added {done} lead{done === 1 ? "" : "s"} to Bookings</div>
              <div className="dp-hint" style={{ marginTop: 6 }}>They&apos;re in the list below — work them like any booking.</div>
              <button type="button" className="cos-redo" onClick={() => setDone(null)}>Scout again</button>
            </div>
          ) : !opps ? (
            <>
              <div className="ts-chips">
                {MARKETS.map((m) => <button key={m} type="button" className={`ts-chip${markets.includes(m) ? " on" : ""}`} onClick={() => toggleMarket(m)}>📍 {m}</button>)}
              </div>
              <input className="note-in" style={{ marginTop: 8 }} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Focus (optional) — e.g. run clubs, wellness expos, fall festivals" />
              {err && <div className="dp-err" style={{ marginTop: 8 }}>{err}</div>}
              <button type="button" className="cos-go" style={{ marginTop: 12 }} onClick={scout} disabled={busy || markets.length === 0}>{busy ? "Scouting the web…" : "🎯 Scout opportunities"}</button>
            </>
          ) : (
            <>
              {summary && <div className="dp-hint">{summary}</div>}
              {opps.length === 0 ? <div className="dp-hint">Nothing surfaced — try a broader focus.</div> : opps.map((o, i) => (
                <button key={i} type="button" className={`sales-opp${o._skip ? "" : " on"}`} onClick={() => toggle(i)}>
                  <span className="eg-ck">{o._skip ? "○" : "✓"}</span>
                  <span className="sales-opp-main">
                    <b>{o.name}{o.score ? <span className="sales-score" style={{ background: SCORE[o.score]?.c }}>{SCORE[o.score]?.t}</span> : null}</b>
                    <span>{[o.location, o.date].filter(Boolean).join(" · ")}</span>
                    {o.fit && <span className="sales-fit">{o.fit}</span>}
                    {o.pitch && <span className="sales-pitch">→ {o.pitch}</span>}
                    {o.source && <span className="sales-src">{o.source}</span>}
                  </span>
                </button>
              ))}
              {err && <div className="dp-err" style={{ marginTop: 8 }}>{err}</div>}
              <div className="prod-actions" style={{ marginTop: 12 }}>
                <button type="button" className="note-arch" onClick={() => setOpps(null)} disabled={busy}>‹ New scout</button>
                <button type="button" className="note-save" onClick={save} disabled={busy || keepN === 0}>{busy ? "Saving…" : `Save ${keepN} to Bookings`}</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
