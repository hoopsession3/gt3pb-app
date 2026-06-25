"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// BREW — recipes + a back-scheduled batch plan. Pick a recipe, set the batch size in GALLONS (the
// recipe scales exactly to it and hits its OG/Signal-Score spec), tie it to the event it's for, and
// the agent back-schedules the brew so it's ready in time. Batches land on the schedule; log the
// Signal Score when it's done — same high standard. Lives as a Plan sub-tab.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Recipe = { id: string; name: string; style: string | null; ratio: string | null; target_spec: string | null; base_water_gal: number; extraction_hours: number };
type Vessel = { id: string; name: string; capacity_gal: number; filter_type: string | null };
type Batch = { id: string; recipe_name: string | null; batch_gal: number; brew_date: string | null; ready_at: string | null; event_id: string | null; status: string; og: string | null; signal_score: number | null; target_spec: string | null; extraction_hours: number | null; brew_started_at: string | null; vessel: string | null; coffee_lot: string | null; brewer: string | null; taste_notes: string | null; created_at?: string | null; needed_by: string | null; latest_start_at: string | null };
type Ev = { id: string; title: string | null; day: string | null; day_label: string | null };

const STATUS: { key: string; label: string }[] = [
  { key: "planned", label: "Planned" }, { key: "brewing", label: "Brewing" }, { key: "ready", label: "Ready" },
  { key: "kegged", label: "Kegged" }, { key: "served", label: "Served" }, { key: "dumped", label: "Dumped" },
];
const fmtDate = (s: string | null) => s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—";
const fmtTs = (s: string | null) => s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" }) : "—";
// remaining time to a target, as "12h 04m" / "48m" / "ready"
const remain = (target: string | null, now: number) => {
  if (!target) return "";
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return "ready";
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

export default function BrewPlanner() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [plan, setPlan] = useState<Recipe | null>(null);
  const [pack, setPack] = useState<Batch | null>(null);
  const [logBatch, setLogBatch] = useState<Batch | null>(null);
  const [starting, setStarting] = useState<Batch | null>(null);
  const [view, setView] = useState<"schedule" | "log">("schedule");
  const [now, setNow] = useState(() => Date.now());

  // Live clock — only ticks while something is actively brewing, so the countdown stays current.
  const brewing = batches.some((b) => b.status === "brewing");
  useEffect(() => {
    if (!brewing) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [brewing]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: r }, { data: b }, { data: e }, { data: v }] = await Promise.all([
      supabase.from("brew_recipes").select("id, name, style, ratio, target_spec, base_water_gal, extraction_hours").is("archived_at", null).order("sort"),
      supabase.from("brew_batches").select("id, recipe_name, batch_gal, brew_date, ready_at, event_id, status, og, signal_score, target_spec, extraction_hours, brew_started_at, vessel, coffee_lot, brewer, taste_notes, created_at, needed_by, latest_start_at").order("created_at", { ascending: false }),
      supabase.from("events").select("id, title, day, day_label").is("archived_at", null).order("day"),
      supabase.from("brew_vessels").select("id, name, capacity_gal, filter_type").is("archived_at", null).order("sort"),
    ]);
    setRecipes((r as Recipe[]) ?? []); setBatches((b as Batch[]) ?? []); setEvents((e as Ev[]) ?? []); setVessels((v as Vessel[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: string) => {
    if (!supabase) return;
    setBatches((p) => p.map((x) => x.id === id ? { ...x, status } : x));
    await supabase.from("brew_batches").update({ status }).eq("id", id);
    if (status === "served" || status === "dumped") load();
  };
  const logScore = async (id: string, score: number) => {
    if (!supabase) return;
    setBatches((p) => p.map((x) => x.id === id ? { ...x, signal_score: score } : x));
    await supabase.from("brew_batches").update({ signal_score: score }).eq("id", id);
  };
  // Start the brew NOW — stamp the start, set ready_at = now + extraction_hours, capture the coffee
  // lot + brewer for traceability, reset alert flags.
  const startBrew = async (b: Batch, extras?: { coffee_lot?: string; brewer?: string }) => {
    if (!supabase) return;
    const hrs = Number(b.extraction_hours) || 20;
    const startIso = new Date().toISOString();
    const readyIso = new Date(Date.now() + hrs * 3600000).toISOString();
    const lot = extras?.coffee_lot?.trim() || b.coffee_lot || null;
    const brewer = extras?.brewer?.trim() || b.brewer || null;
    setBatches((p) => p.map((x) => x.id === b.id ? { ...x, status: "brewing", brew_started_at: startIso, ready_at: readyIso, coffee_lot: lot, brewer } : x));
    setNow(Date.now());
    await supabase.from("brew_batches").update({ status: "brewing", brew_started_at: startIso, ready_at: readyIso, coffee_lot: lot, brewer, alerted_soon: false, alerted_ready: false, alerted_started: false, alerted_overextract: false, alerted_hold_soon: false, alerted_hold_expired: false }).eq("id", b.id);
  };

  // schedule view = what's upcoming / in progress; the log view = every batch ever, the permanent record
  const active = batches.filter((b) => b.status !== "served" && b.status !== "dumped")
    .sort((a, b) => (a.ready_at || "9999").localeCompare(b.ready_at || "9999"));

  return (
    <div className="adm-sec">
      <div className="sec">Brew <button className="adm-btn primary" style={{ marginLeft: "auto" }} onClick={() => setPlan(recipes[0] ?? null)} disabled={!recipes.length}>+ Plan a batch</button></div>
      <div className="pnl-note" style={{ marginBottom: 8 }}>Recipes scale exactly to the gallons of water you brew and hold the spec. Batches are back-scheduled from the event they&apos;re for, then logged to standard.</div>

      <div className="brew-toggle">
        {(["schedule", "log"] as const).map((k) => (
          <button key={k} type="button" className={`brew-toggle-b${view === k ? " on" : ""}`} onClick={() => setView(k)}>{k === "schedule" ? "Schedule" : "Production log"}</button>
        ))}
      </div>

      {view === "log" ? (
        batches.length === 0 ? <div className="ev-empty">No batches logged yet — plan and brew one.</div> : (
          <div className="brew-list">
            {batches.map((b) => (
              <button key={b.id} type="button" className={`brew-logrow st-${b.status}`} onClick={() => setLogBatch(b)}>
                <span className="brew-recipe-main">
                  <b>{b.recipe_name || "Batch"} · {b.batch_gal} gal{b.signal_score != null ? ` · Signal ${b.signal_score}/10` : ""}</b>
                  <span>{fmtTs(b.brew_started_at || b.ready_at)}{b.vessel ? ` · ${b.vessel}` : ""}{b.coffee_lot ? ` · lot ${b.coffee_lot}` : ""} · {b.status}</span>
                </span>
                <span className="brew-recipe-go">Log ›</span>
              </button>
            ))}
          </div>
        )
      ) : (<>
      <div className="brew-sched-h">Brew schedule</div>
      {active.length === 0 ? <div className="ev-empty">No batches scheduled. Tap <b>+ Plan a batch</b>.</div> : (
        <div className="brew-list">
          {active.map((b) => {
            const ev = events.find((e) => e.id === b.event_id);
            return (
              <div key={b.id} className={`brew-card st-${b.status}`}>
                <div className="brew-card-top">
                  <b>{b.recipe_name || "Batch"} · {b.batch_gal} gal</b>
                  <select className="brew-status" value={b.status} onChange={(e) => setStatus(b.id, e.target.value)}>
                    {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div className="brew-card-meta">
                  {b.vessel ? `${b.vessel} · ` : ""}Brew {fmtDate(b.brew_date)} → ready {fmtTs(b.ready_at)}{ev ? ` · for ${ev.title || ev.day_label}` : ""}{b.target_spec ? ` · ${b.target_spec}` : ""}
                </div>

                {b.status === "planned" && (
                  <>
                    {b.latest_start_at && (() => {
                      const over = new Date(b.latest_start_at!).getTime() < now;
                      return <div className={`brew-startby${over ? " over" : ""}`}>{over ? "🚨 Past the latest start to be ready in time — start now" : `⏰ Start by ${fmtTs(b.latest_start_at)} to be ready in time`}</div>;
                    })()}
                    <button type="button" className="brew-start" onClick={() => setStarting(b)}>▶ Start brew ({Number(b.extraction_hours) || 20}h)</button>
                  </>
                )}
                {b.status === "brewing" && b.ready_at && (() => {
                  const ms = new Date(b.ready_at).getTime() - now;
                  const done = ms <= 0; const soon = !done && ms <= 3600000;
                  return (
                    <div className={`brew-timer${done ? " done" : soon ? " soon" : ""}`}>
                      <span className="brew-timer-dot" />
                      <b>{done ? "⏰ Time to bottle" : remain(b.ready_at, now)}</b>
                      <span>{done ? `${b.recipe_name || "Brew"} · ${b.batch_gal} gal — filter, finish, bottle` : `${b.batch_gal} gal brewing · ready ${fmtTs(b.ready_at)}${soon ? " · almost there" : ""}`}</span>
                    </div>
                  );
                })()}
                {(b.status === "ready" || b.status === "kegged") && (
                  <>
                    <div className="brew-score">Signal Score
                      {[6, 7, 8, 9, 10].map((n) => (
                        <button key={n} type="button" className={`brew-score-b${b.signal_score === n ? " on" : ""}`} onClick={() => logScore(b.id, n)}>{n}</button>
                      ))}
                    </div>
                    <button type="button" className="brew-pack-btn" onClick={() => setPack(b)}>📦 Plan the bottle loadout</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Recipes */}
      <div className="brew-sched-h" style={{ marginTop: 18 }}>Recipes</div>
      <div className="brew-list">
        {recipes.map((r) => (
          <button key={r.id} type="button" className="brew-recipe" onClick={() => setPlan(r)}>
            <span className="brew-recipe-main"><b>{r.name}</b><span>{[r.style, r.ratio, r.target_spec].filter(Boolean).join(" · ")}</span></span>
            <span className="brew-recipe-go">Plan ›</span>
          </button>
        ))}
      </div>
      </>)}

      {plan && <BrewSheet recipe={plan} events={events} vessels={vessels} onClose={() => setPlan(null)} onDone={() => { setPlan(null); load(); }} />}
      {pack && <BottleLoadout batch={pack} onClose={() => setPack(null)} />}
      {logBatch && <BatchLog batch={logBatch} events={events} onClose={() => setLogBatch(null)} onSaved={() => { setLogBatch(null); load(); }} />}
      {starting && <StartBrewSheet batch={starting} onClose={() => setStarting(null)} onStart={async (extras) => { await startBrew(starting, extras); setStarting(null); }} />}
    </div>
  );
}

// Start-brew sheet — captures the coffee lot + brewer at the moment of brewing (traceability), then
// kicks off the countdown. Lot is the field a recall would hinge on, so prompt for it up front.
function StartBrewSheet({ batch, onClose, onStart }: { batch: Batch; onClose: () => void; onStart: (extras: { coffee_lot: string; brewer: string }) => void | Promise<void> }) {
  const [lot, setLot] = useState(batch.coffee_lot ?? "");
  const [brewer, setBrewer] = useState(batch.brewer ?? "");
  const [busy, setBusy] = useState(false);
  const hrs = Number(batch.extraction_hours) || 20;
  return (
    <div className="qd-scrim" onClick={onClose}>
      <div className="qd-sheet dp-form" onClick={(e) => e.stopPropagation()}>
        <div className="qd-tabs"><b style={{ fontFamily: "Inter", fontSize: 15 }}>Start brew · {batch.recipe_name}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>
        <div className="qd-body">
          <div className="brew-spec">{batch.batch_gal} gal{batch.vessel ? ` · ${batch.vessel}` : ""} · {hrs}h cold extraction → ready ~{new Date(Date.now() + hrs * 3600000).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</div>
          <label className="prod-f"><span>Coffee lot — origin · roast date (for traceability)</span><input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="e.g. Colombia single-origin · roasted 6/20" autoFocus /></label>
          <label className="prod-f" style={{ marginTop: 8 }}><span>Brewer</span><input value={brewer} onChange={(e) => setBrewer(e.target.value)} placeholder="Ryan / Kayla" /></label>
          <div className="prod-actions" style={{ marginTop: 14 }}>
            <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
            <button type="button" className="note-save" onClick={async () => { setBusy(true); await onStart({ coffee_lot: lot, brewer }); }} disabled={busy}>{busy ? "Starting…" : `▶ Start the ${hrs}h brew`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Brew production log — the permanent record for one batch. Edit the traceability fields (coffee lot,
// brewer), the Signal Score, taste notes, OG, and status. This is the "GT3 Brew Lab Production" sheet.
function BatchLog({ batch, events, onClose, onSaved }: { batch: Batch; events: Ev[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Batch>(batch);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Batch, v: any) => setF((p) => ({ ...p, [k]: v }));
  const ev = events.find((e) => e.id === batch.event_id);
  const save = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    await supabase.from("brew_batches").update({
      status: f.status, og: f.og?.trim() || null, signal_score: f.signal_score,
      coffee_lot: f.coffee_lot?.trim() || null, brewer: f.brewer?.trim() || null, taste_notes: f.taste_notes?.trim() || null,
    }).eq("id", batch.id);
    setBusy(false); onSaved();
  };
  return (
    <div className="qd-scrim" onClick={onClose}>
      <div className="qd-sheet dp-form" onClick={(e) => e.stopPropagation()}>
        <div className="qd-tabs"><b style={{ fontFamily: "Inter", fontSize: 15 }}>Batch log · {batch.recipe_name}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>
        <div className="qd-body">
          <div className="brew-spec">{batch.batch_gal} gal{batch.vessel ? ` · ${batch.vessel}` : ""}{batch.target_spec ? ` · ${batch.target_spec}` : ""}<br />Brewed {fmtTs(batch.brew_started_at)} → ready {fmtTs(batch.ready_at)}{ev ? ` · for ${ev.title || ev.day_label}` : ""}</div>
          <div className="prod-grid">
            <label className="prod-f"><span>Status</span>
              <select value={f.status} onChange={(e) => set("status", e.target.value)}>{STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            </label>
            <label className="prod-f"><span>OG / spec</span><input value={f.og ?? ""} onChange={(e) => set("og", e.target.value)} placeholder="e.g. on spec" /></label>
            <label className="prod-f"><span>Coffee lot (origin · roast date)</span><input value={f.coffee_lot ?? ""} onChange={(e) => set("coffee_lot", e.target.value)} placeholder="e.g. Colombia · roasted 6/20" /></label>
            <label className="prod-f"><span>Brewer</span><input value={f.brewer ?? ""} onChange={(e) => set("brewer", e.target.value)} placeholder="Ryan / Kayla" /></label>
          </div>
          <div className="brew-score" style={{ marginTop: 10 }}>Signal Score
            {[6, 7, 8, 9, 10].map((n) => <button key={n} type="button" className={`brew-score-b${f.signal_score === n ? " on" : ""}`} onClick={() => set("signal_score", n)}>{n}</button>)}
          </div>
          <label className="prod-f" style={{ marginTop: 10 }}><span>Taste / cupping notes</span><textarea className="note-in" rows={3} value={f.taste_notes ?? ""} onChange={(e) => set("taste_notes", e.target.value)} placeholder="Aroma, body, balance, anything off…" /></label>
          <div className="prod-actions" style={{ marginTop: 14 }}>
            <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
            <button type="button" className="note-save" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save log"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Bottle loadout — how to pack THIS batch's bottles for the car, and what to pack them in.
function BottleLoadout({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const [oz, setOz] = useState(10);
  const [kegGal, setKegGal] = useState("0"); // gallons of this batch going to keg(s)
  const [vehicle, setVehicle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<any | null>(null);

  // live preview of the pack-out split (server recomputes authoritatively)
  const kg = Math.min(Math.max(0, Number(kegGal) || 0), batch.batch_gal);
  const bottleGal = Math.max(0, batch.batch_gal - kg);
  const prevBottles = Math.floor((bottleGal * 128) / oz);
  const prevKegs = kg > 0 ? Math.ceil(kg / 5) : 0;

  const planIt = async () => {
    if (!supabase || busy) return;
    setBusy(true); setErr(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/agents/loadout", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ batch_id: batch.id, bottle_oz: oz, keg_gal: kg, vehicle }) });
      const j = await r.json();
      if (!j.ok) setErr(j.error || "Couldn't plan the loadout."); else setRes(j);
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    setBusy(false);
  };

  return (
    <div className="qd-scrim" onClick={onClose}>
      <div className="qd-sheet dp" onClick={(e) => e.stopPropagation()}>
        <div className="dp-head">
          <div className="dp-head-l"><div className="dp-eyebrow">📦 Bottle loadout · pack &amp; transport</div><div className="dp-title">{batch.recipe_name || "Batch"} · {batch.batch_gal} gal</div></div>
          <button type="button" className="qd-x" onClick={onClose}>✕</button>
        </div>
        <div className="dp-body">
          {!res ? (
            <>
              <div className="dp-hint">Split the {batch.batch_gal} gal between keg and bottles — I&apos;ll work out the counts, UVDTF labels, and the pack plan.</div>
              <div className="ts-chips" style={{ marginTop: 12 }}>
                {[10, 16].map((n) => <button key={n} type="button" className={`ts-chip${oz === n ? " on" : ""}`} onClick={() => setOz(n)}>🍶 {n} oz bottles</button>)}
              </div>
              <div className="prod-grid" style={{ marginTop: 8 }}>
                <label className="prod-f"><span>To keg (gal)</span><input type="number" min="0" step="0.5" max={String(batch.batch_gal)} value={kegGal} onChange={(e) => setKegGal(e.target.value)} /></label>
                <label className="prod-f"><span>Vehicle (optional)</span><input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="SUV, 3-hr drive" /></label>
              </div>
              <div className="brew-spec" style={{ marginTop: 10 }}>Pack-out: <b>{prevBottles}</b> × {oz}oz bottles · <b>{prevBottles}</b> UVDTF labels{prevKegs ? <> · <b>{prevKegs}</b> keg{prevKegs === 1 ? "" : "s"}</> : ""}</div>
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="note-save" onClick={planIt} disabled={busy}>{busy ? "Planning…" : "📦 Plan the pack"}</button>
              </div>
            </>
          ) : (
            <>
              <div className="brew-spec"><b>{res.bottles}</b> × {res.bottle_oz}oz bottles · <b>{res.uvdtf_labels}</b> UVDTF labels{res.label_order > res.uvdtf_labels ? ` (order ~${res.label_order} w/ spares)` : ""}{res.kegs ? <> · <b>{res.kegs}</b> keg{res.kegs === 1 ? "" : "s"} ({res.keg_gal} gal)</> : ""}</div>
              {res.containers?.length > 0 && (
                <><div className="brew-block-h">Pack them in</div><div className="brew-ing">{res.containers.map((c: any, i: number) => <div key={i} className="brew-ing-row"><b>{c.count}×</b><span>{c.what}{c.note ? ` — ${c.note}` : ""}</span></div>)}</div></>
              )}
              {res.ice && <div className="brew-when">❄️ {res.ice}</div>}
              {res.layout?.length > 0 && (<><div className="brew-block-h">How to pack a cooler</div><ol className="ts-steps">{res.layout.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol></>)}
              {res.vehicle && <div className="brew-when">🚗 {res.vehicle}</div>}
              {res.checklist?.length > 0 && (<><div className="brew-block-h">Before you pull off</div><ul className="brew-checks">{res.checklist.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></>)}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={() => setRes(null)}>‹ Change</button>
                <button type="button" className="note-save" onClick={onClose}>Done</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BrewSheet({ recipe, events, vessels, onClose, onDone }: { recipe: Recipe; events: Ev[]; vessels: Vessel[]; onClose: () => void; onDone: () => void }) {
  const [vesselId, setVesselId] = useState(vessels[0]?.id ?? "");
  const [vesselCount, setVesselCount] = useState(1);
  const vessel = vessels.find((v) => v.id === vesselId) || null;
  // batch size follows the chosen vessel(s); still editable as an override
  const [gal, setGal] = useState(() => vessels[0] ? String(vessels[0].capacity_gal) : "4");
  const [override, setOverride] = useState(false);
  const pickVessel = (id: string, count = vesselCount) => {
    setVesselId(id); setVesselCount(count); setOverride(false);
    const v = vessels.find((x) => x.id === id);
    if (v) setGal(String(+(v.capacity_gal * count).toFixed(2)));
  };
  const vesselLabel = vessel ? `${vesselCount > 1 ? `${vesselCount}× ` : ""}${vessel.name} (${vessel.capacity_gal} gal${vesselCount > 1 ? ` ea` : ""})` : undefined;
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<any | null>(null);
  const [saved, setSaved] = useState(false);

  const token = async () => (await supabase!.auth.getSession()).data.session?.access_token;
  const call = async (payload: any) => {
    const t = await token();
    const r = await fetch("/api/agents/brew", { method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ recipe_id: recipe.id, batch_gal: Number(gal) || 1, event_id: eventId || undefined, vessel: vesselLabel, ...payload }) });
    return r.json();
  };
  const planIt = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    const j = await call({}).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!j.ok) setErr(j.error || "Couldn't plan the batch."); else setRes(j);
    setBusy(false);
  };
  const save = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    const j = await call({ commit: { og: res?.spec } }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!j.ok) setErr(j.error || "Couldn't save."); else { setSaved(true); }
    setBusy(false);
  };

  return (
    <div className="qd-scrim" onClick={onClose}>
      <div className="qd-sheet dp" onClick={(e) => e.stopPropagation()}>
        <div className="dp-head">
          <div className="dp-head-l"><div className="dp-eyebrow">🍺 Brew · exact scale to spec</div><div className="dp-title">{recipe.name}</div></div>
          <button type="button" className="qd-x" onClick={onClose}>✕</button>
        </div>
        <div className="dp-body">
          {saved ? (
            <div className="eg-done">
              <div className="eg-done-h">✓ Batch added to the brew schedule</div>
              <div className="dp-hint" style={{ marginTop: 8 }}>Find it under Brew — advance its status as you go and log the Signal Score when it&apos;s ready.</div>
              <div className="prod-actions" style={{ marginTop: 12 }}><span /><button type="button" className="note-save" onClick={onDone}>Done</button></div>
            </div>
          ) : !res ? (
            <>
              <div className="dp-hint">Which vessel are you brewing in? The batch sizes to it and the recipe scales exactly to hold {recipe.target_spec || "the spec"}. Tie it to an event and it back-schedules so it&apos;s ready in time.</div>
              {vessels.length > 0 && (
                <>
                  <div className="ts-chips" style={{ marginTop: 12 }}>
                    {vessels.map((v) => (
                      <button key={v.id} type="button" className={`ts-chip${vesselId === v.id && !override ? " on" : ""}`} onClick={() => pickVessel(v.id)}>🫙 {v.name} · {v.capacity_gal} gal</button>
                    ))}
                  </div>
                  <div className="dp-daysctl" style={{ padding: "8px 0 0" }}>
                    <span>How many</span>
                    <button type="button" className="dp-step" onClick={() => pickVessel(vesselId, Math.max(1, vesselCount - 1))} aria-label="Fewer">−</button>
                    <b>{vesselCount}</b><span>{vessel ? vessel.name : "vessel"}{vesselCount === 1 ? "" : "s"}</span>
                    <button type="button" className="dp-step" onClick={() => pickVessel(vesselId, vesselCount + 1)} aria-label="More">+</button>
                  </div>
                </>
              )}
              <div className="prod-grid" style={{ marginTop: 12 }}>
                <label className="prod-f"><span>Batch size (gal of water){vessel && !override ? ` · ${vesselLabel}` : ""}</span><input type="number" min="0.25" step="0.25" value={gal} onChange={(e) => { setGal(e.target.value); setOverride(true); }} /></label>
                <label className="prod-f"><span>For event (optional)</span>
                  <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
                    <option value="">Not tied to an event</option>
                    {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title || ev.day_label}{ev.day ? ` · ${ev.day}` : ""}</option>)}
                  </select>
                </label>
              </div>
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="note-save" onClick={planIt} disabled={busy || !(Number(gal) > 0)}>{busy ? "Scaling…" : "🍺 Scale + schedule"}</button>
              </div>
            </>
          ) : (
            <>
              <div className="brew-spec">{res.spec || recipe.target_spec} · <b>{res.batch_gal} gal</b> → ~{res.servings} servings ({res.serve_oz}oz)</div>
              {res.brew_note && <div className="dp-hint" style={{ marginTop: 0 }}>⏱ {res.brew_note}</div>}

              <div className="brew-block-h">Exact recipe — scaled ×{res.factor}</div>
              <div className="brew-ing">
                {(res.scaled ?? []).map((i: any, n: number) => (
                  <div key={n} className="brew-ing-row"><b>{i.qty}{i.unit ? ` ${i.unit}` : ""}</b><span>{i.name}{i.scales === false ? " (fixed)" : ""}</span></div>
                ))}
              </div>

              {res.brew_date && <div className="brew-when">Start brewing <b>{fmtDate(res.brew_date)}</b> · ready <b>{fmtTs(res.ready_at)}</b></div>}

              {Array.isArray(res.steps) && res.steps.length > 0 && (
                <><div className="brew-block-h">Method</div><ol className="ts-steps">{res.steps.map((s: string, n: number) => <li key={n}>{s}</li>)}</ol></>
              )}
              {Array.isArray(res.checks) && res.checks.length > 0 && (
                <><div className="brew-block-h">Quality checks</div><ul className="brew-checks">{res.checks.map((s: string, n: number) => <li key={n}>{s}</li>)}</ul></>
              )}
              {Array.isArray(res.inventory_flags) && res.inventory_flags.length > 0 && (
                <div className="brew-flags"><b>Stock to check:</b> {res.inventory_flags.join(" · ")}</div>
              )}

              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={() => setRes(null)} disabled={busy}>‹ Change</button>
                <button type="button" className="note-save" onClick={save} disabled={busy}>{busy ? "Saving…" : "Add to schedule"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
