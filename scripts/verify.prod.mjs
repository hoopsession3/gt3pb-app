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
//   3. ANSWERS   — a handful of routes, with and without a session, answer JSON — never Next's HTML
//                  500 page (lib/apiRoute.ts is what makes this true; this is what checks it)
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
import { migrationFiles, pendingFrom, readLedger } from "./migrations.pending.mjs";

const require = createRequire(import.meta.url);
const APP = (process.env.GT3_APP_URL || "https://app.gt3pb.com").replace(/\/$/, "");
const QUICK = process.argv.includes("--quick");
const WAIT = Number((process.argv.find((a) => a.startsWith("--wait=")) || "--wait=0").slice(7)) || 0;
const CHROME = [process.env.PW_CHROME, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].filter(Boolean);

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` → ${detail}` : ""}`); } };
const json = async (path, init) => {
  const res = await fetch(APP + path, { ...init, headers: { "cache-control": "no-cache", ...(init?.headers || {}) }, signal: AbortSignal.timeout(20000) });
  const type = res.headers.get("content-type") || "";
  let body = null; try { body = type.includes("json") ? await res.json() : await res.text(); } catch { /* keep null */ }
  return { status: res.status, type, body };
};

// ── 1. LIVE ─────────────────────────────────────────────────────────────────────────────────────
console.log(`VERIFY PRODUCTION — ${APP}`);
let head = "";
try { head = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { /* not a checkout */ }
const same = (a, b) => !!a && !!b && (a.startsWith(b.slice(0, 7)) || b.startsWith(a.slice(0, 7)));
let health = await json("/api/health");
// --wait: a push reaches GitHub before Vercel has built it. Poll until production reports this
// commit, then judge. A deploy that never lands is a failure of this check, not a skipped one.
if (WAIT > 0 && head) {
  const until = Date.now() + WAIT * 1000;
  while (!same(health.body?.build?.commitShort || "", head) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 15000));
    try { health = await json("/api/health"); } catch { /* keep polling */ }
  }
  console.log(`  · waited for production to report ${head}: ${same(health.body?.build?.commitShort || "", head) ? "it does" : `still ${health.body?.build?.commitShort || "?"} after ${WAIT}s`}`);
}
const built = health.body?.build?.commitShort || "";
ok(`live: /api/health answers ok`, health.status === 200 && health.body?.ok === true, `HTTP ${health.status}`);
if (head) ok(`live: production is this tree (${built || "?"} = ${head})`, same(built, head),
  built ? `production runs ${built}; this tree is ${head}. Not deployed yet, or main is ahead/behind — do not read the rest as a verdict on this commit.` : "no build hash in /api/health");
else console.log("  · live: not a git checkout here — the build hash is not compared");

// ── 2. CURRENT ──────────────────────────────────────────────────────────────────────────────────
try {
  const ledger = await readLedger([], APP);
  const verdict = pendingFrom(migrationFiles(), ledger.count, ledger.max_seq);
  ok(`current: the ledger holds every migration in supabase/migrations (${ledger.count} rows, high-water ${String(ledger.max_seq).padStart(4, "0")})`,
    verdict.status === "clean",
    verdict.status === "pending" ? `${verdict.pending.length} pending: ${verdict.pending.map((m) => m.file).join(", ")} — paste supabase/APPLY_ALL_PENDING.sql into the SQL editor` : verdict.reason);
} catch (e) { ok("current: /api/migrations could be read", false, String(e.message)); }

// ── 2b. POSTURE — the database's RLS/grants/policies, from the committed snapshot ───────────────
// scripts/security.audit.mjs judges supabase/schema.security.json. It exits 1 on a finding, 0 on
// clean, and 0 with NOT CHECKED when the snapshot is missing or predates a policy migration; that
// line is repeated here so the post-deploy read never looks complete while the posture is unread.
{
  const { spawnSync } = await import("node:child_process");
  const run = spawnSync(process.execPath, [new URL("./security.audit.mjs", import.meta.url).pathname], { encoding: "utf8" });
  const out = (run.stdout || "") + (run.stderr || "");
  const notChecked = /NOT CHECKED/.test(out);
  const first = out.split("\n").find((l) => l.startsWith("SECURITY AUDIT")) || "SECURITY AUDIT: (no output)";
  if (notChecked) { console.log(`  · ${first.replace(/^SECURITY AUDIT: /, "posture: ")}`); console.log("    (pull the snapshot — steps in scripts/security.audit.mjs — and re-run; this is not a pass)"); }
  else ok(`posture: ${run.status === 0 ? "no table the API roles can touch has RLS off; no write policy is `true`; lists at their ceilings" : "the security audit has findings"}`, run.status === 0, out.split("\n").filter((l) => l.includes("✗")).slice(0, 4).join(" | "));
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
  ok(`answers: ${pr.m} ${pr.p} → ${r.status}${r.status === 204 ? "" : ", JSON"}`, pr.want.includes(r.status) && jsonOr204, `got ${r.status} ${r.type || "(no content-type)"}`);
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
