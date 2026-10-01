// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DEPLOY SKEW — deciding when a crashed screen should just reload itself.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A tab left open across a deploy holds a page whose chunk filenames belong to the previous build.
// Tap something that lazy-loads — every section of /crew is code-split — and the browser asks for a
// file the CDN no longer has. Nothing is wrong with the app; the client is simply one build behind.
// One hard reload fixes it, because the service worker is network-first for navigations and refuses
// to cache a non-ok response, so the reload gets a coherent build.
//
// WHY THIS IS A TESTED MODULE AND NOT A REGEX IN THE ERROR BOUNDARY. It used to be an inline
// pattern, and it has now failed in production twice, each time because the bundler phrased the
// same failure a new way:
//
//   webpack      "ChunkLoadError" / "Loading chunk 42 failed"
//   Turbopack    "module factory is not available"          ← added after it was seen on /menu
//   Turbopack    "Failed to load chunk …js?dpl=… from module 74850"  ← seen on /crew, 2026-09-06
//
// The third one slipped through a pattern list that already contained "Loading chunk", because
// "load chunk" is not "loading chunk". The comment above that regex claimed to have the phrasing
// that "actually shows up in production" — it had the previous one. So the matching is structural
// now, and every message ever seen live is a fixture in scripts/smoke.cjs. Adding a new one there
// when it appears is how this stays honest.

/** Phrases that are, on their own, unambiguous stale-build signatures. */
const EXACT = [
  /ChunkLoadError/i,
  /module factory is not available/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Failed to fetch dynamically imported module/i,
];

/** A shared module was rebuilt under a page that still holds the old shape. Broad on purpose — the
 *  attempt guard below caps what a false positive can cost at a single reload. */
