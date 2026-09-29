// DOES THE APP ASK FOR COLUMNS THAT EXIST?
//
//   node scripts/columns.audit.mjs           # check, or say plainly that it could not
//   node scripts/columns.audit.mjs --list    # every relation and column it would check
//
// ── WHY ────────────────────────────────────────────────────────────────────────────────────────
// 62af8ef: My Day's loader was changed from select("*") to a guessed column list that included
// `kind`. events has no `kind`. PostgREST answers a bad column list with an error OBJECT rather
// than by throwing, the caller's bare catch turned that into an absence, and the panel rendered
// "nothing to do" — through 1,861 assertions, four audits, five release gates, a production build
// and 73 UI checks. Not one of them asks the only question that would have caught it: does this
// column exist on this relation?
//
// Nothing else in the suite can. The db tests run against PGlite fixtures, which are hand-written
// and therefore agree with whatever the fixture author believed. The UI smoke runs unauthenticated
// and never reaches the crew console. tsc knows nothing about a string passed to .select().
//
// ── THE TRUTH SOURCE IS PRODUCTION, NOT THE MIGRATIONS ─────────────────────────────────────────
// This repo has learned that one twice (0312 revoked 21 views on a premise that was true when it
// was written; 0321/0322/0323 chased a grant chain the migration text could not show). Reading the
// migrations tells you what a migration DID, not what the database IS. So this check reads a
// snapshot pulled from the live database, and when there is no snapshot it says NOT CHECKED rather
// than passing. A gate that reports success on missing evidence is worse than no gate.
//
// REFRESH THE SNAPSHOT with:
//
//   npm run schema:snapshot
//
// That is the one home for the refresh (scripts/schema.snapshot.mjs). It reads PostgREST's own
// published schema with the two env vars the server already uses, sanity-checks the result against
// what this file says the app reads, and refuses to write a snapshot that would make this check
// invent missing relations.
//
// FALLBACK, for when that command cannot run at all: paste this into the SQL editor and save the
// single value it returns to supabase/schema.columns.json. It answers the same question — every
// relation in public and its columns — and it is a fallback, not a second procedure.
//
//   select json_object_agg(t.rel, t.cols) from (
//     select c.relname as rel, json_agg(a.attname order by a.attnum) as cols
//       from pg_class c
//       join pg_namespace n on n.oid = c.relnamespace
//       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
//      where n.nspname = 'public' and c.relkind in ('r','v','m','p','f')
//      group by c.relname) t;
//
// ── LAST RUN AGAINST PRODUCTION ────────────────────────────────────────────────────────────────
// 2026-09-11 — 196 relations in public; the app selects from 125 of them and names 856 distinct
// columns. ZERO missing relations, ZERO missing columns. That is the first time this question has
// ever been asked of this codebase, and it came back clean.
//
// 2026-09-29 — 197 relations; 129 read, 874 columns named. ZERO missing relations, ZERO missing
// columns. Worth saying plainly what happened in between: NOTHING. Eighteen days, 24 migrations and
// one real customer order later, this had printed NOT CHECKED every single time, because the only
// way to refresh the snapshot needed a service key that is not in most shells. A check that needs a
// credential to stay alive is a check that dies quietly — so the SQL fallback below is now an INPUT
// to scripts/schema.snapshot.mjs (--from-sql=…) instead of an instruction to assemble the file by
// hand, and refreshing it is a query plus a command.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { walk } from "./falseempty.audit.mjs"; // one file-walker, not four

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "supabase/schema.columns.json");

const FROM = /\.from\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*\)/g;

// ── THE SNAPSHOT FORMAT ────────────────────────────────────────────────────────────────────────
// `{ relation: [column, ...] }` plus one provenance record. This file is the reader, so the format
// is defined here and scripts/schema.snapshot.mjs conforms to it — the alternative is the writer
// and the reader each holding their own idea of the shape, which is the same drift this repo keeps
// finding in pairs of panels.

