// SECURITY AUDIT — what the live database lets the API roles do, judged offline.
//
//   node scripts/security.audit.mjs          # fail on a hard finding, a list above its ceiling, or a stale snapshot
//   node scripts/security.audit.mjs --list   # every public-read table, definer function and definer view, named
//
// ── WHY (2026-10-02, Ryan: "was the entire backend audited?") ───────────────────────────────────
// Every other database check in this repo reads the migrations directory, or runs a handful of
// migrations in an in-process Postgres with stubbed roles. None of them can answer the question
// that actually matters on Supabase, because the answer lives only in production's pg_catalog:
//
//     which tables can a stranger with the anon key read or write?
//
// A table is exposed through PostgREST the moment it exists in `public` with a grant and no
// row-level security — and Supabase grants anon and authenticated on new tables by default. The
// migrations say RLS was enabled 146 times; whether it is enabled NOW, on every table, with
// policies that say what the migration meant, is a fact about the database, not the directory.
// So this reads a snapshot pulled from pg_catalog (scripts/security.snapshot.sql, read back and
// digest-checked by scripts/security.snapshot.mjs) and applies the rules below. The rules live
// HERE, in one place, with tests in scripts/audits.test.mjs; the snapshot only measures.
//
// ── THE RULES ──────────────────────────────────────────────────────────────────────────────────
// HARD — fail, no ceiling:
//   rls-off       a table anon or authenticated may touch, with row-level security off. Nothing
//                 between a stranger and every row.
//   open-write    a permissive INSERT/UPDATE/DELETE/ALL policy for public, anon or authenticated
//                 whose USING and WITH CHECK are both `true` (or absent). Anyone may write any row.
// RATCHETED — a list that may not grow without a reason in the commit message:
//   public-read   a permissive SELECT policy for public or anon with USING `true`: the tables the
//                 menu, the truck and the events screens read as a guest. Intended; counted, so a
//                 new one is a decision and not an accident.
//   definer-exec  a SECURITY DEFINER function anon or authenticated may execute. Each one runs as
//                 its owner, past RLS; each one is an API of its own.
//   definer-view  a view anon or authenticated may read that runs as its OWNER (security_invoker
//                 off), so RLS on the tables underneath does not apply to it.
// EXEMPT — an entry in EXEMPT below, with a reason; an exemption without one is a finding.
//
// ── STALENESS, AND WHAT NOT CHECKED MEANS HERE ─────────────────────────────────────────────────
// The snapshot records the ledger's high-water mark when it was pulled. If a migration above that
// mark mentions a policy, a grant, row level security or security definer, the snapshot predates
// a change to exactly what it measures, and this reports NOT CHECKED. A missing snapshot is NOT
// CHECKED too. Both exit 0 and print it on every run — the convention scripts/columns.audit.mjs
// and scripts/smoke.authed.mjs follow for an input only a person can supply (a credential, a read
// of production): never a pass on evidence it does not have, and never a red build the next
// person cannot clear from this directory. A FINDING, with a snapshot in hand, exits 1.
//
// ── PULLING THE SNAPSHOT (one minute, the owner's hands) ───────────────────────────────────────
//   1. Supabase → SQL editor → paste scripts/security.snapshot.sql → Run
//   2. Results → Export → Copy as JSON → save it as rows.json (anywhere)
//   3. node scripts/security.snapshot.mjs --from rows.json      → writes supabase/schema.security.json
//   4. node scripts/security.audit.mjs --list                   → read it; commit the snapshot
// The reader refuses a read-back that lost or altered a row (row count, length and sha256 all
// have to agree with what the database printed), so a half-copied result cannot become a snapshot.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "supabase/schema.security.json");
const MIGRATIONS = join(ROOT, "supabase/migrations");

// ── CEILINGS — measured, not remembered. ─────────────────────────────────────────────────────────
// null = not yet measured on production: the first snapshot sets each one to what it finds and
// the commit message says so. From then on a list may not grow without a reason. (What the
// migrations directory SAYS, for the record, 2026-10-02: 3 tables select `true` for the world —
// live_status, site_copy, stops — and 2 policies let a guest insert, exempted below. The directory
// is not the database; the snapshot is.)
export const CEILING = {
  publicRead: null,    // tables with a world-readable SELECT policy
  definerExec: null,   // SECURITY DEFINER functions the API roles may call
  definerView: null,   // owner-run views the API roles may read
};

