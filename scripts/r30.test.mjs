// R30 — WHAT RUNS IS WHAT WAS CHOSEN (2026-10-18 — the 10/10 audit, operations F21, F24 and security F14).
//
// Read from the files themselves, offline:
//   · every action a workflow runs is named by its commit, with the release it is beside it — never a tag or a branch,
//     which their owner (or whoever takes their account) can point at other code;
//   · .github/dependabot.yml proposes those commits' successors and the dependencies' minor and patch releases, once a
//     month, one pull request each, majors left for a deliberate change;
//   · a push and every morning ask npm's advisory database of what ships, and fail on high and critical;
//   · what ships is clear of the advisories that were open on 2026-10-18 — Next.js on 16.4.2 (its "security" upgrade
//     policy's choice: the latest safe release in the major), sharp past librsvg's and libheif's, and the lockfile's
//     nanoid, source-map-js and baseline-browser-mapping past theirs.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

// ── every action by its commit ─────────────────────────────────────────────────────────────────────────────────────
const WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/ios.yml", ".github/workflows/production.yml"];
const uses = [];
for (const f of WORKFLOWS) for (const [i, line] of read(f).split("\n").entries()) {
  const m = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/);
  if (m) uses.push({ f, line: i + 1, ref: m[1], rest: m[2].trim() });
}
ok("workflows: they run actions (the reading found them)", uses.length >= 10, uses.length);
const loose = uses.filter((u) => !/^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/.test(u.ref));
ok("workflows: every `uses:` names a commit (40 hex digits), not a tag or a branch", loose.length === 0, loose);
const unsaid = uses.filter((u) => !/^#\s*v\d+\.\d+\.\d+$/.test(u.rest));
ok("workflows: beside every commit, the release it is (`# vX.Y.Z`), for the person reading and for Dependabot", unsaid.length === 0, unsaid);
const byAction = new Map();
for (const u of uses) { const [name, sha] = u.ref.split("@"); (byAction.get(name) ?? byAction.set(name, new Set()).get(name)).add(`${sha} ${u.rest}`); }
ok("workflows: one action, one commit — every workflow runs the same release of it", [...byAction.values()].every((s) => s.size === 1), Object.fromEntries([...byAction].map(([k, v]) => [k, [...v]])));
ok("workflows: the releases `@v4` ran when they were pinned (checkout v4.4.0, setup-node v4.4.0, upload-artifact v4.6.2)",
  [...byAction.get("actions/checkout")][0] === "11d5960a326750d5838078e36cf38b85af677262 # v4.4.0"
  && [...byAction.get("actions/setup-node")][0] === "49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0"
  && [...byAction.get("actions/upload-artifact")][0] === "ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2");

// ── dependabot ─────────────────────────────────────────────────────────────────────────────────────────────────────
ok("dependabot: the file is there", existsSync(join(ROOT, ".github/dependabot.yml")));
const dep = existsSync(join(ROOT, ".github/dependabot.yml")) ? read(".github/dependabot.yml") : "";
const blocks = dep.split(/\n\s*-\s+package-ecosystem:\s*/).slice(1).map((b) => ({ eco: b.split("\n")[0].trim(), body: b }));
ok("dependabot: version 2, the two kinds this repository has (github-actions, npm)", /^version:\s*2\s*$/m.test(dep) && blocks.map((b) => b.eco).sort().join() === "github-actions,npm", blocks.map((b) => b.eco));
for (const b of blocks) {
  ok(`dependabot (${b.eco}): once a month, one pull request at a time, grouped`,
    /interval:\s*monthly/.test(b.body) && /open-pull-requests-limit:\s*1\b/.test(b.body) && /groups:/.test(b.body), b.body);
  ok(`dependabot (${b.eco}): a major version is left for a deliberate change`,
    /dependency-name:\s*"\*"\s*\n\s*update-types:\s*\["version-update:semver-major"\]/.test(b.body), b.body);
}

// ── the advisories, asked ─────────────────────────────────────────────────────────────────────────────────────────
const ci = read(".github/workflows/ci.yml");
const AUDIT = "npm audit --omit=dev --audit-level=high";
const ciAdv = ci.includes("\n  advisories:") ? ci.slice(ci.indexOf("\n  advisories:")) : "";
ok("ci.yml: every push asks npm's advisory database of what ships, failing on high and critical — a job of its own, beside verify (an advisory never hides what the gate says)",
  ciAdv.includes(`run: ${AUDIT}`) && ci.indexOf("\n  verify:") < ci.indexOf("\n  advisories:") && !ci.slice(0, ci.indexOf("\n  advisories:")).includes(AUDIT));
ok("ci.yml: the advisories job is a gate, not advice (no continue-on-error, no `|| true`), holds no secret and installs nothing",
  !/continue-on-error/.test(ci) && !ci.includes(`${AUDIT} ||`) && !/secrets\./.test(ciAdv) && !/npm (ci|install)/.test(ciAdv), ciAdv);
ok("ci.yml: it runs on every push the gate runs on (no condition of its own)", !/^\s+if:/m.test(ciAdv), ciAdv);
const prod = read(".github/workflows/production.yml");
const adv = prod.slice(prod.indexOf("\n  advisories:"));
ok("production.yml: every morning's run asks again, as a job of its own (so its red says an advisory, not the site)",
  prod.includes("\n  advisories:") && adv.includes(`run: ${AUDIT}`)
  && /if: \(github\.event_name == 'schedule' && github\.event\.schedule == '10 6 \* \* \*'\) \|\| github\.event_name == 'workflow_dispatch'/.test(adv));
ok("production.yml: the advisories job holds no secret and installs nothing (the lockfile is the question)",
  !/secrets\./.test(adv) && !/npm (ci|install)/.test(adv), adv);
ok("production.yml: the morning schedule it names is the workflow's own", /- cron: "10 6 \* \* \*"/.test(prod));

// ── what ships, clear ──────────────────────────────────────────────────────────────────────────────────────────────
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const v = (s) => s.replace(/^[\^~]/, "").split(".").map(Number);
const atLeast = (have, want) => { const a = v(have), b = v(want); for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); } return true; };
const locked = (name) => lock.packages[`node_modules/${name}`]?.version ?? null;
ok("next: asked for at 16.4.2 or later in its major, and locked at 16.4.2 (every advisory open against 16.2.12 fixed by 16.3.8)",
  /^\^16\.4\.2$/.test(pkg.dependencies.next) && locked("next") === "16.4.2", { asked: pkg.dependencies.next, locked: locked("next") });
