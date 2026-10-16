// FALSE EMPTY STATE — reads that cannot tell "nothing there" from "the request failed".
//
//   node scripts/falseempty.audit.mjs           # count, and fail if it rose
//   node scripts/falseempty.audit.mjs --list    # every site, to read
//
// ── THE BUG ────────────────────────────────────────────────────────────────────────────────────
//     const { data } = await supabase.from("incident_log").select(…);
//     setRows((data as Inc[]) ?? []);
//
// `error` is never destructured, so a failed request arrives as data === null, `?? []` turns that
// into an empty list, and the screen says "no incidents". It says the same thing when there really
// are none. The person cannot tell, and neither can anyone reading the code.
//
// lib/useAsyncData.ts was written for exactly this and says so in its own header — an audit found
// 59 sites where a failed fetch rendered identically to genuine emptiness. It is the fix. This
// script is the meter, because the previous count lived in a commit message and nothing recomputed
// it.
//
// ── WHY THIS RULE AND NOT THE LINT RULE ────────────────────────────────────────────────────────
// react-hooks/set-state-in-effect flags 115 sites here, and most are correct code — it fires on the
// ordinary `useEffect(() => load(), [load])` no matter how careful the loader is. It measures a
// shape. This measures whether a failure can be seen, which is what a person actually experiences.
//
// ── WHAT IT DELIBERATELY DOES NOT COUNT ────────────────────────────────────────────────────────
// Server code. In an API route a swallowed error still reaches the caller as a bad response, and
// the failure modes are different; mixing them produced a number three times bigger and less true.
// Client components only — where the result of the read IS what somebody looks at.
//
// Every site in the count has been read once by hand (2026-09-09). The rule is narrow on purpose:
// it wants an unchecked read AND a `?? []`/`?? {}` AND a setState within three lines. Widen it only
// after reading what the new matches actually are.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// Raise nothing. Lower freely.
export const BASELINE = 0;

// ── THE SECOND MEASURE, AND WHY IT EXISTS ──────────────────────────────────────────────────────
// Halfway through fixing the first list I converted three components to useAsyncData, watched the
// count drop, and nearly shipped it. The loaders now captured `error` — but every render still did
// `state.data ?? []`, so the screen said "no broadcasts" exactly as before. The code shape was
// fixed and the lie was untouched.
//
// That is the same criticism this file makes of react-hooks/set-state-in-effect, reproduced in my
// own work: a rule about how code LOOKS cannot tell you what a person SEES. So the audit now also
// counts loaders that catch a failure and never show it, which is the only way the first number
// can be trusted to mean anything.
export const SILENT_BASELINE = 1;

// ── THE THIRD MEASURE: WRITES WHOSE ANSWER IS NEVER READ (R12b — the 10/10 audit, F4) ──────────────────────────
// The first two meter reads. A write fails the same quiet way: supabase-js answers a refused insert, update, delete or
// call with {error} — it does not throw — so `await supabase.from("x").update(…)` dropped on its own line succeeds on the
// screen whatever happened. The audit found 82 in the screens ("Location archived" with the truck still live there,
// "Deleted" over a refusal, a brief's editor closed on a save that never landed) and the routes had more. Every one is
// read now: lib/wrote on a screen, the route's own answer or its log on the server.
//
// What counts: a statement whose whole value is a Supabase write — .from(…).insert/update/delete/upsert(…) or .rpc(…),
// awaited, voided or bare — or a Promise.all of them, or one of lib/tasks' write helpers, with nothing reading what
// came back. A `.then(fn)` whose fn takes the answer reads it; `.then(() => {})` does not. Every file under app/,
// components/ and lib/ — the server's included: a route that answers ok over a dropped write is the same lie, told to
// a screen. What may drop its answer is named in FIRE_AND_FORGET, with why.
export const UNREAD_WRITES_BASELINE = 0;
export const FIRE_AND_FORGET = {
  "lib/track.ts#track_user": "a visit count: never worth a word to the person, never allowed to slow a tap (15s apart at most)",
  "lib/track.ts#track_guest": "a guest count, once an hour a device: the same",
  "lib/funnel.ts#funnel_events": "a step in a funnel report: an analytics row a checkout must never wait on or fail over",
};
const WRITE_VERBS = new Set(["insert", "update", "delete", "upsert"]);
const TASK_WRITERS = new Set(["updateTask", "deleteTask", "deleteTasks", "deleteTasksForParent", "createTodo", "createEventTask", "createEventTasks", "completeTask", "completeInitiative"]);
const peel = (n) => { while (n && (ts.isAwaitExpression(n) || ts.isVoidExpression(n) || ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n))) n = n.expression; return n; };

