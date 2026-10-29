// S1.1b — THE STUDIO, SECOND PASS (2026-10-26 — Ryan's two studio briefs: "do not render all object numbers as large
// circles", "a proper annotation layout strategy", "fit to selection… persistent view state", the 19′ × 6″ table).
//
//   1 · The words, placed by hand: a box per word, the first clear spot, nothing drawn over a fixture, leaders when far.
//   2 · The 19′ 6″ "table": the picked thing's label carries its own size; a gap's length is a gap, drawn with ticks.
//   3 · The wiring: no numbers on the drawing, the Schedule finds and picks, fit-to-selection, the view remembered.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const L = loadTs("lib/planLabels.ts");
const V = loadTs("lib/vision.ts");

// ── 1 · placement ─────────────────────────────────────────────────────────────────────────────────────────────────
const bounds = { x0: -36, y0: -36, x1: 396, y1: 516 };
const thing = { x0: 100, y0: 100, x1: 130, y1: 112 };
const b = L.textBox(0, 0, 12, "Fridge");
ok("a word's box grows with its letters", L.textBox(0, 0, 12, "Community table").x1 > b.x1);
const free = L.placeFirst(L.nameSpots(thing, 12, "Fridge", 6), 12, "Fridge", [thing], bounds);
ok("an open room: the name sits just above the thing, no leader", free && free.y < thing.y0 && free.leader === null, free);
ok("…and never on the thing", free && !L.hits(free.box, thing));
const above = { x0: 60, y0: 60, x1: 170, y1: 98 };
const pushed = L.placeFirst(L.nameSpots(thing, 12, "Fridge", 6), 12, "Fridge", [thing, above], bounds);
ok("something above it: the name moves below", pushed && pushed.y > thing.y1, pushed);
const boxed = [thing, { x0: 0, y0: 0, x1: 360, y1: 99 }, { x0: 0, y0: 113, x1: 360, y1: 480 }, { x0: 131, y0: 0, x1: 360, y1: 480 }, { x0: 0, y0: 0, x1: 99, y1: 480 }];
ok("boxed in on every side: no label at all, rather than one on top of a fixture", L.placeFirst(L.nameSpots(thing, 12, "Fridge", 6), 12, "Fridge", boxed, bounds) === null);
const edge = { x0: 0, y0: 0, x1: 30, y1: 12 };
const atEdge = L.placeFirst(L.nameSpots(edge, 12, "Fridge", 6), 12, "Fridge", [edge], { x0: 0, y0: 0, x1: 360, y1: 480 });
ok("at the edge of the view: the word slides inside it rather than vanishing", atEdge && L.inside(atEdge.box, { x0: 0, y0: 0, x1: 360, y1: 480 }) && !L.hits(atEdge.box, edge), atEdge);
const crowd = [thing, { x0: 60, y0: 80, x1: 170, y1: 98 }, { x0: 60, y0: 113, x1: 170, y1: 132 }, { x0: 131, y0: 95, x1: 200, y1: 118 }, { x0: 40, y0: 95, x1: 99, y1: 118 }];
const far = L.placeFirst(L.nameSpots(thing, 12, "Fridge", 6), 12, "Fridge", crowd, bounds);
ok("crowded close by: further out, on a leader line back to the thing", far && far.leader !== null, far);

// ── 2 · the 19′ 6″ "table" ────────────────────────────────────────────────────────────────────────────────────────
const room = { width_in: 360, depth_in: 480 };
const table = { x_in: 170, y_in: 330, rot: 0, w_in: 96, d_in: 36 };
const fp = V.footprint(table);
const gaps = L.wallGaps(fp, room);
ok("the community table as stored is 8′ × 3′", V.ftIn(96) === "8′" && V.ftIn(36) === "3′");
ok("its gaps to the walls are measured from its own edges", gaps.some((g) => g.side === "left" && g.len === fp.x0) && gaps.some((g) => g.side === "right" && g.len === room.width_in - fp.x1), gaps);
ok("the shortest gap first (the one most likely to matter)", gaps.every((g, i) => i === 0 || gaps[i - 1].len <= g.len));
ok("a thing against a wall draws no zero gap", L.wallGaps({ x0: 0, y0: 0, x1: 30, y1: 30 }, room).every((g) => g.len > 3));
const plan = read("components/vision/PlanView.tsx");
ok("the picked thing's label says its own size", /\$\{ftIn\(di\.w_in\)\} × \$\{ftIn\(di\.d_in\)\}/.test(plan));
ok("a gap is drawn as a gap: ticks at both ends, its own style, not the thing's colour", /className="gap"/.test(plan) && (plan.match(/className="gap"/g) ?? []).length >= 5 && /className="gapt"/.test(plan));
ok("a gap's length is placed clear of every other thing and every word", /at = \[\.\.\.others, \.\.\.obstacles, db\]/.test(plan) && /placeFirst\(dimSpots\([^)]*\), fs, t, at, view\)/.test(plan));

