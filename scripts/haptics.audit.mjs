// EVERY BUZZ IS A WORD — the haptics round's gate.
//
//   node scripts/haptics.audit.mjs          # fail on a buzz the vocabulary does not name
//   node scripts/haptics.audit.mjs --list   # every haptic() in the app, and the feel it plays
//
// ── WHY (2026-10-05) ───────────────────────────────────────────────────────────────────────────
// Before this round every call site picked a raw pattern out of a seven-entry table. HAPTIC.tap was a
// tab, a stepper, an order moving and a discount code accepted, all alike; HAPTIC.alert was a new
// order on the pass and a delivery held at a porch. Nothing said what a buzz meant, and the moments
// that needed one most — an error, a payment, a sheet that will not close — had none. The round gave
// the app one vocabulary: lib/haptics names a feel for each kind of moment, and one table holds the
// patterns. A call site says what happened, and a native wrapper can map each feel to the phone's own
// feedback. These three rules keep it one vocabulary:
//
//   1. ONE HOME     navigator.vibrate is called in lib/haptics.ts and nowhere else. A buzz played
//                   anywhere else is a pattern the vocabulary does not know, and no wrapper can map.
//   2. SAY WHAT     every haptic() outside lib/haptics.ts names its feel as one string literal from
//                   lib/haptics' Feel — not a number, an array, a variable or a template — so the
//                   feel is read at the call site, and a grep for a feel finds every place it plays.
//                   A choice between two feels is two calls, each with its own literal.
//   3. ALL FELT     every member of Feel has a pattern in lib/haptics' PATTERN table, and the table
//                   holds no pattern that no feel names.
//   4. AN ERROR SAYS SO (2026-10-06). A toast whose words are an error — "Error: …", "Couldn't …",
//                   "Can't …", "Save failed …", or `error ? "Error: …" : "Saved"` — passes the
//                   "error" variant (or `error ? "error" : …`). The error feel lives in toast() itself
//                   (components/AppProvider), so an error toast left on the default variant was shown
//                   in the success style AND not felt: driving the round, a refused event write said
//                   "Error: permission denied" in a success toast, silently. Twenty-nine did.
//
// The walk reads code with the TypeScript parser, like scripts/gesture.audit.mjs: a word in a comment
// or a string is not a call.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

/** The one home of the vocabulary, and of navigator.vibrate. */
export const HOME = "lib/haptics.ts";

const parse = (src, file) => ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
// (forEachChild stops at the first callback that returns something truthy — so the walk returns nothing.)
const visitAll = (node, fn) => { fn(node); ts.forEachChild(node, (c) => { visitAll(c, fn); }); };
const unwrap = (e) => { while (e && (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e))) e = e.expression; return e; };

// ── 3. the vocabulary ─────────────────────────────────────────────────────────────────────────────
/** The vocabulary as lib/haptics.ts writes it: the Feel union's members and PATTERN's keys, each with
 *  its line. A member that is not a string literal, or a key that is not a plain name, reads as null.
 *  `feels` / `table` are null when the file has no such union or table at all. */
export function vocabularyOf(src, file = HOME) {
  const sf = parse(src, file);
  let feels = null, table = null;
  visitAll(sf, (n) => {
    if (ts.isTypeAliasDeclaration(n) && n.name.text === "Feel") {
      const parts = ts.isUnionTypeNode(n.type) ? n.type.types : [n.type];
      feels = parts.map((p) => ({ name: ts.isLiteralTypeNode(p) && ts.isStringLiteral(p.literal) ? p.literal.text : null, line: lineOf(sf, p) }));
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "PATTERN") {
      const obj = unwrap(n.initializer);
      if (obj && ts.isObjectLiteralExpression(obj)) {
        table = obj.properties.map((p) => ({ name: ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null, line: lineOf(sf, p) }));
      }
    }
  });
  return { feels, table };
}

/** Rule 3's verdict on the vocabulary: a feel with no pattern, a pattern no feel names, or a list it
 *  cannot read. */
export function judgeVocabulary(v, file = HOME) {
  const out = [];
  if (!v.feels) out.push({ rule: "vocabulary", file, line: 0, what: "no `type Feel` union — the feels have no list" });
  if (!v.table) out.push({ rule: "vocabulary", file, line: 0, what: "no PATTERN object — the feels have no patterns" });
  if (!v.feels || !v.table) return out;
  const feels = v.feels.map((f) => f.name), keys = v.table.map((k) => k.name);
  for (const f of v.feels) {
    if (f.name === null) out.push({ rule: "vocabulary", file, line: f.line, what: "a member of Feel that is not a string literal — a feel is a word" });
    else if (!keys.includes(f.name)) out.push({ rule: "vocabulary", file, line: f.line, what: `"${f.name}" is a feel with no pattern — give it one in PATTERN` });
  }
  for (const k of v.table) {
    if (k.name === null) out.push({ rule: "vocabulary", file, line: k.line, what: "an entry in PATTERN that is not a plain feel: name — no spreads, no computed keys" });
    else if (!feels.includes(k.name)) out.push({ rule: "vocabulary", file, line: k.line, what: `PATTERN.${k.name} is a pattern no feel names — add it to Feel, or take it out` });
  }
  return out;
}

// ── 1 and 2. the call sites ───────────────────────────────────────────────────────────────────────
/** What rules 1 and 2 see in one file's source. `file` is repo-relative. A call is `haptic(…)` — or
 *  whatever name, or namespace, this file imported it from lib/haptics under. */
