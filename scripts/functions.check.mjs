// THE PUSH FUNCTION, TYPE-CHECKED AND PINNED (R21, 2026-10-18 — the 10/10 audit, operations F12). supabase/functions/push
// runs on Supabase's Deno, outside the Next build: tsconfig.json leaves it out, so no type error in it was ever caught
// here, and it imported "npm:@supabase/supabase-js@2" — whatever 2.x npm had the day it was deployed. This checks it with
// the repo's TypeScript (tsconfig.functions.json: the Deno names it uses, supabase-js's real types) and holds every npm
// import of a function to an exact version — supabase-js's to the one the app installs, so one upgrade moves both.
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${typeof got === "string" ? got : JSON.stringify(got)}` : "")); } };

// 1 · the type check
{
  const cfgPath = join(ROOT, "tsconfig.functions.json");
  const read = ts.readConfigFile(cfgPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diags = [...ts.getPreEmitDiagnostics(program)];
  const said = diags.map((d) => {
    const where = d.file ? `${relative(ROOT, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}` : "(config)";
    return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
  ok("the push function type-checks (tsc -p tsconfig.functions.json): index.ts and policy.ts, against supabase-js's own types", !read.error && diags.length === 0, said.slice(0, 12).join("\n      "));
  const names = program.getSourceFiles().map((f) => relative(ROOT, f.fileName));
  ok("…and the check reads supabase-js itself, not an `any` stand-in", names.some((n) => n.startsWith("node_modules/@supabase/supabase-js/dist/")), names.filter((n) => !n.startsWith("node_modules/typescript")).slice(0, 8));
  ok("…every file of the function is in the check", ["supabase/functions/push/index.ts", "supabase/functions/push/policy.ts"].every((f) => parsed.fileNames.map((x) => relative(ROOT, x)).includes(f)));
}

// 2 · every npm import of every function at an exact version
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !n.endsWith(".d.ts") ? [p] : []; });
const files = walk(join(ROOT, "supabase/functions"));
const specs = files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/\bfrom\s+"([^"]+)"|\bimport\s*\(\s*"([^"]+)"\s*\)/g)].map((m) => ({ file: relative(ROOT, f), spec: m[1] ?? m[2] })));
const outside = specs.filter((s) => !s.spec.startsWith("./") && !s.spec.startsWith("../"));
ok("every import from outside a function is an npm package at an exact version (npm:name@x.y.z) — no ranges, no URLs",
  outside.length >= 2 && outside.every((s) => /^npm:(@[a-z0-9-]+\/)?[a-z0-9.-]+@\d+\.\d+\.\d+$/.test(s.spec)), outside.filter((s) => !/^npm:(@[a-z0-9-]+\/)?[a-z0-9.-]+@\d+\.\d+\.\d+$/.test(s.spec)));
{
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const installed = lock.packages?.["node_modules/@supabase/supabase-js"]?.version;
  const used = outside.filter((s) => s.spec.startsWith("npm:@supabase/supabase-js@")).map((s) => s.spec.split("@").pop());
  ok("supabase-js in a function is the version the app installs (package-lock.json) — one upgrade moves both", !!installed && used.length >= 1 && used.every((v) => v === installed), { installed, used });
  const cfg = JSON.parse(readFileSync(join(ROOT, "tsconfig.functions.json"), "utf8"));
  ok("…and the type check maps that same import to the installed package", Object.keys(cfg.compilerOptions.paths ?? {}).includes(`npm:@supabase/supabase-js@${installed}`));
  const shim = readFileSync(join(ROOT, "supabase/functions/_types/deno.d.ts"), "utf8");
  const declared = [...shim.matchAll(/declare module "([^"]+)"/g)].map((m) => m[1]);
  const others = [...new Set(outside.map((s) => s.spec).filter((s) => !s.startsWith("npm:@supabase/supabase-js@")))];
  ok("every other npm import is declared at the same version for the check (supabase/functions/_types/deno.d.ts)", others.length >= 1 && others.every((s) => declared.includes(s)), { others, declared });
}

console.log(`FUNCTIONS CHECK: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
