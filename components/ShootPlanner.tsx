"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useRealtimeTable } from "@/lib/realtime";
import InlineCreate from "./InlineCreate";

// SHOOT PLANNER (0214) — plan any content shoot: date, location, call time, and a shot list you can
// assign and check off (planned → shot → in edit). The reusable capability behind the Atlanta shoot
// and every one after. Staff-gated by RLS; lives in the Studio section.
type Shoot = { id: string; title: string; shoot_date: string | null; location: string | null; call_time: string | null; status: string; notes: string | null };
type Shot = { id: string; shoot_id: string; description: string; status: string; assignee: string | null; sort: number };
type Crew = { id: string; display_name: string | null };

const SHOT_NEXT: Record<string, string> = { planned: "shot", shot: "cut", cut: "planned" };
const SHOT_LABEL: Record<string, string> = { planned: "○ Planned", shot: "● Shot", cut: "✓ In edit" };
const dnice = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null);

export default function ShootPlanner() {
  const { toast } = useApp();
  const [shoots, setShoots] = useState<Shoot[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [crew, setCrew] = useState<Crew[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
    const [sh, st, cr] = await Promise.all([
      supabase.from("shoots").select("*").order("shoot_date", { ascending: true, nullsFirst: false }),
      supabase.from("shots").select("*").order("sort"),
      supabase.from("profiles").select("id, display_name").neq("role", "member").order("display_name"),
    ]);
    setShoots((sh.data as Shoot[]) ?? []); setShots((st.data as Shot[]) ?? []); setCrew((cr.data as Crew[]) ?? []); setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["shoots", "shots"], load);

  const createShoot = async (title: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("shoots").insert({ title });
    if (error) toast(`Couldn't add — ${error.message}`, "error"); else load();
  };
  const patchShoot = async (id: string, patch: Partial<Shoot>) => {
    if (!supabase) return;
    setShoots((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    await supabase.from("shoots").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  };
  const delShoot = async (id: string) => {
    if (!supabase || (typeof window !== "undefined" && !window.confirm("Delete this shoot and its shot list?"))) return;
    await supabase.from("shoots").delete().eq("id", id); setOpen(null); load();
  };
  const addShot = async (shootId: string, description: string) => {
    if (!supabase) return;
    const n = shots.filter((s) => s.shoot_id === shootId).length;
    await supabase.from("shots").insert({ shoot_id: shootId, description, sort: n }); load();
  };
  const cycleShot = async (s: Shot) => {
    if (!supabase) return;
    const ns = SHOT_NEXT[s.status] ?? "planned";
    setShots((p) => p.map((x) => (x.id === s.id ? { ...x, status: ns } : x)));
    await supabase.from("shots").update({ status: ns }).eq("id", s.id);
  };
  const assignShot = async (s: Shot, uid: string) => {
    if (!supabase) return;
    setShots((p) => p.map((x) => (x.id === s.id ? { ...x, assignee: uid || null } : x)));
    await supabase.from("shots").update({ assignee: uid || null }).eq("id", s.id);
  };
  const delShot = async (id: string) => { if (!supabase) return; await supabase.from("shots").delete().eq("id", id); load(); };

  if (!loaded) return null;

  return (
    <div className="shoot">
      {shoots.length === 0 && <div className="shoot-empty">No shoots planned yet. Add one to build a shot list + call sheet.</div>}
      {shoots.map((sh) => {
        const list = shots.filter((s) => s.shoot_id === sh.id);
        const shotN = list.filter((s) => s.status !== "planned").length;
        const isOpen = open === sh.id;
        return (
          <div className="shoot-card" key={sh.id}>
            <button type="button" className="shoot-head" onClick={() => setOpen(isOpen ? null : sh.id)}>
              <div className="shoot-head-main">
                <b>{sh.title}</b>
                <span className="shoot-sub">{[dnice(sh.shoot_date), sh.location, sh.call_time && `call ${sh.call_time}`].filter(Boolean).join(" · ") || "Set date & location"}</span>
              </div>
              <span className="shoot-cnt">{shotN}/{list.length} shots</span>
            </button>
            {isOpen && (
              <div className="shoot-body">
                <div className="shoot-fields">
                  <label><span>Date</span><input type="date" value={sh.shoot_date ?? ""} onChange={(e) => patchShoot(sh.id, { shoot_date: e.target.value || null })} /></label>
                  <label><span>Call time</span><input value={sh.call_time ?? ""} placeholder="8:00 AM" onChange={(e) => patchShoot(sh.id, { call_time: e.target.value || null })} /></label>
                  <label className="shoot-f-wide"><span>Location</span><input value={sh.location ?? ""} placeholder="Where" onChange={(e) => patchShoot(sh.id, { location: e.target.value || null })} /></label>
                  <label><span>Status</span><select value={sh.status} onChange={(e) => patchShoot(sh.id, { status: e.target.value })}><option value="planning">Planning</option><option value="scheduled">Scheduled</option><option value="wrapped">Wrapped</option></select></label>
                </div>
                <div className="shoot-shots">
                  {list.map((s) => (
                    <div className="shoot-shot" key={s.id}>
                      <button type="button" className={`shoot-st st-${s.status}`} onClick={() => cycleShot(s)}>{SHOT_LABEL[s.status]}</button>
                      <span className="shoot-desc">{s.description}</span>
                      <select className="shoot-assign" value={s.assignee ?? ""} onChange={(e) => assignShot(s, e.target.value)} aria-label="Assign shot"><option value="">—</option>{crew.map((c) => <option key={c.id} value={c.id}>{c.display_name || "Crew"}</option>)}</select>
                      <button type="button" className="shoot-del" onClick={() => delShot(s.id)} aria-label="Delete shot">✕</button>
                    </div>
                  ))}
                </div>
                <InlineCreate label="+ Shot" placeholder="Shot description" className="shoot-add" onCreate={(t) => addShot(sh.id, t)} />
                <button type="button" className="shoot-delshoot" onClick={() => delShoot(sh.id)}>Delete shoot</button>
              </div>
            )}
          </div>
        );
      })}
      <InlineCreate label="+ New shoot" placeholder="Shoot name (e.g. Atlanta brand shoot)" className="shoot-new" onCreate={createShoot} />
    </div>
  );
}
