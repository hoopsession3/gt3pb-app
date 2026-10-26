// R53 — EVERY WAY IN, ON EVERY SCREEN (2026-10-25 — Ryan: "allow for the brick and mortar to have phases… a bar that's
// rented out from a gym… lease versus buy… partnering with a coffee shop… multiple plans built out and saved… each plan
// its own database record"; "be amazing on iPad Pro, iPad… and desktop"). Phase A of the investor-ready vision.
//
//   1 · lib/visionPlans: the formats (no room on a partner's menu), the phases in order, what a plan still waits on (a
//       plan gone ahead no longer holds anything up), a loop of waits found before the database refuses it, needs done
//       and late, the side-by-side asking every plan the same questions, a room sized from square feet.
//   2 · lib/visionRead: a plan, a need and a wait read from a row and from a link; before 0448 the plans are absent, not
//       an error (plansReady false).
//   3 · Shares: a link's state — off, ended, live, and when it ends.
//   4 · The wiring: the Plans tab, the roadmap's "ways in", an ask "For" a plan, the presenter's ways-in slide drawn at
//       the top of the document (no frame holds it in), the vision on the desk from 1,024 wide in landscape, the drafting
//       table's three columns, and the device check's iPads (both ways up, Split View) and desktop.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const P = loadTs("lib/visionPlans.ts");
const plan = (id, phase, extra = {}) => ({ id, program_id: "s", name: id, format: "gym_bar", phase, status: "exploring", sqft: null, deal: "tbd", place: null,
  summary: null, why: null, gate: null, layout_id: null, shareable: false, sort: 0, ...extra });

// ── 1 · lib/visionPlans ─────────────────────────────────────────────────────────────────────────────────────────────
{
  ok("eight ways in, each with a name and a mark", P.FORMATS.length === 8 && P.FORMATS.every((f) => P.FORMAT[f].name && P.FORMAT[f].mark));
  ok("a partner's menu has no room of ours; a gym bar and a storefront do", !P.FORMAT.partner_menu.room && P.FORMAT.gym_bar.room && P.FORMAT.storefront_lease.room);
  ok("the formats match 0448's check, word for word", (() => { const sql = read("supabase/migrations/0448_a_plan_for_every_way_in.sql"); return P.FORMATS.every((f) => sql.includes(`'${f}'`)) && P.DEALS.every((d) => sql.includes(`'${d}'`)) && P.PLAN_STATUSES.every((x) => sql.includes(`'${x}'`)) && P.NEED_KINDS.every((k) => sql.includes(`'${k}'`)); })());
  ok("no espresso among the ways in", !JSON.stringify(P.FORMAT).match(/espresso/i));

  const ps = [plan("store", 3), plan("gym", 1, { sort: 2 }), plan("kiosk", 1, { sort: 1 }), plan("cafe", 2)];
  const ph = P.phases(ps);
  ok("phases in order, and within a phase, their order", ph.map((x) => x.phase).join() === "1,2,3" && ph[0].plans.map((p) => p.id).join() === "kiosk,gym", ph.map((x) => [x.phase, x.plans.map((p) => p.id)]));

  const deps = [{ plan_id: "store", needs_plan_id: "gym" }, { plan_id: "store", needs_plan_id: "cafe" }];
  ok("the storefront waits on the gym bar and the café — nearest phase first", P.waitingOn(ps[0], ps, deps).map((p) => p.id).join() === "gym,cafe");
  const goneAhead = ps.map((p) => (p.id === "gym" ? { ...p, status: "live" } : p));
  ok("…a plan gone ahead (live or go) no longer holds it up", P.waitingOn(goneAhead[0], goneAhead, deps).map((p) => p.id).join() === "cafe");
  ok("a loop of waits is found before the database refuses it", P.wouldLoop(deps, "gym", "store") && P.wouldLoop([...deps, { plan_id: "cafe", needs_plan_id: "kiosk" }], "kiosk", "store") && P.wouldLoop(deps, "gym", "gym"));
  ok("…and a wait that isn't a loop isn't", !P.wouldLoop(deps, "gym", "kiosk") && !P.wouldLoop(deps, "store", "kiosk"));

  const past = "2020-01-01", future = "2999-01-01";
  const n = P.needsProgress([
    { plan_id: "g", label: "Site", kind: "site", owner: null, due_on: past, done_on: null, note: null, sort: 1 },
    { plan_id: "g", label: "Permit", kind: "permit", owner: null, due_on: future, done_on: null, note: null, sort: 2 },
    { plan_id: "g", label: "Terms", kind: "partner", owner: null, due_on: null, done_on: past, note: null, sort: 3 },
  ]);
  ok("needs: 1 of 3 done, 1 late, the next is the earliest due", n.done === 1 && n.all === 3 && n.late === 1 && n.next.label === "Site", n);
  ok("no needs: nothing next", P.needsProgress([]).next === null);

  const rows = P.compareRows([plan("gym", 1, { sqft: 400, deal: "rev_share" }), plan("store", 3, { format: "storefront_lease", sqft: 1200, deal: "lease" })],
    { layouts: [], asks: [{ program_id: "s", plan_id: "store", label: "Build-out", amount_cents: 0, state: "open", note: null, sort: 1 }], needs: [], deps, all: ps });
  const row = (l) => rows.find((r) => r.label === l);
  ok("side by side: every plan asked the same questions", rows.length === 11 && rows.every((r) => r.cells.length === 2), rows.map((r) => r.label));
  ok("…the rows that differ are marked, the same ones aren't", row("Size").differs && row("Deal").differs && !row("Where").differs, rows.map((r) => [r.label, r.differs]));
  ok("…an ask with no amount says it's being priced, never $0", row("Capital asked").cells[1] === "Being priced" && row("Capital asked").cells[0] === "None asked", row("Capital asked").cells);
  ok("…a gate not set says so", row("Goes when").cells[0] === "Gate to be set");
  ok("a room sized from square feet: 3 : 4, whole feet, close to the size asked", (() => { const r = P.roomFor(1200); const ft = (r.width_in * r.depth_in) / 144; return r.width_in % 12 === 0 && r.depth_in % 12 === 0 && Math.abs(ft - 1200) / 1200 < 0.05 && r.depth_in > r.width_in; })(), P.roomFor(1200));
  ok("…and inside the designer's limits, however small or large", P.roomFor(10).width_in === 96 && P.roomFor(500000).depth_in === 2400 && P.roomFor(null).width_in === 360);
}

