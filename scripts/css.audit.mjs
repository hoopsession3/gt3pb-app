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
//                       with words — are counted, and the count only falls (8). Nor may a rule for a bare button
//                       or link in a box (.box button{…}) reach a kit control the box holds: a class and an element
//                       outrank the kit's class (the record box drew its primary as an outline). And a button whose
//                       every class is styled nowhere draws the browser's grey face (the crash screen's two did).
//  11. NO BUTTON IN DISGUISE  the button and chip recipes the name and radius tests could not see: a class a
//                       <button> or a link wears, whose own rule draws a pressed box with words (a fill or a border,
//                       a padding or a size, and a pointer). There were 158 on 2026-10-09 — .dops-mini on 22
//                       buttons, .gen-opt, .auth-tab, .tip-opt, .order-bar, .claim — and 86 moved onto the kits
//                       (round 7d). What stays is a row, a card, a check or the frame's own chrome, each named in
//                       UNNAMED_EXEMPT with why: there, the box is the thing (a row that opens its record, a pack to
//                       pick, a box that ticks), not a button's look. Any other is a recipe, and fails; an exemption
//                       whose class no longer draws one fails too, so the list only shrinks.
//  12. ONE FIELD        a field is the base field (app/globals.css FORM CONTROLS, 2): 16px words, 44pt tall, one fill,
//                       one edge, one corner. A container may draw its own (.prod-f input, .gl-f select — two parts,
//                       so they outrank the base), but no rule sets a field's words under 16px — an iPhone zooms into
//                       a smaller one the moment it is tapped, before the page can stop it, and 13px is hard to read
//                       while typing (2026-10-09, the forms round: 28 container rules drew 11 to 15, the console's
//                       forms on 189 fields among them). And no one-class field rule is written ABOVE the base: .app
//                       :where(…) weighs a class and comes later, so every property it sets is drawn by the base, not
//                       by the rule — from 2026-09-07 it had drawn its box over 50 recipes, 343 declarations that
//                       painted nothing (the emailed code's big digits, the copy editor's own type). A field that
//                       is not a form's field is written below the base (FORM CONTROLS, 10). A field is an input
//                       that is not a tick, a slider, a colour, a file or a button, a select or a textarea; its
//                       classes are read from every class list on one, and from a component that hands its
//                       className to one (PersonPick).
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
  inlineStyles: 554,          // style={{…}} objects in app/, components/, native/ (554 on 2026-10-10, the Command fold: the goals' intro and its margin went; 555 the same day, the Live Ops fold: Sunday delivery's and the office route's card paddings went — each is a fold now, padded by .mpanel-body; 557 on 2026-10-09, the sign-in round: the dead "Keep me signed in" row's margin went with it; 558 the same day, the navigation round: More's legend for the tab badges' two colours went with the badges; 560 the same day, the ordering pages: the guest story's three coloured dots went with it; 563 the same day, One home: Lead the week's margins left with it; 566 the same day, round 7d: the margins written inline beside the recipes that moved — the drops', the lists', the calendar filter's headings, the architecture page's views, the prep sheet's actions — are utilities; 575 the same day, the desk round: Brew's Recipes head took a utility for its 18px; 576 the same day, the chip round: the margins written inline beside .handle and the pills — sign-in's, the checkout's, the academy's, Find Us's — are utilities, and so are two sheet heads' rows; 598 the same day, the button round: sixteen buttons' margins and widths are utilities; 621 on 2026-10-07; 620 the same day — the overdue count's margin is a utility; 616 when Team's door became one; 614 on 2026-10-08 — the Guide's header is utilities, with its two pages)
  rawColours: 444,            // 444 on 2026-10-10 (the customer pages: the route map's own dark well went with the map); 445 on 2026-10-09 (the ordering pages: home-or-office and the menu's pack labels were drawn in literal reds — the chosen is the gold token now); 447 the same day (One home: the GTM card's fallback colours went with it); 448 the same day (round 7d: 16 went with the recipes — the drop board's and the 86 board's reds and greens, the concierge's browns, My Day's warning pink, the member card's sheen, the Edit pill's gold — and one came, paper's wash for the kit's icon button); 463 the same day (the chip round: 32 hand-mixed greens, blues, golds and reds went with the chip and tag recipes — a tag's colour is a --tone-* now); 495 the same day (the button round: two went with the recipes); 497 on 2026-10-08 (the foundations round: the dead brew-timer dot's teal went with it); distinct hex / rgb() / rgba() literals in app/globals.css (2026-10-07, after the dead rules went; 499 when Command and Team took theme tokens; 498 when the office route's card did)
  globalsBytes: 671_612,      // 671,612 on 2026-10-10 (the customer pages: the route map's rules — its well, tooltips, zoom bar and the red Directions laid over it — and the driver's "Pinning porches" line went with the map); 674,244 on 2026-10-10 (My Day 10: 39 spellings of the mono stack are var(--mono), its token, and a row's name runs to two lines before it is cut); 674,767 on 2026-10-10 (the Command fold: the twelve's twelve field-and-Log rows and their cards — a read view now, one sheet to log — and the portfolio's open add field); 676,299 the same day (the Live Ops fold: the office route's own card, the live event's header exception and the HUD's old .sec rule went — the fold is the card, and its row names the event); 677,172 on 2026-10-09 (Craft lines: the philosophy band, and an ingredient's paragraph — it opens in a sheet); 677,601 the same day (the sign-in round: the checkbox that did nothing, and its rules); 677,863 the same day (Business opens on Money: Money's tiles retired, and the stage line under them); 677,975 the same day (the navigation round: the tab badges and More's legend for them went — the bell is the one count); 678,302 the same day (the office link: /delivery's home-or-office cards went — the ZIP is the first question, an office a line under it); 679,101 the same day (the ordering pages: the delivery headline's card, the guest story's dots and its way to the bar, the red tint the chosen wore and the paper override that kept cream on a red tag); 680,087 the same day (the menu's one line: its tap hint and the drink rows' ingredient lines went, the order line lost its capitals); 680,372 the same day (One home: the retired GTM card's rules went, and the op card's display face is scoped to its title, .dayhead-op-t>b — .dayhead-op b drew the brief's Wear and Details labels in it); 680,903 the same day (the forms round: 279 field declarations the base field drew over went, the eight fields that are not a form's field moved below it, and three switch recipes are the kit's one); 685,387 the same day (round 7d: 86 button and chip recipes the name and radius tests could not see gave way to the kits, −31 KB); 717,944 the same day (the mark's screens: all ten that hold a GT3 mark are positioned, under a shorter note); 717,983 the same day (the chip round: 105 pill rules — chips, tags, pill buttons — the 16 button recipes and .handle gave way to the kit's chip, tag and count, −36 KB); 754,309 the same day (the button round: 31 recipes and the sheets' copies gave way to a kit of four kinds in two sizes); 766,799 on 2026-10-08 (the type round: 1,119 sizes folded onto the ten steps, 10.5px and 13.5px among them); 768,059 the same day (the navigation round: the system map's "‹ All layers" went into the title bar, and its rule with it); 768,213 the same day (the iPhone chrome round: the tab bar at 49pt, the KPI board's fields at 16px); 768,222 the same day (the foundations round: 50 rules no screen can match went — the old sheet, the .did and .cell rows, the menu's first draft — and the safe-area, tap-target and 16px-field fixes fit in what they left); app/globals.css, source bytes (2026-10-07: 804 KB before 316 dead rules and 4 keyframes went; the pill kit fits in what its seven recipes left;
                              // Command's and Team's clean-up added rows and actions and put their one-off layout in utilities; the office route on theme tokens)
  wholeVariableClasses: 34,   // className tokens that are a ${value} and nothing else (2026-10-07; 37 → 34 on 2026-10-09, round 7d: the menu and rig chips' skin map gave way to the kit's chip; 46 → 38 on 2026-10-09, the chip round: eight statuses that wrote their own class — a play's, a goal's, a discussion's kind, an offer letter's, the launch's verdict and checks, a Studio piece's — choose a tag's tone among written words; 38 → 37 the same day, the desk round: the shell's class is written in pieces, "app desk-shell" a string of its own so Tailwind reads desk-shell)
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