/** The write a call chain makes — its table or function name — or null when it is not a Supabase write. A chain that
 *  ends in `.then(fn)` with fn taking the answer reads it, and is not counted. */
export function writeOf(node) {
  let n = peel(node);
  if (n && ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "then") {
    const fn = n.arguments[0];
    if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && fn.parameters.length > 0) return null;
  }
  let verb = false, table = null, rpc = null;
  for (let cur = n; cur; ) {
    if (ts.isCallExpression(cur)) {
      const e = cur.expression;
      if (ts.isPropertyAccessExpression(e)) {
        const name = e.name.text, arg = cur.arguments[0];
        const lit = arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? arg.text : arg ? arg.getText() : "";
        if (WRITE_VERBS.has(name)) verb = true;
        else if (name === "from") table = lit;
        else if (name === "rpc") rpc = lit;
        cur = e.expression; continue;
      }
      cur = e; continue;
    }
    if (ts.isPropertyAccessExpression(cur) || ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur)) { cur = cur.expression; continue; }
    break;
  }
  if (rpc) return rpc;
  if (verb && table) return table;
  return null;
}

/** Every statement in one file's source that drops a write's answer: [{ line, name }]. */
export function unreadWritesIn(src, file = "x.tsx") {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = (node) => {
    if (ts.isExpressionStatement(node)) {
      const e = peel(node.expression);
      let name = writeOf(node.expression);
      if (!name && e && ts.isCallExpression(e)) {
        const callee = e.expression.getText();
        if (/^Promise\.(all|allSettled)$/.test(callee)) {
          const inner = e.arguments[0]?.getText() ?? "";
          const m = /\.(?:from)\(\s*["'`]([\w-]+)["'`]\s*\)[\s\S]*?\.(?:insert|update|delete|upsert)\(|\.rpc\(\s*["'`]([\w-]+)/.exec(inner);
          if (m) name = m[1] ?? m[2];
        } else if (ts.isIdentifier(e.expression) && TASK_WRITERS.has(e.expression.text)) name = e.expression.text;
      }
      if (name) out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, name });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function collectUnreadWrites(root = ".") {
  const hits = [];
  for (const f of walk(root)) {
    const rel = f.replace(/^\.\//, "").replace(/\\/g, "/");
    if (!/^(app|components|lib)\//.test(rel)) continue;
    const src = readFileSync(f, "utf8");
    if (!/\.(insert|update|delete|upsert|rpc)\(|Task\(|Tasks\(|createTodo\(/.test(src)) continue;
    for (const h of unreadWritesIn(src, f)) if (!(`${rel}#${h.name}` in FIRE_AND_FORGET)) hits.push({ file: rel, ...h });
  }
  return hits;
}

const UNCHECKED =
  /const\s*\{\s*data(\s*:\s*\w+)?\s*\}\s*=\s*await|\.then\(\s*\(\s*\{\s*data(\s*:\s*\w+)?\s*\}\s*\)/;
const COALESCED = /\?\?\s*(\[\]|\{\})/;
const SETTER = /\bset[A-Z]\w*\(/;

/** True when this line starts an unchecked read whose result is coalesced into state just below. */
export function isFalseEmpty(line, next3) {
  if (!/supabase/.test(line)) return false;
  if (!UNCHECKED.test(line)) return false;
  const window = [line, ...next3].join(" ");
  return SETTER.test(window) && COALESCED.test(window);
}

export function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|\.next|\.git|\.smoke|dist)$/.test(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * True when a file loads with useAsyncData but never renders the failure — AsyncSection handles it,
 * `status === "error"` handles it, reading `.error` handles it. None of those means the person is
 * told, and `state.data ?? []` then renders the same empty list a working read would.
 */
export function catchesButHides(src) {
  if (!/useAsyncData\s*[<(]/.test(src)) return false;
  return !(/AsyncSection/.test(src) || /status\s*===\s*["']error["']/.test(src) || /\.error\b/.test(src));
}

export function collectSilent(root = ".") {
  return walk(root)
    .filter((f) => catchesButHides(readFileSync(f, "utf8")))
    .map((f) => f.replace(/^\.\//, ""));
}

export function collect(root = ".") {
  const hits = [];
  for (const f of walk(root)) {
    const src = readFileSync(f, "utf8");
    if (!/^\s*["']use client["']/m.test(src)) continue; // client only — see header
    const lines = src.split("\n");
    lines.forEach((l, i) => {
      if (isFalseEmpty(l, [lines[i + 1] ?? "", lines[i + 2] ?? "", lines[i + 3] ?? ""])) {
        hits.push({ file: f.replace(/^\.\//, ""), line: i + 1 });
      }
    });
  }
  return hits;
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] || "").href) {
  const hits = collect(".");
  if (process.argv.includes("--list")) for (const h of hits) console.log(`  ${h.file}:${h.line}`);
  const byFile = {};
  for (const h of hits) byFile[h.file] = (byFile[h.file] || 0) + 1;
  const worst = Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`FALSE-EMPTY AUDIT: ${hits.length} client read(s) that cannot report failure, across ${Object.keys(byFile).length} file(s)`);
  for (const [f, n] of worst) console.log(`  ${String(n).padStart(3)}  ${f}`);
  const silent = collectSilent(".");
  console.log(`  and ${silent.length} file(s) catch a failure but never show it:`);
  for (const f of silent) console.log(`       ${f}`);

  const unread = collectUnreadWrites(".");
  console.log(`  and ${unread.length} write(s) whose answer is never read${unread.length ? ":" : ""}`);
  for (const u of unread) console.log(`       ${u.file}:${u.line}  ${u.name}`);

  let bad = false;
  if (unread.length > UNREAD_WRITES_BASELINE) {
    console.log(`\n  ✗ RATCHET: ${unread.length} > UNREAD_WRITES_BASELINE ${UNREAD_WRITES_BASELINE}. A write whose {error} is never read says "saved" whatever happened — read it (lib/wrote), or name why not in FIRE_AND_FORGET.`);
    bad = true;
  }
  if (hits.length > BASELINE) {
    console.log(`\n  ✗ RATCHET: ${hits.length} > BASELINE ${BASELINE}. A new read that cannot fail out loud is a new false empty state.`);
    bad = true;
  } else if (hits.length < BASELINE) {
    console.log(`  · below baseline (${hits.length} < ${BASELINE}) — lower BASELINE to ${hits.length} to lock it in.`);
  }
  if (silent.length > SILENT_BASELINE) {
    console.log(`  ✗ RATCHET: ${silent.length} > SILENT_BASELINE ${SILENT_BASELINE}. Catching the error and rendering data ?? [] is the same lie with better paperwork.`);
    bad = true;
  } else if (silent.length < SILENT_BASELINE) {
    console.log(`  · below silent baseline (${silent.length} < ${SILENT_BASELINE}) — lower SILENT_BASELINE to ${silent.length}.`);
  }
  process.exit(bad ? 1 : 0);
}