// ── 2 · lib/visionRead ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const src = read("lib/visionRead.ts");
  // 0448 is applied (2026-10-25): the fallback is retired (R58) — the plans are always read, and a failure is said.
  ok("0448 is in: the plans are always read, and a failed read is an error, not an empty plan", /plansReady: true/.test(src) && /if \(planErr\) throw new Error/.test(src));
  ok("a link's plans come with their needs and waits, and say when it ends", /waits_on/.test(src) && /expiresAt: j\.expires_at/.test(src));
}

// ── 3 · Shares ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const src = read("components/vision/Shares.tsx");
  ok("a new link can end (7, 30, 90 days) — 0448 is in, so every link can", /days: 30/.test(src) && /const canEnd = true/.test(src));
  ok("a link's state: off, ended, live — and when it ends", /word: "Ended"/.test(src) && /ends in \$\{days\} days/.test(src));
}

// ── 4 · the wiring ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const app = read("components/vision/VisionApp.tsx"), road = read("components/vision/Roadmap.tsx"), pres = read("components/vision/Present.tsx");
  const des = read("components/vision/StoreDesigner.tsx"), surf = read("lib/surfaces.ts"), smoke = read("scripts/smoke.console.mjs");
  ok("the Plans tab, between the roadmap and the store", /key: "plans", label: "Plans"/.test(app) && /<Plans /.test(app));
  ok("a plan's room opens in the store on that room", /openStore/.test(app) && /initialId=\{room\}/.test(app));
  ok("the roadmap: a program's ways in, and an ask \"For\" a plan", /way in" : "ways in"/.test(road) && /<span>For<\/span>/.test(road) && /plan_id: r\.plan \|\| null/.test(road));
  ok("the presenter: a ways-in slide, drawn at the top of the document", /kind: "ways"/.test(pres) && /createPortal\(/.test(pres) && /document\.body/.test(pres));
  ok("the vision is on the desk from 1,024 wide in landscape", /p === "\/vision" \|\| p\.startsWith\("\/vision\/"\)/.test(surf));
  // S1 (the studio) lays the drafting table out by the studio's own width, not the screen's: scripts/s1.test.mjs.
  ok("the drafting table: library, room, inspector — three columns wide, two on an iPad upright (S1: by the studio's width)", /useStudioSize\(\)/.test(des) && /\.vz-studio\.wide\.lib \.vz-work\{grid-template-columns:240px minmax\(0,1fr\) 320px\}/.test(read("components/vision/studio.css")) && /\.vz-studio\.mid \.vz-work\{grid-template-columns:minmax\(0,1fr\) 300px\}/.test(read("components/vision/studio.css")));
  ok("…the plan and the 3D side by side when the studio is wide enough", /\.vz-studio:not\(\.phone\) \.vz-store\.both\{grid-template-rows:none;grid-template-columns:minmax\(0,1\.15fr\) minmax\(0,1fr\)\}/.test(read("components/vision/studio.css")));
  ok("the device check: iPads both ways up, in Split View, and a desktop", ["ipad-11", "ipad-11-side", "ipad-13", "ipad-13-side", "ipad-split-half", "ipad-split-two-thirds", "desktop"].every((k) => smoke.includes(`key: "${k}"`)));
  ok("the column gate reads a later pending migration's added column on a pending table (0448's expires_at on 0447's links)",
    /at === undefined \|\| at < born/.test(read("scripts/columns.audit.mjs")));
  ok("a status's tag class is written whole", /const TAG = \{ "": "k-tag", ok: "k-tag ok"/.test(read("components/vision/Plans.tsx")));
  ok("…and it visits the plans, the side by side, a plan's sheet and the ways-in slide", ["vision-plans", "vision-compare", "vision-plan-sheet", "vision-ways"].every((k) => smoke.includes(`key: "${k}"`)));
}

console.log(`R53 — EVERY WAY IN, ON EVERY SCREEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
