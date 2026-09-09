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
//
// Was 9. The four pickers among those nine now call useCrew; the other five are exempt BY NAME with
// a reason, which is the point of an exemption list — a decision somebody made, not a gap in a
// regex. Zero means the next hand-rolled crew fetch has to argue for itself.
export const CREW_BASELINE = 0;
// FILES, not call sites. The audit counted six call sites; this counts the two files they
// live in (app/crew/page.tsx and components/OpsPlan.tsx), because a file is the unit you
// convert. Quoting the call-site number here would make the baseline unfalsifiable.
export const TASKWRITE_BASELINE = 2;
// Zero, and it means zero: lib/roles.ts is the only file allowed to name the seven roles. Unlike
// the two ratchets above this one started at zero rather than being ratcheted down to it, because
// the four maps it exists to prevent were all converted in the same commit that added the check.
export const ROLENAME_BASELINE = 0;

// ── 1. the crew picker ─────────────────────────────────────────────────────────────────────────
// The signature is specific: reading profiles AND excluding members is the "who can I assign this
// to?" query. A read of profiles for some other purpose is not this.
const STAFF_FETCH = /\.from\(\s*["']profiles["']\s*\)[\s\S]{0,200}?\.neq\(\s*["']role["']\s*,\s*["']member["']\s*\)/;