// ── 3 · wiring ────────────────────────────────────────────────────────────────────────────────────────────────────
ok("no numbers on the drawing", !/className="tag"/.test(plan) && !/tagt/.test(plan) && !/\{n \+ 1\}/.test(plan));
ok("a thing's spoken name has no number either", !/aria-label=\{`\$\{n \+ 1\}\./.test(plan));
ok("fit to the picked thing: a button and the S key", /title="Fit the picked thing \(S\)"/.test(plan) && /e\.key === "s"/.test(plan));
ok("the view is remembered per room for the session, and forgotten when it's fitted", /sessionStorage\.getItem\(memRef\.current\.key\)/.test(plan) && /sessionStorage\.removeItem\(memKey\)/.test(plan));
ok("…only when the room is the same size", /m\.W === w0 && m\.D === d0/.test(plan));
ok("picked from elsewhere and off screen: the plan slides to it (during render, not an effect)", /useChanged\(selected\)/.test(plan));
const studio = read("components/vision/StoreDesigner.tsx");
ok("the Schedule is found by typing", /type="search"/.test(studio) && /setFind/.test(studio));
ok("…and no longer numbered", !/lead=\{String\(n \+ 1\)\}/.test(studio));
const css = read("components/vision/studio.css");
ok("the red dimension style is gone; gaps are a quiet brown, the picked label dark with gold", !/\.dim\{stroke:#b82420/.test(css) && /\.gap\{stroke:#5a4a2c/.test(css) && /\.seltag \.lead\{stroke:#c8902f/.test(css));

const des = studio;
ok("the split is dragged, or moved with the arrow keys, a quarter to three quarters, and kept for the session", /role="separator"/.test(des) && /ArrowLeft/.test(des) && /Math\.min\(0\.75, Math\.max\(0\.25, v\)\)/.test(des) && /gt3\.studio\.split/.test(des));
ok("…set as a CSS variable, not an inline style", /style\.setProperty\("--sa"/.test(des) && /var\(--sa,1\.15fr\)/.test(css));
ok("the pane the hands are in is marked", /activePane === "plan" \? " active"/.test(des) && /\.vz-pane\.active\{box-shadow/.test(css));
ok("a phone stacks them — no divider", /view === "both" && size !== "phone" && \(\s*<div className="vz-divider"/.test(des));
const ev = read("components/vision/Evaluate.tsx");
ok("three lenses over one room: Design, Experience (the flow), Evaluate — one control", /label="Lens"/.test(des) && /const flowOn = lens === "experience"/.test(des) && /key: "evaluate"/.test(des));
ok("Evaluate: the Standard's serious findings first, then the plan reviewer, then what the change does to the plans", ev.indexOf("serious.map") < ev.indexOf("shown.map") && ev.indexOf("shown.map") < ev.indexOf("diff.says.map"));
ok("…the money effect is the engine's own roomDiff against the room as saved — nothing guessed from shape", /roomDiff\(saved, draft\)/.test(ev) && /an approved baseline doesn't move/.test(ev));
ok("…automated checks are said to be a first read, not a code review", /not a code review/.test(ev));
ok("…a finding can be set aside for the session, and brought back", /Set aside/.test(ev) && /set aside<\/button>|set aside`?\}?<\/button>|Show \{aside\.size\} set aside/.test(ev));
ok("…unjudged isn't passed, and a failed read isn't an all-clear", /unjudged isn&apos;t passed/.test(ev) && /this isn&apos;t an all-clear/.test(ev));
ok("an interrupted session: unsaved changes kept on the device, offered back only on top of the save they began from", /gt3\.studio\.draft\./.test(des) && /k\.base !== hashOf\(original\)/.test(des) && /Bring them back/.test(des));
ok("…bringing them back is one undoable step", /onClick=\{\(\) => \{ commit\(kept\.draft\)/.test(des));
const smoke = read("scripts/smoke.console.mjs");
ok("the phone check visits the Evaluate lens and runs the flow through Experience", /key: "vision-evaluate"/.test(smoke) && /clicks: \["The store", "Experience"\]/.test(smoke));
const D3 = loadTs("lib/vision3d.ts");
{
  const kinds = V.CATALOG.map((c) => c.kind);
  let outside = [], counts = {};
  for (const kind of kinds) for (const rot of [0, 90, 180, 270]) {
    const c = V.kindOf(kind);
    const it = { kind, rot, x_in: 100, y_in: 100, w_in: c.w, d_in: c.d, h_in: c.h };
    const b = V.footprint(it);
    const parts = D3.fixtureParts(it, b, 0, c.h, c.color);
    counts[kind] = parts.length;
    for (const p of parts) if (p[0] < b.x0 - 1e-6 || p[1] < b.y0 - 1e-6 || p[2] > b.x1 + 1e-6 || p[3] > b.y1 + 1e-6 || p[4] < -1e-6 || p[5] > c.h + 1e-6 || p[0] >= p[2] || p[1] >= p[3] || p[4] >= p[5]) outside.push([kind, rot, p]);
  }
  ok("every 3D part of every fixture, turned every way, sits inside its real footprint and height", outside.length === 0, outside.slice(0, 3));
  ok("a table is a top on four legs, a counter a body and a top, a fridge a body and a glass front, shelving has shelves", counts.community === 5 && counts.order_counter === 2 && counts.reach_in === 2 && counts.storage >= 4, counts);
  ok("everything else stays one box, as before", counts.column === 1 && counts.door === 1);
}
ok("a phone: the lens sits in the dock when nothing is picked — upright full screen as the dock row (view, Flow, findings, Add; IMS3) — so the bar is one row and the drawing keeps its height", /\{upright \? uprightRow : size === "phone" && !side && lensControl\}/.test(des) && /\{\(size !== "phone" \|\| side\) && !upright && lensControl\}/.test(des) && /stats && size !== "phone"/.test(des));
ok("a phone on its side opens full screen too, the dock beside the plan", /\(size === "phone" \|\| short\)/.test(des) && /\.vz-studio\.short\.full \.vz-stage\.docked\{flex-direction:row\}/.test(css));
const P = loadTs("lib/pillarFacts.ts"), STD = loadTs("lib/standard.ts");
{
  const room = { width_in: 360, depth_in: 480, items: [
    { kind: "door", pillars: [] }, { kind: "community", pillars: [] }, { kind: "window_wall", pillars: [] }, { kind: "hand_sink", pillars: [] }, { kind: "prep_counter", pillars: [] },
  ].map((x, i) => ({ id: String(i), label: null, x_in: 0, y_in: 0, rot: 0, w_in: 10, d_in: 10, h_in: 10, why: null, sort: i, ...x })) };
  const facts = P.pillarFacts(room, [{ ids: ["1"], level: "warn", words: "20 in between A and B — an aisle needs 36" }]);
  ok("every pillar has its facts, each tagged with where it comes from", ["movement", "stillness", "light", "fuel"].every((p) => facts.some((f) => f.pillar === p)) && facts.every((f) => ["drawn", "simulated", "standard", "unknown"].includes(f.source)));
  ok("the drawing's counts are said as drawn", /1 door; 1 tight spot under 36 in/.test(facts.find((f) => f.pillar === "movement" && f.source === "drawn").text) && /8 seats/.test(facts.find((f) => f.pillar === "stillness").text), facts.map((f) => f.text));
  ok("light levels and sound are unknown, never guessed from the drawing", facts.some((f) => f.pillar === "light" && f.source === "unknown") && facts.some((f) => f.pillar === "stillness" && f.source === "unknown"));
  ok("the flow is said to be simulated", facts.some((f) => f.source === "simulated" && /model, not a count/.test(f.text)));
  ok("no fact makes a health or toxicity claim", facts.every((f) => !STD.isProhibited(f.text) && !/healthy|safe|toxic/i.test(f.text)));
}
ok("Evaluate shows the room by pillar, folded, after the serious findings", /The room by pillar/.test(ev) && ev.indexOf("diff.says.map") < ev.indexOf("The room by pillar") && /<details/.test(ev));
ok("the picked thing's quick bar stands clear of its label as well as the thing", /const tb = labels\.tag\?\.box \?\? null/.test(plan) && /Math\.min\(sb\.y0, tb\.y0\)/.test(plan));
ok("gap lengths and the picked label share one typeface (one way of writing feet and inches)", /\.gapt\{font-family:var\(--sans\)/.test(css));
ok("a quiet save status in the tooltip: the time of the last save, and that unsaved changes are kept on the device", /title=\{busy \? "Saving…" : dirty && saveFailed \? `\$\{saveFailed\} — your changes are kept on this device\. Retry\.` : dirty \? "Unsaved changes — save\. Until you do, they're kept on this device" : savedAt \? `Saved at/.test(des));
ok("…while the button's spoken name stays one word — Save or Saved (voice control says it)", /aria-label=\{busy \? "Saving" : dirty && saveFailed \? "Couldn't save · Retry" : dirty \? "Save" : "Saved"\}/.test(des));
ok("a drawn count or a pointer to the Standard is never tinted as a pass; unknown carries the warning tint", /f\.source === "unknown" \? "k-tag warn" : f\.source === "simulated" \? "k-tag gold" : "k-tag"/.test(ev) && !/"k-tag ok"\}>\{SOURCE_WORD/.test(ev));
console.log(`S1.1b — THE STUDIO, SECOND PASS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
