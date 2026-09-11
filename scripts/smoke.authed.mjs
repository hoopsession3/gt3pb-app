// AUTHENTICATED CREW CONSOLE — the screens Ryan actually uses, opened as a real signed-in user.
//
//   GT3_SMOKE_EMAIL=… GT3_SMOKE_PASSWORD=… npm run smoke:authed
//
// ── WHY THIS IS THE ONE THAT WAS MISSING ───────────────────────────────────────────────────────
// Four rounds of this engagement shipped with every automated check green, and every single defect
// was found by a person opening a screen. The reason is structural, not incidental:
//
//   scripts/smoke.ui.mjs   drives 26 routes as a GUEST. The crew console is not among them — a
//                          guest gets the sign-in wall, so /crew is asserted "reachable" and
//                          nothing else. The 14 sections behind it have never been rendered by
//                          any check in this repo.
//   the db tests           run against PGlite fixtures, which agree with whatever the fixture
//                          author believed, as superuser, with no RLS and no PostgREST.
//   the release gates      read migration text.
//   tsc                    knows nothing about a string passed to .select().
//
// So the whole of the owner's daily surface — My Day, Command, Prep, Plan, Studio, Brew, Garage,
// Notes, Driver, Money, Customers, Team, Settings — has been outside the net.
//
// ── THE ASSERTION THAT MATTERS ─────────────────────────────────────────────────────────────────
// Not "did the page render". A page renders beautifully while lying. The assertion is:
//
//     NO REQUEST TO SUPABASE MAY COME BACK 4xx OR 5xx.
//
// That single rule covers the entire class this codebase keeps getting caught by, because every
// one of them is a failed request the UI then renders as an absence:
//
//   · a column that does not exist        → PostgREST 400   (62af8ef: events has no `kind`)
//   · a missing GRANT on a view           → 401/403         (0320/0321/0322/0323)
//   · an RLS policy that denies a read    → 401/403         (the crew-console screens are gated)
//   · a view that was dropped or renamed  → 404
//
// The app is written to survive all four quietly — useAsyncData catches, AsyncSection renders an
// empty state, and the screen says "nothing to do". That is the correct behaviour for a product
// and useless for a test, which is why the check watches the WIRE and not the DOM.
//
// ── CREDENTIALS ────────────────────────────────────────────────────────────────────────────────
// Read from the environment, never from a file in this repo, and never typed into the page: the
// session is minted by calling supabase-js directly and seeded into localStorage before the first
// navigation. Nothing goes through the sign-in form, so no password can land in a screenshot, a
// trace, or a DOM snapshot. Use a dedicated staff account — this opens Money, Customers and Team.
//
// Absent credentials → NOT CHECKED and exit 0. It must never report a pass on evidence it does not
// have; that is the same rule scripts/columns.audit.mjs follows and the same failure this whole
// file exists to catch.
//
// READ-ONLY. It navigates and observes. It never clicks, submits, or writes.
//
// ── WHY A BROKEN SESSION CANNOT PRODUCE A GREEN RUN ────────────────────────────────────────────
// The obvious way for this harness to be worthless is for the session seeding to fail: every
// section then renders the sign-in wall, every wall renders without a failed request, and 14
// sections report clean having tested nothing. That is the same shape of lie as a gate that cannot
// fail, so each section asserts FIRST that it is not looking at the wall. The storage key format
// (sb-<project-ref>-auth-token) was checked against the live app rather than assumed.
//
// ── LAST SWEEP ─────────────────────────────────────────────────────────────────────────────────
// 2026-09-11 — all 14 sections walked by hand against production (app.gt3pb.com, tree 1d9741b) as
// the signed-in owner, using this file's exact assertion read from PerformanceResourceTiming:
//
//   day 40 · now 45 · command 50 · prep 29 · plan 46 · studio 24 · brew 26 · garage 32
//   notes 26 · driver 21 · money 43 · customers 29 · team 38 · settings 25
//
//   474 requests to Supabase and our own API. ZERO 4xx, ZERO 5xx, no "couldn't load" banner, no
//   sign-in wall. The first time the crew console has ever been swept, and it came back clean.
//
// That sweep is the manual form of what runs here. This SCRIPT has not yet been run end-to-end,
// because doing so needs the account below — until it has, treat the code path as unproven and the
// RESULT above as the evidence.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = await import("playwright")); }
const CHROME = process.env.PW_CHROME || "/opt/pw-browsers/chromium/chrome-linux/chrome";
const AXE_PATH = require.resolve("axe-core/axe.min.js");
const fs = require("node:fs");

