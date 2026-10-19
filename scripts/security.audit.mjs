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
// HARD, from a snapshot that carries them (R19 — the 10/10 audit, database F11 and F15):
//   money-key     a unique index the money depends on is not in the database: a payment, a checkout key or a booking
//                 key could be recorded twice. 0238, 0242 and 0244 made theirs only where the rows were already clean
//                 ("create only if clean"), so a migration in the directory never proved one was there (MONEY_KEYS) —
//                 or is there and not valid (a build that failed holds nothing back). One production can't build is
//                 exempted by name, "money-key:<name>", with its reason (R19 review).
//   bucket-caps   a storage bucket the app writes to takes any size or any type — a wildcard of every type is any
//                 (BUCKET_CAPS; 0421, 0423).
//   bucket-private a bucket for what only the crew or the person may see is public (PRIVATE_BUCKETS; R19 review).
// HARD, from a snapshot that carries them (R23 — the 10/10 audit, database F15):
//   definer-path  a SECURITY DEFINER function anon or authenticated may execute that pins no search_path: it runs as its
//                 owner with whatever an earlier schema on the caller's path names the same as what it calls. Every one
//                 of the migrations' is written with one (scripts/db.r23.test.mjs asks the whole schema); a missing one
//                 is said, or exempted by name, "definer-path:<name>(<args>)", with its reason.
//   platform-rls-off  storage.objects or realtime.messages — the platform's own tables, whose rules are every file's and
//                 every private channel's gate — reachable by the API roles with row-level security off.
//   storage-write a permissive storage.objects rule that writes for public or anon: a file written with no session.
//   storage-open-write  …for the signed in, `true` (or absent): any signed-in person writes any file in any bucket.
//   realtime-room a permissive realtime.messages rule for public or anon: a private channel joined with no session.
//   realtime-open-room  …for the signed in, `true`: every private room (the Studio's, 0428) open to anyone signed in.
//                 Each platform rule is exempted by "<table>.<rule name>" with its reason; restrictive rules only narrow.
// Triggers are measured (names and switches, never a definition) and listed with --list: the push webhooks made in the
// dashboard (database F6) are visible there, not yet judged.
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
  // First measured 2026-10-11 (snapshot pulled at ledger 0380). Only ever lower these, in the commit whose snapshot
  // shows fewer; raising one means naming the new member in that commit's message.
  // 2026-10-14, snapshot at ledger 0400: definerExec 162 → 116. 0381's revokes closed 60 (every trigger among them,
  // and the jobs only the cron runs); 0383–0400 opened 14, each granted by name in its migration.
  // 2026-10-16, snapshot at ledger 0408: definerExec 116 → 118 — save_workstream_audit (0405: the Monday audit and its
  // stream saved as one, an owner's or an admin's) and set_eighty_six (0408: the Pass's 86 for one city, the crew's), each
  // granted to authenticated by name and each refusing anyone else inside. Nothing new is callable signed out (anon 14).
  // 2026-10-16, snapshot at ledger 0415: definerExec 118 → 119, anonExec 14 → 15 — order_shared (0413: what an order's
  // shared link opens — its number, where it is, its drinks, what is due — by a key made for sharing, nothing that changes
  // the order and nothing of the card, the tip or refunds; granted to anon and authenticated by name). 0409–0412, 0414 and
  // 0415 redefined functions already counted, and refund_words (0409) is granted to no one.
  // 2026-10-16, snapshot at ledger 0418: definerExec 119 → 121 — four in, two out. In: void_stop_orders (0416: a stop called
  // off voids its open cups one write each, owners and admins inside), use_credit and give_free_cup (0416: the scan
  // screen's two spends keyed per tap, staff inside, never the caller's own card), shop_apliiq_checked (0417: what the crew
  // found at Apliiq, staff inside) — each granted to authenticated by name. Out: spend_credit and redeem_free_cup, now
  // invoker wrappers over the two keyed ones. The refund flag triggers, refund_counts_against and refunds_counted are
  // granted to no one; nothing new is callable signed out (anon 15).
  // 2026-10-16, snapshot at ledger 0421: definerExec 121 → 122 — settle_office_order (0420: the office board's settle, one
  // door — owners and admins inside, the order locked, from a state that still owes only, the invoice made in the same
  // write), granted to authenticated by name. cron_watch, sweep_rate_limits (0419) and reap_stale_pending_subs (0421) are
  // the cron's and granted to no API role; nothing new is callable signed out (anon 15).
  // 2026-10-18, snapshot at ledger 0426: definerExec 122 → 124 — password_not_now (0423: a signed-in person's "Not now"
  // to choosing a password, their own mark and nothing else) and event_totals (0426: the live event's three numbers, the
  // crew's only, on the caller's own tenant), each granted to authenticated by name. confirm_address and
  // set_password_by_hand (0423) answer only an owner in the SQL editor and are granted to no API role; claim_team_invites,
  // take_signup_password and 0423's triggers are granted to no one; promote_to_crew (0299) was counted already. 0425
  // rewrote policies only. Nothing new is callable signed out (anon 15).
  // 2026-10-19, snapshot at ledger 0437: definerExec 124 → 127 — two_step_ok, two_step_state and require_two_step (0433:
  // two-step for owners and admins — the one question is_admin() and is_owner() ask, what the app asks for the caller
  // alone, and the owner's switch, refused inside unless the owner gave their code on this sign-in), each granted to
  // authenticated by name. staff_collect_payment's four-argument door (0432) replaced its three, one for one. ops_alive
  // (0430), rate_limit_peek (0434) and funnel_step_counted (0437) are the server's or a trigger's and granted to no API
  // role. Nothing new is callable signed out (anon 15).
  publicRead: 3,       // tables with a world-readable SELECT policy: live_status, site_copy, stops — the truck's public face
  definerExec: 127,    // SECURITY DEFINER functions the API roles may call (none of them a trigger any more)
  // …and of them, the ones a caller with NO session may call: the anon key every phone carries. Supabase grants anon by
  // name, so this is what is left once each migration has said who keeps a function (0401). First measured on the
  // snapshot at ledger 0401 (2026-10-14): 55 before 0401, 14 after.
  anonExec: 15,
  definerView: 1,      // owner-run views the API roles may read: market_live
};

