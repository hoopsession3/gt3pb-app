"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { useRealtimeTable } from "@/lib/realtime";
import { useAuth, roleOf } from "@/components/AuthProvider";
import { useApp } from "@/components/AppProvider";
import { computeLoadout, towChecks, towChecklist, computeSpace, rigToBox, type TrailerProfile, type Loadout, type SpaceRig, type SpacePlan, type AssetDim } from "@/lib/loadout";
import { localToday } from "@/lib/dates";

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();
const ZONE_LABEL: Record<string, string> = { nose: "Nose (front)", axle: "Over axle", tail: "Tail (rear)" };

// Load-Out & Tow Plan — reads the trailer profile (0037) + the live event's pack
// items, then shows weight distribution, tow-rating checks, and a tow/tire checklist.
// `lockTo` embeds the load-out inside an event/stop's prep hub, scoped to that owner (no picker).
export default function TrailerLoadout({ lockTo }: { lockTo?: { kind: "event" | "stop"; id: string } } = {}) {
  const { profile } = useAuth();
  const { toast } = useApp();
  const isOwner = roleOf(profile) === "owner";
  const [tp, setTp] = useState<TrailerProfile | null>(null);
  const [assets, setAssets] = useState<AssetDim[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [rig, setRig] = useState<SpaceRig>("trailer");
  const [targets, setTargets] = useState<{ key: string; label: string }[]>([]); // "e:<id>" event | "s:<id>" stop
  const [sel, setSel] = useState<string | null>(null);
  const [plan, setPlan] = useState<any | null>(null);
  const [planning, setPlanning] = useState(false);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Partial<TrailerProfile>>({});
  const [veh, setVeh] = useState<{ q: string; pax: number; busy: boolean; spec: any | null }>({ q: "", pax: 2, busy: false, spec: null });

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data: t } = await supabase.from("trailer_profile").select("*").eq("id", 1).maybeSingle();
    setTp((t as TrailerProfile) ?? null);
    supabase.from("assets").select("name, len_in, width_in, height_in").not("len_in", "is", null).then(({ data }) => setAssets((data as AssetDim[]) ?? []));
    // Embedded in a hub → scope to that one owner, no picker.
    if (lockTo) { setTargets([]); setSel(`${lockTo.kind === "stop" ? "s" : "e"}:${lockTo.id}`); return; }
    // Real events + truck stops (not archived test data); follow the live event, else the next
    // upcoming across both, else the first thing on the books — the loadout works for either owner.
    const today = localToday(); // crew-facing "upcoming" — the operator's wall-clock day
    const [{ data: evs }, { data: sts }] = await Promise.all([
      supabase.from("events").select("id,title,is_live,day,sort").is("archived_at", null).order("day", { ascending: true, nullsFirst: false }).order("sort"),
      supabase.from("stops").select("id,name,starts_at,sort").is("archived_at", null).order("starts_at", { ascending: true, nullsFirst: false }).order("sort"),
    ]);
    const events = (evs as { id: string; title: string; is_live?: boolean; day?: string | null }[]) ?? [];
    const stops = (sts as { id: string; name: string; starts_at?: string | null }[]) ?? [];
    setTargets([
      ...events.map((e) => ({ key: `e:${e.id}`, label: `🎪 ${e.title}` })),
      ...stops.map((s) => ({ key: `s:${s.id}`, label: `🚚 ${s.name}` })),
    ]);
    setSel((cur) => {
      if (cur && (events.some((e) => `e:${e.id}` === cur) || stops.some((s) => `s:${s.id}` === cur))) return cur; // keep pick
      const live = events.find((e) => e.is_live);
      const up = events.find((e) => e.day && e.day >= today);
      return live ? `e:${live.id}` : up ? `e:${up.id}` : events[0] ? `e:${events[0].id}` : stops[0] ? `s:${stops[0].id}` : null;
    });
  }, [lockTo?.kind, lockTo?.id]);

  // Pack labels + rig for the SELECTED event/stop drive the loadout weight + space.
  useEffect(() => {
    if (!supabase || !sel) { setLabels([]); return; }
    setPlan(null);
    const [t, id] = sel.split(":");
    const col = t === "s" ? "stop_id" : "event_id";
    supabase.from("event_tasks").select("label,kind").eq(col, id).then(({ data }) => {
      setLabels(((data as { label: string; kind: string }[]) ?? []).filter((x) => x.kind === "pack").map((x) => x.label));
    });
    supabase.from(t === "s" ? "stops" : "events").select("rig").eq("id", id).maybeSingle().then(({ data }) => {
      setRig(rigToBox((data as { rig: string | null } | null)?.rig));
    });
  }, [sel]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["trailer_profile", "event_tasks", "stops"], load);

  if (!tp) return null;

  const lo: Loadout = computeLoadout(labels, tp);
  const checks = towChecks(lo, tp);
  const zoneLb = (z: string) => lo.items.filter((i) => i.zone === z).reduce((s, i) => s + i.lb, 0);
  const space: SpacePlan = computeSpace(labels, tp, rig, assets);

  const runPlan = async () => {
    if (!supabase || !sel || planning) return;
    setPlanning(true);
    try {
      const [t, id] = sel.split(":");
      const r = await authedFetch("/api/agents/spaceplan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(t === "s" ? { stop_id: id } : { event_id: id }),
      });
      const j = await r.json();
      if (!j.ok) { toast(j.error || "Couldn't plan the space", "error"); return; }
      setPlan(j);
    } catch (e: any) {
      toast(String(e?.message ?? e).slice(0, 160), "error");
    } finally { setPlanning(false); }
  };

  const saveProfile = async () => {
    if (!supabase) return;
    const { error } = await supabase.from("trailer_profile").update({ ...form, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    toast("Trailer profile saved"); setEdit(false); setForm({}); load();
  };
  // Vehicle-spec agent: look up the cargo bay + tow rating for a make/model, sized to the passenger
  // load, and apply it straight to the profile (least friction — no copy/paste of numbers).
  const lookupVehicle = async () => {
    if (!supabase || !veh.q.trim() || veh.busy) return;
    setVeh((v) => ({ ...v, busy: true }));
    try {
      const r = await authedFetch("/api/agents/vehiclespec", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle: veh.q.trim(), passengers: veh.pax }),
      });
      const j = await r.json();
      if (!j.ok) { toast(j.error || "Couldn't look that up", "error"); setVeh((v) => ({ ...v, busy: false })); return; }
      await supabase.from("trailer_profile").update({
        veh_cargo_len_in: j.bay_len_in, veh_cargo_width_in: j.bay_width_in, veh_cargo_height_in: j.bay_height_in, veh_usable_pct: 85,
        tow_rating_lb: Math.round(j.tow_capacity_lb), tow_vehicle: j.resolved, updated_at: new Date().toISOString(),
      }).eq("id", 1);
      setVeh((v) => ({ ...v, busy: false, spec: j }));
      toast(`${j.resolved}: ~${j.usable_cuft} cu ft for ${j.passengers} riders — applied`);
      load();
    } catch (e: any) { toast(String(e?.message ?? e).slice(0, 160), "error"); setVeh((v) => ({ ...v, busy: false })); }
  };
  const numField = (k: keyof TrailerProfile, label: string) => (
    <label className="tl-f"><span>{label}</span>
      <input type="number" defaultValue={tp[k] as number ?? ""} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value === "" ? null : Number(e.target.value) }))} />
    </label>
  );

  return (
    <div className="adm-sec tl">
      <div className="sec">Load-out &amp; tow plan
        {!lockTo && targets.length > 0 && (
          <select className="tl-evsel" value={sel ?? ""} onChange={(e) => setSel(e.target.value || null)} aria-label="Event or stop for this load-out">
            {targets.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        )}
      </div>

      <div className="tl-prof">
        <div className="tl-prof-main">
          <b>{tp.name}</b>
          <span>{tp.maker} · {tp.size_label} · GVWR {fmt(tp.gvwr_lb)} lb · {tp.tire_psi} PSI</span>
          <span>Tows with {tp.tow_vehicle}</span>
        </div>
        {isOwner && <button className="tl-edit" onClick={() => { setForm({}); setEdit((e) => !e); }}>{edit ? "Close" : "Tune"}</button>}
      </div>

      {edit && isOwner && (
        <div className="tl-editform">
          {numField("gvwr_lb", "GVWR (lb)")}
          {numField("empty_lb", "Empty (lb)")}
          {numField("cargo_cap_lb", "Cargo cap (lb)")}
          {numField("tire_psi", "Tire PSI")}
          {numField("tow_rating_lb", "Tow rating (lb)")}
          {numField("tongue_limit_lb", "Tongue limit (lb)")}
          <label className="tl-f wide"><span>Tow vehicle</span>
            <input type="text" defaultValue={tp.tow_vehicle ?? ""} onChange={(e) => setForm((f) => ({ ...f, tow_vehicle: e.target.value }))} /></label>
          <div className="tl-f wide" style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: "var(--bronze)", paddingTop: 4 }}>Trailer interior (in)</div>
          {numField("interior_len_in", "Length (in)")}
          {numField("interior_width_in", "Width (in)")}
          {numField("interior_height_in", "Height (in)")}
          {numField("usable_pct", "Usable %")}
          <div className="tl-f wide" style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: "var(--bronze)", paddingTop: 4 }}>Vehicle cargo bay (in)</div>
          <div className="tl-vlook">
            <input className="tl-vlook-q" type="text" value={veh.q} onChange={(e) => setVeh((v) => ({ ...v, q: e.target.value }))} placeholder="Year make model — e.g. 2026 Honda Pilot" onKeyDown={(e) => e.key === "Enter" && lookupVehicle()} />
            <select className="tl-vlook-pax" value={veh.pax} onChange={(e) => setVeh((v) => ({ ...v, pax: Number(e.target.value) }))} aria-label="Passengers riding">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} {n === 1 ? "rider" : "riders"}</option>)}
            </select>
            <button className="adm-btn" onClick={lookupVehicle} disabled={veh.busy || !veh.q.trim()}>{veh.busy ? "…" : "✦ Look up & fit"}</button>
          </div>
          {veh.spec && (
            <div className="tl-vspec">
              <b>{veh.spec.resolved}</b> · est. tow {Number(veh.spec.tow_capacity_lb).toLocaleString()} lb
              <div>{veh.spec.seat_config} → <b>~{veh.spec.usable_cuft} cu ft</b> usable (seats-up {veh.spec.cargo_cuft_all_seats_up} · down {veh.spec.cargo_cuft_all_seats_down})</div>
              {veh.spec.note && <div className="tl-bar-note">{veh.spec.note}</div>}
              <div className="tl-bar-note">Expert estimate — applied to the cargo bay below; tune if you’ve measured it.</div>
            </div>
          )}
          {numField("veh_cargo_len_in", "Length (in)")}
          {numField("veh_cargo_width_in", "Width (in)")}
          {numField("veh_cargo_height_in", "Height (in)")}
          {numField("veh_usable_pct", "Usable %")}
          <button className="adm-btn primary" onClick={saveProfile}>Save trailer profile</button>
        </div>
      )}

      <div className="tl-checks">
        {checks.map((c) => {
          const pct = Math.min(100, Math.round((c.used / c.limit) * 100));
          return (
            <div key={c.label} className={`tl-bar ${c.level}`}>
              <div className="tl-bar-top"><span>{c.label}</span><b>{fmt(c.used)} / {fmt(c.limit)} lb</b></div>
              <div className="tl-bar-track"><div className="tl-bar-fill" style={{ width: `${pct}%` }} /></div>
              <div className="tl-bar-note">{c.used <= c.limit ? `${fmt(c.limit - c.used)} lb headroom` : `${fmt(c.used - c.limit)} lb OVER — redistribute or leave gear`}</div>
            </div>
          );
        })}
      </div>

      {/* SPACE — does it physically fit the chosen rig (trailer vs vehicle), updated live with the pack list */}
      <div className="tl-space">
        <div className="tl-space-h">
          <span>Space · {rig === "vehicle" ? `${tp.tow_vehicle || "Vehicle"} cargo` : tp.name}</span>
          {labels.length > 0 && <button className="adm-btn" onClick={runPlan} disabled={planning}>{planning ? "Planning…" : "✦ Plan the space"}</button>}
        </div>
        {!space.hasDims ? (
          <div className="tl-hint">{isOwner ? "Tap “Tune” and add the rig’s interior dimensions to see how much fits." : "Interior dimensions not set yet."}</div>
        ) : (
          <>
            {([["Volume", space.usedCuft, space.usableCuft, "cu ft", space.cuftLevel], ["Floor", space.usedSqft, space.usableSqft, "sq ft", space.sqftLevel]] as const).map(([lab, used, limit, unit, lvl]) => {
              const pct = Math.min(100, Math.round((used / (limit || 1)) * 100));
              return (
                <div key={lab} className={`tl-bar ${lvl}`}>
                  <div className="tl-bar-top"><span>{lab}</span><b>{used} / {limit} {unit}</b></div>
                  <div className="tl-bar-track"><div className="tl-bar-fill" style={{ width: `${pct}%` }} /></div>
                  <div className="tl-bar-note">{used <= limit ? `${Math.round((limit - used) * 10) / 10} ${unit} free` : `${Math.round((used - limit) * 10) / 10} ${unit} OVER — nest, stack, or leave gear`}</div>
                </div>
              );
            })}
            {space.items.length > 0 && (
              <div className="tl-zone-items" style={{ marginTop: 8 }}>
                {space.items.map((i) => <span key={i.label} className={`tl-chip${i.src === "measured" ? " measured" : ""}`} title={i.src === "measured" ? `Measured from asset: ${i.asset}` : "Estimated footprint"}>{i.src === "measured" ? "📐 " : ""}{i.label} · {i.cuft}cf</span>)}
              </div>
            )}
          </>
        )}
        {plan && (
          <div className="tl-plan">
            {plan.summary && <div className="tl-plan-sum">{plan.summary}</div>}
            {Array.isArray(plan.zones) && plan.zones.map((z: any, i: number) => (
              <div key={i} className="tl-plan-zone">
                <div className="tl-plan-zh">{z.zone}</div>
                <div className="tl-zone-items">{(z.items ?? []).map((it: string) => <span key={it} className="tl-chip">{it}</span>)}</div>
                {z.note && <div className="tl-bar-note">{z.note}</div>}
              </div>
            ))}
            {Array.isArray(plan.at_risk) && plan.at_risk.length > 0 && (
              <div className="tl-plan-risk">
                <div className="tl-plan-zh">At risk</div>
                {plan.at_risk.map((a: any, i: number) => <div key={i} className="tl-bar-note"><b>{a.item}</b> — {a.issue ? `${a.issue} · ` : ""}{a.fix}</div>)}
              </div>
            )}
            {Array.isArray(plan.stacking) && plan.stacking.length > 0 && (
              <div className="tl-plan-zone"><div className="tl-plan-zh">Claw back space</div><ul className="tl-plan-ul">{plan.stacking.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></div>
            )}
            {Array.isArray(plan.load_order) && plan.load_order.length > 0 && (
              <div className="tl-plan-zone"><div className="tl-plan-zh">Load order (last in = first out)</div><ol className="tl-plan-ol">{plan.load_order.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol></div>
            )}
          </div>
        )}
      </div>

      <LoadMap lo={lo} />

      {labels.length === 0 ? (
        <div className="tl-hint">Generate the pack list (above) to map where each item rides.</div>
      ) : (
        <div className="tl-zones">
          {(["nose", "axle", "tail"] as const).map((z) => (
            <div key={z} className="tl-zone">
              <div className="tl-zone-h">{ZONE_LABEL[z]} · {fmt(zoneLb(z))} lb</div>
              <div className="tl-zone-items">
                {lo.items.filter((i) => i.zone === z).map((i) => <span key={i.label} className="tl-chip">{i.label} · {i.lb}</span>)}
                {!lo.items.some((i) => i.zone === z) && <span className="tl-chip empty">—</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="tl-ck">
        <div className="tl-ck-h">Tow &amp; tire check — before every roll</div>
        {towChecklist(tp).map((s, i) => (
          <label key={i} className="tl-ck-item"><input type="checkbox" /><span>{s}</span></label>
        ))}
      </div>
    </div>
  );
}

function LoadMap({ lo }: { lo: Loadout }) {
  const gx = (pct: number) => 70 + (Math.min(pct, 20) / 20) * 250; // tongue gauge: 0..20% → x 70..320
  const mark = gx(lo.tonguePct);
  const inRange = lo.tonguePct >= 10 && lo.tonguePct <= 15;
  return (
    <svg viewBox="0 0 340 196" width="100%" className="tl-map" role="img" aria-label="Trailer load map showing weight by zone">
      <circle cx="16" cy="78" r="5" fill="#a97c3f" />
      <polygon points="21,78 70,58 70,98" fill="#241a12" stroke="#a97c3f" strokeWidth="1" />
      <rect x="70" y="42" width="250" height="72" rx="6" fill="#120e0a" stroke="#3a3027" strokeWidth="1" />
      <line x1="150" y1="46" x2="150" y2="110" stroke="#2a2219" strokeDasharray="3 3" />
      <line x1="236" y1="46" x2="236" y2="110" stroke="#2a2219" strokeDasharray="3 3" />
      <rect x="200" y="37" width="20" height="6" rx="2" fill="#a97c3f" />
      <rect x="200" y="113" width="20" height="6" rx="2" fill="#a97c3f" />
      <text x="110" y="34" textAnchor="middle" style={{ fill: "var(--cream-m)", fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 0.5 }}>NOSE</text>
      <text x="193" y="34" textAnchor="middle" style={{ fill: "var(--cream-m)", fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 0.5 }}>OVER AXLE</text>
      <text x="278" y="34" textAnchor="middle" style={{ fill: "var(--cream-m)", fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 0.5 }}>TAIL</text>
      <text x="110" y="82" textAnchor="middle" style={{ fill: "#f5f1e8", fontFamily: "'Inter',sans-serif", fontSize: 13, fontWeight: 600 }}>{lo.items.filter(i => i.zone === "nose").reduce((s, i) => s + i.lb, 0)}</text>
      <text x="193" y="82" textAnchor="middle" style={{ fill: "#f5f1e8", fontFamily: "'Inter',sans-serif", fontSize: 13, fontWeight: 600 }}>{lo.items.filter(i => i.zone === "axle").reduce((s, i) => s + i.lb, 0)}</text>
      <text x="278" y="82" textAnchor="middle" style={{ fill: "#f5f1e8", fontFamily: "'Inter',sans-serif", fontSize: 13, fontWeight: 600 }}>{lo.items.filter(i => i.zone === "tail").reduce((s, i) => s + i.lb, 0)}</text>
      <text x="110" y="98" textAnchor="middle" style={{ fill: "#9b9284", fontFamily: "'Inter',sans-serif", fontSize: 9 }}>lb</text>
      <text x="193" y="98" textAnchor="middle" style={{ fill: "#9b9284", fontFamily: "'Inter',sans-serif", fontSize: 9 }}>lb</text>
      <text x="278" y="98" textAnchor="middle" style={{ fill: "#9b9284", fontFamily: "'Inter',sans-serif", fontSize: 9 }}>lb</text>
      <rect x="70" y="156" width="250" height="8" rx="4" fill="#241a12" />
      <rect x={gx(10)} y="156" width={gx(15) - gx(10)} height="8" rx="4" fill="#2f5d4f" />
      <rect x={mark - 1.5} y="151" width="3" height="18" rx="1.5" fill={inRange ? "#c8a661" : "#b82420"} />
      <text x="70" y="146" style={{ fill: "var(--cream-m)", fontFamily: "'DM Mono',monospace", fontSize: 9 }}>TONGUE {lo.tonguePct}% · target 10–15%</text>
      <text x="320" y="182" textAnchor="end" style={{ fill: "var(--cream-m)", fontFamily: "'Inter',sans-serif", fontSize: 9 }}>≈ {lo.tongueLb} lb on the hitch</text>
    </svg>
  );
}
