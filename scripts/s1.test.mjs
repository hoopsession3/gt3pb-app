// S1 — THE STUDIO: THE CANVAS FIRST (2026-10-26 — Ryan's Spatial Design Studio brief: "the spatial canvas should be the
// primary experience, not a small component surrounded by controls"; "no enormous vertical inventory of buttons").
//
//   1 · The width rule: phone, mid, wide — laid out by the studio's own width, the library open from the start only roomy.
//   2 · The workspace: a thin bar; the canvas taking the height that's left; library · canvas · inspector; full screen.
//   3 · Nothing lost: saved layouts, undo, the checks, Flow (labelled a simulation), the schedule, the room's fields.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ── 1 · the width rule ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const S = loadTs("lib/visionStudio.ts");
  ok("under 760: a phone's studio", S.sizeOf(402) === "phone" && S.sizeOf(759) === "phone");
  ok("760 to 1,099: canvas and inspector", S.sizeOf(760) === "mid" && S.sizeOf(1099) === "mid");
  ok("1,100 and up: wide", S.sizeOf(1100) === "wide" && S.sizeOf(1600) === "wide");
  const src = read("components/vision/useStudioSize.ts");
  ok("measured on the studio itself, again whenever it resizes", /ResizeObserver/.test(src) && /useState<HTMLElement \| null>/.test(src));
  ok("roomy (the library open from the start) at 1,400 and up", S.roomyAt === 1400 && /roomy: w >= roomyAt/.test(src));
}

// ── 2 · the workspace ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const des = read("components/vision/StoreDesigner.tsx"), css = read("components/vision/studio.css"), vcss = read("components/vision/vision.css"), flow = read("components/vision/FlowBar.tsx");
  ok("one thin bar: the room, the view, add, the lens (the flow is Experience, S1.1b), undo, redo, save, full screen", /role="toolbar"/.test(des) && /\+ Add/.test(des) && /key: "experience", label: "Experience"/.test(des) && /"⤢ Full screen"/.test(des));
  ok("the canvas takes the height the screen has left — never a fixed strip", /\.vz-stage\{[^}]*height:var\(--stage-h,clamp\([^)]*100dvh/.test(css) && /\.vz-stage \.vz-3d\{height:100%\}/.test(css));
  ok("wide: library · canvas · inspector; the library folds away", /\.vz-studio\.wide\.lib \.vz-work\{grid-template-columns:240px minmax\(0,1fr\) 320px\}/.test(css) && /setLibChoice\(!libOpen\)/.test(des));
  ok("the library: found by name, filtered by part of the store, dragged onto the plan or tapped in", /placeholder="Find a fixture"/.test(des) && /SHELF = \["All", \.\.\.GROUPS\]/.test(des) && /draggable=\{drag\}/.test(des) && /onDrop=\{onDropKind/.test(read("components/vision/PlanView.tsx")));
  ok("…a drop lands where it was let go, snapped", /x_in: snap\(at\?\.x \?\? draft\.width_in \/ 2\)/.test(des));
  ok("a phone or an iPad upright: the library in a sheet", /<Sheet open onClose=\{\(\) => setAddOpen\(false\)\} label="Add to the room"/.test(des));
  ok("a phone: what's picked docks under the drawing — its line, then the whole inspector as a sheet (S1.1: beside it, never over it)", /\{dockShown && \(/.test(des) && /const dockShown = docked && /.test(des) && /: "vz-dock mpanel mb-0"\}/.test(des) && /narrow && dock && item && \(\n\s*<Sheet open/.test(des));
  ok("Flow floats over the canvas; still said to be a simulation on assumed timings", /className="vz-float-flow/.test(des) && /floating \/>/.test(des) && /Simulated, on assumed timings/.test(flow));
  ok("full screen: the app's own root, safe areas kept, Escape leaves", /createPortal\(studio, host\)/.test(des) && /\.vz-studio\.full\{position:fixed;inset:0[^}]*safe-area-inset-top/.test(css) && /e\.key === "Escape" && !sel && full/.test(des));
  ok("the studio's stylesheet rides with the designer alone — the presenter and the vision's other screens don't carry it", /^"use client";\n\nimport "\.\/studio\.css";/.test(des) && !/vz-studio/.test(vcss));
  ok("the toolbar's classes are its own (the capital bars keep .vz-bar)", /\.vz-tbar\{/.test(css) && /\.vz-bar\{display:grid/.test(vcss));
}

// ── 3 · nothing lost ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const des = read("components/vision/StoreDesigner.tsx");
  ok("saved layouts open as they did: the same save, the same layout read", /saveLayout\(supabase, snap, original\.items\)/.test(des));
  ok("undo and redo, by button and by key", /aria-label="Undo"/.test(des) && /aria-label="Redo"/.test(des) && /e\.key\.toLowerCase\(\) === "z"/.test(des));
  ok("what a plan reviewer would circle, still listed and still heard", /What a plan reviewer would circle/.test(des) && /aria-live="polite"/.test(des));
  ok("the schedule and the room's fields", /Schedule · \{draft\.items\.length\} things/.test(des) && /<RoomFields bare/.test(des));
  ok("the phone check visits the studio full screen and its library", /key: "vision-store-full"/.test(read("scripts/smoke.console.mjs")) && /key: "vision-store-add"/.test(read("scripts/smoke.console.mjs")));
}

console.log(`S1 — THE STUDIO, THE CANVAS FIRST: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