// ── EXEMPTIONS — in the open, each with its reason; "table" for rls-off, "table.policy" for open-write.
export const EXEMPT = {
  "booking_requests.anyone request":
    "the public booking form (/book) files a request as a guest; every text field is length-capped by booking_len (0008) and nothing is read back without is_admin()",
  "funnel_events.funnel anyone insert":
    "funnel telemetry from guests (0199): funnel and step are CHECK-constrained, session is a 24-char ephemeral token, and only staff can read sums through funnel_counts()",
};

// The unique indexes the money stands on, by name → their table. A payment recorded twice is money counted twice, a
// checkout key twice is a card charged twice.
export const MONEY_KEYS = {
  orders_payment_id_uniq: "orders",                         // 0238 (made only if clean)
  delivery_orders_payment_id_uniq: "delivery_orders",       // 0238 (made only if clean)
  drop_orders_payment_id_uniq: "drop_orders",               // 0242 (made only if clean)
  drop_orders_idempotency_key_uniq: "drop_orders",          // 0244 (made only if clean)
  shop_orders_payment: "shop_orders",                       // the shop's payment
  reserve_claims_key: "reserve_claims",                     // 0400: a reserve's checkout key
  reserve_claims_payment: "reserve_claims",                 // 0400: a reserve's payment
  business_orders_user_key_uidx: "business_orders",         // 0422: an office booking's key
  checkout_claims_pkey: "checkout_claims",                  // 0371: one claim a checkout key
  event_sales_square_payment_id_key: "event_sales",         // 0024: a Square payment mirrored once
  drop_order_changes_charge_payment_id_key: "drop_order_changes",   // 0388: a pack change's charge
};
// The triggers the accounts stand on (the R18 review, fourth pass: 0423's whole answer to an invite claimed by a stranger
// lives in auth.users' triggers, which the snapshot never named — one dropped or switched off would have gone unseen).
// Each with the migration that made it: required by name, and on, in a snapshot pulled at or after that migration by a
// query that reads auth.users' triggers (R19's, from its review's fourth pass). "table.trigger" → migration.
export const ACCOUNT_TRIGGERS = {
  "auth.users.on_auth_user_created": 1,                 // 0001: a profile for every account (handle_new_user)
  "auth.users.on_auth_user_deleted": 353,               // 0353: an account's erasure
  "auth.users.erasure_queues_what_is_outside": 404,     // 0404: …and what is outside the database
  "auth.users.password_waits_for_proof": 423,           // 0423: a password set before the proof
  "auth.users.claim_invites_on_proof": 423,             // 0423: an invite claimed by a proven address
  "auth.users.password_chosen": 423,                    // 0423: a password set takes the mark off
  "profiles.crew_role_takes_signup_password": 423,      // 0423: a sign-up password, as the account becomes crew
};
// The buckets the app writes to, each held to a size and a list of types — lib/bucketTakes' (R18), which r18.test holds
// equal to the migrations' and r19.test holds equal to this.
export const BUCKET_CAPS = ["avatars", "vip", "content", "shop", "brand", "training", "intake", "note-files", "receipts"];
// The buckets that hold what only the crew or the person may see (0088, 0217, 0262, 0292): never public — a public
// bucket serves any file to whoever has its address, whatever the row rules say.
export const PRIVATE_BUCKETS = ["intake", "note-files", "receipts", "vip"];

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
  // R23: whether it pins its search_path — a sixth field, undefined (not checked) in an older snapshot.
  const functions = (snap.f || []).map(([name, args, anon, authenticated, service_role, path]) => ({ name, args, definer: true, exec: { anon, authenticated, service_role }, path }));
  // R19: present only in a snapshot pulled with them (undefined — not checked — in an older one).
  const keys = snap.k ? snap.k.map(([table, name, primary, valid]) => ({ table, name, primary: !!primary, valid: valid !== false })) : undefined;
  const triggers = snap.g ? snap.g.map(([table, name, enabled]) => ({ table, name, enabled: String(enabled ?? "") })) : undefined;
  const buckets = snap.b ? snap.b.map(([id, isPublic, sizeLimit, types]) => ({ id, public: !!isPublic, sizeLimit: sizeLimit ?? null, types: Array.isArray(types) ? types : null })) : undefined;
  // R23 (database F15): the platform's own gates — every file's rules and every private channel's — as t's rows are read.
  let platform;
  if (snap.p) {
    platform = {};
    for (const [name, [rls, force, anon, authenticated, service_role, policies]] of Object.entries(snap.p)) {
      platform[name] = {
        rls, force, priv: { anon: anon || "", authenticated: authenticated || "", service_role: service_role || "" },
        policies: (policies || []).map(([n, c, p, r, q, w]) => ({ n, c, p, r: String(r || "").split(",").filter(Boolean), q: expr(q), w: expr(w) })),
      };
    }
  }
  return { tables, functions, keys, triggers, buckets, platform, ledger: snap.ledger };
}

