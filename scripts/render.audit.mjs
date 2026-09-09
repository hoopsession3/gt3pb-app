// SET-STATE-IN-EFFECT — what these actually are, measured instead of remembered.
//
//   node scripts/render.audit.mjs            # counts, and fail if the total rose
//   node scripts/render.audit.mjs --list     # every hit with its category
//   node scripts/render.audit.mjs --dump needs-a-person   # print the effect bodies of one category
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
// A previous round classified all 122 of these by hand and wrote the result in a commit message:
// 31 correct, 29 wanting useAsyncData, 61 unread. That was real work and it is already rotting,
// because nothing recomputes it. The next person either trusts a number they cannot check or does
// the triage again from scratch. Both are worse than a script.
//
// ── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────────────────────────
// It does not guess. Three times in this audit a regex produced a confident number that was wrong
// in the alarming direction — "50 unguarded routes" was 0, "126 unnamed buttons" was 11. So every
// rule here demands an unambiguous signal, and anything that does not match one lands in
// NEEDS-A-PERSON. That bucket is meant to be large; a classifier that empties it by guessing is
// the failure mode, not the goal.
//
// The categories are about what the effect DOES, which is the only thing that decides whether it
// is a defect:
//
//   client-read    reads something that cannot exist during SSR — localStorage, window, Date,
//                  navigator, matchMedia. Setting state in an effect is the CORRECT way to do
//                  this; doing it during render is the hydration-mismatch bug. Not a defect.
//   data-load      awaits something and stores the result. A cascading render by construction:
//                  mount, paint empty, fetch, paint again.
//
//                  NOT a defect list. An earlier note called these "wants useAsyncData"; then I
//                  opened components/Reserves.tsx, one of the 43, and found it already captures
//                  `error`, already sets a loadFailed flag, and carries a comment naming the exact
//                  false-empty bug class. Converting it would be churn with regression risk and no
//                  user-visible gain. This rule flags the ordinary `useEffect(() => load(), [load])`
//                  whether the loader is careful or careless, so it cannot tell you which. What
//                  CAN is scripts/falseempty.audit.mjs, which looks at whether the read can report
//                  failure at all — the thing a person actually experiences.
//   sync-to-prop   setState(prop) keyed on that prop. Sometimes the textbook anti-pattern and
//                  sometimes a deliberate post-save re-sync — all five in this repo are the latter, so
//                  this category is a READING LIST, never an auto-fix.
//   needs-a-person everything else.
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

// Raise nothing. Lower freely. The point of a ratchet is that it only moves one way.
export const BASELINE = 116;

const RULE = "react-hooks/set-state-in-effect";

