// DESIGN, AS A RATCHET — the stylesheet's drift and the Plan screen's box depth, measured.
//
//   node scripts/design.ratchet.mjs          # fail if anything got worse, or a ceiling sits slack
//   node scripts/design.ratchet.mjs --list   # the raw radius values and duplicate selectors, named
//
// ── WHY (2026-10-01) ─────────────────────────────────────────────────────────────────────────────
// Ryan, three phone screenshots of Plan › Calendar: "boxes inside boxes, this just looks eww,
// 5/10, audit for proper design, raise our standards, no regression." Measured, that screen had
// rows at box-depth FOUR (a focus ring around the whole screen, a card, a bordered list inside
// the card, the row) and the stylesheet behind it had 820 rules that each make a card and 44
// different corner radii — two radius token scales plus 44 raw pixel values beside them. None of
// that was a decision; it is what 8,000 lines accumulate when nothing counts them.
//
// This does not clean it up. It stops it growing, the same way scripts/lint.ratchet.mjs holds the
// 261 lint problems: every number here may fall freely and may not rise, and a ceiling left above
// the real count is itself a failure, because slack is room for new debt. Lower a ceiling when
// you earn it. Raising one needs a reason in the commit message.
//
// TWO KINDS OF MEASUREMENT, because the stylesheet and the painted result are different things:
//   · STATIC — counts over app/globals.css. Cheap, exact, and blind to whether a rule ever matches.
//   · PAINTED — scripts/fixtures/plan-screen.html rendered in Chromium at phone width and read with
//     scripts/design.measure.mjs: how deep the boxes nest, whether the section body paints a
//     focus frame, how much of the width the rail covers, the smallest text in the agenda. The
//     fixture is a class-for-class double of the real screen (the console needs a session this
//     script does not have), so it names its sources and this script FAILS if a class it uses has
//     left the file it claims to come from — a double that drifts must say so.
//
// A FAILED READ IS NOT A PASS. No Chromium, no fixture, an unparseable stylesheet: NOT CHECKED and
// exit 1, never a quiet green.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = join(ROOT, "app/globals.css");
const FIXTURE = join(ROOT, "scripts/fixtures/plan-screen.html");
// A second double, same rules (2026-10-03): the brew sheet, after Ryan scored it 5/10 from his
// phone. Its own ceilings: depth 4 is the kit's segmented control (a filled option inside its
// bordered track, inside the sheet); 31 px is the house chip (.ts-chip) — every chip in the
// console is that height, and raising it is a decision for all of them, not a side effect here.
const BREW_FIXTURE = join(ROOT, "scripts/fixtures/brew-sheet.html");
export const BREW_SHEET = { depth: 4, tap: 31, text: 10.5 };
// The event record sheet with its ways out (2026-10-03). Depth 6 is the box inside the finding
// inside the gaps block inside the sheet — an honest nesting, since the finding IS the form. The
// floor that matters is the tap: 44, because the box these controls share with OwnerDetails
// measured 31px before the sheets started drawing it.
const RECORD_FIXTURE = join(ROOT, "scripts/fixtures/record-sheet.html");
export const RECORD_SHEET = { depth: 6, tap: 44, text: 10.5 };
const SHEETS = [
  { name: "brew sheet",   file: BREW_FIXTURE,   rel: "scripts/fixtures/brew-sheet.html",   limits: BREW_SHEET },
  { name: "record sheet", file: RECORD_FIXTURE, rel: "scripts/fixtures/record-sheet.html", limits: RECORD_SHEET },
];
// The crew console's bottom chrome (2026-10-04): the nav, the floating tier, the rail. Not a depth
// or a tap floor — a COLLISION check, because the defect was a button painted on top of a tab.
const CHROME_FIXTURE = join(ROOT, "scripts/fixtures/crew-chrome.html");
/** Four phone states: no inset and an iPhone's 34px home-indicator inset, rail docked and folded. */
export const CHROME_STATES = [
  { inset: 0, rail: "docked" }, { inset: 0, rail: "folded" },
  { inset: 34, rail: "docked" }, { inset: 34, rail: "folded" },
];
/** The floating tier keeps at least this much air above the chrome (it is set to 16). */
export const CHROME_CLEARANCE = 8;

