// SERVICE-ROLE AUDIT — the remaining half of risk R-002, turned into a gate instead of a chore.
//
// 0134 put a restrictive tenant-isolation policy on every table that carries tenant_id, and 0283
// closed the eight tables it never reached. That covers everything going through PostgREST with a
// user's token. It does NOT cover the service role: supabaseAdmin bypasses RLS completely, by
// design, so on those routes tenancy is enforced by app code or not at all.
//
// The register's remaining action was "sweep the supabaseAdmin routes". A sweep done once decays the
// moment someone adds route 61. So this is the sweep AND the thing that keeps it swept: it walks
// every app/api route, finds each supabaseAdmin table access, decides whether that table is
// tenant-scoped, and reports any access that neither filters by tenant nor carries a written reason
// for not needing to.
//
// EXEMPTIONS ARE DECLARED IN THIS FILE, WITH REASONS, IN THE OPEN. An exemption with no reason is
// treated as a finding — a list of table names nobody can justify is how this rots.
//
// Exit code is 0 unless STRICT=1, so it reports on every run and only blocks when asked to. The
// point today is an honest number, not a red build.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = join(ROOT, "app", "api");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

// ── which tables actually carry a tenant ────────────────────────────────────────────────────────
// Derived from the migrations rather than a hand-kept list, so a table that joins the spine later is
// picked up without anyone remembering to add it here.
function tenantScopedTables() {
  const t = new Set();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    // create table public.x ( ... tenant_id ... )
    for (const m of sql.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
      if (/\btenant_id\b/.test(m[2])) t.add(m[1]);
    }
    // alter table public.x add column ... tenant_id
    for (const m of sql.matchAll(/alter table public\.(\w+)\s+add column[^;]*\btenant_id\b/g)) t.add(m[1]);
    // the dynamic loops in 0040/0134/0283 name their tables in an array literal
    for (const m of sql.matchAll(/foreach\s+\w+\s+in\s+array\s+array\[([^\]]+)\]/gi)) {
      for (const q of m[1].matchAll(/'(\w+)'/g)) t.add(q[1]);
    }
  }
  return t;
}

// ── routes that legitimately run without a caller ───────────────────────────────────────────────
// Each entry says WHY. If you cannot write the why, it is not an exemption.
const EXEMPT_ROUTES = {
  "billing/webhook": "Stripe calls this, not a person. There is no caller JWT to derive a tenant from; the event's own ids are the scope.",
  "cron/digest": "Scheduled job with no caller. It deliberately spans tenants to build each tenant's digest.",
  "notes/inbound": "Inbound email webhook. No JWT; the recipient address is the scope.",
  "outlook/callback": "OAuth redirect from Microsoft, before a session exists.",
};

// Tables that are genuinely global — not tenant data, so a tenant filter would be meaningless.
const GLOBAL_TABLES = {
  tenants: "The tenant list itself. 0134 gives it its own self-row policy.",
  changelog: "Public product history. Deliberately shared.",
  compliance_rules: "Jurisdiction rules — the law does not vary by tenant.",
  markets: "The market list. Shared by definition.",
  live_status: "The company-wide singleton 0282/0285 are migrating away from.",
  admin_emails: "The owner allowlist. Company-level, owner-read-only (0280).",
  profiles: "Carries tenant_id but is read by auth paths before a tenant is known.",
  products: "The public catalogue. Read by guest checkout before any session exists.",
  stops: "The public schedule. The storefront shows it logged out.",
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "route.ts" || name === "route.tsx") out.push(p);
  }
  return out;
}

const scoped = tenantScopedTables();
const files = walk(API);

