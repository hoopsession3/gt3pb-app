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

// ── THE CEILING ────────────────────────────────────────────────────────────────────────────────
// Measured, not remembered: `npx eslint -f json` summed on 2026-10-01 at 963ddb5.
// LOWER THIS when you clean some up. Raising it needs a reason in the commit message.
export const LINT_CEILING = 225;   // 232 → 225 on 2026-10-06 (the settings round): what a phone keeps for itself is read while rendering through one small store (lib/devicePref) instead of copied into state by an effect — the theme in AppShell (lib/theme), the display prefs in DisplayToggle, the pass's mute in the Kitchen (lib/passSound) — and so is the phone's notification permission (components/DeviceAlerts, which replaced the crew page's EnableAlerts): four react-hooks/set-state-in-effect. The calendar's Outlook bar reads its status through useAsyncData and the ?outlook= word through lib/urlParam, not two effects of its own (two more); and the audit panel's lead lost an unescaped apostrophe when it moved into Settings (react/no-unescaped-entities). 234 → 232 on 2026-10-05 (the gesture round): the sheet reads where to portal through useSyncExternalStore instead of setting it in an effect (react-hooks/set-state-in-effect), and the swipe back stops writing a ref while rendering (react-hooks/refs) — the touch engine hands its handlers the latest props as Effect Events. The sheet's open/closing/closed phase stays in its effect on purpose: following the prop while rendering lost a close on the menu (components/Sheet, "IN AN EFFECT, ON PURPOSE"). 235 → 234 on 2026-10-05 (the form audit, venues): components/crew/VendorPicker went, and its unused OpSection import with it (@typescript-eslint/no-unused-vars) — the venue pick that replaced it reads the book through useSyncExternalStore (components/useVenues), not a setState in an effect. 240 → 235 on 2026-10-05 (the form audit, receiving): the COGS calculator unpacks one empty board instead of four fresh [] per render, so its memos (by id, by name, per drink, per batch) stop re-running on every render — five react-hooks/exhaustive-deps. 243 → 240 on 2026-10-04 (the form audit, things): the pack-out plan and the discount-code list memoize what they loaded (three react-hooks/exhaustive-deps), and a shop product's editor starts its draft again from a reload while rendering instead of in an effect (react-hooks/set-state-in-effect) — less the one the Apliiq lookup adds by showing the matched mockup (@next/next/no-img-element, as the row above it already does). 245 → 243 on 2026-10-04: Find Us stopped copying its first read into state from an effect (it draws the read itself) and the live-ping chip knows itself on its first render (two react-hooks/set-state-in-effect) — both were part of the page's layout shift. 253 → 245 on 2026-10-04 (the form audit, people): the offer letters board memoizes what it loaded, once per load (two react-hooks/exhaustive-deps on its approvals and events), and lost an unused import; the run-of-show memoizes its blocks (two exhaustive-deps); the operator agreement and the invite form lost an unused import each, and the invite form an unescaped apostrophe. 255 → 253 on 2026-10-04: the cup checkout and the order funnel stopped seeding the customer's name from an effect (react-hooks/set-state-in-effect) — a field starts from what we know at render now (components/useCustomerKnown.useKnownField). 256 → 255 on 2026-10-04: My Day stopped setting a clock in an effect (react-hooks/set-state-in-effect) — the clock was for the greeting, and the greeting went when Ryan asked what on the app was unnecessary. 257 → 256 on 2026-10-04: the spend panel's list header ("This month's expenses", an unescaped apostrophe — react/no-unescaped-entities) went when the panel became the month in words; capture moved to components/LogPurchase. 258 → 257 on 2026-10-04: the Live truck panel stopped reading Date.now() during render — its grace is lib/road's now (react-hooks/purity). 259 → 258 on 2026-10-03: the brew sheet lost the effect that synced its coffee box to its gallon box (one number now, three ways of saying it). 261 → 259 on 2026-10-02: lib/errorMessage.ts replaced sixty copies of one expression

export function countFrom(json) {
  // Returns null rather than 0 when the shape is not what eslint produces. The difference between
  // "clean" and "could not tell" is the whole point.
  let results;
  try { results = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(results)) return null;
  let errors = 0, warnings = 0;
  for (const r of results) {
    if (typeof r?.errorCount !== "number" || typeof r?.warningCount !== "number") return null;
    errors += r.errorCount; warnings += r.warningCount;
  }
  return { total: errors + warnings, errors, warnings, files: results };
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

  console.log(`LINT RATCHET: ${c.total} problem(s) — ${c.errors} error(s), ${c.warnings} warning(s). Ceiling ${LINT_CEILING}.`);
  if (c.total > LINT_CEILING) {
    console.log(`\n  ✗ ${c.total - LINT_CEILING} new problem(s) since the ceiling was set.`);
    console.log(`    Fix them, or raise LINT_CEILING in this file WITH a reason in the commit message.`);
    console.log(`    scripts/lint.ratchet.mjs --list  names the worst files.`);
    process.exit(1);
  }
  if (c.total < LINT_CEILING) {
    console.log(`\n  ✗ ${LINT_CEILING - c.total} fewer than the ceiling — good, now LOWER it to ${c.total}.`);
    console.log(`    A ceiling left above the real count quietly buys room for ${LINT_CEILING - c.total} new problems.`);
    process.exit(1);
  }
}
