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
//   5. ONE TYPE SCALE   every size is one of ten steps, each one of Apple's text styles at the phone's
//                       standard size: 11 12 13 15 16 17 20 22 28 34 (2026-10-08, the type round: redesign
//                       6, approved). In app/globals.css a px size of 34 or under is a step (above is a
//                       display; vmin and clamp are the truck's TV and the splash); a className names a
//                       step (text-caption2 … text-large), never a pixel size (text-[13.5px]); and the theme
//                       holds the ten steps and no other. There were 35 sizes, 92% of them between 10 and
//                       16px in half-pixel steps, and the most used, 10px, under Apple's smallest style.
//   6. A HOVER IS A HOVER  every :hover rule in app/globals.css sits inside @media (hover:hover), as
//                       Tailwind's hover: does: on a phone a tapped button must not stay lit.
//   7. NO DEAD CSS      every class the house stylesheet styles is named somewhere in the screens' code,
//                       the database's words (an enum a class is built from) or a third party's own
//                       (leaflet-*) — a word counts however it is cased: the pipeline's priorities are
//                       'P1'…'P4' in the database and .pipe-pri.p1 on the screen. What a selector puts
//                       inside :not(), :is(), :where() or [attr] is not a class it needs. 316 rules,
//                       parts of 13 more and 4 keyframes styled nothing on 2026-10-07.
//   9. ONE PILL         a control rounded to a pill, or a round button, is the kit's — .k-seg, .k-chip, .k-tag,
//                       .k-icon-btn, .k-badge, .k-count (app/globals.css "PILLS, ONE KIT", components/controls.tsx).
//                       Ryan's My Day header was five controls in five recipes; the house held 162 pill rules in
//                       156 recipes (17 font sizes, 25 heights, 49 paddings, 5 faces) beside a kit two screens
//                       used. A choice is a chip, a status is a tag, a count is a count (2026-10-09, the chip
//                       round: 105 of the 112 pill rules went, and stay gone — no rule styles one, no screen names one,
//                       in a className or in any class list it writes, a component's map of skins too: RETIRED_PILLS).
//                       The pill rules outside the kit are counted, and the count only falls (8).
//  10. ONE SET OF BUTTONS  a button is the kit's — app/globals.css "03 · Buttons", components/Button: primary,
//                       secondary, quiet or destructive, regular or compact (2026-10-09, the button round:
//                       redesign 7, approved). The house held 31 recipes for a button — 19 heights, 10 corner
//                       radii, 9 type sizes and 14 fills for the same word — and the console's sheets copied
//                       one of them twice more (.note-save, .cfm-ok). Those are gone and stay gone: no rule
//                       styles one, no screen names one (RETIRED_BUTTONS). A rule outside the kit may place
//                       a kit button (margin, flex, grid, width, position) or ink it on a light surface
//                       (color, border-color), and so may a class or a utility written beside it; none may
//                       size it, round it, letter it or fill it (padding, height, radius, font, letter-
//                       spacing, capitals, background, shadow). The button recipes still outside the kit — a
//                       rule named for a button (-btn, -cta, -go, -send, -add…) that draws a pressed box
//                       with words — are counted, and the count only falls (8).
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
  inlineStyles: 576,          // style={{…}} objects in app/, components/, native/ (576 on 2026-10-09, the chip round: the margins written inline beside .handle and the pills — sign-in's, the checkout's, the academy's, Find Us's — are utilities, and so are two sheet heads' rows; 598 the same day, the button round: sixteen buttons' margins and widths are utilities; 621 on 2026-10-07; 620 the same day — the overdue count's margin is a utility; 616 when Team's door became one; 614 on 2026-10-08 — the Guide's header is utilities, with its two pages)
  rawColours: 463,            // 463 on 2026-10-09 (the chip round: 32 hand-mixed greens, blues, golds and reds went with the chip and tag recipes — a tag's colour is a --tone-* now); 495 the same day (the button round: two went with the recipes); 497 on 2026-10-08 (the foundations round: the dead brew-timer dot's teal went with it); distinct hex / rgb() / rgba() literals in app/globals.css (2026-10-07, after the dead rules went; 499 when Command and Team took theme tokens; 498 when the office route's card did)
  globalsBytes: 717_983,      // 717,983 on 2026-10-09 (the chip round: 105 pill rules — chips, tags, pill buttons — the 16 button recipes and .handle gave way to the kit's chip, tag and count, −36 KB); 754,309 the same day (the button round: 31 recipes and the sheets' copies gave way to a kit of four kinds in two sizes); 766,799 on 2026-10-08 (the type round: 1,119 sizes folded onto the ten steps, 10.5px and 13.5px among them); 768,059 the same day (the navigation round: the system map's "‹ All layers" went into the title bar, and its rule with it); 768,213 the same day (the iPhone chrome round: the tab bar at 49pt, the KPI board's fields at 16px); 768,222 the same day (the foundations round: 50 rules no screen can match went — the old sheet, the .did and .cell rows, the menu's first draft — and the safe-area, tap-target and 16px-field fixes fit in what they left); app/globals.css, source bytes (2026-10-07: 804 KB before 316 dead rules and 4 keyframes went; the pill kit fits in what its seven recipes left;
                              // Command's and Team's clean-up added rows and actions and put their one-off layout in utilities; the office route on theme tokens)
  wholeVariableClasses: 38,   // className tokens that are a ${value} and nothing else (2026-10-07; 46 → 38 on 2026-10-09, the chip round: eight statuses that wrote their own class — a play's, a goal's, a discussion's kind, an offer letter's, the launch's verdict and checks, a Studio piece's — choose a tag's tone among written words)
  buttonRecipes: 0,           // button recipes outside the kit (2026-10-09, the button round: 41 before it moved 31 recipes and the
                              // sheets' .note-save, .note-cancel and .cfm-ok onto "03 · Buttons"; the chip round moved the last 16 the same day)
  pillRules: 7,               // pills and round buttons outside the kit (7 on 2026-10-09, the chip round: two fields, the menu's price, an avatar, the offline toast,
                              // the calendar's floating walk and the fan card's ribbon — each a different thing, named in "PILLS, ONE KIT"; 112 the same day: the coupon's, the broadcast bar's and the splash's pill buttons are the button kit's; 2026-10-07: 124 before the pill round moved the
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

