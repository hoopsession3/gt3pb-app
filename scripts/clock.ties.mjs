// WHICH CHECKS READ AN ORDER OUT OF A TIE (R40 — CI on main went red for R34 with nothing wrong in the code).
//
//   node scripts/clock.ties.mjs                every test that stands up PGlite (about eight minutes)
//   node scripts/clock.ties.mjs <file> [...]   just these
//
// PGlite's clock is milliseconds, not Postgres's microseconds: here, of 2,000 statements run back to back, 1,454 read the
// same now() as the one before. A test that writes a stop and then a yes, and asks which came later, gets a tie on a fast
// machine and an answer on a slower one — GitHub's runner failed R9's "a stop from the account, then a yes from the
// account" on both of R34's runs, a check that passed in every run on the owner's machine and the chain's. This runs
// tests under a clock that steps every 40 ms (scripts/fixtures/coarseClock), where every such check fails every time,
// and names them. A test that means "later" waits for the clock to move first (scripts/fixtures/clock nextTick), or
// finds the row it means by its id, not by its place in a list ordered by a time two rows can share.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLOCK = join(ROOT, "scripts/fixtures/coarseClock.mjs");

/** Every test file the gate runs that stands up PGlite (package.json's test and db:test). */
export function pgliteTests() {
  const s = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
  const files = [...`${s.test} && ${s["db:test"]}`.matchAll(/node (scripts\/[\w.-]+\.mjs)/g)].map((m) => m[1]);
  return [...new Set(files)].filter((f) => { try { return /PGlite|fullSchema/.test(readFileSync(join(ROOT, f), "utf8")); } catch { return false; } });
}

/** Runs each file under the coarse clock; resolves to [{ file, code, failed: [✗ lines] }]. */
export async function underCoarseClock(files, { conc = 3, step = 40 } = {}) {
  const out = [];
  let next = 0;
  const one = (file) => new Promise((resolve) => execFile(process.execPath, ["--import", CLOCK, file],
    { cwd: ROOT, encoding: "utf8", timeout: 600_000, maxBuffer: 64 << 20, env: { ...process.env, COARSE_MS: String(step) } },
    (err, stdout, stderr) => resolve({ file, code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
      failed: `${stdout}${stderr}`.split("\n").filter((l) => /^\s*✗ /.test(l)).map((l) => l.trim().slice(0, 240)),
      tail: err ? `${stdout}${stderr}`.trim().split("\n").slice(-3).join(" ⏎ ").slice(0, 400) : "" })));
  await Promise.all(Array.from({ length: Math.max(1, conc) }, async () => { while (next < files.length) out.push(await one(files[next++])); }));
  return out.sort((a, b) => files.indexOf(a.file) - files.indexOf(b.file));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : pgliteTests();
  console.log(`CLOCK TIES — ${files.length} test file(s) under a clock that steps every 40 ms`);
  const res = await underCoarseClock(files, { conc: Number(process.env.CONC) || 3 });
  const bad = res.filter((r) => r.code !== 0);
  for (const r of bad) {
    console.log(`  ✗ ${r.file}`);
    for (const f of r.failed) console.log(`      ${f}`);
    if (!r.failed.length) console.log(`      (no ✗ line — it ended: ${r.tail})`);
  }
  console.log(`CLOCK TIES: ${res.length - bad.length} of ${res.length} file(s) read no order out of a tie`);
  process.exit(bad.length ? 1 : 0);
}
