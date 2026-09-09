// DEPLOY CHECK — ask production which commit it is serving, and decide honestly what that means.
//
//   node scripts/deploy.check.mjs                      # against https://app.gt3pb.com
//   node scripts/deploy.check.mjs https://staging.x     # somewhere else
//   node scripts/deploy.check.mjs --wait                # poll while a deploy is in flight
//
// ── WHY ────────────────────────────────────────────────────────────────────────────────────────
// "Put it in production" used to be verified by looking at GitHub, looking at Vercel, and looking
// at whether the app seemed fine. None of those is production stating a fact, and the gap is where
// I told Ryan a push had not landed — three times, wrongly.
//
// ── AND WHY IT COMPARES TREES, NOT SHAS ────────────────────────────────────────────────────────
// The first version of this file compared production's sha to HEAD's sha and failed anything else.
// Its very first real run reported a FAILURE for a deploy that had succeeded:
//
//     local  d973de2   production  63cca51   → "✗ not deployed"
//
// Both are the same commit. Patches applied with `git am` are re-parented, so the sha changes
// while the content does not — which is the exact mistake this tool was written to end, rebuilt
// inside the tool. Sha equality is not content equality and never was.
//
// A commit's TREE hash is content, and it survives re-parenting untouched:
//
//     d973de2^{tree} = 302550a0190def13147374c1049c4b34d80be58b
//     63cca51^{tree} = 302550a0190def13147374c1049c4b34d80be58b
//
// So the sha is only ever a fast path. The real question is whether production's commit has the
// same tree as HEAD, and answering it means fetching that commit — which is why this can say
// "deployed" about a sha this clone had never seen sixty seconds earlier.
//
// ── WHAT COUNTS AS A PASS ──────────────────────────────────────────────────────────────────────
// Production's commit has HEAD's tree, and the app reports healthy. Everything else fails,
// INCLUDING "I could not tell": an unknown build and an unfetchable commit both exit non-zero,
// because the entire point is that silence must never read as agreement.
import { execSync } from "node:child_process";

// ── the decision, with no I/O in it so it can be tested ────────────────────────────────────────
/**
 * @param {{ prodKnown:boolean, prodSha:string|null, prodTree:string|null,
 *           headSha:string, headTree:string, relation:"ancestor"|"descendant"|"unrelated"|null }} f
 * @returns {{ verdict:string, deployed:boolean }}
 *   deployed  — production is running this content. The only thing that may exit 0.
 *   verdict   — which of the six distinguishable situations this is.
 */
export function classifyDeploy(f) {
  if (!f.prodKnown) return { verdict: "build-unknown", deployed: false };
  if (f.prodSha === f.headSha) return { verdict: "same-sha", deployed: true };
  // Same content under a different sha: git am re-parented it. This is the normal path here.
  if (f.prodTree && f.prodTree === f.headTree) return { verdict: "same-tree", deployed: true };
  if (!f.prodTree) return { verdict: "unfetchable", deployed: false };
  if (f.relation === "ancestor") return { verdict: "behind", deployed: false };
  if (f.relation === "descendant") return { verdict: "clone-behind", deployed: false };
  return { verdict: "diverged", deployed: false };
}

// ── everything below is I/O ────────────────────────────────────────────────────────────────────
// Guarded so that importing classifyDeploy does NOT run the CLI. Without this the test file's
// first line would fetch production, print a verdict and call process.exit before a single
// assertion ran — a suite that passes because it never executed. That happened on the first try.
import { pathToFileURL } from "node:url";
if (import.meta.url !== pathToFileURL(process.argv[1] || "").href) {
  // imported for its logic; nothing to do
} else await main();