// ── THE CEILINGS — measured, not remembered (2026-10-01, after the one-box-per-level pass) ───────
export const CEILING = {
  cardRules: 817,        // rules that make a card: radius + (border | fill). 818 → 817: the account sheet lost its stat tiles (2026-10-02)
  rawRadii: 27,          // distinct border-radius values that are not a --r-* token, 50% or 0
  dupSelectors: 54,      // single top-level selectors declared more than once (55 → 54: .crew-group retired, 2026-10-02)
  rootBlocks: 1,         // separate `:root{` blocks — tokens have one home (6 → 1 on 2026-10-02: motion, spring, eyebrow tracking, color-scheme and the radius scale folded in)
  subFloorFontRules: 0,  // px font-sizes under THE TYPE FLOOR (10px, see the note in globals.css). 184 → 0 on 2026-10-02
  selectShorthands: 0,   // rules on a <select> that paint with the `background` SHORTHAND. It resets background-repeat, and the chevron the app draws on every select then tiles across it — stripes, in the day theme, on every select whose container had one (Ryan's brew sheet, 2026-10-03). 19 → 0: colour is background-color.
  maxLeafDepth: 2,       // boxes around the innermost box on the Plan screen (was 4)
  railAreaFraction: 0.066, // expanded rail as a share of a 390×844 viewport — a 48px row plus 8px of air above the nav, in the layout flow (2026-10-02). Width used to be the number (0.46 → 0.27 → a bar); area is what a toolbar can be held to
  railCoversFixed: 0,      // fixed-position buttons the expanded rail sits on top of
};
// ── FRICTION, counted in the source (2026-10-02) ──────────────────────────────────────────────────
// Three things a viewer meets as friction and a grep can see:
//   nativeDialogs   — window.confirm()/prompt() calls: an unstyled OS dialog titled "app.gt3pb.com
//                     says", blocking the page, un-swipeable. The house replacements exist
//                     (components/ConfirmSheet.tsx, components/PromptSheet.tsx); this is the count
//                     still to migrate. 63 before the first five moved.
//   crewGroupTitles — `className="crew-group"` section titles: the SECOND way this app titles a
//                     section beside <SectionHeader> (91 uses), and it is defined twice in the
//                     stylesheet with different type. One idiom, one home; this may only fall.
//   collapsedPanels — <Panel> without defaultOpen: 34 accordions closed at rest, the "accordion
//                     wall" the Money section opens on. Whether to open some is Ryan's call; that
//                     no new ones appear without a decision is this gate's.
export const FRICTION = {
  nativeDialogs: 0,
  crewGroupTitles: 0,
  collapsedPanels: 34,   // 33 → 34 on 2026-10-02: Settings › Advanced › Errors — the reading end of the error intake, closed at rest like its neighbours
};

