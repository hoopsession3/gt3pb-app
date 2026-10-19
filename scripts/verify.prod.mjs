// VERIFY PRODUCTION — the half of "npm run verify" that only exists after the push.
//
//   npm run verify:prod                  # against https://app.gt3pb.com
//   npm run verify:prod -- --wait=900    # first wait up to 900s for production to report THIS commit (CI, after a push)
//   npm run verify:prod -- --quick       # LIVE + CURRENT + POSTURE + ANSWERS only — no browser (the half-hourly health check)
//   GT3_APP_URL=https://… npm run verify:prod
//
// ── WHY (2026-10-02) ───────────────────────────────────────────────────────────────────────────
// `npm run verify` runs against a build with no database (no secrets in that environment, by
// design), so what it measures on a data-driven route is the EMPTY state: /primal with no lessons,
// /delivery with no zones, /driver with no masthead. The first time every public route was
// measured on production instead, 7 of 23 came back different — not worse, different: a populated
// lesson card is a box the empty page never had. The smoke's own header has said since it was
// written that "the authed page is verified by the prod deploy". This is that verification, as a
// script, so it stops being a thing one person does by hand after every push and starts being a
// thing that fails.
//
// Five checks, in the order a deploy goes wrong:
//   1. LIVE      — /api/health reports the commit this tree is at (Vercel finished, and built main)
//   2. CURRENT   — /api/migrations holds every file in supabase/migrations (nothing pending, no gap)
//   2b. POSTURE  — the committed security snapshot (RLS, grants, policies) judged by security.audit
//   2c. PUSH     — the push function deployed is this tree's (its PUSH_VERSION; R21)
//   3. ANSWERS   — a handful of routes, with and without a session, answer JSON — never Next's HTML
//                  500 page (lib/apiRoute.ts is what makes this true; this is what checks it); the
//                  front door (proxy.ts) sends a known guest from "/" to /truck; and the API lets the
//                  iPhone app's origin in, and no other site (next.config.ts appCors)
//   4. PAINTED   — every public route at phone width, with real data: box depth, tap, text, what
//                  moved after paint, axe — against PROD_ROUTE and SHIFT in scripts/design.ratchet.mjs
//
// It needs the network and a finished deploy, so it is NOT in `npm run verify` and it is not a
// build gate: it is the post-deploy gate, and it exits 1 like one. .github/workflows/production.yml
// runs it after every push to main (with --wait, since Vercel builds after GitHub sees the push),
// every half hour with --quick, and in full once a day — so a deploy that lands wrong, or a
// production that drifts between deploys, is a red run in the owner's inbox and not a complaint.
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { MEASURE, OBSERVE } from "./design.measure.mjs";
import { PROD_ROUTE, routeVerdict } from "./design.ratchet.mjs";
import { heldMigrations, migrationFiles, pendingFrom, readLedger } from "./migrations.pending.mjs";