// `next start` reads .env.local itself; a plain node script does not. Load it the same way Next
// does so this runs from the same one place the app is already configured from — a second copy of
// the same four values in a second file is how they drift. Values are never printed, and a real
// environment variable always wins over the file.
for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const EMAIL = process.env.GT3_SMOKE_EMAIL;
const PASSWORD = process.env.GT3_SMOKE_PASSWORD;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// The owner's sections, in ROLE_SECTIONS order (components/OperatorNav.tsx). Kept as a literal
// rather than imported because this file has to run against a BUILT app — and because a list that
// silently shrinks with a refactor would quietly stop testing the screens it dropped.
const SECTIONS = [
  "day", "now", "command", "prep", "plan", "studio", "brew",
  "garage", "notes", "driver", "money", "customers", "team", "settings",
];

if (!EMAIL || !PASSWORD) {
  console.log("AUTHED CREW CONSOLE: NOT CHECKED — no GT3_SMOKE_EMAIL / GT3_SMOKE_PASSWORD in the environment.");
  console.log(`  ${SECTIONS.length} sections of the crew console are waiting to be opened by a signed-in user.`);
  console.log("  Set both on a dedicated staff account (see this file's header) and re-run. Never commit them.");
  process.exit(0);
}
if (!SUPA_URL || !SUPA_ANON) {
  console.log("AUTHED CREW CONSOLE: NOT CHECKED — NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY missing, so no session can be minted.");
  process.exit(0);
}

