// A WORD THE TABLE REFUSES — every literal the app writes to, or filters on, a column whose
// migration limits it to a list, held to that list.
//
//   node scripts/vocab.audit.mjs          # count, and fail if it rose
//   node scripts/vocab.audit.mjs --list   # every word it checked, and against what
//
// ── WHY (2026-10-04) ───────────────────────────────────────────────────────────────────────────
// Ryan: "strategically look for where something … should have operational functionality." Reading
// the inbox that night, the held-delivery alert's one button — "Picked up" — wrote
// delivery_orders.status = 'picked_up'. That table has never had the word (0139: received · brewed ·
// out_for_delivery · delivered · held_for_pickup · issue). Every tap failed; the card said "open it
// to handle manually" and there was nowhere to open. Comparing every literal the app writes against
// every list the migrations declare found a second the same night: promoting a booking request
// inserted opportunities.stage = 'talking', a stage 0265 retired in August (its own map: talking →
// warm), so every promote since made the account and then failed. Two buttons that looked like they
// worked and could not.
//
// Nothing could have seen either. supabase-js resolves a refused write as { error } rather than
// throwing; tsc knows nothing about a string handed to .update(); the db tests run hand-written
// fixtures that agree with whoever wrote them. The app keeps one vocabulary and the table another,
// and nothing compared them. This does.
//
// ── WHAT IT READS ──────────────────────────────────────────────────────────────────────────────
//   the table's words  every `check (col in (…))`, `check (col is null or col in (…))` and
//                      `check (col = any (array[…]))` in supabase/migrations, in file order and
//                      statement order. A later add replaces, a drop removes — by constraint name,
//                      and a column's own check is named <table>_<col>_check, as Postgres names it.
//                      `create table if not exists` for a table already made, and `add column if not
//                      exists` for a column already there, are skipped whole, checks and all — as
//                      Postgres skips them. Comments and function bodies are not DDL.
//   the app's words    string and number literals in `.from("t")…update / insert / upsert({ col: … })`
//                      — through `a ? "x" : "y"`, `?? "x"`, spread objects, arrays and `.map()` rows —
//                      and in filters on such a chain: .eq / .neq / .in / .match / .not(col, "in", …).
//                      A filter for a word the column can never hold is a list that is always empty:
//                      the read-side of the same mistake.
//
// THE MIGRATIONS ARE NOT PRODUCTION, and columns.audit.mjs says why at length. A constraint changed
// by hand in the SQL editor is invisible here. What this can honour is the pending set: a migration
// in supabase/APPLY_ALL_PENDING.sql is not in production yet, so its words are not counted as the
// table's — a write that needs one is reported as ARRIVING with it, the way the columns audit
// reports a column.
//
// WHAT IT CANNOT SEE: a value in a variable (`update(patch)`), a write through an RPC, a view (the
// lists live on tables). Those are reading jobs. This number is what may not grow.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { pendingMigrations } from "./columns.audit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Raise nothing. Measured 2026-10-04 after the two fixes: 0 refused.
export const REFUSED_CEILING = 0;

// ── the table's words ─────────────────────────────────────────────────────────────────────────

/**
 * What a migration runs as DDL: comments out; a function's body out (it runs when the function is
 * called, not when the migration is applied); a DO block's body KEPT and unwrapped, because it runs
 * right there — eleven list checks in this repo are added inside one (0276, 0280, 0286, 0295, 0298).
 */