// ── EXEMPTIONS — in the open, each with its reason; "table" for rls-off, "table.policy" for open-write.
export const EXEMPT = {
  "booking_requests.anyone request":
    "the public booking form (/book) files a request as a guest; every text field is length-capped by booking_len (0008) and nothing is read back without is_admin()",
  "funnel_events.funnel anyone insert":
    "funnel telemetry from guests (0199): funnel and step are CHECK-constrained, session is a 24-char ephemeral token, and only staff can read sums through funnel_counts()",
};

const API_ROLES = ["anon", "authenticated"];
const CMD = { r: "select", a: "insert", w: "update", d: "delete", "*": "all" };

/** The compact snapshot (see scripts/security.snapshot.sql for the shape) → plain objects. Pure. */
export function expand(snap) {
  const x = snap.x || [];
  const expr = (i) => (i === null || i === undefined ? null : x[i]);
  const tables = {};
  for (const [name, row] of Object.entries(snap.t || {})) {
    const [kind, rls, force, anon, authenticated, service_role, invoker, policies] = row;
    tables[name] = {
      kind, rls, force, invoker,
      priv: { anon: anon || "", authenticated: authenticated || "", service_role: service_role || "" },
      policies: (policies || []).map(([n, c, p, r, q, w]) => ({ n, c, p, r: String(r || "").split(",").filter(Boolean), q: expr(q), w: expr(w) })),
    };
  }
  const functions = (snap.f || []).map(([name, args, anon, authenticated, service_role]) => ({ name, args, definer: true, exec: { anon, authenticated, service_role } }));
  return { tables, functions };
}

const isTrue = (x) => x === null || x === undefined || String(x).trim() === "true";
const touches = (rel, roles = API_ROLES) => roles.some((r) => (rel.priv?.[r] || "").length > 0);
const forApi = (pol) => (pol.r || []).some((r) => r === "public" || API_ROLES.includes(r));

/** The verdict on one snapshot. Pure. */
export function judge(snapshot, exempt = EXEMPT) {
  const snap = snapshot.t ? expand(snapshot) : snapshot;   // compact (the committed shape) or already expanded
  const hard = [], publicRead = [], definerExec = [], definerView = [], info = { serviceOnly: 0, failClosed: 0, tables: 0, views: 0 };
  for (const [name, rel] of Object.entries(snap.tables || {})) {
    const isTable = rel.kind === "r" || rel.kind === "p";
    if (isTable) info.tables++; else info.views++;
    const api = touches(rel);
    if (!api) { info.serviceOnly++; continue; }
    if (isTable) {
      if (!rel.rls) {
        if (name in exempt) { if (!String(exempt[name]).trim()) hard.push(`${name}: exempt from rls-off with NO reason`); }
        else hard.push(`rls-off: ${name} — row-level security is off and ${API_ROLES.filter((r) => rel.priv?.[r]).map((r) => `${r} may ${rel.priv[r]}`).join(", ")}`);
      } else if (!(rel.policies || []).length) info.failClosed++;
      for (const pol of rel.policies || []) {
        if (!pol.p || !forApi(pol)) continue;
        const write = pol.c === "a" || pol.c === "w" || pol.c === "d" || pol.c === "*";
        if (write && isTrue(pol.q) && isTrue(pol.w)) {
          const key = `${name}.${pol.n}`;
          if (key in exempt) { if (!String(exempt[key]).trim()) hard.push(`${key}: exempt from open-write with NO reason`); }
          else hard.push(`open-write: ${name} — policy "${pol.n}" (${CMD[pol.c]}) is \`true\` for ${pol.r.join("/")}`);
        }
        if (pol.c === "r" && (pol.r.includes("public") || pol.r.includes("anon")) && isTrue(pol.q)) publicRead.push(name);
      }
    } else if (rel.invoker === false) {
      definerView.push(name);
    }
  }
  for (const fn of snap.functions || []) {
    if (fn.definer && API_ROLES.some((r) => fn.exec?.[r])) definerExec.push(`${fn.name}(${fn.args || ""})`);
  }
  return { hard, publicRead: [...new Set(publicRead)].sort(), definerExec: definerExec.sort(), definerView: definerView.sort(), info };
}

