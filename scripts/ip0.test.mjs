// IP0 — CONFIDENTIAL CONTENT STAYS ON THE SERVER (2026-10-27 — Ryan: "Verify whether proprietary recipes, cookbook
// instructions, ratios or process details are present in publicly accessible JavaScript… enforce server-side
// authorization and verify the remediation. Do not print confidential recipes in audit output").
//
// Production served the whole cookbook (lib/academy PRODUCTS[].cookbook) and the whole strategy playbook (lib/strategy)
// to anyone who opened /academy or /playbook — 73 of 73 and 76 of 76 passages, fetched signed out. This test holds the fix:
//   1 · No module a browser can load reaches lib/academyCookbook or lib/strategyContent — walked import by import
//       from every client entry (every "use client" file, every page and layout).
//   2 · No browser-reachable source holds any of their passages (fingerprints compared, never printed).
//   3 · The two routes that serve them check who's asking, check the tenant, and are never cached.
//   4 · The Studio's play names match the playbook's plays; the event brief carries no ratio.
//   5 · When a build is present, no shipped JavaScript holds a passage either.
// Output names counts and files only — never a passage.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 400)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const SECRET = ["lib/academyCookbook.ts", "lib/strategyContent.ts"];

// ── the import graph ────────────────────────────────────────────────────────────────────────────────────────────────
const walk = (dir, out = []) => { for (const f of readdirSync(join(ROOT, dir))) { const p = join(dir, f); const st = statSync(join(ROOT, p));
  if (st.isDirectory()) { if (!["node_modules", ".next", "out", ".smoke", ".smoke-console"].includes(f)) walk(p, out); } else if (/\.(tsx?|mjs|js)$/.test(f)) out.push(p); } return out; };
