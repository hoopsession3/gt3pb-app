// R40 — THE GATES SAY WHAT THEY SEE (2026-10-19 — the fresh audit's operations findings; Ryan: "Keep working to improve
// to a 10").
//
//   1 · no key in the repository (OPS11-16): .gitignore's patterns, and scripts/secrets.audit run on what it reads — a
//       key file by its name, a private key's block (not its header), live keys, a service-role JWT (not the anon one).
//   2 · the owner's gate is CI's (OPS11-05): the lint ratchet in `npm run audit` (one eslint pass, handed on), the secrets
//       audit beside it, `npm run release` = verify and npm's advisories, CI's separate lint step gone, the README true.
//   3 · the production check, run against a stand-in site (OPS11-13, -04): a site that doesn't answer is a named ✗ and
//       the run goes on; "not measured" is a ✗ when the ledger holds 0430; the snapshot's deadline on the full run.
//   4 · the half-hourly check installs nothing, caches nothing, and needs nothing installed (OPS11-11).
//   5 · TestFlight takes main, and a commit CI passed; the build carries its commit (OPS11-12).
//   6 · the signed-in smoke sees the console itself, not the two-step prompt (OPS11-09).
//   7 · a route's thrown line carries the platform's request id (OPS11-10).
//   8 · RELEASE.md and `npm run release:plan` (OPS11-06).
//   9 · CI red for the code, never for the clock or a busy runner: R34's two red runs were a stop and a yes inside one of
//       PGlite's milliseconds; R33's and R29's, screens given eight seconds on a busy runner (and OPS11-07's timeout).
// Every key here is built while the test runs, from made-up parts, so this file holds none for the audit to find.
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { routeLoader, NextResponseShim } from "./fixtures/moneyWorld.mjs";
import { keyFileKind, secretsIn } from "./secrets.audit.mjs";
import { pasteFile, whenLines, releaseSteps } from "./release.plan.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (t) => t.split("\n").map((l) => l.replace(/^\s*#.*$/, "").replace(/^\s*\/\/.*$/, "")).join("\n");

// ── 1 · no key in the repository (OPS11-16) ──────────────────────────────────────────────────────────────────────
{
  const gi = read(".gitignore");
  ok(".gitignore holds the keys this business handles by hand out of git: .p8, .p12, .pfx, .key, .mobileprovision, AuthKey_*",
    ["*.p8", "*.p12", "*.pfx", "*.key", "*.mobileprovision", "AuthKey_*", "*.pem", ".env*"].every((p) => gi.split("\n").includes(p)), gi.slice(-600));
  ok("a key file is known by its name — and an ordinary file isn't",
    keyFileKind("AuthKey_MADEUP12.p8") === "an Apple key (.p8)" && keyFileKind("ios/dist.p12") !== null && keyFileKind("x/App.mobileprovision") !== null
      && keyFileKind("certs/site.key") !== null && keyFileKind(".env.local") !== null && keyFileKind(".env.example") === null
      && keyFileKind("lib/appleKey.ts") === null && keyFileKind("README.md") === null);
  const body = "M".repeat(64);
  const begin = "-----BEGIN " + "PRIVATE KEY-----", end = "-----END " + "PRIVATE KEY-----";
  ok("a private key's block is found — on its own lines, or as one line with \\n in it — and its header alone (code that writes one) isn't",
    secretsIn([begin, body, body, end].join("\n")).some((f) => f.kind === "a private key")
      && secretsIn(`KEY="${begin}\\n${body}\\n${end}"`).some((f) => f.kind === "a private key")
      && secretsIn(`echo "${begin}"; printf '%s' "$body"`).length === 0
      && secretsIn([begin, "bm90IGEga2V5IGF0IGFsbA==", end].join("\n")).length === 0);
  const live = "sk_" + "live_" + "Z".repeat(24), test = "sk_" + "test_" + "Z".repeat(24);
  ok("a live Stripe key is a finding, a test one isn't; a cloud key and a code-host token are", secretsIn(`const k = "${live}";`).length === 1 && secretsIn(`const k = "${test}";`).length === 0
    && secretsIn("AKIA" + "Q".repeat(16)).length === 1 && secretsIn("gh" + "p_" + "a".repeat(36)).length === 1);
  const jwt = (role) => ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ iss: "supabase", role, ref: "made-up" })).toString("base64url"), "c2lnbmF0dXJlLW1hZGUtdXA"].join(".");
  ok("a Supabase key is read for its role: the service role's is a finding; the anon key — public by design — isn't",
    secretsIn(`KEY=${jwt("service_role")}`).some((f) => f.kind === "a Supabase service-role key") && secretsIn(`KEY=${jwt("anon")}`).length === 0);
  ok("…and what it prints is the file, the line and the kind — never what matched", !/console\.log\([^)]*\bmatch\b/.test(read("scripts/secrets.audit.mjs"))
    && /holds \$\{h\}/.test(read("scripts/secrets.audit.mjs")) && /`\$\{f\}:\$\{s\.line\} — \$\{s\.kind\}`/.test(read("scripts/secrets.audit.mjs")));
}

