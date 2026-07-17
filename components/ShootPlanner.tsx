"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { useApp } from "./AppProvider";
import { useRealtimeTable } from "@/lib/realtime";
import InlineCreate from "./InlineCreate";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "@/components/Icon";
import Sheet from "@/components/Sheet";

// SHOOT PLANNER (0214) — plan any content shoot: date, location, call time, and a shot list you can
// assign and check off (planned → shot → in edit). The reusable capability behind the Atlanta shoot
// and every one after. Staff-gated by RLS; lives in the Studio section. Fetch state via useAsyncData —
// a failed load is a real error now, not a silent blank. Shoots/shots are mirrored into local state so
// per-row edits (date, call time, status, shot check-off, assignment) stay optimistic exactly as
// before — none of those handlers used to reload after writing, so they still don't; the mirror just
// resyncs from the board whenever it (re)loads.
type Shoot = { id: string; title: string; shoot_date: string | null; location: string | null; call_time: string | null; status: string; notes: string | null };
type Shot = { id: string; shoot_id: string; description: string; status: string; assignee: string | null; sort: number };
type Crew = { id: string; display_name: string | null };
type Board = { shoots: Shoot[]; shots: Shot[]; crew: Crew[] };

const SHOT_NEXT: Record<string, string> = { planned: "shot", shot: "cut", cut: "planned" };
const SHOT_LABEL: Record<string, ReactNode> = { planned: <><Icon name="dotOutline" /> Planned</>, shot: <><Icon name="dot" /> Shot</>, cut: <><Icon name="check" /> In edit</> };
const dnice = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null);