/** Pull the enclosing useEffect/useLayoutEffect body out of `src` for a 1-based `line`. */
export function effectAt(src, line) {
  const lines = src.split("\n");
  const idx = line - 1;
  if (idx < 0 || idx >= lines.length) return null;
  // Walk back to the nearest useEffect( / useLayoutEffect( at or above the hit.
  let start = -1;
  for (let i = idx; i >= 0 && i > idx - 400; i--) {
    if (/use(Layout)?Effect\s*\(/.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return null;
  // Brace-match forward from the effect's opening paren, ignoring braces inside strings.
  const from = lines.slice(start).join("\n");
  const open = from.indexOf("(");
  if (open < 0) return null;
  let depth = 0, inS = null, esc = false, end = -1;
  for (let i = open; i < from.length && i < open + 20000; i++) {
    const c = from[i];
    if (esc) { esc = false; continue; }
    if (inS) { if (c === "\\") esc = true; else if (c === inS) inS = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inS = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  return { body: from.slice(open, end + 1), startLine: start + 1 };
}

// ── the rules ──────────────────────────────────────────────────────────────────────────────────
// Each is deliberately narrow. A hit matches at most one; ambiguity falls through to the person.
const CLIENT_ONLY = /\blocalStorage\b|\bsessionStorage\b|\bwindow\.|\bdocument\.|\bnavigator\.|\bmatchMedia\b|\bnew Date\(|\bDate\.now\(|\bIntl\.|innerWidth|innerHeight|\bcrypto\./;
// `\bload\s*\(` and not `load\(\s*\)`: the first version required empty parens, so an effect doing
// `const k = localStorage.getItem("k"); load(k);` fell through to client-read and was counted as
// correct code. The word boundary keeps loadImage( and preloadFonts( out.
const LOADS = /\bawait\b|\.then\s*\(|\bfetch\s*\(|supabase|\bload\s*\(|\bfrom\s*\(\s*["'`]/;

/** @returns {"client-read"|"data-load"|"sync-to-prop"|"needs-a-person"} */
export function classifyEffect(body) {
  if (!body) return "needs-a-person";
  // Order matters: a loader that also touches localStorage is still a loader.
  if (LOADS.test(body)) return "data-load";
  if (CLIENT_ONLY.test(body)) return "client-read";
  // A body that is NOTHING BUT setState calls, keyed on exactly one dep that they read from.
  //
  // The first version of this rule matched a single setState only, and reported 2 where there are
  // 3: MerchManager's row sets three pieces of state from the same prop and was missed. Worse, the
  // hand-triage it was checked against named MerchManager and not MenuManager, so the script and
  // the commit message were each wrong about a different one. Hence: count the statements.
  const inner = body.replace(/^\s*\(\s*\(\s*\)\s*=>\s*\{?/, "").replace(/\}?\s*,\s*\[[^\]]*\]\s*\)\s*$/, "");
  const deps = (body.match(/,\s*\[([^\]]*)\]\s*\)\s*$/)?.[1] ?? "")
    .split(",").map((d) => d.trim().split(/[.[]/)[0]).filter(Boolean);
  const statements = inner.split(";").map((s) => s.trim()).filter(Boolean);
  const allSetters = statements.length > 0 && statements.every((s) => /^set[A-Z][A-Za-z0-9_]*\s*\(/.test(s));
  if (allSetters && deps.length === 1 && new RegExp(`\\b${deps[0]}\\b`).test(inner)) return "sync-to-prop";
  return "needs-a-person";
}

// ── i/o ────────────────────────────────────────────────────────────────────────────────────────
export function collect(lintJsonPath) {
  // eslint exits non-zero whenever it reports anything, and this repo always has findings — so a
  // plain execSync throws and takes the JSON with it. The report is on stdout either way.
  const runEslint = () => {
    const opts = { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] };
    try { return execSync("npx eslint --format json .", opts); }
    catch (e) {
      const out = e.stdout?.toString?.() ?? "";
      if (!out.trim().startsWith("[")) throw new Error(`eslint produced no JSON: ${String(e.message).slice(0, 200)}`);
      return out;
    }
  };
  const raw = lintJsonPath && existsSync(lintJsonPath) ? readFileSync(lintJsonPath, "utf8") : runEslint();
  const results = JSON.parse(raw);
  const cwd = process.cwd() + "/";
  const out = [];
  const cache = new Map();
  for (const r of results) {
    for (const m of r.messages) {
      if (m.ruleId !== RULE) continue;
      const file = r.filePath.replace(cwd, "");
      if (!cache.has(r.filePath)) cache.set(r.filePath, existsSync(r.filePath) ? readFileSync(r.filePath, "utf8") : "");
      const e = effectAt(cache.get(r.filePath), m.line);
      out.push({ file, line: m.line, category: classifyEffect(e?.body), body: e?.body ?? null });
    }
  }
  return out;
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2);
  // Runs eslint unless LINT_JSON explicitly names a cache. The first version defaulted to
  // /tmp/lint.json, and after an edit shifted line numbers in crew/page.tsx it happily reported
  // categories computed from the previous run — a stale number with no way to tell. A cache is
  // never the default here.
  const hits = collect(process.env.LINT_JSON || null);
  const by = {};
  for (const h of hits) (by[h.category] ||= []).push(h);
  const order = ["client-read", "data-load", "sync-to-prop", "needs-a-person"];

  const dump = args.indexOf("--dump");
  if (dump >= 0) {
    const want = args[dump + 1];
    for (const h of by[want] || []) console.log(`\n── ${h.file}:${h.line}\n${(h.body || "").slice(0, 700)}`);
    process.exit(0);
  }
  if (args.includes("--list")) {
    for (const c of order) for (const h of by[c] || []) console.log(`${c.padEnd(15)} ${h.file}:${h.line}`);
    console.log("");
  }

  const files = new Set(hits.map((h) => h.file)).size;
  console.log(`SET-STATE-IN-EFFECT: ${hits.length} across ${files} file(s)`);
  for (const c of order) {
    const n = (by[c] || []).length;
    const note = {
      "client-read": "correct code — the effect is how you read a client-only value safely",
      "data-load": "a load in an effect — NOT a defect list; see falseempty.audit.mjs for that",
      "sync-to-prop": "all 5 read 2026-09-09: every one is a deliberate post-save re-sync",
      "needs-a-person": "unclassified on purpose; no rule matched unambiguously",
    }[c];
    console.log(`  ${String(n).padStart(3)}  ${c.padEnd(15)} ${note}`);
  }
  if (hits.length > BASELINE) {
    console.log(`\n  ✗ RATCHET: ${hits.length} > BASELINE ${BASELINE}. This number may fall, never rise.`);
    process.exit(1);
  }
  if (hits.length < BASELINE) console.log(`\n  · below baseline (${hits.length} < ${BASELINE}) — lower BASELINE to ${hits.length} to lock it in.`);
  process.exit(0);
}
