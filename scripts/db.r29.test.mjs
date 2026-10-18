// R29 — A DOOR STAYS OPEN FOR THE CUSTOMER WHILE A SCRIPT KNOCKS (0434), IN POSTGRES (2026-10-18 — the 10/10 audit, API F1).
//
// The whole schema to 0433 is loaded, then 0434 — twice. rate_limit_peek is asked beside rate_limit_hit on the same
// buckets: the same windows, never a count of its own, true while the next hit would be let through, and the server's
// alone. booking_requests.quiet is there, false for every lead before and for every one that doesn't say otherwise, and
// the browser's own door to the table (0418's throttle) is as it was. Every lead is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M434 = readFileSync(join(ROOT, "supabase/migrations/0434_a_door_stays_open_while_a_script_knocks.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const t0 = Date.now();
const db = await fullSchema({ before: "0434" });
console.log(`the schema to 0433 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);
  select set_config('request.jwt.claims', '', false);`);
const as = async (role, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.role', '${role}', false); select set_config('request.jwt.claims', '${JSON.stringify({ role })}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;`);

// ── before 0434 ────────────────────────────────────────────────────────────────────────────────────────────────────
await q(`insert into public.booking_requests (name, email) values ('Made-up Planner', 'planner@example.test')`);
ok("before 0434: no rate_limit_peek, and a lead has no quiet",
  (await q1(`select count(*)::int n from pg_proc where proname = 'rate_limit_peek'`)).n === 0
  && (await q1(`select count(*)::int n from information_schema.columns where table_name = 'booking_requests' and column_name = 'quiet'`)).n === 0);

await db.exec(M434);
await db.exec(M434);
ok("0434 twice: recorded (applied twice), one changelog line, and nothing made twice",
  (await q1(`select applied_count::int n from public.schema_migrations where version like '0434%'`)).n === 2
  && (await q1(`select count(*)::int n from public.changelog where title = 'A script can''t close the doors on customers'`)).n === 1
  && (await q1(`select count(*)::int n from pg_proc where proname = 'rate_limit_peek'`)).n === 1);

// ── asked, not counted ─────────────────────────────────────────────────────────────────────────────────────────────
const hit = async (b, ms, max) => (await q1(`select public.rate_limit_hit($1, $2, $3) v`, [b, ms, max])).v;
const peek = async (b, ms, max) => (await q1(`select public.rate_limit_peek($1, $2, $3) v`, [b, ms, max])).v;
const count = async (b) => (await q1(`select coalesce(sum(count), 0)::int n from public.rate_limit_hits where bucket = $1`, [b])).n;
ok("peek: a bucket nobody has knocked on is under its cap — and asking it counts nothing",
  (await peek("card:refused", 60_000, 20)) === true && (await peek("card:refused", 60_000, 20)) === true && (await count("card:refused")) === 0);
for (let i = 0; i < 19; i++) await hit("card:refused", 60_000, 20);
ok("peek: nineteen refused cards in the minute — still under (the next hit would be let through)", (await peek("card:refused", 60_000, 20)) === true && (await count("card:refused")) === 19);
ok("…the twentieth is let through, and then peek says over — as the twenty-first hit is refused",
  (await hit("card:refused", 60_000, 20)) === true && (await peek("card:refused", 60_000, 20)) === false && (await hit("card:refused", 60_000, 20)) === false);
for (let i = 0; i < 5; i++) await peek("card:refused", 60_000, 20);
ok("…asked five times more, the count is still twenty: peek never counts, and a refused hit isn't counted either (0419)", (await count("card:refused")) === 20);
ok("peek: the window is the hit's own — an hour's bucket asked by the hour, its cap its own",
  (await hit("book:global", 3_600_000, 2)) === true && (await peek("book:global", 3_600_000, 2)) === true && (await hit("book:global", 3_600_000, 2)) === true
  && (await peek("book:global", 3_600_000, 2)) === false && (await peek("book:global", 3_600_000, 3)) === true);
ok("peek: a cap or a window that isn't one is never 'under' (as a hit with one is refused)",
  (await peek("x", 60_000, 0)) === false && (await peek("x", 0, 5)) === false && (await peek("x", 60_000, null)) === false && (await peek("x", null, 5)) === false);

// ── the server's alone ─────────────────────────────────────────────────────────────────────────────────────────────
const anon = await as("anon", `select public.rate_limit_peek('card:refused', 60000, 20) v`);
const signedIn = await as("authenticated", `select public.rate_limit_peek('card:refused', 60000, 20) v`);
const server = await as("service_role", `select public.rate_limit_peek('card:refused', 60000, 20) v`);
ok("peek: a browser can't ask it — signed out or in — and the server can", /permission denied/.test(anon.error ?? "") && /permission denied/.test(signedIn.error ?? "") && server.rows[0]?.v === false,
  { anon: anon.error, signedIn: signedIn.error, server: server.rows });
ok("peek: definer, a search_path of its own, stable",
  (await q1(`select prosecdef d, provolatile v, array_to_string(proconfig, ',') c from pg_proc where proname = 'rate_limit_peek'`)).d === true
  && (await q1(`select provolatile v from pg_proc where proname = 'rate_limit_peek'`)).v === "s"
  && /search_path=public/.test((await q1(`select array_to_string(proconfig, ',') c from pg_proc where proname = 'rate_limit_peek'`)).c));

// ── a lead past the hour's thirty: kept, not announced ─────────────────────────────────────────────────────────────
const col = await q1(`select is_nullable, column_default from information_schema.columns where table_name = 'booking_requests' and column_name = 'quiet'`);
ok("booking_requests.quiet: not null, false unless said — the lead from before 0434 among them",
  col?.is_nullable === "NO" && /false/.test(col?.column_default ?? "") && (await q1(`select bool_and(not quiet) v from public.booking_requests`)).v === true, col);
await q(`insert into public.booking_requests (name, email, quiet) values ('Made-up Burst', 'burst@example.test', true)`);
ok("…a lead the server keeps quiet stays quiet", (await q1(`select quiet from public.booking_requests where email = 'burst@example.test'`)).quiet === true);
ok("…and the browser's own door to the table is still counted (0418's throttle, untouched)",
  (await q1(`select count(*)::int n from pg_trigger where tgname = 'booking_requests_throttle' and not tgisinternal`)).n === 1);

await db.close();
console.log(`\nR29 — A DOOR STAYS OPEN (0434, in Postgres): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
