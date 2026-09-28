// The pool() replacing 1,583 sequential updates. If it drops an item or runs unbounded, the
// symptom is products that silently didn't refresh — indistinguishable from a working sync.
const WRITE_CONCURRENCY = 8;
async function pool(items, n, work) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await work(items[idx]); }
  }));
}
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}${got !== undefined ? ` → ${JSON.stringify(got)}` : ""}`); } };

// EVERY item, exactly once — the property the whole fix rests on.
for (const size of [0, 1, 7, 8, 9, 1583]) {
  const seen = [];
  await pool(Array.from({ length: size }, (_, i) => i), WRITE_CONCURRENCY, async (x) => { await new Promise(r => setTimeout(r, 0)); seen.push(x); });
  ok(`pool: ${size} items all processed`, seen.length === size, seen.length);
  ok(`pool: ${size} items processed exactly once`, new Set(seen).size === size, new Set(seen).size);
}
// BOUNDED. Unbounded parallelism against 1,583 rows is how you take the database down instead of
// the clock — the failure the sequential loop was accidentally preventing.
let live = 0, peak = 0;
await pool(Array.from({ length: 200 }, (_, i) => i), WRITE_CONCURRENCY, async () => {
  live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 1)); live--;
});
ok("pool: never exceeds the concurrency limit", peak <= WRITE_CONCURRENCY, peak);
ok("pool: actually uses the concurrency it was given", peak === WRITE_CONCURRENCY, peak);
// Fewer items than workers must not hang on workers with nothing to do.
const small = []; await pool([1,2], WRITE_CONCURRENCY, async (x) => { small.push(x); });
ok("pool: fewer items than workers still completes", small.length === 2);
console.log(`\nPOOL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
