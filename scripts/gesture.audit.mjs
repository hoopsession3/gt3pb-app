// SWIPES THAT CANNOT QUIETLY GO AWAY — the gesture round's gate.
//
//   node scripts/gesture.audit.mjs          # fail on anything new that skips the gesture system
//   node scripts/gesture.audit.mjs --list   # every site, and what answers it
//
// ── WHY (2026-10-05) ───────────────────────────────────────────────────────────────────────────
// Ryan, on his phone, with the Inbox open: "audit for 10 out of 10 … swipe down to close out a thing,
// swipe left to move forward to the next tab … right now it feels 2 out of 10. Example, I have to hit
// the X button to get out of here." The audit found the app 2/10 for one reason: every surface had
// grown its own gestures or none. The pull lived on a sheet's grab bar only; one calendar editor
// listened to the whole window for a sideways flick; tab rows did not swipe at all; nothing asked
// before a pull threw a form away. The round put every swipe on one engine (components/useGesture,
// lib/gesture) and these four rules keep it there:
//
//   1. OVERLAYS     A modal layer is a <Sheet> — it pulls down from anywhere, asks before discarding
//                   typed changes, and answers Escape only when it is on top. A `role="dialog"`
//                   drawn by hand anywhere else is named below, with why it is its own thing.
//   2. TAB ROWS     A `role="tablist"` whose tabs switch the screen under it turns its pages with a
//                   swipe (<SwipePager> / usePagerLevel in its file). A row that is not pages — a
//                   filter, a choice in a form, the bottom tab bar — is named below, with why.
//   3. TOUCH        Touch listeners live in the gesture layer. A window-wide touchstart is how a
//                   sideways swipe on a chip strip once walked the calendar editor off an unsaved
//                   edit; a new one anywhere else fails here.
//   4. FORMS        A sheet that holds a text field decides what leaving does to what was typed: it
//                   says `dirty` (or a form inside it calls useUnsaved), or it is named below — a
//                   field that saves as it goes, a prompt nobody keeps, words its page holds anyway.
//
// The walk reads JSX with the TypeScript parser, like scripts/affordance.audit.mjs. What it cannot
// see — a field inside a component the sheet renders — is the child's own useUnsaved; smoke.cjs holds
// those wired.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// ── 1. modal layers that are not a <Sheet>, and why ───────────────────────────────────────────
export const OWN_OVERLAYS = {
  "components/StoryViewer.tsx": "a product's photos, full screen — it follows the finger down itself (on the engine) and swipes sideways between photos",
  "app/crew/page.tsx#The Pass": "service mode's working screen, left with Exit or Escape — a stray swipe must not drop the pass mid-rush",
  "components/CommandPalette.tsx#Jump to": "the ⌘K palette — a keyboard surface anchored at the top, closed by Escape or a tap outside",
  "components/MarketingSplash.tsx#A note from GT3": "the splash — any tap on it lets you through",
  "components/OfferLetterPrint.tsx#Printable offer letter": "a print view of a letter — a page to print, not a popout",
  "components/AuthProvider.tsx#Set a new password": "setting a new password is a step sign-in requires — there is nothing to swipe back to",
  "components/ConnectHub.tsx#Connect with GT3": "a small panel the rail opens beside itself — a tap outside or the tab closes it",
  "components/DisplayToggle.tsx#Display & text": "a small panel the rail opens beside itself — a tap outside or the tab closes it",
};

