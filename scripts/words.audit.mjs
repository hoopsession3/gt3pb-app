// A FAILURE IN THE MACHINE'S WORDS — every place a screen hands an error's raw text to a person.
//
//   node scripts/words.audit.mjs          # count, and fail if it rose
//   node scripts/words.audit.mjs --list   # every line, and why
//
// ── WHY (R34, 2026-10-18 — the fresh audit's UX11-11) ──────────────────────────────────────────
// Two hundred and fifty places said a failure in the database's or the network's own words: "Error: new row violates
// row-level security policy for table "events"" to a crew member who could do nothing with it, "Couldn't save — JWT
// expired" to a member renaming themselves, "Failed to fetch" under a section that didn't load. lib/failureWords says a
// failure plainly — a refusal in the database's own sentence, the signal, a lapsed sign-in, a duplicate, a row that is
// gone, each with what to do next — and the raw text goes to the error report, never the person.
//
// This holds the screens to it. Every screen file (app/, its routes aside, and components/) is read line by line, and an
// error's raw text is counted where it can reach a person:
//
//   raw message  an `x.message` (or `x?.message`) anywhere but inside plainFailure / failureWords / failureOr / authWords /
//                sayable, a report (reportClientError, reportFailure, console.*, an Error thrown on), or a test of its
//                words (/…/.test(), .includes(), .startsWith(), .match(), ===, isNetworkError(), isMissingFunction()).
//   raw answer   a route's or a helper's error string set straight into what the screen shows —
//                `setErr(j.error || "…")`, or written into a sentence, `Couldn't save — ${r.error}` — where
//                failureOr(j.error, "…") and plainFailure(r.error) say its sentence and put the network's words
//                ("Load failed") and the database's in plain ones.
//   Error:       a toast or a line that opens "Error: ${…}" — the machine's voice, not ours.
//
// Toasts have a door of their own (components/AppProvider → sayable), so a raw helper string in a toast is caught there
// too; this count is what the screens themselves write, and it may not grow. A line that is meant to show raw text — the
// crew's own error log, a route's own sentence carried in a field named `message` — says so with a `raw words:` comment
// on it or the line above, and is not counted.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Raise nothing. Measured 2026-10-18 after R34's rewrite: 0.
export const RAW_BASELINE = 0;

// Calls inside which an error's raw text is fine: the plain-words helpers, a report or a log, an Error thrown on, a test.
const ALLOWED_CALLS = new Set([
  "plainFailure", "failureWords", "failureOr", "authWords", "sayable", "machineWords",
  "reportClientError", "reportFailure", "log", "warn", "error", "info", "debug",
  "Error", "test", "includes", "startsWith", "endsWith", "match", "isNetworkError", "isMissingFunction", "refusalWords",
]);
const MESSAGE = /\b[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*\??\.message\b/g;
const RAW_ANSWER = /\bset[A-Z]\w*\(\s*[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*\??\.error\s*(?:\|\||\?\?)/;
const RAW_EMBED = /\$\{\s*[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*\??\.error\s*(?:\}|\?\?|\|\|)/;
const ERROR_PREFIX = /`Error: \$\{/;

/** The call names enclosing column `at` on this line (innermost last). */
function enclosing(line, at) {
  const stack = [];
  let quote = null;
  for (let i = 0; i < at; i++) {
    const c = line[i];
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(") { const m = /([A-Za-z_$][\w$]*)\s*$/.exec(line.slice(0, i)); stack.push(m ? m[1] : ""); }
    else if (c === ")") stack.pop();
  }
  return stack;
}

/** What follows the call that encloses column `at` — the text after its closing parenthesis. */
function afterCall(line, at) {
  let depth = 0;
  for (let i = at; i < line.length; i++) {
    if (line[i] === "(") depth++;
    else if (line[i] === ")") { if (depth === 0) return line.slice(i + 1); depth--; }
  }
  return "";
}

/** Each raw failure this source hands a person: [line number, the line, what it is]. A file that is about raw text — the
 *  error reporter, the crew's error log — says `raw words (file):` in a comment near its top and is not read. */
export function rawWordsIn(src) {
  const lines = src.split("\n");
  if (lines.slice(0, 40).some((l) => /^\s*(\/\/|\*|\/\*).*raw words \(file\):/.test(l))) return [];
  const found = [];
  let inBlock = false;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (inBlock) { if (t.includes("*/")) inBlock = false; return; }
    if (t.startsWith("/*") && !t.includes("*/")) { inBlock = true; return; }
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("{/*")) return;
    if (/raw words:/.test(line) || /raw words:/.test(lines[i - 1] ?? "")) return;
    const code = line.replace(/\/\/.*$/, "");
    for (const m of code.matchAll(MESSAGE)) {
      const after = code.slice(m.index + m[0].length);
      const before = code.slice(0, m.index);
      if (/^\s*(?:===|!==|==|!=)/.test(after) || /(?:===|!==|==|!=)\s*$/.test(before)) continue;   // compared
      if (/^\??\.(?:includes|startsWith|endsWith|match|test|length)\b/.test(after)) continue;     // its words tested, or measured
      if (/^\s*\.?\s*(?:instanceof)/.test(after)) continue;
      const calls = enclosing(code, m.index);
      if (calls.some((n) => ALLOWED_CALLS.has(n))) continue;
      if (calls[calls.length - 1] === "String" && /^\??\.(?:includes|startsWith|endsWith|match)\(/.test(afterCall(code, m.index))) continue;   // String(e.message).includes("…")
      if (/\bthrow\b|new Error\(|console\./.test(before)) continue;
      found.push([i + 1, t, "raw message"]);
      break;
    }
    if (RAW_ANSWER.test(code) || RAW_EMBED.test(code)) found.push([i + 1, t, "raw answer"]);
    else if (ERROR_PREFIX.test(code)) found.push([i + 1, t, "an Error: prefix"]);
  });
  return found;
}

function walk(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(join(ROOT, p)).isDirectory()) return /^(api|node_modules)$/.test(n) && dir === "app" ? [] : /^node_modules$/.test(n) ? [] : walk(p);
    return /\.(tsx?)$/.test(n) && !/\.d\.ts$/.test(n) ? [p] : [];
  });
}

/** Every raw failure on the screens: [file, line, text, kind]. */
export function rawWords(root = ROOT) {
  void root;
  return ["app", "components"].flatMap(walk).flatMap((f) => rawWordsIn(readFileSync(join(ROOT, f), "utf8")).map(([n, t, k]) => [relative(ROOT, join(ROOT, f)), n, t, k]));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const all = rawWords();
  const list = process.argv.includes("--list");
  console.log(`WORDS AUDIT: ${all.length} raw failure(s) a screen hands a person (ceiling ${RAW_BASELINE})`);
  if (list || all.length > RAW_BASELINE) for (const [f, n, t, k] of all) console.log(`  ${k === "raw answer" ? "◦" : "•"} ${f}:${n}  ${t.slice(0, 150)}`);
  if (all.length > RAW_BASELINE) {
    console.log(`  ✗ up from ${RAW_BASELINE}. Say it with lib/failureWords — failureWords(e, "Couldn't save"), plainFailure(e) after a lead, failureOr(j.error, "…") for a route's answer — or mark a line that is meant to show raw text with a "raw words:" comment.`);
    process.exit(1);
  }
}
