"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, roleOf } from "@/components/AuthProvider";
import { useApp } from "@/components/AppProvider";
import { computeLoadout, towChecks, towChecklist, type TrailerProfile, type Loadout } from "@/lib/loadout";

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();
const ZONE_LABEL: Record<string, string> = { nose: "Nose (front)", axle: "Over axle", tail: "Tail (rear)" };

// Load-Out & Tow Plan — reads the trailer profile (0037) + the live event's pack
// items, then shows weight distribution, tow-rating checks, and a tow/tire checklist.
export default function TrailerLoadout() {
  const { profile } = useAuth();
  const { toast } = useApp();
  const isOwner = roleOf(profile) === "owner";
  const [tp, setTp] = useState<TrailerProfile | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [evTitle, setEvTitle] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Partial<TrailerProfile>>({});

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data: t } = await supabase.from("trailer_profile").select("*").eq("id", 1).maybeSingle();
    setTp((t as TrailerProfile) ?? null);
    const { data: evs } = await supabase.from("events").select("id,title,is_live,sort").order("sort");
    const list = (evs as { id: string; title: string; is_live?: boolean }[]) ?? [];
    const ev = list.find((e) => e.is_live) ?? list[0] ?? null;
    setEvTitle(ev?.title ?? null);
    if (ev) {
      const { data: tasks } = await supabase.from("event_tasks").select("label,kind").eq("event_id", ev.id);
      setLabels(((tasks as { label: string; kind: string }[]) ?? []).filter((x) => x.kind === "pack").map((x) => x.label));
    } else setLabels([]);
  }, []);

  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("trailer-loadout")
      .on("postgres_changes", { event: "*", schema: "public", table: "trailer_profile" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_tasks" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  if (!tp) return null;

  const lo: Loadout = computeLoadout(labels, tp);
  const checks = towChecks(lo, tp);
  const zoneLb = (z: string) => lo.items.filter((i) => i.zone === z).reduce((s, i) => s + i.lb, 0);

  const saveProfile = async () => {
    if (!supabase) return;
    const { error } = await supabase.from("trailer_profile").update({ ...form, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    toast("Trailer profile saved"); setEdit(false); setForm({}); load();
  };
  const numField = (k: keyof TrailerProfile, label: string) => (
    <label className="tl-f"><span>{label}</span>
      <input type="number" defaultValue={tp[k] as number ?? ""} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value === "" ? null : Number(e.target.value) }))} />
    </label>
  );

  return (
    <div className="adm-sec tl">
      <div className="sec">Load-out &amp; tow plan{evTitle && <span className="tl-ev"> · {evTitle}</span>}</div>

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
      <text x="110" y="34" textAnchor="middle" style={{ fill: "#cbb89a", fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 0.5 }}>NOSE</text>
      <text x="193" y="34" textAnchor="middle" style={{ fill: "#cbb89a", fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 0.5 }}>OVER AXLE</text>
      <text x="278" y="34" textAnchor="middle" style={{ fill: "#cbb89a", fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 0.5 }}>TAIL</text>
      <text x="110" y="82" textAnchor="middle" style={{ fill: "#f5f1e8", fontFamily: "'Inter',sans-serif", fontSize: 13, fontWeight: 600 }}>{lo.items.filter(i => i.zone === "nose").reduce((s, i) => s + i.lb, 0)}</text>
      <text x="193" y="82" textAnchor="middle" style={{ fill: "#f5f1e8", fontFamily: "'Inter',sans-serif", fontSize: 13, fontWeight: 600 }}>{lo.items.filter(i => i.zone === "axle").reduce((s, i) => s + i.lb, 0)}</text>
      <text x="278" y="82" textAnchor="middle" style={{ fill: "#f5f1e8", fontFamily: "'Inter',sans-serif", fontSize: 13, fontWeight: 600 }}>{lo.items.filter(i => i.zone === "tail").reduce((s, i) => s + i.lb, 0)}</text>
      <text x="110" y="98" textAnchor="middle" style={{ fill: "#7c7468", fontFamily: "'Inter',sans-serif", fontSize: 9 }}>lb</text>
      <text x="193" y="98" textAnchor="middle" style={{ fill: "#7c7468", fontFamily: "'Inter',sans-serif", fontSize: 9 }}>lb</text>
      <text x="278" y="98" textAnchor="middle" style={{ fill: "#7c7468", fontFamily: "'Inter',sans-serif", fontSize: 9 }}>lb</text>
      <rect x="70" y="156" width="250" height="8" rx="4" fill="#241a12" />
      <rect x={gx(10)} y="156" width={gx(15) - gx(10)} height="8" rx="4" fill="#2f5d4f" />
      <rect x={mark - 1.5} y="151" width="3" height="18" rx="1.5" fill={inRange ? "#c8a661" : "#b82420"} />
      <text x="70" y="146" style={{ fill: "#cbb89a", fontFamily: "'DM Mono',monospace", fontSize: 9 }}>TONGUE {lo.tonguePct}% · target 10–15%</text>
      <text x="320" y="182" textAnchor="end" style={{ fill: "#7c7468", fontFamily: "'Inter',sans-serif", fontSize: 9 }}>≈ {lo.tongueLb} lb on the hitch</text>
    </svg>
  );
}
