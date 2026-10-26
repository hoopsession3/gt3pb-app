"use client";

import { failureWords } from "@/lib/failureWords";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStable } from "@/components/AppProvider";
import { useConfirm } from "@/components/ConfirmSheet";
import { Segmented } from "@/components/controls";
import { haptic } from "@/lib/haptics";
import {
  AISLE_IN, CATALOG, PILLARS, PILLAR_WORD, allowedKind, clampInside, footprint, ftIn, issues, kindOf, parseFtIn, roomStats, snap,
  type Item, type Layout, type Pillar,
} from "@/lib/vision";
import { saveLayout } from "@/lib/visionRead";
import Store3D from "./Store3D";
import { FORMAT, type Plan } from "@/lib/visionPlans";
import FlowBar, { figuresOf } from "./FlowBar";
import { useFlow, type FlowFrame, type Speed } from "./useFlow";
import { PHASE_COLOR } from "@/lib/visionFlow";
import { InfoRow } from "@/components/kit";

// THE STORE DESIGNER (R52) — a light AutoCAD for the first GT3 Performance Bar. A plan to scale (inches, a 6-inch snap,
// feet-and-inches everywhere, the distance to each wall while a thing is moved), a 3D view that follows every move, and
// the reason each thing is there. What a plan reviewer circles is said as it happens: outside the walls, two things in
// one place, an aisle under the ADA's 36 inches. Undo and redo; Save writes what changed. The catalog holds the brand —
// cold extraction, nitro, bottles and broth; no espresso (lib/vision).
type View = "plan" | "3d" | "both";
const GROUPS = ["Bar", "Front", "Seating", "Back", "Room"] as const;
const PAD = 36;
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`);

export default function StoreDesigner({ layouts, plans = [], initialId = null, canEdit, onSaved }: { layouts: Layout[]; plans?: Plan[]; initialId?: string | null; canEdit: boolean; onSaved: () => void }) {
  const { toast } = useAppStable();
  const confirm = useConfirm();
  const [layoutId, setLayoutId] = useState(initialId && layouts.some((l) => l.id === initialId) ? initialId : layouts[0]?.id ?? "");
  const original = layouts.find((l) => l.id === layoutId) ?? layouts[0];
  const [draft, setDraft] = useState<Layout | null>(original ?? null);
  const [past, setPast] = useState<Layout[]>([]);
  const [future, setFuture] = useState<Layout[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<View>("both");
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  // Flow: guests moving through the room as it's drawn (lib/visionFlow).
  const [flowOn, setFlowOn] = useState(false);
  const [perHour, setPerHour] = useState(60);
  const [speed, setSpeed] = useState<Speed>(30);

  // A different room, or a fresh read after a save: start from what is saved (React's "adjusting state when a prop
  // changes" — during render, guarded, not an effect).
  const [base, setBase] = useState(original);
  if (base !== original) { setBase(original); setDraft(original ?? null); setPast([]); setFuture([]); setSel(null); }

  const dirty = !!draft && !!original && JSON.stringify(draft) !== JSON.stringify(original);
  const found = useMemo(() => (draft ? issues(draft) : []), [draft]);
  const bad = useMemo(() => new Set(found.flatMap((i) => i.ids)), [found]);
  const stats = draft ? roomStats(draft) : null;
  const item = draft?.items.find((i) => i.id === sel) ?? null;
  const flow = useFlow(draft ?? EMPTY_ROOM, flowOn && !!draft, perHour, speed);
  const figures = useMemo(() => figuresOf(flow), [flow]);

  /** A change the undo can take back. */
  const commit = useCallback((next: Layout) => {
    setDraft((cur) => { if (cur) setPast((p) => [...p.slice(-59), cur]); return next; });
    setFuture([]);
  }, []);
  const patchItem = (id: string, patch: Partial<Item>, record = true) => {
    if (!draft) return;
    const next = { ...draft, items: draft.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
    if (record) commit(next); else setDraft(next);
  };
  const undo = () => { if (!past.length || !draft) return; setFuture((f) => [draft, ...f]); setDraft(past[past.length - 1]); setPast((p) => p.slice(0, -1)); };
  const redo = () => { if (!future.length || !draft) return; setPast((p) => [...p, draft]); setDraft(future[0]); setFuture((f) => f.slice(1)); };

  const add = (kind: string) => {
    if (!draft || !allowedKind(kind)) return;
    const k = kindOf(kind);
    const it: Item = { id: newId(), kind, label: null, x_in: snap(draft.width_in / 2), y_in: snap(draft.depth_in / 2), rot: 0, w_in: k.w, d_in: k.d, h_in: k.h,
      why: k.why, pillars: [...k.pillars], sort: draft.items.length + 1 };
    commit({ ...draft, items: [...draft.items, { ...it, ...clampInside(it, draft) }] });
    setSel(it.id);
    haptic("selection");
  };
  const remove = (id: string) => { if (!draft) return; commit({ ...draft, items: draft.items.filter((i) => i.id !== id) }); setSel(null); };
  const turn = (id: string) => {
    const it = draft?.items.find((i) => i.id === id); if (!it || !draft) return;
    const r = ((it.rot + 90) % 360) as Item["rot"];
    patchItem(id, { rot: r, ...clampInside({ ...it, rot: r }, draft) });
  };
  const copy = (id: string) => {
    const it = draft?.items.find((i) => i.id === id); if (!it || !draft) return;
    const c = { ...it, id: newId(), x_in: it.x_in + 12, y_in: it.y_in + 12, sort: draft.items.length + 1 };
    commit({ ...draft, items: [...draft.items, { ...c, ...clampInside(c, draft) }] }); setSel(c.id);
  };

  const save = async () => {
    if (!supabase || !draft || !original || busy) return;
    if (found.some((f) => f.level === "error") && !(await confirm({ title: "Save with problems?", body: `${found.filter((f) => f.level === "error").length} thing(s) overlap or sit outside the walls. Save anyway, or fix them first?`, confirmLabel: "Save anyway" }))) return;
    setBusy(true);
    const err = await saveLayout(supabase, draft, original.items);
    setBusy(false);
    if (err) { toast(failureWords(err, "Couldn't save the room"), "error"); haptic("error"); return; }
    haptic("success"); toast("Saved — the room, and everything in it.");
    onSaved();
  };
  const newRoom = async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("store_layouts").insert({ name: "New room", width_in: 360, depth_in: 480 }).select("id").single();
    if (error) { toast(failureWords(error, "Couldn't make a room"), "error"); return; }
    setLayoutId(String((data as { id: string }).id));
    onSaved();
  };

  // Keys, on a keyboard: arrows nudge (shift: a foot), R turns, Delete takes it out, ⌘Z / ⇧⌘Z.
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea|select/i.test(t.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (!sel || !draft) return;
      const it = draft.items.find((i) => i.id === sel); if (!it) return;
      const step = e.shiftKey ? 12 : 6;
      const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (mv[e.key]) { e.preventDefault(); const n = { ...it, x_in: it.x_in + mv[e.key][0], y_in: it.y_in + mv[e.key][1] }; patchItem(sel, clampInside(n, draft)); }
      else if (e.key === "r" || e.key === "R") turn(sel);
      else if (e.key === "Delete" || e.key === "Backspace") remove(sel);
      else if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!draft) {
    return (
      <div className="vz">
        <p className="vz-sub">No room yet.</p>
        {canEdit && <button type="button" className="btn-pri" onClick={() => void newRoom()}>Start a room</button>}
      </div>
    );
  }

  return (
    <div className="vz">
      <div className="vz-top">
        <div className="vz-row grow min-w-0">
          {layouts.length > 1 && (
            <select aria-label="Which room" value={draft.id} onChange={(e) => setLayoutId(e.target.value)} className="grow min-w-0 basis-[180px]">
              {layouts.map((l) => { const pl = plans.find((x) => x.layout_id === l.id); return <option key={l.id} value={l.id}>{l.name}{pl ? ` — phase ${pl.phase}` : ""}</option>; })}
            </select>
          )}
          <Segmented label="View" kind="choice" size="sm" value={view} onChange={setView} options={[{ key: "plan", label: "Plan" }, { key: "3d", label: "3D" }, { key: "both", label: "Both" }]} />
        </div>
        {canEdit && (
          <div className="vz-row">
            <button type="button" className="btn-sec btn-sm" onClick={undo} disabled={!past.length} aria-label="Undo">↶ Undo</button>
            <button type="button" className="btn-sec btn-sm" onClick={redo} disabled={!future.length} aria-label="Redo">↷ Redo</button>
            <button type="button" className={dirty ? "btn-pri btn-sm" : "btn-sec btn-sm"} onClick={() => void save()} disabled={!dirty || busy}>{busy ? "Saving…" : dirty ? "Save" : "Saved"}</button>
          </div>
        )}
      </div>

      {stats && (
        <p className="vz-stats">
          <span><b>{stats.sqft.toLocaleString()}</b> sq ft</span>
          <span><b>{ftIn(draft.width_in)}</b> × <b>{ftIn(draft.depth_in)}</b></span>
          <span><b>{stats.seats}</b> seats</span>
          <span><b>{stats.items}</b> things</span>
          {PILLARS.map((p) => <span key={p}><i className={`inline-block w-2 h-2 rounded-full mr-1 pz-${p}`} />{PILLAR_WORD[p]} <b>{stats.pillars[p]}</b></span>)}
        </p>
      )}

      {plans.filter((x) => x.layout_id === draft.id).map((pl) => (
        <p key={pl.id} className="vz-card-s">The room for <b>{FORMAT[pl.format].mark} {pl.name}</b> · phase {pl.phase}{pl.sqft && Math.abs(pl.sqft - Math.round((draft.width_in * draft.depth_in) / 144)) > pl.sqft * 0.1 ? ` — the plan says ${pl.sqft.toLocaleString("en-US")} sq ft; this room is ${Math.round((draft.width_in * draft.depth_in) / 144).toLocaleString("en-US")}` : ""}</p>
      ))}
      {/* THE DRAWING BOARD (R53 — "be amazing on iPad Pro… and desktop"). A phone: one column — the room, then what's
          picked, then what to add. An iPad upright or in Split View: the room across the top, the inspector and the
          palette side by side below it. A wide screen (an iPad on its side, a desktop): a drafting table — what to add
          at the left, the room in the middle, what's picked at the right, both rails staying put while the room scrolls.
          The room's own pane is a container: the plan and the 3D stand side by side when it is wide enough for both. */}
      <div className="vz-cad grid gap-3 grid-cols-1 min-[760px]:grid-cols-2 min-[1100px]:grid-cols-[230px_minmax(0,1fr)_320px] min-[1100px]:items-start">
        <div className="vz-cad-main @container flex flex-col gap-3 min-w-0 min-[760px]:col-span-2 min-[1100px]:col-span-1 min-[1100px]:col-start-2 min-[1100px]:row-start-1">
          <div className={view === "plan" ? "vz-store plan grid-cols-1" : view === "3d" ? "vz-store 3d grid-cols-1" : "vz-store both grid-cols-1 @min-[720px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"}>
            {view !== "3d" && (
              <div className="vz-pane mpanel mb-0 relative min-w-0 overflow-auto min-[760px]:h-[min(68vh,700px)]">
                <PlanView layout={draft} zoom={zoom} selected={sel} bad={bad} canEdit={canEdit} onSelect={setSel} flow={flow}
                  onMove={(id, at, done) => patchItem(id, at, done)} onBegin={() => { if (draft) setPast((p) => [...p.slice(-59), draft]); setFuture([]); }} />
                <div className="vz-tools">
                  <button type="button" className="k-icon-btn lg glass" onClick={() => setZoom((z) => Math.min(4, +(z * 1.4).toFixed(2)))} aria-label="Closer">+</button>
                  <button type="button" className="k-icon-btn lg glass" onClick={() => setZoom((z) => Math.max(1, +(z / 1.4).toFixed(2)))} aria-label="Farther">−</button>
                </div>
              </div>
            )}
            {view !== "plan" && (
              <div className="vz-pane mpanel mb-0 relative min-w-0">
                <Store3D layout={draft} selected={sel} onPick={setSel} figures={figures} heat={flow?.heat} label={`${draft.name}, in 3D — drag to turn, pinch to come closer`} />
                <p className="vz-hint">Drag to turn · pinch or scroll to zoom · double-tap: corner view</p>
              </div>
            )}
          </div>


          {/* FLOW, under the room it runs in: the plan stays on screen while it runs. */}
          <FlowBar on={flowOn} onToggle={() => setFlowOn((o) => !o)} perHour={perHour} onPerHour={setPerHour} speed={speed} onSpeed={setSpeed} frame={flow} />

        </div>
        <aside className="vz-cad-right flex flex-col gap-3 min-w-0 min-[1100px]:col-start-3 min-[1100px]:row-start-1 min-[1100px]:sticky min-[1100px]:top-3 min-[1100px]:max-h-[calc(100dvh-24px)] min-[1100px]:overflow-y-auto" aria-label="What's picked, and the room">
          {item && (
            <Inspector key={item.id} item={item} canEdit={canEdit} room={draft}
              onPatch={(p) => patchItem(item.id, p)} onTurn={() => turn(item.id)} onCopy={() => copy(item.id)}
              onRemove={async () => { if (await confirm({ title: `Take out ${item.label || kindOf(item.kind).name}?`, body: "Undo brings it back, until you save.", confirmLabel: "Take it out", danger: true })) remove(item.id); }}
              onClose={() => setSel(null)} />
          )}

          {!item && canEdit && <p className="vz-card-s hidden min-[1100px]:block">Pick a thing on the plan or in 3D — its size, which way it faces and why it&apos;s there open here.</p>}
          {/* Heard as it changes (mounted before its words — spoken.audit); the list itself is below. */}
          <p className="sr-only" aria-live="polite">{found.length ? `${found.length} ${found.length === 1 ? "thing" : "things"} a plan reviewer would circle.` : ""}</p>
          {found.length > 0 && (
            <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" aria-label="What a plan reviewer would circle">
              {found.slice(0, 8).map((f, i) => (
                <p key={i} className={f.level === "error" ? "vz-issue error" : "vz-issue warn"}><button type="button" className="btn-ter" onClick={() => setSel(f.ids[0])}>{f.level === "error" ? "Fix" : "Look"}</button> {f.words}</p>
              ))}
              {found.length > 8 && <p className="vz-issue warn">…and {found.length - 8} more.</p>}
            </div>
          )}

          {/* THE SCHEDULE — every thing in the room, numbered as the plan numbers it (a plan set's equipment schedule): its
              name, its size, its pillars. A tap picks it on the plan and in 3D. */}
          <details className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
            <summary className="font-sans font-bold text-subhead cursor-pointer py-2">Schedule · {draft.items.length} things</summary>
            <div className="k-rows mt-2">
              {draft.items.map((it, n) => (
                <InfoRow key={it.id} lead={String(n + 1)} name={it.label || kindOf(it.kind).name}
                  meta={`${ftIn(it.w_in)} × ${ftIn(it.d_in)} × ${ftIn(it.h_in)}${it.pillars.length ? ` · ${it.pillars.map((p) => PILLAR_WORD[p]).join(", ")}` : ""}`}
                  onClick={() => setSel(it.id)} />
              ))}
            </div>
          </details>

          {canEdit && (
            <>
              <RoomFields key={`${draft.id}-${draft.name}-${draft.width_in}-${draft.depth_in}-${draft.ceiling_in}`} layout={draft} onChange={(p) => commit({ ...draft, ...p })} />
              <div className="vz-row">
                <button type="button" className="btn-sec btn-sm" onClick={() => void newRoom()}>+ Another room</button>
                {dirty && <button type="button" className="btn-ter" onClick={() => { setDraft(original ?? null); setPast([]); setFuture([]); }}>Discard changes</button>}
              </div>
            </>
          )}
        </aside>
        {canEdit && (
          <aside className="vz-cad-left min-w-0 min-[1100px]:col-start-1 min-[1100px]:row-start-1 min-[1100px]:sticky min-[1100px]:top-3 min-[1100px]:max-h-[calc(100dvh-24px)] min-[1100px]:overflow-y-auto" aria-label="Add to the room">
            <div className="vz-palette" aria-label="Add to the room">
              {GROUPS.map((g) => (
                <div key={g}>
                  <h3>{g === "Bar" ? "The bar — cold, clean, no espresso" : g}</h3>
                  <div className="vz-row">
                    {CATALOG.filter((c) => c.group === g).map((c) => (
                      <button key={c.kind} type="button" className="k-chip" onClick={() => add(c.kind)}>+ {c.name}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

// ── the plan: to scale, snapping, with the distance to each wall while a thing moves ──
function PlanView({ layout, zoom, selected, bad, canEdit, onSelect, onMove, onBegin, flow }: {
  layout: Layout; zoom: number; selected: string | null; bad: Set<string>; canEdit: boolean; flow: FlowFrame | null;
  onSelect: (id: string | null) => void; onMove: (id: string, at: { x_in: number; y_in: number }, record: boolean) => void; onBegin: () => void;
}) {
  const svg = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const W = layout.width_in, D = layout.depth_in;
  const toRoom = (e: { clientX: number; clientY: number }) => {
    const s = svg.current; const m = s?.getScreenCTM();
    if (!s || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const lines: number[] = [];
  for (let v = 12; v < Math.max(W, D); v += 12) lines.push(v);
  const showDims = moving ?? selected;
  const di = showDims ? layout.items.find((i) => i.id === showDims) : null;
  const db = di ? footprint(di) : null;

  return (
    <svg ref={svg} className="vz-plan" viewBox={`${-PAD} ${-PAD} ${W + PAD * 2} ${D + PAD * 2}`} width={`${zoom * 100}%`} height={`${zoom * 100}%`} role="img"
      aria-label={`${layout.name}: a ${ftIn(W)} by ${ftIn(D)} room, ${layout.items.length} things — tap one to see why it's there`}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
      onPointerMove={(e) => {
        const d = drag.current; if (!d) return;
        const p = toRoom(e);
        const it = layout.items.find((i) => i.id === d.id); if (!it) return;
        const at = clampInside({ ...it, x_in: snap(p.x - d.dx), y_in: snap(p.y - d.dy) }, layout);
        if (at.x_in !== it.x_in || at.y_in !== it.y_in) { d.moved = true; onMove(d.id, at, false); }
      }}
      onPointerUp={() => { if (drag.current?.moved) haptic("selection"); drag.current = null; setMoving(null); }}
      onPointerCancel={() => { drag.current = null; setMoving(null); }}>
      <rect className="room" x={0} y={0} width={W} height={D} rx={2} onPointerDown={() => onSelect(null)} />
      {lines.filter((v) => v < W).map((v) => <line key={`x${v}`} className={v % 48 === 0 ? "grid4" : "grid1"} x1={v} y1={0} x2={v} y2={D} />)}
      {lines.filter((v) => v < D).map((v) => <line key={`y${v}`} className={v % 48 === 0 ? "grid4" : "grid1"} x1={0} y1={v} x2={W} y2={v} />)}
      {lines.filter((v) => v % 48 === 0 && v < W).map((v) => <text key={`rx${v}`} className="ruler" x={v} y={-10} textAnchor="middle">{v / 12}′</text>)}
      {lines.filter((v) => v % 48 === 0 && v < D).map((v) => <text key={`ry${v}`} className="ruler" x={-10} y={v + 4} textAnchor="end">{v / 12}′</text>)}
      {/* Flow's heat: where guests walked and waited, under everything that stands in the room. */}
      {flow?.heat.map((h) => <rect key={`h${h.x}-${h.y}`} className="heat" x={h.x} y={h.y} width={h.size} height={h.size} fillOpacity={0.08 + h.v * 0.42} />)}
      {layout.items.map((it, n) => {
        const b = footprint(it), k = kindOf(it.kind);
        const w = b.x1 - b.x0, h = b.y1 - b.y0;
        const name = it.label || k.name;
        // The name fits its box or isn't drawn (a picked thing always says its name, over it): a label wider than the thing
        // it names lies about where the thing ends.
        const vertical = h > w * 1.4;
        const along = (vertical ? h : w) - 6, across = (vertical ? w : h) - 4;
        const fs = Math.min(15, across * 0.8, along / Math.max(3, name.length * 0.58));
        const showName = fs >= 7 || it.id === selected;
        const front: [number, number, number, number] = it.rot === 0 ? [b.x0 + w * 0.3, b.y1, b.x1 - w * 0.3, b.y1] : it.rot === 180 ? [b.x0 + w * 0.3, b.y0, b.x1 - w * 0.3, b.y0]
          : it.rot === 90 ? [b.x0, b.y0 + h * 0.3, b.x0, b.y1 - h * 0.3] : [b.x1, b.y0 + h * 0.3, b.x1, b.y1 - h * 0.3];
        return (
          <g key={it.id} className={`it${it.id === selected ? " sel" : ""}${bad.has(it.id) ? " bad" : ""}`}
            onPointerDown={(e) => {
              e.stopPropagation(); onSelect(it.id);
              if (!canEdit) return;
              (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture?.(e.pointerId);
              const p = toRoom(e); drag.current = { id: it.id, dx: p.x - it.x_in, dy: p.y - it.y_in, moved: false }; setMoving(it.id); onBegin();
            }}>
            <rect className="body" x={b.x0} y={b.y0} width={w} height={h} rx={3} fill={k.color} fillOpacity={0.82} />
            <line className="front" x1={front[0]} y1={front[1]} x2={front[2]} y2={front[3]} />
            {showName && fs >= 7 && <text x={it.x_in} y={it.y_in} fontSize={fs} textAnchor="middle" dominantBaseline="middle"
              transform={vertical ? `rotate(-90 ${it.x_in} ${it.y_in})` : undefined}>{name}</text>}
            {fs < 7 && <><circle cx={it.x_in} cy={it.y_in} r={9} className="tag" /><text x={it.x_in} y={it.y_in + 0.5} fontSize={10} textAnchor="middle" dominantBaseline="middle" className="tagt">{n + 1}</text></>}
            {it.id === selected && fs < 7 && <text x={it.x_in} y={b.y0 - 8} fontSize={13} textAnchor="middle" className="dimt">{name}</text>}
          </g>
        );
      })}
      {flow?.guests.map((g) => <circle key={g.id} className="guest" cx={g.x} cy={g.y} r={g.phase === "seated" ? 7 : 8} fill={PHASE_COLOR[g.phase]} />)}
      {di && db && (
        <g aria-hidden="true">
          {[[db.x0, it2(db).cy, 0, it2(db).cy, db.x0], [db.x1, it2(db).cy, W, it2(db).cy, W - db.x1], [it2(db).cx, db.y0, it2(db).cx, 0, db.y0], [it2(db).cx, db.y1, it2(db).cx, D, D - db.y1]]
            .filter(([, , , , len]) => len > 3)
            .map(([x1, y1, x2, y2, len], i) => (
              <g key={i}>
                <line className="dim" x1={x1} y1={y1} x2={x2} y2={y2} strokeDasharray="6 4" />
                <text className="dimt" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5} textAnchor="middle">{ftIn(len)}</text>
              </g>
            ))}
        </g>
      )}
    </svg>
  );
}
const EMPTY_ROOM: Pick<Layout, "width_in" | "depth_in" | "items"> = { width_in: 0, depth_in: 0, items: [] };
const it2 = (b: { x0: number; y0: number; x1: number; y1: number }) => ({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 });

