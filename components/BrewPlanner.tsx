"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { FLAVORS } from "@/lib/orderAhead";
import { bottlesFor, brewStartOverdue } from "@/lib/brewMath";
import AssignTaskSheet from "@/components/AssignTaskSheet";
import Sheet from "@/components/Sheet";
import ProgressRing from "@/components/ProgressRing";

// BREW — recipes + a back-scheduled batch plan. Pick a recipe, set the batch size in GALLONS (the
// recipe scales exactly to it and hits its OG/Signal-Score spec), tie it to the event it's for, and
// the agent back-schedules the brew so it's ready in time. Batches land on the schedule; log the
// Signal Score when it's done — same high standard. Lives as a Plan sub-tab.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Recipe = { id: string; name: string; style: string | null; ratio: string | null; target_spec: string | null; base_water_gal: number; extraction_hours: number; yield_factor: number | null; product_slug: string | null };
type Vessel = { id: string; name: string; capacity_gal: number; filter_type: string | null };
type ScaledIng = { name: string; qty: number | string; unit?: string | null };
type Batch = { id: string; recipe_id: string | null; recipe_name: string | null; batch_gal: number; brew_date: string | null; ready_at: string | null; event_id: string | null; stop_id: string | null; status: string; og: string | null; signal_score: number | null; target_spec: string | null; extraction_hours: number | null; brew_started_at: string | null; vessel: string | null; coffee_lot: string | null; brewer: string | null; taste_notes: string | null; created_at?: string | null; needed_by: string | null; latest_start_at: string | null; drop_date: string | null; hold_hours: number | null; scaled: ScaledIng[] | null };
type InvItem = { name: string; qty: number | null; unit: string | null };
type Ev = { id: string; title: string | null; day: string | null; day_label: string | null };
type St = { id: string; name: string; starts_at: string | null };

const STATUS: { key: string; label: string }[] = [
  { key: "planned", label: "Planned" }, { key: "brewing", label: "Brewing" }, { key: "ready", label: "Ready" },
  { key: "kegged", label: "Kegged" }, { key: "served", label: "Served" }, { key: "dumped", label: "Dumped" },
];
const fmtDate = (s: string | null) => s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—";
const fmtTs = (s: string | null) => s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" }) : "—";
// display-only: target_spec sometimes carries a " · Signal Score 8+" tail — drop it on the card (DB value untouched)
const specLabel = (s: string | null) => (s ?? "").replace(/\s*·\s*Signal Score.*$/, "");

