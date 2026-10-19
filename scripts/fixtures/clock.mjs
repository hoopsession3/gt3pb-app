// "THEN" IS THEN (R40). PGlite's clock is the wall clock in milliseconds; Postgres's is microseconds. Two statements run
// inside one millisecond read the same now() — of 2,000 run back to back here, 1,454 did — so a test that writes a stop
// and then a yes, and asks which came later, is answered by how fast the machine is. In production two requests are
// seconds apart; a test that means "later" says so: it waits for the clock to move before the write that must be later.

/** Resolves once the wall clock has moved past `since` (now, unless given): a statement run after it reads a later now()
 * than any statement that had finished before it was called. */
export async function nextTick(since = Date.now()) {
  while (Date.now() <= since) await new Promise((r) => setTimeout(r, 1));
}
