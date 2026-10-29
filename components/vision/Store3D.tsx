"use client";

import { useEffect, useRef } from "react";
import { fitCamera, homeCamera, pick, sceneFaces, type Camera, type Figure, type FloorMark } from "@/lib/vision3d";
import { kindOf, type Layout } from "@/lib/vision";

// THE STORE, IN 3D (R52). The room and everything in it, drawn as shaded boxes on a canvas (lib/vision3d — no 3D
// library). Drag to turn it, pinch or scroll to come closer, tap a thing to pick it, double-tap to go back to the corner
// view. `spin` turns it slowly on its own (the presenter); a hand on it stops the spin.
// A view turned or zoomed by hand, kept per room for the session (IMS4): Plan, 3D and Split each mount the 3D afresh, and a
// deliberate angle shouldn't be lost to a switch. Never written to storage; a room never opened in 3D starts at its corner.
const KEPT = new Map<string, Camera>();

export default function Store3D({ layout, selected, onPick, spin = false, focus, figures, heat, label, keep }: {
  layout: Pick<Layout, "width_in" | "depth_in" | "ceiling_in" | "items">;
  selected?: string | null;
  onPick?: (id: string | null) => void;
  spin?: boolean;
  /** An item to swing the camera toward (the presenter's tour). */
  focus?: string | null;
  /** Flow: the guests in the room, and the heat they leave on the floor. */
  figures?: readonly Figure[];
  heat?: readonly FloorMark[];
  label: string;
  /** The room's id, to keep a hand-set view across switches (the studio); the presenter passes none. */
  keep?: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const cam = useRef<Camera>(keep && KEPT.has(keep) ? { ...KEPT.get(keep)! } : homeCamera(layout));
  const framed = useRef("");
  const goal = useRef<Camera | null>(null);
  const held = useRef(false);
  const touched = useRef(!!keep && KEPT.has(keep));
  useEffect(() => {
    const c = cam, t = touched;
    return () => { if (keep && t.current) KEPT.set(keep, { ...c.current }); };
  }, [keep]);
  const scene = useRef({ layout, selected: selected ?? null, spin, figures, heat });
  const faces = useRef<ReturnType<typeof sceneFaces>>([]);
  const cost = useRef(0);
  const drewAt = useRef(0);
  const dirty = useRef(true);

  // A new room size, a moved thing or a new pick is a new frame.
  useEffect(() => { scene.current = { layout, selected: selected ?? null, spin, figures, heat }; dirty.current = true; }, [layout, selected, spin, figures, heat]);

  // The tour: swing toward the item, from the side its front faces, a little above.
  useEffect(() => {
    if (!focus) { goal.current = null; return; }
    const it = layout.items.find((i) => i.id === focus);
    if (!it) return;
    const yaw = ((it.rot + 180) % 360) * (Math.PI / 180) + 0.5;
    const el = canvas.current, aspect = el && el.clientHeight ? el.clientWidth / el.clientHeight : 1.4;
    // Close enough to see it, far enough to see where it sits in the room.
    goal.current = { yaw, pitch: 0.55, dist: (Math.max(260, Math.max(it.w_in, it.d_in, it.h_in) * 4)) * (1.2 / Math.min(1, aspect)), target: [it.x_in, Math.min(it.h_in, 60) / 2, it.y_in], fov: 0.9 };
    dirty.current = true;
  }, [focus, layout.items]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let raf = 0, last = performance.now();
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const frame = (now: number) => {
      const dt = Math.min(64, now - last); last = now;
      const c = cam.current;
      if (scene.current.spin && !held.current && !goal.current && !reduce) { c.yaw += dt * 0.00012; dirty.current = true; }
      if (goal.current) {
        const g = goal.current, k = reduce ? 1 : Math.min(1, dt * 0.004);
        let dy = g.yaw - c.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        c.yaw += dy * k; c.pitch += (g.pitch - c.pitch) * k; c.dist += (g.dist - c.dist) * k;
        c.target = [c.target[0] + (g.target[0] - c.target[0]) * k, c.target[1] + (g.target[1] - c.target[1]) * k, c.target[2] + (g.target[2] - c.target[2]) * k];
        if (Math.abs(dy) < 0.002 && Math.abs(g.dist - c.dist) < 1) goal.current = null;
        dirty.current = true;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth, h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) { el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); dirty.current = true; }
      // A new size frames the room for it (a phone upright stands farther back than a laptop) — until a hand has moved it.
      const size = `${w}x${h}`;
      if (framed.current !== size && w > 0 && h > 0 && !touched.current && !goal.current) { framed.current = size; cam.current = fitCamera(scene.current.layout, cam.current.yaw, w, h); dirty.current = true; }
      // Paced (S1.1b, measured: 100 things in Split on an iPad, the 3D's redraw on every drag move pushed the plan's frames
      // to 33ms): a draw that cost more than 8ms waits three times its own cost before the next, so the 3D takes at most
      // about a quarter of the main thread and the pane the hands are in keeps its frames. A cheap room draws every frame.
      const at = performance.now();
      const skip = cost.current > 8 && at - drewAt.current < cost.current * 3;
      if (dirty.current && w > 0 && h > 0 && !skip) {
        dirty.current = false;
        const t0 = at;
        drewAt.current = at;
        const { layout: L, selected: sel, figures: people, heat: warm } = scene.current;
        // The camera as it is now — a resize above may have just framed a new one (S1.1: the old frame drew with the old one).
        const f = sceneFaces(L, L.items, cam.current, w, h, sel, { figures: people, heat: warm });
        faces.current = f;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.lineJoin = "round";
        for (const face of f) {
          ctx.globalAlpha = face.alpha;
          ctx.beginPath();
          face.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.closePath();
          ctx.fillStyle = face.fill; ctx.fill();
          ctx.strokeStyle = face.stroke; ctx.lineWidth = 1; ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // The picked thing's name, over its top.
        const it = sel ? L.items.find((i) => i.id === sel) : null;
        const top = it ? f.filter((x) => x.id === it.id).sort((a, b) => Math.min(...a.pts.map((p) => p[1])) - Math.min(...b.pts.map((p) => p[1])))[0] : null;
        if (it && top) {
          const x = top.pts.reduce((s, p) => s + p[0], 0) / top.pts.length, y = Math.min(...top.pts.map((p) => p[1])) - 10;
          const words = it.label || kindOf(it.kind).name;
          ctx.font = "700 13px system-ui, -apple-system, sans-serif";
          const tw = ctx.measureText(words).width + 16;
          ctx.fillStyle = "rgba(26,22,16,.88)";
          ctx.beginPath(); ctx.roundRect?.(x - tw / 2, y - 24, tw, 22, 11); ctx.fill();
          ctx.fillStyle = "#f5f1e8"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(words, x, y - 13);
        }
        cost.current = performance.now() - t0;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Turn, come closer, pick — one finger turns, two pinch; a mouse wheel zooms.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0, pinch0 = 0, dist0 = 0, lastTap = 0;
    const down = (e: PointerEvent) => { touched.current = true; el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); held.current = true; goal.current = null; moved = 0;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = cam.current.dist; } };
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      const c = cam.current;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0 > 0) c.dist = Math.min(4000, Math.max(80, dist0 * (pinch0 / d))); }
      else { c.yaw -= dx * 0.008; c.pitch = Math.min(1.45, Math.max(0.08, c.pitch + dy * 0.006)); }
      dirty.current = true;
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size === 0) {
        held.current = false;
        if (moved < 6) {
          const r = el.getBoundingClientRect();
          const now = Date.now();
          if (now - lastTap < 320) { cam.current = fitCamera(scene.current.layout, cam.current.yaw, el.clientWidth, el.clientHeight); dirty.current = true; }
          lastTap = now;
          onPick?.(pick(faces.current, e.clientX - r.left, e.clientY - r.top));
        }
      }
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); touched.current = true; cam.current.dist = Math.min(4000, Math.max(80, cam.current.dist * (1 + Math.sign(e.deltaY) * 0.08))); dirty.current = true; };
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); el.removeEventListener("wheel", wheel); };
  }, [onPick]);

  return <canvas ref={canvas} className="vz-3d" role="img" aria-label={label} />;
}