const PORT = 3211;
const BASE = process.env.GT3_SMOKE_BASE || `http://127.0.0.1:${PORT}`;
const LOCAL = !process.env.GT3_SMOKE_BASE;

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${typeof got === "string" ? got : JSON.stringify(got)}` : "")); } };

// Console noise that is the test server's, not the app's — same list smoke.ui.mjs keeps.
const IGNORE = [
  /Failed to load resource.*_next\/static/i,
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /net::ERR_ABORTED.*_next/i,
];

// ── the session ────────────────────────────────────────────────────────────────────────────────
// supabase-js in Node, not the form. One call, and the password never exists inside the browser.
let session;
{
  const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPA_ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    // Say what failed WITHOUT echoing anything secret — the message is the provider's, the
    // identity is not repeated back.
    console.log(`AUTHED CREW CONSOLE: could not sign in (${r.status}). ${String(j.error_description || j.msg || j.error || "").slice(0, 120)}`);
    console.log("  Check GT3_SMOKE_EMAIL / GT3_SMOKE_PASSWORD. Nothing was tested.");
    process.exit(1);
  }
  session = j;
}
// The storage key supabase-js uses: sb-<project-ref>-auth-token.
const REF = new URL(SUPA_URL).hostname.split(".")[0];
const STORAGE_KEY = `sb-${REF}-auth-token`;
const STORED = JSON.stringify({
  access_token: session.access_token, refresh_token: session.refresh_token,
  expires_at: Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
  expires_in: session.expires_in ?? 3600, token_type: "bearer", user: session.user,
});

// ── the server ─────────────────────────────────────────────────────────────────────────────────
let server = null;
const signalGroup = (sig) => {
  if (!server) return;
  try { process.kill(-server.pid, sig); } catch { /* already gone */ }
  try { server.kill(sig); } catch { /* already gone */ }
};
process.on("exit", () => signalGroup("SIGKILL"));
process.on("SIGINT", () => { signalGroup("SIGKILL"); process.exit(130); });

if (LOCAL) {
  // Same refusal smoke.ui.mjs makes: a suite that silently tests somebody else's server is a suite
  // whose green is worth nothing.
  try {
    const stale = await fetch(BASE + "/truck", { signal: AbortSignal.timeout(2000) });
    console.log(`AUTHED CREW CONSOLE: something is already serving ${BASE} (status ${stale.status}).`);
    console.log("  Stop it first:  pkill -f 'next start' ; pkill -f next-server");
    process.exit(1);
  } catch { /* nothing listening — good */ }

  let NEXT_BIN = null;
  try { NEXT_BIN = require.resolve("next/dist/bin/next"); } catch { /* fall back to npx */ }
  server = NEXT_BIN
    ? spawn(process.execPath, [NEXT_BIN, "start", "-p", String(PORT)], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], detached: true })
    : spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], detached: true });

  let up = false, bindFailed = false;
  server.stdout.on("data", (d) => { if (/Ready|started server|Local:/i.test(String(d))) up = true; });
  server.stderr.on("data", (d) => { if (/EADDRINUSE|address already in use/i.test(String(d))) bindFailed = true; });
  server.on("exit", (code) => { if (!up && code !== 0) bindFailed = true; });
  for (let i = 0; i < 60 && !up && !bindFailed; i++) {
    await sleep(500);
    try { const r = await fetch(BASE + "/truck"); if (r.status < 500) up = true; } catch { /* not up yet */ }
  }
  if (bindFailed) { console.log(`AUTHED CREW CONSOLE: could not bind ${BASE}.`); process.exit(1); }
  if (!up) { console.log("AUTHED CREW CONSOLE: server never came up"); process.exit(1); }
}

const a11yViolations = [];

try {
  const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
  const ctx = await browser.newContext();
  // Seed the session BEFORE any script on the page runs, so the app boots signed in rather than
  // flashing the wall and redirecting.
  await ctx.addInitScript(([k, v]) => {
    try { window.localStorage.setItem(k, v); } catch { /* private mode */ }
  }, [STORAGE_KEY, STORED]);

  for (const section of SECTIONS) {
    const page = await ctx.newPage();
    const apiErrors = [], consoleErrors = [];
    const keep = (t) => !IGNORE.some((re) => re.test(t));

    // THE CHECK. Every response from the database host, and every /api/ route of our own.
    page.on("response", async (res) => {
      const url = res.url();
      const isSupabase = SUPA_URL && url.startsWith(SUPA_URL);
      const isOurApi = url.includes("/api/");
      if (!isSupabase && !isOurApi) return;
      if (res.status() < 400) return;
      // PostgREST puts the real reason in the body — "column events.kind does not exist" is the
      // sentence that would have saved a round. Without it the failure reads as a bare 400.
      let why = "";
      try { why = (await res.text()).slice(0, 220); } catch { /* body already consumed */ }
      apiErrors.push(`${res.status()} ${url.replace(SUPA_URL ?? "", "").slice(0, 120)} — ${why}`);
    });
    page.on("console", (m) => { if (m.type() === "error" && keep(m.text())) consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => { const t = `pageerror: ${e.message}`; if (keep(t)) consoleErrors.push(t); });

    let navOk = true;
    try {
      await page.goto(`${BASE}/crew?s=${section}`, { waitUntil: "networkidle", timeout: 45000 });
    } catch (e) {
      // networkidle can never arrive on a screen with a live subscription — fall back rather than
      // failing the section for it.
      try { await page.goto(`${BASE}/crew?s=${section}`, { waitUntil: "domcontentloaded", timeout: 30000 }); }
      catch (e2) { navOk = false; ok(`${section} · loads`, false, e2.message); }
    }
    if (!navOk) { await page.close(); continue; }
    await page.waitForTimeout(2500);   // let the panels' own reads land

    const text = await page.evaluate(() => document.body.innerText).catch(() => "");

    // Did we actually get IN? A harness that silently tests the sign-in wall for all 14 sections
    // reports 14 clean passes and has checked nothing — the exact shape of failure this file
    // exists to end.
    const walled = /Sign in|Staff only|Crew only|Owners only/i.test(text.slice(0, 400));
    ok(`${section} · signed in (not the wall)`, !walled, walled ? text.slice(0, 90).replace(/\s+/g, " ") : undefined);

    ok(`${section} · no failed database or API request`, apiErrors.length === 0, apiErrors.slice(0, 3));
    ok(`${section} · no console error`, consoleErrors.length === 0, consoleErrors.slice(0, 2));

    // A section that renders an error banner is a section that failed in a way the wire did not
    // show — the panels catch, so this is the other half of the same question.
    const banner = text.match(/Couldn't (?:load|reach|run)[^\n]{0,80}/i);
    ok(`${section} · no "couldn't load" on screen`, !banner, banner ? banner[0] : undefined);

    if (!walled) {
      try {
        await page.addScriptTag({ path: AXE_PATH });
        const res = await page.evaluate(async () => await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        }));
        for (const v of res.violations) a11yViolations.push(`${section}: ${v.id} (${v.nodes.length})`);
      } catch { /* axe could not be injected on this page — reported by the count below */ }
    }
    await page.close();
  }
  await browser.close();
} finally {
  if (LOCAL && server) {
    signalGroup("SIGTERM");
    for (let i = 0; i < 12; i++) { await sleep(250); try { process.kill(-server.pid, 0); } catch { break; } }
    signalGroup("SIGKILL");
  }
}

ok(`crew console a11y (WCAG 2.1 AA)`, a11yViolations.length === 0, a11yViolations.slice(0, 5));

console.log(`\nAUTHED CREW CONSOLE: ${pass} passed, ${fail} failed — ${SECTIONS.length} sections as a signed-in user`);
process.exit(fail ? 1 : 0);
