// PULL THE COLUMN SNAPSHOT FROM THE LIVE DATABASE.
//
//   npm run schema:snapshot          # write supabase/schema.columns.json
//   npm run schema:snapshot -- --dry # fetch and report, write nothing
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
// scripts/columns.audit.mjs is the only check in this repo that can catch 62af8ef — a select naming
// a column that does not exist, which PostgREST answers with an error OBJECT rather than by
// throwing, and which a bare catch turns into "nothing here" on screen. It needs a snapshot of the
// real database, and without one it prints NOT CHECKED. It has printed NOT CHECKED since
// 2026-09-11, because refreshing it meant opening the SQL editor, running a query, and pasting a
// value into a file by hand. A step that costs a browser session and a copy-paste is a step that
// does not happen, and a check that never runs is not a check.
//
// So this is the ONE home for that refresh. The SQL in columns.audit.mjs's header still works and
// is kept for the case where this command cannot run at all, but it is the fallback, not a second
// procedure — two ways to produce the same file is how two lists drift.
//
// ── WHY IT READS PostgREST AND NOT pg_attribute ────────────────────────────────────────────────
// Introspecting pg_attribute needs a Postgres connection, which means a new dependency (this repo
// has none: @supabase/supabase-js is a PostgREST client and PGlite is embedded-only) and a second
// credential. PostgREST publishes its own schema at the API root — every relation it exposes, with
// every column — and that needs nothing but the service key the server already uses.
//
// The coverage difference is real and it is in the safe direction. The SQL sees every relation in
// `public`; this sees every relation PostgREST exposes. But the checker only ever asks about
// relations reached by `.from("x")`, and EVERY one of those is a PostgREST call — supabaseAdmin is
// a PostgREST client too. So the set this returns is a superset of the set being checked. A
// relation the app reads cannot be missing here for a reason other than it actually being gone.
//
// ── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────────────────────────
// It will not write a snapshot that would turn the check into a false-alarm machine. If the fetch
// half-works — wrong project, PostgREST pointed at another schema, a key with no grants — the
// honest-looking result is a small snapshot, and a small snapshot makes columns.audit.mjs report
// dozens of relations as deleted. Every one of those would be wrong, and a check that cries wolf
// gets exempted into uselessness. So it sanity-checks against what the app actually reads and
// refuses rather than writing something that lies. NOT CHECKED is a worse state than checked; it is
// a much better state than confidently wrong.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// The reader owns the snapshot format (META, readMeta, ageLine); this file conforms to it. The
// import goes one way only — a cycle here would be two files each deciding what a snapshot is.
import { collect, META } from "./columns.audit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "supabase/schema.columns.json");

/**
 * PostgREST's OpenAPI document → `{ relation: [column, ...] }`.
 *
 * Both document shapes are handled: `definitions` (Swagger 2, what PostgREST 9/10/11 emit) and
 * `components.schemas` (OpenAPI 3). Reading only one of them is how this would quietly return an
 * empty object against a newer PostgREST and then get refused by the sanity check for the wrong
 * reason — the error message would blame the key.
 */
export function definitionsToSchema(spec) {
  const defs = (spec && spec.definitions) || (spec && spec.components && spec.components.schemas) || {};
  const out = {};
  for (const [name, d] of Object.entries(defs)) {
    const props = Object.keys((d && d.properties) || {});
    // A definition with no properties is a parameter or a response envelope, not a relation.
    if (props.length) out[name] = props.sort();
  }
  return out;
}

/**
 * Is this snapshot too damaged to write?
 *
 * Returns a refusal string, or null to go ahead. The distinction it is drawing: a table that was
 * genuinely dropped shows up as one or two missing relations and SHOULD reach the checker as a
 * failure. A fetch that landed somewhere wrong shows up as most of them missing, which is not a
 * schema change any database ever performs in one step.
 */
export function refuseReason(schema, needed) {
  const rels = Object.keys(schema).filter((k) => k !== META);
  if (rels.length === 0) return `the database returned no relations at all`;
  if (rels.length < 50) return `only ${rels.length} relations came back; this app reads ${needed.length}`;
  const missing = needed.filter((r) => !schema[r]);
  if (missing.length >= 10) {
    return `${missing.length} of the ${needed.length} relations this app reads are absent ` +
      `(${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}). ` +
      `A real migration does not drop ten tables at once — this is a fetch that landed in the wrong place`;
  }
  return null;
}

/** The project ref out of a Supabase URL, for provenance. Never the key, and never the whole URL. */
export function projectRef(url) {
  const m = String(url || "").match(/https?:\/\/([a-z0-9]+)\./i);
  return m ? m[1] : null;
}

