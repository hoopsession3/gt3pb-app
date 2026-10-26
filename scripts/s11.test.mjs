// S1.1 — THE STUDIO'S UX GATE (2026-10-26 — Ryan: "S1.1 is a product-quality release gate, not another cosmetic CSS
// pass"; "the floor plan must automatically scale to maximize available canvas space without clipping or distorting").
//
//   1 · The camera by hand: fit (no stretch, centred, whole), zoom around a point, limits, pan, kept near, resized.
//   2 · Sizes dragged, not typed: the corner handle's maths — snapped, at least six inches, never through a wall, turned.
//   3 · The wiring: the plan in its own module on the camera; the canvas sized to the space left; on-canvas moves;
//       keyboard stops; the default view by size; the phone check measures the fit on every device.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const C = loadTs("lib/visionCamera.ts"), S = loadTs("lib/visionStudio.ts");

// ── 1 · the camera ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  // A 30 × 40 ft room (360 × 480 in) with 36 in around it, in a landscape pane 1000 × 600: the height sets the scale.
  const b = { x0: -36, y0: -36, x1: 396, y1: 516 }, v = { w: 1000, h: 600 };
  const f = C.fit(b, v);
  ok("fit: the canvas's own shape (never stretched)", near(f.w / f.h, v.w / v.h));
  ok("fit: the whole room in view, its taller side filling the pane", near(f.h, 552) && f.x <= b.x0 && f.x + f.w >= b.x1 && near(f.y, b.y0));
  ok("fit: centred", near(f.x + f.w / 2, 180) && near(f.y + f.h / 2, 240));
  const tall = C.fit(b, { w: 400, h: 900 });
  ok("fit in a tall pane: the width sets the scale", near(tall.w, 432) && tall.y <= b.y0 && tall.y + tall.h >= b.y1);
  ok("fit with nothing measured yet: the box itself, no NaN", Object.values(C.fit(b, { w: 0, h: 0 })).every(Number.isFinite));
  ok("scale: pixels per inch", near(C.scaleOf(f, v), 600 / 552));
  const p = C.toRoom(f, v, 500, 300);
  ok("screen ↔ room, both ways", near(p.x, 180) && near(p.y, 240) && near(C.toScreen(f, v, p.x, p.y).x, 500));
  const z = C.zoomAt(f, 2, { x: 0, y: 0 }, f);
  ok("zoom ×2 around a point: half the span, the point stays put", near(z.w, f.w / 2) && near(C.toScreen(z, v, 0, 0).x, C.toScreen(f, v, 0, 0).x) && near(C.toScreen(z, v, 0, 0).y, C.toScreen(f, v, 0, 0).y));
  ok("zoom limits: never closer than 18 in across the narrow side", C.zoomAt(f, 1e6, { x: 0, y: 0 }, f).h >= 18 - 1e-9);
  ok("zoom limits: never farther than four times the fitted view", near(C.zoomAt(f, 1e-6, { x: 0, y: 0 }, f).w, f.w * 4));
  ok("zoom: a nonsense factor changes nothing", C.zoomAt(f, NaN, { x: 0, y: 0 }, f) === f && C.zoomAt(f, -2, { x: 0, y: 0 }, f) === f);
  ok("pan: slid by inches", near(C.pan(f, 10, -5).x, f.x + 10) && near(C.pan(f, 10, -5).y, f.y - 5));
  const lost = C.keepNear({ ...f, x: 5000, y: -5000 }, { x0: 0, y0: 0, x1: 360, y1: 480 });
  ok("kept near: a slide can't lose the room (a fifth of the view still on it)", lost.x <= 360 - f.w * 0.2 + 1e-9 && lost.y + lost.h >= f.h * 0.2 - 1e-9);
  const r = C.resized(f, v, { w: 500, h: 600 });
  ok("resized: same centre, same scale — the room doesn't jump", near(r.x + r.w / 2, f.x + f.w / 2) && near(C.scaleOf(r, { w: 500, h: 600 }), C.scaleOf(f, v)));
  ok("fitted: told apart from a moved view", C.isFitted(f, f) && !C.isFitted(z, f));
}

// ── 2 · sized by the corner ─────────────────────────────────────────────────────────────────────────────────────────
{
  const room = { width_in: 360, depth_in: 480 };
  const it = { x_in: 100, y_in: 100, rot: 0, w_in: 40, d_in: 20 };   // footprint 80..120 × 90..110
  const a = S.resizeTo(it, { x: 151, y: 129 }, room);
  ok("the far corner follows the finger, snapped to 6 in; the near corner stays", a.w_in === 72 && a.d_in === 42 && near(a.x_in - a.w_in / 2, 80) && near(a.y_in - a.d_in / 2, 90), a);
  ok("never smaller than six inches", S.resizeTo(it, { x: 0, y: 0 }, room).w_in === 6);
  ok("never through the far wall", S.resizeTo(it, { x: 9999, y: 9999 }, room).w_in === 280 && S.resizeTo(it, { x: 9999, y: 9999 }, room).d_in === 390);
  const t = S.resizeTo({ ...it, rot: 90 }, { x: 140, y: 150 }, room);   // turned: footprint 90..110 × 80..120
  ok("a thing turned a quarter: its width runs down the plan", t.d_in === 48 && t.w_in === 72, t);
  ok("the default view: side by side only from 1,000 wide (an iPad upright split two 240px panes); the plan alone narrower", S.SPLIT_AT === 1000 && S.defaultView(402) === "plan" && S.defaultView(780) === "plan" && S.defaultView(999) === "plan" && S.defaultView(1000) === "both" && S.defaultView(1180) === "both");
}

