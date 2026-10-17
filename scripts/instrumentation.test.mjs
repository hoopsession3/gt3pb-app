// WHAT ESCAPES EVERY WRAPPER IS FILED THE INTAKE'S WAY — instrumentation.ts, run (R18, 2026-10-17 — the 10/10 audit,
// operations F3).
//
// Next calls onRequestError for an error that escaped a route handler or a server-drawn page. The hook was a copy of
// lib/errorIntake that had drifted: it hashed the raw message and the raw top of the stack (a new row and a new alert
// after every deploy), rang every first sighting as a critical, never read the alert's answer and named no row. Here the
// hook itself — compiled from its TypeScript, as Next loads it — is called the way Next calls it, against a stand-in for
// the four PostgREST doors it uses (bump_client_error, rate_limit_hit, client_errors, alerts). Nothing here talks to
// Supabase; the address and the key are made up.
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { routeLoader } from "./fixtures/moneyWorld.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const load = routeLoader();
const hook = load("instrumentation.ts");
const K = load("lib/errorKey.ts");
const intake = routeLoader({ "./supabaseAdmin": { supabaseAdmin: null }, "./serverAlerts": { raiseAlert: async () => {}, raiseAlertOnce: async () => true } })("lib/errorIntake.ts");
ok("compiled: instrumentation.ts and lib/errorKey", typeof hook.onRequestError === "function" && typeof K.errorKey === "function" && typeof K.escapedErrorAlert === "function");

// ── the four doors, in memory ──────────────────────────────────────────────────────────────────────────────────────
function world({ limits = {}, alertFails = 0, insert = null, down = false } = {}) {
  const w = { rows: [], alerts: [], calls: [], hits: {}, alertTries: 0 };
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  w.fetch = async (url, init = {}) => {
    if (down) throw new TypeError("fetch failed");
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    w.calls.push({ at: u.pathname, search: u.search, body, prefer: init.headers?.Prefer });
    if (u.pathname === "/rest/v1/rpc/bump_client_error") {
      const r = w.rows.find((x) => x.fingerprint === body.p_fingerprint);
      if (r) r.count++;
      return json(!!r);
    }
    if (u.pathname === "/rest/v1/rpc/rate_limit_hit") {
      if (limits[body.p_bucket] === "down") return json({ message: "limiter down" }, 503);
      w.hits[body.p_bucket] = (w.hits[body.p_bucket] ?? 0) + 1;
      return json(w.hits[body.p_bucket] <= (limits[body.p_bucket] ?? body.p_max));
    }
    if (u.pathname === "/rest/v1/client_errors") {
      if (insert) return json({ code: insert.code, message: "refused" }, insert.status);
      if (w.rows.some((x) => x.fingerprint === body.fingerprint)) return json({ code: "23505", message: "duplicate key" }, 409);
      const row = { id: randomUUID(), count: 1, ...body };
      w.rows.push(row);
      return init.headers?.Prefer === "return=representation" ? json([{ id: row.id }], 201) : new Response(null, { status: 201 });
    }
    if (u.pathname === "/rest/v1/alerts") {
      w.alertTries++;
      if (w.alertTries <= alertFails) return json({ message: "refused" }, 500);
      w.alerts.push(body);
      return new Response(null, { status: 201 });
    }
    return json({ message: "no such door" }, 404);
  };
  return w;
}