// ── THE SQL FALLBACK, AS AN INPUT RATHER THAN A SECOND PROCEDURE ───────────────────────────────
// columns.audit.mjs's header carries a query that answers the same question from pg_class, "for when
// that command cannot run at all". It was written as a paste-the-result-into-the-file instruction,
// and that is the part worth changing: a human assembling the file by hand is a SECOND writer, with
// its own idea of the meta block and its own chance to get the shape wrong.
//
// This is that fallback wired in as an INPUT. The query's output goes in; everything after — the
// sanity check that refuses a snapshot which would invent missing relations, the meta stamp, the key
// sort, the reporting — is the same code the PostgREST path uses. One writer, two ways to feed it.
//
//   npm run schema:snapshot -- --from-sql=/tmp/snap.json
//
// It exists because the normal path needs SUPABASE_SERVICE_ROLE_KEY, and the column check had
// therefore said NOT CHECKED since 2026-09-11 for anyone without that key in their shell — 603
// selects and 874 columns unverified for eighteen days because the refresh needed a credential.
// `source` records which way the data arrived, so a snapshot pulled this way never looks like one
// pulled from PostgREST.
async function main() {
  const dry = process.argv.includes("--dry");
  const fromSql = (process.argv.find((a) => a.startsWith("--from-sql=")) || "").split("=").slice(1).join("=");

  if (fromSql) {
    let schema;
    try {
      schema = JSON.parse(readFileSync(fromSql, "utf8"));
    } catch (e) {
      console.log(`SCHEMA SNAPSHOT: could not read ${fromSql} — ${e && e.message ? e.message : e}. Nothing written.`);
      process.exit(1);
    }
    // The query returns `{ relation: [column, ...] }` and nothing else. Anything with a $snapshot
    // block is a snapshot file somebody is trying to re-feed, not the query's output.
    if (!schema || typeof schema !== "object" || Array.isArray(schema) || schema[META]) {
      console.log(`SCHEMA SNAPSHOT: ${fromSql} is not the query's output — expected { relation: [column, …] }.`);
      console.log(`  The query is in scripts/columns.audit.mjs's header. Save the single value it returns.`);
      process.exit(1);
    }
    // WHICH database this came from is not recoverable from the query's output, and this account has
    // two Supabase organisations. A snapshot that cannot name its project is one you cannot check
    // against the right database later, so the ref is asked for rather than guessed — and when it is
    // not given, the file says so instead of implying a project it does not know.
    const ref = (process.argv.find((a) => a.startsWith("--project=")) || "").split("=")[1];
    finish(schema, {
      project: ref || "unrecorded — rerun with --project=<ref> to name it",
      source: "sql fallback (pg_class/pg_attribute), run in the Supabase SQL editor",
    }, dry);
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    // Named individually, because "missing env" sends people to check both when one is set.
    const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean);
    console.log(`SCHEMA SNAPSHOT: cannot run — ${missing.join(" and ")} not set.`);
    console.log(`  These are the same two the server already uses (lib/supabaseAdmin.ts); run this`);
    console.log(`  wherever they are, or use the SQL fallback in scripts/columns.audit.mjs's header.`);
    process.exit(1);
  }

  let spec;
  try {
    const r = await fetch(url.replace(/\/+$/, "") + "/rest/v1/", {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
    });
    if (!r.ok) {
      console.log(`SCHEMA SNAPSHOT: the database answered ${r.status}. Nothing written.`);
      console.log(`  ${(await r.text()).slice(0, 300)}`);
      process.exit(1);
    }
    spec = await r.json();
  } catch (e) {
    console.log(`SCHEMA SNAPSHOT: could not reach the database — ${e && e.message ? e.message : e}. Nothing written.`);
    process.exit(1);
  }

  finish(definitionsToSchema(spec), {
    project: projectRef(url),
    source: "postgrest openapi",
  }, dry);
}

/**
 * Everything that happens AFTER the data arrives: the refusal, the meta stamp, the sort, the write
 * and the report. Both input paths land here, so neither can develop its own idea of what a snapshot
 * looks like — which is the failure this whole file exists to prevent, one level up.
 */
function finish(schema, provenance, dry) {
  const { need } = collect(ROOT);
  for (const [rel, m] of [...need]) if (m.size === 0) need.delete(rel);
  const needed = [...need.keys()];

  const refusal = refuseReason(schema, needed);
  if (refusal) {
    console.log(`SCHEMA SNAPSHOT: refusing to write — ${refusal}.`);
    console.log(`  A snapshot missing relations the app reads does not report a problem, it INVENTS`);
    console.log(`  one for every line it cannot see. NOT CHECKED is the better of the two states.`);
    process.exit(1);
  }

  const rels = Object.keys(schema).length;
  const cols = Object.values(schema).reduce((a, c) => a + c.length, 0);
  const missing = needed.filter((r) => !schema[r]);

  if (dry) {
    console.log(`SCHEMA SNAPSHOT (dry): ${rels} relations, ${cols} columns. Nothing written.`);
    if (missing.length) console.log(`  the app reads ${missing.length} relation(s) not in it: ${missing.join(", ")}`);
    return;
  }

  schema[META] = {
    pulled_at: new Date().toISOString(),
    project: provenance.project,
    source: provenance.source,
    relations: rels,
    columns: cols,
  };
  // Sorted keys so a refresh that changes nothing produces an empty diff, and a refresh that changes
  // something produces a diff a person can read.
  const sorted = {};
  for (const k of Object.keys(schema).sort()) sorted[k] = schema[k];
  writeFileSync(SNAPSHOT, JSON.stringify(sorted, null, 2) + "\n");

  console.log(`SCHEMA SNAPSHOT: wrote supabase/schema.columns.json — ${rels} relations, ${cols} columns.`);
  if (missing.length) {
    console.log(`  ${missing.length} relation(s) the app reads are NOT in the database: ${missing.join(", ")}`);
    console.log(`  That is a real finding — npm run audit will now fail on it.`);
  }
  console.log(`  Now run: node scripts/columns.audit.mjs`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  await main();
}