/** Class lists the code writes outside a className — a component's map of skins ({ chip: "k-chip" }), a tone
 *  table — so a retired recipe cannot hide in one. A string is a class list when every word in it is lower case
 *  and one at least is hyphenated (ts-chip, btn-sec): prose has capitals, stops and commas, and a bare word
 *  ("handle it") is not a class list. Class token → the files that write it. (2026-10-09: MenuRigChips' map still
 *  named .ts-chip after the chip round retired it, and the prep tool's Menu & setup drew bare buttons.) */
export function classListsIn(root) {
  const files = ["app", "components", "native", "lib"].flatMap((d) => walk(root, d, (n) => /\.tsx?$/.test(n)));
  const out = new Map();
  const word = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
  for (const f of files) {
    const src = readFileSync(join(root, f), "utf8");
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (x) => {
      const texts = ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) ? [x.text]
        : ts.isTemplateExpression(x) ? [x.head.text, ...x.templateSpans.map((t) => t.literal.text)] : [];
      for (const t of texts) {
        const words = t.trim().split(/\s+/).filter(Boolean);
        if (!words.length || !words.every((w) => word.test(w)) || !words.some((w) => w.includes("-"))) continue;
        for (const w of words) { if (!out.has(w)) out.set(w, new Set()); out.get(w).add(toPosix(f)); }
      }
      ts.forEachChild(x, visit);
    };
    visit(sf);
  }
  return out;
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

