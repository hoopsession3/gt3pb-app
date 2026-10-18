// SPOKEN AUDIT — a status line put on the page already holding its words is not heard.
//
//   node scripts/spoken.audit.mjs           # count, and fail if any
//   node scripts/spoken.audit.mjs --list    # every one, to read
//
// ── THE BUG (A11Y F12 — R12, and again in R25 of the 10/10 audit) ──────────────────────────────────────────────────────
//     {done && <p role="status">Free cup given</p>}
//
// A live region tells a screen reader "say what changes in me". One that arrives with its words already in it has not
// changed — VoiceOver, the one on every phone that orders here, skips it — so "Free cup given", "Couldn't load the notes"
// and "Signed out — showing the board from 3:04" were never heard by the person who couldn't see them. R12 made
// components/Said for exactly this (it draws the words and hands them to the app's one live region, components/Announcer,
// whenever they appear or change) and moved twenty-one lines onto it; nothing counted the pattern, and by R24 there were
// twenty-nine again. This counts it, and holds it at zero.
//
// ── WHAT COUNTS ───────────────────────────────────────────────────────────────────────────────────────────────────────
// A JSX element with role="status", or with an aria-live other than "off" (role="alert" aside: an alert is announced as it
// is inserted, which is what it is for), that is itself the operand of a conditional render — the right side of `&&`, or
// either side of `? :` — so it is put on the page with its words. A region that stays on the page and whose words change
// is how a live region is meant to work, and is not counted; nor is one inside a larger part that comes and goes (it may
// arrive empty). Read by TypeScript's own parser, so a comment or a string that looks like JSX is not counted.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// Raise nothing.
export const UNHEARD_BASELINE = 0;

/** Every live region in this source that is put on the page already holding its words. Pure. */
export function unheardIn(src, file = "x.tsx") {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const literal = (name) => {
        const a = opening.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === name);
        if (!a) return null;
        if (!a.initializer) return "";
        if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
        if (ts.isJsxExpression(a.initializer) && a.initializer.expression && ts.isStringLiteralLike(a.initializer.expression)) return a.initializer.expression.text;
        return "?";   // computed: may be a live region
      };
      const role = literal("role"), live = literal("aria-live");
      const isLive = role === "status" || (live !== null && live !== "off" && role !== "alert");
      if (isLive) {
        let child = node, parent = node.parent;
        while (parent && ts.isParenthesizedExpression(parent)) { child = parent; parent = parent.parent; }
        const conditional = parent && ((ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && parent.right === child)
          || (ts.isConditionalExpression(parent) && (parent.whenTrue === child || parent.whenFalse === child)));
        if (conditional) out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, tag: opening.tagName.getText(sf), role, live });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ── AND ONE WITH NO VOICE AT ALL (R34 — the fresh audit's UX11-06) ──────────────────────────────────────────────────
// The count above sees only a region that says it is one. A failure drawn as a plain line — {err && <div className="dp-err">
// {err}</div>} — has no role and no aria-live, so it was never heard and never counted: twenty-three of them, "Couldn't
// build the list" under Event prep AI among them. A line put on the page with a failure's or a warning's look (a class
// named err or error, or ending -err or -error) or holding an err / error / msg / warn value is a Said, or role="alert". A
// warning chip or a priority tag drawn with its row (a list's own content, not something that happened) isn't counted.
export const SILENT_BASELINE = 0;
const FAILURE_LOOK = /(^|[\s-])(err|error)($|\s)/;
const FAILURE_VALUE = /^(err|error|msg|warn|errorMsg|errMsg)$/;

/** Every failure or warning line put on the page with no voice — not a Said, no role="alert", no live region. Pure. */
export function silentIn(src, file = "x.tsx") {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText(sf);
      const attr = (name) => opening.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === name);
      const text = (a) => !a?.initializer ? null : ts.isStringLiteral(a.initializer) ? a.initializer.text
        : ts.isJsxExpression(a.initializer) && a.initializer.expression && ts.isStringLiteralLike(a.initializer.expression) ? a.initializer.expression.text : null;
      const cls = text(attr("className")) ?? "";
      // EditableCopy is the page's own words, editable by the owner — a state the page is in as it is drawn (checkout off),
      // not something that just happened.
      // A line whose words are a Said inside it (a button beside them) is voiced by that Said.
      const holdsSaid = (n) => { let found = false; const look = (c) => { if (found) return; if ((ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) && (ts.isJsxElement(c) ? c.openingElement : c).tagName.getText(sf) === "Said") { found = true; return; } ts.forEachChild(c, look); }; ts.forEachChild(n, look); return found; };
      const voiced = tag === "Said" || tag === "EditableCopy" || attr("role") || attr("aria-live") || holdsSaid(node);
      const holdsFailure = ts.isJsxElement(node) && node.children.some((c) => ts.isJsxExpression(c) && c.expression && ts.isIdentifier(c.expression) && FAILURE_VALUE.test(c.expression.text));
      if (!voiced && (FAILURE_LOOK.test(cls) || holdsFailure)) {
        let child = node, parent = node.parent;
        while (parent && ts.isParenthesizedExpression(parent)) { child = parent; parent = parent.parent; }
        const conditional = parent && ((ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && parent.right === child)
          || (ts.isConditionalExpression(parent) && (parent.whenTrue === child || parent.whenFalse === child)));
        if (conditional) out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, tag, cls });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|\.next|\.git|\.smoke|dist|out|ios|android)$/.test(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

export function collect(root = ".", find = unheardIn) {
  const hits = [];
  for (const dir of ["app", "components"]) {
    for (const f of walk(join(root, dir))) for (const h of find(readFileSync(f, "utf8"), f)) hits.push({ file: f.replace(/^\.\//, ""), ...h });
  }
  return hits;
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] || "").href) {
  const silent = collect(".", silentIn);
  console.log(`SPOKEN AUDIT: ${silent.length} failure or warning line(s) put on the page with no voice (baseline ${SILENT_BASELINE})`);
  if (process.argv.includes("--list") || silent.length > SILENT_BASELINE) for (const h of silent) console.log(`  ${h.file}:${h.line}  <${h.tag}${h.cls ? ` className="${h.cls}"` : ""}>`);
  if (silent.length > SILENT_BASELINE) {
    console.log(`\n  ✗ ${silent.length} > ${SILENT_BASELINE}. A failure or a warning that appears must be heard: draw it with components/Said`);
    console.log(`    (<Said assertive className="dp-err">{err}</Said>), or give it role="alert".`);
    process.exit(1);
  }
  const hits = collect(".");
  console.log(`SPOKEN AUDIT: ${hits.length} status line(s) put on the page already holding their words (baseline ${UNHEARD_BASELINE})`);
  if (process.argv.includes("--list") || hits.length > UNHEARD_BASELINE) for (const h of hits) console.log(`  ${h.file}:${h.line}  <${h.tag}${h.role ? ` role="${h.role}"` : ""}${h.live ? ` aria-live="${h.live}"` : ""}>`);
  if (hits.length > UNHEARD_BASELINE) {
    console.log(`\n  ✗ ${hits.length} > ${UNHEARD_BASELINE}. VoiceOver skips a live region that arrives with its words: draw them with components/Said`);
    console.log(`    (<Said as="span" assertive>Couldn't load …</Said>, a button left outside it), or keep the region on the page and change its words.`);
    process.exit(1);
  }
}
