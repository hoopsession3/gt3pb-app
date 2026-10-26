"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clampInside, footprint, ftIn, kindOf, snap, type Item, type Layout } from "@/lib/vision";
import { fit, isFitted, keepNear, pan, resized, scaleOf, toRoom, toScreen, zoomAt, type Box, type Cam, type Size } from "@/lib/visionCamera";
import { resizeTo } from "@/lib/visionStudio";
import { dimSpots, nameSpots, placeFirst, textBox, wallGaps, type Rect } from "@/lib/planLabels";
import { PHASE_COLOR } from "@/lib/visionFlow";
import { haptic } from "@/lib/haptics";
import { useChanged } from "@/lib/useChanged";
import type { FlowFrame } from "./useFlow";

// THE PLAN (R52; S1.1 — a real camera). The room to scale, drawn into whatever pane it's given and fitted to it on
// opening: the whole room, rulers and all, as large as the pane allows, never stretched (lib/visionCamera). Then it moves
// the way a drawing on an iPad does — pinch to come closer around your fingers, drag the empty floor (or two fingers) to
// slide, a trackpad's pinch or ⌘-scroll to zoom, a wheel to slide; Fit (or F) brings the whole room back. A thing is
// dragged to move it (snapping to six inches, the distance to each wall drawn as it goes), and the picked one carries a
// corner handle to size it and a small bar beside it — Turn, Copy, Remove, Details — so the common moves are made on the
// drawing, not in a form. Every thing in the room is a stop for the keyboard: Tab to it, Enter to pick it, the arrows to
// nudge it (the designer's keys). Lines and words keep their size on screen at any zoom.
export const KIND_MIME = "application/x-gt3-kind";
const PAD = 36;
const RULER_PX = 30;
/** The zoom buttons' column down the right edge (44 wide, 12 in from the edge). */
const TOOLS_PX = 64;
/** A thing is a target at least this many pixels across on screen, however thin (a door, a window wall). */
const HIT_PX = 28;

type Mode =
  | { k: "item"; id: string; dx: number; dy: number; moved: boolean }
  | { k: "resize"; id: string; moved: boolean }
  | { k: "pan"; sx: number; sy: number; cam: Cam; moved: boolean; onEmpty: boolean }
  | { k: "pinch"; d0: number; cam: Cam; at: { x: number; y: number } };

