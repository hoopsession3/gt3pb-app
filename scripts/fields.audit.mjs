// A FIELD WITH NO NAME — every input, select and textarea a screen draws without a label a person (or VoiceOver) can read,
// and every sheet drawn with no name of its own.
//
//   node scripts/fields.audit.mjs          # count, and fail if it rose
//   node scripts/fields.audit.mjs --list   # every field, where
//
// ── WHY (R34, 2026-10-18 — the fresh audit's UX11-08) ──────────────────────────────────────────
// A parse of the screens found 591 fields and 105 with nothing naming them but a placeholder — about ninety in the
// console: a vendor's place opened with its contact filled in ("Dana", "864…", "dana@…") and nothing said which was the
// name, the phone or the email; a screen reader heard the placeholder, or nothing once the field was filled. WCAG 3.3.2
// and 4.1.2: a field says what it is, and keeps saying it when it holds a value.
//
// A field is named when it has an aria-label or aria-labelledby, sits inside a <label>, or has an id a <label htmlFor>
// in the same file points at. A field drawn by the Field primitive (components/Field) is named by it. Pass-through
// fields (`<input {...props} />` in a primitive) are the primitive's caller's to name; a Sheet passes `label` or
// `labelledBy` (two did neither — the street-address sheet and This week's drop — and were announced as "Dialog"); hidden, submit and button inputs
// name nothing, and a file picker that isn't drawn (hidden, opened by a button that says what it does) has no name to give. This count may not grow; it is held at what it is.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Measured 2026-10-18 at 101 fields and 2 sheets; R35 named every one. Raise nothing.
export const UNNAMED_CEILING = 0;

const FIELDS = new Set(["input", "select", "textarea"]);
const NAMELESS_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

/** The fields in this source with nothing naming them: [line, the tag's first line]. */
export function unnamedIn(src, file = "x.tsx") {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const htmlFor = new Set();
  const fields = [];
  const attrText = (a) => {
    const init = a.initializer;
    if (!init) return "";
    if (ts.isStringLiteral(init)) return `"${init.text}"`;
    if (ts.isJsxExpression(init) && init.expression) return init.expression.getText(sf).replace(/\s+/g, "");
    return init.getText(sf);
  };
  const visit = (node, inLabel) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const open = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = open.tagName.getText(sf);
      const attrs = open.attributes.properties;
      if (tag === "label") {
        for (const a of attrs) if (ts.isJsxAttribute(a) && a.name.getText(sf) === "htmlFor") htmlFor.add(attrText(a));
        if (ts.isJsxElement(node)) node.children.forEach((c) => visit(c, true));
        return;
      }
      // A sheet is a dialog, and a dialog says what it is: one with no label or labelledBy was announced as "Dialog".
      if (tag === "Sheet") {
        const has = (k) => attrs.some((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === k);
        if (!attrs.some((a) => ts.isJsxSpreadAttribute(a)) && !has("label") && !has("labelledBy")) {
          const { line } = sf.getLineAndCharacterOfPosition(open.getStart(sf));
          fields.push({ line: line + 1, id: null, text: `a sheet with no name — ${open.getText(sf).split("\n")[0].slice(0, 110)}` });
        }
      }
      if (FIELDS.has(tag)) {
        const names = new Map();
        let spread = false;
        for (const a of attrs) {
          if (ts.isJsxSpreadAttribute(a)) spread = true;
          else names.set(a.name.getText(sf), a);
        }
        const type = names.get("type") ? attrText(names.get("type")).replace(/"/g, "") : "";
        // Not drawn at all — a file picker a button opens (`hidden`, or display none): the button names what it does.
        const undrawn = names.has("hidden") || /display:\s*"none"/.test(names.get("style") ? attrText(names.get("style")) : "");
        if (!spread && !undrawn && !NAMELESS_TYPES.has(type) && !names.has("aria-label") && !names.has("aria-labelledby") && !inLabel) {
          const { line } = sf.getLineAndCharacterOfPosition(open.getStart(sf));
          fields.push({ line: line + 1, id: names.get("id") ? attrText(names.get("id")) : null, text: open.getText(sf).split("\n")[0].slice(0, 140) });
        }
      }
    }
    ts.forEachChild(node, (c) => visit(c, inLabel));
  };
  visit(sf, false);
  return fields.filter((f) => !(f.id && htmlFor.has(f.id))).map((f) => [f.line, f.text]);
}

function walk(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(join(ROOT, p)).isDirectory()) return n === "node_modules" || (dir === "app" && n === "api") ? [] : walk(p);
    return /\.tsx$/.test(n) ? [p] : [];
  });
}

/** Every unnamed field on the screens: [file, line, text]. */
export function unnamedFields() {
  return ["app", "components"].flatMap(walk).flatMap((f) => unnamedIn(readFileSync(join(ROOT, f), "utf8"), f).map(([n, t]) => [relative(ROOT, join(ROOT, f)), n, t]));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const all = unnamedFields();
  console.log(`FIELDS AUDIT: ${all.length} field(s) with no name (ceiling ${UNNAMED_CEILING})`);
  if (process.argv.includes("--list") || all.length > UNNAMED_CEILING) for (const [f, n, t] of all) console.log(`  • ${f}:${n}  ${t}`);
  if (all.length > UNNAMED_CEILING) {
    console.log(`  ✗ up from ${UNNAMED_CEILING}. Name it: a visible <label htmlFor>, the Field primitive, or an aria-label that says what it holds.`);
    process.exit(1);
  }
}
