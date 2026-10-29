// IMS1 — THE IMMERSIVE STUDIO, FIRST SLICE: Back closes the studio (never the vision), and a phone on its side gives the
// plan the whole width (the bar on one line, the view on the canvas, the dock only when there is something to show).
// The screens themselves are checked on every phone by smoke:console (vision-store-full's SIDE_CLEAN, vision-store-back).
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}`); } };
const plan = read("components/vision/PlanView.tsx"), s3d = read("components/vision/Store3D.tsx"), vis = read("lib/vision.ts");
const des = read("components/vision/StoreDesigner.tsx"), css = read("components/vision/studio.css"), smoke = read("scripts/smoke.console.mjs");

ok("full screen is a step in the history: pushed once, on entering", /window\.history\.pushState\(\{ gt3Studio: true \}, ""\)/.test(des) && /if \(!stepped\.current\)/.test(des));
ok("Back (popstate) leaves full screen — the designer stays mounted, so the room, undo and unsaved changes stay", /addEventListener\("popstate", onPop\)/.test(des) && /stepped\.current = false; setDock\(false\); setFull\(false\)/.test(des));
ok("Done and Escape take the same step back, so no stale step is left behind", /if \(stepped\.current\) window\.history\.back\(\)/.test(des) && /if \(full\) leave\(\)/.test(des) && /e\.key === "Escape" && !sel && full\) \{ leave\(\)/.test(des));
ok("a phone on its side: the dock only for a thing picked or Evaluate's list", /const side = full && short;/.test(des) && /const dockShown = docked && !\(contextual && !item && lens !== "evaluate" && !\(roomOpen && !narrow\)\)/.test(des) && /\{dockShown && \(/.test(des));
ok("…the view floats on the canvas, the lens rides in the bar", /\{side && <div className="vz-float-view">\{viewControl\}<\/div>\}/.test(des) && /\{!side && !upright && viewControl\}/.test(des) && /\(size !== "phone" \|\| side\) && !upright && lensControl/.test(des));
ok("IMS3 — upright full screen: one row on top (Done, the room, undo, redo, save), the rest in the dock row", /const upright = full && narrow && !side;/.test(des) && /\{upright && doneButton\}/.test(des) && /\{!upright && doneButton\}/.test(des) && /\.vz-studio\.upright \.vz-tbar\{flex-wrap:nowrap\}/.test(css));
ok("IMS3 — the findings as one mark: its colour the most serious, its number how many, a tap opens Evaluate", /className=\{`k-chip vz-find\$\{errors \? " error" : found\.length \? " warn" : ""\}`\}/.test(des) && /setLens\(lens === "evaluate" \? "design" : "evaluate"\)/.test(des));
ok("…and the bar keeps to one line", /\.vz-studio\.side \.vz-tbar-r\{flex-wrap:nowrap\}/.test(css) && /\.vz-studio\.side \.vz-tbar-l\{display:none\}/.test(css));
ok("the phone check measures it, and walks Back", /const CANVAS_FIRST = \(\) =>/.test(smoke) && /act: "touch"/.test(smoke) && /key: "vision-store-back"/.test(smoke) && /Back stays on the vision/.test(smoke));

ok("IMS2 — wider full screen too: the room's details only from the bar's Room button", /const contextual = full && \(side \|\| !narrow\)/.test(des) && /aria-pressed=\{roomOpen\}/.test(des));
ok("IMS2 — contextual, the inspector comes in over the canvas's edge, so picking moves nothing under the finger", /overlaid \? "vz-dock mpanel mb-0 over"/.test(des) && /const overlaid = contextual && !besideWide && dockShown;/.test(des) && /\.vz-studio\.full \.vz-dock\.over\{position:absolute;right:10px/.test(css));
ok("IMS2 — the app behind the studio is inert while it's full screen (not reachable, not read out)", /:scope > main, :scope > nav, :scope > \.skip-link/.test(des) && /setAttribute\("inert", ""\)/.test(des) && /removeAttribute\("inert"\)/.test(des));
ok("IMS2 — the phone check walks touch on every device: tap picks, picking moves nothing, drag moves, Undo restores, an empty drag pans", /picking moves nothing under the finger/.test(smoke) && /a drag on the empty canvas pans/.test(smoke) && /Undo puts it back/.test(smoke));
ok("IMS4 — an edit made while a save is on its way is kept when the room is read back (newer than what was sent)", /const newer = same && !!sent && !!draft && draft !== sent;/.test(des) && /if \(!newer\) setDraft\(original \?\? null\)/.test(des) && /setSent\(snap\)/.test(des));
ok("IMS4 — the save states as they are: Saving, Couldn't save · Retry (edits kept), Save, Saved; leaving unsaved asks", /dirty && saveFailed \? "Couldn't save · Retry"/.test(des) && /setSaveFailed\(failureWords/.test(des) && /addEventListener\("beforeunload", warn\)/.test(des));
ok("IMS4 — one set of words on the canvas and in the details: Rotate, Duplicate, Remove from room, Close details", /aria-label="Rotate a quarter turn"/.test(plan) && /aria-label="Duplicate"/.test(plan) && /aria-label="Remove from room"/.test(plan) && />Close details</.test(des) && />Duplicate</.test(des) && />Remove from room</.test(des) && !/>Take out</.test(des));
ok("IMS4 — progressive disclosure: purpose and pillars folded; Remove apart at the foot", /<summary[^>]*>Purpose &amp; experience<\/summary>/.test(des) && /className="vz-row vz-insp-foot"/.test(des));
ok("IMS4 — pillars are intent, never an assessment, wherever they're counted or chosen", /design intent, not an assessment/.test(des) && /intent, not an assessment:/.test(des) && /aria-label="The pillars it's meant to serve \(intent\)"/.test(des));
ok("IMS4 — a measurement says what it is: distance to wall; the aisle is a design target, not a code check", /let t = `\$\{ftIn\(g\.len\)\} to wall`/.test(plan) && /if \(!p\) \{ t = ftIn\(g\.len\);/.test(plan) && /not walking clearance/.test(des) && /aisle design target, GT3's working default, not a code check/.test(vis) && !/an aisle needs/.test(vis));
ok("IMS4 — one review queue: the pill and the count open the same Evaluate list", /Review \{found\.length\} finding/.test(des) && /onClick=\{\(\) => \{ haptic\("selection"\); setLens\("evaluate"\); \}\}/.test(des) && !/onClick=\{\(\) => look\(found\[0\]\)\}/.test(des));
ok("IMS4 — the inspector beside a wide Split holds the plan's width; floating, the plan is told what it covers (Focus frames in what's left)", /const besideWide = contextual && size === "wide" && view === "both" && !!item;/.test(des) && /cover=\{cover\}/.test(des) && /const open = \{ w: Math\.max\(80, view\.w - cover\)/.test(plan));
ok("IMS4 — a hand-set 3D view is kept across Plan, 3D and Split for the session", /const KEPT = new Map<string, Camera>\(\)/.test(s3d) && /keep=\{draft\.id\}/.test(des));
ok("IMS4 — the phone check saves for real: failure, Retry, an edit during a slow save, and the room put back", /key: "vision-store-save"/.test(smoke) && /an edit made while saving is not overwritten/.test(smoke) && /the picked thing stays in view, clear of its details/.test(smoke));
console.log(`IMS1 — THE IMMERSIVE STUDIO, FIRST SLICE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