// Screens that render people AS the data rather than as a dropdown. useCrew is a cached picker
// list — right for an assign-to, wrong for a board whose job is to show current state, and wrong
// for a chart that needs columns the hook does not select. Exempt BY NAME so the exemption is a
// decision somebody made rather than a gap in a regex.
// There are TWO reasons to be exempt, and they are different reasons.
//
// (a) PEOPLE AS THE DATA. The screen's subject is the crew, not a field on a form. A cached picker
//     list is the wrong shape — it goes stale, and it does not carry the columns these need.
//
// (b) AN EMPTY LIST IS NOT A WORKING STATE. useCrew's contract is that a failed read degrades to []
//     and the caller falls back to whatever text it already had. That is exactly right for a
//     dropdown and exactly wrong where the list decides WHO IS NAMED or WHO IS TOLD: an empty list
//     silently attributes every comment to "Crew", or silently notifies nobody. Failing loudly is
//     the correct behaviour there, so these keep their own read INSIDE useAsyncData, which throws.
//
// That line — picker degrades to empty, attribution degrades to wrong — is the rule. It is why the
// four conversions in this round were the four pickers and not all nine.
export const CREW_EXEMPT = new Set([
  "components/useCrew.ts",          // the implementation itself
  // (a) people as the data
  "components/OrgChart.tsx",        // needs title + avatar_url, which useCrew does not select
  "components/UtilizationPanel.tsx",// renders per-person activity; a cached list would go stale
  "components/WorkloadBoard.tsx",   // renders per-person workload; same reason
  "app/crew/page.tsx",              // the roster ITSELF — points, credit, role editing per person
  "app/academy/page.tsx",           // the Team view: every crew member's progress, certs, due dates
  // (b) an empty list would be wrong, not just short
  "components/Discussions.tsx",     // maps author_id → first name; empty = every comment says "Crew"
  "components/StrategyCollab.tsx",  // same — comment attribution on a strategy thread
  "components/ProposalDesk.tsx",    // ALSO decides who gets the review alert; empty = nobody is told
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

// ── 3. the role vocabulary ─────────────────────────────────────────────────────────────────────
// FOUR modules named the same seven roles independently — the team console, the org chart, the
// invite form and the offer letter — and two of them had already drifted ("Event Manager" in three
// places, "Event manager" in two). The harmless half is the inconsistent capital. The harmful half
// is that adding a role to profiles' CHECK constraint means finding four maps, and the one you miss
// renders a blank cell where a role name should be.
//
// The signature is an object keyed BY role name whose value is a capitalised string — which is what
// a naming map looks like and what nothing else looks like. Three distinct keys is the threshold:
//
//   ROLE_META    owner: { label: "Owner", … }     ← was caught; now the label is gone from it
//   ROLE_LABEL   owner: "Owner", admin: "Admin"   ← was caught; deleted
//
// and these, correctly, are NOT caught, because none of them names a role:
//
//   OperatorNav   event_manager: ["day", "now", …]        (a section list — value is an array)
//   APP_TO_ACADEMY owner: "founder", member: "staff"      (a MAPPING to another vocabulary,
//                                                          lowercase, and deliberately separate)
//   lib/academy   { key: "event_manager", label: "…" }    (the curriculum's own audience names —
//                                                          a different vocabulary, see lib/roles)
//
// Two keys slips through. That is deliberate: three is where a pair of coincidental properties
// becomes unmistakably a map, and a check that cries wolf gets exempted into uselessness.
//
// TWO shapes, because the first version of this check only had one and would not have caught the
// biggest of the four maps it was written for. ROLE_META did not write `owner: "Owner"` — it wrote
// `owner: { label: "Owner", tier: "lead", … }`, and a pattern that only looks for a role key
// followed by a string walks straight past it. I noticed because I wrote the test case for the
// nested shape, saw it return false, and typed `=== false` to make the suite green. That is the
// exact move that produces a gate that cannot fail; the assertion is `=== true` now and the pattern
// below is what changed to earn it.
const ROLE_KEYS = ["owner", "admin", "event_manager", "operator", "contractor", "server", "member"];
const ROLE_ALT = ROLE_KEYS.join("|");
//   owner: "Owner"
const NAMES_DIRECT = new RegExp(String.raw`\b(${ROLE_ALT})\s*:\s*(["'])[A-Z][^"']*\2`, "g");
//   owner: { label: "Owner", … }     [^{}]* keeps it inside ONE flat entry, never spanning two.
const NAMES_NESTED = new RegExp(String.raw`\b(${ROLE_ALT})\s*:\s*\{[^{}]*\blabel\s*:\s*(["'])[A-Z][^"']*\2`, "g");

/** Role keys this file maps to a capitalised display string — i.e. the role names it hand-writes.
 *
 *  KNOWN LIMIT, stated rather than papered over: this recognises MAPS. The invite form's old list
 *  — `{ v: "server", l: "Server — service & delivery" }` — put the role in a VALUE and buried the
 *  name inside a longer sentence, and no shape rule finds that without also flagging lib/academy.ts
 *  for naming its own curriculum tracks, which is a different vocabulary and allowed to. So that
 *  one was converted by hand and is not defended by this check. Three shapes would need three
 *  exemptions; two shapes need none. */
export function rolesNamedIn(src) {
  const hits = [...src.matchAll(NAMES_DIRECT), ...src.matchAll(NAMES_NESTED)].map((m) => m[1]);
  return [...new Set(hits)].sort();
}

export function namesRoleVocabulary(src, file) {
  if (file === "lib/roles.ts") return false;   // the one canonical home
  return rolesNamedIn(src).length >= 3;
}

export function collect(root = ".") {
  const crew = [];
  const taskWrites = [];
  const roleNames = [];
  for (const f of walk(root)) {
    const file = f.replace(/^\.\//, "");
    if (file.startsWith("scripts/")) continue;
    const src = readFileSync(f, "utf8");
    if (handRollsCrew(src, file)) crew.push(file);
    if (bypassesTaskSpine(src, file)) taskWrites.push(file);
    if (namesRoleVocabulary(src, file)) roleNames.push(file);
  }
  return { crew, taskWrites, roleNames };
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] || "").href) {
  const { crew, taskWrites, roleNames } = collect(".");
  if (process.argv.includes("--list")) {
    for (const f of crew) console.log(`  crew-fetch   ${f}`);
    for (const f of taskWrites) console.log(`  task-insert  ${f}`);
    for (const f of roleNames) console.log(`  role-naming  ${f}`);
  }
  console.log(`DUPLICATION: ${crew.length} hand-rolled crew fetches (baseline ${CREW_BASELINE}), ${taskWrites.length} direct event_tasks inserts (baseline ${TASKWRITE_BASELINE}), ${roleNames.length} role-naming maps outside lib/roles (baseline ${ROLENAME_BASELINE})`);

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
  if (roleNames.length > ROLENAME_BASELINE) {
    for (const f of roleNames) console.log(`    ${f}  names ${rolesNamedIn(readFileSync(f, "utf8")).join(", ")}`);
    console.log(`\n  ✗ RATCHET: ${roleNames.length} > ${ROLENAME_BASELINE}. A role's human name is decided in lib/roles.ts — roleLabel(r). Keep your module's own FACTS about a role (what it reaches, what a hint says); just do not restate its name.`);
    bad = true;
  }
  process.exit(bad ? 1 : 0);
}
