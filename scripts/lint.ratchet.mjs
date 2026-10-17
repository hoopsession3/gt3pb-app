// LINT, AS A RATCHET RATHER THAN AS A NUMBER SOMEBODY QUOTES
//
//   node scripts/lint.ratchet.mjs            # fail if the count went UP
//   node scripts/lint.ratchet.mjs --list     # the worst files, to pick the next ones off
//
// ── WHY THIS EXISTS (2026-10-01) ───────────────────────────────────────────────────────────────
// `npm run lint` reports 261 problems and exits 1, so it can never be a pass/fail gate as it
// stands, and nothing else enforced it either. Every commit message in this repo's recent history
// — mine — ends with "lint 261 (baseline)", which read like a gate and was a sentence. A number
// nobody checks is not a baseline, it is a claim.
//
// So: the count may go DOWN freely and may never go UP. Same shape as the radius ceiling in
// scripts/smoke.cjs and the R-002 ratchet — the debt is allowed to exist, it is not allowed to
// grow, and nobody has to clean 261 problems before shipping a fix.
//
// ── A FAILED READ IS NOT ZERO ──────────────────────────────────────────────────────────────────
// This runs eslint with the JSON formatter and sums the counts, rather than scraping "✖ 261
// problems" out of human output. If the run cannot be parsed, this FAILS and says so. A lint gate
// that silently reports zero problems because eslint crashed is the exact shape of dead check this
// repo has already found in columns.audit and in my own grep over `npm test`.
import { execFileSync } from "node:child_process";

// ── THE CEILINGS ──────────────────────────────────────────────────────────────────────────────
// Measured, not remembered: `npx eslint -f json`, summed. LOWER one when you clean some up; raising one needs a reason in
// the commit message.
//
// TWO, NOT ONE (R14, 2026-10-17 — the 10/10 audit, F25). The ceiling was a single total of errors and warnings, so a fixed
// warning bought room for a new ERROR — a hook called conditionally could ride in on an unused variable cleaned up the
// same day. Errors and warnings each have their own now, and neither may rise.
//   182 total on 2026-10-16 (R13) → R14: 130 errors, 51 warnings. The one rules-of-hooks error was a plain function
//   named use… (Studio's takeOption) and an unused ternary was a statement (Changelog).
//   R16 (2026-10-17, the 10/10 audit's front end): 130 → 89 errors — every error left is react-hooks/set-state-in-effect.
//   41 gone, by rule: no-explicit-any 19 (the rows each screen reads have their types: RoadFlyer's stops and stays, the
//   trailer's load plan, the shop's products and variants, Apliiq's search); purity 8 (a render that read the clock reads
//   lib/useMinute's minute, and a tap's time is taken in the handler — BrewPlanner tapTime); refs 6 (a callback or value
//   kept for an effect is lib/useLatest's, written after render, never during it); immutability 3 (a function used before
//   its line, a reset moved above the effect that calls it, a navigation said as window.location.assign); unescaped
//   entities 3 (the console's apostrophes); preserve-manual-memoization 2 (the academy's two callbacks name setView).
export const CEILING = { errors: 89, warnings: 51 };
/** @deprecated the single total; kept so a reader of the old name still gets the sum. */
export const LINT_CEILING = CEILING.errors + CEILING.warnings;

// RULES HELD AT ZERO (R14). Every hit of these is a bug, never debt: a ceiling would let one in.
// R16: the six R16 brought to zero join it — each was a real wrong answer (a render that reads the clock draws a time
// that is already stale; a ref written in render is a value React may throw away), not a style.
export const ZERO = [
  "react-hooks/rules-of-hooks",
  "react-hooks/purity",
  "react-hooks/refs",
  "react-hooks/immutability",
  "react-hooks/preserve-manual-memoization",
  "@typescript-eslint/no-explicit-any",
  "react/no-unescaped-entities",
];

export function countFrom(json) {
  // Returns null rather than 0 when the shape is not what eslint produces. The difference between
  // "clean" and "could not tell" is the whole point.
  let results;
  try { results = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(results)) return null;
  let errors = 0, warnings = 0;
  const byRule = {};
  for (const r of results) {
    if (typeof r?.errorCount !== "number" || typeof r?.warningCount !== "number") return null;
    errors += r.errorCount; warnings += r.warningCount;
    for (const m of Array.isArray(r.messages) ? r.messages : []) {
      const k = m?.ruleId ?? "(no rule)";
      byRule[k] = (byRule[k] ?? 0) + 1;
    }
  }
  return { total: errors + warnings, errors, warnings, files: results, byRule };
}

/** What the gate says about a count: each line it prints, and whether it passes. A count below a ceiling FAILS too — a
 *  ceiling left above the real count quietly buys room for new problems. Pure (scripts/r14.test.mjs). */
export function verdict(c, ceiling = CEILING, zero = ZERO) {
  const lines = [], bad = [];
  for (const kind of ["errors", "warnings"]) {
    const got = c[kind], max = ceiling[kind];
    if (got > max) bad.push(`${got - max} new ${kind} since the ceiling was set (${got} > ${max}). Fix them, or raise CEILING.${kind} WITH a reason in the commit message.`);
    else if (got < max) bad.push(`${max - got} fewer ${kind} than the ceiling — good, now LOWER CEILING.${kind} to ${got}.`);
  }
  for (const rule of zero) {
    const n = c.byRule?.[rule] ?? 0;
    if (n) bad.push(`${n} × ${rule} — held at zero: every one is a bug.`);
  }
  lines.push(`LINT RATCHET: ${c.errors} error(s) (ceiling ${ceiling.errors}), ${c.warnings} warning(s) (ceiling ${ceiling.warnings}); ${zero.join(", ")} held at 0.`);
  for (const b of bad) lines.push(`  ✗ ${b}`);
  return { ok: bad.length === 0, lines };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  let out = "";
  try {
    out = execFileSync("npx", ["eslint", "-f", "json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    // eslint exits non-zero whenever there is any error-severity problem, which is the normal
    // state here — the JSON still comes back on stdout and is what we want.
    out = e.stdout ?? "";
    if (!out) {
      console.log("LINT RATCHET: NOT CHECKED — eslint produced no output.");
      console.log(`  ${String(e.message ?? e).split("\n")[0]}`);
      console.log("  Treated as a FAILURE, not a pass: a gate that cannot read its subject must not report success.");
      process.exit(1);
    }
  }

  const c = countFrom(out);
  if (c === null) {
    console.log("LINT RATCHET: NOT CHECKED — eslint's JSON output could not be parsed.");
    console.log("  Treated as a FAILURE, not a pass.");
    process.exit(1);
  }

  if (process.argv.includes("--list")) {
    const worst = c.files.filter((f) => f.errorCount + f.warningCount > 0)
      .sort((a, b) => (b.errorCount + b.warningCount) - (a.errorCount + a.warningCount)).slice(0, 15);
    for (const f of worst) {
      console.log(`  ${String(f.errorCount + f.warningCount).padStart(4)}  ${f.filePath.replace(process.cwd() + "/", "")}`);
    }
  }

  const v = verdict(c);
  for (const l of v.lines) console.log(l);
  if (!v.ok) {
    console.log("    scripts/lint.ratchet.mjs --list  names the worst files.");
    process.exit(1);
  }
}