const isTrue = (x) => x === null || x === undefined || String(x).trim() === "true";
const touches = (rel, roles = API_ROLES) => roles.some((r) => (rel.priv?.[r] || "").length > 0);
const forApi = (pol) => (pol.r || []).some((r) => r === "public" || API_ROLES.includes(r));

/** The verdict on one snapshot. Pure. */
export function judge(snapshot, exempt = EXEMPT, { moneyKeys = MONEY_KEYS, bucketCaps = BUCKET_CAPS, privateBuckets = PRIVATE_BUCKETS, accountTriggers = ACCOUNT_TRIGGERS } = {}) {
  const snap = snapshot.t ? expand(snapshot) : snapshot;   // compact (the committed shape) or already expanded
  const hard = [], publicRead = [], definerExec = [], anonExec = [], definerView = [], info = { serviceOnly: 0, failClosed: 0, tables: 0, views: 0 };
  // The money's keys and the buckets' caps — judged only when the snapshot measured them (R19).
  if (snap.keys) {
    for (const [name, table] of Object.entries(moneyKeys)) {
      // A key production can't build (rows already doubled) is named here with its reason — never a gate red for good.
      const why = exempt[`money-key:${name}`];
      if (why !== undefined) { if (!String(why).trim()) hard.push(`money-key:${name}: exempt with NO reason`); continue; }
      const k = snap.keys.find((x) => x.name === name && x.table === table);
      if (!k) hard.push(`money-key: ${name} on ${table} is not in the database — a payment or a checkout key there could be recorded twice`);
      else if (!k.valid) hard.push(`money-key: ${name} on ${table} is there but not valid (a build that failed) — it holds nothing back`);
    }
  }
  if (snap.buckets) {
    for (const id of bucketCaps) {
      const b = snap.buckets.find((x) => x.id === id);
      if (!b) continue;   // a bucket not made in this project: nothing to cap
      const anySize = !(Number(b.sizeLimit) > 0);
      const anyType = !(b.types && b.types.length) || b.types.some((t) => /^\*(\/\*)?$/.test(String(t)));   // R19 review: every type is any
      if (anySize || anyType) hard.push(`bucket-caps: ${id} takes ${anySize ? "any size" : ""}${anySize && anyType ? " and " : ""}${anyType ? "any type" : ""}`);
    }
    for (const id of privateBuckets) {
      const b = snap.buckets.find((x) => x.id === id);
      if (b?.public) hard.push(`bucket-private: ${id} is public — any of its files is served to whoever has its address`);
    }
  }
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
    if (fn.definer && fn.exec?.anon) anonExec.push(`${fn.name}(${fn.args || ""})`);
    // R23: one that runs as its owner for a caller, with no search_path of its own, runs whatever an earlier schema on
    // the caller's path names the same — every one of this house's is written with one; a missing one is said.
    if (fn.definer && fn.path === false && API_ROLES.some((r) => fn.exec?.[r])) {
      const key = `definer-path:${fn.name}(${fn.args || ""})`;
      if (key in exempt) { if (!String(exempt[key]).trim()) hard.push(`${key}: exempt with NO reason`); }
      else hard.push(`definer-path: ${fn.name}(${fn.args || ""}) runs as its owner for the API roles with no search_path pinned`);
    }
  }
  // R23 (database F15): the platform's gates. Every file's rules (storage.objects): nobody without a session writes,
  // and no write is `true` for whoever is signed in. Every private channel's (realtime.messages, 0428): a room is for the
  // signed in, and never `true` — a rule that reads nothing lets anyone with a session into every room.
  info.platform = snap.platform ? Object.keys(snap.platform).length : null;
  for (const [name, rel] of Object.entries(snap.platform || {})) {
    const reachable = touches(rel);
    if (reachable && !rel.rls) hard.push(`platform-rls-off: ${name} — row-level security is off and ${API_ROLES.filter((r) => rel.priv?.[r]).map((r) => `${r} may ${rel.priv[r]}`).join(", ")}`);
    for (const pol of rel.policies || []) {
      if (!pol.p || !forApi(pol)) continue;
      const key = `${name}.${pol.n}`;
      if (key in exempt) { if (!String(exempt[key]).trim()) hard.push(`${key}: exempt with NO reason`); continue; }
      const write = pol.c === "a" || pol.c === "w" || pol.c === "d" || pol.c === "*";
      const anyone = pol.r.includes("public") || pol.r.includes("anon");
      const open = isTrue(pol.q) && isTrue(pol.w);
      if (name === "storage.objects" && write && anyone) hard.push(`storage-write: ${name} — policy "${pol.n}" (${CMD[pol.c]}) is for ${pol.r.join("/")}: a file written by someone with no session`);
      else if (name === "storage.objects" && write && open) hard.push(`storage-open-write: ${name} — policy "${pol.n}" (${CMD[pol.c]}) is \`true\`: any signed-in person writes any file`);
      if (name === "realtime.messages" && anyone) hard.push(`realtime-room: ${name} — policy "${pol.n}" (${CMD[pol.c]}) is for ${pol.r.join("/")}: a private room joined with no session`);
      else if (name === "realtime.messages" && open) hard.push(`realtime-open-room: ${name} — policy "${pol.n}" (${CMD[pol.c]}) is \`true\`: every private room open to anyone signed in`);
    }
  }
  info.keys = snap.keys ? snap.keys.length : null;
  info.triggers = snap.triggers ? snap.triggers.filter((t) => !t.table.startsWith("auth.")).length : null;
  // The accounts' triggers (fourth pass) — judged only where the snapshot read auth.users' (it always has some: 0001's).
  info.accountTriggers = null;
  if (snap.triggers && snap.triggers.some((t) => t.table.startsWith("auth."))) {
    const mark = Number(snap.ledger?.max_seq);
    info.accountTriggers = 0;
    for (const [key, from] of Object.entries(accountTriggers)) {
      if (!(Number.isFinite(mark) && mark >= from)) continue;   // its migration is not applied in this snapshot
      const dot = key.lastIndexOf("."), table = key.slice(0, dot), name = key.slice(dot + 1);
      const why = exempt[`account-trigger:${key}`];
      if (why !== undefined) { if (!String(why).trim()) hard.push(`account-trigger:${key}: exempt with NO reason`); continue; }
      const t = snap.triggers.find((x) => x.table === table && x.name === name);
      if (!t) hard.push(`account-trigger: ${name} on ${table} is not there — ${String(from).padStart(4, "0")} made it, and the accounts stand on it`);
      else if (t.enabled === "D") hard.push(`account-trigger: ${name} on ${table} is switched off — it holds nothing back`);
      else info.accountTriggers++;
    }
  }
  info.buckets = snap.buckets ? snap.buckets.length : null;
  return { hard, publicRead: [...new Set(publicRead)].sort(), definerExec: definerExec.sort(), anonExec: anonExec.sort(), definerView: definerView.sort(), info, triggers: snap.triggers };
}

