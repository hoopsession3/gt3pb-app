// WHICH BUILD IS ANSWERING THIS REQUEST — the canonical home for that one question.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
// Three separate times in this project I told Ryan a push had not landed. It had. The reasoning
// was `git ls-remote` showing a SHA I did not recognise — but patches applied with `git am` are
// re-parented, so their SHAs are rewritten by design and a remote SHA that looks unfamiliar means
// nothing at all. Every one of those claims was an inference dressed up as a measurement.
//
// The fix is not to infer more carefully. It is that production should be able to answer the
// question directly, and until now nothing it served could. "Is it deployed?" was checked by
// looking at GitHub, looking at Vercel, and looking at whether the app seemed fine — three proxies
// for a fact the running process knows for certain and was never asked.
//
// ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────────────────────────
// If the platform did not tell us which commit this is, this reports known:false and says why. It
// never falls back to package.json's version, a build timestamp, or anything else that would let a
// caller believe it has an answer when it has a placeholder. A deploy check that cannot fail is a
// deploy check that lies, and this one exists specifically because of what believing an unverified
// signal already cost.
//
// ── NOT lib/deploySkew.ts ──────────────────────────────────────────────────────────────────────
// Both files have "deploy" in them and they answer different questions. deploySkew is client-side:
// "this open tab is holding a build older than the CDN, should it reload itself?" — it never needs
// to know which commit anything is, only that a chunk went missing. This file is server-side and
// says exactly one thing: which commit is running. Neither can be written in terms of the other,
// so they stay apart.
//
// ── WHAT IS DELIBERATELY NOT EXPOSED ───────────────────────────────────────────────────────────
// /api/health is public — uptime monitors hit it unauthenticated. The commit sha and branch of a
// private repo reveal nothing to someone who cannot read the repo, so they are fine to serve. The
// commit MESSAGE is not: this project writes long messages that name unshipped work and open
// risks. It is read here only to be discarded, so nobody later "just adds it".

export type BuildInfo = {
  /** Full commit sha of the build serving this request, or null when the platform did not say. */
  commit: string | null;
  /** First 7 characters of `commit` — what a person actually compares against `git log`. */
  commitShort: string | null;
  /** Branch the deploy was built from. */
  branch: string | null;
  /** "production" | "preview" | "development", straight from the platform. */
  env: string | null;
  /** Vercel's own id for this deployment; the thing to quote in a support ticket. */
  deploymentId: string | null;
  /** false ⇒ every field above is null and `why` says what to fix. Never a guess. */
  known: boolean;
  /** Present only when `known` is false. */
  why?: string;
};

const clean = (v: string | undefined): string | null => {
  const s = v?.trim();
  return s ? s : null;
};

/**
 * Reads the build identity out of the platform's environment.
 *
 * On Vercel these arrive as System Environment Variables. They are only injected when the project
 * has "Automatically expose System Environment Variables" enabled — so `known: false` here is a
 * real, actionable finding about the project's settings, not a shrug.
 */
export function buildInfo(): BuildInfo {
  const commit = clean(process.env.VERCEL_GIT_COMMIT_SHA);
  const branch = clean(process.env.VERCEL_GIT_COMMIT_REF);
  const env = clean(process.env.VERCEL_ENV);
  const deploymentId = clean(process.env.VERCEL_DEPLOYMENT_ID);

  if (!commit) {
    return {
      commit: null,
      commitShort: null,
      branch: null,
      env,
      deploymentId,
      known: false,
      why: clean(process.env.VERCEL)
        ? "Running on Vercel but VERCEL_GIT_COMMIT_SHA is not set — turn on Settings → Environment Variables → Automatically expose System Environment Variables."
        : "Not running on Vercel (local or self-hosted), so there is no deploy commit to report.",
    };
  }

  return {
    commit,
    commitShort: commit.slice(0, 7),
    branch,
    env,
    deploymentId,
    known: true,
  };
}

/**
 * True when `sha` is the build serving this request. Accepts a short or full sha, because the two
 * things being compared in practice are a 7-character `git log --oneline` and a 40-character
 * platform variable, and requiring the caller to match lengths is how a check gets skipped.
 *
 * Unknown build ⇒ false. "I cannot tell" must never read as "yes".
 */
export function isBuild(sha: string | null | undefined): boolean {
  const want = sha?.trim().toLowerCase();
  const have = buildInfo().commit?.toLowerCase();
  if (!want || !have || want.length < 7) return false;
  return have.startsWith(want) || want.startsWith(have);
}
