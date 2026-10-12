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
  // lib/webhookSignature.ts (2026-10-11): the same signed-webhook checks, in one home — a route that calls one of
  // these verifies its sender and answers 401 when it fails (scripts/webhooks.test.mjs runs each route).
  /\b(?:square|svix|stripe|apliiq)SignatureOk\(/, /\btokenOk\(/,
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

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

export function classify(src) {
  // Comments first, so a guard named in prose does not count as a guard — the trap three gates
  // in scripts/smoke.cjs fell into on 2026-09-30.
  const code = stripComments(src);
  const guarded = GUARDS.some((g) => g.test(code));
  const pub = /^\s*\/\/\s*public:\s*\S.{9,}/m.test(src);
  if (guarded) return "guarded";
  if (pub) return "public";
  return "silent";
}

// THE BOUND (2026-10-02). A public route that WRITES — POST, PUT, PATCH, DELETE — is something
// anyone on the internet can make the app do, as often as they like: mint an alert, take a
// waitlist row, spend the AI budget. It must be bounded in the store every instance shares
// (rate_limit_hit, 0154): in its own code, or in the one file it names with `// bounded-by: <path>`
// that calls it. A module-level counter is "N a minute per warm instance" on serverless and does
// not count; neither does the word in a comment. /api/errors/report had exactly that counter and
// nothing else for four months, and nobody could have told from the outside.
const WRITES = "POST|PUT|PATCH|DELETE";
const CALLS_LIMITER = /\.rpc\(\s*["']rate_limit_hit["']/;
export function boundOf(src, readFile = (p) => readFileSync(join(ROOT, p), "utf8")) {
  const code = stripComments(src);
  const writes = new RegExp(`^export\\s+const\\s+(${WRITES})\\s*=\\s*route\\(`, "m").test(code);
  if (CALLS_LIMITER.test(code)) return { writes, bounded: true, via: "its own code" };
  const named = src.match(/^\s*\/\/\s*bounded-by:\s*(\S+)/m);
  if (named) {
    let other = "";
    try { other = readFile(named[1]); } catch { return { writes, bounded: false, via: `${named[1]} (not found)` }; }
    return CALLS_LIMITER.test(stripComments(other)) ? { writes, bounded: true, via: named[1] } : { writes, bounded: false, via: `${named[1]} (calls no rate_limit_hit)` };
  }
  return { writes, bounded: false, via: null };
}

// ── THE AGENT DOOR (2026-10-12, release 1 item 9) ───────────────────────────────────────────────
// WHY. The strategy session read its open threads and its draft plays across every business on the
// platform, and nothing said so: scripts/service-role.audit.mjs reported 0 unscoped reads. It has
// three blind spots, each found on a real route. (1) It takes the 400 characters after a `.from(`
// as the read's chain, so inside a Promise.all the NEXT line's `.eq("tenant_id", tenant)` counted as
// this read's filter (stratsession's comments and gtm_drafts). (2) Those 400 characters swallow the
// accesses after it, which are then never counted at all. (3) It only matches the literal
// `supabaseAdmin`, so the Chief of Staff's eleven reads through `const db = supabaseAdmin` were
// invisible. And its global-table list calls stops global because the storefront shows them —
// true for a guest, not for an agent whose caller's business is known (stops carry tenant_id and a
// tenant-isolation policy in production, like compliance_rules, which it also calls global).
//
// So every route under app/api/agents/ — which holds every strategy and briefing route: the strategy
// session, the weekly review, the transcript filing and the Chief of Staff — is held to two rules,
// read statement by statement (a chain ends where its expression ends, not 400 characters later):
//   CALLER    the handler's FIRST statement refuses anyone without a role: staffFromRequest,
//             ownerFromRequest or leadershipFromRequest, its false answer returning. A session alone
//             (userFromRequest) or a tenant alone says who is calling, not whether they may.
//   BUSINESS  every service-role read, update or delete — through supabaseAdmin or any name it is
//             given whole — of a relation that carries tenant_id filters by the tenant the route got
//             from tenantFromRequest and refused without, or says why it need not in a `// scoped-by:`
//             line just above (the house idiom, as service-role.audit reads it). A VIEW with no tenant_id
//             (all_tasks) is not global: under the service role it is every business's rows, so it needs
//             the same. A TABLE with no tenant_id column (os_workstreams) is listed, not failed — there is
//             no business to name until the schema gives it one. Inserts are not reads; an RPC scopes
//             itself inside its function.
// Which relations carry tenant_id is production's answer (supabase/schema.columns.json) and which are
// views is too (supabase/schema.security.json) — not a list kept here. The founder digest
// (app/api/cron/digest) briefs as well, but has no caller by design and spans tenants on purpose; it is
// service-role.audit's declared exemption and stays outside this door.
//
// THE DEBT IS A RATCHET. AGENT_DOOR_DEBT below counts, route by route, the reads that do not name the
// business yet. A count may only go down: an unscoped read beyond it fails, and so does a count left
// above what is measured (slack is room for new debt — scripts/design.ratchet.mjs's rule).
export const AGENT_DOOR = "app/api/agents/";
const ROLE_GUARDS = "staffFromRequest|ownerFromRequest|leadershipFromRequest";

// Measured 2026-10-12, after the strategy session, the weekly review, the transcript and the briefing were
// scoped. Nearly all of it is a truck stop — or the compliance rules for one — read by the id the request
// sent: the shape that becomes a cross-business read the day a second business exists. Lower a number when
// you scope one; never raise one.
export const AGENT_DOOR_DEBT = {
  "app/api/agents/brew/route.ts": 2,          // stops ×2, by the stop_id the request sent
  "app/api/agents/campaign/route.ts": 1,      // content_items: the approved captions it takes the voice from
  "app/api/agents/dayplan/route.ts": 4,       // stops ×2, events by id, event_schedule_items by owner
  "app/api/agents/eventprep/route.ts": 4,     // stops ×2, compliance_rules ×2
  "app/api/agents/inspection/route.ts": 1,    // compliance_rules — and it resolves no tenant at all
  "app/api/agents/intake/route.ts": 1,        // asset_maintenance, by the asset ids it just read
  "app/api/agents/operator/route.ts": 1,      // compliance_rules
  "app/api/agents/opsplan/route.ts": 2,       // vendors, stops
  "app/api/agents/spaceplan/route.ts": 1,     // stops
  "app/api/agents/troubleshoot/route.ts": 1,  // stops
};

// Comments blanked IN PLACE — same length, newlines kept — so an index in the code is the same index in
// the source and a `// scoped-by:` proof can be found where it was written. Whole-line `//` comments and
// block comments, as stripComments above: a `//` inside a string (a URL) is not a comment.
const blankComments = (src) => {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^[ \t]*\/\/.*$/gm, blank);
};

// A string, a template (with its ${…} expressions, templates inside them too) — skipped as text, so a
// comma or a brace inside one is not structure. Each returns the index of the character that closes it.
function skipQuoted(code, j, q) {
  for (j++; j < code.length; j++) { if (code[j] === "\\") { j++; continue; } if (code[j] === q || code[j] === "\n") return j; }
  return j;
}
function skipTemplate(code, j) {
  for (j++; j < code.length; j++) {
    const c = code[j];
    if (c === "\\") { j++; continue; }
    if (c === "`") return j;
    if (c === "$" && code[j + 1] === "{") j = skipExpression(code, j + 2);
  }
  return j;
}
function skipExpression(code, j) {
  let depth = 0;
  for (; j < code.length; j++) {
    const c = code[j];
    if (c === '"' || c === "'") { j = skipQuoted(code, j, c); continue; }
    if (c === "`") { j = skipTemplate(code, j); continue; }
    if (c === "{") depth++;
    else if (c === "}") { if (depth === 0) return j; depth--; }
  }
  return j;
}

/** Where the expression that starts at `i` ends: a comma or semicolon at its own level, the bracket that
 *  closes what it sits in, or a line break the next line does not continue with `.` or `?.`. */
export function chainEnd(code, i) {
  let depth = 0;
  for (let j = i; j < code.length; j++) {
    const c = code[j];
    if (c === '"' || c === "'") { j = skipQuoted(code, j, c); continue; }
    if (c === "`") { j = skipTemplate(code, j); continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { if (depth === 0) return j; depth--; }
    else if (depth === 0 && (c === "," || c === ";")) return j;
    else if (depth === 0 && c === "\n" && !/^\s*\??\./.test(code.slice(j + 1, j + 400))) return j;
  }
  return code.length;
}

/** Which relations carry tenant_id, which exist at all, and which are views — from production's snapshots. */
export function relationsOf(columns, security) {
  const tenant = new Set(), known = new Set(), views = new Set();
  for (const [name, cols] of Object.entries(columns ?? {})) {
    if (name.startsWith("$") || !Array.isArray(cols)) continue;
    known.add(name);
    if (cols.includes("tenant_id")) tenant.add(name);
  }
  for (const [name, row] of Object.entries(security?.t ?? {})) if (Array.isArray(row) && row[0] === "v") views.add(name);
  return { tenant, known, views };
}

/** The handler route() wraps, and the index just inside its body; null when it cannot be found. */
export function handlerStart(code) {
  const ex = new RegExp(`^export\\s+const\\s+(?:${METHODS})\\s*=\\s*route\\(\\s*["'\`][^"'\`]*["'\`]\\s*,\\s*(\\w+)\\s*\\)`, "m").exec(code);
  if (!ex) return null;
  const decl = new RegExp(`(?:async\\s+)?function\\s+${ex[1]}\\s*\\(|(?:const|let)\\s+${ex[1]}\\s*=\\s*(?:async\\s*)?\\(`).exec(code);
  if (!decl) return null;
  let i = decl.index + decl[0].length, depth = 1;
  for (; i < code.length && depth > 0; i++) { if (code[i] === "(") depth++; else if (code[i] === ")") depth--; }
  const open = code.indexOf("{", i);
  return open < 0 ? null : open + 1;
}

/** THE CALLER RULE: does the handler refuse a caller without a role before it does anything else? */
export function roleCheckOf(src) {
  const code = blankComments(src);
  const start = handlerStart(code);
  if (start === null) return { ok: false, guard: null, why: "no handler exported through route() was found, so what runs first cannot be read" };
  const first = code.slice(start).replace(/^\s+/, "");
  const inline = new RegExp(`^if\\s*\\(\\s*!\\s*\\(\\s*await\\s+(${ROLE_GUARDS})\\(\\s*\\w+\\s*\\)\\s*\\)\\s*\\)\\s*return\\b`).exec(first);
  if (inline) return { ok: true, guard: inline[1] };
  const named = new RegExp(`^(?:const|let)\\s+(\\w+)\\s*=\\s*await\\s+(${ROLE_GUARDS})\\(\\s*\\w+\\s*\\)\\s*;?\\s*if\\s*\\(\\s*!\\s*\\1\\s*\\)\\s*return\\b`).exec(first);
  if (named) return { ok: true, guard: named[2] };
  if (new RegExp(`\\b(?:${ROLE_GUARDS})\\(`).test(code)) return { ok: false, guard: null, why: "checks a role, but not as the handler's first statement — something runs before the refusal" };
  if (/\b(?:userFromRequest|tenantFromRequest)\(/.test(code)) return { ok: false, guard: null, why: "knows who is calling (userFromRequest/tenantFromRequest), not whether they may — that is staffFromRequest or ownerFromRequest" };
  return { ok: false, guard: null, why: "checks no role at all" };
}

/** THE BUSINESS RULE: every service-role table access in a route, and whether it names the caller's business. */
export function agentDoor(src, rel) {
  const code = blankComments(src);
  const t = /(?:const|let)\s+(\w+)\s*=\s*await\s+tenantFromRequest\(\s*\w+\s*\)\s*;?\s*if\s*\(\s*!\s*\1\s*\)\s*return\b/.exec(code);
  const tenant = t ? t[1] : null;
  // supabaseAdmin, and any name it is given whole: `const db = supabaseAdmin;` (the Chief of Staff's).
  const clients = ["supabaseAdmin", ...[...code.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*supabaseAdmin\s*!?\s*;/g)].map((m) => m[1])];
  const at = new RegExp(`\\b(?:${clients.join("|")})\\b\\s*!?\\s*\\.from\\(\\s*(?:(["'\`])(\\w+)\\1|([\\w.$]+))\\s*\\)`, "g");
  const named = tenant && new RegExp(`\\.eq\\(\\s*(["'\`])tenant_id\\1\\s*,\\s*${tenant}\\s*\\)|\\.match\\(\\s*\\{[^}]*\\btenant_id\\s*:\\s*${tenant}\\b`);
  const accesses = [];
  for (const m of code.matchAll(at)) {
    const chain = code.slice(m.index, chainEnd(code, m.index));
    const table = m[2] ?? null;
    const kind = /\.(?:insert|upsert)\(/.test(chain) ? "write" : /\.update\(/.test(chain) ? "update" : /\.delete\(/.test(chain) ? "delete" : "read";
    const line = src.slice(0, m.index).split("\n").length;
    const proven = /\/\/\s*scoped-by:\s*\S.{10,}/.test(src.slice(0, m.index).split("\n").slice(-4).join("\n"));
    let verdict, why = null;
    if (kind === "write") verdict = "write";
    else if (named && named.test(chain)) verdict = "scoped";
    else if (proven) verdict = "proven";
    else if (table && rel.known.has(table) && !rel.tenant.has(table) && !rel.views.has(table)) verdict = "no-tenant-column";
    else {
      verdict = "unscoped";
      why = !table ? `reads a table named by \`${m[3]}\`, with no tenant filter in its chain`
        : rel.views.has(table) && !rel.tenant.has(table) ? "a view with no tenant_id — under the service role it is every business's rows"
        : !rel.known.has(table) ? "a relation production's snapshot does not have yet, read with no tenant filter"
        : tenant ? `carries tenant_id and does not filter by ${tenant}` : "carries tenant_id, and the route resolves no tenant to filter by";
    }
    accesses.push({ table: table ?? `(${m[3]})`, kind, line, verdict, why });
  }
  return { tenant, accesses, unscoped: accesses.filter((a) => a.verdict === "unscoped") };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const list = process.argv.includes("--list");
  const rows = routesUnder().map((p) => { const src = readFileSync(p, "utf8"); return { route: p.slice(ROOT.length + 1), kind: classify(src), bare: unwrapped(src), bound: boundOf(src) }; });
  const by = (k) => rows.filter((r) => r.kind === k);
  if (list) for (const r of rows) console.log(`  ${r.kind.padEnd(8)} ${r.route}${r.bare.length ? `  (unwrapped: ${r.bare.join(", ")})` : ""}${r.kind === "public" && r.bound.writes ? `  (write, bounded by ${r.bound.bounded ? r.bound.via : "NOTHING"})` : ""}`);
  const bare = rows.filter((r) => r.bare.length);
  const unbounded = by("public").filter((r) => r.bound.writes && !r.bound.bounded);
  console.log(`API AUDIT: ${rows.length} route(s) — ${by("guarded").length} guarded, ${by("public").length} public by declaration (${by("public").filter((r) => r.bound.writes).length} of them writes, ${unbounded.length} unbounded), ${by("silent").length} silent; ${bare.length} with a handler outside route()`);
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
  if (unbounded.length) {
    for (const r of unbounded) console.log(`  ✗ ${r.route} — public and writes, with no bound every instance shares${r.bound.via ? ` (bounded-by: ${r.bound.via})` : ""}`);
    console.log(`\n  A public write calls rate_limit_hit (0154) itself —   supabaseAdmin.rpc("rate_limit_hit", { p_bucket, p_window_ms, p_max })   —`);
    console.log(`  or names the one file that does for it:   // bounded-by: lib/errorIntake.ts — <what is counted>`);
    console.log(`  A counter in module scope is per warm instance on serverless; it is not a bound and does not count.`);
    process.exit(1);
  }
  if (rows.length === 0) { console.log("API AUDIT: NOT CHECKED — no routes found under app/api. Treated as a FAILURE."); process.exit(1); }

  // THE AGENT DOOR — the caller rule and the business rule, with the debt held as a ratchet.
  let rel = null;
  try {
    rel = relationsOf(JSON.parse(readFileSync(join(ROOT, "supabase/schema.columns.json"), "utf8")), JSON.parse(readFileSync(join(ROOT, "supabase/schema.security.json"), "utf8")));
  } catch { rel = null; }
  if (!rel || rel.known.size === 0 || rel.views.size === 0) {
    console.log("THE AGENT DOOR: NOT CHECKED — supabase/schema.columns.json or schema.security.json could not be read, so which relations carry tenant_id is unknown. Treated as a FAILURE.");
    process.exit(1);
  }
  const door = rows.filter((r) => r.route.startsWith(AGENT_DOOR)).map((r) => {
    const src = readFileSync(join(ROOT, r.route), "utf8");
    return { route: r.route, role: roleCheckOf(src), ...agentDoor(src, rel) };
  });
  if (door.length === 0) { console.log(`THE AGENT DOOR: NOT CHECKED — no routes found under ${AGENT_DOOR}. Treated as a FAILURE.`); process.exit(1); }
  const all = door.flatMap((d) => d.accesses);
  const count = (v) => all.filter((a) => a.verdict === v).length;
  const noColumn = [...new Set(all.filter((a) => a.verdict === "no-tenant-column").map((a) => a.table))].sort();
  const debtTotal = Object.values(AGENT_DOOR_DEBT).reduce((s, n) => s + n, 0);
  console.log(`THE AGENT DOOR: ${door.length} route(s) under ${AGENT_DOOR} — ${door.filter((d) => d.role.ok).length} refuse a caller without a role first; ` +
    `${all.length - count("write")} service-role read(s), update(s) and delete(s): ${count("scoped")} name the business, ${count("proven")} prove it with // scoped-by:, ` +
    `${count("no-tenant-column")} read a table with no tenant_id (${noColumn.join(", ") || "none"}), ${count("unscoped")} do not (debt ${debtTotal}, only down)`);
  if (list) {
    for (const d of door) {
      console.log(`  ${d.role.ok ? "role " + d.role.guard : "NO ROLE"} · tenant ${d.tenant ?? "—"} · ${d.route}`);
      for (const a of d.accesses.filter((x) => x.verdict !== "scoped" && x.verdict !== "write")) console.log(`      ${String(a.line).padStart(4)} ${a.verdict.padEnd(16)} ${a.table}${a.why ? ` — ${a.why}` : ""}`);
    }
  }
  const noRole = door.filter((d) => !d.role.ok);
  const over = door.filter((d) => d.unscoped.length > (AGENT_DOOR_DEBT[d.route] ?? 0));
  const slack = door.filter((d) => d.unscoped.length < (AGENT_DOOR_DEBT[d.route] ?? 0));
  const gone = Object.keys(AGENT_DOOR_DEBT).filter((k) => !door.some((d) => d.route === k));
  if (noRole.length) {
    for (const d of noRole) console.log(`  ✗ ${d.route} — ${d.role.why}`);
    console.log(`\n  An agent acts for a signed-in person through the model and the service role. Its handler's first statement`);
    console.log(`  refuses anyone without a role:   if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });`);
    process.exit(1);
  }
  if (over.length) {
    for (const d of over) {
      console.log(`  ✗ ${d.route} — ${d.unscoped.length} read(s) that do not name the business, the debt allows ${AGENT_DOOR_DEBT[d.route] ?? 0}:`);
      for (const a of d.unscoped) console.log(`      line ${a.line}: ${a.table} — ${a.why}`);
    }
    console.log(`\n  Resolve the tenant once —   const tenant = await tenantFromRequest(req); if (!tenant) return …401   — and filter`);
    console.log(`  every read by it:   .eq("tenant_id", tenant)   — or, where a read is narrower than that by construction (an id this`);
    console.log(`  request's own tenant-filtered read returned), say so on the line above:   // scoped-by: <why>`);
    process.exit(1);
  }
  if (slack.length || gone.length) {
    for (const d of slack) console.log(`  ✗ ${d.route} — ${d.unscoped.length} unscoped now, the debt says ${AGENT_DOOR_DEBT[d.route]}. Good; now LOWER it to ${d.unscoped.length} in AGENT_DOOR_DEBT${d.unscoped.length === 0 ? " (remove the line)" : ""} — slack is room for new debt.`);
    for (const k of gone) console.log(`  ✗ ${k} — in AGENT_DOOR_DEBT but no such route under ${AGENT_DOOR}. Remove the line.`);
    process.exit(1);
  }
  console.log("API AUDIT: every route is guarded or says why it is not, every public write is bounded in the shared store, every handler leaves through route(), and every agent refuses a caller without a role and names the business on its reads, less the recorded debt — clean.");
}
