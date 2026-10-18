// R32 — EVERY DOOR ASKS WHO IS CALLING (2026-10-18 — the fresh 10/10 audit at R31: API11-01, API11-03, API11-04, SEC11-02,
// SEC11-03, DB11-04, OPS11-03). The database's half (0437) is run in scripts/db.r32.test.mjs; the card pause's rules in
// scripts/r29.test.mjs (R32 rewrote them: the caller's pause, never everyone's). Here, read from the files and run where a
// file runs alone:
//   1 · a route the crew may call writes no table the database keeps to owners and admins — unless it asks the owner's
//       or admin's question first (the snapshot's own policies, read for each table a route writes);
//   2 · the AI doors that write — a plan's stops and events, a pick list, a session, the week's review, a note's
//       follow-ups, the shop's products — ask adminFromRequest, and the screen offers them to owners and admins;
//   3 · a stranger can't raise a critical: a card entry that isn't one never reaches Square (and a refusal of the entry
//       is the entry's, not "check the access token"); a webhook signature that fails tells the crew only when it can't
//       be a forgery;
//   4 · a link the AI or a note writes can't leave the app through a backslash;
//   5 · the paste file runs each migration as its own transaction, and the gates still read each section as its file.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { libLoader } from "./fixtures/chargeonce.mjs";
import { pendingMigrations } from "./columns.audit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