/** The components that hand their className to one of `tags` — a function whose parameter takes className and whose
 *  JSX gives it, as it is, to a <button> (InlineCreate) or a field (PersonPick): what a screen passes it is that
 *  element's class list. */
export function relaysIn(root, files, tags) {
  const out = new Set();
  for (const f of files) {
    const src = readFileSync(join(root, f), "utf8");
    if (!src.includes("className={className}")) continue;
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const hands = (body) => {
      let yes = false;
      const v = (n) => {
        if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && tags.includes(n.tagName.getText(sf))) {
          const c = n.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "className");
          if (c?.initializer && ts.isJsxExpression(c.initializer) && c.initializer.expression && ts.isIdentifier(c.initializer.expression) && c.initializer.expression.text === "className") yes = true;
        }
        if (!yes) ts.forEachChild(n, v);
      };
      v(body);
      return yes;
    };
    const takes = (params) => params.some((p) => ts.isObjectBindingPattern(p.name) && p.name.elements.some((e) => (e.propertyName ?? e.name).getText(sf) === "className"));
    const visit = (n) => {
      if (ts.isFunctionDeclaration(n) && n.name && n.body && takes(n.parameters) && hands(n.body)) out.add(n.name.text);
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) && takes(n.initializer.parameters) && hands(n.initializer.body)) out.add(n.name.text);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** Rule 12: the classes a field wears — an input that is not a tick, a slider, a colour, a file or a button, a select
 *  or a textarea — from every class list on one, and from a component that hands its className to one. */