async function main() {
const args = process.argv.slice(2);
const wait = args.includes("--wait");
const base = (args.find((a) => !a.startsWith("--")) || "https://app.gt3pb.com").replace(/\/+$/, "");

const git = (cmd) => execSync(`git ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const gitOrNull = (cmd) => { try { return git(cmd); } catch { return null; } };

const headSha = git("rev-parse HEAD");
const headTree = git("rev-parse HEAD^{tree}");
const subject = git("log -1 --format=%s");
const dirty = gitOrNull("status --porcelain");

/** Make `sha` resolvable locally, fetching if we have never seen it. Returns its tree, or null. */
const treeOfRemote = (sha) => {
  const tree = () => gitOrNull(`rev-parse ${sha}^{tree}`);
  let t = tree();
  if (t) return t;
  // A sha this clone has never seen is the ordinary case when someone else pushed the patch.
  for (const f of [`fetch -q origin ${sha}`, `fetch -q origin`]) {
    if (gitOrNull(f) !== null) { t = tree(); if (t) return t; }
  }
  return null;
};

const relationTo = (sha) => {
  if (gitOrNull(`merge-base --is-ancestor ${sha} HEAD`) !== null) return "ancestor";
  if (gitOrNull(`merge-base --is-ancestor HEAD ${sha}`) !== null) return "descendant";
  return "unrelated";
};

const ask = async () => {
  const r = await fetch(`${base}/api/health`, { headers: { accept: "application/json" }, cache: "no-store" });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const line = (s) => console.log(s);
const DEADLINE = Date.now() + (wait ? 10 * 60_000 : 0);

line(`  local  ${headSha.slice(0, 7)}  ${subject}`);
line(`  tree   ${headTree.slice(0, 7)}  — what production has to match; sha need not`);
if (dirty) line(`  NOTE   working tree has uncommitted changes; production can only ever match HEAD`);

let announced = null;
for (;;) {
  let res;
  try { res = await ask(); }
  catch (e) { line(`  ✗ could not reach ${base}/api/health — ${String(e.message).slice(0, 90)}`); process.exit(1); }

  const b = res.body?.build;
  if (!b) {
    line(`  ✗ ${base} answered ${res.status} with no build block — that deploy predates`);
    line(`    lib/buildInfo.ts, so it cannot say what it is running.`);
    process.exit(1);
  }

  const prodTree = b.known && b.commit ? treeOfRemote(b.commit) : null;
  const relation = b.known && b.commit && prodTree ? relationTo(b.commit) : null;
  const { verdict, deployed } = classifyDeploy({
    prodKnown: b.known === true, prodSha: b.commit, prodTree, headSha, headTree, relation,
  });
  const where = `${b.commitShort} on ${b.branch} (${b.env})`;

  if (deployed) {
    line(`  ✓ ${base} is serving ${where} — this content.`);
    if (verdict === "same-tree") {
      line(`    Different sha, identical tree ${prodTree.slice(0, 7)}: re-parented by git am, not a different build.`);
    }
    if (res.body.ok !== true) line(`    but it reports ok:${res.body.ok} — deployed and unhealthy is still a failure.`);
    process.exit(res.body.ok === true ? 0 : 1);
  }

  if (verdict === "build-unknown") {
    line(`  ✗ production cannot identify its own build.`);
    line(`    ${b.why}`);
    process.exit(1);
  }
  if (verdict === "unfetchable") {
    line(`  ✗ production is serving ${where}, and this clone cannot fetch that commit,`);
    line(`    so its content cannot be compared. Check the title on GitHub — never the sha,`);
    line(`    which git am rewrites. This is "I cannot tell", not "it is not deployed".`);
    process.exit(1);
  }

  if (verdict !== announced) {
    const why = {
      behind: "an older commit — the push has not deployed yet",
      "clone-behind": "a NEWER commit — this clone is behind, not production",
      diverged: "an unrelated commit — different branch or a force-push",
    }[verdict];
    line(`  … ${base} is serving ${where}: ${why}`);
    announced = verdict;
  }
  if (Date.now() >= DEADLINE) {
    line(`  ✗ production is serving ${where}, whose tree ${String(prodTree).slice(0, 7)} is not ${headTree.slice(0, 7)}.`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
}
