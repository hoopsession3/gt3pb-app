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