/** The provenance key. Relation names are `[a-zA-Z0-9_]+`, so a `$` can never collide with one. */
export const META = "$snapshot";

/** Read the provenance out of a snapshot file, or null. Never throws — a bad file is not a crash. */
export function readMeta(file = SNAPSHOT) {
  try {
    if (!existsSync(file)) return null;
    const j = JSON.parse(readFileSync(file, "utf8"));
    return j && j[META] ? j[META] : null;
  } catch { return null; }
}

/**
 * What to say about a snapshot's age.
 *
 * Printed on a pass as well as a failure. A snapshot pulled in March passes exactly as loudly as
 * one pulled this morning, and silence about that is how this check would quietly stop being about
 * the database at all while still printing a clean line every run.
 */
export function ageLine(meta, now = Date.now()) {
  if (!meta || !meta.pulled_at) return `snapshot has no provenance — refresh it: npm run schema:snapshot`;
  const t = Date.parse(meta.pulled_at);
  if (!Number.isFinite(t)) return `snapshot has an unreadable date — refresh it: npm run schema:snapshot`;
  const days = Math.floor((now - t) / 86400000);
  const from = meta.project ? ` from ${meta.project}` : "";
  if (days <= 0) return `snapshot pulled today${from}`;
  if (days >= 30) return `snapshot pulled ${days} days ago${from} — stale enough to be worth refreshing`;
  return `snapshot pulled ${days} day${days === 1 ? "" : "s"} ago${from}`;
}

/**
 * Every (relation, select-string) pair in the app.
 *
 * The hard part is deciding which .select() belongs to which .from(). A fixed lookahead window does
 * NOT establish that — it crosses into the next statement, and the first version of this made
 * event_tasks appear to select reorder_point and use_cases, which belong to an inventory_items
 * chain further down the same file. So the search stops at whichever comes first: the next .from(,
 * the end of the statement, or 800 characters; and between the two calls only chained method calls
 * are allowed.
 */