const require = createRequire(import.meta.url);
const APP = (process.env.GT3_APP_URL || "https://app.gt3pb.com").replace(/\/$/, "");
const QUICK = process.argv.includes("--quick");
const WAIT = Number((process.argv.find((a) => a.startsWith("--wait=")) || "--wait=0").slice(7)) || 0;
const CHROME = [process.env.PW_CHROME, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].filter(Boolean);

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` → ${detail}` : ""}`); } };
// NO ANSWER IS AN ANSWER THIS NAMES (R40 — the fresh audit's OPS11-13). A refused connection or a timeout threw, at the
// top level: the run ended in a stack trace — "TimeoutError: The operation was aborted" — never "✗ live: /api/health
// answers ok", and the checks after it never printed. It answers status 0 with why now, and each check says so.
const json = async (path, init) => {
  let res;
  try {
    res = await fetch(APP + path, { ...init, headers: { "cache-control": "no-cache", ...(init?.headers || {}) }, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    const why = e?.name === "TimeoutError" ? "no answer in 20 s" : `no answer (${String(e?.cause?.code || e?.message || e).slice(0, 80)})`;
    return { status: 0, type: "", body: null, location: "", allow: "", error: why };
  }
  const type = res.headers.get("content-type") || "";
  let body = null; try { body = type.includes("json") ? await res.json() : await res.text(); } catch { /* keep null */ }
  return { status: res.status, type, body, location: res.headers.get("location") || "", allow: res.headers.get("access-control-allow-origin") || "" };
};
/** What a check says it got: the status, or why there was none. */
const said = (r) => (r.status ? `HTTP ${r.status}` : r.error || "no answer");

// ── 1. LIVE ─────────────────────────────────────────────────────────────────────────────────────
console.log(`VERIFY PRODUCTION — ${APP}`);
let head = "";
try { head = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { /* not a checkout */ }
const same = (a, b) => !!a && !!b && (a.startsWith(b.slice(0, 7)) || b.startsWith(a.slice(0, 7)));
// The scheduled check names itself when it can (R19, operations F6): only a check carrying HEALTH_PROBE_SECRET feeds the
// watchdog once the site has it set. A value read from the environment, never written down here.
const PROBE = process.env.HEALTH_PROBE_SECRET?.trim() ? { headers: { "x-health-probe": process.env.HEALTH_PROBE_SECRET.trim() } } : undefined;
let health = await json("/api/health", PROBE);
// --wait: a push reaches GitHub before Vercel has built it. Poll until production reports this
// commit, then judge. A deploy that never lands is a failure of this check, not a skipped one.
if (WAIT > 0 && head) {
  const until = Date.now() + WAIT * 1000;
  while (!same(health.body?.build?.commitShort || "", head) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 15000));
    try { health = await json("/api/health", PROBE); } catch { /* keep polling */ }
  }
  console.log(`  · waited for production to report ${head}: ${same(health.body?.build?.commitShort || "", head) ? "it does" : `still ${health.body?.build?.commitShort || "?"} after ${WAIT}s`}`);
}
const built = health.body?.build?.commitShort || "";
ok(`live: /api/health answers ok`, health.status === 200 && health.body?.ok === true, said(health));
// Not taken as the probe: the site's HEALTH_PROBE_SECRET and this check's differ, or the site has one and this check
// none — either way the watchdog is starving in silence (R19 review). Said plainly — which two to set the same — never as
// a pass. Judged where it means something (the third pass): a run that sent a secret, and the scheduled check (GitHub
// Actions), which must carry it. A run by hand with no secret in its environment was never the probe: said, not failed —
// or every release check run from a laptop would fail the day the site was given one.
if (health.status === 200) {
  const scheduled = process.env.GITHUB_ACTIONS === "true";
  if (typeof health.body?.probe !== "boolean") console.log("  · probe: production's build doesn't say whether this check is its probe (built before R19) — not judged");
  else if (health.body.probe === true || PROBE || scheduled) ok("live: this check is the site's probe — the watchdog is fed by it (HEALTH_PROBE_SECRET the same in GitHub and in Vercel)",
    health.body.probe === true, PROBE ? "probe: false — set the repository secret and the Vercel variable HEALTH_PROBE_SECRET to the same value"
      : "probe: false — the site has HEALTH_PROBE_SECRET and this check sent none: set the repository secret of that name (GitHub first, then Vercel, then redeploy)");
  else console.log("  · probe: the site has HEALTH_PROBE_SECRET and this run sent none — not judged by hand (the scheduled check carries it; set HEALTH_PROBE_SECRET here to judge it)");
}
// WHAT "NOT MEASURED" MAY STILL MEAN (R40 — the fresh audit's OPS11-04). The ledger, read once here and again by CURRENT
// below: a check that says "0430 isn't pasted yet" while the ledger holds 0430 was a hole reopened in silence — /api/health
// answering cron: null because the database couldn't answer, every half hour, green, for good.
let ledgerEarly = null;
try { ledgerEarly = await readLedger([], APP); } catch { /* CURRENT says so, below */ }
const inLedger = (seq) => !!ledgerEarly && (Array.isArray(ledgerEarly.seqs) ? ledgerEarly.seqs.includes(seq) : Number(ledgerEarly.max_seq ?? 0) >= seq);
// THE WATCHER, WATCHED (R24 — database F8 and F6, operations F11 and F19). pg_cron runs every scheduled job and cron_watch
// says one that fails or stops; nothing in the database can say that pg_cron, or cron_watch, stopped — this check, outside it, can.
if (health.status === 200) {
  const cron = health.body?.cron;
  if (cron === undefined) console.log("  · cron: production's build doesn't say whether the scheduled jobs run (built before R24) — not judged");
  else if (cron === null && inLedger(430)) ok("live: the scheduled jobs are measured — 0430 is applied, so /api/health says how they run", false,
    "cron: null — the database didn't answer ops_alive (a grant on cron.job_run_details, a timeout): pg_cron could stop and nothing outside the database would say");
  else if (cron === null) console.log("  · cron: not measured — 0430 isn't pasted yet (the ledger doesn't hold it)");
  else ok(`live: the scheduled jobs run — cron_watch finished ${cron.watched_min ?? "?"} min ago, and every job the applied migrations made is there and on`,
    cron.ok === true,
    cron.watched_min === null ? "cron_watch has never finished here — pg_cron is off, or the watcher fails every run (Supabase → Integrations → Cron)"
      : cron.watched_min > 25 ? `cron_watch last finished ${cron.watched_min} minutes ago — pg_cron stopped, or the watcher fails every run (Supabase → Integrations → Cron)`
      : `${cron.missing} scheduled job(s) the migrations made are missing or switched off (lib/opsWatch names them; Supabase → Integrations → Cron)`);
  // …and the push webhooks, ten of them made in the dashboard (database F6): one deleted or switched off is a push that
  // never goes, and said nowhere else.
  const hooks = health.body?.hooks;
  if (hooks === undefined) console.log("  · hooks: production's build doesn't say whether the push webhooks are on (built before R24) — not judged");
  else if (hooks === null && inLedger(430)) ok("live: the push webhooks are measured — 0430 is applied, so /api/health says whether they are on", false,
    "hooks: null — the database didn't answer ops_alive: a push webhook switched off would go unsaid");
  else if (hooks === null) console.log("  · hooks: not measured — 0430 isn't pasted yet (the ledger doesn't hold it)");
  else ok("live: every push webhook is on its table and switched on — orders, bookings, sign-ups, tasks, go-lives and alerts reach the push function",
    hooks.ok === true, `${hooks.off} push webhook(s) missing or switched off — those pushes don't go (lib/opsWatch PUSH_HOOKS names them; Supabase → Database → Webhooks)`);
}
if (head) ok(`live: production is this tree (${built || "?"} = ${head})`, same(built, head),
  built ? `production runs ${built}; this tree is ${head}. Not deployed yet, or main is ahead/behind — do not read the rest as a verdict on this commit.` : "no build hash in /api/health");
