// DEPLOY CHECK — the decision, tested away from git and the network.
//
// The first version of deploy.check.mjs had no test, and its first real run against production
// reported a FAILURE for a deploy that had succeeded: local d973de2, production 63cca51, same
// commit, sha rewritten by git am. The logic was one `===` and it was wrong, and nothing would
// have caught it except running it — which is not a plan.
//
// classifyDeploy is pure so the six distinguishable situations can each be stated once here. The
// ones that matter most are the two that must NOT be reported as failures-to-deploy, and the two
// that must NOT be reported as successes.
import { classifyDeploy } from "./deploy.check.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const TREE = "302550a0190def13147374c1049c4b34d80be58b";
const OTHER = "aaaaaaa0190def13147374c1049c4b34d80be58b";
const at = (o) => classifyDeploy({ prodKnown: true, prodSha: "63cca51", prodTree: TREE, headSha: "d973de2", headTree: TREE, relation: null, ...o });

// ── the two that must read as DEPLOYED ─────────────────────────────────────────────────────────
{
  const r = at({ prodSha: "d973de2" });
  ok("same sha is deployed", r.deployed === true && r.verdict === "same-sha", r);
}
{
  // The real case: git am re-parented the patch, so the sha differs and the content does not.
  const r = at({});
  ok("a DIFFERENT sha with the SAME tree is deployed — this is the git am case",
    r.deployed === true && r.verdict === "same-tree", r);
}

// ── the four that must read as NOT deployed ────────────────────────────────────────────────────
{
  const r = at({ prodTree: OTHER, relation: "ancestor" });
  ok("an older commit is behind, not deployed", r.deployed === false && r.verdict === "behind", r);
}
{
  const r = at({ prodTree: OTHER, relation: "descendant" });
  ok("a newer commit means the CLONE is behind, and says so rather than blaming production",
    r.deployed === false && r.verdict === "clone-behind", r);
}
{
  const r = at({ prodTree: OTHER, relation: "unrelated" });
  ok("an unrelated commit is diverged", r.deployed === false && r.verdict === "diverged", r);
}
{
  const r = at({ prodKnown: false, prodSha: null, prodTree: null });
  ok("an unknown build is NOT deployed — 'I cannot tell' must never read as yes",
    r.deployed === false && r.verdict === "build-unknown", r);
}
{
  // Cannot fetch the commit, so content cannot be compared. Distinct from "behind".
  const r = at({ prodTree: null });
  ok("an unfetchable commit is its own verdict, not a failure to deploy",
    r.deployed === false && r.verdict === "unfetchable", r);
}

// ── the precedence that actually bit ───────────────────────────────────────────────────────────
{
  // Tree equality must beat any ancestry reading: a re-parented patch IS an ancestor-less oddity,
  // and if `relation` were consulted first this would come back "diverged" for a live deploy.
  const r = at({ relation: "unrelated" });
  ok("tree equality outranks ancestry — the exact false negative that shipped",
    r.deployed === true && r.verdict === "same-tree", r);
}
{
  // And an unknown build must beat everything, even a sha that happens to match.
  const r = at({ prodKnown: false, prodSha: "d973de2" });
  ok("an unknown build outranks a matching sha", r.deployed === false, r);
}

console.log(`DEPLOY CHECK: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