function ddlOnly(sql) {
  const noComments = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  return noComments.replace(/\$([a-z_]*)\$([\s\S]*?)\$\1\$/gi, (whole, tag, body, at, all) =>
    /\bdo\s*$/i.test(all.slice(Math.max(0, at - 40), at)) ? ` ${body} ` : " ");
}
/** Split on a character at paren depth 0, outside quotes. */
function splitTop(s, ch) {
  const out = []; let depth = 0, q = false, cur = "";
  for (const c of s) {
    if (c === "'") q = !q;
    if (!q && c === "(") depth++;
    if (!q && c === ")") depth--;
    if (!q && depth === 0 && c === ch) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
/** The text inside the parens that open at or after `from`. */
function parenBody(s, from = 0) {
  const i = s.indexOf("(", from);
  if (i < 0) return null;
  let depth = 0, q = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "'") q = !q;
    if (q) continue;
    if (c === "(") depth++;
    if (c === ")" && --depth === 0) return { body: s.slice(i + 1, j), end: j + 1 };
  }
  return null;
}
/** A check expression → { col, values } when it is a list, else null (a range, a length, …). */
export function listOf(expr) {
  const e = expr.trim().replace(/\s+/g, " ");
  const vals = (inner) => {
    const out = [];
    for (const m of inner.matchAll(/'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?)/g)) out.push(m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]);
    return out;
  };
  let m = e.match(/^\(?\s*"?(\w+)"?\s*\)?\s+in\s*\(([\s\S]*)\)$/i);
  if (m) return { col: m[1].toLowerCase(), values: vals(m[2]) };
  m = e.match(/^\(?\s*"?(\w+)"?\s*\)?\s+is null or \(?\s*"?(\w+)"?\s*\)?\s+in\s*\(([\s\S]*)\)$/i);
  if (m && m[1].toLowerCase() === m[2].toLowerCase()) return { col: m[1].toLowerCase(), values: vals(m[3]) };
  m = e.match(/^\(?\s*"?(\w+)"?\s*\)?\s*=\s*any\s*\(\s*\(?\s*array\s*\[([\s\S]*?)\]/i);
  if (m) return { col: m[1].toLowerCase(), values: vals(m[2]) };
  return null;
}

/**
 * Every list the migrations leave standing: "table.col" → { values, file, name }.
 * `files` is [{ file, text }] in apply order. Exported for scripts/audits.test.mjs.
 */
export function vocabularies(files) {
  const lists = new Map();    // "table/constraint" → { table, col, values, file, name }
  const names = new Set();    // "table/constraint" for every check, list or not — a name is taken either way
  const tables = new Map();   // table → Set(columns) — what exists, for the `if not exists` skips
  // An unnamed check is named the way Postgres names it: <table>_<col>_check, then …_check1, …_check2.
  const autoName = (table, col) => {
    for (let i = 0; ; i++) { const n = `${table}_${col}_check${i || ""}`; if (!names.has(`${table}/${n}`)) return n; }
  };
  const setCheck = (table, name, expr, file) => {
    const key = `${table}/${name}`;
    names.add(key);
    const l = listOf(expr);
    if (l) lists.set(key, { table, col: l.col, values: l.values, file, name });
  };
  const columnDef = (table, def, file) => {
    // col type … [constraint name] check (…) [check (…)]
    const col = def.trim().match(/^"?(\w+)"?/)?.[1]?.toLowerCase();
    if (!col) return;
    tables.get(table)?.add(col);
    for (let at = def.search(/\bcheck\s*\(/i); at >= 0; ) {
      const named = def.slice(0, at).match(/\bconstraint\s+"?(\w+)"?\s*$/i)?.[1]?.toLowerCase();
      const p = parenBody(def, at);
      if (!p) break;
      setCheck(table, named ?? autoName(table, col), p.body, file);
      const next = def.slice(p.end).search(/\bcheck\s*\(/i);
      at = next < 0 ? -1 : p.end + next;
    }
  };
  const tableCheck = (table, t, file) => {
    const p = parenBody(t, t.search(/check\s*\(/i));
    if (!p) return;
    const named = t.match(/^constraint\s+"?(\w+)"?\s+check\s*\(/i)?.[1]?.toLowerCase();
    const first = p.body.match(/[a-z_]\w*/i)?.[0]?.toLowerCase() ?? "expr";   // Postgres names it for the first column
    setCheck(table, named ?? autoName(table, listOf(p.body)?.col ?? first), p.body, file);
  };
  const tableItem = (table, item, file) => {
    const t = item.trim();
    if (/^(constraint\s+"?\w+"?\s+)?check\s*\(/i.test(t)) return tableCheck(table, t, file);
    if (/^(constraint|primary|unique|foreign|exclude|like)\b/i.test(t)) return;
    columnDef(table, t, file);
  };
  for (const { file, text } of files) {
    for (const raw of splitTop(ddlOnly(text), ";")) {
      let st = raw.trim().replace(/\s+/g, " ");
      // Inside a DO block a statement follows begin / then / else / loop. Anything else ahead of the
      // words "alter table" means they are not where a statement starts — a string, say.
      const at = st.search(/\b(create (?:unlogged )?table|drop table|alter table)\b/i);
      if (at < 0) continue;
      const lead = st.slice(0, at).trim();
      if (lead && !/\b(begin|then|else|loop)$/i.test(lead)) continue;
      // `if not exists (select … from pg_constraint where conname = 'x') then` — the add happens only
      // when no constraint has that name yet, and which names are taken is a thing this reader knows.
      const onlyIfNew = lead.match(/if not exists \(\s*select\b[^;]*?\bconname\s*=\s*'(\w+)'[^;]*?\)\s*then$/i)?.[1]?.toLowerCase() ?? null;
      st = st.slice(at);
      let m;
      if ((m = st.match(/^create (?:unlogged )?table (if not exists )?(?:public\.)?"?(\w+)"?\s*\(/i))) {
        const table = m[2].toLowerCase();
        if (m[1] && tables.has(table)) continue;          // Postgres skips it whole
        tables.set(table, new Set());
        const p = parenBody(st, m[0].length - 1);
        if (p) for (const item of splitTop(p.body, ",")) tableItem(table, item, file);
        continue;
      }
      if ((m = st.match(/^drop table (?:if exists )?(?:public\.)?"?(\w+)"?/i))) {
        const table = m[1].toLowerCase();
        tables.delete(table);
        for (const k of [...lists.keys()]) if (k.startsWith(`${table}/`)) lists.delete(k);
        for (const k of [...names]) if (k.startsWith(`${table}/`)) names.delete(k);
        continue;
      }
      if ((m = st.match(/^alter table (?:if exists )?(?:only )?(?:public\.)?"?(\w+)"?\s+([\s\S]*)$/i))) {
        const table = m[1].toLowerCase();
        if (!tables.has(table)) tables.set(table, new Set());
        for (const action of splitTop(m[2], ",")) {
          const a = action.trim();
          let x;
          if ((x = a.match(/^add column (if not exists )?([\s\S]*)$/i)) || (x = a.match(/^add (?!constraint\b|check\b|primary\b|unique\b|foreign\b|exclude\b)()([\s\S]*)$/i))) {
            const col = x[2].trim().match(/^"?(\w+)"?/)?.[1]?.toLowerCase();
            if (x[1] && col && tables.get(table).has(col)) continue;   // skipped whole, check and all
            columnDef(table, x[2], file);
          } else if ((x = a.match(/^add (constraint "?(\w+)"? )?check\s*\(/i))) {
            const name = x[2]?.toLowerCase();
            if (name && onlyIfNew === name && names.has(`${table}/${name}`)) continue;
            tableCheck(table, a.slice(4), file);
          } else if ((x = a.match(/^drop constraint (?:if exists )?"?(\w+)"?/i))) {
            lists.delete(`${table}/${x[1].toLowerCase()}`);
            names.delete(`${table}/${x[1].toLowerCase()}`);
          } else if ((x = a.match(/^drop column (?:if exists )?"?(\w+)"?/i))) {
            const col = x[1].toLowerCase();
            tables.get(table).delete(col);
            for (const [k, v] of lists) if (v.table === table && v.col === col) lists.delete(k);
          }
        }
      }
    }
  }
  // Two lists on one column both have to pass: keep what both allow.
  const out = new Map();
  for (const v of lists.values()) {
    const k = `${v.table}.${v.col}`;
    const prev = out.get(k);
    out.set(k, prev ? { ...v, values: v.values.filter((x) => prev.values.includes(x)), name: `${prev.name} + ${v.name}` } : v);
  }
  return out;
}

// ── the app's words ───────────────────────────────────────────────────────────────────────────

const WRITES = new Set(["update", "insert", "upsert"]);
const FILTERS = new Set(["eq", "neq", "in", "match", "not"]);

/** The table a supabase chain starts from: walk down `.x(…).y(…)` to `.from("t")`. */
function tableOf(expr) {
  let e = expr;
  while (e) {
    if (ts.isCallExpression(e)) {
      const c = e.expression;
      if (ts.isPropertyAccessExpression(c) && c.name.text === "from" && e.arguments[0] && ts.isStringLiteralLike(e.arguments[0])) return e.arguments[0].text;
      e = ts.isPropertyAccessExpression(c) ? c.expression : null;
    } else if (ts.isPropertyAccessExpression(e) || ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e)) e = e.expression;
    else return null;
  }
  return null;
}
/** Literal values an expression can be: "x", 3, a ? "x" : "y", v ?? "x". Anything else: none. */
function literals(n) {
  if (!n) return [];
  if (ts.isStringLiteralLike(n)) return [n.text];
  if (ts.isNumericLiteral(n)) return [n.text];
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand)) return [`-${n.operand.text}`];
  if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n))) return literals(n.expression);
  if (ts.isConditionalExpression(n)) return [...literals(n.whenTrue), ...literals(n.whenFalse)];
  if (ts.isBinaryExpression(n) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(n.operatorToken.kind)) return [...literals(n.left), ...literals(n.right)];
  return [];
}
/** Object literals a write's argument can be: through parens, conditionals, &&, arrays and .map() rows. */
function objectsIn(n) {
  if (!n) return [];
  if (ts.isObjectLiteralExpression(n)) return [n];
  if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)) return objectsIn(n.expression);
  if (ts.isConditionalExpression(n)) return [...objectsIn(n.whenTrue), ...objectsIn(n.whenFalse)];
  if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(n.operatorToken.kind)) return [...objectsIn(n.left), ...objectsIn(n.right)];
  if (ts.isArrayLiteralExpression(n)) return n.elements.flatMap(objectsIn);
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "map") {
    const fn = n.arguments[0];
    if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
      if (!ts.isBlock(fn.body)) return objectsIn(fn.body);
      const outs = [];
      const visit = (x) => { if (ts.isReturnStatement(x)) outs.push(...objectsIn(x.expression)); else if (!ts.isFunctionLike(x)) ts.forEachChild(x, visit); };
      ts.forEachChild(fn.body, visit);
      return outs;
    }
  }
  return [];
}
function propsOf(obj, out) {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p)) {
      const name = ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name) ? p.name.text : null;
      if (name) for (const v of literals(p.initializer)) out.push({ col: name.toLowerCase(), value: v });
    } else if (ts.isSpreadAssignment(p)) {
      for (const o of objectsIn(p.expression)) propsOf(o, out);
    }
  }
  return out;
}