// ── 2 · the owner's gate is CI's (OPS11-05) ─────────────────────────────────────────────────────────────────────────
{
  const s = JSON.parse(read("package.json")).scripts;
  ok("the lint ratchet is the first audit, its eslint report handed to render.audit — one pass, not two",
    s.audit.startsWith("LINT_OUT=.lint.json node scripts/lint.ratchet.mjs && LINT_JSON=.lint.json node scripts/render.audit.mjs && ")
      && /if \(process\.env\.LINT_OUT\) writeFileSync\(process\.env\.LINT_OUT, out\);/.test(read("scripts/lint.ratchet.mjs")) && read(".gitignore").split("\n").includes("/.lint.json"));
  ok("…the secrets audit runs with every audit", / && node scripts\/secrets\.audit\.mjs$/.test(s.audit));
  ok("`npm run release` is verify, then npm's advisories — the two CI runs — and `advisories` asks what ships, high and critical",
    s.release === "npm run verify && npm run advisories" && s.advisories === "npm audit --omit=dev --audit-level=high" && s["release:plan"] === "node scripts/release.plan.mjs");
  const ci = code(read(".github/workflows/ci.yml"));
  ok("CI runs verify by name and the advisories beside it — and no lint step of its own any more (verify runs it)",
    /run: npm run verify$/m.test(ci) && /run: npm audit --omit=dev --audit-level=high$/m.test(ci) && !/run: node scripts\/lint\.ratchet\.mjs/.test(ci));
  const readme = read("README.md");
  ok("…and the README says so: release is the whole gate, and RELEASE.md the sequence after it",
    /npm run release {12}# the whole gate/.test(readme) && /The ship sequence after it is RELEASE\.md\./.test(readme) && !/CI runs exactly this\. Green before any ship\./.test(readme));
}

// ── 3 · the production check, against a stand-in site (OPS11-13, -04) ────────────────────────────────────────────────
const runProd = (env, args = ["--quick"]) => new Promise((resolve) => {
  const p = spawn(process.execPath, [new URL("./verify.prod.mjs", import.meta.url).pathname, ...args], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, cwd: new URL("..", import.meta.url).pathname,
  });
  let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  const kill = setTimeout(() => p.kill("SIGKILL"), 90_000);
  p.on("close", (codeOut) => { clearTimeout(kill); resolve({ code: codeOut, out }); });
});
async function standIn(answers) {
  const server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    const a = answers[path];
    if (!a) { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
    res.writeHead(a.status ?? 200, { "content-type": "application/json" }); res.end(JSON.stringify(a.body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
{
  // Nobody home: a port nothing listens on.
  const gone = await runProd({ GT3_APP_URL: "http://127.0.0.1:9" });
  ok("a site that doesn't answer: the run names it — '✗ live: /api/health answers ok → no answer (…)' — and goes on to the ledger and the probes, never a stack trace",
    gone.code === 1 && /✗ live: \/api\/health answers ok → no answer/.test(gone.out) && /current: /.test(gone.out) && /answers: GET \/api\/menu/.test(gone.out)
      && !/at async|TypeError: fetch failed\n\s+at /.test(gone.out), gone.out.slice(0, 900));
  const files = (await import("./migrations.pending.mjs")).migrationFiles();
  const seqs = files.map((m) => m.seq).filter((n) => n <= 437 && n !== 376 && n !== 424);
  const site = (cron, ledgerSeqs) => standIn({
    "/api/health": { body: { ok: true, build: { commitShort: "made0up" }, probe: false, cron, hooks: cron } },
    "/api/migrations": { body: { ok: true, count: ledgerSeqs.length, max_seq: Math.max(...ledgerSeqs), seqs: ledgerSeqs } },
  });
  const s1 = await site(null, seqs);
  const unmeasured = await runProd({ GT3_APP_URL: s1.url });
  await s1.close();
  ok("0430 in the ledger and /api/health saying cron: null — a ✗ that names the database not answering, not 'isn't pasted yet'",
    /✗ live: the scheduled jobs are measured — 0430 is applied/.test(unmeasured.out) && /✗ live: the push webhooks are measured/.test(unmeasured.out)
      && !/0430 isn't pasted yet/.test(unmeasured.out), unmeasured.out.slice(0, 1500));
  const s2 = await site(null, seqs.filter((n) => n < 430));
  const before = await runProd({ GT3_APP_URL: s2.url });
  await s2.close();
  ok("…and before 0430 is in the ledger, the same answer is 'not measured — 0430 isn't pasted yet', said and not failed",
    /· cron: not measured — 0430 isn't pasted yet \(the ledger doesn't hold it\)/.test(before.out) && !/✗ live: the scheduled jobs are measured/.test(before.out), before.out.slice(0, 1500));
  const vp = read("scripts/verify.prod.mjs");
  ok("the snapshot unread past two days is a ✗ on the full run — and only said on the half-hourly one",
    /if \(notChecked && !QUICK && age !== null && age > 48\) ok\(`posture: the security snapshot covers what production runs/.test(vp) && /else if \(notChecked\) \{ console\.log/.test(vp));
}

// ── 4 · the half-hourly check installs nothing (OPS11-11) ─────────────────────────────────────────────────────────────
{
  const pr = read(".github/workflows/production.yml");
  ok("`npm ci` runs only for the runs with a browser — the half-hourly one installs nothing",
    /- run: npm ci\n\s+if: steps\.form\.outputs\.browser == 'yes'/.test(pr) && (pr.match(/run: npm ci/g) || []).length === 1
      && pr.indexOf("name: Decide the form") < pr.indexOf("- run: npm ci"));
  // …and caches nothing: setup-node's post step saves the npm cache whenever the lockfile's isn't saved yet, and on a run
  // that installed nothing there is no folder to save — the job fails. The cache rides with the install, or not at all.
  const job = pr.slice(0, pr.indexOf("\n  advisories:"));
  const nodes = [...job.matchAll(/- uses: actions\/setup-node@[0-9a-f]{40} # v[\d.]+\n((?: {8,}.*\n)+)/g)].map((m) => m[1]);
  ok("…and caches nothing: setup-node's npm cache only on the runs that install (a run with nothing to save fails in its post step), a plain setup-node on the quick one",
    nodes.length === 2 && /if: steps\.form\.outputs\.browser == 'yes'/.test(nodes[0]) && /cache: npm/.test(nodes[0])
      && /if: steps\.form\.outputs\.browser != 'yes'/.test(nodes[1]) && !/cache:/.test(nodes[1])
      && job.indexOf("name: Decide the form") < job.indexOf("- uses: actions/setup-node@"), nodes);
  // …and needs nothing installed: every import the quick half reaches is Node's own or the repository's.
  const reaches = ["scripts/verify.prod.mjs", "scripts/design.measure.mjs", "scripts/design.ratchet.mjs", "scripts/migrations.pending.mjs", "scripts/security.audit.mjs"];
  const packages = reaches.flatMap((f) => [...read(f).matchAll(/^import [^;]*? from "([^"]+)";$/gm)].map((m) => m[1]).filter((spec) => !spec.startsWith("node:") && !spec.startsWith("./")).map((spec) => `${f}: ${spec}`));
  const quickEnds = vp().indexOf("if (QUICK) {"), firstRequire = vp().search(/require\("(playwright|axe-core)/);
  function vp() { return read("scripts/verify.prod.mjs"); }
  ok("…its half of verify:prod imports Node's own modules and the repository's only; the browser and axe are asked for after the quick run has ended",
    packages.length === 0 && quickEnds > 0 && firstRequire > quickEnds, { packages, quickEnds, firstRequire });
}

// ── 5 · TestFlight: main, and a commit CI passed; the build carries its commit (OPS11-12) ─────────────────────────────
{
  const ios = read(".github/workflows/ios.yml");
  ok("the upload refuses a branch that isn't main, by name — never a skip",
    /if \[ "\$GITHUB_REF" != "refs\/heads\/main" \]; then\n\s+echo "::error::TestFlight takes main only/.test(ios));
  ok("…and a commit ci.yml hasn't passed, read with the runs' own permission (actions: read) and nothing more",
    /gh run list --repo "\$GITHUB_REPOSITORY" --workflow ci\.yml --commit "\$GITHUB_SHA"/.test(ios) && /if \[ "\$ci" != "completed success" \]; then/.test(ios)
      && /permissions:\n\s+contents: read\n\s+actions: read/.test(ios)
      && /--jq 'if length == 0 then "no run" else \(\.\[0\] \| "\\\(\.status\) \\\(\.conclusion\)"\) end'/.test(ios));
  ok("the build carries its commit, and the job's summary says which build is which commit",
    /GT3_BUILD_COMMIT: \$\{\{ github\.sha \}\}\n\s+run: npm run build:app -- --web-config https:\/\/app\.gt3pb\.com/.test(ios)
      && /TestFlight build \$\{\{ github\.run_number \}\} is commit \$\{GITHUB_SHA:0:7\} of main\./.test(ios));
  ok("…into the app's own build (next.config's app config), and a crash report from a phone names it",
    /NEXT_PUBLIC_BUILD_COMMIT: \(process\.env\.GT3_BUILD_COMMIT \?\? ""\)\.slice\(0, 40\)/.test(read("next.config.ts"))
      && /ua: `\$\{APP_BUILD && process\.env\.NEXT_PUBLIC_BUILD_COMMIT \? `app \$\{process\.env\.NEXT_PUBLIC_BUILD_COMMIT\.slice\(0, 7\)\} · ` : ""\}\$\{navigator\.userAgent\}`\.slice\(0, 200\),/.test(read("components/ErrorReporter.tsx")));
}

// ── 6 · the signed-in smoke sees the console itself (OPS11-09) ────────────────────────────────────────────────────────
{
  const sa = read("scripts/smoke.authed.mjs");
  ok("a section is in only when the console's own frame and header are drawn — the two-step prompt, or an empty 'Opening the console…', is the wall",
    /const drawn = await page\.evaluate\(\(\) => !!document\.querySelector\("section\.screen\.admin \.op-head \.op-head-t"\)\)/.test(sa)
      && /const prompt = \/Set up two-step sign-in\|Your two-step code\|Opening the console\/i/.test(sa) && /const walled = !drawn \|\| prompt \|\|/.test(sa));
  const crew = read("app/crew/page.tsx"), tsp = read("components/TwoStepPrompt.tsx");
  ok("…and those are what the app draws: the console's frame and header, the prompt's two titles, the check's line",
    /<section className="screen admin">/.test(crew) && /className="op-head-t"/.test(crew) && /Opening the console…/.test(crew)
      && /Set up two-step sign-in/.test(tsp) && /Your two-step code/.test(tsp));
}

// ── 7 · a route's thrown line carries the platform's request id (OPS11-10) ────────────────────────────────────────────
{
  const filed = [];
  const R = routeLoader({ "next/server": { NextResponse: NextResponseShim }, "@/lib/errorIntake": { fileError: async (r) => { filed.push(r); } } })("lib/apiRoute.ts");
  const lines = [], real = console.error;
  console.error = (...a) => lines.push(a.join(" "));
  try {
    const h = R.route("made-up/door", async () => { throw new Error("made-up failure"); });
    const res = await h(new Request("https://app.example.test/api/made-up/door", { headers: { "x-vercel-id": "iad1::made-up-1234567890" } }));
    const odd = await R.route("made-up/door", async () => { throw new Error("made-up failure"); })(new Request("https://app.example.test/x", { headers: { "x-vercel-id": "<script>" } }));
    ok("a route that threw: its one log line carries the request's id — found beside the request's own log — and the filed row is the server's, as the intake reads it",
      res.status === 500 && /\[route-threw\] \{"route":"made-up\/door","message":"made-up failure",.*"request":"iad1::made-up-1234567890"\}/.test(lines[0] ?? "") && filed[0]?.ua === "server", { lines, filed });
    ok("…and an id that isn't one is left out, never written as it came", odd.status === 500 && !/<script>/.test(lines[1] ?? "") && !/"request"/.test(lines[1] ?? ""), lines[1]);
  } finally { console.error = real; }
}

// ── 8 · RELEASE.md and `npm run release:plan` (OPS11-06) ──────────────────────────────────────────────────────────────
{
  const paste = pasteFile(read("supabase/APPLY_ALL_PENDING.sql"));
  ok("the plan reads the paste file: what is pending, by file", paste.from === "0439" && paste.count === 2 && paste.files.join() === "0438_a_way_back_without_the_authenticator.sql,0439_a_checkouts_key_is_kept_as_long_as_it_can_matter.sql", paste);
  ok("…and a migration's own 'when' from its header — a moment or an order, not its changelog or its verify lines",
    whenLines("-- WHY. …\n-- Deploy the push function BEFORE pasting this one.\n-- changelog: below.\n-- verify: paste after\nselect 1;").join("|") === "Deploy the push function BEFORE pasting this one.");
  const steps = releaseSteps({ pending: [{ file: "0439_x.sql" }], held: [{ file: "0424_y.sql", until: "the iPhone build is on the phones" }], pushVersion: "made-up R0", snapshot: { notChecked: false } });
  ok("the steps in order: the gate, the push, the paste when service is quiet, the snapshot, the push function, what is held, the watch",
    /npm run release/.test(steps[0]) && /^Push main/.test(steps[1]) && /when service is quiet/.test(steps[2]) && /Re-pull the security snapshot/.test(steps[3])
      && /made-up R0/.test(steps[4]) && /Held, not in the paste file: 0424_y\.sql — until the iPhone build is on the phones\./.test(steps[5]) && /Production workflow/.test(steps[6]), steps);
  const plan = await new Promise((resolve) => {
    const p = spawn(process.execPath, [new URL("./release.plan.mjs", import.meta.url).pathname], { env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    let out = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("close", (c) => resolve({ code: c, out }));
  });
  ok("…and `npm run release:plan` runs on this tree: the paste file's two by name and count, what is held, the push function, the snapshot, then the steps",
    plan.code === 0 && /written as of 0439\): 2\n  · 0438_/.test(plan.out) && /Held on purpose \(supabase\/held\.json\): 2\n  · 0376_/.test(plan.out)
      && /The push function this tree carries: \d{4}-\d{2}-\d{2} R\d+/.test(plan.out) && /The security snapshot: pulled /.test(plan.out) && /\n  1\. On the patch's tree: npm ci && npm run release/.test(plan.out), plan.out.slice(0, 900));
  const rel = read("RELEASE.md");
  ok("RELEASE.md: the gate, the push, the database after the deploy, the push function, what is held, the iPhone app, what each red line means, and the way back",
    ["## 1 · Before the push", "## 2 · The push", "## 3 · The database, after the deploy", "## 4 · The push function", "## 5 · Held on purpose", "## 6 · The iPhone app", "## What a red Production run means", "## Rolling back"].every((h) => rel.includes(h))
      && /npm run release:plan/.test(rel));
}
// ── 9 · CI red for the code, never for the clock or a busy runner (R34's two red runs, R33's and R29's) ─────────────────
{
  // The harness first: under the coarse clock PGlite's now() ties back to back, and nextTick moves it — so a file that
  // passes clock.ties passed because it reads no order out of a tie, not because the clock was never coarse.
  const probe = `import { PGlite } from "@electric-sql/pglite";
import { nextTick } from "./scripts/fixtures/clock.mjs";
const db = new PGlite();
let ties = 0, prev = null;
for (let i = 0; i < 40; i++) { const t = (await db.query("select now()::text t")).rows[0].t; if (t === prev) ties++; prev = t; }
const a = (await db.query("select now() t")).rows[0].t; await nextTick(); const b = (await db.query("select now() t")).rows[0].t;
console.log(JSON.stringify({ ties, later: b > a }));`;
  const seen = await new Promise((resolve) => {
    const p = spawn(process.execPath, ["--import", new URL("./fixtures/coarseClock.mjs", import.meta.url).pathname, "--input-type=module", "-e", probe],
      { cwd: new URL("..", import.meta.url).pathname, env: { PATH: process.env.PATH, HOME: process.env.HOME, COARSE_MS: "40" } });
    let out = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("close", () => { try { resolve(JSON.parse(out.trim().split("\n").at(-1))); } catch { resolve({ out: out.slice(0, 400) }); } });
  });
  ok("the coarse clock makes PGlite's now() tie back to back, and nextTick moves it — the harness can see a tie",
    seen.ties >= 30 && seen.later === true, seen);
  const { underCoarseClock, pgliteTests } = await import("./clock.ties.mjs");
  const three = ["scripts/db.r9abuse.test.mjs", "scripts/db.alertwave2.test.mjs", "scripts/db.ratelimit.test.mjs"];
  const res = await underCoarseClock(three, { conc: 3 });
  ok("the three that read an order out of a tie read none now — R9's stop-then-yes (red on both of R34's runs), 0372's quiet line, the next window",
    res.length === 3 && res.every((r) => r.code === 0), res.map((r) => ({ file: r.file, code: r.code, failed: r.failed, tail: r.tail })));
  ok("…by saying 'then': the consent writes wait for the clock, the quiet line is found by its id, the next window waits for its millisecond",
    /const say = async \(phone, yes, source\) => \{ await nextTick\(\); return as\("service"/.test(read("scripts/db.r9abuse.test.mjs"))
      && /const quietNow = loud\.find\(\(l\) => l\.id === fyiLine\.id\);/.test(read("scripts/db.alertwave2.test.mjs"))
      // by its id in the check itself, and no line read by its place — under a tie the place is the ids' coin toss, so the
      // coarse clock alone catches a check that goes back to loud[0] only half the time
      && /&& quietNow\?\.ack_at != null && quietNow\.ack_by === null, loud\);/.test(read("scripts/db.alertwave2.test.mjs")) && !/\bloud\[\d\]/.test(read("scripts/db.alertwave2.test.mjs"))
      && /const a = await hit\("test:win", 1, 1\);\n\s+await nextTick\(\);/.test(read("scripts/db.ratelimit.test.mjs")));
  ok("`npm run clock:ties` runs every PGlite test the gate runs under that clock — the way to find the next one",
    JSON.parse(read("package.json")).scripts["clock:ties"] === "node scripts/clock.ties.mjs" && pgliteTests().length >= 100 && pgliteTests().includes("scripts/db.r9abuse.test.mjs"));
  const sn = read("scripts/smoke.native.mjs");
  ok("the native smoke gives everything it waits for twenty seconds — a screen coming up (R29's /playbook on the SE, at eight), the Pass on an iPad (R40's own chain, run after a build), every sheet and row — and a board that never drew is a ✗, not a throw",
    /const PATIENCE_MS = 20_000;/.test(sn) && !/timeout: (?:5000|6000|8000|10000|15000)\b/.test(sn) && !/waitForFunction\(BRIDGE_UP, null, \{ timeout: \d+ \}\)/.test(sn)
      && (sn.match(/waitForFunction\(BRIDGE_UP, null, \{ timeout: PATIENCE_MS \}\)/g) || []).length === 6 && (sn.match(/timeout: PATIENCE_MS/g) || []).length >= 80
      && /c\.plugin === "SplashScreen" && c\.method === "hide"\), null, \{ timeout: PATIENCE_MS \}\)/.test(sn)
      && /pageScrolls: frame \? frame\.scrollHeight > frame\.clientHeight \+ 1 : null/.test(sn) && /wide\.pageScrolls === false/.test(sn));
  const tw = read("app/tailwind.css"), nbc = read("components/NativeBridge.css"), lay = read("app/layout.tsx");
  ok("the banner's rules are in force at the first paint — the global stylesheet, under the app's own build — not in the bridge's, which comes after it (R40's own chain: everything under the banner rose 62pt as it landed); the native smoke holds the bridge's stylesheet back, so a late one is every run",
    (tw.match(/^html\[data-build="app"\] :is\(\.app:has\(>\.bcast\),\[data-hold-bcast\] \.app:has\(>\.hold-slot\[data-hold="bcast"\]\)\) /gm) || []).length === 3
      && !/bcast/.test(nbc.replace(/\/\*[\s\S]*?\*\//g, "")) && /<html lang="en" data-build=\{APP_BUILD \? "app" : undefined\}>/.test(lay)
      && /if \(body\.includes\("\.native-bar\{"\)\) await new Promise\(\(r\) => setTimeout\(r, 1500\)\);/.test(sn) && /…with the bridge's stylesheet arriving last, as a slow phone has it/.test(sn) && /held\.bridgeCss === true && held\.shift < 0\.01/.test(sn));
  const ciy = read(".github/workflows/ci.yml");
  ok("CI lets a slow green run finish: 40 minutes for a gate that took 21", /runs-on: ubuntu-24\.04\n(?:\s+#.*\n)+\s+timeout-minutes: 40\n\s+steps:/.test(ciy));
  ok("…and TestFlight's refusal says what to do with a red run: open it, fix it or re-run it",
    /Failed: open that run, fix it or re-run it, and once it is green run this again\./.test(read(".github/workflows/ios.yml")));
}

{
  const pkg = JSON.parse(read("package.json"));
  ok("this file runs with every test", /node scripts\/r39\.test\.mjs && node scripts\/r40\.test\.mjs/.test(pkg.scripts.test));
}

console.log(`\nR40 — THE GATES SAY WHAT THEY SEE: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