/** The kit's buttons, and the recipes they replaced (rule 10). */
export const KIT_BUTTONS = ["btn-pri", "btn-sec", "btn-ter", "btn-del", "btn-sm", "btn-wide"];
export const RETIRED_BUTTONS = [
  "adm-btn", "guide-go", "ops-go", "drv-go", "so-go", "inline-create-go", "alert-act-do", "atc-btn", "cpn-cta", "acs-cta",
  "driver-route-cta", "craft-cta-b", "rf-btn", "ol-btn", "natt-btn", "brew-pack-btn", "vipv-btn", "status-photo-btn",
  "ev-arch-btn", "studio-lib-btn", "ac-team-btn", "dp-leave-btn", "note-fu-addbtn", "prod-86btn", "cal-filterbtn",
  "adm-reset-btn", "note-save", "note-cancel", "cfm-ok", "ts-btn", "liveinst-go", "eg-btn", "lp-receipt", "lp-save", "adm-regen",
  // 2026-10-09, the chip round: the 16 recipes the button round left, and the pill buttons, are the kit's
  "calw-add", "cmd-add", "conc-send", "cos-go", "cos-redo", "mpack-cta", "oa-cta", "oa-send", "rhythm-go", "rvp-send", "sc-save",
  "sc-reset", "scan-add", "studio-media-add", "sub-cta", "subpitch-cta", "arr-order", "t-order", "vipq-yes", "vipq-no",
  "orderbar-cancel", "ownerdet-convert-b", "bce-toggle", "oo-gen", "alert-clearall", "digest-clear", "codes-new", "codes-qr",
  "cal-tolink", "note-discuss", "brew-taste", "cmd-finish", "pbd-group-open", "pbd-group-all", "pd-start", "pd-adv", "pd-back",
  "pd-reopen", "pd-won", "pd-lost", "cos-act", "svc-exit", "guide-x", "sv-ic",
  // .handle was the house's "primary button" — red, 15px capitals — on 39 buttons (sign-in, checkout's Pay, the academy);
  // no -btn in its name, so the button round's count never saw it
  "handle",
];
/** The chip and tag recipes the kit's chip, tag and count replaced (rule 9, the chip round). */
export const RETIRED_PILLS = [
  "eta-chip", "mnt-chip", "dp-qchip", "dp-kchip", "cal-view", "cal-view-more", "ev-stage-pill", "adm-lead-opt", "chg-chip",
  "fdig-opt", "pbd-filter", "pbd-fn", "st-cat", "qd-vis-chip", "note-vischip", "note-tab", "crm-tier-b", "codes-toggle",
  "goal-chip", "mkt-chip", "pipe-rail-chip", "oa-chip", "ts-chip", "k-chip-sec", "k-tag-live", "qd-tab", "task-assign",
  "task-assign-av", "task-assign-add", "ac-cert", "ac-cdot", "guide-when", "acad-chip", "acs-tier", "alert-times", "cl-op-sec",
  "st-pill", "calw-today", "arch-st", "arch-mg", "arch-flow-i", "ol-state", "subnav-badge", "mypack-flag", "stamp-badge",
  "rva-src-tag", "mp-tier", "chub-lead-tag", "fn-conv", "fn-alt", "chg-month-n", "cmd-cd", "vipq-tag", "rdy-opt", "rdy-st",
  "goal-tier", "pay-status", "pb-status", "studio-card-camp", "codes-badge", "pd-status", "st-log-srcnote",
  "st-log-fu", "cmd-goalchip", "cmd-goalsel", "note-pfile", "ck-weigh", "osr-mean", "gtm-count", "pr-tier", "disc-kind", "ofr-chip",
];
/** What a rule outside the kit may not set on a kit button: its size, its shape, its letters, its fill. */
export const BUTTON_LOOK = /^(padding(-(top|right|bottom|left|inline|block)(-start|-end)?)?|(min-|max-)?height|border(-(top|bottom)-(left|right))?-radius|border(-(top|right|bottom|left))?(-width|-style)?|font(-(family|size|weight|style))?|letter-spacing|text-transform|line-height|background(-color|-image)?|box-shadow|text-decoration(-line)?)$/;
/** …and the utilities that would say the same on the element. */
export const BUTTON_LOOK_UTILITY = /^(p[xytrblse]?-|text-(caption2|caption|footnote|subhead|callout|body|title3|title2|title1|large)$|font-|leading-|tracking-|(uppercase|lowercase|capitalize|normal-case)$|rounded|(h|min-h|max-h|size)-|bg-|shadow|border(-[xytrblse])?(-\d+)?$|(underline|no-underline|line-through)$)/;