// ── 1 · the crew's routes write nothing the database keeps to owners and admins ────────────────────────────────────
// The production snapshot's policies (supabase/schema.security.json — t: each table's policies, x: their expressions):
// a table and command whose every permissive policy is `(SELECT is_admin())` or `(SELECT is_owner())` is an owner's or
// admin's write. A route gated by staffFromRequest that writes one with the server's key must ask adminFromRequest or
// ownerFromRequest too — or be named below, with why.
const snap = JSON.parse(read("supabase/schema.security.json"));
const isGate = (i) => i !== null && i !== undefined && /^\(\s*SELECT\s+(public\.)?is_(admin|owner)\(\)\s+AS\s+is_(admin|owner)\)$/i.test(String(snap.x[i]).trim());
const adminOnly = (table, cmd) => {
  const pols = (snap.t[table]?.[7] || []).filter((p) => p[2] && (p[1] === cmd || p[1] === "*"));
  return pols.length > 0 && pols.every((p) => (cmd === "a" ? isGate(p[5] ?? p[4]) : isGate(p[4]) && (p[5] == null || isGate(p[5]))));
};
const walk = (d) => readdirSync(join(ROOT, d)).flatMap((n) => { const p = join(d, n); return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p]; });
const OP = { insert: ["a"], update: ["w"], upsert: ["a", "w"], delete: ["d"] };
const WAIVED = {
  // Research proposes rules, inactive and unverified, for an owner or admin to approve — a proposal moves nothing.
  "app/api/agents/inspection/route.ts": "compliance_rules are written inactive and unverified — an owner's or admin's to approve",
};
const crewWrites = [];
for (const f of walk("app/api").filter((f) => f.endsWith("route.ts"))) {
  const src = code(read(f));
  if (!/\bstaffFromRequest\(/.test(src) || /\b(adminFromRequest|ownerFromRequest)\(/.test(src) || WAIVED[f]) continue;
  const hits = [];
  for (const m of src.matchAll(/supabaseAdmin!?\s*\.from\("(\w+)"\)\s*\.(insert|update|upsert|delete)\(/g))
    for (const c of OP[m[2]]) if (adminOnly(m[1], c)) hits.push(`${m[1]}.${m[2]}`);
  if (hits.length) crewWrites.push(`${f}: ${[...new Set(hits)].join(", ")}`);
}
ok("no route the crew may call writes a table the database keeps to owners and admins without asking the owner's or admin's question",
  crewWrites.length === 0, crewWrites);
ok("…the rule reads the snapshot: a stop, an event and a shop product are owners' and admins' writes there; a meeting note is the crew's",
  adminOnly("stops", "a") && adminOnly("events", "a") && adminOnly("shop_products", "a") && !adminOnly("meeting_notes", "a"));

// ── 2 · the AI doors that write ask the owner's or admin's question ──────────────────────────────────────────────────
{
  const gen = code(read("app/api/agents/event-generate/route.ts"));
  const commitAt = gen.indexOf("if (body.commit) {");
  ok("event-generate: the plan is written only after adminFromRequest — the preview stays the crew's",
    commitAt > 0 && gen.indexOf("if (!(await adminFromRequest(req)))", commitAt) > commitAt
    && gen.indexOf("if (!(await adminFromRequest(req)))", commitAt) < gen.indexOf('supabaseAdmin.from("stops").insert(')
    && /if \(!\(await staffFromRequest\(req\)\)\) return NextResponse\.json\(\{ ok: false, error: "unauthorized" \}, \{ status: 401 \}\);/.test(gen));
  ok("event-generate: what is written is held to the claim guard again, says its business, and is read back",
    gen.indexOf("const held = claimSafeDeep(plan);", commitAt) > commitAt && (gen.match(/tenant_id: tenant,/g) || []).length === 4
    && (gen.match(/wrote\(await supabaseAdmin\.from\("(stops|events|meeting_notes|todos)"\)/g) || []).length === 4
    && /return NextResponse\.json\(\{ ok: false, error: errorMessage\(e, 300\), created \}, \{ status: 500 \}\);/.test(gen));
  for (const [f, words] of [["app/api/agents/eventprep/route.ts", "Only an owner or admin can add to the pick list."],
                            ["app/api/agents/troubleshoot/route.ts", "Only an owner or admin can log this and add its fixes."]]) {
    const c = code(read(f)), at = c.indexOf("if (body.commit) {");
    ok(`${f.split("/").at(-2)}: its commit asks adminFromRequest before it writes`, at > 0
      && c.indexOf(`if (!(await adminFromRequest(req))) return NextResponse.json({ ok: false, error: "${words}" }, { status: 403 });`, at) > at);
  }
  for (const [f, words] of [["app/api/agents/session-extract/route.ts", "Only an owner or admin can file a session."],
                            ["app/api/agents/weekreview/route.ts", "Only an owner or admin can run the week's review."],
                            ["app/api/agents/recap/route.ts", "Only an owner or admin can add a note's follow-ups."]]) {
    const c = code(read(f));
    ok(`${f.split("/").at(-2)}: the whole door is an owner's or admin's (adminFromRequest, 403), never only the crew's`,
      c.includes(`if (!(await adminFromRequest(req))) return NextResponse.json({ ok: false, error: "${words}" }, { status: 403 });`) && !/staffFromRequest/.test(c));
  }
  const imp = code(read("app/api/apliiq/import/route.ts"));
  ok("apliiq/import: bringing products in is an owner's or admin's (the Catalog section is theirs on the screen too)",
    imp.includes('if (!(await adminFromRequest(req))) return NextResponse.json({ error: "Only an owner or admin can bring products in from Apliiq." }, { status: 403 });')
    && !/staffFromRequest/.test(imp) && /\{sec === "catalog" && isAdmin && \(/.test(read("app/crew/page.tsx")));
  ok("a note's Suggest (its follow-ups) is drawn for owners and admins only",
    /\{isAdmin && <button type="button" className="btn-ter ml-auto" onClick=\{suggest\} disabled=\{suggesting\}>/.test(read("app/crew/page.tsx")));
}

// ── 3 · a stranger can't raise a critical ────────────────────────────────────────────────────────────────────────────
const load = libLoader();
const SQ = load("lib/squareServer.ts");
ok("a card entry is a short prefix, a colon and printable characters — a number, an object, an empty one or three hundred characters isn't",
  SQ.sourceShaped("cnon:card-nonce-ok") && SQ.sourceShaped("ccof:GaJGNaZa8x4OgDJn4GB") && !SQ.sourceShaped(12345) && !SQ.sourceShaped({ a: 1 })
  && !SQ.sourceShaped("") && !SQ.sourceShaped("cnon:" + "x".repeat(300)) && !SQ.sourceShaped("no colon here") && !SQ.sourceShaped("cnon:has space"));
{
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return new Response("{}", { status: 500 }); };
  try {
    const r = await SQ.chargeCard({ token: "t", locationId: "L", sourceId: 12345, amountCents: 100, note: "n", idempotencyKey: "k" });
    const r2 = await SQ.chargeCard({ token: "t", locationId: "L", sourceId: "x".repeat(300), amountCents: 100, note: "n", idempotencyKey: "k" });
    ok("chargeCard: what isn't a card entry is told so — and Square is never asked (no critical, no charge)",
      r.ok === false && r.error === SQ.CARD_ENTRY_WORDS && r2.ok === false && calls === 0, { r, r2, calls });
  } finally { globalThis.fetch = realFetch; }
}
ok("a refusal of the card entry itself (Square's source_id field) is the entry's words, not Square's trouble — and counted against nobody",
  SQ.refusalWords(400, { errors: [{ category: "INVALID_REQUEST_ERROR", code: "VALUE_TOO_LONG", field: "source_id" }] }) === SQ.CARD_ENTRY_WORDS
  && SQ.refusalWords(400, { errors: [{ category: "INVALID_REQUEST_ERROR", code: "EXPECTED_STRING", field: "source_id" }] }) === SQ.CARD_ENTRY_WORDS
  && SQ.refusalKind({ errors: [{ category: "INVALID_REQUEST_ERROR", code: "INVALID_VALUE", field: "source_id" }] }) === "token"
  && SQ.refusalWords(401, { errors: [{ category: "AUTHENTICATION_ERROR", code: "UNAUTHORIZED" }] }) === SQ.SQUARE_DOWN_WORDS);
{
  const wh = code(read("app/api/square/webhook/route.ts")), sa = code(read("lib/serverAlerts.ts"));
  ok("Square's webhook: a failed signature tells the crew only when it lasts — three in the hour and none of Square's verified in a day",
    /&& await refusalLasts\("square"\)\) \{\s*await raiseAlertOnce\(\{ severity: "critical", category: "money", kind: "webhook_signature"/.test(wh)
    && /rpc\("rate_limit_hit", \{ p_bucket: `\$\{provider\}:signature-refused`, p_window_ms: 3_600_000, p_max: 2 \}\)/.test(sa)
    && /\.from\("webhook_events"\)\.select\("id", \{ count: "exact", head: true \}\)\s*\.eq\("provider", provider\)\.gte\("received_at", since\);/.test(sa)
    && /return !error && count === 0;/.test(sa) && /return NextResponse\.json\(\{ ok: false \}, \{ status: 401 \}\);/.test(wh));
}

{
  // refusalLasts, run: three refused in the hour (the store's count — false is past the cap) and none of that provider's
  // events verified in a day (the inbox) — then, and only then, true. A store that can't be asked: false.
  const { routeLoader } = await import("./fixtures/moneyWorld.mjs");
  const made = (counts, inboxCount, { rpcThrows = false } = {}) => {
    const asked = [];
    const db = {
      rpc: async (fn, a) => { if (rpcThrows) throw new Error("socket hang up"); asked.push([fn, a.p_bucket]); const n = counts[a.p_bucket] ?? 0; if (n >= a.p_max) return { data: false, error: null }; counts[a.p_bucket] = n + 1; return { data: true, error: null }; },
      from: (t) => { asked.push(["from", t]); const q = { select: () => q, eq: () => q, gte: () => Promise.resolve({ count: inboxCount, error: null }) }; return q; },
    };
    return { asked, A: routeLoader({ "@/lib/supabaseAdmin": { supabaseAdmin: db } })("lib/serverAlerts.ts") };
  };
  const quiet = made({}, 0);
  const tries = [await quiet.A.refusalLasts("square"), await quiet.A.refusalLasts("square"), await quiet.A.refusalLasts("square")];
  ok("refusalLasts: the first two refused in the hour are the log's; the third, with none of Square's verified in a day, lasts",
    JSON.stringify(tries) === "[false,false,true]" && quiet.asked.filter(([k]) => k === "from").length === 1, { tries, asked: quiet.asked });
  const live = made({ "square:signature-refused": 2 }, 1);
  ok("refusalLasts: …but with an event of Square's verified in the last day, the key works — a stranger's posts, not trouble", (await live.A.refusalLasts("square")) === false);
  ok("refusalLasts: a store that can't be asked tells nobody", (await made({}, 0, { rpcThrows: true }).A.refusalLasts("square")) === false);
}

// ── 4 · a link the AI or a note writes stays in the app ─────────────────────────────────────────────────────────────
const P = load("lib/prose.ts");
ok("prose: an internal link is the app's own path — no '//', no backslash anywhere, no space or control character",
  P.isInternalHref("/crew?s=money") && P.isInternalHref("/menu") && !P.isInternalHref("//evil.example") && !P.isInternalHref("/\\evil.example")
  && !P.isInternalHref("/a\\b") && !P.isInternalHref("/\t/evil.example") && !P.isInternalHref("/x\u0001y") && !P.isInternalHref("https://evil.example"));

// ── 5 · the paste file: each migration its own transaction, each section still its file ──────────────────────────────
{
  const paste = read("supabase/APPLY_ALL_PENDING.sql");
  const sections = pendingMigrations(paste);
  const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
  const same = sections && [...sections].every(([num, body]) => {
    const f = files.find((x) => Number(x.slice(0, 4)) === num);
    return f && body.replace(/\s*$/, "") === readFileSync(join(ROOT, "supabase/migrations", f), "utf8").replace(/\s*$/, "");
  });
  ok("APPLY_ALL_PENDING: every section is begin; its migration; commit; — and the gates read each one as its file, verbatim",
    !!sections && sections.size > 0 && same && (paste.match(/^begin;/gm) || []).length === sections.size && (paste.match(/^commit;/gm) || []).length === sections.size
    && /EACH MIGRATION IS ITS OWN TRANSACTION/.test(paste), sections && [...sections.keys()]);
  const gen = read("scripts/migrations.pending.mjs");
  ok("…written so by the generator (npm run migrations:pending -- --write), not by hand",
    /`begin;   -- \$\{m\.file\.slice\(0, 4\)\}, its own transaction/.test(gen) && /`commit;  -- \$\{m\.file\.slice\(0, 4\)\}`/.test(gen));
  ok("0431's and 0435's notes say what a paste holds: the lock to the paste's end (the audit's DB11-04), and 0435 a minute at most",
    /held from its check to the paste's end/.test(read(files.map((f) => `supabase/migrations/${f}`).find((f) => /\/0431_/.test(f))))
    && /set statement_timeout = '60s';/.test(read(files.map((f) => `supabase/migrations/${f}`).find((f) => /\/0435_/.test(f)))));
}

// ── wired ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const pkg = JSON.parse(read("package.json"));
ok("npm test runs this file, and the db tests run db.r32", /node scripts\/r32\.test\.mjs/.test(pkg.scripts.test) && /node scripts\/db\.r32\.test\.mjs/.test(pkg.scripts["db:test"]));

console.log(`\nR32 — EVERY DOOR ASKS WHO IS CALLING: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