export default function ShootPlanner() {
  const { toast } = useApp();
  const [shoots, setShoots] = useState<Shoot[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null); // shoot id currently getting an AI shot-list draft

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { shoots: [], shots: [], crew: [] };
    const [sh, st, cr] = await Promise.all([
      supabase.from("shoots").select("*").order("shoot_date", { ascending: true, nullsFirst: false }),
      supabase.from("shots").select("*").order("sort"),
      supabase.from("profiles").select("id, display_name").neq("role", "member").order("display_name"),
    ]);
    if (sh.error) throw new Error(sh.error.message);
    if (st.error) throw new Error(st.error.message);
    if (cr.error) throw new Error(cr.error.message);
    return { shoots: (sh.data as Shoot[]) ?? [], shots: (st.data as Shot[]) ?? [], crew: (cr.data as Crew[]) ?? [] };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  useRealtimeTable(["shoots", "shots"], reload);
  const crew = board.data?.crew ?? [];

  // Mirror the fetched board into local state so the per-row edit handlers below (none of which
  // ever reloaded) keep working exactly as they did — the mirror resyncs on every successful load.
  useEffect(() => {
    if (board.data) { setShoots(board.data.shoots); setShots(board.data.shots); }
  }, [board.data]);

  const createShoot = async (title: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("shoots").insert({ title });
    if (error) toast(`Couldn't add — ${error.message}`, "error"); else reload();
  };
  const patchShoot = async (id: string, patch: Partial<Shoot>) => {
    if (!supabase) return;
    setShoots((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    await supabase.from("shoots").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  };
  const delShoot = async (id: string) => {
    if (!supabase || (typeof window !== "undefined" && !window.confirm("Delete this shoot and its shot list?"))) return;
    await supabase.from("shoots").delete().eq("id", id); setOpen(null); reload();
  };
  const addShot = async (shootId: string, description: string, sortOverride?: number) => {
    if (!supabase) return;
    // sortOverride lets a caller adding several shots in one go (the AI draft panel) assign each its
    // own position — reading shots.length fresh inside a loop would give every one the same sort,
    // since this component's state doesn't re-render mid-loop.
    const n = sortOverride ?? shots.filter((s) => s.shoot_id === shootId).length;
    await supabase.from("shots").insert({ shoot_id: shootId, description, sort: n }); reload();
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
  const delShot = async (id: string) => { if (!supabase) return; await supabase.from("shots").delete().eq("id", id); reload(); };

  return (
    <div className="shoot">
      <AsyncSection state={board} isEmpty={(data) => data.shoots.length === 0} emptyTitle="No shoots planned yet" emptySub="Add one below to build a shot list + call sheet." errorTitle="Couldn't load the shoot planner">
        {() => (
          <>
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
                            <button type="button" className="shoot-del" onClick={() => delShot(s.id)} aria-label="Delete shot"><Icon name="close" /></button>
                          </div>
                        ))}
                      </div>
                      <InlineCreate label="+ Shot" placeholder="Shot description" className="shoot-add" onCreate={(t) => addShot(sh.id, t)} />
                      <button type="button" className="dp-draft" onClick={() => setDrafting(sh.id)}><Icon name="sparkles" /> Draft shots with AI</button>
                      <button type="button" className="shoot-delshoot" onClick={() => delShoot(sh.id)}>Delete shoot</button>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </AsyncSection>
      <InlineCreate label="+ New shoot" placeholder="Shoot name (e.g. Atlanta brand shoot)" className="shoot-new" onCreate={createShoot} />
      {drafting && (
        <ShotDraftPanel shootId={drafting} onClose={() => setDrafting(null)}
          onAdd={async (descriptions) => {
            const shootId = drafting;
            const base = shots.filter((s) => s.shoot_id === shootId).length;
            for (let i = 0; i < descriptions.length; i++) await addShot(shootId, descriptions[i], base + i);
            setDrafting(null);
          }} />
      )}
    </div>
  );
}

// AI draft — notes in, a proposed shot list out. Crew picks what to keep. Same "propose it, the crew
// approves" shape as the event day planner's DraftPanel (EventDayPlanner.tsx); see app/api/agents/
// shotlist for the endpoint. Nothing here writes to the DB — onAdd hands picked descriptions back to
// addShot exactly like typing them into "+ Shot" by hand.
function ShotDraftPanel({ shootId, onClose, onAdd }: { shootId: string; onClose: () => void; onAdd: (descriptions: string[]) => void | Promise<void> }) {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shotList, setShotList] = useState<string[] | null>(null);
  const [pick, setPick] = useState<Record<number, boolean>>({});

  const run = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await authedFetch("/api/agents/shotlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shoot_id: shootId, notes }) });
      const j = await r.json();
      if (!j.ok) { setErr(j.error || "Draft failed"); setShotList(null); }
      else { setShotList(j.shots ?? []); setPick(Object.fromEntries((j.shots ?? []).map((_: unknown, i: number) => [i, true]))); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };

  return (
    <Sheet open onClose={onClose} label="Draft the shot list" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}><Icon name="sparkles" /> Draft shots</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose} title="Close"><Icon name="close" /></button></div>}>
      {!shotList && (
        <>
          <div className="dp-hint">A few notes — the setting, what you want to show off, anything specific — and AI proposes a shot list. You approve what to keep.</div>
          <textarea className="note-in" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Sunset shots at the lake, 3-4 hero shots of the truck, action shots of pours, close-ups of the product" autoFocus />
          {err && <div className="dp-err">{err}</div>}
          <div className="prod-actions" style={{ marginTop: 14 }}>
            <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
            <button type="button" className="note-save" onClick={run} disabled={loading}>{loading ? "Drafting…" : "Draft the shot list"}</button>
          </div>
        </>
      )}
      {shotList && (
        <>
          <div className="dp-hint">{shotList.length} shot{shotList.length === 1 ? "" : "s"} proposed. Untick anything you don&apos;t want, then add.</div>
          <div className="dp-draftlist">
            {shotList.map((s, i) => (
              <button key={i} type="button" className={`dp-draftrow${pick[i] ? " on" : ""}`} onClick={() => setPick((p) => ({ ...p, [i]: !p[i] }))}>
                <span className="dp-draftck">{pick[i] ? <Icon name="check" /> : <Icon name="dotOutline" />}</span>
                <span className="dp-draftmain">{s}</span>
              </button>
            ))}
          </div>
          <div className="prod-actions" style={{ marginTop: 14 }}>
            <button type="button" className="note-arch" onClick={() => setShotList(null)}>‹ Redo</button>
            <button type="button" className="note-save" onClick={() => onAdd(shotList.filter((_, i) => pick[i]))} disabled={!Object.values(pick).some(Boolean)}>Add {Object.values(pick).filter(Boolean).length} to shot list</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