export function hapticsIn(src, file = "x.tsx") {
  const sf = parse(src, file);
  const names = new Set(["haptic"]), spaces = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !/(^|\/)haptics$/.test(st.moduleSpecifier.text)) continue;
    const b = st.importClause?.namedBindings;
    if (b && ts.isNamedImports(b)) for (const el of b.elements) { if ((el.propertyName ?? el.name).text === "haptic") names.add(el.name.text); }
    if (b && ts.isNamespaceImport(b)) spaces.add(b.name.text);
  }
  const calls = [], vibrates = [], toasts = [];
  visitAll(sf, (n) => {
    // Rule 4: a toast whose words are an error, and whether it says so with its variant.
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "toast" && n.arguments.length) {
      const msg = unwrap(n.arguments[0]);
      const errorish = ts.isConditionalExpression(msg) ? saysError(msg.whenTrue) && !saysError(msg.whenFalse) : saysError(msg);
      if (errorish) toasts.push({ line: lineOf(sf, n), ok: variantIsError(n.arguments[1]), what: n.getText(sf).replace(/\s+/g, " ").slice(0, 90) });
    }
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      const named = ts.isIdentifier(c) && names.has(c.text);
      const spaced = ts.isPropertyAccessExpression(c) && c.name.text === "haptic" && ts.isIdentifier(c.expression) && spaces.has(c.expression.text);
      if (named || spaced) {
        const a = n.arguments;
        calls.push({ line: lineOf(sf, n), feel: a.length === 1 && ts.isStringLiteral(a[0]) ? a[0].text : null, arg: a.map((x) => x.getText(sf)).join(", ") });
      }
    }
    // A vibrate reached for, called or not: navigator.vibrate, nav?.vibrate, navigator["vibrate"],
    // `const { vibrate } = navigator`.
    if (ts.isPropertyAccessExpression(n) && n.name.text === "vibrate") vibrates.push({ line: lineOf(sf, n), what: n.getText(sf) });
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === "vibrate") vibrates.push({ line: lineOf(sf, n), what: n.getText(sf) });
    if (ts.isBindingElement(n) && (n.propertyName ?? n.name).getText(sf) === "vibrate") vibrates.push({ line: lineOf(sf, n), what: `{ ${n.getText(sf)} }` });
  });
  return { calls, vibrates, toasts };
}

/** The words an error toast starts with. A literal (string or template head) that starts so is an error. */
export const ERROR_WORDS = /^(Error\b|Couldn['’]t|Could not|Can['’]t|Cannot|Failed|Save failed|Didn['’]t|That didn['’]t|Not saved|Something went wrong)/;
function saysError(e) {
  e = unwrap(e);
  if (!e) return false;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return ERROR_WORDS.test(e.text);
  if (ts.isTemplateExpression(e)) return ERROR_WORDS.test(e.head.text);
  return false;
}
/** The variant says error: "error", or a choice with "error" on one side (`error ? "error" : undefined`). */
function variantIsError(v) {
  v = unwrap(v);
  if (!v) return false;
  if (ts.isStringLiteral(v)) return v.text === "error";
  if (ts.isConditionalExpression(v)) return [v.whenTrue, v.whenFalse].some((b) => { const u = unwrap(b); return ts.isStringLiteral(u) && u.text === "error"; });
  return false;
}

/** Rules 1, 2 and 4's verdict on one file's findings. `feels` is the Feel union's members. */
export function judgeFile(file, found, feels) {
  if (file === HOME) return [];
  const out = [];
  for (const v of found.vibrates) out.push({ rule: "home", file, line: v.line, what: `${v.what} outside lib/haptics.ts — say what happened with haptic("<feel>")` });
  for (const c of found.calls) {
    if (c.feel === null) out.push({ rule: "feel", file, line: c.line, what: `haptic(${c.arg}) — name the feel as one string literal from lib/haptics' Feel` });
    else if (!feels.includes(c.feel)) out.push({ rule: "feel", file, line: c.line, what: `haptic("${c.feel}") — "${c.feel}" is not a feel; lib/haptics' Feel has ${feels.join(", ")}` });
  }
  for (const t of found.toasts ?? []) {
    if (!t.ok) out.push({ rule: "error-toast", file, line: t.line, what: `${t.what} — an error toast passes "error" (or error ? "error" : …): the default shows it as a success, and it is not felt` });
  }
  return out;
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
  const vocab = vocabularyOf(readFileSync(join(root, HOME), "utf8"));
  const feels = (vocab.feels ?? []).map((f) => f.name).filter((f) => f !== null);
  const found = [], bad = [...judgeVocabulary(vocab)];
  for (const f of [...walk(join(root, "app")), ...walk(join(root, "components")), ...walk(join(root, "lib"))]) {
    const rel = relative(root, f).split(sep).join("/");
    const g = hapticsIn(readFileSync(f, "utf8"), rel);
    found.push({ file: rel, g });
    bad.push(...judgeFile(rel, g, feels));
  }
  return { vocab, feels, found, bad };
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] || "").href) {
  const { feels, found, bad } = collect(".");
  const calls = found.filter((f) => f.file !== HOME).flatMap(({ file, g }) => g.calls.map((c) => ({ file, ...c })));
  if (process.argv.includes("--list")) {
    for (const c of calls) console.log(`  ${c.feel ?? "— NOT A FEEL"}`.padEnd(16) + `  ${c.file}:${c.line}`);
  }
  const played = new Set(calls.map((c) => c.feel).filter(Boolean));
  const errorToasts = found.flatMap(({ g }) => g.toasts ?? []).length;
  console.log(`HAPTICS AUDIT: ${feels.length} feel(s) · ${calls.length} haptic() call(s) in ${new Set(calls.map((c) => c.file)).size} file(s), ${played.size} feel(s) played · ${errorToasts} error toast(s) — ${bad.length} unanswered`);
  for (const b of bad) console.log(`  ✗ ${b.rule}: ${b.file}:${b.line} — ${b.what}`);
  process.exit(bad.length ? 1 : 0);
}
