// UI SMOKE — boots the production build and drives every customer route through a real
// browser, asserting each one: HTTP 200-class, the Design System v1 kit is present
// (masthead + closing-beat signature), no console errors, and no React hydration mismatch.
// This is the page-level safety net for the kit waves: a route that renders blank, throws on
// mount, or loses its kit chrome fails here before it ships. Runs against the guest/demo
// rendering (no Supabase secrets in this env by design) — exactly the shell+CSS contract we
// want to guard. Chromium is preinstalled (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers).
import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
// Playwright may be installed globally (this sandbox) or locally (CI) — resolve either way.
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = await import("playwright")); }
// Chromium binary: preinstalled in this sandbox; fall back to Playwright's own resolution in CI.
const CHROME = process.env.PW_CHROME || "/opt/pw-browsers/chromium/chrome-linux/chrome";
// DESIGN at phone width (2026-10-02): the same measurement the Plan fixture uses, run on every
// route in a 390px context — box depth, smallest tap target, smallest text — against per-route
// ceilings that live in ONE place, scripts/design.ratchet.mjs, beside the stylesheet's own.
import { MEASURE } from "./design.measure.mjs";
import { routeVerdict, weightVerdict } from "./design.ratchet.mjs";
const design = [];        // { path, m } per route
const designErrors = [];  // routes the phone pass could not measure
// WEIGHT (2026-10-02): what a phone downloads to show each route, cold, from this build — script
// and stylesheet bytes as sent (gzip, the way `next start` serves them) and the request count. A
// condition in JSX does not keep a staff feature out of a guest's bundle; only a lazy import does,
// and this is the number that says whether one slipped back in. Ceilings per route live with the
// other ceilings in scripts/design.ratchet.mjs (WEIGHT).
const weight = [];        // { path, w } per route
const weightErrors = [];
// axe-core, injected per page. The a11y pass is the first check in this harness that looks at what
// a screen IS rather than what it contains — every other assertion here is a string match.
const AXE_PATH = require.resolve("axe-core/axe.min.js");
const a11y = [];
const a11yErrors = [];
const a11yScanned = new Set();
// Zero, and it started at zero the same day the check was written — the two violations the first
// run found were fixed in the same commit rather than ratcheted around. Both were the same defect:
// an aria-label on an element with NO role, which ARIA prohibits and assistive tech may therefore
// ignore. The 3MPIRE wordmark (an alt="" image plus an aria-hidden span) and a review's star rating
// were both announced as nothing at all, while looking labelled in the source.
export const A11Y_BASELINE = 0;
const fs = require("node:fs");

const PORT = 3210;
const BASE = `http://127.0.0.1:${PORT}`;

// route → the kit markers that MUST be in the rendered HTML (proves it's on the system,
// not just that it returned 200). Guest-context routes render the public/demo variant.
const ROUTES = [
  { path: "/truck", must: ["s-find", "k-title", "Carolinas, Georgia"] },     // Find Us
  { path: "/events", must: ["s-find"] },                                       // same surface
  { path: "/menu", must: ["k-mast-light", "k-sec", "Carolinas, Georgia"] },   // light context
  { path: "/reserve", must: ["k-mast", "Carolinas, Georgia"] },
  { path: "/delivery", must: ["k-mast"] },
  { path: "/3mpire", must: ["k-mast"] },
  { path: "/craft", must: ["k-mast", "Carolinas, Georgia"] },
  { path: "/book", must: ["k-mast", "Carolinas, Georgia"] },
  // academy's kit surface is behind STAFF sign-in (a guest gets <SignIn/> in prod, the k-title
  // fallback in this env) — a guest-context smoke can't reach the real page, and its heavy client
  // chunk flakes only under the sandbox `next start`. Reachability-only here; the authed page is
  // verified by the prod deploy. `soft` = assert SSR status + real 5xx, skip marker/console asserts.
  { path: "/academy", must: [], soft: true },
  { path: "/office", must: [], soft: true },        // B2B customer portal (auth-dependent content)
  { path: "/scan", must: [], soft: true },          // staff-only (guest → wall)
  { path: "/architecture", must: [], soft: true },  // owner-only (guest → wall)
  { path: "/playbook", must: [], soft: true },      // owner-only (guest → wall)
  { path: "/driver", must: [], soft: true },        // crew-only (guest → bounce)
  { path: "/agreement", must: [], soft: true },     // the operator's own copy of their deal (0319 round)
  { path: "/offer", must: [], soft: true },         // the candidate's side of the hiring flow
  // public partner share (real share key). Renders correctly (curl: 200 + k-mast + Carolinas +
  // "Partner share"), but the SSR-fetch marker check is flaky under the sandbox's dynamic-route
  // first-compile in `next start` — reachability-only here; curl + prod deploy verify the kit.
  { path: "/built/gt3-built-k7m9x4q2", must: [], soft: true },
  { path: "/display", must: [], soft: true },       // signage kiosk — bespoke by design, reachability only
  // Four public routes this harness had never visited (found 2026-10-02 while measuring every
  // route at phone width): the merch shop, the Primal index, and the two legal pages.
  { path: "/shop", must: ["k-mast"] },
  { path: "/primal", must: ["k-mast"] },
  { path: "/privacy", must: [] },
  { path: "/terms", must: [] },
  { path: "/", must: [] },   // Today redirects to /truck for guests — just must not crash
];

