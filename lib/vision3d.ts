// THE STORE IN 3D, WITHOUT A 3D LIBRARY (R52). The room and everything in it are boxes; a box is six faces; each face is
// projected through an orbiting camera, shaded by how squarely it faces the light, and the faces are drawn back to front
// (the painter's order). A few kilobytes instead of a 600 KB engine, and it runs in the iPhone app the same as the web.
// Pure: the canvas drawing is components/vision/Store3D; the maths is here, tested.
import { footprint, kindOf, type Item } from "./vision";

export type V3 = [number, number, number];
export type Camera = { yaw: number; pitch: number; dist: number; target: V3; fov: number };
export type Face = { pts: [number, number][]; depth: number; fill: string; stroke: string; id: string | null; alpha: number };

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Where the eye is: on a sphere around the target, yaw around the vertical, pitch above the floor. Y is up. */
export function eyeOf(c: Camera): V3 {
  const cp = Math.cos(c.pitch);
  return [c.target[0] + c.dist * cp * Math.sin(c.yaw), c.target[1] + c.dist * Math.sin(c.pitch), c.target[2] + c.dist * cp * Math.cos(c.yaw)];
}

/** A projector for a canvas w×h: a world point → [x, y, depth], or null when it is behind the eye. */
export function projector(c: Camera, w: number, h: number) {
  const eye = eyeOf(c);
  const fwd = norm(sub(c.target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const f = (h / 2) / Math.tan(c.fov / 2);
  return (p: V3): [number, number, number] | null => {
    const d = sub(p, eye);
    const z = dot(d, fwd);
    if (z < 1) return null;
    return [w / 2 + (dot(d, right) * f) / z, h / 2 - (dot(d, up) * f) / z, z];
  };
}

/** A colour darkened (or lightened) by `k` (0–2, 1 = itself). */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

const LIGHT = norm([0.45, 0.85, 0.3]);

/** One box's visible faces: x/z on the floor (inches), y up. */
export function boxFaces(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, color: string, id: string | null,
  project: (p: V3) => [number, number, number] | null, eye: V3, alpha = 1): Face[] {
  const P: V3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const quads: [number[], V3][] = [
    [[4, 5, 6, 7], [0, 1, 0]], [[0, 3, 2, 1], [0, -1, 0]],
    [[0, 1, 5, 4], [0, 0, -1]], [[2, 3, 7, 6], [0, 0, 1]],
    [[1, 2, 6, 5], [1, 0, 0]], [[3, 0, 4, 7], [-1, 0, 0]],
  ];
  const out: Face[] = [];
  for (const [idx, n] of quads) {
    const c: V3 = [(x0 + x1) / 2 + (n[0] * (x1 - x0)) / 2, (y0 + y1) / 2 + (n[1] * (y1 - y0)) / 2, (z0 + z1) / 2 + (n[2] * (z1 - z0)) / 2];
    if (dot(n, sub(eye, c)) <= 0) continue;                       // facing away
    const pts = idx.map((i) => project(P[i]));
    if (pts.some((p) => !p)) continue;
    const lit = 0.62 + 0.45 * Math.max(0, dot(n, LIGHT));
    out.push({ pts: pts.map((p) => [p![0], p![1]]), depth: pts.reduce((s, p) => s + p![2], 0) / 4, fill: shade(color, lit), stroke: shade(color, lit * 0.78), id, alpha });
  }
  return out;
}

/** The scene: the floor, two low walls at the back (cut-away, so the room stays visible), and every item — sorted far to near. */
export type Figure = { x: number; y: number; color: string; seated?: boolean };
export type FloorMark = { x: number; y: number; size: number; v: number };

/** A flat square on the floor (a heat square), just above it. */
function floorQuad(x0: number, z0: number, x1: number, z1: number, color: string, alpha: number, project: (p: V3) => [number, number, number] | null): Face | null {
  const pts = ([[x0, 0.4, z0], [x1, 0.4, z0], [x1, 0.4, z1], [x0, 0.4, z1]] as V3[]).map(project);
  if (pts.some((p) => !p)) return null;
  return { pts: pts.map((p) => [p![0], p![1]]), depth: 0, fill: color, stroke: color, id: null, alpha };
}

export function sceneFaces(room: { width_in: number; depth_in: number; ceiling_in: number }, items: readonly Item[], c: Camera, w: number, h: number, selected: string | null,
  extra: { figures?: readonly Figure[]; heat?: readonly FloorMark[] } = {}): Face[] {
  const project = projector(c, w, h);
  const eye = eyeOf(c);
  // The floor first, always, then whatever lies on it: the floor is one big face, and its middle can sort nearer than a
  // thing in a far corner — it must never be painted over what stands on it.
  const under: Face[] = boxFaces(0, 0, room.width_in, room.depth_in, -4, 0, "#efe7d6", null, project, eye).sort((a, b) => b.depth - a.depth);
  for (const m of extra.heat ?? []) {
    const q = floorQuad(m.x, m.y, Math.min(room.width_in, m.x + m.size), Math.min(room.depth_in, m.y + m.size), "#b82420", 0.08 + m.v * 0.42, project);
    if (q) under.push(q);
  }
  const faces: Face[] = [];
  // The two walls farthest from the eye, full height but see-through above the counters; the near two stay open.
  const wallH = Math.min(room.ceiling_in, 108);
  const back = eye[2] > room.depth_in / 2 ? [0, 0, room.width_in, 6] : [0, room.depth_in - 6, room.width_in, room.depth_in];
  const side = eye[0] > room.width_in / 2 ? [0, 0, 6, room.depth_in] : [room.width_in - 6, 0, room.width_in, room.depth_in];
  for (const [ax, az, bx, bz] of [back, side]) faces.push(...boxFaces(ax, az, bx, bz, 0, wallH, "#e2d8c4", null, project, eye, 0.92));
  for (const it of items) {
    const b = footprint(it);
    const k = kindOf(it.kind);
    const hh = Math.max(1, it.h_in);
    const lift = k.kind === "menu_board" ? 54 : k.kind === "window_wall" || k.kind === "walk_up" ? 24 : 0;   // what hangs on a wall hangs
    faces.push(...boxFaces(b.x0, b.y0, b.x1, b.y1, lift, lift + hh, it.id === selected ? "#d4a73a" : k.color, it.id, project, eye,
      k.kind === "window_wall" || k.kind === "walk_up" ? 0.55 : 1));
  }
  // Guests: a body and a head, about a person's size — shorter when they sit.
  for (const f of extra.figures ?? []) {
    const tall = f.seated ? 46 : 64;
    faces.push(...boxFaces(f.x - 7, f.y - 5, f.x + 7, f.y + 5, 0, tall - 10, f.color, null, project, eye));
    faces.push(...boxFaces(f.x - 4, f.y - 4, f.x + 4, f.y + 4, tall - 9, tall, "#e8c9a6", null, project, eye));
  }
  return [...under, ...faces.sort((a, b) => b.depth - a.depth)];
}

/** A camera that frames the whole room from a corner, a little above — the opening view. */
export function homeCamera(room: { width_in: number; depth_in: number }, yaw = 0.75, aspect = 1.6): Camera {
  // The room's diagonal fits the narrower side of the screen: a phone held upright is narrow, so it stands farther back.
  const diag = Math.hypot(room.width_in, room.depth_in);
  const fov = 0.9, fit = Math.min(1, aspect);
  return { yaw, pitch: 0.62, dist: (diag / 2 / Math.tan(fov / 2)) * (1.15 / fit), target: [room.width_in / 2, 0, room.depth_in / 2], fov };
}

/** Which item a tap at (x, y) lands on: the nearest face that contains the point (faces are sorted far → near). */
export function pick(faces: readonly Face[], x: number, y: number): string | null {
  for (let i = faces.length - 1; i >= 0; i--) {
    const f = faces[i];
    if (!f.id) continue;
    let inside = false;
    for (let a = 0, b = f.pts.length - 1; a < f.pts.length; b = a++) {
      const [xa, ya] = f.pts[a], [xb, yb] = f.pts[b];
      if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
    }
    if (inside) return f.id;
  }
  return null;
}
