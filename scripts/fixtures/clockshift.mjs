// THE CLOCK, MOVED (2026-10-16 — the 10/10 audit's clock sweep). Loaded before a test with `node --import`, it moves this
// process's clock to GT3_CLOCK_AT (an ISO instant) and lets it run on from there: Date.now(), new Date(), and — because the
// database the tests run (PGlite) reads its clock through the same Date.now() — Postgres's now() and current_date too.
// scripts/clock.sweep.mjs runs every test this way, at the hours and days that broke them. Without GT3_CLOCK_AT, nothing moves.
const at = process.env.GT3_CLOCK_AT ? Date.parse(process.env.GT3_CLOCK_AT) : NaN;
if (Number.isFinite(at)) {
  const Real = Date;
  const offset = at - Real.now();
  const now = () => Real.now() + offset;
  class Moved extends Real {
    constructor(...a) { if (a.length === 0) super(now()); else super(...a); }
    static now() { return now(); }
  }
  globalThis.Date = Moved;
}