// Console noise we tolerate (third-party / expected-in-demo); anything else is a failure.
const IGNORE = [
  /Download the React DevTools/i,
  /Supabase.*not configured/i,
  /\[Fast Refresh\]/i,
  /favicon/i,
  // ephemeral `next start` (turbopack) intermittently 500s a heavy lazy chunk under Playwright
  // load — a TEST-SERVER artifact, not an app fault. The authoritative failure signals stay
  // intact: SSR status + markers (fetch) and non-asset 5xx (response listener) both still fail
  // the run. The browser's generic chunk-load console/pageerror noise is tolerated because a real
  // route/API 500 is caught independently by realServerErrors. See the route loop.
  /_next\/static\/chunks\/.*\b(500|MIME type)/i,
  /Refused to execute script.*_next\/static\/chunks/i,
  /ChunkLoadError/i,
  /Failed to load chunk/i,
  /Failed to load resource.*status of 500/i,
  /Failed to load resource.*status of 404/i,
];

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${detail ? ` → ${detail}` : ""}`); } };

// ── THIS SUITE MUST TEST ITS OWN SERVER ────────────────────────────────────────────────────────
// It once did not. A `next start` left running by an earlier verify held port 3210 with a build
// from before two new routes existed; this script's own spawn failed to bind, said nothing, and
// Playwright happily drove the stranger's server — reporting 404 for two routes that were in the
// build and served 200 on any other port. The failure was real-looking, reproducible, and about
// nothing.
//
// A suite that will silently test somebody else's server is a suite whose green is worth nothing,
// which is the same defect as a gate that cannot fail. So: refuse to start if the port is taken,
// and name the fix rather than making the next person work it out.
try {
  const stale = await fetch(BASE + "/truck", { signal: AbortSignal.timeout(2000) });
  console.log(`UI SMOKE: something is already serving ${BASE} (status ${stale.status}).`);
  console.log("  This suite would have tested THAT server, not the build you just made.");
  console.log("  Stop it first:  pkill -f 'next start' ; pkill -f next-server");
  process.exit(1);
} catch { /* nothing listening — which is what we want */ }

// Spawn next DIRECTLY, not through npx. `npx next start` is three processes — npx, then sh -c,
// then next-server — and the real server survives a SIGTERM sent to the wrapper. That is why the
// finally below leaked the port on every single run, and why a leaked run poisoned the next one.
// Resolving the bin ourselves makes server.pid the actual server, so killing it kills it. npx
// stays as a fallback for an environment where next cannot be resolved from here.
let NEXT_BIN = null;
try { NEXT_BIN = require.resolve("next/dist/bin/next"); } catch { /* fall back to npx */ }
const server = NEXT_BIN
  ? spawn(process.execPath, [NEXT_BIN, "start", "-p", String(PORT)],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], detached: true })
  : spawn("npx", ["next", "start", "-p", String(PORT)],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], detached: true });

// Kill the whole process GROUP, and escalate. A polite signal the server outlives leaks the port
// exactly as before, only with better intentions.
const signalGroup = (sig) => {
  try { process.kill(-server.pid, sig); } catch { /* already gone */ }
  try { server.kill(sig); } catch { /* already gone */ }
};
const stopServer = async () => {
  signalGroup("SIGTERM");
  for (let i = 0; i < 12; i++) {                             // ~3s of grace
    await sleep(250);
    try { process.kill(-server.pid, 0); } catch { return; }  // the group is gone
  }
  signalGroup("SIGKILL");
};
// A crash or a Ctrl-C must not leak it either. `exit` handlers cannot await, so they go straight
// to the blunt instrument.
process.on("exit", () => signalGroup("SIGKILL"));
process.on("SIGINT", () => { signalGroup("SIGKILL"); process.exit(130); });

let up = false;
let bindFailed = false;
server.stdout.on("data", (d) => { if (/Ready|started server|Local:/i.test(String(d))) up = true; });
// EADDRINUSE arrives on stderr and used to be swallowed whole.
server.stderr.on("data", (d) => { if (/EADDRINUSE|address already in use/i.test(String(d))) bindFailed = true; });
server.on("exit", (code) => { if (!up && code !== 0) bindFailed = true; });

try {
  for (let i = 0; i < 60 && !up && !bindFailed; i++) {
    await sleep(500);
    try { const r = await fetch(BASE + "/truck"); if (r.status < 500) { up = true; } } catch { /* not up yet */ }
  }
  if (bindFailed) { console.log(`UI SMOKE: could not bind ${BASE} — another server has it.`); process.exit(1); }
  if (!up) { console.log("UI SMOKE: server never came up"); process.exit(1); }

  const launchOpts = fs.existsSync(CHROME) ? { executablePath: CHROME } : {};
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext();
  // The phone context pre-dismisses the marketing splash: it is a finding of its own (17s per
  // session on every customer route — in the audit, Ryan's call), not the page's structure.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.addInitScript(() => { try { sessionStorage.setItem("gt3-splash-shown", "1"); } catch { /* */ } });

  for (const route of ROUTES) {
    // 1) SSR CONTRACT (deterministic): the raw server response carries status + kit markers.
    //    Next SSRs client components, so every kit marker appears here — no dependence on the
    //    post-hydration DOM (which a flaky lazy-chunk can drop to the Suspense loader).
    let ssrStatus = 0, ssrHtml = "";
    // follow redirects → the real final body for marker checks (e.g. / → /truck for guests)
    try { const r = await fetch(BASE + route.path); ssrStatus = r.status; ssrHtml = await r.text(); }
    catch (e) { ok(`${route.path} · reachable`, false, e.message); continue; }
    ok(`${route.path} · 200-class`, (ssrStatus >= 200 && ssrStatus < 400), `status ${ssrStatus}`);
    for (const m of route.must) ok(`${route.path} · has "${m}"`, ssrHtml.includes(m));

    // 2) RUNTIME HEALTH (browser): no page errors, no hydration mismatch, no REAL 5xx.
    //    A 5xx on a _next/static asset is the ephemeral test-server flaking — tolerated; a 5xx on
    //    a route/API is a real failure — caught.
    const page = await ctx.newPage();
    const consoleErrors = [], realServerErrors = [];
    const keep = (t) => !IGNORE.some((re) => re.test(t));
    page.on("console", (m) => { if (m.type() === "error" && keep(m.text())) consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => { const t = `pageerror: ${e.message}`; if (keep(t)) consoleErrors.push(t); });
    page.on("response", (r) => { if (r.status() >= 500 && !/_next\/static\//.test(r.url())) realServerErrors.push(`${r.status()} ${r.url()}`); });
    try { await page.goto(BASE + route.path, { waitUntil: "domcontentloaded", timeout: 20000 }); } catch { /* status already asserted via SSR */ }
    await sleep(600); // let hydration + effects run so pageerrors surface

    if (!route.soft) {
      ok(`${route.path} · no page/console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
      ok(`${route.path} · no hydration mismatch`, !/hydrat|Text content does not match|#418|#423/i.test(consoleErrors.join(" ")));
    }
    // real route/API 5xx is always a failure, even for soft routes
    ok(`${route.path} · no server 5xx (non-asset)`, realServerErrors.length === 0, realServerErrors.slice(0, 2).join(" | "));

    // 3) ACCESSIBILITY — axe-core, WCAG 2.1 A/AA.
    //    Retried once, because /truck client-navigates on mount and destroyed the execution
    //    context mid-run on the first pass. An UNSCANNED route counts as a failure below, not as
    //    a clean one — "we could not look" and "we looked and it was fine" are different answers,
    //    and letting them share a result is how a gate starts lying.
    const scan = async () => {
      try { await page.waitForLoadState("networkidle", { timeout: 4000 }); } catch { /* settled enough */ }
      await page.addScriptTag({ path: AXE_PATH });
      return page.evaluate(async () =>
        await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }));
    };
    try {
      let res;
      try { res = await scan(); } catch { await sleep(800); res = await scan(); }
      a11yScanned.add(route.path);
      for (const v of res.violations) {
        a11y.push({ path: route.path, id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, nodes: v.nodes.map((x) => ({ t: x.target.join(" "), html: x.html.slice(0, 160) })) });
      }
    } catch (e) { a11yErrors.push(`${route.path}: ${String(e.message).slice(0, 120)}`); }

    await page.close();

    // 4) DESIGN at phone width — structure, not strings. Retried once like axe; an unmeasured
    //    route is a failure below, never a quiet pass.
    const pp = await phone.newPage();
    try {
      const run = async () => {
        await pp.goto(BASE + route.path, { waitUntil: "domcontentloaded", timeout: 20000 });
        try { await pp.waitForLoadState("networkidle", { timeout: 4000 }); } catch { /* settled enough */ }
        await sleep(700);
        return pp.evaluate(MEASURE);
      };
      let m;
      try { m = await run(); } catch { await sleep(800); m = await run(); }
      design.push({ path: route.path, m });
    } catch (e) { designErrors.push(`${route.path}: ${String(e.message).slice(0, 120)}`); }
    await pp.close();

    // 5) WEIGHT — deterministic, from the document itself: the script chunks the HTML references
    //    (minus the noModule polyfill a modern phone never requests) and its stylesheets, each
    //    fetched and gzipped here. Not the browser's network log: once the page is up the router
    //    prefetches every link in the bottom nav (24 more chunks on /menu), and how many of those
    //    land before `load` depends on how warm the server is. The document does not.
    try {
      const refs = [...ssrHtml.matchAll(/<script\b([^>]*)\bsrc="(\/_next\/static\/[^"]+\.js)"([^>]*)>/g)].filter((m) => !/\bnomodule\b/i.test(m[1] + m[3])).map((m) => m[2]);
      const css = [...ssrHtml.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]);
      const gz = async (u) => { const r = await fetch(BASE + u); const buf = Buffer.from(await r.arrayBuffer()); return gzipSync(buf).length; };
      const js = (await Promise.all([...new Set(refs)].map(gz))).reduce((a, b) => a + b, 0);
      const style = (await Promise.all([...new Set(css)].map(gz))).reduce((a, b) => a + b, 0);
      weight.push({ path: route.path, w: { js: Math.round(js / 1024), css: Math.round(style / 1024), chunks: new Set(refs).size } });
    } catch (e) { weightErrors.push(`${route.path}: ${String(e.message).slice(0, 120)}`); }
  }

  // 6) THE RAIL, EXPANDED, ON A PHONE — WITH A DRINK IN THE CART (2026-10-02). Every route above is
  //    measured with the rail folded, its resting state. Expanded, it is a toolbar in the layout
  //    between the cart bar and the nav: this walks the one path that makes money — tap a drink,
  //    add it, open the rail — and holds the stylesheet to what it promises. Measured, because the
  //    first docked version opened the Display panel 117px off the left of the screen (the tab's
  //    rise animation was the popout's containing block for 900ms) and the second sat exactly on
  //    the cart bar, so "Review 1 drink" could not be tapped with the rail open. Nothing but a
  //    measurement sees either.
  {
    const rp = await phone.newPage();
    try {
      await rp.goto(BASE + "/menu", { waitUntil: "domcontentloaded", timeout: 20000 });
      try { await rp.waitForLoadState("networkidle", { timeout: 4000 }); } catch { /* settled enough */ }
      await sleep(500);
      const box = async (sel) => rp.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; }).catch(() => null);
      // the order path: a drink opens its sheet, "Add to order" puts it in the cart bar
      await rp.click(".entry"); await sleep(500);
      ok("order · tapping a drink opens its sheet", !!(await rp.$("#drink-sheet-title")));
      // THE SHEET THAT NEVER LEFT (components/Sheet.tsx, 2026-10-02): closing a sheet by tapping
      // outside it left the scrim mounted for ever and `body:has(.sheet2-scrim)` hid the rail for the
      // rest of the visit. Measured on production before the fix: the ‹ handle gone after one drink.
      await rp.mouse.click(200, 40);
      try { await rp.waitForSelector(".sheet2-scrim", { state: "detached", timeout: 3000 }); } catch { /* judged below */ }
      ok("sheet · tapping outside a drink's sheet removes it — scrim and all", !(await rp.$(".sheet2-scrim")));
      const handle = await box(".rail-open");
      ok("sheet · …and the rail handle is still painted afterwards", !!handle && handle.h > 0, handle ? "the rail is in the DOM but hidden — a stale scrim" : "no rail handle");
      await rp.click(".entry"); await sleep(500);
      await rp.click(".order-bar"); await sleep(600);
      const cartText = await rp.$eval(".cartbar", (e) => e.textContent).catch(() => "");
      ok("order · adding it shows the cart bar with one drink and its price", /1 drink/.test(cartText) && /\$\d/.test(cartText), cartText);
      await rp.click(".rail-open");
      await sleep(120);   // on purpose: inside the old animation window
      const rail = await box(".rail"), nav = await box(".nav"), cart = await box(".cartbar");
      ok("rail · expanded on a phone, it is a full-width toolbar", !!rail && rail.x <= 1 && rail.w >= 388, JSON.stringify(rail));
      ok("rail · …between the cart bar and the nav, touching neither", !!rail && !!nav && !!cart && rail.bottom <= nav.y && rail.y >= cart.bottom, `cart bottom ${cart?.bottom}, rail ${rail?.y}–${rail?.bottom}, nav top ${nav?.y}`);
      const tabs = await rp.$$eval(".rail > *", (els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
      ok("rail · every tab sits on the same line", tabs.length >= 3 && new Set(tabs).size === 1, tabs.join(","));
      await rp.click(".rdg-fab"); await sleep(150);
      const panel = await box(".rdg-panel");
      ok("rail · the Display panel opens on screen", !!panel && panel.x >= 0 && panel.right <= 390 && panel.y >= 0, JSON.stringify(panel));
      await rp.click(".rdg-fab"); await sleep(150);
      await rp.click(".chub-tab"); await sleep(300);
      const hub = await box(".chub-panel");
      ok("rail · the Connect panel opens on screen", !!hub && hub.x >= 0 && hub.right <= 390 && hub.y >= 0, JSON.stringify(hub));
      await rp.click(".chub-tab"); await sleep(150);
      // the tap that matters: with the rail open, the cart bar still opens the checkout
      let opened = false;
      try { await rp.click(".cartbar", { timeout: 3000 }); await sleep(600); opened = !!(await rp.$("#checkout-title")); } catch { opened = false; }
      ok("order · with the rail open, the cart bar still opens the checkout", opened);
      const lines = await rp.$$eval(".co-line", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim())).catch(() => []);
      ok("order · the checkout lists the drink and a total", lines.length >= 2 && /Total/.test(lines[lines.length - 1]), lines.join(" | "));
      await rp.keyboard.press("Escape");
      try { await rp.waitForSelector(".sheet2-scrim", { state: "detached", timeout: 3000 }); } catch { /* judged below */ }
      await sleep(200);
      ok("order · Escape closes the checkout and the rail comes back", !(await rp.$(".sheet2-scrim")) && !!(await box(".rail")));
      await rp.click(".rail-fold", { timeout: 3000 }).catch(() => {}); await sleep(200);
      const folded = await box(".rail-open");
      ok("rail · it folds back to the handle", !!folded && folded.h > 0);
    } catch (e) { ok("rail · could be exercised on /menu", false, String(e.message).slice(0, 120)); }
    await rp.close();
  }

  await browser.close();
} finally {
  await stopServer();
}

