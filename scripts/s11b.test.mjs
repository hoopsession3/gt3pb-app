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
ok("a gap's length is placed clear of every other thing and every word", /placeFirst\(dimSpots\([^)]*\)[^;]*\[\.\.\.others, \.\.\.obstacles, db\]/.test(plan));

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

console.log(`S1.1b — THE STUDIO, SECOND PASS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
