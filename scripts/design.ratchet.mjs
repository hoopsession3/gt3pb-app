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

// ── THE CEILINGS — measured, not remembered (2026-10-01, after the one-box-per-level pass) ───────
export const CEILING = {
  cardRules: 817,        // rules that make a card: radius + (border | fill). 818 → 817: the account sheet lost its stat tiles (2026-10-02)
  rawRadii: 27,          // distinct border-radius values that are not a --r-* token, 50% or 0
  dupSelectors: 55,      // single top-level selectors declared more than once
  rootBlocks: 6,         // separate `:root{` blocks — tokens are supposed to have one home
  maxLeafDepth: 2,       // boxes around the innermost box on the Plan screen (was 4)
  railWidthFraction: 0.27, // expanded rail over a 390px viewport (was 0.46)
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
  nativeDialogs: 58,
  crewGroupTitles: 29,
  collapsedPanels: 34,
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

// ── EVERY PUBLIC ROUTE, AT PHONE WIDTH — read by scripts/smoke.ui.mjs ───────────────────────────
// Measured 2026-10-02 after the first pass, with the splash dismissed (the splash is a finding of
// its own, not the page). Three numbers a route may not get worse on:
//   depth — boxes around the innermost box (ceiling)
//   tap   — the smallest interactive target's short side, px (floor)
//   text  — the smallest visible text, px (floor)
// A route not in this table is UNMEASURED and fails the smoke: add it with its real numbers.
// 8.5 is the masthead's "Performance Bar" caption, typed in Inter under the real mark — flagged
// to Ryan (the brand lock says a lockup is never re-typeset; no horizontal masthead variant
// exists in the asset set). 6.63 is the signage kiosk, bespoke by design. 26 is the folded rail
// handle, 26 wide by 56 tall. Floors say "not smaller than this", not "this is fine".
export const ROUTE = {
  "/":              { depth: 2, tap: 26, text: 8.5 },
  "/truck":         { depth: 2, tap: 26, text: 8.5 },
  "/events":        { depth: 2, tap: 26, text: 8.5 },
  "/menu":          { depth: 2, tap: 26, text: 8.5 },
  "/reserve":       { depth: 2, tap: 26, text: 8.5 },
  "/delivery":      { depth: 1, tap: 26, text: 8.5 },
  "/3mpire":        { depth: 2, tap: 26, text: 8.5 },
  "/craft":         { depth: 2, tap: 26, text: 8.5 },
  "/book":          { depth: 1, tap: 26, text: 8.5 },
  "/shop":          { depth: 2, tap: 26, text: 8.5 },
  "/primal":        { depth: 1, tap: 26, text: 8.5 },
  "/office":        { depth: 1, tap: 26, text: 8.5 },
  "/academy":       { depth: 0, tap: 26, text: 8.5 },
  "/scan":          { depth: 0, tap: 26, text: 8.5 },
  "/architecture":  { depth: 0, tap: 26, text: 8.5 },
  "/playbook":      { depth: 0, tap: 26, text: null },
  "/driver":        { depth: 0, tap: 26, text: 32 },
  "/agreement":     { depth: 1, tap: 26, text: 11 },
  "/offer":         { depth: 1, tap: 26, text: 11 },
  "/built/gt3-built-k7m9x4q2": { depth: 1, tap: 34, text: 8.5 },
  "/display":       { depth: 1, tap: 26, text: 6.63 },
  "/privacy":       { depth: 0, tap: 26, text: 14 },
  "/terms":         { depth: 0, tap: 26, text: 14 },
};

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
  return { cardRules, rawRadii: radii.size, rawRadiiList: [...radii].sort((a, b) => b[1] - a[1]), dupSelectors: dups.length, dupList: dups.sort((a, b) => b[1] - a[1]), rootBlocks };
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

// ── PAINTED ──────────────────────────────────────────────────────────────────────────────────────
async function painted() {
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
    await page.goto(pathToFileURL(FIXTURE).href);
    await page.waitForTimeout(500);
    return await measurePage(page);
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
  ratchet("rail width, expanded, as a fraction of the viewport", p.railWidthFraction, CEILING.railWidthFraction);
  if (p.minAgendaFontPx === null || p.minAgendaFontPx < FLOOR.minAgendaFontPx) note(false, `smallest agenda text ${p.minAgendaFontPx}px — floor ${FLOOR.minAgendaFontPx}px`);
  else note(true, `smallest agenda text ${p.minAgendaFontPx}px (floor ${FLOOR.minAgendaFontPx}px)`);
  if (list) { console.log("  deepest boxes:"); for (const d of p.deepest.slice(0, 6)) console.log(`    depth ${d.depth}  ${d.cls}  “${d.text}”`); }

  if (fails.length) { console.log(`\nDESIGN RATCHET: ${fails.length} failure(s).`); process.exit(1); }
  console.log("\nDESIGN RATCHET: clean.");
}