// ── 2. tab rows that are not pages, and why ───────────────────────────────────────────────────
// Keyed file#aria-label (or #class when the label is not a literal).
export const PAGED = {
  "app/crew/page.tsx#lane-tabs": "the lane's sections — the section body's <SwipePager>",
  "app/crew/page.tsx#Plan": "Plan's tabs — the section body's <SwipePager>",
  "components/Studio.tsx#View": "Studio's views — usePagerLevel",
  "components/Shop.tsx#Shop": "the shop's two aisles — the aisles' <SwipePager>",
  "app/crew/page.tsx#Guide": "the Guide's two pages, Start here and Every section — the Guide sheet's <SwipePager>",
};
export const NOT_PAGES = {
  "components/OperatorNav.tsx#Crew console": "the bottom tab bar — on a phone a tab bar is tapped, not swiped; the lane's sections above it swipe",
  "app/crew/page.tsx#Event stage": "an event's stage is a fact being set, not a page to turn to",
  "app/menu/page.tsx#Menu categories": "jumps within one long menu — the categories are places on one page, scrolled to",
  "components/OrderFunnel.tsx#Fulfillment": "pickup or delivery — a choice in the order form",
  "components/ReviewsAdmin.tsx#Reviews": "pending or live — two halves of one list, a filter",
  "components/LetterFlyer.tsx#Letter style": "an option of the letter being made",
  "components/LetterFlyer.tsx#Format": "an option of the letter being made",
  "components/RoadFlyer.tsx#Template": "an option of the flyer being made",
  "components/BrewPlanner.tsx#Size it by": "a unit for the size being typed",
  "components/FunnelReport.tsx#Window": "the time range a report covers — a filter",
  "components/Studio.tsx#Filter": "a filter on the pieces shown — a swipe on Studio turns its views",
  "components/BrandCalendar.tsx#Calendar view": "the content calendar's month or list, inside Studio's Calendar view — a swipe there turns Studio's views",
  "components/PrepBoard.tsx#Filter prep": "a filter on one board",
  "components/CompanyCalendar.tsx#Calendar view": "how the same dates are shown — agenda, week, month; a swipe on the calendar walks its dates (‹ ›)",
  "components/QuickDock.tsx#Quick actions": "the dock's four tools in one sheet — a form, a conversation, a note, a receipt; a swipe across them would leave one half-typed",
};

// ── 3. where touch listeners may live ──────────────────────────────────────────────────────────
export const GESTURE_LAYER = {
  "components/useGesture.ts": "the engine",
  "components/SwipeRow.tsx": "an open row closes when a touch lands anywhere else",
  "components/StoryViewer.tsx": "a tap moves through the photos, a hold pauses — the pull down is on the engine",
};

// ── 4. sheets with a text field that do not guard it, and why ─────────────────────────────────
// Keyed file#label (the sheet's `label`, `labelledBy` or the line).
export const NO_UNSAVED = {
  "app/crew/page.tsx#Event supplies": "a search box over the supply list — the search is nothing to keep",
  "components/InventoryAI.tsx": "a question for the stock agent — the answer, not the question, is the thing",
  "components/EventPrepAI.tsx": "a question for the prep agent",
  "components/EventGenerator.tsx": "notes for the event agent to read — the events it makes are the record",
  "components/TroubleshootAI.tsx": "a problem described to the troubleshooter",
  "components/ShootPlanner.tsx": "a brief for the shoot planner",
  "components/Concierge.tsx": "a chat — the conversation stays with the page when the sheet closes",
  "components/OperatingRhythm.tsx": "the transcript stays with the page when the sheet closes",
  "components/InputSheet.tsx": "one value handed back to the screen that asked — it keeps what was typed",
  "components/PromptSheet.tsx": "a question asked of you — closing it is the answer no",
  "components/StatusCard.tsx": "vision and motto save as they are typed",
  "components/TaskSheetBody.tsx": "a task's fields save as they are changed",
  "components/PackPlan.tsx": "a calculator — nothing to save",
  "components/ShopOrderRecord.tsx": "an address to send a receipt to, once",
  "components/Checkout.tsx": "the name for the order starts from the customer's — the payment holds the sheet (`dismissible`)",
  "components/BrewPlanner.tsx#Plan a brew": "a batch size worked out from the drinks wanted — the plan is made by Brew it",
  "components/BrewPlanner.tsx#Bottle loadout": "a calculator — its numbers save nothing",
  "components/EventDayPlanner.tsx#Draft the day": "a brief for the day planner's agent — the blocks it drafts are the record",
};

const TEXTY = new Set(["", "text", "search", "email", "tel", "url", "number", "password", "date", "time", "datetime-local", "month", "week"]);