const files = [...walk("app"), ...walk("components"), ...walk("lib")];
const resolve = (from, spec) => {
  let base;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = join(dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, "index.ts"), join(base, "index.tsx")]) if (existsSync(join(ROOT, c)) && statSync(join(ROOT, c)).isFile()) return relative(ROOT, join(ROOT, c));
  return null;
};
const importsOf = (f) => {
  const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const specs = [...src.matchAll(/(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
  // A type-only import never reaches the bundle.
  const typeOnly = new Set([...src.matchAll(/import\s+type\s[^'"]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]));
  return specs.filter((s) => !typeOnly.has(s)).map((s) => resolve(f, s)).filter(Boolean);
};
const isClientEntry = (f) => !f.startsWith("app/api/") && (/^\s*["']use client["']/.test(read(f)) || /\/(page|layout|template|not-found|error|loading)\.tsx$/.test(f));
const entries = files.filter(isClientEntry);
const reach = new Map();   // file → the client entry it was first reached from
for (const e of entries) {
  const stack = [e];
  while (stack.length) { const f = stack.pop(); if (reach.has(f)) continue; reach.set(f, e); for (const g of importsOf(f)) if (!reach.has(g)) stack.push(g); }
}
{
  ok("the walk covers the app: every page and client component is an entry", entries.length > 100 && entries.includes("app/academy/page.tsx") && entries.includes("app/playbook/page.tsx"), entries.length);
  ok("…and it follows imports (the Academy page reaches lib/academy)", reach.has("lib/academy.ts"));
  for (const s of SECRET) ok(`no browser-loaded module reaches ${s}`, !reach.has(s), reach.get(s));
  const importers = (s) => files.filter((f) => importsOf(f).includes(s));
  ok("the cookbook is read only on the server: the agents' knowledge and its route", importers("lib/academyCookbook.ts").every((f) => f.startsWith("app/api/") || ["lib/operatorKb.ts", "lib/agentKnowledge.ts"].includes(f)), importers("lib/academyCookbook.ts"));
  ok("the playbook is read only by its route", importers("lib/strategyContent.ts").every((f) => f.startsWith("app/api/")), importers("lib/strategyContent.ts"));
  ok("…and the agents' knowledge modules are themselves never loaded by a browser", !reach.has("lib/operatorKb.ts") && !reach.has("lib/agentKnowledge.ts") && !reach.has("lib/brandVoice.ts"), [reach.get("lib/operatorKb.ts"), reach.get("lib/agentKnowledge.ts")]);
}

// ── fingerprints: every passage of 24+ characters, compared, never printed ────────────────────────────────────────
const passages = (v, out = []) => { if (typeof v === "string") { if (v.length >= 24) out.push(v.slice(0, 40)); } else if (Array.isArray(v)) v.forEach((x) => passages(x, out)); else if (v && typeof v === "object") Object.values(v).forEach((x) => passages(x, out)); return out; };
const COOK = passages(loadTs("lib/academyCookbook.ts").COOKBOOK);
const SC = loadTs("lib/strategyContent.ts");
const PLAY = passages({ core: SC.STRATEGY_CORE, plays: SC.GTM_PLAYS.map((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== "name"))), governance: SC.GOVERNANCE, flywheel: SC.FLYWHEEL });
{
  ok("there is something to protect (a cookbook of 70+ passages, a playbook of 70+)", COOK.length >= 70 && PLAY.length >= 70, [COOK.length, PLAY.length]);
  const shipped = [...reach.keys()].filter((f) => !SECRET.includes(f));
  const holds = (list) => shipped.filter((f) => { const t = read(f); return list.some((x) => t.includes(x)); });
  ok("no browser-reachable source holds a cookbook passage", holds(COOK).length === 0, holds(COOK));
  ok("no browser-reachable source holds a playbook passage", holds(PLAY).length === 0, holds(PLAY));
}

// ── the routes ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const cook = read("app/api/academy/cookbook/route.ts"), pb = read("app/api/playbook/route.ts");
  ok("the cookbook route answers only a caller the database lets read it (staff today, one constant to narrow)", /const COOKBOOK_AUDIENCE: "staff" \| "admin" = "staff";/.test(cook) && /if \(!\(await staffFromRequest\(req\)\)\) return NextResponse\.json\(\{ ok: false, error: "unauthorized" \}, \{ status: 401/.test(cook) && /COOKBOOK_AUDIENCE === "admin" && !\(await adminFromRequest\(req\)\)/.test(cook) && /status: 401/.test(cook));
  ok("the playbook route answers owners and admins only", /if \(!\(await adminFromRequest\(req\)\)\) return NextResponse\.json\(\{ ok: false, error: "unauthorized" \}, \{ status: 401/.test(pb));
  ok("both name the caller's tenant before answering", /tenantFromRequest\(req\)/.test(cook) && /tenantFromRequest\(req\)/.test(pb));
  ok("neither is ever cached — private, no-store, on every answer", [cook, pb].every((s) => /private, no-store, max-age=0/.test(s) && (s.match(/headers: PRIVATE/g) ?? []).length >= 2));
  ok("the service worker never caches /api (where they now live)", /\/api\//.test(read("public/sw.js")));
  const page = read("app/academy/page.tsx"), pbp = read("app/playbook/page.tsx");
  ok("the Academy reads the cookbook from the route, in memory only", /authedFetch\("\/api\/academy\/cookbook"\)/.test(page) && !/localStorage|sessionStorage/.test(page.slice(page.indexOf("function loadCookbook"), page.indexOf("function CookbookPanel"))));
  ok("the Playbook reads the playbook from the route, after the owner/admin gate", /authedFetch\("\/api\/playbook"\)/.test(pbp) && pbp.indexOf("return <PlaybookScreen role={role} />") > pbp.indexOf('role !== "owner" && role !== "admin"'));
}

// ── names, the brief ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const S = loadTs("lib/strategy.ts");
  ok("the Studio's play names are the playbook's plays, in order", JSON.stringify(S.GTM_PLAY_NAMES) === JSON.stringify(SC.GTM_PLAYS.map((p) => p.name)));
  ok("the event brief carries no extraction ratio", !/\b1:1\d\b/.test(read("lib/eventbrief.ts")));
}

// ── a build, when there is one ─────────────────────────────────────────────────────────────────────────────────────
{
  const dirs = [".next/static", "out/_next/static"].filter((d) => existsSync(join(ROOT, d)));
  const js = dirs.flatMap((d) => { const all = []; const w = (p) => { for (const f of readdirSync(join(ROOT, p))) { const q = join(p, f); if (statSync(join(ROOT, q)).isDirectory()) w(q); else if (f.endsWith(".js")) all.push(q); } }; w(d); return all; });
  const fresh = js.filter((f) => statSync(join(ROOT, f)).mtimeMs >= statSync(join(ROOT, "lib/academyCookbook.ts")).mtimeMs);
  if (fresh.length) {
    const leak = fresh.filter((f) => { const t = read(f); return COOK.some((x) => t.includes(x) || t.includes(JSON.stringify(x).slice(1, -1))) || PLAY.some((x) => t.includes(x) || t.includes(JSON.stringify(x).slice(1, -1))); });
    ok(`no shipped JavaScript holds a passage (${fresh.length} files from the latest build)`, leak.length === 0, leak.map((f) => relative(ROOT, join(ROOT, f))));
  }
}

console.log(`IP0 — CONFIDENTIAL CONTENT STAYS ON THE SERVER: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