// Called as Next calls it, with the platform's log kept.
async function call(w, err, request = { path: "/menu", method: "GET" }, context = { routerKind: "App Router", routeType: "render" }, env = {}) {
  const was = { fetch: globalThis.fetch, warn: console.warn, error: console.error, url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const said = [];
  globalThis.fetch = w.fetch;
  console.warn = (...a) => said.push(["warn", a.join(" ")]);
  console.error = (...a) => said.push(["error", a.join(" ")]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "url" in env ? env.url : "https://db.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "key" in env ? env.key : "made-up-service-key";
  if (process.env.NEXT_PUBLIC_SUPABASE_URL === "") delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY === "") delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  let threw = null, answer;
  try { answer = await hook.onRequestError(err, request, context); } catch (e) { threw = e; }
  finally {
    globalThis.fetch = was.fetch; console.warn = was.warn; console.error = was.error;
    if (was.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = was.url;
    if (was.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = was.key;
  }
  return { said, threw, answer };
}

// One bug as two deploys throw it: the chunk's hash, the deployment id, the line, the column and the minified name move.
const deployA = Object.assign(new Error("Cannot read properties of undefined (reading 'menu') in /_next/static/chunks/app-a1b2c3d4e5.js?dpl=dpl_AAA"), {
  stack: "TypeError: Cannot read properties of undefined (reading 'menu')\n    at Qe (/var/task/.next/server/chunks/ssr/[root-of-the-server]__a1b2c3d4._.js:10:20)\n    at async x (/var/task/.next/server/app/menu/page.js:1:2)",
});
const deployB = Object.assign(new Error("Cannot read properties of undefined (reading 'menu') in /_next/static/chunks/app-9f8e7d6c5b.js?dpl=dpl_BBB"), {
  stack: "TypeError: Cannot read properties of undefined (reading 'menu')\n    at Zt (/var/task/.next/server/chunks/ssr/[root-of-the-server]__0e9d8c7b._.js:44:9)\n    at async y (/var/task/.next/server/app/menu/page.js:3:7)",
});

{
  const w = world();
  const first = await call(w, deployA);
  ok("first sighting: one row filed", w.rows.length === 1, w.rows.length);
  const row = w.rows[0];
  ok("first sighting: the row is the error's — message, stack, path, the server's ua, and fatal because the page didn't draw",
    row?.message.startsWith("Cannot read properties") && row.stack.includes("at Qe") && row.url === "/menu" && row.ua === "server · GET · render" && row.fatal === true, row);
  ok("first sighting: the row's id is asked back (return=representation, select=id)",
    w.calls.some((c) => c.at === "/rest/v1/client_errors" && c.search === "?select=id" && c.prefer === "return=representation"));
  ok("first sighting: ONE alert", w.alerts.length === 1, w.alerts.length);
  const a = w.alerts[0];
  ok("the alert is important — never a critical (push, sound, Teams and email) for an error page", a?.severity === "important", a?.severity);
  ok("the alert names the row it is about: kind client_error, subject = the filed row's id", a?.kind === "client_error" && a.subject_id === row.id, a);
  ok("the alert opens the Errors screen, in the system lane", a?.link === "/crew?s=settings&a=set-errors" && a.category === "system", a);
  ok("the alert says a page didn't load, and where", a?.title === "Server error — a page didn't load" && a.body.endsWith(" · /menu"), a);
  ok("nothing said in the platform's log when everything was written", first.said.length === 0 && first.threw === null, first.said);

  const second = await call(w, deployB);
  ok("the same bug on the next deploy is the same row — counted, not filed again", w.rows.length === 1 && w.rows[0].count === 2, w.rows.map((r) => r.count));
  ok("…and no second alert", w.alerts.length === 1 && second.threw === null, w.alerts.length);
  ok("a repeat spends no budget", (w.hits["server-errors:new"] ?? 0) === 1 && (w.hits["server-errors:alert"] ?? 0) === 1, w.hits);

  await call(w, deployA, { path: "/shop", method: "GET" });
  ok("the same error on a different page is a different row", w.rows.length === 2 && w.rows[1].url === "/shop", w.rows.map((r) => r.url));
}

{
  // The intake's recipe, "api|"-prefixed: computed here from lib/errorKey, independently of the hook.
  const w = world();
  await call(w, deployA);
  const want = createHash("sha256").update(`api|${K.errorKey(deployA.message, deployA.stack, "/menu")}`).digest("hex");
  ok("the fingerprint is sha-256 of \"api|\" + lib/errorKey's recipe — the intake's, not a copy of it", w.rows[0]?.fingerprint === want, [w.rows[0]?.fingerprint, want]);
  ok("…so it never counts into a row of the intake's own", want !== intake.fingerprintOf(deployA.message, deployA.stack, "/menu"));
  ok("the intake hashes the very same recipe", intake.fingerprintOf("x", "Error: x\n    at f (/x/route.js:1:2)", "/api/x")
    === createHash("sha256").update(K.errorKey("x", "Error: x\n    at f (/x/route.js:1:2)", "/api/x")).digest("hex"));
  ok("the intake's budgets are lib/errorKey's — one place for the numbers",
    intake.SERVER_ROWS.bucket === K.SERVER_ROWS.bucket && intake.SERVER_ROWS.max === K.SERVER_ROWS.max && intake.SERVER_ALERTS.windowMs === K.SERVER_ALERTS.windowMs);
  ok("the limiter is asked for the server's buckets, in its numbers",
    w.calls.some((c) => c.at === "/rest/v1/rpc/rate_limit_hit" && c.body.p_bucket === "server-errors:new" && c.body.p_window_ms === 3_600_000 && c.body.p_max === 30)
      && w.calls.some((c) => c.at === "/rest/v1/rpc/rate_limit_hit" && c.body.p_bucket === "server-errors:alert" && c.body.p_window_ms === 600_000 && c.body.p_max === 5));
}

{
  const w = world();
  await call(w, new Error("Square answered nothing"), { path: "/api/odd", method: "POST" }, { routerKind: "App Router", routeType: "route" });
  ok("a request that failed outside route(): not fatal, and said as a request", w.rows[0]?.fatal === false && w.rows[0].ua === "server · POST · route"
    && w.alerts[0]?.title === "Server error — a request failed", [w.rows[0], w.alerts[0]?.title]);
}

{
  // Words anyone could have put in the request don't reach the admins' email as a link.
  const w = world();
  await call(w, new Error("Bad slug: visit https://evil.example.com/login or www.phish.co now"), { path: "/events/<script>x", method: "GET" });
  const a = w.alerts[0];
  ok("a link in the message is taken out of the alert", a && !/evil\.example|phish\.co/.test(a.body) && a.body.includes("[link]"), a?.body);
  ok("the path in the alert is plain — letters, digits and / . _ -", a?.body.endsWith(" · /events/scriptx"), a?.body);
  ok("the row keeps every word (Settings › Errors)", w.rows[0]?.message.includes("https://evil.example.com/login"));
}

{
  const w = world({ limits: { "server-errors:new": 0 } });
  await call(w, deployA);
  ok("past the hour's thirty new rows: nothing filed, nothing alerted", w.rows.length === 0 && w.alerts.length === 0, [w.rows.length, w.alerts.length]);
}
{
  const w = world({ limits: { "server-errors:alert": 0 } });
  await call(w, deployA);
  ok("past the ten minutes' five alerts: the row is still filed, without an alert", w.rows.length === 1 && w.alerts.length === 0, [w.rows.length, w.alerts.length]);
}
{
  const w = world({ limits: { "server-errors:new": "down", "server-errors:alert": "down" } });
  await call(w, deployA);
  ok("a limiter that can't answer fails open — filed and alerted, as the intake does", w.rows.length === 1 && w.alerts.length === 1, [w.rows.length, w.alerts.length]);
}

{
  const w = world({ alertFails: 1 });
  const r = await call(w, deployA);
  ok("an alert refused once is asked again, and written", w.alertTries === 2 && w.alerts.length === 1 && r.said.length === 0, [w.alertTries, r.said]);
}
{
  const w = world({ alertFails: 2 });
  const r = await call(w, deployA);
  const line = r.said.find(([lvl, t]) => lvl === "error" && t.startsWith("[alert-not-written] "));
  ok("an alert refused twice is said in the platform's log — lib/serverAlerts' line, in its fields", w.alertTries === 2 && w.alerts.length === 0 && !!line, r.said);
  const fields = line ? JSON.parse(line[1].slice("[alert-not-written] ".length)) : {};
  ok("…naming the severity, the kind, the title and why — never the key", fields.severity === "important" && fields.kind === "client_error" && fields.title === "Server error — a page didn't load"
    && /500/.test(fields.why) && !line[1].includes("made-up-service-key"), fields);
}

{
  // Two instances, the same brand-new error: the other one filed it first. This one counts it, quietly.
  const w = world();
  w.rows.push({ id: randomUUID(), count: 1, fingerprint: createHash("sha256").update(`api|${K.errorKey(deployA.message, deployA.stack, "/menu")}`).digest("hex") });
  const realFetch = w.fetch;
  let bumps = 0;
  w.fetch = async (url, init) => {   // the first ask sees nothing yet (the race), the insert then collides
    if (String(url).endsWith("/rpc/bump_client_error") && bumps++ === 0) return new Response("false", { status: 200 });
    return realFetch(url, init);
  };
  const r = await call(w, deployA);
  ok("a unique-key race: counted into the row the other instance filed, no alert, nothing said", w.rows.length === 1 && w.rows[0].count === 2 && w.alerts.length === 0 && r.said.length === 0, [w.rows, r.said]);
}
{
  const w = world({ insert: { status: 500, code: "XX000" } });
  const r = await call(w, deployA);
  ok("a row the database refused, and couldn't count either, is said in the platform's log", w.alerts.length === 0
    && r.said.some(([lvl, t]) => lvl === "warn" && t.startsWith("errors: couldn't file or count a server error — the database answered 500")), r.said);
}
{
  const w = world({ down: true });
  const r = await call(w, deployA);
  ok("the database unreachable: the hook resolves, never throws", r.threw === null && r.answer === undefined, r.threw && String(r.threw));
  ok("…and says it couldn't file", r.said.some(([lvl, t]) => lvl === "warn" && t.includes("the database didn't answer")), r.said);
}
{
  const w = world();
  const r = await call(w, deployA, undefined, undefined, { key: "" });
  ok("no service-role key: nothing asked, nothing thrown", w.calls.length === 0 && r.threw === null);
  const e = await call(world(), null, null, null);
  ok("a null error, request and context: resolves without throwing", e.threw === null);
}

// ── the import set: what instrumentation.ts pulls in runs on the edge runtime ─────────────────────────────────────────
{
  const seen = new Set(), bad = [];
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = readFileSync(join(ROOT, rel), "utf8");
    for (const m of src.matchAll(/^import[^"']*["']([^"']+)["'];?$/gm)) {
      const spec = m[1];
      if (spec.startsWith("./") || spec.startsWith("../")) walk(join(dirname(rel), `${spec}.ts`));
      else bad.push(`${rel} → ${spec}`);
    }
  };
  walk("instrumentation.ts");
  ok("instrumentation.ts imports only the app's own pure files — no node:crypto, no supabase-js, no package", bad.length === 0, bad);
  ok("…and those are lib/envSchema, lib/errorKey, lib/deploySkew and lib/uuid", [...seen].sort().join(",") === ["instrumentation.ts", "lib/deploySkew.ts", "lib/envSchema.ts", "lib/errorKey.ts", "lib/uuid.ts"].join(","), [...seen]);
}

console.log(`instrumentation: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