export function fieldClassesIn(root) {
  const files = ["app", "components", "native"].flatMap((d) => walk(root, d, (n) => n.endsWith(".tsx")));
  const NOT_A_FIELD = /^(checkbox|radio|range|color|file|hidden|submit|button|image|reset)$/;
  const relay = relaysIn(root, files, ["input", "select", "textarea"]);
  const strings = (n, out = []) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) { out.push(n.head.text); for (const sp of n.templateSpans) { strings(sp.expression, out); out.push(sp.literal.text); } }
    else ts.forEachChild(n, (c) => strings(c, out));
    return out;
  };
  const out = new Map();
  for (const f of files) {
    const src = readFileSync(join(root, f), "utf8");
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n) => {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const tag = n.tagName.getText(sf);
        const attr = (k) => n.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === k);
        const type = attr("type")?.initializer && ts.isStringLiteral(attr("type").initializer) ? attr("type").initializer.text : "";
        const field = tag === "select" || tag === "textarea" || (tag === "input" && !NOT_A_FIELD.test(type)) || relay.has(tag);
        const cls = attr("className");
        if (field && cls?.initializer) for (const t of strings(cls.initializer)) for (const c of t.split(/\s+/)) if (/^[A-Za-z_][\w-]*$/.test(c)) { if (!out.has(c)) out.set(c, new Set()); out.get(c).add(toPosix(f)); }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** Rule 12: the base field rule; the rules that set a field's words under 16px; and the one-class field rules written
 *  above the base, with what they set that the base draws instead. */