/** Every literal word one file writes or filters on, with the table it goes to. Exported for tests. */
export function wordsIn(src, file = "x.tsx") {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.m?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n) => {
    // A list the app keeps for a column, declared as such: `// vocab: table.col` on the line above.
    // Its words are held to the table's like any write — a list is where a retired word hides.
    if (ts.isVariableStatement(n)) {
      const lead = (ts.getLeadingCommentRanges(src, n.getFullStart()) ?? []).map((r) => src.slice(r.pos, r.end)).join("\n");
      const said = [...lead.matchAll(/\/\/\s*vocab:\s*(\w+)\.(\w+)\s*$/gm)].pop();
      if (said) {
        for (const d of n.declarationList.declarations) {
          let init = d.initializer;
          while (init && (ts.isAsExpression(init) || ts.isParenthesizedExpression(init) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(init)))) init = init.expression;
          const add = (v) => out.push({ file, line: line(d), table: said[1], col: said[2].toLowerCase(), value: v, how: "list" });
          if (init && ts.isArrayLiteralExpression(init)) for (const el of init.elements) literals(el).forEach(add);
          else if (init && ts.isObjectLiteralExpression(init))   // a label map keyed by the column's words
            for (const p of init.properties) if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name))) add(p.name.text);
        }
      }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const op = n.expression.name.text;
      if (WRITES.has(op) || FILTERS.has(op)) {
        const table = tableOf(n.expression.expression);
        if (table) {
          const add = (col, value, how) => out.push({ file, line: line(n), table, col, value, how });
          const [a0, a1, a2] = n.arguments;
          if (WRITES.has(op)) for (const o of objectsIn(a0)) for (const { col, value } of propsOf(o, [])) add(col, value, op);
          else if (op === "match") for (const o of objectsIn(a0)) for (const { col, value } of propsOf(o, [])) add(col, value, "filter");
          else if (a0 && ts.isStringLiteralLike(a0)) {
            const col = a0.text.toLowerCase();
            if (op === "eq" || op === "neq") for (const v of literals(a1)) add(col, v, "filter");
            if (op === "in" && a1 && ts.isArrayLiteralExpression(a1)) for (const el of a1.elements) for (const v of literals(el)) add(col, v, "filter");
            if (op === "not" && a1 && ts.isStringLiteralLike(a1) && a1.text === "in" && a2 && ts.isStringLiteralLike(a2))
              for (const v of a2.text.replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean)) add(col, v, "filter");
            if (op === "not" && a1 && ts.isStringLiteralLike(a1) && a1.text === "eq") for (const v of literals(a2)) add(col, v, "filter");
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The words a table refuses. `arriving` (optional) is the vocabulary once pending migrations land. */
export function judge(vocab, words, arriving = null) {
  const refused = [], arrivingWith = [], checked = [];
  for (const w of words) {
    const v = vocab.get(`${w.table}.${w.col}`);
    const later = arriving?.get(`${w.table}.${w.col}`);
    if (!v && !later) continue;
    checked.push(w);
    if (v && v.values.includes(w.value)) continue;
    if (later && later.values.includes(w.value)) { arrivingWith.push({ ...w, allowed: later.values, from: later.file }); continue; }
    refused.push({ ...w, allowed: (v ?? later).values, from: (v ?? later).file });
  }
  return { refused, arriving: arrivingWith, checked };
}

// ── the run ───────────────────────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|\.next|\.git|\.smoke|dist)$/.test(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

export function collect(root = ROOT) {
  const MIG = join(root, "supabase/migrations");
  const all = readdirSync(MIG).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
    .map((f) => ({ file: f, num: Number(f.slice(0, 4)), text: readFileSync(join(MIG, f), "utf8") }));
  const pending = pendingMigrations();   // null: cannot tell — then nothing is held back, and it says so
  const applied = pending ? all.filter((m) => !pending.has(m.num)) : all;
  const vocab = vocabularies(applied);
  const later = pending && pending.size ? vocabularies(all) : null;
  const words = [];
  for (const f of [...walk(join(root, "app")), ...walk(join(root, "components")), ...walk(join(root, "lib"))]) {
    words.push(...wordsIn(readFileSync(f, "utf8"), f.slice(root.length + 1)));
  }
  return { vocab, pendingKnown: pending !== null, ...judge(vocab, words, later) };
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] || "").href) {
  const { vocab, refused, arriving, checked, pendingKnown } = collect();
  if (process.argv.includes("--list")) {
    for (const w of checked) console.log(`  ${w.file}:${w.line}  ${w.table}.${w.col} = "${w.value}" (${w.how})`);
  }
  for (const r of refused) console.log(`  ✗ ${r.file}:${r.line}  ${r.table}.${r.col} = "${r.value}" (${r.how}) — the table allows ${r.allowed.map((x) => `'${x}'`).join(", ")} (${r.from})`);
  for (const a of arriving) console.log(`  · ${a.file}:${a.line}  ${a.table}.${a.col} = "${a.value}" arrives with ${a.from} — refused until it is applied`);
  if (!pendingKnown) console.log("  · could not read the pending set (supabase/APPLY_ALL_PENDING.sql) — every migration is counted as applied");
  console.log(`VOCAB AUDIT: ${checked.length} literal word(s) checked against ${vocab.size} column list(s) · ${refused.length} the table refuses`);
  if (refused.length > REFUSED_CEILING) {
    console.log(`  ✗ RATCHET: ${refused.length} > ${REFUSED_CEILING}. A button that writes one of these fails every time; a filter on one is always empty.`);
    process.exit(1);
  }
  if (refused.length < REFUSED_CEILING) console.log(`  · below its ceiling (${refused.length} < ${REFUSED_CEILING}) — lower it to lock it in.`);
}