export function frictionCounts(read = (p) => readFileSync(join(ROOT, p), "utf8"), list = (d) => readdirSync(join(ROOT, d), { recursive: true })) {
  const files = [];
  for (const dir of ["components", "app"]) for (const f of list(dir)) if (/\.tsx$/.test(String(f))) files.push(`${dir}/${f}`);
  let nativeDialogs = 0, crewGroupTitles = 0, collapsedPanels = 0;
  for (const f of files) {
    let src; try { src = read(f); } catch { continue; }
    // comments stripped first — three gates in scripts/smoke.cjs matched their own prose once
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
    // The house hook is also called `confirm`, and is always awaited; a native confirm() never is.
    nativeDialogs += (code.match(/(?<![\w.])(?<!await\s+)(window\.)?(confirm|prompt)\(/g) || []).length;
    crewGroupTitles += (code.match(/className="crew-group/g) || []).length;
    for (const m of code.matchAll(/<Panel\b([^>]*)>/g)) if (!/defaultOpen/.test(m[1])) collapsedPanels++;
  }
  return { nativeDialogs, crewGroupTitles, collapsedPanels };
}

export const FLOOR = {
  minAgendaFontPx: 11,   // smallest text in the agenda list (was 9.5)
};

// ── WHAT MOVES AFTER IT IS PAINTED (2026-10-02) ─────────────────────────────────────────────────
// Measured on production at 390px, as a guest, before anything was fixed: on 19 of 23 routes the
// only movement was the bottom nav's three shared tabs sliding one slot left a quarter second in
// (0.0087 — the server painted the member shape, the client re-shaped it for a guest); on /reserve
// and /shop the order funnel jumped up 164px a second in (0.14 and 0.12 — a 150px card skeleton
// standing in for a section that is almost always empty). Both fixed the same day
// (components/BottomNav.tsx, components/Reserves.tsx). What is left is the settling every page does
// — a web font landing, a chips row arriving with its data — 0.000 to 0.015 on a route, and it
// varies run to run with the network, so this one is a GATE with a margin and not a per-route
// ratchet: a ratchet on a number that moves on its own is a flake generator, and a Reserves-class
// regression is an order of magnitude above the margin.
//   chrome — a nav tab, the cart bar or the rail moved: the one thing a thumb relies on. Exact 0.
//   total  — the page's own layout-shift score. 0.04 is three times the settling ever measured and
//            a third of Google's "poor" line.
export const SHIFT = {
  chrome: 0,
  total: 0.04,
};

// ── EVERY PUBLIC ROUTE, AT PHONE WIDTH — read by scripts/smoke.ui.mjs ───────────────────────────
// Measured 2026-10-02 after the first pass, with the splash dismissed (the splash is a finding of
// its own, not the page). Three numbers a route may not get worse on:
//   depth — boxes around the innermost box (ceiling)
//   tap   — the smallest interactive target's short side, px (floor)
//   text  — the smallest visible text, px (floor)
// A route not in this table is UNMEASURED and fails the smoke: add it with its real numbers.
// The masthead caption was 8.5 everywhere and is 11 now (Ryan's call, 2026-10-02: app text at the
// floor until a horizontal lockup is supplied). The same day, every rule under 10px in the
// stylesheet was lifted to 10 (THE TYPE FLOOR, globals.css) and every route re-measured: none is
// under 10 now, /display included — its text is in vmin for a TV, and on a phone its smallest tier
// used to resolve to 6.63px; max(10px, …) on those tiers is what brought it to 10. 26 is the folded
// rail handle, 26 wide by 56 tall. /playbook's null: owner-only, and a guest's body paints no text to measure.
// Floors say "not smaller than this", not "this is fine".
export const ROUTE = {
  "/":              { depth: 2, tap: 26, text: 10 },
  "/truck":         { depth: 2, tap: 26, text: 10 },
  "/events":        { depth: 2, tap: 26, text: 10 },
  "/menu":          { depth: 2, tap: 26, text: 10 },
  "/reserve":       { depth: 2, tap: 26, text: 10 },
  "/delivery":      { depth: 1, tap: 26, text: 10 },
  "/3mpire":        { depth: 2, tap: 26, text: 10 },
  "/craft":         { depth: 2, tap: 26, text: 10 },
  "/book":          { depth: 1, tap: 26, text: 10 },
  "/shop":          { depth: 2, tap: 26, text: 10 },
  "/primal":        { depth: 1, tap: 26, text: 10 },
  "/office":        { depth: 1, tap: 26, text: 10 },
  "/academy":       { depth: 0, tap: 26, text: 11 },
  "/scan":          { depth: 0, tap: 26, text: 10 },
  "/architecture":  { depth: 0, tap: 26, text: 10 },
  "/playbook":      { depth: 0, tap: 26, text: null },
  "/driver":        { depth: 0, tap: 26, text: 32 },
  "/agreement":     { depth: 1, tap: 26, text: 11 },
  "/offer":         { depth: 1, tap: 26, text: 11 },
  "/built/gt3-built-k7m9x4q2": { depth: 1, tap: 34, text: 10 },
  "/display":       { depth: 1, tap: 26, text: 10 },
  "/privacy":       { depth: 0, tap: 26, text: 14 },
  "/terms":         { depth: 0, tap: 26, text: 14 },
};

// ── THE SAME ROUTES, ON PRODUCTION, WITH DATA — read by scripts/verify.prod.mjs ─────────────────
// ROUTE above is measured against a build with no database: for a data-driven route that is the
// EMPTY state. This table is the populated one, measured on app.gt3pb.com at 390px after the
// 2026-10-02 deploy (8ac6bf9). The seven that differ are real: a lesson card with its FREE pill
// is a box in a box the empty /primal never shows; /delivery's Pickup/Delivery choice is one;
// the sign-in wall on /academy, /playbook and /driver is a box the guest build renders as nothing.
// /3mpire measures SHALLOWER with data (1, not 2): the empty state's placeholder card is gone.
// Two tables, two subjects — the same reason the fixture is measured in two themes.
export const PROD_ROUTE = {
  "/":              { depth: 2, tap: 26, text: 10 },
  "/truck":         { depth: 2, tap: 26, text: 10 },
  "/events":        { depth: 2, tap: 26, text: 10 },
  "/menu":          { depth: 2, tap: 26, text: 10 },
  "/reserve":       { depth: 2, tap: 26, text: 10 },
  "/delivery":      { depth: 2, tap: 26, text: 10 },
  "/3mpire":        { depth: 1, tap: 26, text: 11 },
  "/craft":         { depth: 2, tap: 26, text: 10 },
  "/book":          { depth: 1, tap: 26, text: 10 },
  "/shop":          { depth: 2, tap: 26, text: 10 },
  "/primal":        { depth: 2, tap: 26, text: 10 },
  "/office":        { depth: 1, tap: 26, text: 11 },
  "/academy":       { depth: 1, tap: 26, text: 11 },
  "/scan":          { depth: 0, tap: 26, text: 10 },
  "/architecture":  { depth: 0, tap: 26, text: 10 },
  "/playbook":      { depth: 1, tap: 26, text: 11 },
  "/driver":        { depth: 1, tap: 26, text: 11 },
  "/agreement":     { depth: 1, tap: 26, text: 11 },
  "/offer":         { depth: 1, tap: 26, text: 11 },
  "/built/gt3-built-k7m9x4q2": { depth: 1, tap: 34, text: 10 },
  "/display":       { depth: 1, tap: 26, text: 10 },
  "/privacy":       { depth: 0, tap: 26, text: 14 },
  "/terms":         { depth: 0, tap: 26, text: 14 },
};

// ── WEIGHT — what a phone downloads for each route, cold, from the local build (KB on the wire) ──
// Measured by scripts/smoke.ui.mjs on 2026-10-02 after the shell stopped carrying the console's
// dock, copilot, palette, nav and the task sheet into every guest's bundle: the script chunks the
// document references (not the noModule polyfill, which a modern phone never requests, and not
// what the router prefetches for the nav's links afterwards), gzipped; the stylesheets; the chunk
// count. A route may get lighter; it may not get heavier; and a ceiling more than 3 KB above the
// real number is slack and fails too — bytes move by a few hundred with any edit, so the dead-band
// is what keeps this from crying wolf. Not here on purpose: images (content, not code) and fonts
// (the same files on every route).
// 2026-10-03: /privacy and /terms 257 → 258. +148 bytes raw in the shell chunk — BottomNav renders
// both identity tabs and corrects the viewer hint (THE NAV THAT MOVED UNDER YOUR THUMB) — which
// crossed the rounding line on the two lightest routes and nowhere else. The cost of a nav that
// does not move is 148 bytes; written down here so the next kilobyte has to be, too.
// 2026-10-03: /, /menu, /architecture, /offer +1 — +249 bytes raw (102 gzipped) in AuthProvider's
// chunk for the front door's cookie writer (lib/viewerHint.ts, proxy.ts), which tipped the four
// routes that were sitting within 102 bytes of a rounding line. Measured, not estimated: 274 892 →
// 274 994 bytes gzipped on /menu.
// 2026-10-03: /truck, /events, /driver css 102 → 103 — +302 bytes gzipped (104 835 → 105 137 on
// /truck) for the brew sheet's styles (.bq-*) net of the .bsz rules they replaced; the three routes
// that share the second stylesheet sat 0.12 KB under the line. /menu moved the same 342 bytes and
// stayed at 100.
// 2026-10-04: /playbook 276 → 277. +147 bytes gzipped in the shell chunk on every route — the
// floating tier's dock in AppShell and the folded rail's inset-aware bottom in FloatRail (THE
// FLOATING TIER SITS ON THE CHROME) — which tipped the one route sitting 0.06 KB under a rounding
// line (283 073 → 283 220 bytes). /truck and /events +372 (the road rule from lib/road, which the
// public page now shares with the crew's Live truck panel) and stayed at 284; every stylesheet
// −35. Measured against a build of c846e47, route by route, not estimated.
export const WEIGHT = {
  "/truck":                    { js: 284, css: 103, chunks: 16 },
  "/events":                   { js: 284, css: 103, chunks: 16 },
  "/menu":                     { js: 269, css: 100, chunks: 16 },
  "/reserve":                  { js: 291, css: 100, chunks: 17 },
  "/delivery":                 { js: 290, css: 100, chunks: 17 },
  "/3mpire":                   { js: 284, css: 100, chunks: 16 },
  "/craft":                    { js: 268, css: 100, chunks: 16 },
  "/book":                     { js: 268, css: 100, chunks: 16 },
  "/academy":                  { js: 316, css: 100, chunks: 16 },
  "/office":                   { js: 277, css: 100, chunks: 16 },
  "/scan":                     { js: 260, css: 100, chunks: 15 },
  "/architecture":             { js: 270, css: 100, chunks: 15 },
  "/playbook":                 { js: 277, css: 100, chunks: 16 },
  "/driver":                   { js: 280, css: 103, chunks: 16 },
  "/agreement":                { js: 267, css: 100, chunks: 15 },
  "/offer":                    { js: 277, css: 100, chunks: 15 },
  "/built/gt3-built-k7m9x4q2": { js: 259, css: 100, chunks: 15 },
  "/display":                  { js: 260, css: 100, chunks: 15 },
  "/shop":                     { js: 297, css: 100, chunks: 17 },
  "/primal":                   { js: 269, css: 100, chunks: 16 },
  "/privacy":                  { js: 258, css: 100, chunks: 14 },
  "/terms":                    { js: 258, css: 100, chunks: 14 },
  "/":                         { js: 275, css: 100, chunks: 16 },
};

export function weightVerdict(path, w, row = WEIGHT[path]) {
  if (!row) return [`${path}: no weight recorded — add it to WEIGHT in scripts/design.ratchet.mjs with its real numbers.`];
  const out = [];
  for (const k of ["js", "css"]) {
    if (w[k] > row[k]) out.push(`${path}: ${k} ${w[k]} KB — ceiling ${row[k]} KB. Heavier. Something new rides in this route's bundle; a lazy import is usually the fix.`);
    else if (w[k] < row[k] - 3) out.push(`${path}: ${k} ${w[k]} KB — ceiling ${row[k]} KB sits above it. Good; now lower the ceiling to ${w[k]}.`);
  }
  if (w.chunks > row.chunks) out.push(`${path}: ${w.chunks} chunks — ceiling ${row.chunks}. More.`);
  else if (w.chunks < row.chunks) out.push(`${path}: ${w.chunks} chunks — ceiling ${row.chunks} sits above it. Good; now lower the ceiling to ${w.chunks}.`);
  return out;
}

/** Compare one route's measurement to its row. Returns the failures (empty = clean). */
export function routeVerdict(path, m, row = ROUTE[path]) {
  if (!row) return [`${path}: no ceiling recorded — an unmeasured route is not a clean one. Add it to ROUTE in scripts/design.ratchet.mjs with its real numbers.`];
  const out = [];
  const up = (name, v, c) => out.push(`${path}: ${name} ${v} — ceiling ${c}. Up.`);
  const slack = (name, v, c) => out.push(`${path}: ${name} ${v} — ceiling ${c} sits above it. Good; now lower the ceiling to ${v}.`);
  if (m.maxLeafDepth > row.depth) up("box depth", m.maxLeafDepth, row.depth); else if (m.maxLeafDepth < row.depth) slack("box depth", m.maxLeafDepth, row.depth);
  if (m.smallestTap !== null) {
    if (m.smallestTap < row.tap) out.push(`${path}: smallest tap target ${m.smallestTap}px (${m.smallestTapWhat}) — floor ${row.tap}px. Smaller.`);
    else if (m.smallestTap > row.tap) out.push(`${path}: smallest tap target ${m.smallestTap}px — floor ${row.tap}px sits below it. Good; now raise the floor to ${m.smallestTap}.`);
  }
  if (row.text !== null && m.smallestText !== null) {
    if (m.smallestText < row.text) out.push(`${path}: smallest text ${m.smallestText}px (${m.smallestTextWhat}) — floor ${row.text}px. Smaller.`);
    else if (m.smallestText > row.text) out.push(`${path}: smallest text ${m.smallestText}px — floor ${row.text}px sits below it. Good; now raise the floor to ${m.smallestText}.`);
  }
  if (m.shift) {
    const what = m.shift.worst ? ` (biggest: ${m.shift.worst.v} at ${m.shift.worst.t}ms — ${m.shift.worst.src})` : "";
    if (m.shift.chrome > SHIFT.chrome) out.push(`${path}: the nav, cart bar or rail moved after paint — shift ${m.shift.chrome}${what}. Fixed chrome never moves.`);
    if (m.shift.total > SHIFT.total) out.push(`${path}: layout shift ${m.shift.total} — gate ${SHIFT.total}${what}. Something is painted, then pushed.`);
  }
  return out;
}

// ── STATIC ───────────────────────────────────────────────────────────────────────────────────────
export function staticCounts(css) {
  // Rule blocks, crudely: selector { body }. Nested at-rules are flattened by the regex, which is
  // fine for counting declarations; it is not a parser and does not need to be.
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  let cardRules = 0;
  const radii = new Map();
  const seen = new Map();
  for (const [sel, body] of blocks) {
    if (!sel.startsWith(".") && !sel.startsWith(":root")) continue;
    const radius = body.match(/border-radius\s*:\s*([^;]+)/);
    const bordered = /(^|;)\s*border(-top|-left|-right|-bottom)?\s*:\s*[^;]*\b(solid|dashed)\b/.test(body);
    const filled = /(^|;)\s*background(-color)?\s*:/.test(body);
    if (radius && (bordered || filled)) cardRules++;
    if (radius) {
      const v = radius[1].trim();
      if (!/^var\(--r-/.test(v) && v !== "50%" && v !== "0" && v !== "0px") radii.set(v, (radii.get(v) || 0) + 1);
    }
    if (sel.startsWith(".") && !sel.includes(",")) seen.set(sel, (seen.get(sel) || 0) + 1);
  }
  const dups = [...seen].filter(([, n]) => n > 1);
  const rootBlocks = (css.match(/^:root\s*\{/gm) || []).length;
  // THE TYPE FLOOR. Comments stripped first — the note that explains the floor quotes the sizes it
  // retired. font-size:0 is the icon-whitespace trick, not text; max(10px, …) is the floor itself.
  const subFloorFontRules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/font-size\s*:\s*(\d*\.?\d+)px/g)]
    .map((m) => parseFloat(m[1])).filter((v) => v > 0 && v < 10).length;
  // A <select> painted with the `background` shorthand. The shorthand resets background-repeat
  // (and -image and -position), and the chevron rule at the end of the file sets those at a
  // specificity a `.app.crew-day .x select{background:…}` beats — so the arrow tiles across the
  // control. Only the shorthand is counted; background-color is the honest way to colour one.
  let selectShorthands = 0;
  for (const [sel, body] of blocks) {
    if (!/\bselect\b/.test(sel.replace(/\/\*[\s\S]*?\*\//g, ""))) continue;
    if (/(^|;)\s*background\s*:/.test(body)) selectShorthands++;
  }
  return { cardRules, rawRadii: radii.size, rawRadiiList: [...radii].sort((a, b) => b[1] - a[1]), dupSelectors: dups.length, dupList: dups.sort((a, b) => b[1] - a[1]), rootBlocks, subFloorFontRules, selectShorthands };
}

// ── THE FIXTURE NAMES ITS SOURCES ────────────────────────────────────────────────────────────────
// Every element inside a `data-from="path"` block must use classes that appear in that file. A
// class that has been renamed or removed at the source makes the fixture a picture of a screen
// that no longer exists, and this is where that gets said.
export function fixtureDrift(html, readSrc = (p) => readFileSync(join(ROOT, p), "utf8")) {
  const missing = [];
  const srcCache = new Map();
  const src = (p) => { if (!srcCache.has(p)) { try { srcCache.set(p, readSrc(p)); } catch { srcCache.set(p, null); } } return srcCache.get(p); };
  // Walk tags in order, tracking the innermost data-from. A real parser is not needed: the
  // fixture is hand-written, flat, and this only needs tag + attributes.
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/gi)) {
    const [, close, tag, attrs] = m;
    if (close) { if (stack.length && stack[stack.length - 1].tag === tag) stack.pop(); continue; }
    const from = attrs.match(/data-from="([^"]+)"/);
    const voidTag = /^(meta|link|br|img|input|hr)$/i.test(tag);
    const owner = from ? from[1] : (stack.length ? stack[stack.length - 1].from : null);
    const cls = attrs.match(/class="([^"]+)"/);
    if (cls && owner) {
      const text = src(owner);
      for (const c of cls[1].split(/\s+/).filter(Boolean)) {
        if (text === null) { missing.push(`${c}  ← claimed from ${owner} (file not found)`); continue; }
        const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // The class as a token inside a className: bounded by quotes, whitespace, a template's
        // `${` (className={`grp-seg${on ? " on" : ""}`}) or the end. kit.tsx's SectionHeader
        // classes are single letters (.l, .a), so a bare-word search would match anything.
        const exact = new RegExp(`["'\`\\s]${esc(c)}(["'\`\\s}$]|$)`).test(text);
        // A suffix the component computes — `sev-${first.severity}` — is declared by its prefix.
        const dynamic = c.split("-").slice(0, -1).some((_, i) => text.includes(`${c.split("-").slice(0, i + 1).join("-")}-\${`));
        if (!exact && !dynamic) missing.push(`${c}  ← claimed from ${owner}`);
      }
    }
    if (!voidTag && !attrs.endsWith("/")) stack.push({ tag, from: owner });
  }
  return [...new Set(missing)];
}

// ── THE CHROME, PAINTED ──────────────────────────────────────────────────────────────────────────
// Runs IN THE PAGE (page.evaluate), so it reads the same boxes a thumb lands on. Returns the boxes
// and every collision, named. A collision is any overlap with area — touching edges are fine.
export function chromeReport() {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const area = (a, c) => Math.max(0, Math.min(a.r, c.r) - Math.max(a.x, c.x)) * Math.max(0, Math.min(a.b, c.b) - Math.max(a.y, c.y));
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.className || "").trim().replace(/\s+/g, " ").slice(0, 40);
  const navEl = document.querySelector(".nav");
  const railEl = document.querySelector(".rail");
  const docked = !!railEl && !railEl.classList.contains("rail-folded");
  const nav = navEl ? box(navEl) : null;
  const rail = docked && railEl && visible(railEl) ? box(railEl) : null;
  const handleEl = document.querySelector(".rail-open");
  const handle = handleEl && visible(handleEl) ? box(handleEl) : null;
  const tabs = [...document.querySelectorAll(".nav .tab")].filter(visible).map((el) => ({ name: label(el), ...box(el) }));
  const fabs = [...document.querySelectorAll(".qd-fab,.theme-toggle")].filter(visible).map((el) => ({ name: el.className.split(" ")[0], ...box(el) }));
  const prompts = [...document.querySelectorAll(".sw-update,.offchip")].filter(visible).map((el) => ({ name: el.className.split(" ")[0], ...box(el) }));
  const hits = [];
  for (const f of [...fabs, ...prompts]) {
    for (const t of tabs) { const a = area(f, t); if (a > 0) hits.push(`${f.name} covers the ${t.name} tab (${Math.round(a)} px²)`); }
    if (nav && area(f, nav) > 0) hits.push(`${f.name} overlaps the nav (${Math.round(area(f, nav))} px²)`);
    if (rail && area(f, rail) > 0) hits.push(`${f.name} overlaps the docked rail (${Math.round(area(f, rail))} px²)`);
    if (handle && area(f, handle) > 0) hits.push(`${f.name} overlaps the folded rail handle (${Math.round(area(f, handle))} px²)`);
  }
  for (const p of prompts) for (const f of fabs) { const a = area(p, f); if (a > 0) hits.push(`${p.name} lands on ${f.name} (${Math.round(a)} px²)`); }
  // The chrome's top edge: the docked rail when it is docked above the nav, otherwise the nav.
  const chromeTop = Math.min(nav ? nav.y : Infinity, rail ? rail.y : Infinity);
  const lowestFab = fabs.length ? Math.max(...fabs.map((f) => f.b)) : null;
  return {
    nav: nav && { y: Math.round(nav.y), b: Math.round(nav.b), h: Math.round(nav.h) },
    rail: rail && { y: Math.round(rail.y), b: Math.round(rail.b), w: Math.round(rail.w) },
    handle: handle && { y: Math.round(handle.y), b: Math.round(handle.b) },
    fabs: fabs.map((f) => ({ name: f.name, y: Math.round(f.y), b: Math.round(f.b) })),
    railAboveNav: rail && nav ? rail.b <= nav.y + 0.5 : null,
    railFullWidth: rail ? rail.x <= 1 && rail.w >= innerWidth - 2 : null,
    air: lowestFab === null || !Number.isFinite(chromeTop) ? null : Math.round(chromeTop - lowestFab),
    hits,
  };
}

async function paintedChrome(fixture = CHROME_FIXTURE) {
  const require = createRequire(import.meta.url);
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { return { error: "playwright is not installed" }; }
  const candidates = [process.env.PW_CHROME, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].filter(Boolean);
  const exe = candidates.find((p) => existsSync(p));
  let browser;
  try { browser = await chromium.launch(exe ? { executablePath: exe } : {}); }
  catch (e) { return { error: `could not launch Chromium — ${String(e.message || e).split("\n")[0]}` }; }
  try {
    const out = [];
    for (const st of CHROME_STATES) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      // The home-indicator inset, through Chromium's own emulation — env(safe-area-inset-bottom)
      // is then the real value in the real stylesheet. Without it the suite is a phone with no
      // inset, which is the one phone the defect did not show on.
      try {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: st.inset ? 47 : 0, bottom: st.inset, left: 0, right: 0 } });
      } catch (e) { await page.close(); return { error: `this Chromium cannot emulate a safe-area inset — ${String(e.message || e).split("\n")[0]}` }; }
      await page.goto(pathToFileURL(fixture).href);
      if (st.rail === "folded") {
        // FloatRail's folded branch, verbatim: the class, and the one handle button.
        await page.evaluate(() => {
          const r = document.querySelector(".rail");
          if (!r) return;
          r.classList.add("rail-folded");
          r.innerHTML = '<button type="button" class="rail-open" aria-expanded="false" aria-label="Open quick actions — ask us, connect, display">‹</button>';
        });
      }
      // At rest, not mid-entrance: the folded handle rises 26px into place over .9s (rail-raise),
      // and a box caught on its way up is not where a thumb finds it. Finite animations only.
      await page.evaluate(() => Promise.race([
        Promise.all(document.getAnimations()
          .filter((a) => a.effect?.getTiming?.().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {}))),
        new Promise((r) => setTimeout(r, 3000)),
      ]));
      out.push({ ...st, report: await page.evaluate(chromeReport) });
      await page.close();
    }
    return { states: out };
  } catch (e) { return { error: `could not render the chrome fixture — ${String(e.message || e).split("\n")[0]}` }; }
  finally { await browser.close(); }
}