export default function PlanView({ layout, selected, bad, focus = [], focusPath = null, canEdit, flow, onSelect, onMove, onResize, onBegin, onDropKind, onTurn, onCopy, onRemove, onDetails }: {
  layout: Layout; selected: string | null; bad: Set<string>; focus?: string[]; focusPath?: { x: number; y: number }[] | null; canEdit: boolean; flow: FlowFrame | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, at: { x_in: number; y_in: number }, record: boolean) => void;
  onResize: (id: string, patch: Pick<Item, "w_in" | "d_in" | "x_in" | "y_in">) => void;
  /** A move or a resize is starting: the room as it was goes on the undo list (once, on the first movement). */
  onBegin: () => void;
  /** A fixture dragged in from the library, let go over the room. */
  onDropKind?: (kind: string, at: { x: number; y: number }) => void;
  onTurn: (id: string) => void; onCopy: (id: string) => void; onRemove: (id: string) => void; onDetails: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<Size>({ w: 0, h: 0 });
  // null: fitted (and kept fitted as the pane or the room changes size); set: where the hands left it.
  const [manual, setManual] = useState<Cam | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const mode = useRef<Mode | null>(null);
  const W = layout.width_in, D = layout.depth_in;
  const room: Box = useMemo(() => ({ x0: 0, y0: 0, x1: W, y1: D }), [W, D]);
  // Fitted: the room and a margin for its rulers — at least RULER_PX on screen, so a foot mark is never cut off.
  // The zoom buttons keep clear of the fitted room (S1.1b — the corner was under them), along whichever edge has room to
  // spare: down the right in a wide pane, along the bottom in a tall one (a phone held upright is short of width, not
  // height). Both fits are worked out; the one that draws the room larger wins.
  const { home, toolsAt } = useMemo(() => {
    const fitWith = (side: "right" | "bottom") => {
      let pad = PAD, extra = PAD, c = fit({ x0: -pad, y0: -pad, x1: W + pad, y1: D + pad }, view);
      for (let k = 0; k < 3; k++) {
        const s = scaleOf(c, view);
        pad = Math.max(PAD, RULER_PX / s);
        extra = Math.max(pad, TOOLS_PX / s);
        c = fit(side === "right" ? { x0: -pad, y0: -pad, x1: W + extra, y1: D + pad } : { x0: -pad, y0: -pad, x1: W + pad, y1: D + extra }, view);
      }
      return c;
    };
    const r = fitWith("right"), b = fitWith("bottom");
    return scaleOf(b, view) > scaleOf(r, view) * 1.01 ? { home: b, toolsAt: "bottom" as const } : { home: r, toolsAt: "right" as const };
  }, [W, D, view]);
  const cam = manual ?? home;
  const fitted = !manual || isFitted(manual, home);
  const scale = scaleOf(cam, view);
  const u = 1 / scale;   // inches per screen pixel: words and lines keep their size on screen

  // The pane's size, measured: a resize keeps the room where it was (same centre, same scale) unless it's fitted.
  const lastView = useRef(view);
  const memRef = useRef({ key: `gt3.plancam.${layout.id}`, W, D });
  useLayoutEffect(() => { memRef.current = { key: `gt3.plancam.${layout.id}`, W, D }; });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const apply = () => {
      const r = el.getBoundingClientRect();
      const next = { w: Math.round(r.width), h: Math.round(r.height) };
      if (next.w === lastView.current.w && next.h === lastView.current.h) return;
      const prev = lastView.current;
      lastView.current = next;
      setManual((m) => (m ? resized(m, prev, next) : m));
      setView(next);
      // The first measurement: bring back the view the hands left this room at this session (S1.1b).
      if (!restored.current && next.w) {
        restored.current = true;
        try {
          const raw = sessionStorage.getItem(memRef.current.key);
          const m = raw ? JSON.parse(raw) as { cam: Cam; view: Size; W: number; D: number } : null;
          const { W: w0, D: d0 } = memRef.current;
          if (m && m.W === w0 && m.D === d0 && m.view?.w && m.cam?.w) setManual(keepNear(resized(m.cam, m.view, next), { x0: 0, y0: 0, x1: w0, y1: d0 }));
        } catch { /* a private window or bad JSON: start fitted */ }
      }
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const roomAt = (p: { x: number; y: number }) => toRoom(cam, view, p.x, p.y);
  const settle = useCallback((c: Cam) => setManual(keepNear(c, room)), [room]);
  const zoomBy = useCallback((k: number, at?: { x: number; y: number }) => {
    const c = manual ?? home;
    settle(zoomAt(c, k, at ?? { x: c.x + c.w / 2, y: c.y + c.h / 2 }, home));
  }, [manual, home, settle]);
  const fitAll = useCallback(() => { setManual(null); haptic("selection"); }, []);
  // Fit the picked thing: it and a room's-worth of air around it fill the pane (never closer than the camera allows).
  const fitSel = useCallback(() => {
    const it = selected ? layout.items.find((i) => i.id === selected) : null;
    if (!it || !view.w) return;
    const b = footprint(it), air = Math.max(48, Math.max(b.x1 - b.x0, b.y1 - b.y0));
    settle(fit({ x0: b.x0 - air, y0: b.y0 - air, x1: b.x1 + air, y1: b.y1 + air }, view));
    haptic("selection");
  }, [selected, layout.items, view, settle]);

  // The view is remembered for this room for the session (S1.1b): leave for the 3D or another tab and come back to it.
  // Only a view the hands set is kept; a fitted room stays fitted. A changed room size starts fitted again.
  const memKey = `gt3.plancam.${layout.id}`;
  const restored = useRef(false);
  useEffect(() => {
    if (!restored.current || !view.w) return;
    try { if (manual) sessionStorage.setItem(memKey, JSON.stringify({ cam: manual, view, W, D })); else sessionStorage.removeItem(memKey); } catch { /* storage refused */ }
  }, [manual, view, memKey, W, D]);

  // F fits, + and − zoom (the designer's own keys move the picked thing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea|select/i.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "f" || e.key === "F") { e.preventDefault(); fitAll(); }
      else if (e.key === "s" || e.key === "S") { e.preventDefault(); fitSel(); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.25); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(0.8); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fitAll, fitSel, zoomBy]);

  // The wheel: a trackpad's pinch (it arrives as ctrl + wheel) or ⌘ + wheel zooms at the pointer; a plain wheel slides.
  // Not passive — the page mustn't scroll under a drawing being zoomed.
  const wheelState = useRef({ cam, view, home });
  useLayoutEffect(() => { wheelState.current = { cam, view, home }; });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { cam: c, view: v, home: h } = wheelState.current;
      if (!v.w) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const at = toRoom(c, v, e.clientX - r.left, e.clientY - r.top);
        settle(zoomAt(c, Math.exp(-e.deltaY * 0.01), at, h));
      } else {
        settle(pan(c, (e.deltaX / v.w) * c.w, (e.deltaY / v.h) * c.h));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [settle]);

  const start = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      // A second finger: whatever the first was doing becomes a pinch around the two.
      const [a, b] = [...pointers.current.values()];
      mode.current = { k: "pinch", d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cam, at: roomAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) };
      setMoving(null);
      return;
    }
    if (pointers.current.size > 2) return;
    const t = e.target as Element;
    const handle = t.closest?.("[data-handle]")?.getAttribute("data-handle");
    // A thing's own footprint wins over a neighbour's fingertip pad (a thin thing's target reaches past its edges).
    const at0 = roomAt(p);
    const direct = [...layout.items].reverse().find((i) => { const b = footprint(i); return at0.x >= b.x0 && at0.x <= b.x1 && at0.y >= b.y0 && at0.y <= b.y1; });
    const itemId = direct?.id ?? t.closest?.("[data-id]")?.getAttribute("data-id");
    if (handle && canEdit) { mode.current = { k: "resize", id: handle, moved: false }; setMoving(handle); return; }
    if (itemId) {
      onSelect(itemId);
      if (!canEdit) { mode.current = { k: "pan", sx: p.x, sy: p.y, cam, moved: false, onEmpty: false }; return; }
      const it = layout.items.find((i) => i.id === itemId);
      const rp = roomAt(p);
      mode.current = { k: "item", id: itemId, dx: rp.x - (it?.x_in ?? 0), dy: rp.y - (it?.y_in ?? 0), moved: false };
      setMoving(itemId);
      return;
    }
    mode.current = { k: "pan", sx: p.x, sy: p.y, cam, moved: false, onEmpty: true };
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const m = mode.current;
    if (!m) return;
    if (m.k === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = zoomAt(m.cam, Math.hypot(a.x - b.x, a.y - b.y) / m.d0, m.at, home);
      // The room point first under the fingers stays under their midpoint as they move.
      settle({ ...z, x: m.at.x - (mid.x / view.w) * z.w, y: m.at.y - (mid.y / view.h) * z.h });
      return;
    }
    if (m.k === "pan") {
      const dx = p.x - m.sx, dy = p.y - m.sy;
      if (!m.moved && Math.hypot(dx, dy) < 5) return;
      m.moved = true;
      settle({ ...m.cam, x: m.cam.x - (dx / view.w) * m.cam.w, y: m.cam.y - (dy / view.h) * m.cam.h });
      return;
    }
    const it = layout.items.find((i) => i.id === m.id);
    if (!it) return;
    const rp = roomAt(p);
    if (m.k === "item") {
      const at = clampInside({ ...it, x_in: snap(rp.x - m.dx), y_in: snap(rp.y - m.dy) }, layout);
      if (at.x_in === it.x_in && at.y_in === it.y_in) return;
      if (!m.moved) { m.moved = true; onBegin(); }
      onMove(m.id, at, false);
      return;
    }
    const next = resizeTo(it, rp, layout);
    if (next.w_in === it.w_in && next.d_in === it.d_in) return;
    if (!m.moved) { m.moved = true; onBegin(); }
    onResize(m.id, next);
  };
  const end = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    const m = mode.current;
    if (m && pointers.current.size === 0) {
      if ((m.k === "item" || m.k === "resize") && m.moved) haptic("selection");
      if (m.k === "pan" && !m.moved && m.onEmpty) onSelect(null);
      mode.current = null;
      setMoving(null);
    } else if (m?.k === "pinch" && pointers.current.size === 1) {
      // One finger left after a pinch: it slides from here, it doesn't pick or drop anything.
      const [q] = [...pointers.current.values()];
      mode.current = { k: "pan", sx: q.x, sy: q.y, cam, moved: true, onEmpty: false };
    }
  };

  // The picked thing's bar: above it (below it when there's no room above), kept inside the pane. Placed after layout
  // from the camera, so it follows a pinch or a slide.
  const sel = selected ? layout.items.find((i) => i.id === selected) ?? null : null;
  const sb = sel ? footprint(sel) : null;

  // Picked from somewhere else — the Schedule, the 3D, a finding — and off the edge of the view: slide to it, same zoom.
  // Adjusted while rendering when the pick changes (lib/useChanged), never by a finger on the plan (it's under the finger).
  if (useChanged(selected) && sb && view.w && !moving) {
    const c = manual ?? home;
    if (sb.x0 < c.x || sb.y0 < c.y || sb.x1 > c.x + c.w || sb.y1 > c.y + c.h)
      setManual(keepNear({ ...c, x: (sb.x0 + sb.x1) / 2 - c.w / 2, y: (sb.y0 + sb.y1) / 2 - c.h / 2 }, room));
  }

  const lines: number[] = [];
  for (let v = 12; v < Math.max(W, D); v += 12) lines.push(v);
  const showDims = moving ?? selected;
  const di = showDims ? layout.items.find((i) => i.id === showDims) : null;
  const db = di ? footprint(di) : null;

  // ── the words (S1.1b) ── every name that fits inside its thing is drawn there; nothing gets a number. The picked
  // thing says its name and its own size on a label placed clear of everything, and each gap to a wall is a measured
  // distance — ticks at both ends, its own colour — with its length placed where it touches nothing. A gap's length is
  // never written beside a thing as if it were the thing's size (the 19′ 6″ "table", 2026-10-26).
  const labels = useMemo(() => {
    const boxes = layout.items.map((it) => ({ it, b: footprint(it) }));
    const inner = boxes.map(({ it, b }) => {
      const k = kindOf(it.kind), w = b.x1 - b.x0, h = b.y1 - b.y0, name = it.label || k.name;
      const vertical = h > w * 1.4;
      const along = (vertical ? h : w) - 6 * u, across = (vertical ? w : h) - 4 * u;
      const fs = Math.min(14 * u, across * 0.8, along / Math.max(3, name.length * 0.58));
      return { id: it.id, name, fs, vertical, named: fs * scale >= 8 };
    });
    const view: Rect = { x0: cam.x, y0: cam.y, x1: cam.x + cam.w, y1: cam.y + cam.h };
    const obstacles: Rect[] = inner.flatMap((n, i) => (n.named ? [textBox(boxes[i].it.x_in, boxes[i].it.y_in, n.fs, n.name)] : []));
    let tag: (ReturnType<typeof placeFirst> & { text: string; size: number }) | null = null;
    const gaps: { x1: number; y1: number; x2: number; y2: number; len: number; text: { x: number; y: number; t: string } | null }[] = [];
    if (di && db) {
      const others = boxes.filter((x) => x.it.id !== di.id).map((x) => x.b);
      const size = 13 * u, gap = 6 * u;
      const text = `${di.label || kindOf(di.kind).name} · ${ftIn(di.w_in)} × ${ftIn(di.d_in)}`;
      const spot = placeFirst(nameSpots(db, size, text, gap), size, text, [...others, ...obstacles], view);
      if (spot) { tag = { ...spot, text, size }; obstacles.push(spot.box); }
      for (const g of wallGaps(db, layout)) {
        const t = ftIn(g.len), fs = 12 * u;
        const p = placeFirst(dimSpots(g.x1, g.y1, g.x2, g.y2, fs, 4 * u), fs, t, [...others, ...obstacles, db], view);
        if (p) obstacles.push(p.box);
        gaps.push({ ...g, text: p ? { x: p.x, y: p.y, t } : null });
      }
    }
    return { inner, tag, gaps };
  }, [layout, di, db, cam, u, scale]);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el || !sb || !view.w) return;
    // The bar stands clear of the thing AND of its label (S1.1b on an iPhone: it sat on "Community table · 8′ × 3′"):
    // above both, or below both when there's no room above.
    const tb = labels.tag?.box ?? null;
    const topY = tb && tb.y1 <= sb.y0 + 1 ? Math.min(sb.y0, tb.y0) : sb.y0;
    const botY = tb && tb.y0 >= sb.y1 - 1 ? Math.max(sb.y1, tb.y1) : sb.y1;
    const top = toScreen(cam, view, (sb.x0 + sb.x1) / 2, topY);
    const bot = toScreen(cam, view, (sb.x0 + sb.x1) / 2, botY);
    const bw = el.offsetWidth, bh = el.offsetHeight;
    // Clear of the zoom buttons, wherever they stand (down the right edge, or along the bottom).
    const x = Math.min(view.w - bw / 2 - (toolsAt === "right" ? 60 : 8), Math.max(bw / 2 + 8, top.x));
    const above = top.y - bh - 10;
    const y = above >= 8 ? above : Math.min(view.h - bh - (toolsAt === "bottom" ? 64 : 8), bot.y + 10);
    el.style.setProperty("--bx", `${Math.round(x)}px`);
    el.style.setProperty("--by", `${Math.round(y)}px`);
  });

  return (
    <div ref={box} className="vz-planbox">
      {view.w > 0 && (
        <svg className="vz-plan" viewBox={`${cam.x} ${cam.y} ${cam.w} ${cam.h}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="group"
          aria-label={`${layout.name}: a ${ftIn(W)} by ${ftIn(D)} room, ${layout.items.length} things — tap one to pick it, drag to move it; pinch or scroll to zoom`}
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
          onDragOver={onDropKind ? (e) => { if (e.dataTransfer.types.includes(KIND_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } } : undefined}
          onDrop={onDropKind ? (e) => { const k = e.dataTransfer.getData(KIND_MIME); if (!k) return; e.preventDefault(); onDropKind(k, roomAt(local(e))); } : undefined}>
          <rect className="room" x={0} y={0} width={W} height={D} rx={2} />
          {lines.filter((v) => v < W).map((v) => <line key={`x${v}`} className={v % 48 === 0 ? "grid4" : "grid1"} x1={v} y1={0} x2={v} y2={D} />)}
          {lines.filter((v) => v < D).map((v) => <line key={`y${v}`} className={v % 48 === 0 ? "grid4" : "grid1"} x1={0} y1={v} x2={W} y2={v} />)}
          {lines.filter((v) => v % 48 === 0 && v < W).map((v) => <text key={`rx${v}`} className="ruler" x={v} y={-10 * u} fontSize={11 * u} textAnchor="middle">{v / 12}′</text>)}
          {lines.filter((v) => v % 48 === 0 && v < D).map((v) => <text key={`ry${v}`} className="ruler" x={-8 * u} y={v + 4 * u} fontSize={11 * u} textAnchor="end">{v / 12}′</text>)}
          {/* Flow's heat: where guests walked and waited, under everything that stands in the room. */}
          {flow?.heat.map((h) => <rect key={`h${h.x}-${h.y}`} className="heat" x={h.x} y={h.y} width={h.size} height={h.size} fillOpacity={0.08 + h.v * 0.42} />)}
          {layout.items.map((it, n) => {
            const b = footprint(it), k = kindOf(it.kind);
            const w = b.x1 - b.x0, h = b.y1 - b.y0;
            // The name fits its box or isn't drawn — a label wider than the thing it names lies about where the thing
            // ends. Judged in screen pixels, so coming closer names the small things too. No numbers on the drawing.
            const { name, fs, vertical, named } = labels.inner[n];
            const on = it.id === selected;
            const front: [number, number, number, number] = it.rot === 0 ? [b.x0 + w * 0.3, b.y1, b.x1 - w * 0.3, b.y1] : it.rot === 180 ? [b.x0 + w * 0.3, b.y0, b.x1 - w * 0.3, b.y0]
              : it.rot === 90 ? [b.x0, b.y0 + h * 0.3, b.x0, b.y1 - h * 0.3] : [b.x1, b.y0 + h * 0.3, b.x1, b.y1 - h * 0.3];
            return (
              <g key={it.id} data-id={it.id} className={`it${on ? " sel" : ""}${bad.has(it.id) ? " bad" : ""}${focus.includes(it.id) ? " focus" : ""}`} tabIndex={0} role="button" aria-pressed={on}
                aria-label={`${name}, ${ftIn(it.w_in)} by ${ftIn(it.d_in)}${bad.has(it.id) ? " — overlaps or sits outside the walls" : focus.includes(it.id) ? " — part of the finding you chose" : ""}`}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(it.id); } }}>
                <title>{`${name} — ${ftIn(it.w_in)} × ${ftIn(it.d_in)}`}</title>
                {/* A thin thing still gets a fingertip-sized target (WCAG 2.5.8), centred on it. */}
                <rect className="hit" x={it.x_in - Math.max(w, HIT_PX * u) / 2} y={it.y_in - Math.max(h, HIT_PX * u) / 2} width={Math.max(w, HIT_PX * u)} height={Math.max(h, HIT_PX * u)} />
                {on && <rect className="halo" x={b.x0 - 5 * u} y={b.y0 - 5 * u} width={w + 10 * u} height={h + 10 * u} rx={6 * u} />}
                <rect className="body" x={b.x0} y={b.y0} width={w} height={h} rx={Math.min(3, w / 4, h / 4)} fill={k.color} fillOpacity={0.82} />
                <line className="front" x1={front[0]} y1={front[1]} x2={front[2]} y2={front[3]} />
                {named && <text x={it.x_in} y={it.y_in} fontSize={fs} textAnchor="middle" dominantBaseline="central"
                  transform={vertical ? `rotate(-90 ${it.x_in} ${it.y_in})` : undefined}>{name}</text>}
              </g>
            );
          })}
          {/* A chosen route finding: the way it measured, drawn under the people (S1.1c). */}
          {focusPath && focusPath.length > 1 && <polyline className="route" aria-hidden="true" points={focusPath.map((p) => `${p.x},${p.y}`).join(" ")} />}
          {flow?.guests.map((g) => <circle key={g.id} className="guest" cx={g.x} cy={g.y} r={g.phase === "seated" ? 7 : 8} fill={PHASE_COLOR[g.phase]} />)}
          {db && (
            <g aria-hidden="true" className="gaps">
              {labels.gaps.map((g, i) => {
                const horiz = g.y1 === g.y2, t = 5 * u;
                return (
                  <g key={i}>
                    <line className="gap" x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} />
                    {horiz
                      ? <><line className="gap" x1={g.x1} y1={g.y1 - t} x2={g.x1} y2={g.y1 + t} /><line className="gap" x1={g.x2} y1={g.y2 - t} x2={g.x2} y2={g.y2 + t} /></>
                      : <><line className="gap" x1={g.x1 - t} y1={g.y1} x2={g.x1 + t} y2={g.y1} /><line className="gap" x1={g.x2 - t} y1={g.y2} x2={g.x2 + t} y2={g.y2} /></>}
                    {g.text && <text className="gapt" x={g.text.x} y={g.text.y} fontSize={12 * u} textAnchor="middle" dominantBaseline="central">{g.text.t}</text>}
                  </g>
                );
              })}
            </g>
          )}
          {di && labels.tag && (
            <g aria-hidden="true" className="seltag">
              {labels.tag.leader && <line className="lead" x1={labels.tag.leader[0]} y1={labels.tag.leader[1]} x2={labels.tag.leader[2]} y2={labels.tag.leader[3]} />}
              <rect className="tagbg" x={labels.tag.box.x0} y={labels.tag.box.y0} width={labels.tag.box.x1 - labels.tag.box.x0} height={labels.tag.box.y1 - labels.tag.box.y0} rx={4 * u} />
              <text x={labels.tag.x} y={labels.tag.y} fontSize={labels.tag.size} textAnchor="middle" dominantBaseline="central">{labels.tag.text}</text>
            </g>
          )}
          {/* The picked thing's corner: drag it to size the thing (a wide, invisible ring makes it an easy target). */}
          {canEdit && sel && sb && (
            <g className="grip" data-handle={sel.id} aria-hidden="true">
              <circle cx={sb.x1} cy={sb.y1} r={18 * u} className="hit" />
              <circle cx={sb.x1} cy={sb.y1} r={7 * u} className="dot" />
            </g>
          )}
        </svg>
      )}

      {!layout.items.length && (
        <p className="vz-empty">{canEdit ? "An empty room. Drag a fixture in from the library, or tap + Add." : "Nothing in this room yet."}</p>
      )}

      {sel && !moving && (
        <div ref={bar} className="vz-actbar" role="toolbar" aria-label={`${sel.label || kindOf(sel.kind).name} — quick moves`}>
          {canEdit && <button type="button" className="k-icon-btn glass" title="Turn a quarter (R)" aria-label="Turn it" onClick={() => onTurn(sel.id)}>↻</button>}
          {canEdit && <button type="button" className="k-icon-btn glass" title="Copy" aria-label="Copy it" onClick={() => onCopy(sel.id)}>⧉</button>}
          {canEdit && <button type="button" className="k-icon-btn glass" title="Take it out (Delete)" aria-label="Take it out" onClick={() => onRemove(sel.id)}>✕</button>}
          <button type="button" className="k-icon-btn glass" title="Details" aria-label="Details — its size and why it's there" onClick={() => onDetails(sel.id)}>ⓘ</button>
        </div>
      )}

      <div className={toolsAt === "bottom" ? "vz-tools bottom" : "vz-tools"}>
        <button type="button" className="k-icon-btn glass" onClick={() => zoomBy(1.25)} title="Closer (+)" aria-label="Closer">+</button>
        <button type="button" className="k-icon-btn glass" onClick={() => zoomBy(0.8)} title="Farther (−)" aria-label="Farther">−</button>
        <button type="button" className="k-icon-btn glass" onClick={fitAll} disabled={fitted} title="Fit the whole room (F)" aria-label="Fit the whole room">⤢</button>
        {sel && <button type="button" className="k-icon-btn glass" onClick={fitSel} title="Fit the picked thing (S)" aria-label={`Fit ${sel.label || kindOf(sel.kind).name}`}>⌖</button>}
      </div>
    </div>
  );
}
