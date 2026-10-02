// API AUDIT — every route under app/api says how it is guarded, or says why it is not; and every
// handler is exported through lib/apiRoute's route(), so a throw is never an HTML 500.
//
//   node scripts/api.audit.mjs          # fail on a route with neither a guard nor a `// public:` line, or a bare handler
//   node scripts/api.audit.mjs --list   # every route, classified
//
// ── WHY (2026-10-02, Ryan: "was the entire backend audited?") ───────────────────────────────────
// Read by hand, all 76 routes were fine: 62 check a session or a signature, 14 are public on
// purpose, and every public one explains itself in prose — "Public by design (guests hit errors
// too)", "public read of active rows", "nothing here isn't already printed on the card". Prose is
// not something the next route can be held to. This is: a route either calls one of the house
// guards in CODE (not a comment), or carries one greppable `// public: <why>` line, or the audit
// fails and names it. Same idiom as `// scoped-by:` and `-- scaffold:` — an exception is allowed,
// silence is not.
//
// The guards are the ones lib/apiAuth.ts and lib/apliiq.ts actually export, plus the two shapes a
// webhook or callback legitimately uses instead of a session: an HMAC/timing-safe compare, and a
// stored one-time state. A route that invents a fourth way to be safe should add it HERE, in one
// place, with the reason — not teach this file to trust a new word by accident.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = join(ROOT, "app/api");

export const GUARDS = [
  /\buserFromRequest\(/, /\bstaffFromRequest\(/, /\bownerFromRequest\(/, /\btenantFromRequest\(/, /\bleadershipFromRequest\(/,
  /\bverifyApliiq\(/,                         // Apliiq webhook signature (lib/apliiq.ts)
  /\btimingSafeEqual\(/, /\bcreateHmac\(/,     // a signed webhook (Stripe/Square shape)
  /\bpending_state\b/,                        // an OAuth callback checking the state it issued
  /process\.env\.[A-Z_]*SECRET[A-Z_]*/,       // a shared-secret token compared on the request
  // NOT here, on purpose: an inline `.auth.getUser(`. app/api/office did that to get the email
  // beside the id; userFromRequest returns both now. A route that re-reads the session by hand is
  // a second copy of lib/apiAuth and this audit names it.
];

export function routesUnder(dir = API) {
  const out = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/^route\.(ts|js)$/.test(n)) out.push(p); } };
  walk(dir);
  return out.sort();
}

// THE WRAPPER. Every handler leaves the file as `export const X = route("name", x)` (lib/apiRoute.ts):
// a throw becomes JSON the caller can read and a row the crew can see. A handler exported any other
// way — `export async function POST`, `export const POST = async …`, `export { x as POST }` — is
// outside the house and this names it. Comments stripped first, same as the guards.
const METHODS = "GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD";
export function unwrapped(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const out = [];
  for (const m of code.matchAll(new RegExp(`^export\\s+(?:async\\s+)?function\\s+(${METHODS})\\b`, "gm"))) out.push(m[1]);
  for (const m of code.matchAll(new RegExp(`^export\\s+const\\s+(${METHODS})\\s*=(?!\\s*route\\()`, "gm"))) out.push(m[1]);
  // an export list naming a method — `export { get as GET }`, `export { GET }` — anywhere on a line
  for (const m of code.matchAll(new RegExp(`\\bexport\\s*\\{[^}]*\\b(${METHODS})\\b[^}]*\\}`, "g"))) out.push(m[1]);
  return out;
}

export function classify(src) {
  // Comments first, so a guard named in prose does not count as a guard — the trap three gates
  // in scripts/smoke.cjs fell into on 2026-09-30.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const guarded = GUARDS.some((g) => g.test(code));
  const pub = /^\s*\/\/\s*public:\s*\S.{9,}/m.test(src);
  if (guarded) return "guarded";
  if (pub) return "public";
  return "silent";
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const list = process.argv.includes("--list");
  const rows = routesUnder().map((p) => { const src = readFileSync(p, "utf8"); return { route: p.slice(ROOT.length + 1), kind: classify(src), bare: unwrapped(src) }; });
  const by = (k) => rows.filter((r) => r.kind === k);
  if (list) for (const r of rows) console.log(`  ${r.kind.padEnd(8)} ${r.route}${r.bare.length ? `  (unwrapped: ${r.bare.join(", ")})` : ""}`);
  const bare = rows.filter((r) => r.bare.length);
  console.log(`API AUDIT: ${rows.length} route(s) — ${by("guarded").length} guarded, ${by("public").length} public by declaration, ${by("silent").length} silent; ${bare.length} with a handler outside route()`);
  if (bare.length) {
    for (const r of bare) console.log(`  ✗ ${r.route} — ${r.bare.join(", ")} exported without lib/apiRoute's route(): a throw here is an HTML 500 nobody sees`);
    console.log(`\n  Every handler is exported as   export const POST = route("<path>", post);   (see lib/apiRoute.ts).`);
    process.exit(1);
  }
  if (by("silent").length) {
    for (const r of by("silent")) console.log(`  ✗ ${r.route} — no guard in code and no "// public: <why>" line`);
    console.log(`\n  A route is either guarded (one of the helpers in lib/apiAuth.ts, a signature check, or a stored`);
    console.log(`  state) or it says, in one line the next person can grep for, why anyone may call it:`);
    console.log(`      // public: read-only menu prices; nothing here a guest cannot already see at the window`);
    process.exit(1);
  }
  if (rows.length === 0) { console.log("API AUDIT: NOT CHECKED — no routes found under app/api. Treated as a FAILURE."); process.exit(1); }
  console.log("API AUDIT: every route is guarded or says why it is not, and every handler leaves through route() — clean.");
}