// ── PAINTED ──────────────────────────────────────────────────────────────────────────────────────
async function painted(fixture = FIXTURE) {
  const require = createRequire(import.meta.url);
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { return { error: "playwright is not installed" }; }
  const candidates = [process.env.PW_CHROME, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].filter(Boolean);
  const exe = candidates.find((p) => existsSync(p));
  let browser;
  try { browser = await chromium.launch(exe ? { executablePath: exe } : {}); }
  catch (e) { return { error: `could not launch Chromium — ${String(e.message || e).split("\n")[0]}` }; }
  try {
    const { measurePage } = await import(pathToFileURL(join(ROOT, "scripts/design.measure.mjs")).href);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(fixture).href);
    await page.waitForTimeout(500);
    const day = await measurePage(page);
    // The same DOM in the dark theme (the console's default; `.crew-day` is the day switch). A theme
    // changes colour, not structure — a border that exists only in one theme is a box the other
    // theme does not have, and the measurement sees it as one.
    await page.evaluate(() => document.querySelector(".app")?.classList.remove("crew-day"));
    await page.waitForTimeout(300);
    const dark = await measurePage(page);
    return { ...day, dark };
  } catch (e) { return { error: `could not render the fixture — ${String(e.message || e).split("\n")[0]}` }; }
  finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const list = process.argv.includes("--list");
  const fails = [];
  const note = (ok, line) => { console.log(`  ${ok ? "✓" : "✗"} ${line}`); if (!ok) fails.push(line); };
  const ratchet = (name, value, ceiling, fmt = (v) => v) => {
    if (value > ceiling) note(false, `${name}: ${fmt(value)} — ceiling ${fmt(ceiling)}. Up. Fix it, or raise the ceiling in this file WITH a reason in the commit message.`);
    else if (value < ceiling) note(false, `${name}: ${fmt(value)} — ceiling ${fmt(ceiling)} sits above it. Good; now LOWER the ceiling to ${fmt(value)}. Slack is room for new debt.`);
    else note(true, `${name}: ${fmt(value)} (ceiling ${fmt(ceiling)})`);
  };

  let css;
  try { css = readFileSync(CSS, "utf8"); } catch { console.log("DESIGN RATCHET: NOT CHECKED — app/globals.css unreadable. Treated as a FAILURE."); process.exit(1); }
  const s = staticCounts(css);
  console.log("DESIGN RATCHET — the stylesheet:");
  ratchet("card-making rules (radius + border or fill)", s.cardRules, CEILING.cardRules);
  ratchet("raw corner radii beside the --r-* tokens", s.rawRadii, CEILING.rawRadii);
  ratchet("selectors declared more than once", s.dupSelectors, CEILING.dupSelectors);
  ratchet(":root blocks", s.rootBlocks, CEILING.rootBlocks);
  ratchet("px font-sizes under the 10px type floor", s.subFloorFontRules, CEILING.subFloorFontRules);
  ratchet("<select> rules painted with the background shorthand (the chevron tiles)", s.selectShorthands, CEILING.selectShorthands);
  const f = frictionCounts();
  console.log("DESIGN RATCHET — friction in the source:");
  ratchet("native confirm()/prompt() dialogs still to migrate to the house sheets", f.nativeDialogs, FRICTION.nativeDialogs);
  ratchet("\"crew-group\" section titles beside <SectionHeader>", f.crewGroupTitles, FRICTION.crewGroupTitles);
  ratchet("<Panel> accordions closed by default", f.collapsedPanels, FRICTION.collapsedPanels);
  if (list) {
    console.log("  raw radii, most used first:"); for (const [v, n] of s.rawRadiiList.slice(0, 12)) console.log(`    ${String(n).padStart(4)}  ${v}`);
    console.log("  duplicate selectors, most repeated first:"); for (const [v, n] of s.dupList.slice(0, 12)) console.log(`    ${String(n).padStart(4)}  ${v}`);
  }

  let html;
  try { html = readFileSync(FIXTURE, "utf8"); } catch { console.log("DESIGN RATCHET: NOT CHECKED — the Plan fixture is missing. Treated as a FAILURE."); process.exit(1); }
  const drift = fixtureDrift(html);
  console.log("DESIGN RATCHET — the fixture names its sources:");
  note(drift.length === 0, drift.length === 0 ? "every class in scripts/fixtures/plan-screen.html still exists in the file it claims" : `${drift.length} class(es) no longer exist in the file the fixture claims them from:`);
  for (const d of drift) console.log(`      ${d}`);

  const p = await painted();
  console.log("DESIGN RATCHET — the Plan screen, painted at 390px:");
  if (p.error) {
    console.log(`  NOT CHECKED — ${p.error}.`);
    console.log("  Treated as a FAILURE, not a pass: a gate that cannot see its subject must not report success.");
    process.exit(1);
  }
  ratchet("box depth at the innermost box", p.maxLeafDepth, CEILING.maxLeafDepth);
  note(!p.frameOnSectionBody, p.frameOnSectionBody ? "the section body paints a focus frame around the whole screen again" : "no focus frame on the section body");
  ratchet("rail area, expanded, as a fraction of the viewport", p.railAreaFraction, CEILING.railAreaFraction);
  ratchet("fixed buttons the expanded rail covers", p.railCoversFixed, CEILING.railCoversFixed);
  if (p.minAgendaFontPx === null || p.minAgendaFontPx < FLOOR.minAgendaFontPx) note(false, `smallest agenda text ${p.minAgendaFontPx}px — floor ${FLOOR.minAgendaFontPx}px`);
  else note(true, `smallest agenda text ${p.minAgendaFontPx}px (floor ${FLOOR.minAgendaFontPx}px)`);
  if (list) { console.log("  deepest boxes:"); for (const d of p.deepest.slice(0, 6)) console.log(`    depth ${d.depth}  ${d.cls}  “${d.text}”`); }
  const k = p.dark;
  console.log("DESIGN RATCHET — the same screen, dark theme:");
  ratchet("box depth at the innermost box", k.maxLeafDepth, CEILING.maxLeafDepth);
  note(!k.frameOnSectionBody, k.frameOnSectionBody ? "the section body paints a focus frame in the dark theme" : "no focus frame on the section body");
  ratchet("rail area, expanded, as a fraction of the viewport", k.railAreaFraction, CEILING.railAreaFraction);
  ratchet("fixed buttons the expanded rail covers", k.railCoversFixed, CEILING.railCoversFixed);
  if (k.minAgendaFontPx === null || k.minAgendaFontPx < FLOOR.minAgendaFontPx) note(false, `smallest agenda text ${k.minAgendaFontPx}px — floor ${FLOOR.minAgendaFontPx}px`);
  else note(true, `smallest agenda text ${k.minAgendaFontPx}px (floor ${FLOOR.minAgendaFontPx}px)`);
  note(k.boxes === p.boxes, k.boxes === p.boxes ? `the theme changes colour, not structure: ${k.boxes} boxes in both` : `the dark theme paints ${k.boxes} boxes where day paints ${p.boxes} — a border or fill that exists in one theme only`);

  // ── THE SHEETS, the same way: each fixture names its sources, then is painted in both themes ──
  for (const sheet of SHEETS) {
    let html;
    try { html = readFileSync(sheet.file, "utf8"); } catch { console.log(`DESIGN RATCHET: NOT CHECKED — the ${sheet.name} fixture is missing. Treated as a FAILURE.`); process.exit(1); }
    const drift = fixtureDrift(html);
    console.log(`DESIGN RATCHET — the ${sheet.name} fixture names its sources:`);
    note(drift.length === 0, drift.length === 0 ? `every class in ${sheet.rel} still exists in the file it claims` : `${drift.length} class(es) no longer exist in the file the fixture claims them from:`);
    for (const d of drift) console.log(`      ${d}`);
    const b = await painted(sheet.file);
    console.log(`DESIGN RATCHET — the ${sheet.name}, painted at 390px (day, then dark):`);
    if (b.error) { console.log(`  NOT CHECKED — ${b.error}. Treated as a FAILURE.`); process.exit(1); }
    const L = sheet.limits;
    for (const [theme, m] of [["day", b], ["dark", b.dark]]) {
      ratchet(`${theme}: box depth at the innermost box`, m.maxLeafDepth, L.depth);
      if (m.smallestTap === null || m.smallestTap < L.tap) note(false, `${theme}: smallest tap target ${m.smallestTap}px (${m.smallestTapWhat}) — floor ${L.tap}px`);
      else if (m.smallestTap > L.tap) note(false, `${theme}: smallest tap target ${m.smallestTap}px — floor ${L.tap}px sits below it. Good; now raise the floor to ${m.smallestTap}.`);
      else note(true, `${theme}: smallest tap target ${m.smallestTap}px (${m.smallestTapWhat}; floor ${L.tap}px)`);
      if (m.smallestText === null || m.smallestText < L.text) note(false, `${theme}: smallest text ${m.smallestText}px (${m.smallestTextWhat}) — floor ${L.text}px`);
      else note(true, `${theme}: smallest text ${m.smallestText}px (floor ${L.text}px)`);
      note((m.overflowX || []).length === 0, (m.overflowX || []).length === 0 ? `${theme}: nothing scrolls sideways` : `${theme}: scrolls sideways: ${JSON.stringify(m.overflowX).slice(0, 80)}`);
    }
    note(b.dark.boxes === b.boxes, b.dark.boxes === b.boxes ? `the theme changes colour, not structure: ${b.boxes} boxes in both` : `the dark theme paints ${b.dark.boxes} boxes where day paints ${b.boxes}`);
  }

  // ── THE CREW CHROME — nothing floats on a tab, at any inset, with the rail docked or folded ──
  let chromeHtml;
  try { chromeHtml = readFileSync(CHROME_FIXTURE, "utf8"); } catch { console.log("DESIGN RATCHET: NOT CHECKED — the crew chrome fixture is missing. Treated as a FAILURE."); process.exit(1); }
  const chromeDrift = fixtureDrift(chromeHtml);
  console.log("DESIGN RATCHET — the crew chrome fixture names its sources:");
  note(chromeDrift.length === 0, chromeDrift.length === 0 ? "every class in scripts/fixtures/crew-chrome.html still exists in the file it claims" : `${chromeDrift.length} class(es) no longer exist in the file the fixture claims them from:`);
  for (const d of chromeDrift) console.log(`      ${d}`);
  const ch = await paintedChrome();
  console.log("DESIGN RATCHET — the crew chrome, painted at 390px (inset 0 and 34px, rail docked and folded):");
  if (ch.error) { console.log(`  NOT CHECKED — ${ch.error}. Treated as a FAILURE.`); process.exit(1); }
  for (const { inset, rail, report: r } of ch.states) {
    const tag = `inset ${inset}px, rail ${rail}`;
    note(r.hits.length === 0, r.hits.length === 0
      ? `${tag}: nothing floating touches a tab, the nav${rail === "docked" ? ", the docked rail" : ", the rail handle"} or another button (nav ${r.nav?.h}px)`
      : `${tag}: ${r.hits.join("; ")}`);
    note(r.air !== null && r.air >= CHROME_CLEARANCE, `${tag}: the floating tier sits ${r.air}px above the chrome (at least ${CHROME_CLEARANCE})`);
    if (rail === "docked") {
      note(r.railAboveNav === true, r.railAboveNav ? `${tag}: the docked rail is a toolbar above the nav` : `${tag}: the docked rail is NOT above the nav (rail ${r.rail?.y}–${r.rail?.b}, nav from ${r.nav?.y})`);
      note(r.railFullWidth === true, `${tag}: the docked rail spans the width`);
    }
  }

  if (fails.length) { console.log(`\nDESIGN RATCHET: ${fails.length} failure(s).`); process.exit(1); }
  console.log("\nDESIGN RATCHET: clean.");
}
