// THE APP BUILD — the same screens, as a static export, for the iPhone app (2026-10-06, the iPhone round).
//
//   npm run build:app          → out/  (what `npx cap sync ios` copies into the app)
//
// One codebase, two outputs. `next build` makes the web exactly as before (Vercel runs that one). This
// makes the app's copy: Next's static export (next.config.ts, NEXT_PUBLIC_GT3_TARGET=app), which needs
// the parts that only a server can run left out — so it builds from a copy of the tree, never touching
// the tree itself:
//   · app/api        — the 76 routes stay on Vercel; the app calls them there (lib/native apiUrl).
//   · proxy.ts       — the web's front-door redirect; the app's home page does the same on its own.
//   · any route.ts   — a route handler is a server.
//   · app/manifest.ts — the web app's install manifest; an installed app has no use for one.
//   · /built/[key], /c/[code], /primal/l/[slug] — pages per database id, which an export cannot make
//                      ahead of time. Partner and printed-QR pages stay on the web; the lesson has an
//                      app page of its own (native/routes, copied in here; lib/native lessonHref).
// The copy sits inside the project (.app-build/), so it resolves the project's own node_modules, and
// it is deleted when the build ends either way.
//
//   npm run build:app -- --smoke   → the build scripts/smoke.native.mjs opens (`npm run verify` makes it)
//
// THE SMOKE BUILD points the app at a stand-in backend that the smoke answers itself, in the browser:
// https://gt3-smoke.supabase.co — an address the app's own policy already allows (*.supabase.co), so
// the policy is tested as it ships — with a made-up "key". So the crew console can be opened signed in,
// in CI, with nothing real behind it. It reads no .env file (a smoke build is the same on every machine),
// and says what it is in out/gt3-smoke-build.json, which only it writes: the TestFlight job refuses an
// out/ that has one.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SMOKE = process.argv.includes("--smoke");
const SMOKE_BACKEND = { NEXT_PUBLIC_SUPABASE_URL: "https://gt3-smoke.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "smoke-anon-not-a-key" };
const WORK = join(ROOT, ".app-build");
const OUT = join(ROOT, "out");

// What never goes into the copy: version control, dependencies, other builds, the native projects.
const SKIP_TOP = new Set([".git", "node_modules", ".next", "out", ".app-build", "ios", "android", ".smoke", "coverage", "package-lock.json"]);
// What the export cannot have (above). Paths relative to the project.
const LEAVE_OUT = ["app/api", "proxy.ts", "app/manifest.ts", "app/built", "app/c", join("app", "primal", "l")];
// The pages among them, as the addresses a link would use (/built/…, /c/…, /primal/l/…). The app is
// told them (NEXT_PUBLIC_GT3_WEB_ONLY), so a link to one opens the web's page in the in-app browser
// instead of landing on the app's home screen (components/NativeBridge). From this one list, so a page
// left out here is never a dead link there.
const WEB_ONLY = LEAVE_OUT.filter((p) => p.startsWith(`app${sep}`) || p.startsWith("app/"))
  .map((p) => p.split(sep).join("/").slice("app".length))
  .filter((p) => p !== "/api" && !/\.[a-z]+$/.test(p))
  .map((p) => `${p}/`);

const say = (s) => console.log(`build:app — ${s}`);

// THE WEB'S PUBLIC SETTINGS (2026-10-10). `--web-config https://app.gt3pb.com` (the TestFlight job) fills each
// NEXT_PUBLIC_ setting on lib/publicConfig.json's list that this environment leaves unset or empty, from what the web
// answers at /api/public-config (app/api/public-config). One the environment sets wins. The names that came from the
// web are printed, never their values. If the web does not answer, the build goes on with what it has, and says so;
// the smoke build never asks.
const WEB_CONFIG = (() => { const i = process.argv.indexOf("--web-config"); return i > 0 ? process.argv[i + 1] : null; })();
const PRINTABLE = /^[\x20-\x7e]{1,300}$/;
async function fromTheWeb(origin) {
  const { names } = JSON.parse(readFileSync(join(ROOT, "lib", "publicConfig.json"), "utf8"));
  let values;
  try {
    const r = await fetch(new URL("/api/public-config", origin), { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    values = (await r.json())?.values ?? {};
  } catch (e) {
    say(`the web's public settings did not arrive from ${origin} (${e.message}) — building with this environment's alone`);
    return {};
  }
  const got = {};
  for (const n of names) {
    if (!n.startsWith("NEXT_PUBLIC_") || process.env[n]) continue;
    if (typeof values[n] === "string" && PRINTABLE.test(values[n])) got[n] = values[n];
  }
  say(Object.keys(got).length ? `from the web (${origin}): ${Object.keys(got).join(", ")}` : `from the web (${origin}): nothing this environment lacks`);
  return got;
}
const FROM_WEB = WEB_CONFIG && !SMOKE ? await fromTheWeb(WEB_CONFIG) : {};
// The smoke build takes none of this machine's NEXT_PUBLIC_ values, so it is the same build everywhere.
const withoutPublicValues = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("NEXT_PUBLIC_")));

// Whether any script under `dir` holds `text` (a value Next.js was to write into the export).
function carries(dir, text) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory() ? carries(p, text) : readFileSync(p, "utf8").includes(text)) return true;
  }
  return false;
}