// ── 2b · the 3D corner view fits its pane ───────────────────────────────────────────────────────────────────────────
{
  const V = loadTs("lib/vision3d.ts");
  const room = { width_in: 360, depth_in: 480, ceiling_in: 132 };
  for (const [w, h] of [[668, 1364], [1200, 700], [390, 300]]) {
    const c = V.fitCamera(room, 0.75, w, h);
    const pr = V.projector(c, w, h);
    const pts = [];
    for (const x of [0, 360]) for (const z of [0, 480]) for (const y of [0, 108]) pts.push(pr([x, y, z]));
    const inside = pts.every((p) => p && p[0] >= 0 && p[0] <= w && p[1] >= 0 && p[1] <= h);
    const snug = V.fitCamera(room, 0.75, w, h, 0.06).dist < V.homeCamera(room, 0.75, w / h).dist * 3;
    ok(`3D: the whole room in a ${w} × ${h} pane, no corner cut off`, inside && snug, pts);
  }
}

// ── 3 · the wiring ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const plan = read("components/vision/PlanView.tsx"), des = read("components/vision/StoreDesigner.tsx"), css = read("components/vision/studio.css"), smoke = read("scripts/smoke.console.mjs");
  ok("the plan is its own module, out of the designer", /export default function PlanView/.test(plan) && /import PlanView, \{ KIND_MIME \} from "\.\/PlanView"/.test(des) && !/function PlanView/.test(des));
  ok("drawn through the camera: viewBox = the camera, fitted until the hands move it", /viewBox=\{`\$\{cam\.x\} \$\{cam\.y\} \$\{cam\.w\} \$\{cam\.h\}`\}/.test(plan) && /const cam = manual \?\? home/.test(plan));
  ok("pinch around the fingers, slide the empty floor, wheel and trackpad", /k: "pinch"/.test(plan) && /onEmpty: true/.test(plan) && /addEventListener\("wheel", onWheel, \{ passive: false \}\)/.test(plan));
  ok("Fit, + and − on the drawing and on the keys", /aria-label="Fit the whole room"/.test(plan) && /e\.key === "f" \|\| e\.key === "F"/.test(plan));
  ok("sizes dragged by a corner handle, one undo step a drag", /data-handle=\{sel\.id\}/.test(plan) && /resizeTo\(it, rp, layout\)/.test(plan) && /if \(!m\.moved\) \{ m\.moved = true; onBegin\(\); \}/.test(plan));
  ok("the picked thing's quick moves beside it on the drawing", /className="vz-actbar"/.test(plan) && /aria-label="Turn it"/.test(plan) && /aria-label="Take it out"/.test(plan) && /onDetails=\{details\}/.test(des));
  ok("a thin thing is still a fingertip target (28px on screen)", /const HIT_PX = 28/.test(plan) && /className="hit"/.test(plan));
  ok("the rulers keep a margin on screen, so a foot mark is never cut off", /const RULER_PX = 30/.test(plan) && /RULER_PX \/ (scaleOf\(c, view\)|s)\)/.test(plan));
  ok("…and the fitted room keeps clear of the zoom buttons down the right edge (S1.1b)", /const TOOLS_PX = 64/.test(plan) && /TOOLS_PX \/ s/.test(plan) && /toolsAt === "bottom" \? "vz-tools bottom"/.test(plan));
  ok("full screen is the drawing alone, and under 1,000 wide the drawing takes the whole width — what's picked docks, never over it", /const narrow = width > 0 && width < SPLIT_AT/.test(des) && /const docked = narrow \|\| full/.test(des) && /\.vz-studio\.narrow \.vz-work\{grid-template-columns:minmax\(0,1fr\)\}/.test(css) && /libOpen && !full/.test(des) && /\.vz-stage\.docked\{display:flex/.test(css));
  ok("a phone opens the studio full screen (once measured), and leaving it closes any open details", /if \(width > 0 && \(size === "phone" \|\| short\) && !autoFull\)/.test(des) && /setDock\(false\); setFull\(\(f\) => !f\)/.test(des));
  ok("save keeps the undo history (the same room read back after its own save)", /const same = !!original && savedId === original\.id/.test(des) && /setSavedId\(draft\.id\)/.test(des));
  ok("3D: framed by projection to its pane, and drawn with the camera just framed", /fitCamera\(scene\.current\.layout, cam\.current\.yaw, w, h\)/.test(read("components/vision/Store3D.tsx")) && /sceneFaces\(L, L\.items, cam\.current, w, h/.test(read("components/vision/Store3D.tsx")));
  ok("a thing's own footprint wins over a neighbour's fingertip pad", /const direct = \[\.\.\.layout\.items\]\.reverse\(\)\.find/.test(plan));
  ok("every thing a keyboard stop with its name and size", /tabIndex=\{0\} role="button"/.test(plan) && /e\.key === "Enter" \|\| e\.key === " "/.test(plan));
  ok("lines and words keep their size at any zoom", /vector-effect:non-scaling-stroke/.test(css) && /fontSize=\{11 \* u\}/.test(plan));
  ok("the canvas sized to the space actually left under it", /setProperty\("--stage-h"/.test(des) && /height:var\(--stage-h,/.test(css));
  ok("an empty room says what to do", /An empty room\. Drag a fixture in/.test(plan));
  ok("the phone check measures the fit on every device it visits", /const STUDIO_FITS = \(\) =>/.test(smoke) && /check: STUDIO_FITS/.test(smoke) && /the studio fits its screen \(S1\.1\)/.test(smoke));
  ok("the store tab gives the title's second line back to the canvas", /tab !== "store" && <p className="vz-sub">/.test(read("components/vision/VisionApp.tsx")));
}

console.log(`S1.1 — THE STUDIO'S UX GATE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
