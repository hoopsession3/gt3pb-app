// DEPLOY CHECK — ask production which commit it is serving, and compare it to this working tree.
//
//   node scripts/deploy.check.mjs                      # against https://app.gt3pb.com
//   node scripts/deploy.check.mjs https://staging.x     # against somewhere else
//   node scripts/deploy.check.mjs --wait                # poll until it matches (deploy in flight)
//
// ── WHY ────────────────────────────────────────────────────────────────────────────────────────
// "Put it in production" used to be verified by looking at GitHub, looking at Vercel, and looking
// at whether the app seemed fine. None of those three is production telling you what it runs, and
// the gap between them is where I told Ryan a push had not landed — three times, wrongly, because
// `git am` rewrites SHAs and a remote SHA I did not recognise proved nothing.
//
// ── WHAT COUNTS AS A PASS ──────────────────────────────────────────────────────────────────────
// Exactly one thing: production reports a commit, and it is this one. Everything else is a
// failure, INCLUDING production saying it does not know. An unknown build is not a pass with a
// caveat — it is the check being unable to run, and it exits non-zero so nothing downstream treats
// silence as agreement.
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const wait = args.includes("--wait");
const base = (args.find((a) => !a.startsWith("--")) || "https://app.gt3pb.com").replace(/\/+$/, "");

const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const headShort = head.slice(0, 7);
const subject = execSync("git log -1 --format=%s", { encoding: "utf8" }).trim();
const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();

const ask = async () => {
  const r = await fetch(`${base}/api/health`, { headers: { accept: "application/json" }, cache: "no-store" });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
};

const line = (s) => console.log(s);
const DEADLINE = Date.now() + (wait ? 10 * 60_000 : 0);

line(`  local  ${headShort}  ${subject}`);
if (dirty) line(`  NOTE   working tree has uncommitted changes — production can only ever match HEAD`);

let last = null;
for (;;) {
  let res;
  try {
    res = await ask();
  } catch (e) {
    line(`  ✗ could not reach ${base}/api/health — ${String(e.message).slice(0, 90)}`);
    process.exit(1);
  }

  const b = res.body?.build;
  if (!b) {
    line(`  ✗ ${base} answered ${res.status} but sent no build block.`);
    line(`    That deploy predates lib/buildInfo.ts, so it cannot say what it is running.`);
    line(`    Ship this commit first; from then on the check is one request.`);
    process.exit(1);
  }
  if (!b.known) {
    line(`  ✗ production cannot identify its own build.`);
    line(`    ${b.why}`);
    process.exit(1);
  }

  if (b.commit === head || b.commitShort === headShort) {
    line(`  ✓ ${base} is serving ${b.commitShort} on ${b.branch} (${b.env}) — this commit.`);
    if (res.body.ok !== true) line(`    but it reports ok:${res.body.ok} — deployed and unhealthy is still a failure.`);
    process.exit(res.body.ok === true ? 0 : 1);
  }

  if (b.commitShort !== last) {
    line(`  … ${base} is serving ${b.commitShort} on ${b.branch} (${b.env}), not ${headShort}`);
    last = b.commitShort;
  }
  if (Date.now() >= DEADLINE) {
    line(`  ✗ production is serving ${b.commitShort}, not ${headShort}.`);
    line(`    Either the push has not deployed yet, or the deploy failed. ${base} knows which;`);
    line(`    this script only reports what it was told.`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