// Stock check for a planned batch — match scaled ingredients to inventory by normalized-name
// containment both directions, keyed on the first significant word ("coffee" ties
// "Coffee, coarse grind" to "Whole-bean coffee"). Returns null when there's nothing to say.
const STOCK_STOP = new Set(["the", "and", "for", "with", "fresh", "cold", "whole", "raw", "organic", "filtered"]);
const sigWord = (s: string) => (s.toLowerCase().match(/[a-z]+/g) ?? []).find((w) => w.length > 2 && !STOCK_STOP.has(w)) ?? "";
const nameMatch = (a: string, b: string) => {
  const sa = sigWord(a), sb = sigWord(b);
  return !!sa && !!sb && (a.toLowerCase().includes(sb) || b.toLowerCase().includes(sa));
};
const stockShorts = (scaled: ScaledIng[] | null, inv: InvItem[]): string[] | null => {
  const rows = Array.isArray(scaled) ? scaled.filter((i) => i?.name?.trim()) : [];
  if (!rows.length || !inv.length) return null;
  let matched = 0;
  const shorts: string[] = [];
  const u = (x?: string | null) => (x ?? "").toLowerCase().trim().replace(/s$/, "");
  rows.forEach((ing) => {
    const item = inv.find((i) => nameMatch(i.name, ing.name));
    if (!item) return;
    matched++;
    // only compare quantities when the units agree — a gal-vs-g compare would mislead
    if (u(ing.unit) !== u(item.unit) || item.qty == null || !(Number(ing.qty) > 0)) return;
    const d = Number(ing.qty) - Number(item.qty);
    if (d > 0) shorts.push(`Short ${+d.toFixed(1)}${u(ing.unit) ? ` ${u(ing.unit)}` : ""} ${sigWord(ing.name)}`);
  });
  return matched ? shorts : null;
};
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
  const [stops, setStops] = useState<St[]>([]);
  const [plan, setPlan] = useState<Recipe | null>(null);
  const [pack, setPack] = useState<Batch | null>(null);
  const [logBatch, setLogBatch] = useState<Batch | null>(null);
  const [starting, setStarting] = useState<Batch | null>(null);
  const [adjust, setAdjust] = useState<Batch | null>(null);
  const [view, setView] = useState<"schedule" | "log">("schedule");
  const [now, setNow] = useState(() => Date.now());
  const [demand, setDemand] = useState<Record<string, Record<string, number>>>({}); // drop_date → flavor → bottles reserved
  const [inv, setInv] = useState<InvItem[]>([]);

  // Live clock — ticks while a brew countdown or serve-by window is on screen, so both stay current.
  const ticking = batches.some((b) => b.status === "brewing" || b.status === "ready" || b.status === "kegged");
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [ticking]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: r }, { data: b }, { data: e }, { data: v }, { data: st }, { data: ii }] = await Promise.all([
      supabase.from("brew_recipes").select("id, name, style, ratio, target_spec, base_water_gal, extraction_hours, yield_factor, product_slug").is("archived_at", null).order("sort"),
      supabase.from("brew_batches").select("id, recipe_id, recipe_name, batch_gal, brew_date, ready_at, event_id, stop_id, status, og, signal_score, target_spec, extraction_hours, brew_started_at, vessel, coffee_lot, brewer, taste_notes, created_at, needed_by, latest_start_at, drop_date, hold_hours, scaled").order("created_at", { ascending: false }),
      supabase.from("events").select("id, title, day, day_label").is("archived_at", null).order("day"),
      supabase.from("brew_vessels").select("id, name, capacity_gal, filter_type").is("archived_at", null).order("sort"),
      supabase.from("stops").select("id, name, starts_at").is("archived_at", null).order("starts_at", { ascending: true, nullsFirst: false }),
      supabase.from("inventory_items").select("name, qty, unit"),
    ]);
    const bb = (b as Batch[]) ?? [];
    setRecipes((r as Recipe[]) ?? []); setBatches(bb); setEvents((e as Ev[]) ?? []); setVessels((v as Vessel[]) ?? []); setStops((st as St[]) ?? []);
    setInv(((ii as InvItem[]) ?? []).filter((i) => i.name?.trim()));
    // Demand for the drops these batches feed — per drop_date + flavor, same math as DropOps.
    const dates = [...new Set(bb.filter((x) => x.status !== "served" && x.status !== "dumped" && x.drop_date).map((x) => x.drop_date!))];
    const per: Record<string, Record<string, number>> = {};
    if (dates.length) {
      const { data: o } = await supabase.from("drop_orders").select("drop_date, mix, canceled_at").is("canceled_at", null).in("drop_date", dates);
      ((o as { drop_date: string; mix: Record<string, number> | null }[]) ?? []).forEach((row) => {
        const d = (per[row.drop_date] ??= { RISE: 0, FLOW: 0, DUSK: 0 });
        FLAVORS.forEach((f) => { d[f] += row.mix?.[f] || 0; });
      });
    }
    setDemand(per);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: string) => {
    if (!supabase) return;
    setBatches((p) => p.map((x) => x.id === id ? { ...x, status } : x));
    await supabase.from("brew_batches").update({ status }).eq("id", id);
    if (status === "served" || status === "dumped") load();
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
  // BREW FLEXIBILITY — the real brew rarely starts exactly when you tap Start. Fix the actual start
  // time (ready recomputes from it), stop early to bottle now, or undo a start entirely. Maximum
  // flexibility, inline — no navigating away, no re-planning.
  const saveBrewTime = async (b: Batch, startLocal: string) => {
    if (!supabase || !startLocal) return;
    const hrs = Number(b.extraction_hours) || 20;
    const startIso = new Date(startLocal).toISOString();
    const readyIso = new Date(new Date(startLocal).getTime() + hrs * 3600000).toISOString();
    setBatches((p) => p.map((x) => x.id === b.id ? { ...x, brew_started_at: startIso, ready_at: readyIso } : x));
    setNow(Date.now());
    await supabase.from("brew_batches").update({ brew_started_at: startIso, ready_at: readyIso, alerted_soon: false, alerted_ready: false }).eq("id", b.id);
  };
  const stopBrew = async (b: Batch) => {
    if (!supabase) return;
    const nowIso = new Date().toISOString();
    setBatches((p) => p.map((x) => x.id === b.id ? { ...x, status: "ready", ready_at: nowIso } : x));
    await supabase.from("brew_batches").update({ status: "ready", ready_at: nowIso, alerted_ready: true }).eq("id", b.id);
  };
  const undoStart = async (b: Batch) => {
    if (!supabase) return;
    setBatches((p) => p.map((x) => x.id === b.id ? { ...x, status: "planned", brew_started_at: null, ready_at: null } : x));
    await supabase.from("brew_batches").update({ status: "planned", brew_started_at: null, ready_at: null, alerted_soon: false, alerted_ready: false, alerted_started: false }).eq("id", b.id);
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
            const tgt = ev ? (ev.title || ev.day_label) : stops.find((s) => s.id === b.stop_id)?.name ?? null;
            const spec = specLabel(b.target_spec);
            return (
              <div key={b.id} className={`brew-card st-${b.status}`}>
                <div className="brew-card-top">
                  <b>{b.recipe_name || "Batch"} · {b.batch_gal} gal</b>
                  <select className="brew-status" value={b.status} onChange={(e) => setStatus(b.id, e.target.value)}>
                    {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div className="brew-card-meta">
                  {b.vessel ? `${b.vessel} · ` : ""}Brew {fmtDate(b.brew_date)} → ready {fmtTs(b.ready_at)}{tgt ? ` · for ${tgt}` : ""}{spec ? ` · ${spec}` : ""}
                </div>

                {(b.status === "planned" || b.status === "brewing") && (() => {
                  // Coverage — will this run cover what's reserved for its drop?
                  const rec = recipes.find((r) => r.id === b.recipe_id);
                  const makes = bottlesFor(b.batch_gal, rec?.yield_factor);
                  const flavor = rec?.product_slug?.toUpperCase(); // 'rise' → mix key 'RISE'
                  const reserved = b.drop_date && flavor ? demand[b.drop_date]?.[flavor] : undefined;
                  const short = reserved != null ? reserved - makes : 0;
                  return (
                    <div className={`brew-oprow${reserved == null ? "" : short > 0 ? " warn" : " ok"}`}>
                      Makes ~{makes} bottles{reserved == null ? "" : ` · ${reserved} reserved — ${short > 0 ? `short ${short}` : "covers it"}`}
                    </div>
                  );
                })()}
                {b.status === "planned" && !b.brew_started_at && (() => {
                  const shorts = stockShorts(b.scaled, inv);
                  if (!shorts) return null;
                  return <div className={`brew-oprow${shorts.length ? " warn" : " ok"}`}>{shorts.length ? shorts.join(" · ") : "Stock covers it"}</div>;
                })()}

                {b.status === "planned" && (
                  <>
                    {b.latest_start_at && (() => {
                      const over = brewStartOverdue(b, now);
                      return <div className={`brew-startby${over ? " over" : ""}`}>{over ? "🚨 Past the latest start to be ready in time — start now" : `⏰ Start by ${fmtTs(b.latest_start_at)} to be ready in time`}</div>;
                    })()}
                    <button type="button" className="brew-start" onClick={() => setStarting(b)}>▶ Start brew ({Number(b.extraction_hours) || 20}h)</button>
                  </>
                )}
                {b.status === "brewing" && b.ready_at && (() => {
                  const ms = new Date(b.ready_at).getTime() - now;
                  const done = ms <= 0; const soon = !done && ms <= 3600000;
                  const startMs = b.brew_started_at ? new Date(b.brew_started_at).getTime() : null;
                  const totalMs = startMs && b.ready_at ? new Date(b.ready_at).getTime() - startMs : null;
                  const pct = done ? 1 : (startMs && totalMs && totalMs > 0 ? (now - startMs) / totalMs : 0);
                  return (
                    <div className={`brew-timer${done ? " done" : soon ? " soon" : ""}`}>
                      <ProgressRing pct={pct} size={50} stroke={4.5} color={done ? "var(--ok)" : soon ? "var(--red-h)" : "var(--gold2)"}>
                        <span className="brew-ring-pct">{done ? "🍾" : `${Math.round(pct * 100)}%`}</span>
                      </ProgressRing>
                      <div className="brew-timer-txt">
                        <b>{done ? "⏰ Time to bottle" : remain(b.ready_at, now)}</b>
                        <span>{done ? `${b.recipe_name || "Brew"} · ${b.batch_gal} gal — filter, finish, bottle` : `${b.batch_gal} gal brewing · ready ${fmtTs(b.ready_at)}${soon ? " · almost there" : ""}`}</span>
                      </div>
                    </div>
                  );
                })()}
                {b.status === "brewing" && (
                  <button type="button" className="brew-adjust-link" onClick={() => setAdjust(b)}>Adjust brew time · stop early ›</button>
                )}
                {(b.status === "ready" || b.status === "kegged") && (
                  <>
                    {b.ready_at && (() => {
                      // Serve-by — the same deadline the alert ladder (0084) pushes on; show it here before the push does.
                      const serveBy = new Date(b.ready_at).getTime() + Number(b.hold_hours ?? 72) * 3600000;
                      const ms = serveBy - now;
                      const label = new Date(serveBy).toLocaleString(undefined, { weekday: "short", hour: "numeric" }).replace(",", "");
                      const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
                      return (
                        <div className={`brew-oprow${ms <= 0 ? " over" : ms < 12 * 3600000 ? " warn" : " ok"}`}>
                          {ms <= 0 ? `Serve by ${label} — past its window` : `Serve by ${label} · ${h > 0 ? `${h}h` : `${m}m`} left`}
                        </div>
                      );
                    })()}
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
            <span className="brew-recipe-main"><b>{r.name}</b><span>{[r.style, r.ratio, specLabel(r.target_spec)].filter(Boolean).join(" · ")}</span></span>
            <span className="brew-recipe-go">Plan ›</span>
          </button>
        ))}
      </div>
      </>)}

      {plan && <BrewSheet recipe={plan} events={events} stops={stops} vessels={vessels} onClose={() => setPlan(null)} onDone={() => { setPlan(null); load(); }} />}
      {pack && <BottleLoadout batch={pack} onClose={() => setPack(null)} />}
      {logBatch && <BatchLog batch={logBatch} events={events} stops={stops} onClose={() => setLogBatch(null)} onSaved={() => { setLogBatch(null); load(); }} />}
      {starting && <StartBrewSheet batch={starting} onClose={() => setStarting(null)} onStart={async (extras) => { await startBrew(starting, extras); setStarting(null); }} />}
      {adjust && <BrewAdjust batch={adjust} onClose={() => setAdjust(null)} onSaveTime={saveBrewTime} onStop={stopBrew} onUndo={undoStart} />}
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
    <Sheet open onClose={onClose} label="Start brew" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>Start brew · {batch.recipe_name}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>}>
          <div className="brew-spec">{batch.batch_gal} gal{batch.vessel ? ` · ${batch.vessel}` : ""} · {hrs}h cold extraction → ready ~{new Date(Date.now() + hrs * 3600000).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</div>
          <label className="prod-f"><span>Coffee lot — origin · roast date (for traceability)</span><input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="e.g. Colombia single-origin · roasted 6/20" autoFocus /></label>
          <label className="prod-f" style={{ marginTop: 8 }}><span>Brewer</span><input value={brewer} onChange={(e) => setBrewer(e.target.value)} placeholder="Ryan / Kayla" /></label>
          <div className="prod-actions" style={{ marginTop: 14 }}>
            <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
            <button type="button" className="note-save" onClick={async () => { setBusy(true); await onStart({ coffee_lot: lot, brewer }); }} disabled={busy}>{busy ? "Starting…" : `▶ Start the ${hrs}h brew`}</button>
          </div>
    </Sheet>
  );
}