export function selectsIn(src) {
  const out = [];
  FROM.lastIndex = 0;
  let m;
  while ((m = FROM.exec(src))) {
    const rest = src.slice(m.index + m[0].length);
    const stop = Math.min(...[rest.indexOf(".from("), rest.indexOf(";"), 800].filter((x) => x >= 0));
    const chain = rest.slice(0, stop);
    const s = chain.match(/^\s*(?:\.[a-zA-Z_$][\w$]*\([^()]*\)\s*)*?\.select\(\s*(["'`])([\s\S]*?)\1/);
    if (s) out.push({ relation: m[1], select: s[2] });
  }
  return out;
}

/** Split a PostgREST select list on TOP-LEVEL commas — an embedded resource brings its own. */
export function topLevelParts(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const c of s) {
    if (c === "(") { depth++; cur += c; }
    else if (c === ")") { depth--; cur += c; }
    else if (c === "," && depth === 0) { out.push(cur); cur = ""; }
    else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/**
 * The plain column names a select string asks for. Deliberately CONSERVATIVE — anything this cannot
 * read with certainty is skipped rather than guessed at, because a checker that invents a column
 * name produces a confident failure about code that is fine, and this file has already watched
 * three regexes do exactly that. Skipped: embedded resources rel(a,b), computed and aggregate
 * parts, and `*`.
 */
export function columnsOf(select) {
  const cols = [], skipped = [];
  for (const p of topLevelParts(select)) {
    if (p.includes("(")) { skipped.push(p); continue; }            // embedded resource / aggregate
    if (p === "*" || p.startsWith("...")) continue;                 // everything, or a spread
    // ORDER MATTERS. The cast marker is a double colon and the alias marker is a single one, so
    // stripping the alias first reads `total_cents::int` as an alias named ":int" and throws the
    // column away. Caught by its own fixture, which is the only reason it is right.
    let c = p.split("::")[0].trim();                                // cast first
    if (c.includes(":")) c = c.slice(c.indexOf(":") + 1);           // then alias:column
    c = c.split("->")[0].split(".")[0].trim();                      // json path, qualifier
    c = c.replace(/!.*$/, "").trim();                               // !inner / !left hints
    if (c === "*" || c === "") continue;
    if (!/^[a-z_][a-z0-9_]*$/i.test(c)) { skipped.push(p); continue; }
    cols.push(c);
  }
  return { cols, skipped };
}

export function collect(root = ROOT) {
  const need = new Map(); // relation -> Map(column -> Set(file))
  let skipped = 0, selects = 0;
  for (const f of walk(root)) {
    const rel = f.replace(root + "/", "").replace(/^\.\//, "");
    if (!/^(app|components|lib)\//.test(rel)) continue;
    for (const { relation, select } of selectsIn(readFileSync(f, "utf8"))) {
      selects++;
      const { cols, skipped: sk } = columnsOf(select);
      skipped += sk.length;
      if (!need.has(relation)) need.set(relation, new Map());
      const m = need.get(relation);
      for (const c of cols) {
        if (!m.has(c)) m.set(c, new Set());
        m.get(c).add(rel);
      }
    }
  }
  return { need, selects, skipped };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const { need, selects, skipped } = collect();
  // Relations reached ONLY by select("*") are in the map with no columns — nothing to check about
  // them, so they are not counted. Quoting 148 when 125 are checkable is the kind of number this
  // repo has been burned by four times.
  for (const [rel, m] of [...need]) if (m.size === 0) need.delete(rel);
  const nCols = [...need.values()].reduce((a, m) => a + m.size, 0);

  if (process.argv.includes("--list")) {
    for (const [rel, m] of [...need].sort()) console.log(`${rel}: ${[...m.keys()].sort().join(", ")}`);
  }

  if (!existsSync(SNAPSHOT)) {
    // NOT a pass. The suite prints this line every run so a missing snapshot is visible rather than
    // silently equivalent to a clean result — the exact failure mode this whole check exists for.
    console.log(`COLUMN CONTRACT: NOT CHECKED — no supabase/schema.columns.json.`);
    console.log(`  ${need.size} relations and ${nCols} columns are waiting to be checked (${selects} selects read, ${skipped} parts skipped as computed).`);
    console.log(`  Refresh it: npm run schema:snapshot`);
    process.exit(0);
  }

  const schema = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const missingRel = [], missingCol = [];
  for (const [rel, m] of need) {
    // META is the provenance record, not a relation. It cannot collide with one — relation names are
    // [a-zA-Z0-9_]+ — and nothing here would ever look it up, but naming it keeps that deliberate.
    if (rel === META) continue;
    const have = schema[rel];
    if (!have) { missingRel.push(rel); continue; }
    const set = new Set(have);
    for (const [c, files] of m) if (!set.has(c)) missingCol.push(`${rel}.${c}  ← ${[...files].join(", ")}`);
  }

  console.log(`COLUMN CONTRACT: ${need.size} relations, ${nCols} columns, ${missingRel.length} unknown relation(s), ${missingCol.length} unknown column(s)`);
  // The age is printed on a PASS as well as a failure. A snapshot pulled months ago passes exactly
  // as loudly as one pulled today, and that is how a check quietly stops being about the database.
  console.log(`  ${ageLine(readMeta(SNAPSHOT))}`);
  if (missingRel.length || missingCol.length) {
    for (const r of missingRel) console.log(`    relation not in the database: ${r}`);
    for (const c of missingCol) console.log(`    ${c}`);
    console.log(`\n  ✗ A select naming a column that does not exist returns an ERROR OBJECT, not rows.`);
    console.log(`    If the caller does not check .error, that lands on screen as "nothing here" (62af8ef).`);
    console.log(`    If the snapshot is simply stale, refresh it: npm run schema:snapshot`);
    process.exit(1);
  }
}
