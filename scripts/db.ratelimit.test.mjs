// ONE CEILING FOR EVERY INSTANCE — 0154, executed from its file against a real Postgres.
//
// Three public routes now lean on rate_limit_hit for the only bound they have that survives a
// cold start: the concierge (an AI bill), the delivery waitlist (a row), and the error intake (a
// push to every owner's phone — lib/errorIntake.ts, 2026-10-02). scripts/smoke.cjs drives the
// intake with a double whose rate_limit_hit "counts per bucket and answers true while under
// p_max". That sentence is the whole contract the app is written against, and until this file it
// was remembered, not measured. Here the real function is loaded from the migration and asked.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s, p) => (await db.query(s, p)).rows[0];
const hit = async (bucket, windowMs, max) => (await q1("select public.rate_limit_hit($1, $2, $3) as under", [bucket, windowMs, max])).under;

await db.exec(`create role anon; create role authenticated; create role service_role;`);
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0154_rate_limit_store.sql"), "utf8"));

// ── the count ──────────────────────────────────────────────────────────────────────────────────
const answers = [];
for (let i = 0; i < 6; i++) answers.push(await hit("test:alerts", 600_000, 5));
ok("the first p_max hits in a window are under the cap", answers.slice(0, 5).every((a) => a === true), answers);
ok("the hit after p_max is over it", answers[5] === false, answers);
ok("…and stays over for the rest of the window", (await hit("test:alerts", 600_000, 5)) === false);
ok("one row per (bucket, window) carries the count", (await q1("select count(*)::int as n, max(count) as c from public.rate_limit_hits where bucket = 'test:alerts'")).n === 1);

// ── buckets are independent ────────────────────────────────────────────────────────────────────
ok("a different bucket starts from zero while the first is over its cap", (await hit("test:rows", 3_600_000, 30)) === true);
ok("a bucket with its own cap is judged by its own cap", (await hit("test:one", 60_000, 1)) === true && (await hit("test:one", 60_000, 1)) === false);

// ── windows ────────────────────────────────────────────────────────────────────────────────────
// A millisecond window, two hits ten milliseconds apart: different windows, so the second is under
// a cap of one again. The fixed window is what makes the cap "per ten minutes" and not "forever".
ok("the next window starts the count over", await (async () => {
  const a = await hit("test:win", 1, 1);
  await new Promise((r) => setTimeout(r, 10));
  const b = await hit("test:win", 1, 1);
  return a === true && b === true;
})());
ok("…in a new row, the old one kept until the sweep", (await q1("select count(*)::int as n from public.rate_limit_hits where bucket = 'test:win'")).n === 2);

// ── who may ask ────────────────────────────────────────────────────────────────────────────────
// Only the service role (the server) may count; a browser holding the anon key may neither inflate
// a bucket to lock guests out nor read the table. The table has RLS on and no policy — so no role
// but the owner sees a row even if a grant appeared later.
ok("anon may not execute it", (await q1("select has_function_privilege('anon', 'public.rate_limit_hit(text,int,int)', 'execute') as x")).x === false);
ok("authenticated may not execute it", (await q1("select has_function_privilege('authenticated', 'public.rate_limit_hit(text,int,int)', 'execute') as x")).x === false);
ok("service_role may", (await q1("select has_function_privilege('service_role', 'public.rate_limit_hit(text,int,int)', 'execute') as x")).x === true);
ok("the table has RLS on and no policy — nobody reads the counters but the owner",
  (await q1("select relrowsecurity as rls, (select count(*)::int from pg_policies where tablename = 'rate_limit_hits') as policies from pg_class where relname = 'rate_limit_hits'")).rls === true
  && (await q1("select count(*)::int as n from pg_policies where tablename = 'rate_limit_hits'")).n === 0);
ok("it runs as its definer with search_path pinned (a caller cannot swap the table out from under it)",
  (await q1("select prosecdef as d, proconfig::text as c from pg_proc where proname = 'rate_limit_hit'")).d === true
  && /search_path=public/.test((await q1("select proconfig::text as c from pg_proc where proname = 'rate_limit_hit'")).c || ""));

// ── the intake's budgets, as the app sets them ─────────────────────────────────────────────────
// lib/errorIntake.ts: 30 new rows an hour, 5 first-sight alerts in ten minutes. The numbers live
// there; this just shows that the function honours a cap of that shape end to end.
let filed = 0, alerted = 0;
for (let i = 0; i < 40; i++) {
  if (!(await hit("client-errors:new", 3_600_000, 30))) continue;
  filed++;
  if (await hit("client-errors:alert", 600_000, 5)) alerted++;
}
ok("forty new errors in a minute: thirty rows, five alerts", filed === 30 && alerted === 5, { filed, alerted });

console.log(`ONE CEILING FOR EVERY INSTANCE: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