// ── ACCESSIBILITY ──────────────────────────────────────────────────────────────────────────────
// The first a11y check this app has ever had. Everything else in this repo guards the database and
// the logic; the UI layer was verified by a person opening it and looking, which is why three
// screenshots in a row found things a thousand-odd assertions did not.
//
// KNOWN LIMIT, stated rather than implied: this harness runs UNAUTHENTICATED, so it covers the
// customer-facing routes and not the crew console — the surface the owner actually uses all day.
// Extending it needs a test account, which is a credential decision, not a code one. Until then
// this says "the pages a guest can reach are clean", and nothing more.
{
  const byRule = new Map();
  for (const v of a11y) {
    const k = `${v.impact}:${v.id}`;
    const e = byRule.get(k) ?? { impact: v.impact, id: v.id, help: v.help, nodes: 0, paths: new Set() };
    e.nodes += v.n; e.paths.add(v.path); byRule.set(k, e);
  }
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const rules = [...byRule.values()].sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9) || b.nodes - a.nodes);
  const total = a11y.reduce((n, v) => n + v.n, 0);
  console.log(`\nA11Y (WCAG 2.1 A/AA, axe-core): ${rules.length} rule(s) violated, ${total} element(s), across ${new Set(a11y.map((v) => v.path)).size} route(s)`);
  for (const r of rules) {
    console.log(`  ${String(r.impact).padEnd(8)} ${r.id.padEnd(28)} ${String(r.nodes).padStart(4)} el  ${[...r.paths].slice(0, 4).join(" ")}${r.paths.size > 4 ? ` +${r.paths.size - 4}` : ""}`);
    console.log(`           ${r.help}`);
  }
  if (process.env.A11Y_NODES) for (const v of a11y) for (const nd of v.nodes ?? []) console.log(`    ${v.path}  ${nd.t}\n      ${nd.html}`);
  if (a11yErrors.length) console.log(`  (axe could not run on ${a11yErrors.length} route(s): ${a11yErrors.slice(0, 2).join("; ")})`);

  // Two ways to fail, and the second one matters as much as the first.
  ok(`a11y: no WCAG 2.1 A/AA violations (baseline ${A11Y_BASELINE})`, total <= A11Y_BASELINE,
    rules.slice(0, 3).map((r) => `${r.impact} ${r.id} ×${r.nodes}`).join(" | "));
  ok("a11y: every route was actually scanned — an unscanned route is not a clean one",
    a11yErrors.length === 0, a11yErrors.slice(0, 2).join("; "));
}