// Brew production log — the permanent record for one batch. Edit the traceability fields (coffee lot,
// brewer), the Signal Score, taste notes, OG, and status. This is the "GT3 Brew Lab Production" sheet.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Inline brew adjuster — reachable from a brewing card. Fix the real start time, stop & bottle now,
// or undo the start. Uses the qd-sheet popout (bulletproof scroll on all devices).
function BrewAdjust({ batch, onClose, onSaveTime, onStop, onUndo }: { batch: Batch; onClose: () => void; onSaveTime: (b: Batch, startLocal: string) => Promise<void>; onStop: (b: Batch) => Promise<void>; onUndo: (b: Batch) => Promise<void> }) {
  const [start, setStart] = useState(() => toLocalInput(batch.brew_started_at || batch.brew_date));
  const [busy, setBusy] = useState(false);
  const hrs = Number(batch.extraction_hours) || 20;
  const readyPreview = start ? new Date(new Date(start).getTime() + hrs * 3600000) : null;
  const run = async (fn: () => Promise<void>) => { setBusy(true); await fn(); onClose(); };
  return (
    <Sheet open onClose={onClose} label="Adjust brew" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>Adjust brew · {batch.recipe_name}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>}>
          <label className="prod-f"><span>When it actually started brewing</span><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          {readyPreview && <div className="brew-spec">Ready ~{readyPreview.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })} · {hrs}h extraction</div>}
          <div className="prod-actions" style={{ marginTop: 12 }}>
            <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
            <button type="button" className="note-save" disabled={busy || !start} onClick={() => run(() => onSaveTime(batch, start))}>Save brew time</button>
          </div>
          <div className="brew-adjust-sep" />
          <button type="button" className="brew-adjust-danger" disabled={busy} onClick={() => run(() => onStop(batch))}>⏹ Stop &amp; bottle now</button>
          <button type="button" className="brew-adjust-undo" disabled={busy} onClick={() => run(() => onUndo(batch))}>↩ Undo start — back to planned</button>
    </Sheet>
  );
}