else console.log("  · live: not a git checkout here — the build hash is not compared");

// ── 2. CURRENT ──────────────────────────────────────────────────────────────────────────────────
// HELD ON PURPOSE (2026-10-11). A migration held back until something outside the database is true (0376 waits for
// an iPhone build) is named in supabase/held.json, and this check names it instead of failing on it — Production
// #140–#143 were red for 0376 alone, and a gate that is red for a known reason hides the next unknown one. With the
// ledger's numbers (/api/migrations `seqs`) the missing one is checked to BE the held one, by name; without them
// (a production older than the route's numbers) the two integers decide, as they always did.
try {
  const files = migrationFiles();
  const held = heldMigrations(files);
  const ledger = ledgerEarly ?? await readLedger([], APP);
  const seqs = Array.isArray(ledger.seqs) ? ledger.seqs : null;
  let verdict = pendingFrom(files, ledger.count, ledger.max_seq, held.map((h) => h.seq), seqs);
  let applied = verdict.heldApplied ?? [];
  if (!verdict.exact && !verdict.missing && held.length && verdict.status === "gap") {
    // Two integers only: a held migration the ledger already counts reads as a gap with it held, and adds up without.
    const plain = pendingFrom(files, ledger.count, ledger.max_seq);
    if (plain.status !== "gap") { verdict = plain; applied = held.map((h) => h.seq); }
  }
  const stillHeld = held.filter((h) => !applied.includes(h.seq));
  ok(`current: the ledger holds every migration in supabase/migrations${stillHeld.length ? ` but the ${stillHeld.length} held on purpose` : ""} (${ledger.count} rows, high-water ${String(ledger.max_seq).padStart(4, "0")}${seqs ? ", checked by number" : ""})`,
    verdict.status === "clean",
    verdict.status === "pending" ? `${verdict.pending.length} pending: ${verdict.pending.map((m) => m.file).join(", ")} — paste supabase/APPLY_ALL_PENDING.sql into the SQL editor` : verdict.reason);
  for (const h of stillHeld) console.log(`  · held on purpose: ${h.file} — until ${h.until} (supabase/held.json)`);
  for (const s of applied) console.log(`  · ${files.find((m) => m.seq === s)?.file} is held but the ledger records it — applied; take it out of supabase/held.json`);
} catch (e) { ok("current: /api/migrations could be read, and supabase/held.json with it", false, String(e.message)); }

