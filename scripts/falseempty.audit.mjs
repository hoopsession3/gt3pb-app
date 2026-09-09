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
// react-hooks/set-state-in-effect flags 121 sites here, and most are correct code — it fires on the
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

// Raise nothing. Lower freely.
export const BASELINE = 28;

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
export const SILENT_BASELINE = 4;

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

  let bad = false;
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