// ── a thing's inspector: what it is, its size, which way it faces, and why it's there ──
function Inspector({ item, canEdit, room, onPatch, onTurn, onCopy, onRemove, onClose }: {
  item: Item; canEdit: boolean; room: Layout; onPatch: (p: Partial<Item>) => void; onTurn: () => void; onCopy: () => void; onRemove: () => void; onClose: () => void;
}) {
  const k = kindOf(item.kind);
  const [w, setW] = useState(ftIn(item.w_in)), [d, setD] = useState(ftIn(item.d_in)), [h, setH] = useState(ftIn(item.h_in));
  const [why, setWhy] = useState(item.why ?? "");
  const [label, setLabel] = useState(item.label ?? "");
  const size = (which: "w_in" | "d_in" | "h_in", raw: string, reset: (v: string) => void) => {
    const v = parseFtIn(raw);
    if (v == null || v <= 0 || v > 2400) { reset(ftIn(item[which])); return; }
    const next = { ...item, [which]: v };
    onPatch({ [which]: v, ...clampInside(next, room) });
    reset(ftIn(v));
  };
  const name = item.label || k.name;
  if (!canEdit) {
    return (
      <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
        <div className="vz-row justify-between"><b className="font-sans text-body">{name}</b><button type="button" className="btn-ter" onClick={onClose}>Close</button></div>
        <p className="vz-card-s">{ftIn(item.w_in)} × {ftIn(item.d_in)}, {ftIn(item.h_in)} tall</p>
        {item.why && <p className="vz-sub">{item.why}</p>}
        {item.pillars.length > 0 && <div className="vz-pillars">{item.pillars.map((p) => <span key={p} className="vz-pill"><i className={`inline-block w-2 h-2 rounded-full pz-${p}`} />{PILLAR_WORD[p]}</span>)}</div>}
      </div>
    );
  }
  return (
    <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" aria-label={`${name} — its size and why it's there`}>
      <div className="vz-row justify-between">
        <b className="font-sans text-body">{k.name}</b>
        <button type="button" className="btn-ter" onClick={onClose}>Done</button>
      </div>
      <label className="prod-f"><span>Its name in the room</span>
        <input value={label} placeholder={k.name} maxLength={80} onChange={(e) => setLabel(e.target.value)} onBlur={() => { if ((label.trim() || null) !== item.label) onPatch({ label: label.trim() || null }); }} /></label>
      <div className="vz-dims">
        <label className="prod-f"><span>Width</span><input inputMode="text" value={w} onChange={(e) => setW(e.target.value)} onBlur={() => size("w_in", w, setW)} aria-label="Width, in feet and inches" /></label>
        <label className="prod-f"><span>Depth</span><input inputMode="text" value={d} onChange={(e) => setD(e.target.value)} onBlur={() => size("d_in", d, setD)} aria-label="Depth, in feet and inches" /></label>
        <label className="prod-f"><span>Height</span><input inputMode="text" value={h} onChange={(e) => setH(e.target.value)} onBlur={() => size("h_in", h, setH)} aria-label="Height, in feet and inches" /></label>
      </div>
      <p className="vz-card-s">Type 6′ 2″, 6 2 or 74. An aisle between things people walk between needs {AISLE_IN} in.</p>
      <label className="prod-f"><span>Why it&apos;s here</span>
        <textarea rows={3} value={why} maxLength={1000} onChange={(e) => setWhy(e.target.value)} onBlur={() => { if ((why.trim() || null) !== item.why) onPatch({ why: why.trim() || null }); }} /></label>
      <div className="vz-pillars" role="group" aria-label="The pillars it serves">
        {PILLARS.map((p) => {
          const on = item.pillars.includes(p);
          return <button key={p} type="button" className={`k-chip${on ? " on" : ""}`} aria-pressed={on}
            onClick={() => onPatch({ pillars: (on ? item.pillars.filter((x) => x !== p) : [...item.pillars, p]) as Pillar[] })}>{PILLAR_WORD[p]}</button>;
        })}
      </div>
      <div className="vz-row">
        <button type="button" className="btn-sec btn-sm" onClick={onTurn}>↻ Turn</button>
        <button type="button" className="btn-sec btn-sm" onClick={onCopy}>Copy</button>
        <button type="button" className="btn-del" onClick={onRemove}>Take out</button>
      </div>
    </div>
  );
}

