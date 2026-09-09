// GATE AUDIT — a screen may HIDE on an unknown profile. It may not REFUSE on one.
//
//   node scripts/gate.audit.mjs           # count, and fail if either measure rose
//   node scripts/gate.audit.mjs --list    # every site, to read
//
// ── THE BUG THIS EXISTS FOR ────────────────────────────────────────────────────────────────────
// AuthProvider's `profile` was null in three unrelated situations: not fetched yet, the fetch
// failed, and this person genuinely has no profile row. roleOf(null) is "member". Four gates read
// all three as "you are a customer", so app/crew showed the OWNER
//
//     "Staff only. This area is for GT3PB staff. If that's you, ask the owner to add you"
//
// with a button inviting him to ask himself for access. Seen live in production 2026-09-09.
// lib/access.ts now owns the policy and returns five verdicts, of which "wait" and "failed" are
// explicitly NOT denials.
//
// ── WHY A RULE, WHEN THE BUG IS ALREADY FIXED ──────────────────────────────────────────────────
// Because nothing stopped the next gate from calling roleOf() directly and reintroducing it. The
// fix was four call sites; the defect was a habit. A fix you cannot re-break is a fix. A fix you
// can re-break tomorrow is a coincidence with good intentions.
//
// ── WHY NOT "roleOf() OUTSIDE lib/" ────────────────────────────────────────────────────────────
// That was the obvious rule and it is the wrong one. 29 files call roleOf() and nearly all of them
// are progressive disclosure — `if (roleOf(profile) !== "owner") return null` hides an edit pill.
// Hiding a control on an unknown profile is harmless and self-correcting: the profile lands, the
// control appears. Nobody is told anything false about themselves.
//
// The harm is specifically in REFUSING: rendering a sentence that informs a person of their own
// standing, on evidence that does not support it. So that is what gets measured. A rule that
// banned all 29 would have failed on day one, been suppressed, and protected nothing — the audit
// equivalent of a gate that cannot pass is a gate that gets deleted.
import { readFileSync } from "node:fs";
import { walk } from "./falseempty.audit.mjs"; // one file-walker, not two

// Both are GATES, not ratchets: the count is 0 today and there is no legitimate reason to add one.
export const REFUSAL_BASELINE = 0;
export const COLLAPSE_BASELINE = 0;

// Language that, in a page-level heading, tells a person they may not be here.
const REFUSAL =
  /\b(?:staff|crew|leadership|owners?|admins?|members?)\s+only\b|\bnot authorized\b|\baccess denied\b|\byou (?:do not|don'?t) have access\b/i;

// The house pattern for a full-screen message is <div|h1 className="h-title">…</div>. Deliberately
// narrow: "Leadership only" also appears as an <option> label in AssignTaskSheet and as an audience
// name in BroadcastEditor, and neither is a refusal aimed at the reader. Matching the heading, not
// the string, is what separates "you may not be here" from "who should see this broadcast".
const HEADING = /className="h-title"[^>]*>([^<]*)</g;

/** The refusal headings this file renders. Empty for almost every file, which is the point. */
export function refusalHeadings(src) {
  const out = [];
  for (const m of src.matchAll(HEADING)) if (REFUSAL.test(m[1])) out.push(m[1].trim());
  return out;
}

const IMPORTS_ACCESS = /from\s+["'](?:@\/lib\/access|\.\.?\/(?:\.\.\/)*lib\/access)["']/;

/**
 * A file that refuses somebody without going through lib/access is deciding the policy itself, and
 * the policy it will land on is roleOf(profile) — which is exactly how this bug happened.
 */
export function refusesWithoutPolicy(src) {
  return refusalHeadings(src).length > 0 && !IMPORTS_ACCESS.test(src);
}

/**
 * ── THE SECOND MEASURE ─────────────────────────────────────────────────────────────────────────
 * Importing lib/access is not the same as respecting it. staffAccess returns five verdicts, and
 * the whole point is that "wait" and "failed" are not "deny". A caller that writes
 *
 *     if (!isAllowed(access)) return <StaffOnly />;
 *
 * has imported the fix and reproduced the bug — every unknown profile collapses back into a
 * refusal, now with a tidier import list. That is the shape this catches: a file that computes a
 * verdict and never names both non-denial outcomes.
 *
 * This is the same lesson as scripts/falseempty.audit.mjs's SILENT_BASELINE. There, converting to
 * useAsyncData dropped the count while every render still did `data ?? []` — the shape was fixed
 * and the lie was untouched. A rule about how code LOOKS cannot tell you what a person SEES, so
 * each of these audits needs the second measure that checks the outcome rather than the import.
 */
export function collapsesVerdicts(src) {
  if (!IMPORTS_ACCESS.test(src)) return false;
  if (!/\b(?:staffAccess|leadershipAccess)\s*\(/.test(src)) return false; // imports the type only
  return !(/["']wait["']/.test(src) && /["']failed["']/.test(src));
}

export function collect(root = ".") {
  const refuses = [];
  const collapses = [];
  for (const f of walk(root)) {
    if (/^\.\/(?:scripts|supabase)\//.test(f)) continue; // the audit's own body is not a screen
    const src = readFileSync(f, "utf8");
    const name = f.replace(/^\.\//, "");
    if (refusesWithoutPolicy(src)) refuses.push({ file: name, headings: refusalHeadings(src) });
    if (collapsesVerdicts(src)) collapses.push(name);
  }
  return { refuses, collapses };
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] || "").href) {
  const { refuses, collapses } = collect(".");
  if (process.argv.includes("--list")) {
    for (const r of refuses) console.log(`  ${r.file}: ${r.headings.join(" | ")}`);
    for (const c of collapses) console.log(`  ${c}: collapses wait/failed`);
  }
  console.log(`GATE AUDIT: ${refuses.length} screen(s) refuse without lib/access, ${collapses.length} collapse the verdicts`);

  let bad = false;
  if (refuses.length > REFUSAL_BASELINE) {
    for (const r of refuses) console.log(`    ${r.file} — ${r.headings.join(" | ")}`);
    console.log(`\n  ✗ GATE: ${refuses.length} > ${REFUSAL_BASELINE}. Telling somebody they are not staff is a claim about them. Route it through lib/access so an unknown profile waits instead of being refused.`);
    bad = true;
  }
  if (collapses.length > COLLAPSE_BASELINE) {
    for (const c of collapses) console.log(`    ${c}`);
    console.log(`\n  ✗ GATE: ${collapses.length} > ${COLLAPSE_BASELINE}. This file asks lib/access for a verdict and then treats "wait" and "failed" as "deny" — the original bug, with the fix imported.`);
    bad = true;
  }
  if (!bad) console.log(`  ✓ every refusal in the app is a decision lib/access stands behind.`);
  process.exit(bad ? 1 : 0);
}