const attrOf = (el, name) => {
  for (const p of el.attributes.properties) {
    if (!ts.isJsxAttribute(p) || p.name.getText() !== name) continue;
    if (!p.initializer) return true;
    if (ts.isStringLiteral(p.initializer)) return p.initializer.text;
    if (ts.isJsxExpression(p.initializer) && p.initializer.expression && ts.isStringLiteral(p.initializer.expression)) return p.initializer.expression.text;
    if (ts.isJsxExpression(p.initializer) && p.initializer.expression && ts.isNoSubstitutionTemplateLiteral(p.initializer.expression)) return p.initializer.expression.text;
    return { expr: p.initializer.getText() };
  }
  return undefined;
};
const tagName = (el) => {
  const t = el.tagName;
  return ts.isIdentifier(t) ? t.text : ts.isPropertyAccessExpression(t) ? t.name.text : t.getText();
};
// (forEachChild stops at the first callback that returns something truthy — so the walk returns nothing.)
const openings = (node, out = []) => {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) out.push(node);
  ts.forEachChild(node, (c) => { openings(c, out); });
  return out;
};
const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const literal = (v) => (typeof v === "string" ? v : null);
/** The first class name in a className — a literal, or the head of a template. */
const firstClass = (el) => {
  const c = attrOf(el, "className");
  if (typeof c === "string") return c.split(/\s+/)[0];
  if (c && typeof c === "object") { const m = /^\{?`?([a-z][\w-]*)/i.exec(c.expr); return m ? m[1] : null; }
  return null;
};

/** What the four rules see in one file's source. `file` is repo-relative. */
export function gesturesIn(src, file = "x.tsx") {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
  const els = openings(sf);
  const overlays = [], tabRows = [], touches = [], sheets = [];
  for (const el of els) {
    const name = tagName(el);
    const role = attrOf(el, "role");
    if (role === "dialog" || role === "alertdialog") {
      // A <Sheet> draws its own dialog (and its "Discard your changes?") — the one place a dialog is
      // not hand-drawn.
      const label = literal(attrOf(el, "aria-label"));
      overlays.push({ line: lineOf(sf, el), key: label ? `${file}#${label}` : file, sheetItself: file === "components/Sheet.tsx" });
    }
    if (role === "tablist") tabRows.push({ line: lineOf(sf, el), key: `${file}#${literal(attrOf(el, "aria-label")) ?? firstClass(el) ?? "?"}` });
    // The kit's segmented control (components/controls.tsx, 2026-10-07) draws its own tab list — a tab row
    // at the place that uses it, named by its label, unless it is a choice (kind="choice", a radio group).
    if (name === "Segmented" && attrOf(el, "kind") !== "choice") tabRows.push({ line: lineOf(sf, el), key: `${file}#${literal(attrOf(el, "label")) ?? firstClass(el) ?? "?"}` });
    for (const p of el.attributes.properties) {
      if (ts.isJsxAttribute(p) && /^onTouch(Start|Move|End|Cancel)$/.test(p.name.getText())) touches.push({ line: lineOf(sf, p), what: `${name} ${p.name.getText()}` });
    }
    if (name === "Sheet") {
      // The text fields inside this sheet's own JSX — not in components it renders.
      const parent = el.parent;
      const inside = ts.isJsxElement(parent) ? openings(parent).slice(1) : [];
      const fields = inside.filter((x) => {
        const n = tagName(x);
        if (n === "textarea") return true;
        if (n !== "input") return false;
        const type = attrOf(x, "type");
        return typeof type !== "string" || TEXTY.has(type);
      });
      const label = literal(attrOf(el, "label")) ?? literal(attrOf(el, "labelledBy"));
      sheets.push({ line: lineOf(sf, el), key: label ? `${file}#${label}` : file, fields: fields.length, guarded: attrOf(el, "dirty") !== undefined });
    }
  }
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "addEventListener") {
      const a = node.arguments[0];
      if (a && ts.isStringLiteral(a) && /^touch/.test(a.text)) touches.push({ line: lineOf(sf, node), what: `addEventListener("${a.text}")` });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return {
    overlays, tabRows, touches, sheets,
    pages: /<SwipePager\b|usePagerLevel\(/.test(src),
    unsavedHook: /\buseUnsaved\(/.test(src),
  };
}

/** Each rule's verdict on one file's findings: the sites nothing answers. `used` collects the list
 *  entries that answered something, so an entry whose site is gone can be called stale. */
export function judgeFile(file, g, used = new Set()) {
  const out = [];
  const answers = (list, ...keys) => { const k = keys.find((x) => x in list); if (k) used.add(k); return !!k; };
  for (const o of g.overlays) {
    if (o.sheetItself) continue;
    if (!answers(OWN_OVERLAYS, o.key, file)) out.push({ rule: "overlay", file, line: o.line, what: `a hand-drawn dialog (${o.key}) — make it a <Sheet>, or name why it is its own thing in OWN_OVERLAYS` });
  }
  for (const t of g.tabRows) {
    if (answers(PAGED, t.key)) { if (!g.pages) out.push({ rule: "tabs", file, line: t.line, what: `${t.key} is listed as paged, and nothing in ${file} pages it` }); continue; }
    if (!answers(NOT_PAGES, t.key)) out.push({ rule: "tabs", file, line: t.line, what: `a tab row (${t.key}) that does not swipe — page it (SwipePager / usePagerLevel), or name why it is not pages in NOT_PAGES` });
  }
  if (g.touches.length && !answers(GESTURE_LAYER, file)) {
    for (const t of g.touches) out.push({ rule: "touch", file, line: t.line, what: `${t.what} outside the gesture layer — follow the finger with components/useGesture` });
  }
  for (const s of g.sheets) {
    if (!s.fields || s.guarded || g.unsavedHook) continue;
    if (!answers(NO_UNSAVED, s.key, file)) out.push({ rule: "unsaved", file, line: s.line, what: `a sheet with ${s.fields} text field(s) that does not say what leaving does to them — pass \`dirty\`, call useUnsaved, or name why in NO_UNSAVED` });
  }
  return out;
}

/** List entries that answered nothing — a site that went away, or a key spelled wrong. A list of
 *  exceptions nobody prunes is how a gate starts excusing what it was written to catch. */
export function staleEntries(used) {
  return [["OWN_OVERLAYS", OWN_OVERLAYS], ["PAGED", PAGED], ["NOT_PAGES", NOT_PAGES], ["GESTURE_LAYER", GESTURE_LAYER], ["NO_UNSAVED", NO_UNSAVED]]
    .flatMap(([name, list]) => Object.keys(list).filter((k) => !used.has(k)).map((k) => `${name}["${k}"]`));
}

export function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|\.next|\.git|\.smoke|dist)$/.test(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

export function collect(root = ".") {
  const found = [], bad = [], used = new Set();
  for (const f of [...walk(join(root, "app")), ...walk(join(root, "components"))]) {
    const rel = f.replace(/^\.\//, "");
    const g = gesturesIn(readFileSync(f, "utf8"), rel);
    found.push({ file: rel, g });
    bad.push(...judgeFile(rel, g, used));
  }
  for (const k of staleEntries(used)) bad.push({ rule: "stale", file: "scripts/gesture.audit.mjs", line: 0, what: `${k} answers nothing any more — take it out` });
  return { found, bad };
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] || "").href) {
  const { found, bad } = collect(".");
  const n = (k) => found.reduce((s, f) => s + f.g[k].length, 0);
  if (process.argv.includes("--list")) {
    for (const { file, g } of found) {
      for (const o of g.overlays) console.log(`  overlay  ${file}:${o.line}  ${o.sheetItself ? "the Sheet itself" : OWN_OVERLAYS[o.key] ?? OWN_OVERLAYS[file] ?? "— NOTHING ANSWERS IT"}`);
      for (const t of g.tabRows) console.log(`  tabs     ${file}:${t.line}  ${t.key in PAGED ? `pages — ${PAGED[t.key]}` : NOT_PAGES[t.key] ? `not pages — ${NOT_PAGES[t.key]}` : "— NOTHING ANSWERS IT"}`);
      for (const t of g.touches) console.log(`  touch    ${file}:${t.line}  ${t.what}${GESTURE_LAYER[file] ? ` — ${GESTURE_LAYER[file]}` : " — NOT THE GESTURE LAYER"}`);
      for (const s of g.sheets.filter((x) => x.fields)) console.log(`  form     ${file}:${s.line}  ${s.fields} field(s) · ${s.guarded ? "dirty" : g.unsavedHook ? "useUnsaved in the file" : NO_UNSAVED[s.key] ?? NO_UNSAVED[file] ?? "— NOTHING ANSWERS IT"}`);
    }
  }
  console.log(`GESTURE AUDIT: ${n("overlays")} dialog(s) · ${n("tabRows")} tab row(s) · ${n("touches")} touch listener(s) · ${found.reduce((s, f) => s + f.g.sheets.filter((x) => x.fields).length, 0)} sheet form(s) — ${bad.length} unanswered`);
  for (const b of bad) console.log(`  ✗ ${b.rule}: ${b.file}:${b.line} — ${b.what}`);
  process.exit(bad.length ? 1 : 0);
}