function routeHandlers(dir) {
  const found = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) found.push(...routeHandlers(p));
    else if (/^route\.(t|j)sx?$/.test(e.name)) found.push(p);
  }
  return found;
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK);
let ok = false;
try {
  for (const name of readdirSync(ROOT)) {
    if (SKIP_TOP.has(name)) continue;
    if (SMOKE && name.startsWith(".env")) continue;
    cpSync(join(ROOT, name), join(WORK, name), { recursive: true, verbatimSymlinks: true });
  }
  for (const rel of LEAVE_OUT) rmSync(join(WORK, rel), { recursive: true, force: true });
  const handlers = routeHandlers(join(WORK, "app"));
  for (const h of handlers) rmSync(h);
  // The app's own pages for what the web makes per request (lib/native lessonHref says why).
  cpSync(join(ROOT, "native", "routes"), join(WORK, "app"), { recursive: true });
  say(`building the export from a copy of the tree (left out: ${LEAVE_OUT.join(", ")}${handlers.length ? `, ${handlers.length} more route handler(s)` : ""})`);

  const next = join(ROOT, "node_modules", ".bin", "next");
  const r = spawnSync(next, ["build"], {
    cwd: WORK,
    stdio: "inherit",
    env: { ...(SMOKE ? withoutPublicValues(process.env) : { ...process.env, ...FROM_WEB }), ...(SMOKE ? SMOKE_BACKEND : {}), NEXT_PUBLIC_GT3_TARGET: "app", NEXT_PUBLIC_GT3_WEB_ONLY: WEB_ONLY.join(","), NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (r.status !== 0) throw new Error(`next build exited ${r.status}`);

  rmSync(OUT, { recursive: true, force: true });
  renameSync(join(WORK, "out"), OUT);
  if (SMOKE) writeFileSync(join(OUT, "gt3-smoke-build.json"), JSON.stringify({ smoke: true, backend: SMOKE_BACKEND.NEXT_PUBLIC_SUPABASE_URL, why: "scripts/build.app.mjs --smoke: for scripts/smoke.native.mjs only — never ship this out/" }, null, 2) + "\n");

  // What the app cannot do without — held here, so a build that quietly lost a page fails now, not
  // on a phone. Next 16's export writes crew.html beside crew.txt (the data a client navigation reads).
  const must = ["index.html", "404.html", "crew.html", "crew.txt", "menu.html", "truck.html", "primal.html", join("primal", "lesson.html"), "privacy.html", "terms.html"];
  const missing = must.filter((f) => !existsSync(join(OUT, f)));
  if (missing.length) throw new Error(`the export is missing ${missing.join(", ")}`);
  if (existsSync(join(OUT, "api"))) throw new Error("the export has an api/ folder — a route handler slipped in");
  const html = readFileSync(join(OUT, "index.html"), "utf8");
  if (!html.includes('http-equiv="Content-Security-Policy"')) throw new Error("index.html carries no CSP meta tag");
  if (!/viewport-fit=cover/.test(html)) throw new Error("index.html's viewport does not say viewport-fit=cover");
  // The card form is what the web's settings were fetched for: when Square's two came from the web, the export carries them.
  for (const n of ["NEXT_PUBLIC_SQUARE_APP_ID", "NEXT_PUBLIC_SQUARE_LOCATION_ID"]) {
    if (FROM_WEB[n] && !carries(join(OUT, "_next", "static"), FROM_WEB[n])) throw new Error(`the export does not carry ${n}, which the web gave`);
  }

  let files = 0, bytes = 0;
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else { files++; bytes += statSync(p).size; } } };
  walk(OUT);
  say(SMOKE
    ? `out/ — ${files} files, ${(bytes / 1048576).toFixed(1)} MB — THE SMOKE BUILD (stand-in backend): for scripts/smoke.native.mjs, never for the app`
    : `out/ — ${files} files, ${(bytes / 1048576).toFixed(1)} MB; ${relative(ROOT, OUT).split(sep).join("/")}/ is what \`npx cap sync ios\` copies into the app`);
  ok = true;
} finally {
  rmSync(WORK, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