function BatchLog({ batch, events, stops, onClose, onSaved }: { batch: Batch; events: Ev[]; stops: St[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Batch>(batch);
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<string[]>([]); // ["e:<id>"|"s:<id>"] this batch serves
  const set = (k: keyof Batch, v: any) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    supabase?.from("brew_batch_links").select("event_id, stop_id").eq("batch_id", batch.id)
      .then(({ data }) => setTargets(((data as { event_id: string | null; stop_id: string | null }[]) ?? []).map((l) => l.stop_id ? `s:${l.stop_id}` : `e:${l.event_id}`)));
  }, [batch.id]);
  const save = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    await supabase.from("brew_batches").update({
      status: f.status, og: f.og?.trim() || null, signal_score: f.signal_score,
      coffee_lot: f.coffee_lot?.trim() || null, brewer: f.brewer?.trim() || null, taste_notes: f.taste_notes?.trim() || null,
      event_id: targets[0]?.startsWith("e:") ? targets[0].slice(2) : null,  // first selection = primary (back-schedule)
      stop_id: targets[0]?.startsWith("s:") ? targets[0].slice(2) : null,
    }).eq("id", batch.id);
    // Re-sync the links to the chosen set (clear + insert).
    await supabase.from("brew_batch_links").delete().eq("batch_id", batch.id);
    if (targets.length) await supabase.from("brew_batch_links").insert(targets.map((t) => { const [k, id] = t.split(":"); return k === "s" ? { batch_id: batch.id, stop_id: id } : { batch_id: batch.id, event_id: id }; }));
    setBusy(false); onSaved();
  };
  const del = async () => {
    if (!supabase || busy) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete this ${batch.recipe_name || "batch"} (${batch.batch_gal} gal)?\n\nThis removes it from the brew schedule and unlinks it from any events/stops. Can't be undone.`)) return;
    setBusy(true);
    await supabase.from("brew_batches").delete().eq("id", batch.id); // brew_batch_links cascade via FK
    setBusy(false); onSaved();
  };
  return (
    <Sheet open onClose={onClose} label="Batch log" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>Batch log · {batch.recipe_name}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>}>
          <div className="brew-spec">{batch.batch_gal} gal{batch.vessel ? ` · ${batch.vessel}` : ""}{batch.target_spec ? ` · ${batch.target_spec}` : ""}<br />Brewed {fmtTs(batch.brew_started_at)} → ready {fmtTs(batch.ready_at)}</div>
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
          <div className="prod-f" style={{ marginTop: 10 }}><span>Serving which events / stops? (first drives the schedule)</span>
            <div className="ts-chips" style={{ marginTop: 4 }}>
              {events.map((ev2) => { const k = `e:${ev2.id}`; const on = targets.includes(k); return <button key={ev2.id} type="button" className={`ts-chip${on ? " on" : ""}`} onClick={() => setTargets((p) => on ? p.filter((x) => x !== k) : [...p, k])}>{on ? "✓ " : ""}🎪 {ev2.title || ev2.day_label}</button>; })}
              {stops.map((s) => { const k = `s:${s.id}`; const on = targets.includes(k); return <button key={s.id} type="button" className={`ts-chip${on ? " on" : ""}`} onClick={() => setTargets((p) => on ? p.filter((x) => x !== k) : [...p, k])}>{on ? "✓ " : ""}🚚 {s.name}</button>; })}
              {events.length === 0 && stops.length === 0 && <span className="dp-hint">No events or stops yet.</span>}
            </div>
          </div>
          <div className="prod-actions" style={{ marginTop: 14, justifyContent: "space-between" }}>
            <button type="button" className="note-arch brew-del" onClick={del} disabled={busy}>Delete batch</button>
            <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
            <button type="button" className="note-save" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save log"}</button>
            </div>
          </div>
    </Sheet>
  );
}