export function fieldRulesIn(ast, fieldClasses) {
  let base = null;
  ast.walkRules((r) => { if (!base && /^\.app :where\(select\)/.test(r.selector.trim())) base = r; });
  const baseProps = new Set();
  base?.each((d) => d.type === "decl" && baseProps.add(d.prop));
  const SMALL_TOKEN = /^var\(--text-(caption2|caption|footnote|subhead)\)$/;
  const small = [], dead = [];
  const sizeOf = (r) => { let v = null; r.each((d) => { if (d.type !== "decl") return; if (d.prop === "font-size") v = d.value.trim(); if (d.prop === "font") { const m = d.value.match(/(\d+(?:\.\d+)?)px/); if (m) v = m[1] + "px"; } }); return v; };
  const reaches = (sel) => {
    const last = sel.trim().split(/\s+|>|\+|~/).filter(Boolean).pop() || "";
    const bare = last.replace(/::?[\w-]+(\((?:[^()]|\([^()]*\))*\))?/g, "");
    if (/^(input|select|textarea)\b/.test(bare) && !/\[type="?(checkbox|radio|range|color|file)"?\]/.test(last)) return true;
    return [...bare.matchAll(/\.([A-Za-z_][\w-]*)/g)].some((m) => fieldClasses.has(m[1]));
  };
  ast.walkRules((r) => {
    if (r.parent?.type === "atrule" && /keyframes/i.test(r.parent.name)) return;
    const v = sizeOf(r);
    const under = v && ((/px$/.test(v) && parseFloat(v) < 16) || SMALL_TOKEN.test(v));
    if (under) for (const sel of r.selectors) if (reaches(sel)) small.push(`${sel.trim()} {font-size: ${v}}`);
    if (!base || r.source.start.line >= base.source.start.line) return;
    for (const sel of r.selectors) {
      const m = sel.trim().match(/^\.([A-Za-z_][\w-]*)$/);
      if (!m || !fieldClasses.has(m[1])) continue;
      const lost = [];
      r.each((d) => { if (d.type === "decl" && !d.important && (baseProps.has(d.prop) || d.prop === "background" || d.prop === "font" || /^border(-(top|right|bottom|left))?(-(width|style|color))?$/.test(d.prop) || /^padding-/.test(d.prop))) lost.push(d.prop); });
      if (lost.length) dead.push(`.${m[1]} (line ${r.source.start.line}: ${lost.join(", ")})`);
    }
  });
  return { base, baseSize: base ? sizeOf(base) : null, small, dead };
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
/** Rule 11's exemptions: what draws a box on a <button> and is not a button's look — by kind, with why. */
export const UNNAMED_EXEMPT = {
  // the row is the button, as the kit's InfoRow is: it opens its record, a disclosure, a field's editor, a switch's row
  rows: ["prep-collapse", "tm-hire-open", "assign-row", "eg-row", "office-toggle", "alerts-strip", "rdg-opt",
    "dp-draftrow", "tm-hire-row", "so-row", "pnotes-row", "ev-fieldbtn", "cl-op", "sales-opp", "brew-logrow", "team-crm-link",
    "garage-head", "cmd-week", "notif-cat", "place-again", "note-file-open", "disc-row", "tm-open", "ofr-row", "ev-golive"],
  // a card or a tile that is one choice or one door — a pack, a day, a module, a photo, a calendar's entry
  cards: ["dl-card", "ev-prep", "oa-day", "ac-mod", "studio-thumb", "subpitch-pack", "ac-prod", "ac-opt", "ac-ackcard",
    "guide-create", "prep-card", "lib-cell", "studio-card", "calw-ev", "arch-tile", "cc-chip", "dp-tab", "mini-m", "brew-recipe",
    "intake-drop", "oa-usual", "oa-tile", "svc-enter", "mp-flex", "shop-card"],
  // a box that ticks, a score's cells, a drop's stages, a photo's own toolbar, the Display sheet's four A's (each drawn at
  // the size it picks — and the shell, which carries the sheet, carries no control's code)
  checks: ["rdy-check", "pbd-check", "goal-init-ck", "brew-score-b", "osr-chip", "dops-stage", "ms-b", "rdg-size"],
  // a switch drawn as a tile with its caption (an event's Order ahead and Pickup, side by side): the iOS switches are
  // the kit's .k-switch (2026-10-09, the forms round)
  switches: ["oa-toggle"],
  // the frame's own: the cart bars, the update prompt, the rail's and the help's edge tabs, the account's face, the
  // wallets' own badges (Apple's and Google's artwork rules)
  chrome: ["cartbar", "shop-cartbar", "sw-update", "rail-fold", "rail-open", "conc-fab", "rdg-fab", "chub-tab", "acct-av", "mp-wallet"],
};

/** Rule 11: classes a <button>, a link or a <Link> wears whose own rule draws a pressed box with words — a fill or a
 *  border, a padding, a size or a height, and a pointer — outside the kits. Class → where it is worn. */
export function unnamedRecipesIn(root, ast) {
  const files = ["app", "components", "native"].flatMap((d) => walk(root, d, (n) => n.endsWith(".tsx")));
  const worn = new Map();
  for (const f of files) {
    const src = readFileSync(join(root, f), "utf8");
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n) => {
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && /^(button|a|Link|LeaveButton)$/.test(n.tagName.getText(sf))) {
        for (const p of n.attributes.properties) {
          if (!ts.isJsxAttribute(p) || p.name.getText(sf) !== "className" || !p.initializer) continue;
          for (const m of p.initializer.getText(sf).matchAll(/[A-Za-z_][\w-]*/g)) {
            if (!worn.has(m[0])) worn.set(m[0], `${toPosix(f)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  const out = new Map();
  ast.walkRules((r) => {
    if (r.parent?.type === "atrule" && /keyframes/i.test(r.parent.name)) return;
    const d = {};
    r.each((n) => { if (n.type === "decl") d[n.prop] = n.value.trim(); });
    const fill = d.background || d["background-color"] || "";
    const box = (fill && !/^(none|transparent|inherit)$/.test(fill)) || /solid|dashed/.test(d.border || "");
    if (!box || !(d["font-size"] || d.padding || d["min-height"] || d.height) || d.cursor !== "pointer") return;
    for (const sel of r.selectors) {
      const last = sel.trim().split(/\s+|>|\+|~/).filter(Boolean).pop() || "";
      for (const m of last.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
        if (/^(btn-|k-)/.test(m[1]) || !worn.has(m[1])) continue;
        out.set(m[1], worn.get(m[1]));
      }
    }
  });
  return out;
}

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

/** Rule 10's blind spot: a rule for a bare element in a box — `.box button{…}` — outranks a kit class on that
 *  element (a class and an element beat a class), so where the box holds a kit control the rule draws over it.
 *  (2026-10-09: .ownerdet-wrap-actions button drew the record box's kit primary as an outline, and .adm-status
 *  button the booking request's doors.) The box's own words in the screens are read; a kit control inside it fails. */
export function elementRestylesIn(root, ast) {
  const rules = [];
  ast.walkRules((r) => {
    if (r.parent?.type === "atrule" && /keyframes/i.test(r.parent.name)) return;
    const props = [];
    r.each((d) => { if (d.type === "decl" && BUTTON_LOOK.test(d.prop)) props.push(d.prop); });
    if (!props.length) return;
    for (const sel of r.selectors) {
      const parts = demanded(sel).trim().split(/\s+|>|\+|~/).filter(Boolean);
      const last = parts.pop() || "";
      const el = last.match(/^(button|a)(?=$|[:\[])/);
      if (!el) continue;
      const box = [...parts].reverse().map((x) => [...x.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1])).find((cs) => cs.length);
      if (box) rules.push({ box, el: el[1], props, sel: sel.trim().replace(/\s+/g, " ") });
    }
  });
  const out = [];
  if (!rules.length) return out;
  const KIT = new RegExp(`(^|[\\s"'\`{])(${[...KIT_BUTTONS.filter((c) => c !== "btn-sm" && c !== "btn-wide"), "k-chip", "k-icon-btn", "k-seg-opt"].join("|")})([\\s"'\`}]|$)`);
  const has = (text, c) => new RegExp(`(^|[\\s"'\`{])${c}([\\s"'\`}]|$)`).test(text);
  const files = ["app", "components", "native"].flatMap((d) => walk(root, d, (n) => n.endsWith(".tsx")));
  for (const f of files) {
    const src = readFileSync(join(root, f), "utf8");
    if (!rules.some((r) => r.box.every((c) => src.includes(c)))) continue;
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const classOf = (open) => { for (const p of open.attributes.properties) if (ts.isJsxAttribute(p) && p.name.getText(sf) === "className" && p.initializer) return p.initializer.getText(sf); return ""; };
    const visit = (n, inside) => {
      let here = inside;
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
        const open = ts.isJsxElement(n) ? n.openingElement : n;
        const c = classOf(open), tag = open.tagName.getText(sf);
        if (inside.length && /^(button|a|Link)$/.test(tag) && KIT.test(c)) {
          for (const r of inside) if (r.el === "button" ? tag === "button" : tag !== "button") out.push(`${r.sel} sets ${r.props.join(", ")} on a kit control (${toPosix(f)}:${sf.getLineAndCharacterOfPosition(open.getStart(sf)).line + 1})`);
        }
        const mine = rules.filter((r) => r.box.every((x) => has(c, x)));
        if (mine.length) here = [...inside, ...mine];
      }
      ts.forEachChild(n, (k) => visit(k, here));
    };
    visit(sf, []);
  }
  return out;
}

/** A <button> whose every class is styled nowhere — not by the house stylesheet, not by a utility — draws the browser's
 *  own grey face (2026-10-09: the crash screen's Try again and Reload, .act-btn, and the delivery loop's entries).
 *  Read where the classes are written words; a className from a variable is the screen's to answer for. */
export function greyButtonsIn(root, styled) {
  const files = ["app", "components", "native"].flatMap((d) => walk(root, d, (n) => n.endsWith(".tsx")));
  // a component that hands its className to a <button> (InlineCreate) draws that button: the classes a screen gives
  // it are the button's (the shoot planner's + Shot and + New shoot were the browser's grey face from 2026-07-13)
  const relay = relaysIn(root, files, ["button"]);
  const out = [];
  for (const f of files) {
    const src = readFileSync(join(root, f), "utf8");
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n) => {
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && (n.tagName.getText(sf) === "button" || relay.has(n.tagName.getText(sf)))) {
        const cls = n.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "className");
        const text = cls?.initializer && ts.isStringLiteral(cls.initializer) ? cls.initializer.text : null;
        const words = text ? text.split(/\s+/).filter(Boolean) : [];
        if (words.length && words.every((w) => !styled(w))) out.push(`"${text}" (${toPosix(f)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1})`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
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
  const twBuilt = houseClasses(tw);
  const grey = greyButtonsIn(root, (c) => houseNow.has(c) || twBuilt.has(c) || !!ds.candidatesToCss([c])[0]);
  if (grey.length) fail("one set of buttons", `${grey.length} button(s) whose every class is styled nowhere — the browser's grey face: ${grey.slice(0, 4).join(", ")}`);
  const boxRestyles = elementRestylesIn(root, ast);
  if (boxRestyles.length) fail("one set of buttons", `${boxRestyles.length} rule(s) for a bare button or link in a box draw over the kit control it holds: ${boxRestyles.slice(0, 3).join(" | ")} — a class and an element outrank the kit's class; style the box's own buttons by their class`);
  const utilityRestyles = [...companions].filter(([c]) => BUTTON_LOOK_UTILITY.test(c.split(":").pop().replace(/^!|!$/g, "")));
  if (utilityRestyles.length) fail("one set of buttons", `utilities restyle a kit button: ${utilityRestyles.slice(0, 6).map(([c, f]) => `${c} (${[...f][0]})`).join(", ")} — place it (margin, flex, width), never size or letter it`);
  const buttonRecipes = buttonRecipesIn(ast);

  // 11 · no button in disguise
  const unnamed = unnamedRecipesIn(root, ast);
  const exempt = Object.values(UNNAMED_EXEMPT).flat();
  for (const [c, at] of unnamed) if (!exempt.includes(c)) fail("no button in disguise", `.${c} (${at}) draws a button of its own — use the kit (components/Button, .k-chip, the segmented control, .k-icon-btn), or name it in UNNAMED_EXEMPT with why`);
  const stale = exempt.filter((c) => !unnamed.has(c));
  if (stale.length) fail("no button in disguise", `UNNAMED_EXEMPT names ${stale.join(", ")}, which no longer draw a box on a button — take them off the list`);

  // 12 · one field
  const fields = fieldRulesIn(ast, fieldClassesIn(root));
  if (!fields.base) fail("one field", "app/globals.css has no base field (.app :where(select), .app :where(input…), .app :where(textarea)) — FORM CONTROLS, 2");
  else if (fields.baseSize !== "16px") fail("one field", `the base field's words are ${fields.baseSize} — 16px: an iPhone zooms into a smaller field the moment it is tapped`);
  if (fields.small.length) fail("one field", `${fields.small.length} rule(s) set a field's words under 16px: ${fields.small.slice(0, 4).join(" | ")} — 16px, the base field's`);
  if (fields.dead.length) fail("one field", `${fields.dead.length} one-class field rule(s) written above the base field set what the base draws instead: ${fields.dead.slice(0, 4).join(" | ")} — the base (.app :where(…)) weighs a class and comes later; place the field (margin, flex, max-width) or write its look below FORM CONTROLS (10)`);

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