// ── 2b. POSTURE — the database's RLS/grants/policies, from the committed snapshot ───────────────
// scripts/security.audit.mjs judges supabase/schema.security.json. It exits 1 on a finding, 0 on
// clean, and 0 with NOT CHECKED when the snapshot is missing or predates a policy migration; that
// line is repeated here so the post-deploy read never looks complete while the posture is unread.
{
  const { spawnSync } = await import("node:child_process");
  const run = spawnSync(process.execPath, [new URL("./security.audit.mjs", import.meta.url).pathname], { encoding: "utf8" });
  const out = (run.stdout || "") + (run.stderr || "");
  // Only the headline's NOT CHECKED, and only on a run that didn't fail: a part not measured (R19's keys and buckets on an
  // older snapshot) is not the whole posture unread, and a finding is a finding whatever else the run printed.
  const notChecked = run.status === 0 && /^SECURITY AUDIT: NOT CHECKED/m.test(out);
  const first = out.split("\n").find((l) => l.startsWith("SECURITY AUDIT")) || "SECURITY AUDIT: (no output)";
  // UNREAD HAS A DEADLINE (R40 — OPS11-04): the snapshot is re-pulled after each paste. Unread for two days on the daily
  // full run, it is a failure — 0428's Realtime room policies were live for days and never judged against production.
  let age = null;
  try { const at = Date.parse(JSON.parse((await import("node:fs")).readFileSync(new URL("../supabase/schema.security.json", import.meta.url), "utf8")).pulled_at); if (Number.isFinite(at)) age = Math.round((Date.now() - at) / 3600_000); } catch { /* no snapshot: its own line says so */ }
  if (notChecked && !QUICK && age !== null && age > 48) ok(`posture: the security snapshot covers what production runs — it is ${age} hours old`, false,
    `${first.replace(/^SECURITY AUDIT: /, "")} — re-pull supabase/schema.security.json (the steps are in scripts/security.audit.mjs) after a paste; two days is the line`);
  else if (notChecked) { console.log(`  · ${first.replace(/^SECURITY AUDIT: /, "posture: ")}`); console.log("    (pull the snapshot — steps in scripts/security.audit.mjs — and re-run; this is not a pass)"); }
  else ok(`posture: ${run.status === 0 ? "no table the API roles can touch has RLS off; no write policy is `true`; lists at their ceilings" : "the security audit has findings"}`, run.status === 0, out.split("\n").filter((l) => l.includes("✗")).slice(0, 4).join(" | "));
}

