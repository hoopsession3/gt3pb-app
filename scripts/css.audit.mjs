// THE HOUSE STYLESHEET AND THE UTILITIES — the Tailwind round's gate (2026-10-07).
//
//   node scripts/css.audit.mjs          # fail on any rule below
//   node scripts/css.audit.mjs --list   # and print what each ratchet counted
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────
// Tailwind CSS was in package.json from the first commit and in none of the CSS: Create Next App wired
// it in, the v3 port (e9963cf) took the wiring out, and the packages rode along. Every screen was styled
// by app/globals.css — 8,464 lines, 804 KB of source, 102 KB gzipped, downloaded before any route can
// paint — and by 621 inline style={{…}} objects that had nowhere better to go: no tokens, no variants,
// no media queries. Tailwind is now the place for that one-off layout (app/tailwind.css says how it
// sits beside the house stylesheet). These rules keep it one system:
//
//   1. WIRED AS SAID    postcss.config.mjs runs @tailwindcss/postcss and nothing else. app/tailwind.css
//                       imports Tailwind's theme and utilities and not its preflight (the reset would
//                       restyle every element the house stylesheet already styles), reads the screens'
//                       code only — source(none), then app, components, lib and native, not app/api —
//                       and app/layout.tsx loads it after app/globals.css. app/globals.css uses no
//                       Tailwind at-rule, so Tailwind's PostCSS plugin leaves it exactly as written.
//   2. ONE MEANING      no class the house stylesheet defines is also a Tailwind utility — asked of
//                       Tailwind's own design system, with this app's theme — so a class on a screen
//                       means one thing. (Two did: .ring, the 3MPIRE card's stamp ring, is .mp-ring;
//                       .sr-only is Tailwind's now, the same box.)
//   3. GT3'S COLOURS    a utility can only name a GT3 colour: Tailwind's own palette is off (bg-blue-500
//                       builds nothing), and no className writes a raw colour (bg-[#…], text-[rgb(…)]).
//   4. NO dark:         the look is lib/theme's, never the phone's setting alone; dark: builds nothing.
//   5. THE TYPE FLOOR   no className sets text under 10px (text-[9px]) — the floor app/globals.css
//                       keeps (scripts/design.ratchet.mjs).
//   6. A HOVER IS A HOVER  every :hover rule in app/globals.css sits inside @media (hover:hover), as
//                       Tailwind's hover: does: on a phone a tapped button must not stay lit.
//   7. NO DEAD CSS      every class the house stylesheet styles is named somewhere in the screens' code,
//                       the database's words (an enum a class is built from) or a third party's own
//                       (leaflet-*) — a word counts however it is cased: the pipeline's priorities are
//                       'P1'…'P4' in the database and .pipe-pri.p1 on the screen. What a selector puts
//                       inside :not(), :is(), :where() or [attr] is not a class it needs. 316 rules,
//                       parts of 13 more and 4 keyframes styled nothing on 2026-10-07.
//   9. ONE PILL         a control rounded to a pill, or a round button, is the kit's — .k-seg, .k-icon-btn,
//                       .k-badge, .k-count (app/globals.css "PILLS, ONE KIT", components/controls.tsx). Ryan's My
//                       Day header was five controls in five recipes; the house held 162 pill rules in 156
//                       recipes (17 font sizes, 25 heights, 49 paddings, 5 faces) beside a kit two screens
//                       used. The pill rules outside the kit are counted, and the count only falls (8).
//   8. ONLY DOWN        what the utilities are for can only shrink from what is recorded in CEILING:
//                       inline style objects, the distinct raw colours written in app/globals.css, its
//                       size, and class names taken whole from a variable (`${status}`) — a value from
//                       the data that happens to be "hidden" or "fixed" would be a utility. A ceiling
//                       above its count fails too — lower it in the commit that earns it; raising one
//                       needs a reason written beside it.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import postcss from "postcss";