// ── the room itself ──
function RoomFields({ layout, onChange }: { layout: Layout; onChange: (p: Partial<Layout>) => void }) {
  const [name, setName] = useState(layout.name);
  const [w, setW] = useState(ftIn(layout.width_in)), [d, setD] = useState(ftIn(layout.depth_in)), [c, setC] = useState(ftIn(layout.ceiling_in));
  const dim = (which: "width_in" | "depth_in" | "ceiling_in", raw: string, reset: (v: string) => void, lo: number) => {
    const v = parseFtIn(raw);
    if (v == null || v < lo || v > 2400) { reset(ftIn(layout[which])); return; }
    if (v !== layout[which]) onChange({ [which]: v });
    reset(ftIn(v));
  };
  return (
    <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" aria-label="The room">
      <b className="font-sans text-subhead">The room</b>
      <label className="prod-f"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== layout.name) onChange({ name: name.trim() }); }} /></label>
      <div className="vz-dims">
        <label className="prod-f"><span>Width</span><input value={w} onChange={(e) => setW(e.target.value)} onBlur={() => dim("width_in", w, setW, 96)} aria-label="Room width" /></label>
        <label className="prod-f"><span>Depth</span><input value={d} onChange={(e) => setD(e.target.value)} onBlur={() => dim("depth_in", d, setD, 96)} aria-label="Room depth" /></label>
        <label className="prod-f"><span>Ceiling</span><input value={c} onChange={(e) => setC(e.target.value)} onBlur={() => dim("ceiling_in", c, setC, 84)} aria-label="Ceiling height" /></label>
      </div>
      <label className="prod-f"><span>Notes</span><textarea rows={2} defaultValue={layout.notes ?? ""} maxLength={2000} onBlur={(e) => { if ((e.target.value.trim() || null) !== layout.notes) onChange({ notes: e.target.value.trim() || null }); }} /></label>
    </div>
  );
}
