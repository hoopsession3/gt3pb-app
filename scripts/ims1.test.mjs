// IMS1 — THE IMMERSIVE STUDIO, FIRST SLICE: Back closes the studio (never the vision), and a phone on its side gives the
// plan the whole width (the bar on one line, the view on the canvas, the dock only when there is something to show).
// The screens themselves are checked on every phone by smoke:console (vision-store-full's SIDE_CLEAN, vision-store-back).
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}`); } };
const des = read("components/vision/StoreDesigner.tsx"), css = read("components/vision/studio.css"), smoke = read("scripts/smoke.console.mjs");

ok("full screen is a step in the history: pushed once, on entering", /window\.history\.pushState\(\{ gt3Studio: true \}, ""\)/.test(des) && /if \(!stepped\.current\)/.test(des));
ok("Back (popstate) leaves full screen — the designer stays mounted, so the room, undo and unsaved changes stay", /addEventListener\("popstate", onPop\)/.test(des) && /stepped\.current = false; setDock\(false\); setFull\(false\)/.test(des));
ok("Done and Escape take the same step back, so no stale step is left behind", /if \(stepped\.current\) window\.history\.back\(\)/.test(des) && /if \(full\) leave\(\)/.test(des) && /e\.key === "Escape" && !sel && full\) \{ leave\(\)/.test(des));
ok("a phone on its side: the dock only for a thing picked or Evaluate's list", /const side = full && short;/.test(des) && /const dockShown = docked && !\(contextual && !item && lens !== "evaluate" && !\(roomOpen && !narrow\)\)/.test(des) && /\{dockShown && \(/.test(des));
ok("…the view floats on the canvas, the lens rides in the bar", /\{side && <div className="vz-float-view">\{viewControl\}<\/div>\}/.test(des) && /\{!side && viewControl\}/.test(des) && /\(size !== "phone" \|\| side\) && lensControl/.test(des));
ok("…and the bar keeps to one line", /\.vz-studio\.side \.vz-tbar-r\{flex-wrap:nowrap\}/.test(css) && /\.vz-studio\.side \.vz-tbar-l\{display:none\}/.test(css));
ok("the phone check measures it, and walks Back", /const CANVAS_FIRST = \(\) =>/.test(smoke) && /act: "touch"/.test(smoke) && /key: "vision-store-back"/.test(smoke) && /Back stays on the vision/.test(smoke));

ok("IMS2 — wider full screen too: the room's details only from the bar's Room button", /const contextual = full && \(side \|\| !narrow\)/.test(des) && /aria-pressed=\{roomOpen\}/.test(des));
ok("IMS2 — contextual, the inspector comes in over the canvas's edge, so picking moves nothing under the finger", /contextual \? "vz-dock mpanel mb-0 over"/.test(des) && /\.vz-studio\.full \.vz-dock\.over\{position:absolute;right:10px/.test(css));
ok("IMS2 — the app behind the studio is inert while it's full screen (not reachable, not read out)", /:scope > main, :scope > nav, :scope > \.skip-link/.test(des) && /setAttribute\("inert", ""\)/.test(des) && /removeAttribute\("inert"\)/.test(des));
ok("IMS2 — the phone check walks touch on every device: tap picks, picking moves nothing, drag moves, Undo restores, an empty drag pans", /picking moves nothing under the finger/.test(smoke) && /a drag on the empty canvas pans/.test(smoke) && /Undo puts it back/.test(smoke));
console.log(`IMS1 — THE IMMERSIVE STUDIO, FIRST SLICE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