export const CEILING = {
  inlineStyles: 614,          // style={{…}} objects in app/, components/, native/ (621 on 2026-10-07; 620 the same day — the overdue count's margin is a utility; 616 when Team's door became one; 614 on 2026-10-08 — the Guide's header is utilities, with its two pages)
  rawColours: 497,            // 497 on 2026-10-08 (the foundations round: the dead brew-timer dot's teal went with it); distinct hex / rgb() / rgba() literals in app/globals.css (2026-10-07, after the dead rules went; 499 when Command and Team took theme tokens; 498 when the office route's card did)
  globalsBytes: 768_222,      // 768,222 on 2026-10-08 (the foundations round: 50 rules no screen can match went — the old sheet, the .did and .cell rows, the menu's first draft — and the safe-area, tap-target and 16px-field fixes fit in what they left); app/globals.css, source bytes (2026-10-07: 804 KB before 316 dead rules and 4 keyframes went; the pill kit fits in what its seven recipes left;
                              // Command's and Team's clean-up added rows and actions and put their one-off layout in utilities; the office route on theme tokens)
  wholeVariableClasses: 46,   // className tokens that are a ${value} and nothing else (2026-10-07)
  pillRules: 115,             // pills and round buttons outside the kit (2026-10-07: 124 before the pill round moved the
                              // crew header, the lane's sections, the counts and the tab badges onto it; 115 when Team's role badge and invite pills went)
};

const THIRD_PARTY = /^(leaflet-|sq-|onesignal|slide-|swiper-)/;
const toPosix = (p) => p.split(sep).join("/");

function walk(root, dir, test, out = []) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(root, rel, test, out); }
    else if (test(e.name)) out.push(rel);
  }
  return out;
}

/** One file's inline style objects and className strings, read with the TypeScript parser. */
export function markupOf(f, src) {
  let inlineStyles = 0;
  const classes = new Set();          // class tokens written in the file
  const wholeVariable = [];           // `${x}` standing as a whole class token
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // a choice between written words is safe; a value from somewhere else is not
  const literalOnly = (x) => ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)
    || (ts.isParenthesizedExpression(x) && literalOnly(x.expression))
    || (ts.isConditionalExpression(x) && literalOnly(x.whenTrue) && literalOnly(x.whenFalse));
  const visit = (n) => {
    if (ts.isJsxAttribute(n) && n.initializer) {
      const name = n.name.getText(sf);
      if (name === "style" && ts.isJsxExpression(n.initializer) && n.initializer.expression && ts.isObjectLiteralExpression(n.initializer.expression)) inlineStyles++;
      if (name === "className") {
        const strings = [];
        const collect = (x) => {
          if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) strings.push(x.text);
          else if (ts.isTemplateExpression(x)) {
            const parts = [x.head.text, ...x.templateSpans.map((s) => s.literal.text)];
            strings.push(parts.join(" "));
            x.templateSpans.forEach((s, i) => {
              const before = i === 0 ? x.head.text : x.templateSpans[i - 1].literal.text;
              const after = s.literal.text;
              if ((before === "" || /\s$/.test(before)) && (after === "" || /^\s/.test(after)) && !literalOnly(s.expression)) {
                wholeVariable.push(`${toPosix(f)}:${sf.getLineAndCharacterOfPosition(s.expression.getStart(sf)).line + 1} \${${s.expression.getText(sf).slice(0, 40)}}`);
              }
            });
          }
          ts.forEachChild(x, collect);
        };
        if (ts.isStringLiteral(n.initializer)) strings.push(n.initializer.text);
        else if (ts.isJsxExpression(n.initializer) && n.initializer.expression) collect(n.initializer.expression);
        for (const str of strings) for (const c of str.split(/\s+/)) if (c) classes.add(c);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { inlineStyles, classes, wholeVariable };
}

/** Every screen file's markup, together. */
export function markup(root) {
  const files = ["app", "components", "native"].flatMap((d) => walk(root, d, (n) => n.endsWith(".tsx")));
  let inlineStyles = 0;
  const classes = new Map();          // class token → files
  const wholeVariable = [];
  for (const f of files) {
    const one = markupOf(f, readFileSync(join(root, f), "utf8"));
    inlineStyles += one.inlineStyles;
    wholeVariable.push(...one.wholeVariable);
    for (const c of one.classes) { if (!classes.has(c)) classes.set(c, new Set()); classes.get(c).add(toPosix(f)); }
  }
  return { files, inlineStyles, classes, wholeVariable };
}

/** Every class the house stylesheet styles, and the rules that style them. */
export function houseClasses(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...bare.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]).filter((c) => !/^\d/.test(c)));
}