// What the snapshot measures, as a migration would change it: policies, grants, RLS, definer functions and views — and
// since R19 the unique keys the money stands on, the buckets' caps and the triggers (the R19 review, third pass: a
// migration that dropped a money key, opened a bucket or dropped a trigger left the old snapshot judging as current).
const MEASURED = new RegExp([
  String.raw`\b(create|alter|drop)\s+policy\b`, String.raw`\b(grant|revoke)\b`, String.raw`row\s+level\s+security`,
  String.raw`security\s+definer`, String.raw`security_invoker`,
  String.raw`\bcreate\s+unique\s+index\b`, String.raw`\bdrop\s+index\b`, String.raw`\bunique\s*\(`, String.raw`\bdrop\s+constraint\b`, String.raw`\bstorage\.buckets\b`,
  String.raw`\b(create|drop)\s+(or\s+replace\s+)?(constraint\s+)?trigger\b`, String.raw`\b(enable|disable)\s+trigger\b`,
].join("|"), "i");

/** Migrations above the snapshot's high-water mark that touch what it measures. Pure over the list. */
export function staleBecause(snap, files) {
  const mark = Number(snap?.ledger?.max_seq);
  if (!Number.isFinite(mark)) return ["the snapshot carries no ledger mark"];
  const out = [];
  for (const { file, text } of files) {
    const seq = Number(file.slice(0, 4));
    if (!(seq > mark)) continue;
    const code = text.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (MEASURED.test(code)) out.push(file);
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
    console.log(`SECURITY AUDIT: NOT CHECKED — ${stale.length} migration(s) above the snapshot's mark change policies, grants, RLS, unique keys, buckets or triggers: ${stale.join(", ")}.`);
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
  // R19: the money's keys, the buckets' caps and the triggers — from a snapshot that measured them.
  // Said without the headline's words: verify.prod reads "SECURITY AUDIT: NOT CHECKED" at a line's start as the whole
  // audit unread, and this one is a part of it, the rest judged (R19 review).
  if (v.info.keys === null) console.log("  · the money's unique keys, the buckets' caps and the triggers: not measured by this snapshot (pulled before R19's query) — re-pull it (steps above) and they are judged");
  else {
    if (!v.hard.some((h) => h.startsWith("money-key"))) console.log(`  ✓ every unique key the money stands on is there (${Object.keys(MONEY_KEYS).length}, of ${v.info.keys} unique indexes)`);
    if (!v.hard.some((h) => h.startsWith("bucket-caps"))) console.log(`  ✓ every bucket the app writes to has a size and a list of types (${v.info.buckets} bucket(s))`);
    if (!v.hard.some((h) => h.startsWith("bucket-private"))) console.log(`  ✓ the private buckets are private (${PRIVATE_BUCKETS.join(", ")})`);
    if (v.info.accountTriggers === null) console.log("  · the accounts' triggers (auth.users): not measured by this snapshot (pulled before the query read them) — re-pull it and they are judged");
    else if (!v.hard.some((h) => h.startsWith("account-trigger"))) console.log(`  ✓ every trigger the accounts stand on is there and on (${v.info.accountTriggers} of those this snapshot's migrations made)`);
    console.log(`  · ${v.info.triggers} trigger(s) on public tables${list ? ":" : " (--list names them)"}`);
    if (list) for (const t of v.triggers) console.log(`      ${t.table}.${t.name}${t.enabled === "D" ? " (disabled)" : ""}`);
  }
  // R23: the platform's gates and the definers' search_path — judged when the snapshot measured them.
  if (v.info.platform === null) console.log("  · the files' rules (storage.objects), the private channels' (realtime.messages) and the definers' search_path: not measured by this snapshot (pulled before R23's query) — re-pull it and they are judged");
  else {
    if (!v.hard.some((h) => /^(platform-rls-off|storage-|realtime-)/.test(h))) console.log(`  ✓ nobody without a session writes a file, no file write is \`true\`, and every private channel's rule is for the signed in and reads something (${v.info.platform} platform table(s))`);
    if (!v.hard.some((h) => h.startsWith("definer-path"))) console.log("  ✓ every definer function the API roles may call pins its search_path");
  }
  ratchet("tables readable by the world (SELECT `true`)", v.publicRead, CEILING.publicRead);
  ratchet("SECURITY DEFINER functions the API roles may call", v.definerExec, CEILING.definerExec);
  ratchet("…of them, callable with no session (anon)", v.anonExec, CEILING.anonExec);
  ratchet("owner-run views the API roles may read", v.definerView, CEILING.definerView);
  if (fails) { console.log(`\nSECURITY AUDIT: ${fails} failure(s).`); process.exit(1); }
  console.log("\nSECURITY AUDIT: clean.");
}
