"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// BREW — recipes + a back-scheduled batch plan. Pick a recipe, set the batch size in GALLONS (the
// recipe scales exactly to it and hits its OG/Signal-Score spec), tie it to the event it's for, and
// the agent back-schedules the brew so it's ready in time. Batches land on the schedule; log the
// Signal Score when it's done — same high standard. Lives as a Plan sub-tab.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Recipe = { id: string; name: string; style: string | null; ratio: string | null; target_spec: string | null; base_water_gal: number; extraction_hours: number };
type Batch = { id: string; recipe_name: string | null; batch_gal: number; brew_date: string | null; ready_at: string | null; event_id: string | null; status: string; og: string | null; signal_score: number | null; target_spec: string | null; extraction_hours: number | null; brew_started_at: string | null };
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
  const [batches, setBatches] = useState<Batch[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [plan, setPlan] = useState<Recipe | null>(null);
  const [pack, setPack] = useState<Batch | null>(null);
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
    const [{ data: r }, { data: b }, { data: e }] = await Promise.all([
      supabase.from("brew_recipes").select("id, name, style, ratio, target_spec, base_water_gal, extraction_hours").is("archived_at", null).order("sort"),
      supabase.from("brew_batches").select("id, recipe_name, batch_gal, brew_date, ready_at, event_id, status, og, signal_score, target_spec, extraction_hours, brew_started_at").not("status", "in", "(served,dumped)").order("ready_at", { nullsFirst: false }),
      supabase.from("events").select("id, title, day, day_label").is("archived_at", null).order("day"),
    ]);
    setRecipes((r as Recipe[]) ?? []); setBatches((b as Batch[]) ?? []); setEvents((e as Ev[]) ?? []);
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
  // Start the brew NOW — stamp the start, set ready_at = now + extraction_hours, reset alert flags.
  const startBrew = async (b: Batch) => {
    if (!supabase) return;
    const hrs = Number(b.extraction_hours) || 20;
    const startIso = new Date().toISOString();
    const readyIso = new Date(Date.now() + hrs * 3600000).toISOString();
    setBatches((p) => p.map((x) => x.id === b.id ? { ...x, status: "brewing", brew_started_at: startIso, ready_at: readyIso } : x));
    setNow(Date.now());
    await supabase.from("brew_batches").update({ status: "brewing", brew_started_at: startIso, ready_at: readyIso, alerted_soon: false, alerted_ready: false }).eq("id", b.id);
  };

  return (
    <div className="adm-sec">
      <div className="sec">Brew <button className="adm-btn primary" style={{ marginLeft: "auto" }} onClick={() => setPlan(recipes[0] ?? null)} disabled={!recipes.length}>+ Plan a batch</button></div>
      <div className="pnl-note" style={{ marginBottom: 8 }}>Recipes scale exactly to the gallons of water you brew and hold the spec. Batches are back-scheduled from the event they&apos;re for, then logged to standard.</div>

      {/* Upcoming schedule */}
      <div className="brew-sched-h">Brew schedule</div>
      {batches.length === 0 ? <div className="ev-empty">No batches scheduled. Tap <b>+ Plan a batch</b>.</div> : (
        <div className="brew-list">
          {batches.map((b) => {
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
                  Brew {fmtDate(b.brew_date)} → ready {fmtTs(b.ready_at)}{ev ? ` · for ${ev.title || ev.day_label}` : ""}{b.target_spec ? ` · ${b.target_spec}` : ""}
                </div>

                {b.status === "planned" && (
                  <button type="button" className="brew-start" onClick={() => startBrew(b)}>▶ Start brew ({Number(b.extraction_hours) || 20}h)</button>
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

      {plan && <BrewSheet recipe={plan} events={events} onClose={() => setPlan(null)} onDone={() => { setPlan(null); load(); }} />}
      {pack && <BottleLoadout batch={pack} onClose={() => setPack(null)} />}
    </div>
  );
}

// Bottle loadout — how to pack THIS batch's bottles for the car, and what to pack them in.
function BottleLoadout({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const [oz, setOz] = useState(10);
  const [vehicle, setVehicle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<any | null>(null);

  const planIt = async () => {
    if (!supabase || busy) return;
    setBusy(true); setErr(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/agents/loadout", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ batch_id: batch.id, bottle_oz: oz, vehicle }) });
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
              <div className="dp-hint">How to pack the bottles for the car and what to pack them in — cold and unbroken. Pick the bottle size; I&apos;ll work out counts and the pack plan.</div>
              <div className="ts-chips" style={{ marginTop: 12 }}>
                {[10, 16].map((n) => <button key={n} type="button" className={`ts-chip${oz === n ? " on" : ""}`} onClick={() => setOz(n)}>🍶 {n} oz bottles</button>)}
              </div>
              <label className="prod-f" style={{ marginTop: 8 }}><span>Vehicle / constraints (optional)</span><input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. SUV, 2 coolers fit, 3-hr drive" /></label>
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="note-save" onClick={planIt} disabled={busy}>{busy ? "Planning…" : "📦 Plan the pack"}</button>
              </div>
            </>
          ) : (
            <>
              <div className="brew-spec"><b>{res.bottles}</b> × {res.bottle_oz}oz bottles · {res.summary}</div>
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

function BrewSheet({ recipe, events, onClose, onDone }: { recipe: Recipe; events: Ev[]; onClose: () => void; onDone: () => void }) {
  const [gal, setGal] = useState("4"); // the user's example batch size
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<any | null>(null);
  const [saved, setSaved] = useState(false);

  const token = async () => (await supabase!.auth.getSession()).data.session?.access_token;
  const call = async (payload: any) => {
    const t = await token();
    const r = await fetch("/api/agents/brew", { method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ recipe_id: recipe.id, batch_gal: Number(gal) || 1, event_id: eventId || undefined, ...payload }) });
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
              <div className="dp-hint">Set the batch size in gallons of water — the recipe scales exactly and holds {recipe.target_spec || "the spec"}. Tie it to an event and it back-schedules the brew so it&apos;s ready in time.</div>
              <div className="prod-grid" style={{ marginTop: 12 }}>
                <label className="prod-f"><span>Batch size (gal of water)</span><input type="number" min="0.25" step="0.25" value={gal} onChange={(e) => setGal(e.target.value)} autoFocus /></label>
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