ok("eslint-config-next: the same release as next (its rules are written for that release)",
  pkg.devDependencies["eslint-config-next"] === locked("next") && locked("eslint-config-next") === locked("next"),
  { asked: pkg.devDependencies["eslint-config-next"], locked: locked("eslint-config-next") });
ok("sharp: overridden to 0.35.5 or later (librsvg's and libheif's advisories), and locked there",
  pkg.overrides.sharp === "^0.35.5" && atLeast(locked("sharp") ?? "0", "0.35.5"), { asked: pkg.overrides.sharp, locked: locked("sharp") });
const floors = { nanoid: "3.3.18", "source-map-js": "1.2.2", "baseline-browser-mapping": "2.11.0" };
const low = Object.entries(lock.packages).filter(([p, x]) => {
  const name = p.split("node_modules/").pop();
  return floors[name] && x.version && !atLeast(x.version, floors[name]);
}).map(([p, x]) => `${p}@${x.version}`);
ok("the lockfile: every copy of nanoid, source-map-js and baseline-browser-mapping past its advisory", low.length === 0, low);
ok("next.config: images stay unoptimized — the image optimizer, the door most of Next's advisories this year came through, is not served",
  /images:\s*\{\s*unoptimized:\s*true\s*\}/.test(read("next.config.ts")));

// ── the money routes nothing ran, run ───────────────────────────────────────────────────────────────────────────────
ok("npm test runs the three money routes nothing ran before (billing checkout, office pay link, shop resubmit)",
  pkg.scripts.test.includes("node scripts/routes.billing.test.mjs") && existsSync(join(ROOT, "scripts/routes.billing.test.mjs")));
ok("npm run db:test reads 0435 (every foreign key led by an index)", pkg.scripts["db:test"].includes("node scripts/db.r30.test.mjs"));

console.log(`\nR30 — WHAT RUNS IS WHAT WAS CHOSEN (pinned actions, dependabot, advisories, what ships): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