/** Migrations above the snapshot's high-water mark that touch what it measures. Pure over the list. */
export function staleBecause(snap, files) {
  const mark = Number(snap?.ledger?.max_seq);
  if (!Number.isFinite(mark)) return ["the snapshot carries no ledger mark"];
  const out = [];
  for (const { file, text } of files) {
    const seq = Number(file.slice(0, 4));
    if (!(seq > mark)) continue;
    const code = text.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (/\b(create|alter|drop)\s+policy\b|\b(grant|revoke)\b|row\s+level\s+security|security\s+definer|security_invoker/i.test(code)) out.push(file);
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const list = process.argv.includes("--list");
  let snap;
  try { snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")); }
  catch {
    console.log("SECURITY AUDIT: NOT CHECKED — no supabase/schema.security.json. The database's posture (RLS, grants, policies, definer functions) is unmeasured.");
    console.log("  Pull it: run scripts/security.snapshot.sql in the SQL editor, Export → Copy as JSON → rows.json, then  node scripts/security.snapshot.mjs --from rows.json");
    process.exit(0);
  }
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().map((file) => ({ file, text: readFileSync(join(MIGRATIONS, file), "utf8") }));
  const stale = staleBecause(snap, files);
  const age = Math.round((Date.now() - Date.parse(snap.pulled_at)) / 86_400_000);
  console.log(`SECURITY AUDIT: snapshot pulled ${age} day(s) ago at ledger ${String(snap.ledger?.max_seq).padStart(4, "0")} — ${Object.keys(snap.t || {}).length} relation(s), ${(snap.f || []).length} definer function(s), ${(snap.x || []).length} distinct policy expression(s)`);
  if (stale.length) {
    console.log(`SECURITY AUDIT: NOT CHECKED — ${stale.length} migration(s) above the snapshot's mark change policies, grants or RLS: ${stale.join(", ")}.`);
    console.log("  The snapshot predates a change to exactly what it measures. Re-pull it once they are applied (steps in this file's header).");
    process.exit(0);
  }
  const v = judge(snap);
  let fails = 0;
  const ratchet = (name, arr, ceiling) => {
    if (ceiling === null) { console.log(`  · ${name}: ${arr.length} — no ceiling recorded yet. Record ${arr.length} in CEILING with this snapshot's commit.`); fails++; }
    else if (arr.length > ceiling) { fails++; console.log(`  ✗ ${name}: ${arr.length} — ceiling ${ceiling}. Up. Name the new one in the commit message and raise the ceiling here, or remove it.`); }
    else if (arr.length < ceiling) { fails++; console.log(`  ✗ ${name}: ${arr.length} — ceiling ${ceiling} sits above it. Good; now LOWER the ceiling to ${arr.length}.`); }
    else console.log(`  ✓ ${name}: ${arr.length} (ceiling ${ceiling})`);
    if (list) for (const x of arr) console.log(`      ${x}`);
  };
  console.log(`  ${v.info.tables} table(s), ${v.info.views} view(s); ${v.info.serviceOnly} reachable by the service role only; ${v.info.failClosed} with RLS on and no policy (closed)`);
  for (const h of v.hard) { fails++; console.log(`  ✗ ${h}`); }
  if (!v.hard.length) console.log("  ✓ no table the API roles can touch has RLS off; no write policy is `true`");
  ratchet("tables readable by the world (SELECT `true`)", v.publicRead, CEILING.publicRead);
  ratchet("SECURITY DEFINER functions the API roles may call", v.definerExec, CEILING.definerExec);
  ratchet("owner-run views the API roles may read", v.definerView, CEILING.definerView);
  if (fails) { console.log(`\nSECURITY AUDIT: ${fails} failure(s).`); process.exit(1); }
  console.log("\nSECURITY AUDIT: clean.");
}