// Fill `needGal` from the real keg fleet — smallest keg that covers the remainder, else the largest.
function allocKegs(needGal: number, inv: { cap: number; qty: number }[]): { cap: number; count: number }[] {
  if (needGal <= 0.001) return [];
  const pool = (inv.length ? inv : [{ cap: 5, qty: 999 }]).map((k) => ({ ...k }));
  const used: Record<number, number> = {};
  let need = needGal, guard = 0;
  while (need > 0.001 && guard++ < 100) {
    const avail = pool.filter((k) => k.qty > 0);
    if (!avail.length) break;
    const covers = avail.filter((k) => k.cap >= need - 0.001).sort((a, b) => a.cap - b.cap);
    const pick = covers[0] ?? avail.slice().sort((a, b) => b.cap - a.cap)[0];
    pick.qty--; used[pick.cap] = (used[pick.cap] || 0) + 1; need -= pick.cap;
  }
  return Object.entries(used).map(([cap, count]) => ({ cap: Number(cap), count }));
}
const kegLabel = (plan: { cap: number; count: number }[]) => plan.map((k) => `${k.count}× ${k.cap}gal`).join(" + ");

// Bottle loadout — how to pack THIS batch's bottles for the car, and what to pack them in.
function BottleLoadout({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const [oz, setOz] = useState(10);
  const [kegGal, setKegGal] = useState("0"); // gallons of this batch going to keg(s)
  const [vehicle, setVehicle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<any | null>(null);
  const [kegInv, setKegInv] = useState<{ cap: number; qty: number }[]>([]);
  const [assignTask, setAssignTask] = useState(false);

  useEffect(() => {
    supabase?.from("kegs").select("capacity_gal, qty").is("archived_at", null)
      .then(({ data }) => setKegInv(((data as { capacity_gal: number; qty: number }[]) ?? []).map((k) => ({ cap: Number(k.capacity_gal), qty: Number(k.qty) })).filter((k) => k.cap > 0 && k.qty > 0)));
  }, []);

  // live preview of the pack-out split (server recomputes authoritatively)
  const kg = Math.min(Math.max(0, Number(kegGal) || 0), batch.batch_gal);
  const bottleGal = Math.max(0, batch.batch_gal - kg);
  const prevBottles = Math.floor((bottleGal * 128) / oz);
  const prevKegStr = kg > 0 ? kegLabel(allocKegs(kg, kegInv)) : "";

  const planIt = async () => {
    if (!supabase || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await authedFetch("/api/agents/loadout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch_id: batch.id, bottle_oz: oz, keg_gal: kg, vehicle }) });
      const j = await r.json();
      if (!j.ok) setErr(j.error || "Couldn't plan the loadout."); else setRes(j);
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    setBusy(false);
  };

  return (
    <>
    <Sheet open onClose={onClose} label="Bottle loadout" header={<div style={{ display: "flex", alignItems: "center" }}><div className="dp-head-l"><div className="dp-eyebrow">📦 Bottle loadout · pack &amp; transport</div><div className="dp-title">{batch.recipe_name || "Batch"} · {batch.batch_gal} gal</div></div><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>}>
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
              <div className="brew-spec" style={{ marginTop: 10 }}>Pack-out: <b>{prevBottles}</b> × {oz}oz bottles · <b>{prevBottles}</b> UVDTF labels{prevKegStr ? <> · <b>{prevKegStr}</b></> : ""}</div>
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="note-save" onClick={planIt} disabled={busy}>{busy ? "Planning…" : "📦 Plan the pack"}</button>
              </div>
            </>
          ) : (
            <>
              <div className="brew-spec"><b>{res.bottles}</b> × {res.bottle_oz}oz bottles · <b>{res.uvdtf_labels}</b> UVDTF labels{res.label_order > res.uvdtf_labels ? ` (order ~${res.label_order} w/ spares)` : ""}{res.keg_plan?.length ? <> · <b>{res.keg_plan.map((k: any) => `${k.count}× ${k.capacity_gal}gal`).join(" + ")}</b> ({res.keg_gal} gal){res.keg_shortfall_gal > 0.01 ? ` · short ${res.keg_shortfall_gal.toFixed(1)}gal` : ""}</> : res.kegs ? <> · <b>{res.kegs}</b> keg{res.kegs === 1 ? "" : "s"} ({res.keg_gal} gal)</> : ""}</div>
              {res.containers?.length > 0 && (
                <><div className="brew-block-h">Pack them in</div><div className="brew-ing">{res.containers.map((c: any, i: number) => <div key={i} className="brew-ing-row"><b>{c.count}×</b><span>{c.what}{c.note ? ` — ${c.note}` : ""}</span></div>)}</div></>
              )}
              {res.ice && <div className="brew-when">❄️ {res.ice}</div>}
              {res.layout?.length > 0 && (<><div className="brew-block-h">How to pack a cooler</div><ol className="ts-steps">{res.layout.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol></>)}
              {res.vehicle && <div className="brew-when">🚗 {res.vehicle}</div>}
              {res.checklist?.length > 0 && (<><div className="brew-block-h">Before you pull off</div><ul className="brew-checks">{res.checklist.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></>)}
              <button type="button" className="brew-pack-btn" style={{ marginTop: 12 }} onClick={() => setAssignTask(true)}>📋 Assign this pack-out as a task →</button>
              <div className="prod-actions" style={{ marginTop: 12 }}>
                <button type="button" className="note-arch" onClick={() => setRes(null)}>‹ Change</button>
                <button type="button" className="note-save" onClick={onClose}>Done</button>
              </div>
            </>
          )}
    </Sheet>
      {assignTask && (
        <AssignTaskSheet
          defaultTitle={`Pack out: ${batch.recipe_name || "Batch"} · ${res?.bottles ?? prevBottles}×${res?.bottle_oz ?? oz}oz${res?.uvdtf_labels ? ` + ${res.uvdtf_labels} labels` : ""}`}
          eventId={batch.event_id}
          dueOn={batch.needed_by ? batch.needed_by.slice(0, 10) : null}
          category="ops"
          onClose={() => setAssignTask(false)}
        />
      )}
    </>
  );
}

function BrewSheet({ recipe, events, stops, vessels, onClose, onDone }: { recipe: Recipe; events: Ev[]; stops: St[]; vessels: Vessel[]; onClose: () => void; onDone: () => void }) {
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
  const [targets, setTargets] = useState<string[]>([]); // ["e:<id>"|"s:<id>"] — a batch can serve several; first is primary (back-schedule)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<any | null>(null);
  const [saved, setSaved] = useState(false);

  const call = async (payload: any) => {
    const [tt, tid] = (targets[0] || "").split(":"); // primary target drives the back-schedule date
    const owner = targets[0] ? (tt === "s" ? { stop_id: tid } : { event_id: tid }) : {};
    const r = await authedFetch("/api/agents/brew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe_id: recipe.id, batch_gal: Number(gal) || 1, ...owner, vessel: vesselLabel, ...payload }) });
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
    if (!j.ok) { setErr(j.error || "Couldn't save."); setBusy(false); return; }
    // Link the new batch to EVERY event/stop it serves (many-to-many).
    if (j.batch_id && targets.length && supabase) {
      const links = targets.map((t) => { const [k, id] = t.split(":"); return k === "s" ? { batch_id: j.batch_id, stop_id: id } : { batch_id: j.batch_id, event_id: id }; });
      await supabase.from("brew_batch_links").insert(links);
    }
    setSaved(true);
    setBusy(false);
  };

  return (
    <Sheet open onClose={onClose} label="Scale a brew" header={<div style={{ display: "flex", alignItems: "center" }}><div className="dp-head-l"><div className="dp-eyebrow">🍺 Brew · exact scale to spec</div><div className="dp-title">{recipe.name}</div></div><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button></div>}>
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
              </div>
              <div className="prod-f" style={{ marginTop: 8 }}><span>Serving which events / stops? (optional · pick any — first one drives the back-schedule)</span>
                <div className="ts-chips" style={{ marginTop: 4 }}>
                  {events.map((ev) => { const k = `e:${ev.id}`; const on = targets.includes(k); return <button key={ev.id} type="button" className={`ts-chip${on ? " on" : ""}`} onClick={() => setTargets((p) => on ? p.filter((x) => x !== k) : [...p, k])}>{on ? "✓ " : ""}🎪 {ev.title || ev.day_label}</button>; })}
                  {stops.map((s) => { const k = `s:${s.id}`; const on = targets.includes(k); return <button key={s.id} type="button" className={`ts-chip${on ? " on" : ""}`} onClick={() => setTargets((p) => on ? p.filter((x) => x !== k) : [...p, k])}>{on ? "✓ " : ""}🚚 {s.name}</button>; })}
                  {events.length === 0 && stops.length === 0 && <span className="dp-hint">No events or stops yet.</span>}
                </div>
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
    </Sheet>
  );
}
