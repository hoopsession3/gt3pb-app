// DUPLICATION RATCHETS — the two consolidations this codebase has attempted twice and not finished.
//
//   node scripts/dupe.audit.mjs           # counts, and fail if either rose
//   node scripts/dupe.audit.mjs --list    # every site, to read
//
// ── WHY A RULE AND NOT JUST A CLEANUP ──────────────────────────────────────────────────────────
// Both of these already have a shared implementation, written on purpose, with a header explaining
// why. Both are still hand-rolled in most of the places they were meant to replace:
//
//   components/useCrew.ts   "Four screens already loaded profiles by hand" — it was TWELVE, and
//                           the hook was imported by exactly ONE file.
//   lib/tasks.ts            "the write spine" — six in-app call sites still insert event_tasks
//                           directly, and its own header already names this as unfinished.
//
// A consolidation without a rule is a coincidence. scripts/gate.audit.mjs is the precedent: it
// found a fifth broken gate on its first run precisely because a sweep only finds what you thought
// to look for. So these get counted, and the count can only go down.
import { readFileSync } from "node:fs";
import { walk } from "./falseempty.audit.mjs"; // one file-walker, not three

// Lower freely. Raising either means a consolidation went backwards.
export const CREW_BASELINE = 9;
// FILES, not call sites. The audit counted six call sites; this counts the two files they
// live in (app/crew/page.tsx and components/OpsPlan.tsx), because a file is the unit you
// convert. Quoting the call-site number here would make the baseline unfalsifiable.
export const TASKWRITE_BASELINE = 2;

// ── 1. the crew picker ─────────────────────────────────────────────────────────────────────────
// The signature is specific: reading profiles AND excluding members is the "who can I assign this
// to?" query. A read of profiles for some other purpose is not this.
const STAFF_FETCH = /\.from\(\s*["']profiles["']\s*\)[\s\S]{0,200}?\.neq\(\s*["']role["']\s*,\s*["']member["']\s*\)/;

// Screens that render people AS the data rather than as a dropdown. useCrew is a cached picker
// list — right for an assign-to, wrong for a board whose job is to show current state, and wrong
// for a chart that needs columns the hook does not select. Exempt BY NAME so the exemption is a
// decision somebody made rather than a gap in a regex.
export const CREW_EXEMPT = new Set([
  "components/useCrew.ts",          // the implementation itself
  "components/OrgChart.tsx",        // needs title + avatar_url, which useCrew does not select
  "components/UtilizationPanel.tsx",// renders per-person activity; a cached list would go stale
  "components/WorkloadBoard.tsx",   // renders per-person workload; same reason
]);

/** True when this file hand-rolls the crew-picker fetch instead of using the shared hook. */
export function handRollsCrew(src, file) {
  if (CREW_EXEMPT.has(file)) return false;
  return STAFF_FETCH.test(src);
}

// ── 2. the task write spine ────────────────────────────────────────────────────────────────────
// lib/tasks.ts exists so every surface's write goes through one adapter — it is what makes
// event_tasks and todos behave like one thing at write time, the way all_tasks does at read time.
const DIRECT_TASK_INSERT = /\.from\(\s*["']event_tasks["']\s*\)\s*\.insert\(/;

// Server-side agent routes use supabaseAdmin and run without a session, so lib/tasks.ts (a client
// module) is not available to them. That is a real constraint, not laziness — they are exempt, and
// the count below is in-app call sites only.
export function bypassesTaskSpine(src, file) {
  if (file === "lib/tasks.ts") return false;
  if (file.startsWith("app/api/")) return false;  // server-side, no client session
  return DIRECT_TASK_INSERT.test(src);
}

export function collect(root = ".") {
  const crew = [];
  const taskWrites = [];
  for (const f of walk(root)) {
    const file = f.replace(/^\.\//, "");
    if (file.startsWith("scripts/")) continue;
    const src = readFileSync(f, "utf8");
    if (handRollsCrew(src, file)) crew.push(file);
    if (bypassesTaskSpine(src, file)) taskWrites.push(file);
  }
  return { crew, taskWrites };
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] || "").href) {
  const { crew, taskWrites } = collect(".");
  if (process.argv.includes("--list")) {
    for (const f of crew) console.log(`  crew-fetch   ${f}`);
    for (const f of taskWrites) console.log(`  task-insert  ${f}`);
  }
  console.log(`DUPLICATION: ${crew.length} hand-rolled crew fetches (baseline ${CREW_BASELINE}), ${taskWrites.length} direct event_tasks inserts (baseline ${TASKWRITE_BASELINE})`);

  let bad = false;
  if (crew.length > CREW_BASELINE) {
    for (const f of crew) console.log(`    ${f}`);
    console.log(`\n  ✗ RATCHET: ${crew.length} > ${CREW_BASELINE}. components/useCrew.ts is the one crew fetch. If this screen renders people as DATA rather than as a picker, add it to CREW_EXEMPT with the reason.`);
    bad = true;
  } else if (crew.length < CREW_BASELINE) {
    console.log(`  · below baseline (${crew.length} < ${CREW_BASELINE}) — lower CREW_BASELINE to ${crew.length} to lock it in.`);
  }
  if (taskWrites.length > TASKWRITE_BASELINE) {
    for (const f of taskWrites) console.log(`    ${f}`);
    console.log(`\n  ✗ RATCHET: ${taskWrites.length} > ${TASKWRITE_BASELINE}. lib/tasks.ts is the write spine — createEventTask() rather than a direct insert.`);
    bad = true;
  } else if (taskWrites.length < TASKWRITE_BASELINE) {
    console.log(`  · below baseline (${taskWrites.length} < ${TASKWRITE_BASELINE}) — lower TASKWRITE_BASELINE to ${taskWrites.length}.`);
  }
  process.exit(bad ? 1 : 0);
}