/** What a selector needs to match: not what sits in [attr="…"], :not(…), :is(…) or :where(…) — a class
 *  nothing uses makes :not() always true, and one alternative of :is() is not the rule. */
export const demanded = (s) => s.replace(/\[[^\]]*\]/g, "").replace(/:(not|is|where)\([^()]*\)/g, "");

export function rawColours(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...bare.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map((m) => m[0].toLowerCase().replace(/\s+/g, "")));
}

/** Whether a class is named in this text: a word in it however cased (the pipeline's 'P1' is
 *  .pipe-pri.p1), a third party's own, or begun by a prefix the code builds on (`rd-t${n}`, "tone-" + t). */
export function namedBy(text) {
  const lower = (w) => w.toLowerCase();
  const tokens = new Set((text.match(/[A-Za-z_][\w-]*/g) || []).map(lower));
  const prefixes = [...new Set([...text.matchAll(/([A-Za-z][\w-]*)\$\{/g), ...text.matchAll(/["'`]([A-Za-z][\w-]*)["'`]\s*\+/g)].map((m) => lower(m[1])))].filter((p) => p.length >= 2);
  return (c) => tokens.has(lower(c)) || THIRD_PARTY.test(c) || prefixes.some((p) => lower(c).startsWith(p));
}

/** The words a class could be built from: the screens' code, the public pages, the database's enums. */
function wordsInCode(root) {
  const files = ["app", "components", "lib", "native", "public", "supabase"].flatMap((d) => walk(root, d, (n) => /\.(tsx?|mjs|js|html|sql|json|md)$/.test(n)));
  return namedBy(files.filter((f) => !f.endsWith("globals.css")).map((f) => readFileSync(join(root, f), "utf8")).join("\n"));
}

/** The selectors in a stylesheet that need a class nothing names — rules that can never match. */
export function deadSelectorsIn(ast, named) {
  const dead = [];
  ast.walkRules((r) => {
    if (r.parent?.type === "atrule" && /keyframes/i.test(r.parent.name)) return;
    for (const s of r.selectors) if ([...demanded(s).matchAll(/\.([A-Za-z_][\w-]*)/g)].some((x) => !named(x[1]))) dead.push(s.replace(/\s+/g, " ").slice(0, 60));
  });
  return dead;
}

/** The rules that round a control to a pill — or a button to a circle — and are not the kit's.
 *  A pill: border-radius var(--r-pill), or 50px and over, with words in it (a font or a padding). A
 *  round button: 50% on a square of 20px and over that is pressed (cursor: pointer) — an avatar or a
 *  switch's knob is round and is not one. Not a bar or a track (under 14px tall), not a keyframe.
 *  The kit's own (.k-*) are the answer, not the count. */
export function pillRulesIn(ast) {
  const PILL = /^(var\(--r-pill\)|\d{3,}px|[5-9]\dpx)$/;
  const out = [];
  ast.walkRules((r) => {
    if (r.parent?.type === "atrule" && /keyframes/i.test(r.parent.name)) return;
    const d = {};
    r.each((n) => { if (n.type === "decl") d[n.prop] = n.value.trim(); });
    const rad = d["border-radius"];
    if (!rad) return;
    const circle = rad === "50%";
    if (!circle && !PILL.test(rad)) return;
    const h = d.height || d["min-height"], w = d.width;
    const words = d["font-size"] || d["font-family"] || d.padding || d["padding-inline"];
    // a round BUTTON — a circle that is pressed (an avatar or a knob is round and is not one)
    if (circle && !(w && h && w === h && parseFloat(w) >= 20 && d.cursor === "pointer")) return;
    // a bar, a track or a fill is not a pill: under 14px tall, or a shape with no words in it
    if (h && /px$/.test(h) && parseFloat(h) < 14) return;
    if (!circle && !words) return;
    if (r.selectors.every((x) => /\.k-[\w-]/.test(x))) return;
    out.push(r.selector.replace(/\s+/g, " ").slice(0, 60));
  });
  return out;
}

/** The :hover rules that apply on a phone too — outside @media (hover:hover). */
export function looseHoversIn(ast) {
  const loose = [];
  ast.walkRules((r) => {
    if (!/:hover/.test(r.selector)) return;
    for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && p.name === "media" && /hover\s*:\s*hover/.test(p.params)) return;
    loose.push(r.selector.replace(/\s+/g, " ").slice(0, 60));
  });
  return loose;
}

export async function audit(root) {
  const bad = [];
  const fail = (rule, what) => bad.push({ rule, what });
  const read = (f) => readFileSync(join(root, f), "utf8");
  const globals = read("app/globals.css");
  const tw = read("app/tailwind.css");

  // 1 · wired as said
  const config = (await import(`${pathToFileURL(join(root, "postcss.config.mjs")).href}?at=${Date.now()}`)).default;
  const plugins = Array.isArray(config?.plugins) ? config.plugins.map(String) : Object.keys(config?.plugins ?? {});
  if (JSON.stringify(plugins) !== '["@tailwindcss/postcss"]') fail("wired", `postcss.config.mjs runs ${plugins.join(", ") || "nothing"} — it runs @tailwindcss/postcss and nothing else`);
  const imports = [...tw.matchAll(/^@import\s+"([^"]+)"([^;]*);/gm)].map((m) => [m[1], m[2].trim()]);
  const want = [["tailwindcss/theme.css", "layer(theme)"], ["tailwindcss/utilities.css", "source(none)"]];
  if (JSON.stringify(imports) !== JSON.stringify(want)) fail("wired", `app/tailwind.css imports ${JSON.stringify(imports)} — want the theme in its layer and the utilities with source(none), and no preflight`);
  if (/preflight|@import\s+"tailwindcss"\s*;/.test(tw.replace(/\/\*[\s\S]*?\*\//g, ""))) fail("wired", "app/tailwind.css brings in Tailwind's preflight");
  const sources = [...tw.matchAll(/^@source\s+(not\s+)?"([^"]+)";/gm)].map((m) => `${m[1] ? "not " : ""}${m[2]}`);
  if (JSON.stringify(sources) !== JSON.stringify(["../app", "../components", "../lib", "../native", "not ../app/api"])) fail("wired", `app/tailwind.css reads ${sources.join(", ")} — the screens' code, and not app/api`);
  const layout = read("app/layout.tsx");
  const gi = layout.indexOf('import "./globals.css";'), ti = layout.indexOf('import "./tailwind.css";');
  if (gi < 0 || ti < gi) fail("wired", "app/layout.tsx loads app/tailwind.css after app/globals.css");
  if (/@(import|tailwind|theme|apply|utility|variant|custom-variant|source|plugin|config|reference)\b/.test(globals.replace(/\/\*[\s\S]*?\*\//g, ""))) fail("wired", "app/globals.css uses a Tailwind at-rule — Tailwind would then rewrite the house stylesheet");

  // 2 · one meaning, 3 · GT3's colours, 4 · no dark:
  const { __unstable__loadDesignSystem, compile } = await import("@tailwindcss/node");
  if (typeof __unstable__loadDesignSystem !== "function" || typeof compile !== "function") {
    fail("wired", "@tailwindcss/node no longer offers compile and __unstable__loadDesignSystem — ONE MEANING needs another way to ask Tailwind what it builds");
    return { bad, counts: {}, markup: markup(root), dead: [], loose: [], twice: [] };
  }
  const base = join(root, "app");
  const ds = await __unstable__loadDesignSystem(tw, { base });
  const house = [...houseClasses(globals)];
  const asUtility = ds.candidatesToCss(house);
  const twice = house.filter((_, i) => asUtility[i]);
  if (twice.length) fail("one meaning", `the house stylesheet defines ${twice.length} class(es) Tailwind also builds: ${twice.slice(0, 8).join(", ")}`);
  const compiled = await compile(tw, { base, from: join(base, "tailwind.css"), onDependency() {} });
  const probe = compiled.build(["bg-blue-500", "text-red-500", "dark:hidden", "bg-cream", "pb-safe-4", "native:hidden", "kb:hidden", "day:text-ink"]);
  if (/\.bg-blue-500|\.text-red-500/.test(probe)) fail("GT3's colours", "Tailwind's own palette builds (bg-blue-500) — app/tailwind.css switches it off with --color-*: initial");
  if (!/\.bg-cream\s*\{\s*background-color:\s*var\(--cream\)/.test(probe)) fail("GT3's colours", "bg-cream does not read the house --cream");
  if (!/\.pb-safe-4[\s\S]*?env\(safe-area-inset-bottom/.test(probe) || !/html\[data-native\]/.test(probe) || !/html\[data-kb\]/.test(probe) || !/\.crew-day/.test(probe)) fail("wired", "the app's variants (native:, kb:, day:) or the safe-area utilities are missing from app/tailwind.css");
  if (!/\.dark\\:hidden\s*\{\s*&:not\(\*\)/.test(probe)) fail("no dark:", "dark: builds a rule that can match — the look is lib/theme's");

  const m = markup(root);
  for (const [c, files] of m.classes) {
    if (/^dark:/.test(c)) fail("no dark:", `${c} in ${[...files].join(", ")}`);
    if (/(^|:)(bg|text|border|ring|fill|stroke|outline|shadow|from|to|via|decoration|accent|caret|divide)-\[(#|rgb|hsl|oklch|color)/.test(c)) fail("GT3's colours", `${c} writes a raw colour (${[...files].join(", ")}) — use a GT3 colour`);
    const px = /(^|:)text-\[(\d+(?:\.\d+)?)px\]/.exec(c);
    if (px && Number(px[2]) < 10) fail("type floor", `${c} sets text under 10px (${[...files].join(", ")})`);
  }

  // 6 · a hover is a hover
  const ast = postcss.parse(globals);
  const loose = looseHoversIn(ast);
  if (loose.length) fail("a hover is a hover", `${loose.length} :hover rule(s) outside @media (hover:hover): ${loose.slice(0, 5).join(" | ")}`);

  // 7 · no dead CSS
  const dead = deadSelectorsIn(ast, wordsInCode(root));
  if (dead.length) fail("no dead CSS", `${dead.length} selector(s) style a class nothing names: ${dead.slice(0, 6).join(" | ")}`);

  // 8 · only down
  // 9 · one pill (counted with the ratchets below)
  const pills = pillRulesIn(ast);

  const counts = { inlineStyles: m.inlineStyles, rawColours: rawColours(globals).size, globalsBytes: Buffer.byteLength(globals), wholeVariableClasses: m.wholeVariable.length, pillRules: pills.length };
  for (const [k, v] of Object.entries(counts)) {
    if (v > CEILING[k]) fail("only down", `${k} ${v} — ceiling ${CEILING[k]}. Up: new one-off layout goes in utilities (app/tailwind.css), not here.`);
    // Slack is room for new debt: a ceiling above the count is lowered in the commit that earned it.
    else if (v < CEILING[k]) fail("only down", `${k} ${v} — ceiling ${CEILING[k]} sits above it. Good; now lower the ceiling to ${v}.`);
  }
  return { bad, counts, markup: m, dead, loose, twice, pills };
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] || "").href) {
  const root = join(dirname(new URL(import.meta.url).pathname), "..");
  const { bad, counts, markup: m, pills } = await audit(root);
  if (process.argv.includes("--list")) {
    console.log(`  counts: ${JSON.stringify(counts)}`);
    console.log(`  class names taken whole from a variable:\n    ${m.wholeVariable.join("\n    ")}`);
    console.log(`  pill rules outside the kit:\n    ${pills.join("\n    ")}`);
  }
  const slack = Object.entries(counts).filter(([k, v]) => v < CEILING[k]).map(([k, v]) => `${k} ${v} < ${CEILING[k]}`);
  console.log(`CSS AUDIT: ${m.files.length} screen file(s) · ${m.classes.size} class name(s) · ${counts.inlineStyles} inline style object(s) · ${counts.rawColours} raw colour(s) in app/globals.css — ${bad.length} unanswered${slack.length ? ` (room to lower: ${slack.join(", ")})` : ""}`);
  for (const b of bad) console.log(`  ✗ ${b.rule}: ${b.what}`);
  process.exit(bad.length ? 1 : 0);
}

