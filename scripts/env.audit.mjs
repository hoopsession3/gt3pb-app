// THE SETTINGS, DECLARED (R14, 2026-10-16 — the 10/10 audit's operations pass, F14).
//
// Every environment name the app reads is in lib/envSchema.ts, with what goes off without it — and every name there is
// read somewhere. Both ways, because each half has bitten: a name read in one file and set under another spelling (the
// feature it guards silently off), and a name kept in a runbook long after the code stopped reading it (NEXT_PUBLIC_SQUARE_ENV,
// "retired", set by hand in every new deploy). Also: a NEXT_PUBLIC_ name is declared public, and the names the iPhone
// build takes from the web (lib/publicConfig.json) are all declared.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { libLoader } from "./fixtures/chargeonce.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The environment names a source reads: process.env.NAME. */
export function readsIn(src) {
  return [...src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);
}

/** What is wrong between what the app reads and what is declared. Pure. */
export function envFindings(reads, list, publicNames = []) {
  const declared = new Map();
  const dup = [];
  for (const e of list) { if (declared.has(e.name)) dup.push(e.name); declared.set(e.name, e); }
  const undeclared = [...reads.keys()].filter((n) => !declared.has(n)).sort();
  const unread = list.filter((e) => !reads.has(e.name) && !publicNames.includes(e.name)).map((e) => e.name).sort();
  const wrongSide = list.filter((e) => e.name.startsWith("NEXT_PUBLIC_") !== (e.side === "public")).map((e) => e.name).sort();
  const publicUndeclared = publicNames.filter((n) => !declared.has(n)).sort();
  return { dup, undeclared, unread, wrongSide, publicUndeclared };
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|\.next|\.git|\.smoke|out|\.app-build)$/.test(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const files = [...["app", "components", "lib"].flatMap((d) => walk(join(ROOT, d))), ...["instrumentation.ts", "proxy.ts", "next.config.ts"].map((f) => join(ROOT, f)).filter(existsSync)];
  const reads = new Map();
  for (const f of files) for (const n of readsIn(readFileSync(f, "utf8"))) {
    if (!reads.has(n)) reads.set(n, new Set());
    reads.get(n).add(f.slice(ROOT.length + 1));
  }
  const { ENV } = libLoader()("lib/envSchema.ts");
  const { names: publicNames } = JSON.parse(readFileSync(join(ROOT, "lib/publicConfig.json"), "utf8"));
  const f = envFindings(reads, ENV, publicNames);
  const n = f.dup.length + f.undeclared.length + f.unread.length + f.wrongSide.length + f.publicUndeclared.length;
  console.log(`ENV AUDIT: ${ENV.length} names declared (lib/envSchema), ${reads.size} read by the app — ${n ? `${n} finding(s)` : "every one declared, every declaration read"}`);
  for (const x of f.undeclared) console.log(`    read but not declared: ${x}  ← ${[...reads.get(x)].join(", ")}`);
  for (const x of f.unread) console.log(`    declared but read nowhere: ${x}`);
  for (const x of f.wrongSide) console.log(`    declared on the wrong side (NEXT_PUBLIC_ is public, nothing else is): ${x}`);
  for (const x of f.publicUndeclared) console.log(`    the iPhone build takes it from the web (lib/publicConfig.json) but it isn't declared: ${x}`);
  for (const x of f.dup) console.log(`    declared twice: ${x}`);
  if (n) {
    console.log(`\n  ✗ Declare it in lib/envSchema.ts (with what goes off without it), or stop reading it — and take a retired name out of the runbooks too.`);
    process.exit(1);
  }
}