const REBUILT = [
  /\bis not a function\b/i,
  /undefined is not an object \(evaluating/i,
];

// Structural match for the whole family: something about a chunk, and something about it failing.
// Catches "Failed to load chunk", "Loading chunk 42 failed" and "chunk … could not be loaded"
// without needing to have guessed the exact word order in advance.
const CHUNKISH = /\bchunks?\b/i;
const FAILISH = /\bfail(ed|ure)?\b|\berror\b|\bcould not\b|\bunable\b|\bloading\b|\bload(ing)?\b/i;

/** Is this crash the "your tab is one build old" failure rather than a real defect? */
export function isDeploySkew(message: string | null | undefined): boolean {
  const m = String(message ?? "");
  if (!m) return false;
  if (EXACT.some((r) => r.test(m))) return true;
  if (CHUNKISH.test(m) && FAILISH.test(m)) return true;
  return REBUILT.some((r) => r.test(m));
}

// ── how many times we may try ──────────────────────────────────────────────────────────────────
// The old guard was a single session flag: heal once, then never again for the life of the tab.
// That stops a loop, but it also means the second deploy of a working day leaves the crew staring
// at the crash screen. Attempts are capped and spaced instead, so a genuinely broken screen settles
// after a few tries rather than spinning, and a long session survives more than one deploy.
export const SKEW_MAX_ATTEMPTS = 3;
export const SKEW_MIN_GAP_MS = 30_000;

export type SkewMemory = { attempts: number; lastAt: number };
export const EMPTY_SKEW: SkewMemory = { attempts: 0, lastAt: 0 };

/** Pure decision: given what we've already tried, should this crash reload — and what do we
 *  remember afterwards? Kept free of window/sessionStorage so it is unit-tested rather than mocked. */
export function nextSkewAction(mem: SkewMemory | null | undefined, now: number): { reload: boolean; mem: SkewMemory } {
  const m: SkewMemory = {
    attempts: Number(mem?.attempts) || 0,
    lastAt: Number(mem?.lastAt) || 0,
  };
  if (m.attempts >= SKEW_MAX_ATTEMPTS) return { reload: false, mem: m };
  if (m.lastAt > 0 && now - m.lastAt < SKEW_MIN_GAP_MS) return { reload: false, mem: m };
  return { reload: true, mem: { attempts: m.attempts + 1, lastAt: now } };
}

/** Parse whatever is in storage without trusting it — a hand-edited or half-written value must not
 *  throw inside an error boundary, which is the one place left that can still show a UI. */
export function readSkewMemory(raw: string | null | undefined): SkewMemory {
  if (!raw) return EMPTY_SKEW;
  try {
    const v = JSON.parse(raw);
    return { attempts: Number(v?.attempts) || 0, lastAt: Number(v?.lastAt) || 0 };
  } catch {
    return EMPTY_SKEW;
  }
}

// ── what the crash should be reported AS ────────────────────────────────────────────────────────
// The heal and the alert were decided independently, and that was the whole problem. app/error.tsx
// reported every boundary hit as FATAL first and checked for skew afterwards, so a tab that healed
// itself perfectly — reloaded, showed the crew nothing, lost no work — still raised
// "Critical — App error — a screen crashed" in Ryan's inbox. Every deploy that caught an open tab
// bought a critical email for a non-event, which is how a critical channel stops meaning anything.
//
// The honest split: a skew we are ABOUT TO HEAL is an FYI. A skew we have run out of attempts on is
// a real incident — the reload did not fix it, so it was never skew, or the CDN is actually broken.
// Anything else is a crash and stays fatal.
export type CrashPlan = {
  skew: boolean;      // is this the stale-build family at all
  reload: boolean;    // should the boundary hard-reload right now
  fatal: boolean;     // should this page someone
  mem: SkewMemory;    // what to remember for the next crash in this tab
};

export function classifyCrash(message: string | null | undefined, mem: SkewMemory | null | undefined, now: number): CrashPlan {
  if (!isDeploySkew(message)) {
    return { skew: false, reload: false, fatal: true, mem: readSkewMemory(JSON.stringify(mem ?? EMPTY_SKEW)) };
  }
  const { reload, mem: next } = nextSkewAction(mem, now);
  // Healing → FYI. Out of attempts → this is not skew behaving like skew, so say so loudly.
  return { skew: true, reload, fatal: !reload, mem: next };
}

// ── one bug, one row ────────────────────────────────────────────────────────────────────────────
// /api/errors/report fingerprints on the message, and a skew message carries the things that are
// DIFFERENT on every single build: the content-hashed chunk filename, the Vercel deployment id, and
// the internal module number. So the dedup that is supposed to collapse a recurring error into one
// row never fired for the one error that recurs most — every deploy minted a fresh fingerprint and
// therefore a fresh alert. Normalising those three away is what makes the dedup real.
export function stableErrorKey(message: string | null | undefined): string {
  return String(message ?? "")
    // Vercel deployment id, as a query param or bare.
    .replace(/[?&]dpl=[A-Za-z0-9_-]+/g, "")
    .replace(/\bdpl_[A-Za-z0-9]+/g, "<dpl>")
    // Content-hashed chunk filenames: /_next/static/chunks/0pfvpf_6yqhu-.js, app/page-a1b2c3.js …
    .replace(/\/_next\/static\/[^\s"')]+/g, "/_next/static/<chunk>")
    .replace(/\b[\w-]*[0-9a-f]{6,}[\w-]*\.(js|mjs|css)\b/gi, "<chunk>.$1")
    // Webpack/Turbopack internal module ids and chunk numbers.
    .replace(/\bmodule\s+\d+\b/gi, "module <id>")
    .replace(/\bchunk\s+\d+\b/gi, "chunk <id>")
    .replace(/\s+/g, " ")
    .trim();
}

// ═══ THE OTHER SKEW: THE DATABASE IS ONE MIGRATION BEHIND THE CODE ═══════════════════════════════
//
// Everything above is the client being one BUILD behind. This is the mirror image, and in this
// repo it is not a rare race — it is guaranteed by the workflow. Migrations are applied BY HAND in
// the Supabase SQL editor, and the push happens first. So between `git push` and the paste, every
// deploy is running new code against the old schema, and the window is however long it takes
// somebody to open a browser tab.
//
// 2026-10-01 is where this stopped being theoretical. 0337 adds brew_vessels.min_gal and
// BrewPlanner's loader selects it. PostgREST answers an unknown column with 42703, and that loader
// does `[...].find(x => x.error)` then THROWS — so one column that does not exist yet takes down
// the whole Brew board: recipes, batches, events, stops and inventory, none of which have anything
// to do with the new column. Pushing before pasting would have broken a working screen.
//
// WHY A PREDICATE AND NOT A try/catch AT THE CALL SITE. Because a blanket catch would swallow the
// errors that MATTER — a dropped table, a revoked grant, RLS refusing the read — and turn a loud
// failure into an empty list. "A failed read is not an empty list" is the rule this repo keeps
// re-learning; this narrows the forgiveness to exactly one condition, named, and leaves every other
// error as loud as it was.
//
// 42703 is `undefined_column` in the Postgres error-code table, and PostgREST passes it through.
// The message is matched too, because PGlite and some proxies report the text without the code.
const MISSING_COLUMN_TEXT = /column\s+\S*\.?\S+\s+does not exist/i;

/** Is this error ONLY "that column is not there yet" — i.e. the schema is behind this build? */
export function isMissingColumn(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (String(err.code ?? "") === "42703") return true;
  return MISSING_COLUMN_TEXT.test(String(err.message ?? ""));
}