// ── 2c. PUSH — the deployed push function is this tree's (R21, 2026-10-18 — the 10/10 audit, operations F12) ──────────
// supabase/functions/push is deployed by hand (the dashboard, or `supabase functions deploy push`), apart from every push
// to main, and nothing said when the deployed one lagged the repo: a fix could sit in main for weeks while the old
// function ran. It answers a GET with its PUSH_VERSION; this asks it with the database's public key — the repository
// variables the iPhone build and smoke:authed already read — and fails while the two differ. Without them: not checked,
// and said. The key is public by design; it is read from the environment, never written here.
{
  const { readFileSync } = await import("node:fs");
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, ""), key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const ours = (readFileSync(new URL("../supabase/functions/push/index.ts", import.meta.url), "utf8").match(/const PUSH_VERSION = "([^"]+)";/) || [])[1] || "";
  if (!ours) ok("push: this tree names its push function (PUSH_VERSION in supabase/functions/push/index.ts)", false, "no PUSH_VERSION found — the comparison would be empty against empty");
  else if (!base || !key) console.log("  · push: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set here — the deployed push function is not compared");
  // The function's door checks a JWT (verify_jwt — the database's webhook calls it with the anon key, which is one). A
  // publishable key (sb_publishable_…) is no JWT: the platform refuses it at that door whatever is deployed ("Invalid
  // JWT" — Supabase's own rule for the new keys), so asking with one would be a red run that says nothing. Said, not judged.
  else if (!key.startsWith("eyJ")) console.log("  · push: the public key here is not the anon JWT the function's door checks (a publishable key?) — the deployed push function is not compared");
  else {
    // Asked twice at most (the R21 review): one gateway hiccup is not a red run.
    let res = null, deployed = "", why = "";
    for (let tries = 0; tries < 2 && !deployed; tries++) {
      if (tries) await new Promise((r) => setTimeout(r, 3000));
      try {
        res = await fetch(`${base}/functions/v1/push`, { headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
        try { deployed = String((await res.json())?.version ?? ""); } catch { /* an older function answers a GET in words, not JSON */ }
        if (deployed || res.ok) break;   // it answered: an older function's words are a verdict, not a hiccup
      } catch (e) { why = String(e?.message || e); }
    }
    if (!res) ok("push: the push function answered", false, why);
    else ok(`push: the deployed push function is this tree's (${deployed || "?"} = ${ours})`, res.ok && deployed === ours,
      !res.ok ? (res.status === 401 ? "HTTP 401 — the function's door refused the anon key (rotated, or another project's?)" : `HTTP ${res.status} from the function`)
        : deployed ? `deployed ${deployed}; this tree has ${ours} — deploy supabase/functions/push (index.ts and policy.ts)`
          : "the deployed function doesn't say which it is (deployed before R21) — deploy supabase/functions/push (index.ts and policy.ts)");
  }
}

// ── 3. ANSWERS ──────────────────────────────────────────────────────────────────────────────────
// Each probe says what it expects. The status is the route's own contract; the JSON body is the
// wrapper's. A guest POST to a staff route is the cheapest way to see a guard answer.
const PROBES = [
  { m: "GET",  p: "/api/menu",          want: [200] },
  { m: "GET",  p: "/api/migrations",    want: [200] },
  { m: "GET",  p: "/api/coupon/NOPE",   want: [404] },
  { m: "POST", p: "/api/reserve",       want: [401, 503], body: "{}" },
  { m: "POST", p: "/api/agents/brew",   want: [401, 403], body: "{}" },
  { m: "GET",  p: "/api/inventory",     want: [401, 403] },
  { m: "POST", p: "/api/errors/report", want: [204], body: "{}" },
];
for (const pr of PROBES) {
  const r = await json(pr.p, { method: pr.m, body: pr.body, headers: pr.body ? { "content-type": "application/json" } : {} });
  const jsonOr204 = r.status === 204 || r.type.includes("application/json");
  ok(`answers: ${pr.m} ${pr.p} → ${r.status}${r.status === 204 ? "" : ", JSON"}`, pr.want.includes(r.status) && jsonOr204, `got ${said(r)} ${r.type || "(no content-type)"}`);
}
// THE WORKER (public/sw.js): every installed phone runs whatever /sw.js production hands out, and
// for three weeks that worker served three-week-old pages (THE APP THAT STOPPED UPDATING). The one
// in production must be the one in this tree, byte for byte — a stale worker is a stale app.
{
  const { readFileSync } = await import("node:fs");
  const ours = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  const theirs = await json("/sw.js");
  const same = typeof theirs.body === "string" && theirs.body === ours;
  const name = (ours.match(/const CACHE = "([^"]+)";/) || [])[1] || "?";
  ok(`worker: /sw.js is this tree's worker (${name})`, theirs.status === 200 && same, theirs.status !== 200 ? said(theirs) : `production's worker differs from public/sw.js (${(theirs.body || "").length} vs ${ours.length} bytes)`);
}
// THE FRONT DOOR (proxy.ts): a request to "/" that says it is a guest is sent to /truck before the
// page is served; a member, or nobody, gets the page. The cookie is the one lib/viewerHint.ts
// writes; here it is set by hand, which is all the door ever sees.
{
  const door = (cookie) => json("/", { redirect: "manual", headers: cookie ? { cookie } : {} });
  const guest = await door("gt3-viewer=guest"), member = await door("gt3-viewer=member"), nobody = await door(null);
  ok(`door: GET / as a known guest → ${guest.status} to ${guest.location || "?"}`, guest.status === 307 && /\/truck$/.test(guest.location), `got ${said(guest)} ${guest.location}`);
  ok(`door: GET / as a member → ${member.status}, the page`, member.status === 200, `got ${said(member)}`);
  ok(`door: GET / with no cookie → ${nobody.status}, the page`, nobody.status === 200, `got ${said(nobody)}`);
}
// THE IPHONE APP'S DOOR (2026-10-06, the iPhone round): the app's pages come from the phone itself
// (capacitor://localhost), so every API call it makes is cross-origin, and production must say that
// origin may read the answer (next.config.ts appCors) — the app's two origins and no other site. A
// deploy that lost the rule would leave every iPhone with a menu that never loads and a checkout that
// never answers, while the web looked perfect.
{
  const ask = (method, origin) => json("/api/health", { method, headers: { origin, ...(method === "OPTIONS" ? { "access-control-request-method": "GET", "access-control-request-headers": "authorization, content-type" } : {}) } });
  const pre = await ask("OPTIONS", "capacitor://localhost"), got = await ask("GET", "capacitor://localhost"), android = await ask("GET", "https://localhost");
  const stranger = await ask("GET", "https://example.com"), lookalike = await ask("GET", "capacitor://localhost.example.com");
  ok(`app door: the iPhone app may call the API — preflight ${pre.status} and the answer both allow capacitor://localhost`,
    pre.status < 300 && pre.allow === "capacitor://localhost" && got.allow === "capacitor://localhost" && android.allow === "https://localhost",
    `preflight ${said(pre)} allows "${pre.allow}", GET allows "${got.allow}", https://localhost allows "${android.allow}"`);
  ok("app door: no other site may — not another origin, not one that starts the same", !stranger.allow && !lookalike.allow, `example.com allowed "${stranger.allow}", the lookalike "${lookalike.allow}"`);
}

// ── 4. PAINTED ──────────────────────────────────────────────────────────────────────────────────
if (QUICK) {
  console.log(`  · painted: skipped (--quick) — ${Object.keys(PROD_ROUTE).length} routes are measured by the full run`);
  console.log(`\nVERIFY PRODUCTION (quick): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = await import("playwright")); }
const { existsSync } = require("node:fs");
const exe = CHROME.find((p) => existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const AXE = require("node:fs").readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
// A PAGE IS MEASURED ONCE IT HAS STOPPED MOVING (2026-10-06). The sign-in form fades in, and axe
// read it part-way: cream on charcoal at a fraction of its opacity is a contrast failure nobody
// ever sees, and it moved from route to route with the runner's speed — /office and /academy in
// one run, /3mpire and /driver in the next. Every animation that ends is let finish first (3s at
// most); the ones that loop (a live dot, a spinner) keep running, as a person would see them.
const SETTLE = async () => {
  const ending = document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime));
  await Promise.race([Promise.all(ending.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 3000))]);
};
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  // The splash is a finding of its own, not the page (scripts/design.ratchet.mjs says the same).
  await ctx.addInitScript(() => { try { sessionStorage.setItem("gt3-splash-shown", "1"); localStorage.setItem("gt3-splash-seen-at", String(Date.now())); } catch { /* ignore */ } });
  // What moves after paint is only visible from before the page loads (SHIFT in design.ratchet.mjs).
  await ctx.addInitScript(OBSERVE);
  const page = await ctx.newPage();
  const a11y = [];
  for (const path of Object.keys(PROD_ROUTE)) {
    let m = null, err = null;
    for (let attempt = 0; attempt < 2 && !m; attempt++) {
      try {
        const res = await page.goto(APP + path, { waitUntil: "networkidle", timeout: 45000 });
        if (!res || res.status() >= 500) throw new Error(`HTTP ${res ? res.status() : "none"}`);
        await page.waitForTimeout(900);
        await page.evaluate(SETTLE);
        m = await page.evaluate(MEASURE);
        await page.addScriptTag({ content: AXE });
        const ax = await page.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }));
        for (const v of ax.violations) a11y.push({ path, id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, first: v.nodes[0]?.html?.slice(0, 120) });
      } catch (e) { err = e; m = null; }
    }
    if (!m) { ok(`painted: ${path}`, false, `could not measure — ${String(err?.message || err).split("\n")[0].slice(0, 100)}`); continue; }
    const problems = routeVerdict(path, m, PROD_ROUTE[path]);
    ok(`painted: ${path.padEnd(26)} depth ${m.maxLeafDepth}, tap ${m.smallestTap}px, text ${m.smallestText}px, shift ${m.shift ? m.shift.total.toFixed(3) : "?"}, no sideways scroll`,
      problems.length === 0 && (m.overflowX || []).length === 0,
      [...problems, ...(m.overflowX?.length ? [`scrolls sideways: ${JSON.stringify(m.overflowX).slice(0, 80)}`] : [])].join(" | "));
  }
  const nodes = a11y.reduce((n, v) => n + v.n, 0);
  ok(`painted: no WCAG 2.1 A/AA violations on production (axe-core), ${Object.keys(PROD_ROUTE).length} routes`, nodes === 0,
    a11y.slice(0, 4).map((v) => `${v.path} ${v.id} ×${v.n} (${v.impact}) ${v.first || ""}`).join(" | "));
} finally { await browser.close(); }

console.log(`\nVERIFY PRODUCTION: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
