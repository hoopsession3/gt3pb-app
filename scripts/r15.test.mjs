// R15 (2026-10-17 — the 10/10 audit: tenancy, the card doors' sign-in, uploads, the migrations' rules), run.
//
// The pure rules R15 added, driven: what fits in one upload (lib/uploadBatches), what an auth answer means
// (lib/authAnswer — the card doors' "couldn't check your sign-in"), and the two rules a migration is now read against
// (scripts/migrationRules — lock_timeout first; a policy asks who is calling once a query). The database half is
// scripts/db.r15.test.mjs; the routes' wiring is in scripts/smoke.cjs's R15 block.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { libLoader } from "./fixtures/chargeonce.mjs";
import { lockGap, bareHelpers, topLevelStatements, LOCK_FLOOR, WRAP_FLOOR } from "./migrationRules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const load = libLoader();
const U = load("lib/uploadBatches.ts"), A = load("lib/authAnswer.ts");

// ── lib/uploadBatches: what fits in one request ─────────────────────────────────────────────────────────────────────
{
  const MB = 1_000_000;
  ok("uploads: the budget is under Vercel's 4.5 MB body limit, with room for the JSON around it", U.REQUEST_BUDGET < 4.5 * MB && U.REQUEST_BUDGET > 3 * MB);
  const one = U.batchBySize([1 * MB, 1 * MB, 1 * MB], 3.8 * MB);
  ok("uploads: three photos of a megabyte go in one request", JSON.stringify(one.batches) === "[[0,1,2]]" && one.tooBig.length === 0, one);
  const split = U.batchBySize([2 * MB, 2 * MB, 1 * MB], 3.8 * MB);
  ok("uploads: two of two megabytes do not share a request — the order kept", JSON.stringify(split.batches) === "[[0],[1,2]]", split);
  const big = U.batchBySize([1 * MB, 9 * MB, 1 * MB], 3.8 * MB);
  ok("uploads: a file too large alone is named, never sent — the rest are", JSON.stringify(big.tooBig) === "[1]" && JSON.stringify(big.batches) === "[[0,2]]", big);
  ok("uploads: nothing picked is no request", JSON.stringify(U.batchBySize([], 3.8 * MB)) === JSON.stringify({ batches: [], tooBig: [] }));
  ok("uploads: a size that is not a number is too big, not sent", JSON.stringify(U.batchBySize([NaN, 5], 10).tooBig) === "[0]");
  const exact = U.batchBySize([3.8 * MB], 3.8 * MB);
  ok("uploads: exactly the budget is sent", exact.batches.length === 1 && exact.tooBig.length === 0);
  ok("photo: a 4032×3024 photo is drawn 2000 on its long side, its shape kept", JSON.stringify(U.fitWithin(4032, 3024)) === JSON.stringify({ width: 2000, height: 1500 }), U.fitWithin(4032, 3024));
  ok("photo: a portrait one too", JSON.stringify(U.fitWithin(3024, 4032)) === JSON.stringify({ width: 1500, height: 2000 }));
  ok("photo: a small one is never enlarged", JSON.stringify(U.fitWithin(800, 600)) === JSON.stringify({ width: 800, height: 600 }));
  ok("photo: no size is no drawing", JSON.stringify(U.fitWithin(0, 600)) === JSON.stringify({ width: 0, height: 0 }));
}

// ── lib/authAnswer: a refused token is a guest; a service that didn't answer is not ──────────────────────────────────
{
  ok("auth: no error is not unavailable", A.authUnavailable(null) === false && A.authUnavailable(undefined) === false);
  ok("auth: the network failing (auth-js AuthRetryableFetchError, status 0) is unavailable", A.authUnavailable({ name: "AuthRetryableFetchError", status: 0 }) === true);
  ok("auth: a 502 or 503 from the service is unavailable", A.authUnavailable({ name: "AuthRetryableFetchError", status: 503 }) && A.authUnavailable({ status: 502 }));
  ok("auth: an answer it could not read is unavailable", A.authUnavailable({ name: "AuthUnknownError", status: 200 }) === true);
  ok("auth: an expired or forged token (401, 403) is a refusal — the caller is a guest, as always",
    A.authUnavailable({ name: "AuthApiError", status: 401 }) === false && A.authUnavailable({ name: "AuthApiError", status: 403 }) === false);
  ok("auth: an error with no status at all is unavailable (it never reached the service)", A.authUnavailable({ message: "fetch failed" }) === true);
}

// ── scripts/migrationRules: lock_timeout first ──────────────────────────────────────────────────────────────────────
{
  ok("lock rule: a file that sets lock_timeout first keeps it", lockGap("-- header\nset lock_timeout = '5s';\nalter table public.orders add column x int;") === null);
  ok("lock rule: set local, and 'to', count too", lockGap("set local lock_timeout to '3s'; alter table public.orders add column x int;") === null);
  ok("lock rule: a file that alters first, or sets it late, breaks it",
    lockGap("alter table public.orders add column x int; set lock_timeout = '5s';") !== null && lockGap("create index x on public.orders (id);") !== null);
  ok("lock rule: a file that says why it takes no lock keeps it", lockGap("-- lock-timeout: none — a new table only\ncreate table public.x (id int);") === null);
  ok("lock rule: comments before the first statement are not a statement", lockGap("-- a\n-- b\n\nset lock_timeout = '5s';") === null);
  ok("statements: a ; inside a string or a $$ body does not split it", topLevelStatements("select 'a;b'; do $$ begin perform 1; end $$; select 2").length === 3);
}

// ── scripts/migrationRules: a policy asks who is calling once a query ─────────────────────────────────────────────────
{
  ok("policy rule: auth.uid() bare in a policy is named", bareHelpers("create policy p on public.t for select using (auth.uid() = user_id);").length === 1);
  ok("policy rule: (select auth.uid()) is not", bareHelpers("create policy p on public.t for select using ((select auth.uid()) = user_id);").length === 0);
  ok("policy rule: public.is_staff() bare is named; (select public.is_staff()) is not",
    bareHelpers("create policy p on public.t for select using (public.is_staff());").length === 1 && bareHelpers("create policy p on public.t for select using ((select public.is_staff()));").length === 0);
  ok("policy rule: a policy built in a DO block's format string is read too",
    bareHelpers("do $$ begin execute format('create policy \"q\" on public.%I using (tenant_id = public.effective_tenant())', 't'); end $$;").length === 1);
  ok("policy rule: 0134's tenant isolation shape is named; 0422's is not",
    bareHelpers("create policy \"tenant isolation\" on public.x as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());").length === 2
    && bareHelpers("alter policy \"tenant isolation\" on public.x using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));").length === 0);
  ok("policy rule: a helper outside a policy (a function body, a select) is not this rule's", bareHelpers("select public.is_staff(); create function f() returns bool language sql as $$ select auth.uid() is not null $$;").length === 0);
}

// ── the rules hold on the migrations themselves ──────────────────────────────────────────────────────────────────────
{
  const dir = join(ROOT, "supabase/migrations");
  const late = readdirSync(dir).filter((f) => f.endsWith(".sql") && Number(f.slice(0, 4)) >= Math.min(LOCK_FLOOR, WRAP_FLOOR));
  ok("the migrations from 0422 set lock_timeout first and wrap every helper their policies call",
    late.length >= 1 && late.every((f) => { const sql = readFileSync(join(dir, f), "utf8"); return lockGap(sql) === null && bareHelpers(sql).length === 0; }), late);
}

console.log(`\nR15 — UPLOADS THAT FIT, A SIGN-IN THAT COULDN'T BE CHECKED, THE MIGRATIONS' RULES: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