/** The classes written beside a kit button: in a className that holds a kit class, a <Button>'s className,
 *  and the className a btn() call is handed. Class token → the files it sits in. */
export function buttonCompanions(root) {
  const files = ["app", "components", "native"].flatMap((d) => walk(root, d, (n) => n.endsWith(".tsx")));
  const out = new Map();
  const add = (str, f) => { for (const c of str.split(/\s+/)) if (c && !KIT_BUTTONS.includes(c)) { if (!out.has(c)) out.set(c, new Set()); out.get(c).add(toPosix(f)); } };
  for (const f of files) {
    const src = readFileSync(join(root, f), "utf8");
    if (!/btn-(pri|sec|ter|del)|<Button\b|\bbtn\(/.test(src)) continue;
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const literals = (x, acc = []) => { if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) acc.push(x.text); else if (ts.isTemplateExpression(x)) acc.push([x.head.text, ...x.templateSpans.map((t) => t.literal.text)].join(" ")); ts.forEachChild(x, (c) => { literals(c, acc); }); return acc; };
    const visit = (n) => {
      if (ts.isJsxAttribute(n) && n.name.getText(sf) === "className" && n.initializer) {
        const owner = n.parent.parent;
        const isButton = (ts.isJsxOpeningElement(owner) || ts.isJsxSelfClosingElement(owner)) && owner.tagName.getText(sf) === "Button";
        const strs = ts.isStringLiteral(n.initializer) ? [n.initializer.text] : n.initializer.expression ? literals(n.initializer.expression) : [];
        for (const str of strs) if (isButton || str.split(/\s+/).some((c) => KIT_BUTTONS.includes(c))) add(str, f);
      }
      if (ts.isCallExpression(n) && n.expression.getText(sf) === "btn") {
        for (const a of n.arguments) if (ts.isObjectLiteralExpression(a)) for (const pr of a.properties)
          if (ts.isPropertyAssignment(pr) && pr.name.getText(sf) === "className") for (const str of literals(pr.initializer)) add(str, f);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** Rules outside the kit that size, round, letter or fill a kit button — named by a kit class, or by a class
 *  written beside one, in the selector's last compound (what it styles). */
export function buttonRestylesIn(ast, css, companions) {
  const from = css.indexOf("/* 03 · Buttons"), to = css.indexOf("/* 04 · Section header");
  const own = new Set([...KIT_BUTTONS, ...companions.keys()]);
  const out = [];
  ast.walkRules((r) => {
    if (r.parent?.type === "atrule" && /keyframes/i.test(r.parent.name)) return;
    const at = r.source?.start?.offset ?? -1;
    if (from >= 0 && at > from && at < to) return;
    const styled = r.selectors.some((s) => {
      const last = demanded(s).trim().split(/\s+|>|\+|~/).filter(Boolean).pop() || "";
      return [...last.matchAll(/\.([A-Za-z_][\w-]*)/g)].some((m) => own.has(m[1]));
    });
    if (!styled) return;
    const bad = [];
    r.each((d) => { if (d.type === "decl" && BUTTON_LOOK.test(d.prop)) bad.push(d.prop); });
    if (bad.length) out.push(`${r.selector.replace(/\s+/g, " ").slice(0, 60)} sets ${bad.join(", ")}`);
  });
  return out;
}

/** Button recipes outside the kit: a rule named for a button (-btn, -cta, -go, -send, -save, -add, -ok, -yes, -do)
 *  that draws a pressed box with words — a fill or a border, a size or a padding, and a pointer. One per class. */
export function buttonRecipesIn(ast) {
  const NAMED = /(^|-)(btn|cta|go|button|send|save|ok|yes|do|add)(-|$)/;
  const out = new Set();
  ast.walkRules((r) => {
    if (r.parent?.type === "atrule" && /keyframes/i.test(r.parent.name)) return;
    const d = {};
    r.each((n) => { if (n.type === "decl") d[n.prop] = n.value.trim(); });
    const fill = d.background || d["background-color"] || "";
    const box = (fill && !/^(none|transparent)$/.test(fill)) || /solid|dashed/.test(d.border || "");
    if (!box || !(d["font-size"] || d.padding || d["min-height"]) || d.cursor !== "pointer") return;
    for (const s of r.selectors) {
      const last = s.trim().split(/\s+|>|\+|~/).filter(Boolean).pop() || "";
      for (const m of last.matchAll(/\.([A-Za-z_][\w-]*)/g)) if (NAMED.test(m[1]) && !KIT_BUTTONS.includes(m[1]) && !/^k-/.test(m[1])) out.add(m[1]);
    }
  });
  return [...out].sort();
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
  for (const [c, files] of classListsIn(root)) {
    if (m.classes.has(c)) continue;   // a className names it too: said once, below
    if (RETIRED_BUTTONS.includes(c)) fail("one set of buttons", `${c} is a retired button recipe, in a class list (${[...files].join(", ")}) — use the kit (components/Button)`);
    if (RETIRED_PILLS.includes(c)) fail("one pill", `${c} is a retired chip or tag recipe, in a class list (${[...files].join(", ")}) — use the kit's .k-chip, .k-tag or .k-count`);
  }
  for (const [c, files] of m.classes) {
    if (/^dark:/.test(c)) fail("no dark:", `${c} in ${[...files].join(", ")}`);
    if (RETIRED_BUTTONS.includes(c)) fail("one set of buttons", `${c} is a retired button recipe (${[...files].join(", ")}) — use the kit (components/Button)`);
    if (RETIRED_PILLS.includes(c)) fail("one pill", `${c} is a retired chip or tag recipe (${[...files].join(", ")}) — use the kit's .k-chip, .k-tag or .k-count`);
    if (/(^|:)(bg|text|border|ring|fill|stroke|outline|shadow|from|to|via|decoration|accent|caret|divide)-\[(#|rgb|hsl|oklch|color)/.test(c)) fail("GT3's colours", `${c} writes a raw colour (${[...files].join(", ")}) — use a GT3 colour`);
    if (/(^|:)text-\[\d+(?:\.\d+)?(px|rem|em)\]/.test(c)) fail("one type scale", `${c} sets a size of its own (${[...files].join(", ")}) — name a step: text-caption2 … text-large`);
  }

  // 5 · one type scale: the house stylesheet's sizes, and the theme's steps
  const STEPS = [11, 12, 13, 15, 16, 17, 20, 22, 28, 34];
  const offStep = [...globals.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])).filter((v) => v <= 34 && !STEPS.includes(v));
  if (offStep.length) fail("one type scale", `${offStep.length} size(s) in app/globals.css off the ten steps: ${[...new Set(offStep)].join(", ")}px`);
  const themeSteps = [...tw.matchAll(/^\s*--text-([a-z0-9]+):\s*(\d+)px;/gm)].map((m) => Number(m[2]));
  if (JSON.stringify(themeSteps) !== JSON.stringify(STEPS) || !/--text-\*:\s*initial;/.test(tw)) fail("one type scale", `app/tailwind.css's text steps are ${themeSteps.join(" ")} — want ${STEPS.join(" ")}, and Tailwind's own sizes off (--text-*: initial)`);

  // 6 · a hover is a hover
  const ast = postcss.parse(globals);
  const loose = looseHoversIn(ast);
  if (loose.length) fail("a hover is a hover", `${loose.length} :hover rule(s) outside @media (hover:hover): ${loose.slice(0, 5).join(" | ")}`);

  // 7 · no dead CSS
  const dead = deadSelectorsIn(ast, wordsInCode(root));
  if (dead.length) fail("no dead CSS", `${dead.length} selector(s) style a class nothing names: ${dead.slice(0, 6).join(" | ")}`);

  // 8 · only down
  // 9 · one pill (counted with the ratchets below; the retired recipes styled nowhere)
  const pills = pillRulesIn(ast);
  const styledPills = RETIRED_PILLS.filter((c) => houseClasses(globals).has(c));
  if (styledPills.length) fail("one pill", `app/globals.css styles a retired chip or tag recipe: ${styledPills.join(", ")} — use the kit (.k-chip, .k-tag, .k-count)`);

  // 10 · one set of buttons
  const houseNow = houseClasses(globals);
  const styledRetired = RETIRED_BUTTONS.filter((c) => houseNow.has(c));
  if (styledRetired.length) fail("one set of buttons", `app/globals.css styles a retired button recipe: ${styledRetired.join(", ")} — use the kit (components/Button)`);
  const companions = buttonCompanions(root);
  const restyles = buttonRestylesIn(ast, globals, companions);
  if (restyles.length) fail("one set of buttons", `${restyles.length} rule(s) outside the kit size, round, letter or fill a kit button: ${restyles.slice(0, 4).join(" | ")}`);
  const utilityRestyles = [...companions].filter(([c]) => BUTTON_LOOK_UTILITY.test(c.split(":").pop().replace(/^!|!$/g, "")));
  if (utilityRestyles.length) fail("one set of buttons", `utilities restyle a kit button: ${utilityRestyles.slice(0, 6).map(([c, f]) => `${c} (${[...f][0]})`).join(", ")} — place it (margin, flex, width), never size or letter it`);
  const buttonRecipes = buttonRecipesIn(ast);

  const counts = { inlineStyles: m.inlineStyles, rawColours: rawColours(globals).size, globalsBytes: Buffer.byteLength(globals), wholeVariableClasses: m.wholeVariable.length, pillRules: pills.length, buttonRecipes: buttonRecipes.length };
  for (const [k, v] of Object.entries(counts)) {
    if (v > CEILING[k]) fail("only down", `${k} ${v} — ceiling ${CEILING[k]}. Up: new one-off layout goes in utilities (app/tailwind.css), not here.`);
    // Slack is room for new debt: a ceiling above the count is lowered in the commit that earned it.
    else if (v < CEILING[k]) fail("only down", `${k} ${v} — ceiling ${CEILING[k]} sits above it. Good; now lower the ceiling to ${v}.`);
  }
  return { bad, counts, markup: m, dead, loose, twice, pills, buttonRecipes };
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] || "").href) {
  const root = join(dirname(new URL(import.meta.url).pathname), "..");
  const { bad, counts, markup: m, pills, buttonRecipes } = await audit(root);
  if (process.argv.includes("--list")) {
    console.log(`  counts: ${JSON.stringify(counts)}`);
    console.log(`  class names taken whole from a variable:\n    ${m.wholeVariable.join("\n    ")}`);
    console.log(`  pill rules outside the kit:\n    ${pills.join("\n    ")}`);
    console.log(`  button recipes outside the kit: ${buttonRecipes.join(" ")}`);
  }
  const slack = Object.entries(counts).filter(([k, v]) => v < CEILING[k]).map(([k, v]) => `${k} ${v} < ${CEILING[k]}`);
  console.log(`CSS AUDIT: ${m.files.length} screen file(s) · ${m.classes.size} class name(s) · ${counts.inlineStyles} inline style object(s) · ${counts.rawColours} raw colour(s) in app/globals.css — ${bad.length} unanswered${slack.length ? ` (room to lower: ${slack.join(", ")})` : ""}`);
  for (const b of bad) console.log(`  ✗ ${b.rule}: ${b.what}`);
  process.exit(bad.length ? 1 : 0);
}

