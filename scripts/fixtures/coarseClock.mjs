// A COARSE WALL CLOCK, FOR FINDING TIES (R40). Test-only: preloaded with `node --import`, it makes Date.now() — the clock
// PGlite's now() reads, in milliseconds where Postgres's own is microseconds — step every COARSE_MS (40 unless set).
// Statements run back to back then read one now(), as they do on a machine fast enough to run them inside a millisecond,
// and a check that asks which of two writes came later answers by luck. scripts/clock.ties.mjs runs tests under it.
const real = Date.now.bind(Date);
const step = Math.max(1, Number(process.env.COARSE_MS) || 40);
Date.now = () => Math.floor(real() / step) * step;