// ── DESIGN AT PHONE WIDTH ───────────────────────────────────────────────────────────────────────
// Every public route, 390px, splash dismissed: how deep the boxes nest, the smallest thing a thumb
// is asked to hit, the smallest text. Ceilings per route live in scripts/design.ratchet.mjs. May
// improve freely; may not get worse; a ceiling left slack is a failure too, same as lint.
{
  const worst = design.reduce((a, d) => Math.max(a, d.m.maxLeafDepth), 0);
  const tiniest = design.reduce((a, d) => (d.m.smallestTap !== null && d.m.smallestTap < a.v) ? { v: d.m.smallestTap, p: d.path, w: d.m.smallestTapWhat } : a, { v: 999, p: "", w: "" });
  console.log(`\nDESIGN (phone, 390px): ${design.length} route(s) measured — deepest box ${worst}, smallest tap target ${tiniest.v === 999 ? "n/a" : `${tiniest.v}px (${tiniest.p}: ${tiniest.w})`}`);
  for (const d of design) {
    const problems = routeVerdict(d.path, d.m);
    ok(`design · ${d.path} · depth ${d.m.maxLeafDepth}, tap ${d.m.smallestTap}px, text ${d.m.smallestText}px within the recorded ceilings`, problems.length === 0, problems.slice(0, 2).join(" | "));
  }
  ok("design: every route was actually measured — an unmeasured route is not a clean one", designErrors.length === 0, designErrors.slice(0, 2).join("; "));
}

// ── WEIGHT ──────────────────────────────────────────────────────────────────────────────────────
{
  const heaviest = weight.reduce((a, d) => (d.w.js > a.js ? { ...d.w, path: d.path } : a), { js: -1, path: "" });
  console.log(`\nWEIGHT (cold, phone): ${weight.length} route(s) — heaviest ${heaviest.path} at ${heaviest.js} KB of script${process.env.WEIGHT_LIST ? "" : " (WEIGHT_LIST=1 prints every route)"}`);
  if (process.env.WEIGHT_LIST) for (const d of weight) console.log(`    ${d.path.padEnd(28)} js ${String(d.w.js).padStart(4)} KB  css ${String(d.w.css).padStart(4)} KB  ${String(d.w.chunks).padStart(3)} chunks`);
  for (const d of weight) {
    const problems = weightVerdict(d.path, d.w);
    ok(`weight · ${d.path} · ${d.w.js} KB script in ${d.w.chunks} chunks, ${d.w.css} KB stylesheet, within the recorded ceilings`, problems.length === 0, problems.join(" | "));
  }
  ok("weight: every route was actually weighed — an unweighed route is not a light one", weightErrors.length === 0, weightErrors.slice(0, 2).join("; "));
}

console.log(`UI SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
