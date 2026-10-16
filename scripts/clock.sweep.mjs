// THE TESTS AT ANY HOUR (2026-10-16 — the 10/10 audit). `npm run verify` passed or failed by the time of day it ran: a pack
// three days out closed at 6 PM Eastern and the member's cancel test failed until midnight UTC; the office money test
// counted the database's UTC day where the business counts Eastern ones, and failed every evening from 8; the market test
// held Atlanta by its real opening date, and would have failed every run from December 1. None was a bug in the app — each
// was a test that read the clock as if it were always the afternoon it was written in. This runs every test with the clock
// moved (scripts/fixtures/clockshift.mjs: the process's clock and the test database's now() with it) to the moments that
// find that kind:
//   · 22:30 UTC on a Friday — 6:30 PM Eastern, after a drop's packs close for the day;
//   · 03:30 UTC on a Tuesday — the Eastern evening after the UTC date has turned;
//   · a Sunday, the morning the clocks go back, the last evening of the year, the morning they go forward;
//   · and a year out.
//   npm run test:clock                                  — every moment below (about forty minutes)
//   npm run test:clock -- 2026-12-31T23:30:00Z          — the moments given
// Not part of `verify` (it is the whole suite, seven times over); run it before a release, or when a test's dates change.
import { readFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHIFT = join(ROOT, "scripts/fixtures/clockshift.mjs");
const MOMENTS = ["2026-10-16T22:30:00Z", "2026-10-20T03:30:00Z", "2026-10-18T15:00:00Z", "2026-11-01T06:30:00Z", "2026-12-31T23:30:00Z", "2027-03-14T12:00:00Z", "2027-06-15T16:00:00Z"];
const moments = process.argv.slice(2).filter((a) => !Number.isNaN(Date.parse(a)));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const scripts = (s) => [...s.matchAll(/node (scripts\/[\w.-]+\.(?:m?js|cjs))/g)].map((m) => m[1]);
const tests = [...new Set([...scripts(pkg.scripts.test), ...scripts(pkg.scripts["db:test"])])].filter((s) => !/clock\.sweep/.test(s));

// smoke.cjs reads the compiled modules npm run smoke makes: made once, the same way, and taken away after.
const tsc = pkg.scripts.smoke.match(/tsc (.+?) && node scripts\/smoke\.cjs/);
if (tsc) {
  const made = spawnSync("npx", ["tsc", ...tsc[1].split(/\s+/)], { cwd: ROOT, stdio: "inherit" });
  if (made.status !== 0) { console.error("clock sweep: the smoke's modules did not compile"); process.exit(1); }
}

const jobs = (moments.length ? moments : MOMENTS).flatMap((t) => tests.map((s) => ({ t, s })));
const failed = [];
let next = 0;
const run = ({ t, s }) => new Promise((done) => {
  const p = spawn("node", ["--import", SHIFT, s], { cwd: ROOT, env: { ...process.env, GT3_CLOCK_AT: t } });
  let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  const stop = setTimeout(() => p.kill("SIGKILL"), 300_000);
  p.on("close", (code) => { clearTimeout(stop); done({ code, said: out.split("\n").filter((l) => /✗/.test(l)).slice(0, 6) }); });
});
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    const r = await run(j);
    if (r.code !== 0) { failed.push({ ...j, ...r }); console.log(`✗ ${j.t} ${j.s}\n${r.said.map((l) => `    ${l.trim()}`).join("\n")}`); }
  }
}
await Promise.all([worker(), worker()]);
if (tsc) rmSync(join(ROOT, ".smoke"), { recursive: true, force: true });
console.log(`CLOCK SWEEP: ${jobs.length - failed.length} of ${jobs.length} runs passed (${tests.length} tests × ${jobs.length / tests.length} moments)`);
if (failed.length) process.exit(1);
