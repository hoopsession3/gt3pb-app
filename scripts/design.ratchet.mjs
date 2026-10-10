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
// ONE TYPE SCALE (2026-10-08, the type round: redesign 6). Every size folded onto Apple's ten steps, nothing under
// 11px: each sheet's and screen's smallest text is 11 now (12 on the purchase and collect sheets), and the floors
// below were raised to it. The brew sheet's chips stand 32px with their 11px words (31 at 10px).
// A second double, same rules (2026-10-03): the brew sheet, after Ryan scored it 5/10 from his
// phone. Its own ceilings: depth 4 is the kit's segmented control (a filled option inside its
// bordered track, inside the sheet); 31 px was the house chip (.ts-chip) — every chip in the console was that height.
// The chip round (2026-10-09) made that decision for all of them: the kit's chip is 36pt and reaches 44.
const BREW_FIXTURE = join(ROOT, "scripts/fixtures/brew-sheet.html");
export const BREW_SHEET = { depth: 3, tap: 40, text: 11 };  // tap 32 → 40 (2026-10-09, the chip round): the chips are the kit's, 36pt and 44 to the thumb
// The event record sheet with its ways out (2026-10-03). Depth 6 is the box inside the finding
// inside the gaps block inside the sheet — an honest nesting, since the finding IS the form. The
// floor that matters is the tap: 44, because the box these controls share with OwnerDetails
// measured 31px before the sheets started drawing it.
const RECORD_FIXTURE = join(ROOT, "scripts/fixtures/record-sheet.html");
export const RECORD_SHEET = { depth: 5, tap: 44, text: 11 };
// The purchase sheet (2026-10-04) — Money › Spend's five-field form became a capture sheet in the
// quick-actions dock, after Ryan asked whether an open form under the report was the right shape. It
// is used one-handed at a register, so its tap floor is 44 like the record sheet's.
const PURCHASE_FIXTURE = join(ROOT, "scripts/fixtures/purchase-sheet.html");
export const PURCHASE_SHEET = { depth: 3, tap: 44, text: 12 };  // depth 2 → 3 (2026-10-09, the chip round): the dock's four tools are the kit's segmented control in the sheet's head — a chosen option on its track, inside the sheet
// My Day (2026-10-04) — the screen the console opens on, after Ryan's 10:13 PM screenshot: the top
// three painted as grey slabs in the day theme, the greeting a lowercase fragment wedged under them.
// The section's own content, measured: depth 2 is the brief inside today's op card; 44 is every
// control once the task tick was widened from its 26px box and a one-line top-three item was given
// a floor (it measured 35); 10 is the eyebrows, at the type floor.
const MYDAY_FIXTURE = join(ROOT, "scripts/fixtures/my-day.html");
export const MY_DAY = { depth: 2, tap: 44, text: 11 };
// One event's prep screen (2026-10-04, Ryan's 10:44 PM screenshot of the Dear Deandra Jazz Brunch,
// three weeks out with no pick list). Measured after the pass: depth 2 is a tool card's line inside
// the card; 44 is every control — "+ Add" on the brief measured 22, "Edit details" 24, "Add to
// calendar" and "‹ All prep" 28 before it; 10 is the eyebrow over the event's name, at the floor.
const PREP_FIXTURE = join(ROOT, "scripts/fixtures/prep-target.html");
export const PREP_TARGET = { depth: 2, tap: 44, text: 11 };
// Money at the window (2026-10-04, 0341): two tickets on the pass — one owed with its "Collect",
// one collected with the collector's undo — under the sheet "Picked up" opens on an owed ticket.
// Worked one-handed through a window. Measured: depth 3 is an answer's card inside the sheet's panel
// inside its scrim; 44 is every control (the ticket's ⋯ is 44 only inside .admin, which is why the
// fixture carries that class); 11.5 is a ticket's money line. It first measured depth 2 — over the
// tickets alone, because the measurement roots at .screen when there is one and the fixture had
// one, so the sheet was never read. Corrected with the rule sheet (0342), which is how it was found.
const COLLECT_FIXTURE = join(ROOT, "scripts/fixtures/collect-sheet.html");
export const COLLECT_SHEET = { depth: 2, tap: 44, text: 12 };
// One permit rule, opened (2026-10-04, 0342): the SC event rule 0284 left unconfirmed, its re-check
// form and the owner's correction form, the deadline's counts as chips. Filled in on a phone, often
// on the call to the county; the limits are what it measured when it was built.
const RULE_FIXTURE = join(ROOT, "scripts/fixtures/rule-sheet.html");
export const RULE_SHEET = { depth: 2, tap: 44, text: 11 };
// The checkout, for an order placed before the stop opens (2026-10-04, 0343): the pickup block —
// where, then when it is made — above the money, and the confirmation the server's answer fills.
// A guest at the window with a drink in the other hand. Measured when built: depth 4 is a quantity
// stepper inside its order line and a receipt row inside the receipt (inside the sheet, inside its
// scrim) — both as checkout and every purchase confirmation have drawn them since July; the pickup
// block this adds sits at 3. 44 is every control, once "Not now" stopped being a 15px line of text
// (.sub-link, the same day). 10 is the receipt's labels, at the floor.
const CHECKOUT_FIXTURE = join(ROOT, "scripts/fixtures/checkout-sheet.html");
export const CHECKOUT_SHEET = { depth: 3, tap: 44, text: 11 };
// EVERY SHEET ONE BOX SHALLOWER (2026-10-05, the gesture round). The depths above were measured with
// the scrim as a painted box around every sheet ("inside the sheet, inside its scrim"). The scrim's dim
// and blur are a layer of their own now (.sheet2-scrim::before — so a pull can lighten them without
// fading the sheet, which is the scrim's child), and the measurement, which reads painted boxes, no
// longer counts the scrim. Each sheet ceiling came down by that one box; nothing inside a sheet moved.
const SHEETS = [
  { name: "brew sheet",     file: BREW_FIXTURE,     rel: "scripts/fixtures/brew-sheet.html",     limits: BREW_SHEET },
  { name: "record sheet",   file: RECORD_FIXTURE,   rel: "scripts/fixtures/record-sheet.html",   limits: RECORD_SHEET },
  { name: "purchase sheet", file: PURCHASE_FIXTURE, rel: "scripts/fixtures/purchase-sheet.html", limits: PURCHASE_SHEET },
  { name: "My Day screen",  file: MYDAY_FIXTURE,    rel: "scripts/fixtures/my-day.html",         limits: MY_DAY },
  { name: "prep screen",    file: PREP_FIXTURE,     rel: "scripts/fixtures/prep-target.html",    limits: PREP_TARGET },
  { name: "collect sheet",  file: COLLECT_FIXTURE,  rel: "scripts/fixtures/collect-sheet.html",  limits: COLLECT_SHEET },
  { name: "rule sheet",     file: RULE_FIXTURE,     rel: "scripts/fixtures/rule-sheet.html",     limits: RULE_SHEET },
  { name: "checkout sheet", file: CHECKOUT_FIXTURE, rel: "scripts/fixtures/checkout-sheet.html", limits: CHECKOUT_SHEET },
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
  cardRules: 649,        // 650 → 649 on 2026-10-09 (One home): the GTM card (.gtm) went with its component — the briefing is Command's, the intake is Quick actions › File. 689 → 650 on 2026-10-09 (the forms round: 39 field rules that drew their own box — a radius with a border or a fill — went with the declarations the base field drew over, and three switch recipes are the kit's one). 689 the same day, counted with the stylesheet's comments set aside (a note above a rule hid it from the count: 539 were seen; Studio's calendar's Week · Month, two more, is the segmented control); 618 → 539 the same day (round 7d: 86 button and chip recipes the name and radius tests could not see — each a card of its own — are the kit's buttons, chips, segmented control and icon buttons). 723 → 618 (2026-10-09, the chip round: the chip, tag and pill-button recipes and the 16 last button recipes — each a card of its own — are the kit's chip, tag, count and buttons, one rule per primitive). 751 → 723 (2026-10-09, the button round: 28 rules that drew a button as a card of its own went with the 31 recipes). 756 → 751 (2026-10-08, the foundations round: dead card recipes went — .cell, .rsvp, .note-tasks-prev, .supply-sheet, .domain). rules that make a card: radius + (border | fill). 759 → 756 (2026-10-07, Ryan's "Ewww" on Command and Team): the portfolio's rows sit on the page (.osr-row, .osr-dot, .osr-owner were cards), the role badge and the invite pills went with the second door (.tm-badge, .tinv-role), the overdue line's box is utilities; + the team's week line (.cmd-week) and the score's dot. 810 → 766 (2026-10-07, the Tailwind round): 44 of them styled classes no screen names any more — the old account menu, the pre-kit display, the strategy board, the old craft steps, the isheet — and went with the 320 dead rules scripts/css.audit.mjs now keeps at zero. 809 → 810 (2026-10-06, the settings round, Settings as a list): + .set-list, the grouped list each Settings section's rows sit on (a card by what it is); + the segmented control's track and segment (.set-seg, .set-seg > button — Appearance's Day · Dark · Auto, 40px tall where 27px pills were); − the lane cards (.ws-card: one lane per row now); − the floating moon (.theme-toggle: Appearance lives in Settings). 810 → 809 (2026-10-06, the settings round): the "More controls" card (.set-card), five cards pointing out of Settings at controls that are in Settings now — retired with its map; Settings draws with .mpanel, SectionHeader and .pay-row and adds no card CSS. 809 → 810 (2026-10-05, the gesture round): "Discard your changes?" — the card a sheet asks the question on, over the sheet, at the thumb (.sheet2-ask-card); it is a card by what it is. The toast's Undo is a text action, not a pill, so it adds none. 810 → 809: the quiet Outlook line, retired with the not-configured bar it styled (2026-10-05). 814 → 810: the old My Day's flag cards, its Ack/Open buttons and the inbox count — dead since one task, one place, removed with the rest of its CSS (2026-10-04). 818 → 817: the account sheet lost its stat tiles (2026-10-02). 817 → 815: My Day's own event card and its LIVE pill, folded into the one op card (2026-10-04). 815 → 814: the headline's "Top 3" cards, whose tasks were all on the screen already (one task, one place, 2026-10-04) 766 → 759 (2026-10-07, the pill round): the crew header's bell, Jump and Guide, the section pills and the count pill were each a card-making rule of their own; the kit's pills make one per primitive.
  rawRadii: 26,          // distinct border-radius values that are not a --r-* token, 50% or 0. 26 on 2026-10-09, counted with the comments set aside (23 were seen); 24 → 23 the same day (round 7d: the last 22px — the shop orders' filters and My Day's rhythm — went to the kit). 25 → 24 (2026-10-09, the chip round: the last 9px pill-ish buttons went to the kit). 27 → 26 (2026-10-07): the only rule with its value was a dead one (scripts/css.audit.mjs); 26 → 25 (the pill round): calc(var(--r-xl) - 3px) was the old segmented control's option
  dupSelectors: 79,      // 79 on 2026-10-09, counted with the comments set aside (42 were seen); 44 → 42 the same day (round 7d: .lst-live, declared twice, went with its recipe, and a note came to stand above one of .note-fu-h's three). 50 → 44 (2026-10-09, the chip round: selectors declared twice went with their recipes — .handle, .goal-chip, .cal-view, .oa-cta.ghost, .mypack-flag.paid, and .note-fu-add, the follow-up row and the + Add button that shared its name). 51 → 50 (2026-10-09, the button round: .spl-cta:focus-visible, declared twice, went with the splash's recipe). 52 → 51 (2026-10-08: .menucat .wn, declared twice, went with the dead menu draft). single top-level selectors declared more than once (55 → 54: .crew-group retired, 2026-10-02; 54 → 53: .myday-live, declared twice, retired with the card it lived on, 2026-10-04; 53 → 52: .crew-jump .crew-jump-k, retired with Jump's pill, 2026-10-07)
  rootBlocks: 1,         // separate `:root{` blocks — tokens have one home (6 → 1 on 2026-10-02: motion, spring, eyebrow tracking, color-scheme and the radius scale folded in)
  subFloorFontRules: 0,  // px font-sizes under THE TYPE FLOOR (10px, see the note in globals.css). 184 → 0 on 2026-10-02
  darkWells: 22,         // fills of literal black at 10–44% with no rule for a light surface — see darkWellCounts. 24 → 22 on 2026-10-09 (the forms round): the old switch's track (.ev-toggle-track) is the kit's switch, and the strategy note (.pd-strategy) is the base field. 25 → 24 the same day (round 7d): the home page's dial-in answers (.gen-opt) are the kit's chips. 26 → 25 on 2026-10-07 (Your GT3): the office route's empty-jugs stepper (.oo-jug) takes the theme's surface, and its card (.oo), black in the day theme from an undefined --panel, takes --card. 31 → 26 on 2026-10-07 (Ryan: "Ewww", Command and Team in the day theme): the portfolio's rows (.osr-row, flat on the page now), the goal pick (.cmd-goalsel), and Team's activity rows and Command's KPI rows and inputs (.util-row, .kpib-row, .kpib-in input — a day surface each). 34 → 31 on 2026-10-07: three were in rules that styled nothing (the dead CSS, scripts/css.audit.mjs). Measured 37 the day it was written (2026-10-04); 37 → 35 that day: the task checkbox and My Day's top three; 35 → 34 on 2026-10-05: a venue's contact block (.vlink), now under the venue pick on the event card and on Route
  selectClassShorthands: 0, // rules that paint a class some <select> carries with the `background` shorthand (selectClassShorthands). Measured 25 the day it was written (2026-10-04) and 25 → 0 that day: background-color, the way the rest of the selects are painted — the stripes under OsRegistry's Status pick (.note-in), and the arrow the day theme erased from the brew board's status, the goal and shoot owner picks, the assignee picks and the rest
  undefinedTokens: 0,    // var(--x) reads with no fallback of a custom property nothing defines — see undefinedTokens(). 1 → 0 the day it was written (2026-10-06): the Academy's progress track, var(--ink-onLight-08), a step the scale never had
  selectShorthands: 0,   // rules on a <select> that paint with the `background` SHORTHAND. It resets background-repeat, and the chevron the app draws on every select then tiles across it — stripes, in the day theme, on every select whose container had one (Ryan's brew sheet, 2026-10-03). 19 → 0: colour is background-color.
  maxLeafDepth: 3,       // boxes around the innermost box on the Plan screen (was 4; 2 → 3 on 2026-10-09, the chip round: the calendar's views are the kit's segmented control, Calendar's Day · Week · Month, and its chosen option sits on its track inside the calendar's card, as the brew sheet's does)
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
//                     A BLIND HEADER IS THE WALL, NOT A CLOSED ROW (2026-10-06, the settings round).
//                     A closed panel that says what is inside — a `sub` line under its title, and its
//                     value where it has one — is a list row, the way a phone's Settings is a list of
//                     closed rows. Opening the big ones at rest to satisfy this gate made Settings a
//                     fourteen-screen form wall (the copy editor, Train the AI, invites, all open). So
//                     the count is of closed panels with nothing under their title.
export const FRICTION = {
  nativeDialogs: 0,
  crewGroupTitles: 0,
  collapsedPanels: 15,   // 17 → 15 on 2026-10-06 (the settings-by-category round): the merch and the lessons left Money for the Catalog, where every row says what it holds — and a sub written as an expression (a row that reads one way to an owner, another to an admin) counts as the sub line it is. 34 → 17 on 2026-10-06 (the settings round): the count is of BLIND closed panels now — Settings' rows each say what they hold (a sub line), and every panel it drew was one; 17 blind headers are left, in Money, Customers, Team and the rest. 33 → 34 on 2026-10-02: Settings › Advanced › Errors — the reading end of the error intake, closed at rest like its neighbours
};

// ── A TOKEN NOBODY DEFINED (2026-10-06, the settings round) ─────────────────────────────────────
// var(--ink-onLight-08) painted the Academy's progress track, and --ink-onLight-08 was never defined
// (the scale has 03, 04, 05, 16, 18 and 24), so the track drew nothing, in either theme, from the day
// it was written. Found reaching for the same step for Settings' segmented control. A custom property
// read with no fallback that nothing defines — not the stylesheet, not a component's style prop — is a
// declaration that silently does nothing. A string literal naming the token in a component counts as
// defining it (style={{ ["--c" as string]: … }}, setProperty("--x", …)).
export function undefinedTokens(css, read = (p) => readFileSync(join(ROOT, p), "utf8"), list = (d) => readdirSync(join(ROOT, d), { recursive: true })) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const defined = new Set([...bare.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const dir of ["components", "app", "lib"]) {
    for (const f of list(dir)) {
      if (!/\.tsx?$/.test(String(f))) continue;
      let src; try { src = read(`${dir}/${f}`); } catch { continue; }
      for (const m of src.matchAll(/["'`](--[\w-]+)["'`]/g)) defined.add(m[1]);
    }
  }
  const missing = new Map();
  for (const m of bare.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) if (!defined.has(m[1])) missing.set(m[1], (missing.get(m[1]) || 0) + 1);
  return { undefinedTokens: [...missing.values()].reduce((a, b) => a + b, 0), undefinedTokenList: [...missing.entries()] };
}

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
    // A sub line given as words or as an expression (a row that says one thing to an owner and another
    // to an admin, 2026-10-06) is a sub line all the same.
    for (const m of code.matchAll(/<Panel\b([^>]*)>/g)) if (!/defaultOpen/.test(m[1]) && !/\bsub=["{]/.test(m[1])) collapsedPanels++;
  }
  return { nativeDialogs, crewGroupTitles, collapsedPanels };
}

// ── A SELECT PAINTED THROUGH ITS CLASS (2026-10-04) ─────────────────────────────────────────────
// selectShorthands (below) counts rules whose SELECTOR says "select". The form audit found the same
// stripes on a select it did not count: OsRegistry's Status pick is <select className="note-in">,
// and `.app.crew-day .note-in{background:var(--card)}` — the shorthand, through the class — beat the
// arrow's no-repeat, so in the day theme the chevron tiled across the control; where nothing paints
// the arrow back at a higher specificity, the shorthand erases it and the select reads as a text box.
// This reads the source for every class a <select> carries and counts the CSS rules that paint that
// class with the shorthand. Some of what it counts may hide the arrow on purpose (a borderless pick
// styled as a link); each still has to say so in background-color terms. It may only fall.
export function selectClassShorthands(css, read = (p) => readFileSync(join(ROOT, p), "utf8"), list = (d) => readdirSync(join(ROOT, d), { recursive: true })) {
  const classes = new Set();
  for (const dir of ["components", "app"]) for (const f of list(dir)) {
    if (!/\.tsx$/.test(String(f))) continue;
    let src; try { src = read(`${dir}/${f}`); } catch { continue; }
    for (const m of src.matchAll(/<select\b[^>]*?className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
      for (const c of (m[1] || m[2] || "").replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) if (/^[A-Za-z][\w-]*$/.test(c)) classes.add(c);
    }
  }
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const hits = [];
  for (const m of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].split(";").pop().trim(), body = m[2];
    if (!/(^|;)\s*background\s*:/.test(body)) continue;
    for (const part of sel.split(",")) {
      const last = part.trim().split(/[\s>+~]+/).pop() || "";
      // An ELEMENT selector (input, textarea…) is not a select's class — but only as the compound's
      // type, at its start. As a bare word it also matched inside class names: \binput\b is true of
      // ".auth-input", so the shorthand on .auth-input — the class every discount-code and perk select
      // carries — was skipped, and in the day theme those selects tiled their chevron (found driving
      // Discount codes, 2026-10-04: Kind and Applies to striped across). Same for .ev-input.
      if (/::?(placeholder|before|after)|^(input|textarea|button|option)\b/.test(last)) continue;
      const hit = [...classes].find((c) => new RegExp(`\\.${c.replace(/-/g, "\\-")}(?![\\w-])`).test(last));
      if (hit) { hits.push(part.trim()); break; }
    }
  }
  return { selectClassShorthands: hits.length, selectClassShorthandList: hits };
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
// 2026-10-08 (the iPhone chrome round): every tap floor up from 26 — the rail's handle is not on a phone any more
// (components/FloatRail), so the smallest target is the page's own: the footer's Privacy link (43.6), a 44pt field,
// the tab bar's 49pt tabs, /3mpire's Share invite (42). Measured on this commit's build.
// 2026-10-08 (the navigation round): /academy 49 → 44 — its Back is the title bar's ‹ now (components/TitleBar), a
// 44pt control at the top left, where a 44pt ‹ sat in the masthead's corner before the iPhone chrome round.
// Floors say "not smaller than this", not "this is fine".
// 2026-10-08 (the type round: redesign 6). Every size folded onto the ten steps: each route's smallest text is 11
// now (15 on privacy and terms, whose least was 14), and the footer's Privacy and Terms, whose height their words
// set, grew from 43.6 to 44. The tab bar's labels went to 11 on a line of their own height, so its 49pt tabs stay
// 49 (iOS's bar: 49 + the home indicator). PROD_ROUTE below says the same of production, from
// the same fold: its 10s are 11s; the map's zoom buttons (30, Leaflet's own) are not text and stay.
// 2026-10-09 (the chip round): /built 34 → 44, here and on production — its Back is the kit's glass icon button (36pt,
// 44 to the thumb) where a 34pt "‹ Back" pill floated.
// 2026-10-09 (round 7d): /agreement and /offer depth 1 → 2 — their sign-in's two switches (joining or signing in; a link
// or a password) are the kit's segmented control, a chosen option on its track inside the sign-in's card, as Plan's and
// the purchase sheet's are; /shop 2 → 3, its aisles the same control in the bar that stays at the top. /3mpire's tap
// floor 42 → 44 (its sign-in's 42px tabs were among the 86 recipes).
export const ROUTE = {
  "/":              { depth: 2, tap: 44, text: 11 },
  "/truck":         { depth: 2, tap: 44, text: 11 },
  "/events":        { depth: 2, tap: 44, text: 11 },
  "/menu":          { depth: 2, tap: 44, text: 11 },
  "/reserve":       { depth: 2, tap: 44, text: 11 },
  "/delivery":      { depth: 1, tap: 44, text: 11 },
  "/3mpire":        { depth: 2, tap: 44, text: 11 },
  "/craft":         { depth: 2, tap: 44, text: 11 },
  "/book":          { depth: 1, tap: 44, text: 11 },
  "/shop":          { depth: 3, tap: 44, text: 11 },
  "/primal":        { depth: 1, tap: 44, text: 11 },
  "/office":        { depth: 1, tap: 44, text: 11 },
  "/academy":       { depth: 0, tap: 44, text: 11 },
  "/scan":          { depth: 0, tap: 44, text: 11 },
  "/architecture":  { depth: 0, tap: 44, text: 11 },
  "/playbook":      { depth: 0, tap: 49, text: null },
  "/driver":        { depth: 0, tap: 49, text: 32 },
  "/agreement":     { depth: 2, tap: 44, text: 11 },
  "/offer":         { depth: 2, tap: 44, text: 11 },
  "/built/gt3-built-k7m9x4q2": { depth: 1, tap: 44, text: 11 },
  "/display":       { depth: 1, tap: 49, text: 10 },
  "/privacy":       { depth: 0, tap: 49, text: 15 },
  "/terms":         { depth: 0, tap: 49, text: 15 },
};

// ── THE SAME ROUTES, ON PRODUCTION, WITH DATA — read by scripts/verify.prod.mjs ─────────────────
// ROUTE above is measured against a build with no database: for a data-driven route that is the
// EMPTY state. This table is the populated one, measured on app.gt3pb.com at 390px after the
// 2026-10-02 deploy (8ac6bf9). The seven that differ are real: a lesson card with its FREE pill
// is a box in a box the empty /primal never shows; /delivery's Pickup/Delivery choice is one;
// the sign-in wall on /academy, /playbook and /driver is a box the guest build renders as nothing.
// /3mpire measures SHALLOWER with data (1, not 2): the empty state's placeholder card is gone.
// Two tables, two subjects — the same reason the fixture is measured in two themes.
// 2026-10-08 (the iPhone chrome round): tap floors re-measured on app.gt3pb.com at 390px with the rail hidden, as
// this commit hides it on a phone, and the tab bar's tabs at their new 49pt: Find Us's map zoom buttons (30) on
// /, /truck and /events, the footer's Privacy link (43.6), a 44pt field on the sign-in walls, a tab (49).
// 2026-10-09 (round 7d): the sign-in walls — /3mpire, /academy, /driver, /office, /agreement, /offer — depth 1 → 2, their
// two switches the kit's segmented control (a chosen option on its track inside the sign-in's card); /shop 2 → 3, its
// aisles the same control. Measured before and after on the smoke build with its stand-in backend, signed out, at a
// phone's width — where the before matched these rows, route for route.
// 2026-10-09 (the forms round): Find Us's map zoom buttons are 44 (they were 30), so /, /truck and /events' floor is 44.
export const PROD_ROUTE = {
  "/":              { depth: 2, tap: 44, text: 11 },
  "/truck":         { depth: 2, tap: 44, text: 11 },
  "/events":        { depth: 2, tap: 44, text: 11 },
  "/menu":          { depth: 2, tap: 44, text: 11 },
  "/reserve":       { depth: 2, tap: 44, text: 11 },
  "/delivery":      { depth: 2, tap: 44, text: 11 },
  "/3mpire":        { depth: 2, tap: 44, text: 11 },
  "/craft":         { depth: 2, tap: 44, text: 11 },
  "/book":          { depth: 1, tap: 44, text: 11 },
  "/shop":          { depth: 3, tap: 44, text: 11 },
  "/primal":        { depth: 2, tap: 44, text: 11 },
  "/office":        { depth: 2, tap: 44, text: 11 },
  "/academy":       { depth: 2, tap: 44, text: 11 },
  "/scan":          { depth: 0, tap: 44, text: 11 },
  "/architecture":  { depth: 0, tap: 44, text: 11 },
  "/playbook":      { depth: 1, tap: 49, text: 11 },
  "/driver":        { depth: 2, tap: 44, text: 11 },
  "/agreement":     { depth: 2, tap: 44, text: 11 },
  "/offer":         { depth: 2, tap: 44, text: 11 },
  "/built/gt3-built-k7m9x4q2": { depth: 1, tap: 44, text: 11 },
  "/display":       { depth: 1, tap: 49, text: 10 },
  "/privacy":       { depth: 0, tap: 49, text: 15 },
  "/terms":         { depth: 0, tap: 49, text: 15 },
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
// 2026-10-04: /driver 280 → 281, and not one new byte of code on it. Built both sides and diffed the
// chunks /driver's HTML references: the same files at the SAME raw sizes (44 645 and 25 972 bytes),
// renamed, because the shell's map of lazy chunks names the quick-actions dock by content hash and
// the dock gained the purchase sheet. A different hash string gzips differently: +50 and −10 bytes,
// 287 217 → 287 257 bytes in all, which is 15 bytes past the 280.49 KB rounding line. Compression
// noise on a filename, written down so it is not mistaken for weight.
// 2026-10-04: /book 268 → 269, /primal 269 → 270, /academy 316 → 318. Measured by building the
// commit before and after and gzipping what each route's HTML references: every route +90 bytes —
// lib/surfaces, the one rule for which pages carry the cart bar, order status and concierge (the
// cart bar was sitting on the crew's training page) — which tipped the two routes sitting within 90
// bytes of a rounding line (274 896 → 274 986; 275 952 → 276 042). /academy +1 515: those 90; its
// readiness rows saying what is left and opening it, and certifications that can finally renew
// (+703); and its reads and writes saying when they fail instead of "complete" or 0%, with the team
// board on the same rules as the person's own page (+722) — 323 781 → 325 296.
// 2026-10-04: every route −405 bytes of script and one request fewer; every stylesheet +97. Built
// a9989be and this commit and gzipped what each route's HTML references, route by route. The script:
// five retired copy entries (My Day's greeting, the old home statement, principles and call to action,
// the "Team board" label) rode in the chunks every page loads with lib/copy's defaults. Net of what
// joined them there — lib/roles' canOf and lib/records' two alert rules — the shared chunks come out
// 554 raw bytes lighter (114 506 → 113 952), and the bundler packs them into two instead of three:
// one request fewer everywhere, and /menu, /book, /academy, /architecture, /playbook, /driver,
// /primal and / each cross a rounding line down. The stylesheet: the buttons that replaced dead rows on the daily path —
// Needs-you rows, the restock rule, an alert's own words, a Readiness group's Open / Wrap up, the
// rhythm pulse's check-in — and the panel rule that keeps a wrapped component's controls, net of the
// WHEN pill's three rules: 102 911 → 103 008. a9989be's shared stylesheet sat ONE byte under the
// 100.5 KB rounding line, so the twenty routes that carry it go 100 → 101; the three on the second
// stylesheet (105 560 → 105 657) stay at 103.
// 2026-10-04 (the customer side): every route 3–4 KB lighter. Built 739a67e and this commit and
// gzipped what each route's HTML references: lib/ordering, lib/orderingRead and the words they say
// joined the shared chunks (+2 095 bytes on /privacy, 303 303 → 305 398) — and every route went
// over its ceiling, because the checkout sheet, its card form and its receipt rode in every first
// load for guests who never open it. components/AppShell now mounts Checkout lazily, once the cart
// holds a drink or something opens it (the code is warm long before the cart bar is tapped): net
// −3 627 on /privacy (303 303 → 299 676), −3 032 on /menu, −3 187 on /truck, and one /api/menu read
// fewer on every page load that never reaches a cart. /menu then took back the half-kilobyte that
// says its own state — the order line, the hint and the price that know the truck is closed, and the
// price kept in its pill's box so the answer moves no row: 271 924 bytes, 268 → 266 over the pass.
// 2026-10-05: /book 265 → 266, and not one new byte of code on it. Built 60c4332 and this commit and
// diffed the chunks /book's HTML references: the one that differs is the same 58 487 raw bytes on
// both sides with its modules in a different order — the brew lot pick (lib/brewLots,
// components/CoffeeLotPick, crew-only) renumbered the bundler's modules — and gzips 42 bytes worse
// (311 467 → 311 509 on /book), past its rounding line. Compression noise on an ordering, written
// down so it is not mistaken for weight; every public route moved the same 42 and only /book crossed.
// 2026-10-05 (the gesture round): every route +1 373 to +1 986 bytes of script, /shop +816, and every
// stylesheet +878. Built b065536 and this commit and gzipped what each route's HTML references, route
// by route (/privacy 299 663 → 301 036; /menu 311 469 → 313 404). What rides in every first load is
// what a sheet must have before it can be pulled at all: its one door out — the X, a tap outside,
// Escape, a form's Cancel and the pull all asking "Discard your changes?" over typed words, a held
// checkout giving instead of leaving, Escape for the top sheet only (2 635 raw bytes in the sheet's
// module); the tab bar's tap-again-for-the-top (lib/appScroll, its own 154-byte home, so the crew's
// panel jumps in lib/anchors stay off guests' pages); lib/realtime's refresh and its read on coming
// back to the app; the toast's Undo; and two lazy-chunk stubs. The customer pages carry the haptics'
// iPhone tick on top (lib/haptics, +823 raw: they buzz on Android and, until now, were silent on every
// iPhone) — that is the 0.5 KB between /menu and /privacy. The finger-following engine itself
// (components/useGesture, lib/gesture: 5.6 KB raw) is in NO first load: it comes with the first sheet
// that opens (components/SheetMotion) or right after a paged screen is up (components/PagerMotion).
// The round's first build carried it in the shell and weighed 4.8 KB more on every route; /shop came
// to +5.1 KB while its pager and its photo viewer imported it. /shop now fetches the full-screen
// viewer once a product with photos is open, so it carries less of its own than it did. The stylesheet: the ask
// card, the inbox's swipe rows, the pull-to-refresh ring, the edge-back's armed state and the toast's
// action — one global sheet, as every route already shares.
// 2026-10-06 (the haptics round): every route +305 to +822 bytes of script, every stylesheet +96.
// Built 276ddf8 and this commit and gzipped what each route's HTML references (/privacy +795, /menu
// +368, /shop +563, /crew +584). What rides in the shell now: the error feel on every error toast and
// the cart's add, remove, up and down (components/AppProvider imports lib/haptics — the customer pages
// already carried it, so /privacy, /terms, /scan, /architecture, /display, /academy, /offer and
// /agreement pay its ~0.4 KB for the first time), and lib/ios: the one iPhone check and the focus-zoom
// hold every screen runs, because an iPhone zoomed into every 15px field and stayed zoomed. Eleven
// routes crossed their rounding line by 1 KB; the rest moved inside it.
// 2026-10-06 (the settings round): every public route +424 to +463 bytes of script, every stylesheet
// +138; /crew +5 742. Built 682e587 and this commit, route by route. What rides in the shell: the
// theme's one home (lib/theme — with Auto, the phone's own light or dark, read as it changes) and a
// device preference's (lib/devicePref), so the rail and Settings › You read and write one value and
// stay in step; the floating moon left it. The stylesheet gained Settings' grouped list and its
// segmented control, and lost the card map. /crew carries Settings' row values (components/
// SettingsGlance, lib/settingsGlance). Sixteen routes crossed their rounding line by 1 KB. The size
// buttons' names were moved into lib/textSize so the rail on every page does not carry Settings' words
// (and lib/money and lib/office with them): that was +1 KB on eleven more routes.
// 2026-10-06 (the iPhone round): every route +184 to +202 bytes of script, every stylesheet +80. Built
// 84fffec and this commit and gzipped what each route's HTML references, route by route (/privacy
// 262 611 → 262 795, /menu 274 587 → 274 789, /truck's stylesheet 106 952 → 107 032). What rides in the
// shell: lib/native's address helpers — apiUrl, through which every /api call goes, and publicOrigin,
// which every shared link, QR and sign-in email asks — so the iPhone app reaches the web's API and hands
// out the web's address; on the web both fold to what they were (apiUrl is the identity). The app's own
// code is in no web build at all: NativeBridge and the Capacitor plugins are not emitted (guarded in
// AppShell's own file so the bundler drops them; with an imported flag they were emitted, and every
// route weighed ~1 KB more), and the app's styles ride with NativeBridge. The stylesheet's 80 bytes are
// the web's own fixes: the menu's category chips stick again, the skip link lost its smudge, the
// booking masthead, offline banner and service mode keep below a status bar, a chip's jump lands below
// the chips. Five routes crossed their rounding line by 1 KB.
// 2026-10-06 (the iPhone round, part 2 — delete your account): /3mpire 283 → 284, /menu 268 → 269,
// /book 268 → 269. Built 59d9900 and this commit and gzipped what each route's HTML references, route by
// route: the fourteen routes that carry the account menu +179 to +224 bytes (/3mpire 290 300 → 290 524,
// /menu 274 787 → 275 004, /book 274 865 → 275 046); the eight that do not, 0. What rides there is the
// menu's "Delete account" row and the switch that shows its screen — App Store Review Guideline
// 5.1.1(v) puts it one tap from the account — while the screen itself (components/DeleteAccount: what
// goes, what stays, the one red button) loads only when the row is tapped. Three routes sat within
// 0.22 KB of a rounding line.
// 2026-10-07 (the iPhone round, part 3 — save, share, print and Add to calendar in the app): fourteen
// routes 4.2–4.8 KB lighter, nine 0.5–0.9 KB heavier with one chunk more. Built 47e762e and this commit
// and gzipped what each route's HTML references, route by route. What rides now is lib/deviceActions'
// web half — a download, the browser's share, window.print(), the .ics and the .pkpass, the same tricks
// the buttons did inline before; the app's half is guarded in its own file and the web build drops it —
// and what left is the member card: components/StatusCard (the spinning card, its photo, its drawing and
// its share) rode in every page that carries the account menu, the stamp card or the membership card,
// and now loads when it is opened (components/MemberCard, its one door): /menu 275 004 → 270 599,
// /shop 303 427 → 298 609, / 280 915 → 276 144. The bundler then splits the modules every page shares
// with that card's chunk into a chunk of their own: +498 bytes and one more request on the eight pages
// that carry no account menu (/privacy 262 793 → 263 291), +942 on /offer, which also carries the offer
// letter's print through lib/deviceActions, and +856 on /crew.
// 2026-10-07 (Tailwind, on GT3's tokens): every route's stylesheet 3.7 KB lighter — css 102 → 98, and
// 105 → 101 where the map rides. Built the commit before and this one and gzipped the stylesheets each
// route's HTML references: 104 383 → 100 636 bytes (107 032 → 103 285 with the map). app/globals.css
// lost 316 rules, parts of 13 more and 4 keyframes that styled nothing (−33 KB before gzip, −5.3 KB
// after); the utilities ride in a stylesheet of their own, 1.6 KB, fetched beside it — built only from
// names the screens' code holds (app/tailwind.css). Script unchanged, bar 1 byte on /3mpire (.ring is
// .mp-ring).
// 2026-10-07 (office clients, 0354): /office 272 → 273. Built 8049ab6 and this commit and gzipped what
// /office's HTML references: 278 965 → 279 122 bytes (+157), over the rounding line it sat 75 bytes
// under; every other public route byte-identical. What rides: the weekly order's two changes go
// through set_office_standing and the page shows the row the server saved, the old write stays as the
// way through until 0354 is pasted (and says "couldn't save" when it matches no row), and a refusal
// under the minimum shows the database's sentence. lib/schemaSkew's "not pasted yet" test loads only
// when a save fails: imported up front, /office weighed 279 404 (+439), so the lazy import is lighter.
// 2026-10-07 (Command and Team, Ryan's "Ewww"): every stylesheet +478 bytes gzipped, and the twenty
// routes on the one shared sheet 98 → 99. Built 1cb3e82 and this commit and gzipped what /menu's HTML
// references: 100 611 → 101 089 (the house sheet 98 972 → 98 988, the utilities 1 639 → 2 101). What
// rides: the portfolio's rows, the audit-overdue line, the team's week, the folded initiative and Team's
// actions, net of the rules they replaced (app/globals.css −48 raw bytes); their one-off layout went into
// utilities as the house sheet's gate asks — the first screens to use flex-col, the gap and margin steps
// and the type sizes, so they pay for classes the next screens get free. /truck, /events and /driver
// moved the same and stayed at 101. Script unchanged.
// 2026-10-07 (Your GT3, the office client's home): /office 273 → 277, and /truck, /events, /driver css
// 101 → 102. Built ac4d335 and this commit and gzipped what each route's HTML references. /office's script:
// 279 324 → 284 010 bytes (+4 686) — the next delivery card and its four steps, the six-week calendar,
// requests, invoices with Pay, the subscription that keeps it live, and lib/officeStatus, the page's one
// reader; the change and ask sheets, lib/officeChange and the kit's segmented control load with the first
// tap that opens a sheet (1 391 bytes lighter than carrying them up front). Every stylesheet +621 bytes
// (/menu 101 089 → 101 710, /truck 103 738 → 104 359): the utilities the card, the calendar and the
// sheets are laid out with, net of the office route's two rules moved onto theme tokens. The three routes
// with the second stylesheet sat 0.19 KB under the rounding line; every other route stays at 99.
// 2026-10-08 (the crew's first day): /delivery 286 → 287, /office 277 → 278, /display and /scan
// 259 → 260. Built 6191e53 and this commit and gzipped what each route's HTML references: every route's
// script +193 bytes (/display 265 603 → 265 796, /scan 265 536 → 265 729; /delivery 293 348 → 293 554
// and /office 284 010 → 284 241 with their chunk splits), which crossed the rounding line on these four.
// What rides in the shell, for everyone: AuthProvider reads the profile again when the app comes back to
// the screen (so nobody signs out to become crew), and the ✦ opens straight on Ask GT3 from a link. The
// first-day guide itself (components/CrewStart, lib/crewStart) loads with the Guide, and the home's
// "You're on the GT3 crew" row only for the staff member it is for: imported up front, / weighed
// 277 428 (+1 278) instead of 276 415 (+265).
// 2026-10-08 (the foundations round): /menu 264 → 265, /academy 317 → 318. Built 1e13fb2 and this commit and
// gzipped what each route's HTML references: every route's script +117 to +192 bytes (/menu 270 799 → 270 929,
// /academy 324 987 → 325 174, /craft 270 099 → 270 221), which crossed the rounding line on these two. What rides
// in the shell, for everyone: a sheet gives focus back to the button that opened it when it closes (the opener is
// read before a field inside autofocuses), and the 44pt tap areas are class names on the controls that need them.
// 2026-10-08 (the iPhone chrome round): fourteen routes 2–3 KB lighter, nine under 1 KB heavier. Built 571dbec and this
// commit and gzipped what each route's HTML references: the account menu and the profile sheet load on the tap that
// opens them now (components/AccountPill) — -1 877 to -2 664 bytes on every route that shows the avatar; and the shell,
// for everyone, +855 to +922 bytes: each tab keeps its place (lib/appScroll), the ear for the menus' sheets (which
// load on the first ask — lib/helpSheets), and Return's next-field move (lib/formKeys). Crossed the rounding line
// upward on /architecture, /agreement, /offer, /display, /privacy, /terms and /built.
// 2026-10-08 (the navigation round): every route +4 KB of script, and the stylesheet over the 100 KB line on the 99s.
// Built 69c3cc7 and this commit and gzipped what each route's HTML references: +4 173 to +4 277 bytes everywhere —
// what Back now does, for everyone: an open sheet is a step Back closes, and its history entry goes when it does
// (lib/appHistory, which has to be loaded before the router to hear Back first); the title bar that keeps a screen's
// name and carries Back in one place (components/TitleBar, useBack), and the screens' short names (lib/routeTitles).
// The stylesheet: the bar's own utilities (a blurred ground, its two buttons, the calendars' rows stepping under it).
// 2026-10-08 (the navigation round, part two): every route +673 bytes of script and +284 bytes of stylesheet. Built
// 868ffdf and this commit and gzipped what each route's HTML references (/menu 272 617 → 273 290, /privacy 268 769 →
// 269 442; the stylesheet 102 066 → 102 350, and 104 715 → 104 999 on the three with the second one), which crossed the
// rounding line upward on fifteen routes' script and on /truck, /events and /driver's stylesheet. What rides in the
// shell, for everyone: how a sheet stands on a phone (lib/sheetStage) — a long form opens half-height and rises when it
// is used, and the page behind a tall sheet steps back and follows the sheet's pull — as two utilities (page-stage,
// sheet-detent), and the touch engine's two words for a long press (a touch taken, its lift's click hushed). The long
// press itself (components/LongPress) loads with the crew's console only.
// 2026-10-08 (the type round: redesign 6): every route's stylesheet -929 bytes and script +63 (gzip). Built 560d332 and
// this commit and gzipped what each route's HTML references (/menu's stylesheet 102 350 → 101 421, its script
// 273 290 → 273 353): 1,119 sizes folded onto the ten steps, the half-pixel ones gone; the shell's text size
// following the phone's in the iPhone app (the reading itself is in the app's bundle only). The stylesheets came down
// a line (100 → 99, 103 → 102), recorded; the script crossed the rounding line on /delivery, /office and /primal.
export const WEIGHT = {
  "/truck":                    { js: 284, css: 93, chunks: 15 },
  "/events":                   { js: 284, css: 93, chunks: 15 },
  "/menu":                     { js: 267, css: 90, chunks: 14 },
  "/reserve":                  { js: 292, css: 90, chunks: 16 },
  "/delivery":                 { js: 291, css: 90, chunks: 16 },
  "/3mpire":                   { js: 284, css: 90, chunks: 15 },
  "/craft":                    { js: 266, css: 90, chunks: 14 },
  "/book":                     { js: 267, css: 90, chunks: 14 },
  "/academy":                  { js: 325, css: 90, chunks: 16 },
  "/office":                   { js: 281, css: 90, chunks: 15 },
  "/scan":                     { js: 265, css: 90, chunks: 14 },
  "/architecture":             { js: 275, css: 90, chunks: 14 },
  "/playbook":                 { js: 274, css: 90, chunks: 14 },
  "/driver":                   { js: 280, css: 93, chunks: 15 },
  "/agreement":                { js: 274, css: 90, chunks: 15 },
  "/offer":                    { js: 284, css: 90, chunks: 15 },
  "/built/gt3-built-k7m9x4q2": { js: 264, css: 90, chunks: 14 },
  "/display":                  { js: 265, css: 90, chunks: 14 },
  "/shop":                     { js: 296, css: 90, chunks: 16 },
  "/primal":                   { js: 267, css: 90, chunks: 14 },
  "/privacy":                  { js: 263, css: 90, chunks: 13 },
  "/terms":                    { js: 263, css: 90, chunks: 13 },
  "/":                         { js: 272, css: 90, chunks: 14 },
};

// 2026-10-09 (the button round: redesign 7): every route's stylesheet -1 628 bytes and its script +188 to +245 (gzip).
// Built ca04722 and this commit and gzipped what each route's HTML references (/menu's stylesheet 101 421 → 99 793, its
// script 273 353 → 273 541): 31 button recipes and the sheets' copies of one gave way to a kit of four kinds in two sizes
// ("03 · Buttons"); the shell carries the kit's component (components/Button: the broadcast bar's link and the splash's
// button are drawn with it). The stylesheets came down two lines (99 → 97, 102 → 100), recorded; the script crossed the
// rounding line on /academy, /scan and /display.
// 2026-10-09 (the chip round: redesign 7's second half): every route's stylesheet −4 907 bytes (gzip) and its script −10 to
// +73. Built 945db08 and this commit and gzipped what each route's HTML references (/menu's stylesheet 99 793 → 94 886, its
// script 273 541 → 273 560): 105 pill rules — chips, tags, pill buttons — the 16 last button recipes and .handle gave way to the
// kit's chip, tag and count; the screens name the kit's classes, a few bytes apiece. The stylesheets came down four and five
// lines (97 → 93, 100 → 95), recorded.
// 2026-10-09 (nothing moves after paint): every route's script +28 bytes and stylesheet +69 (gzip), the order funnel's
// three routes' script +136. Built main (4aabeba) and this commit and gzipped what each route's HTML references: the
// label over the one pickup (a copy default the shell carries), the pickup's room on /reserve, /shop and /delivery, two
// utilities (cursor-default, active:transform-none), and the screens that hold the GT3 mark. /built's script crossed the
// rounding line (264 → 265), recorded.
// 2026-10-09 (the desk round: redesign 5): every route's stylesheet +1 279 bytes and its script +251 to +327 (gzip). Built
// the chip round's commit and this one and gzipped what each route's HTML references (/menu's stylesheet 94 886 → 96 165, its
// script 273 560 → 273 842): the desk — from 1,024 wide in landscape the console and /office leave the frame for a sidebar and
// a canvas of two columns — is utilities in the one stylesheet every route shares (app/tailwind.css THE DESK), and the shell
// names the pages it is for (lib/surfaces deskRoute, components/kit Columns). The stylesheets went up a line (93 → 94, 95 → 96,
// /truck's 96.498), recorded; the script crossed the rounding line on /truck, /events, /craft, /architecture, /built, /privacy
// and /terms. Rebased onto the round above it (#112): /truck's, /events' and /driver's stylesheet (96 → 97) and /book's
// script (267 → 268) crossed the line again, recorded.
// 2026-10-09 (round 7d: the button and chip recipes the name and radius tests could not see): every route's stylesheet
// −3 952 bytes (gzip), and its script −894 to +470. Built the desk round's commit and this one and gzipped what each
// route's HTML references (/menu's stylesheet 96 165 → 92 213, its script 273 842 → 272 952): 86 recipes gave way to the
// kits, and the screens name fewer, shorter classes. The sign-in's two switches are the kit's segmented control
// (components/controls), which now rides with the sign-in on the eleven routes that can show one (+170 to +470 net; the
// control is 1.3 KB): on seven — /3mpire, /reserve, /delivery, /shop, /driver, /offer, /agreement — the script crossed
// the rounding line up, recorded. The stylesheets came down three and four lines (94 → 90, 96 → 93); twelve routes load
// one chunk fewer. Rebased onto the desk and the round before it (#112): /academy's script crossed the line (324 → 325),
// recorded.
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
  // A button in the browser's grey face is a style rule that never reached it (2026-10-04, .cp-go).
  if (Array.isArray(m.marksLoose) && m.marksLoose.length) out.push(`${path}: the GT3 mark is placed outside its screen (${m.marksLoose.join(", ")}) — add the screen to the positioned list beside .wm in app/globals.css, or the mark jumps when the screen's fade ends.`);
  if (Array.isArray(m.uaButtons) && m.uaButtons.length) out.push(`${path}: ${m.uaButtons.length} button(s) in the browser's default grey face — ${m.uaButtons.slice(0, 3).join(" · ")}. Give the class a reset.`);
  return out;
}

// ── STATIC ───────────────────────────────────────────────────────────────────────────────────────
export function staticCounts(css) {
  // Rule blocks, crudely: selector { body }. Nested at-rules are flattened by the regex, which is
  // fine for counting declarations; it is not a parser and does not need to be. Comments go first
  // (2026-10-09): a note above a rule was read as the start of its selector, and that rule was
  // never counted — 152 card rules, 3 radii and 37 twice-declared selectors went unseen.
  const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
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
  const { darkWells, darkWellList } = darkWellCounts(css);
  return { cardRules, rawRadii: radii.size, rawRadiiList: [...radii].sort((a, b) => b[1] - a[1]), dupSelectors: dups.length, dupList: dups.sort((a, b) => b[1] - a[1]), rootBlocks, subFloorFontRules, selectShorthands, darkWells, darkWellList };
}

// ── DARK WELLS ON PAPER (2026-10-04) ─────────────────────────────────────────────────────────────
// Ryan's My Day, in the day theme: his top three priorities and every unticked task box painted as
// mid-grey slabs that read as DISABLED. Both were `background: rgba(0,0,0,.18–.22)` — an inset
// tone mixed for the charcoal ground, where black at 20% is a gentle well. On cream it is grey.
// .ofr-stat met the same thing through a token (--well) and was patched by hand; nothing counted
// the rest. This counts rules that fill with literal black between 10% and 44% and that no rule
// in a light scope (.app.crew-day, paper: .shop/.menu/.paper) restates. Under 10% is an ink wash
// that works on either ground; 45% and over is an overlay — a scrim, a badge on a photo — dark on
// purpose in both themes, as is anything named a scrim, backdrop or overlay. Comments are
// stripped first: a comma in a comment is not a selector list.
export function darkWellCounts(css) {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // A statement before a rule (an @import, a stray `;`) is not part of its selector.
  const rules = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].split(";").pop().trim(), m[2]]);
  const LIGHT = /\.app\.crew-day|body\.light|\.shop\b|\.menu\b|\.paper\b/;
  const restated = rules.filter(([sel, body]) => LIGHT.test(sel) && /(^|;)\s*background(-color)?\s*:/.test(body)).map(([sel]) => sel);
  // Whole compound selectors only: `.code` is not restated by a rule for `.code-row`.
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const covers = (rule, part) => new RegExp(`(^|[\\s>+~(,])${esc(part)}(?![\\w-])`).test(rule);
  const darkWellList = [];
  for (const [sel, body] of rules) {
    if (LIGHT.test(sel) || /scrim|backdrop|overlay/.test(sel)) continue;
    const m = body.match(/(^|;)\s*background(?:-color)?\s*:\s*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*(\d*\.?\d+)\s*\)/);
    if (!m) continue;
    const a = parseFloat(m[2]);
    if (!(a >= 0.1 && a < 0.45)) continue;
    const bare = sel.split(",").map((x) => x.trim()).filter((x) => x && !restated.some((r) => covers(r, x)));
    if (bare.length) darkWellList.push(`${a}  ${bare.join(", ")}`);
  }
  return { darkWells: darkWellList.length, darkWellList };
}

// ── THE FIXTURE NAMES ITS SOURCES ────────────────────────────────────────────────────────────────
// Every element inside a `data-from="path"` block must use classes that appear in that file. A
// class that has been renamed or removed at the source makes the fixture a picture of a screen
// that no longer exists, and this is where that gets said.
//
// An element whose classes come from two files names both, space-separated (2026-10-04): the
// checkout's sheet is `sheet2 paper` — "sheet2" written by components/Sheet.tsx, "paper" passed in by
// components/Checkout.tsx. Each class must appear in ONE of the files named; none may appear in none.
// A kit button written <Button kind="secondary" compact> or btn("secondary", { compact: true }) carries the kit's
// classes (components/Button): its kind's, and btn-sm / btn-wide when it says so (2026-10-09, the button round).
const KIT_KIND = { primary: "btn-pri", secondary: "btn-sec", quiet: "btn-ter", destructive: "btn-del" };
export function kitButtonClasses(text) {
  const out = new Set();
  for (const m of text.matchAll(/<Button\b([^>]*)>/g)) {
    const kind = m[1].match(/\bkind=(\{[^}]*\}|"\w+")/);
    for (const k of kind ? kind[1].matchAll(/"(\w+)"/g) : []) if (KIT_KIND[k[1]]) out.add(KIT_KIND[k[1]]);
    if (/\bcompact\b/.test(m[1])) out.add("btn-sm");
    if (/\bwide\b/.test(m[1])) out.add("btn-wide");
  }
  for (const m of text.matchAll(/\bbtn\("(\w+)"([^)]*)\)/g)) {
    if (KIT_KIND[m[1]]) out.add(KIT_KIND[m[1]]);
    if (/compact: true/.test(m[2])) out.add("btn-sm");
    if (/wide: true/.test(m[2])) out.add("btn-wide");
  }
  return out;
}
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
      const owners = owner.split(/\s+/).filter(Boolean);
      const texts = owners.map((o) => src(o));
      const lost = owners.filter((_, i) => texts[i] === null);
      for (const c of cls[1].split(/\s+/).filter(Boolean)) {
        if (lost.length) { missing.push(`${c}  ← claimed from ${lost.join(" ")} (file not found)`); continue; }
        const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // The class as a token inside a className: bounded by quotes, whitespace, a template's
        // `${` (className={`grp-seg${on ? " on" : ""}`}) or the end. kit.tsx's SectionHeader
        // classes are single letters (.l, .a), so a bare-word search would match anything.
        const exact = (text) => new RegExp(`["'\`\\s]${esc(c)}(["'\`\\s}$]|$)`).test(text);
        // A suffix the component computes — `sev-${first.severity}` — is declared by its prefix.
        const dynamic = (text) => c.split("-").slice(0, -1).some((_, i) => text.includes(`${c.split("-").slice(0, i + 1).join("-")}-\${`));
        if (!texts.some((t) => exact(t) || dynamic(t) || kitButtonClasses(t).has(c))) missing.push(`${c}  ← claimed from ${owner}`);
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
  const fabs = [...document.querySelectorAll(".qd-fab")].filter(visible).map((el) => ({ name: el.className.split(" ")[0], ...box(el) }));
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
      await page.addStyleTag({ content: await utilitiesFor(readFileSync(fixture, "utf8")) });
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

// ── THE UTILITIES, TOO (2026-10-07, the pill round) ────────────────────────────────────────────
// A fixture links the house stylesheet, and the utilities a screen writes (mb-3.5) are built by
// Tailwind at build time — so a fixture painted without them is not the screen. Built here from the
// fixture's own class names against app/tailwind.css, and added after the house stylesheet, where
// app/layout.tsx puts them.
export async function utilitiesFor(html) {
  const { compile } = await import("@tailwindcss/node");
  const file = join(ROOT, "app/tailwind.css");
  const compiled = await compile(readFileSync(file, "utf8"), { base: join(ROOT, "app"), from: file, onDependency() {} });
  return compiled.build([...new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]);
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
    await page.addStyleTag({ content: await utilitiesFor(readFileSync(fixture, "utf8")) });
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
  const sc = selectClassShorthands(css);
  ratchet("rules painting a class a <select> carries with the background shorthand", sc.selectClassShorthands, CEILING.selectClassShorthands);
  ratchet("dark wells with no light-surface rule (a grey slab on paper)", s.darkWells, CEILING.darkWells);
  const ut = undefinedTokens(css);
  ratchet("custom properties read with no fallback that nothing defines", ut.undefinedTokens, CEILING.undefinedTokens);
  if (ut.undefinedTokens) console.log(`    ${ut.undefinedTokenList.map(([k, n]) => `${k} ×${n}`).join(" · ")}`);
  const f = frictionCounts();
  console.log("DESIGN RATCHET — friction in the source:");
  ratchet("native confirm()/prompt() dialogs still to migrate to the house sheets", f.nativeDialogs, FRICTION.nativeDialogs);
  ratchet("\"crew-group\" section titles beside <SectionHeader>", f.crewGroupTitles, FRICTION.crewGroupTitles);
  ratchet("<Panel> accordions closed at rest with nothing under their title (a blind header)", f.collapsedPanels, FRICTION.collapsedPanels);
  if (list) {
    console.log("  raw radii, most used first:"); for (const [v, n] of s.rawRadiiList.slice(0, 12)) console.log(`    ${String(n).padStart(4)}  ${v}`);
    console.log("  duplicate selectors, most repeated first:"); for (const [v, n] of s.dupList.slice(0, 12)) console.log(`    ${String(n).padStart(4)}  ${v}`);
    console.log("  dark wells with no light-surface rule:"); for (const v of s.darkWellList) console.log(`    ${v}`);
    console.log("  classes on a <select> painted with the background shorthand:"); for (const v of selectClassShorthands(css).selectClassShorthandList) console.log(`    ${v}`);
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
  note((p.uaButtons || []).length === 0, (p.uaButtons || []).length === 0 ? "no button in the browser's default grey face" : `${p.uaButtons.length} button(s) in the browser's default grey face — ${p.uaButtons.slice(0, 3).join(" · ")}`);
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
      note((m.uaButtons || []).length === 0, (m.uaButtons || []).length === 0 ? `${theme}: no button in the browser's default grey face` : `${theme}: ${m.uaButtons.length} button(s) in the browser's default grey face — ${m.uaButtons.slice(0, 3).join(" · ")}`);
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