let accesses = 0, findings = [], exemptCount = 0, globalCount = 0, filteredCount = 0, ownerScopedCount = 0, insertCount = 0, declaredCount = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!/supabaseAdmin/.test(src)) continue;

  const rel = relative(join(ROOT, "app", "api"), file).replace(/\/route\.tsx?$/, "");
  const exemptReason = Object.entries(EXEMPT_ROUTES).find(([k]) => rel === k || rel.startsWith(k + "/"))?.[1];

  // Every supabaseAdmin.from("table") in the file, with the chained calls that follow it.
  for (const m of src.matchAll(/supabaseAdmin[\s\S]{0,40}?\.from\(\s*["'`](\w+)["'`]\s*\)([\s\S]{0,400})/g)) {
    const table = m[1];
    const chain = m[2].split(/\n\s*\n/)[0];
    accesses++;

    if (GLOBAL_TABLES[table]) { globalCount++; continue; }
    if (!scoped.has(table)) continue;               // table has no tenant to filter on
    if (exemptReason) { exemptCount++; continue; }

    // THREE OUTCOMES, not two. The first version of this script counted every access that did not
    // name tenant_id as a finding and reported 103 of them. Most were ownership-checked —
    // .eq("id", id).eq("user_id", userId) is not a hole, it is the correct pattern — and a gate that
    // reports 103 problems when it has found a handful is a gate everyone learns to ignore.
    // An INSERT is not a cross-tenant read, and it is not unscoped either: 0134 put a
    // stamp_tenant() BEFORE INSERT trigger on every tenant_id table, so the tenant is written by the
    // database from the caller's own profile whatever the route does. That trigger is exactly the
    // thing that closed plan step 1 of R-002, so counting inserts here would be double-counting it.
    if (/\.insert\(|\.upsert\(/.test(chain)) { insertCount++; continue; }

    // A route can state its own proof. Some accesses are safe because of a check two statements
    // earlier — subscriptions/manage looks up the caller's own square_subscription_id and then
    // updates BY that id — and no regex can see that. A `// scoped-by:` comment on the line above
    // says why, in the code, where the next person to read it needs it. Same rule as the exemption
    // list: a marker with no reason after it does not count.
    const before = src.slice(0, m.index).split("\n").slice(-4).join("\n");
    const declared = /\/\/\s*scoped-by:\s*\S.{10,}/.test(before);
    if (declared) { declaredCount++; continue; }

    const filtersTenant = /tenant_id/.test(chain);
    const filtersOwner = /\.eq\(\s*["'`](user_id|owner_id|created_by|approver_id|operator_user_id|candidate_user_id)["'`]/.test(chain)
      || /\b(user_id|created_by)\s*:/.test(chain);          // an insert that stamps the caller
    const byId = /\.eq\(\s*["'`]id["'`]/.test(chain);

    if (filtersTenant) { filteredCount++; continue; }
    if (filtersOwner) { ownerScopedCount++; continue; }

    findings.push({ route: rel, table, byId, chain: chain.replace(/\s+/g, " ").slice(0, 90) });
  }
}

const byRoute = new Map();
for (const f of findings) {
  if (!byRoute.has(f.route)) byRoute.set(f.route, []);
  byRoute.get(f.route).push(f);
}

console.log(`SERVICE-ROLE AUDIT (R-002)`);
console.log(`  tenant-scoped tables known: ${scoped.size}`);
console.log(`  supabaseAdmin table accesses: ${accesses}`);
console.log(`  · on global tables (no tenant to filter): ${globalCount}`);
console.log(`  · in declared-exempt routes: ${exemptCount}`);
console.log(`  · already filtering by tenant_id: ${filteredCount}`);
console.log(`  · scoped to the caller's own rows (user_id and friends): ${ownerScopedCount}`);
console.log(`  · inserts, tenant stamped by the 0134 trigger: ${insertCount}`);
console.log(`  · scoping proved inline with // scoped-by: ${declaredCount}`);
console.log(`  · UNSCOPED on tenant data: ${findings.length} across ${byRoute.size} route(s)`);

if (findings.length) {
  console.log("");
  for (const [route, fs] of [...byRoute.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const keyed = fs.filter((f) => f.byId).length;
    console.log(`  ${route}  —  ${fs.length} access(es)${keyed ? `, ${keyed} keyed by an id` : ""}`);
    for (const f of fs.slice(0, 6)) console.log(`      ${f.table}${f.byId ? "  (by id)" : ""}`);
    if (fs.length > 6) console.log(`      … and ${fs.length - 6} more`);
  }
  console.log("");
  console.log("  These neither filter by tenant nor by the caller's own rows. An access keyed only by");
  console.log("  an id is narrower than a table scan, but the id still has to be PROVEN to belong to");
  console.log("  the caller rather than assumed — that is the IDOR shape, and it does not need a");
  console.log("  second tenant to bite.");
}

// ── the ratchet ─────────────────────────────────────────────────────────────────────────────────
// R-002's remaining exposure is latent: every finding below is a staff-gated route reading business
// data, on a platform with exactly one tenant. Demanding it reach zero before anything else ships
// would be theatre. Demanding it never gets WORSE is not, so this is a ratchet: the baseline is
// recorded, the build fails if the number grows, and lowering it lowers the baseline.
const BASELINE = 21;   // measured 2026-09-06 — all staff-gated agent reads, latent while single-tenant. Lower it, never raise it.
                       // 63 → 62: the brew route's raw inventory_ledger insert became one RPC call (0294),
                       // which is tenant- and market-scoped inside the function instead of out here.

const over = findings.length - BASELINE;
if (over > 0) {
  console.log("");
  console.log(`  RATCHET: ${over} more than the recorded baseline of ${BASELINE}. Scope the new`);
  console.log("  access by tenant or by the caller's own rows, or declare it exempt with a reason.");
  process.exit(1);
}
if (findings.length < BASELINE) {
  console.log("");
  console.log(`  ${BASELINE - findings.length} fewer than the baseline. Lower BASELINE in this file to lock the gain in.`);
}
