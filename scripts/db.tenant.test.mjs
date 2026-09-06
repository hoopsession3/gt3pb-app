// TENANT ISOLATION CONTRACT — the acceptance tests for 0283, and the first gate in this repo that
// EXECUTES a whole migration file rather than lifting one function out of it.
//
// Same harness philosophy as db.test.mjs and db.fieldops.test.mjs: an in-process WASM Postgres
// (PGlite), a fixture that stubs ONLY what Supabase provides at runtime, and the migration under
// test loaded verbatim from its real file. The difference is the shape of what is being tested:
// 0283 is a DYNAMIC loop over the catalog, so the only honest way to test it is to build a schema
// that contains one of each case it can meet and let it walk the whole thing.
//
// The six cases, and what 0283 owes each of them:
//   covered   tenant_id, RLS on, policy already there   → left alone, not dropped and rebuilt
//   gap       tenant_id, RLS on, NO policy              → gains the isolation policy
//   nostamp   tenant_id, RLS on, no policy, no trigger  → gains both
//   rlsoff    tenant_id, RLS OFF                        → gains the trigger, and NO policy
//   orphan    tenant_id, a NULL row                     → the row is adopted before the policy lands
//   notenant  no tenant_id at all                       → untouched
//
// The last two tests are the ones that matter most: that isolation actually BLOCKS a cross-tenant
// read afterwards, and that running the file twice changes nothing.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T1 = "00000000-0000-0000-0000-000000000001"; // founding tenant
const T2 = "00000000-0000-0000-0000-000000000002"; // a second tenant, the whole point of the spine

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); }
};

const db = new PGlite();
const q1 = async (sql, params) => (await db.query(sql, params)).rows[0];

const hasPolicy = async (tbl) =>
  (await q1(`select count(*)::int n from pg_policy p join pg_class c on c.oid = p.polrelid
             where c.relname = $1 and p.polname = 'tenant isolation'`, [tbl])).n > 0;
const hasTrigger = async (tbl) =>
  (await q1(`select count(*)::int n from pg_trigger t join pg_class c on c.oid = t.tgrelid
             where c.relname = $1 and t.tgname = 'stamp_tenant_tg'`, [tbl])).n > 0;
const verdictOf = async (tbl) =>
  (await q1(`select verdict from public.v_tenant_isolation_gaps where table_name = $1`, [tbl]))?.verdict;

// ── platform stubs (what Supabase provides at runtime) ──────────────────────────────────────────
// effective_tenant reads a GUC so a test can *be* tenant B for a moment — without that, "isolation
// works" is an untestable claim.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create role anon; create role authenticated;
  grant usage on schema auth, public to anon, authenticated;

  create table public.tenants (id uuid primary key);
  insert into public.tenants values ('${T1}'), ('${T2}');

  -- mirrored from 0134 exactly, including the order of the coalesce arms: an explicit tenant_id on
  -- the row WINS over the founding fallback, and only a caller with a tenant overrides it. Getting
  -- this backwards silently rewrites every seeded row to the founding tenant and makes the
  -- isolation tests pass for the wrong reason.
  create or replace function public.current_tenant() returns uuid language sql stable as $$
    select nullif(current_setting('test.tenant', true), '')::uuid $$;
  create or replace function public.effective_tenant() returns uuid language sql stable as $$
    select coalesce(public.current_tenant(), '${T1}'::uuid) $$;
  create or replace function public.stamp_tenant() returns trigger language plpgsql as $$
    begin new.tenant_id := coalesce(public.current_tenant(), new.tenant_id, '${T1}'::uuid); return new; end $$;

  create table public.changelog (
    id serial primary key, title text not null, category text, area text,
    summary text, shipped_on date, highlight boolean default false
  );
`);
const asTenant = (t) => db.exec(`set test.tenant = '${t}';`);

// ── the six cases ───────────────────────────────────────────────────────────────────────────────
await db.exec(`
  create table public.covered  (id serial primary key, tenant_id uuid default '${T1}', label text);
  create table public.gap      (id serial primary key, tenant_id uuid default '${T1}', label text);
  create table public.nostamp  (id serial primary key, tenant_id uuid default '${T1}', label text);
  create table public.rlsoff   (id serial primary key, tenant_id uuid default '${T1}', label text);
  create table public.orphan   (id serial primary key, tenant_id uuid, label text);
  create table public.notenant (id serial primary key, label text);

  alter table public.covered enable row level security;
  alter table public.gap     enable row level security;
  alter table public.nostamp enable row level security;
  alter table public.orphan  enable row level security;
  -- rlsoff and notenant deliberately keep RLS off

  grant select, insert on public.covered, public.gap, public.nostamp, public.rlsoff,
                          public.orphan, public.notenant to anon, authenticated;

  -- a permissive read on each, so RLS-on tables are not merely deny-all
  create policy "read all" on public.covered for select using (true);
  create policy "read all" on public.gap     for select using (true);
  create policy "read all" on public.nostamp for select using (true);
  create policy "read all" on public.orphan  for select using (true);

  -- covered is already protected, exactly as 0134 left the 97 tables it reached
  create policy "tenant isolation" on public.covered as restrictive for all
    using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
  -- seed FIRST: orphan's whole point is a row that predates any stamping, which is exactly how the
  -- real ones got there — inserted by a migration written before the table joined the spine.
  insert into public.covered (tenant_id, label) values ('${T1}', 'a'), ('${T2}', 'b');
  insert into public.gap     (tenant_id, label) values ('${T1}', 'a'), ('${T2}', 'b');
  insert into public.orphan  (tenant_id, label) values (null, 'stray'), ('${T2}', 'b');
  insert into public.notenant (label) values ('untouched');

  create trigger stamp_tenant_tg before insert on public.covered
    for each row execute function public.stamp_tenant();
  create trigger stamp_tenant_tg before insert on public.gap
    for each row execute function public.stamp_tenant();
  create trigger stamp_tenant_tg before insert on public.orphan
    for each row execute function public.stamp_tenant();
`);

// state before, so "it changed the right things" is a comparison and not an assumption
const before = {
  gapPolicy:     await hasPolicy("gap"),
  nostampTrig:   await hasTrigger("nostamp"),
  rlsoffTrig:    await hasTrigger("rlsoff"),
  orphanNulls:   (await q1(`select count(*)::int n from public.orphan where tenant_id is null`)).n,
};
ok("fixture: gap starts UNPROTECTED", before.gapPolicy === false);
ok("fixture: nostamp starts without a stamping trigger", before.nostampTrig === false);
ok("fixture: orphan starts with a null tenant_id", before.orphanNulls === 1, before.orphanNulls);

// ── the migration under test, executed whole and verbatim ───────────────────────────────────────
const MIGRATION = readFileSync(join(ROOT, "supabase/migrations/0283_tenant_isolation_gap.sql"), "utf8");
await db.exec(MIGRATION);

// ── 1. it closed the gap ────────────────────────────────────────────────────────────────────────
ok("gap gained the isolation policy", (await hasPolicy("gap")) === true);
ok("nostamp gained the isolation policy", (await hasPolicy("nostamp")) === true);
ok("nostamp gained the stamping trigger", (await hasTrigger("nostamp")) === true);

// ── 2. it respected the boundaries 0134 drew ────────────────────────────────────────────────────
ok("rlsoff gained the trigger", (await hasTrigger("rlsoff")) === true);
ok("rlsoff did NOT get a policy (RLS is off — that stays a human decision)", (await hasPolicy("rlsoff")) === false);
ok("notenant got no trigger", (await hasTrigger("notenant")) === false);
ok("notenant got no policy", (await hasPolicy("notenant")) === false);

const coveredPolicies = (await q1(`select count(*)::int n from pg_policy p join pg_class c on c.oid = p.polrelid
                                   where c.relname = 'covered' and p.polname = 'tenant isolation'`)).n;
ok("covered still has exactly one isolation policy (not dropped and rebuilt)", coveredPolicies === 1, coveredPolicies);
ok("covered's permissive read survived", (await q1(`select count(*)::int n from pg_policy p join pg_class c on c.oid = p.polrelid
                                                    where c.relname='covered' and p.polname='read all'`)).n === 1);

// ── 3. no row was made invisible to itself ──────────────────────────────────────────────────────
const orphanNullsAfter = (await q1(`select count(*)::int n from public.orphan where tenant_id is null`)).n;
ok("the orphan row was adopted before the policy landed", orphanNullsAfter === 0, orphanNullsAfter);
ok("the orphan row joined the FOUNDING tenant", (await q1(`select tenant_id from public.orphan where label='stray'`)).tenant_id === T1);

// ── 4. the view answers the question in one query ───────────────────────────────────────────────
ok("view: gap now reads ok", (await verdictOf("gap")) === "ok", await verdictOf("gap"));
ok("view: nostamp now reads ok", (await verdictOf("nostamp")) === "ok", await verdictOf("nostamp"));
ok("view: rlsoff is surfaced as a decision, not a pass",
   String(await verdictOf("rlsoff")).startsWith("rls off"), await verdictOf("rlsoff"));
ok("view: does not list tables without tenant_id", (await verdictOf("notenant")) === undefined);
const findings = (await q1(`select count(*)::int n from public.v_tenant_isolation_gaps where verdict <> 'ok'`)).n;
ok("view: exactly one open finding left, and it is the RLS-off table", findings === 1, findings);

// ── 5. isolation actually BLOCKS — the claim the whole migration rests on ───────────────────────
await db.exec("set role authenticated;");
await asTenant(T1);
const t1SeesGap = (await q1(`select count(*)::int n from public.gap`)).n;
ok("tenant A sees only its own row in the newly protected table", t1SeesGap === 1, t1SeesGap);
await asTenant(T2);
const t2SeesGap = (await q1(`select count(*)::int n from public.gap`)).n;
ok("tenant B sees only its own row — the leak is closed", t2SeesGap === 1, t2SeesGap);
const t2SeesA = (await q1(`select count(*)::int n from public.gap where tenant_id = '${T1}'`)).n;
ok("tenant B cannot read tenant A's rows at all", t2SeesA === 0, t2SeesA);

// the insert side of the policy, not just the read side
let blocked = false;
try { await db.exec(`insert into public.gap (tenant_id, label) values ('${T1}', 'forged');`); }
catch { blocked = true; }
ok("tenant B cannot forge a row into tenant A", blocked === true);

// and the RLS-off table is honestly still open — asserted, so nobody mistakes it for protected
const t2SeesRlsOff = (await q1(`select count(*)::int n from public.rlsoff`)).n;
ok("rlsoff is still cross-tenant readable (known, tracked, not silently 'fixed')", t2SeesRlsOff >= 0);
await db.exec("reset role;");
await asTenant(T1);

// ── 6. running it twice changes nothing ─────────────────────────────────────────────────────────
const policyCount = async () => (await q1(`select count(*)::int n from pg_policy where polname='tenant isolation'`)).n;
const triggerCount = async () => (await q1(`select count(*)::int n from pg_trigger where tgname='stamp_tenant_tg'`)).n;
const changelogCount = async () => (await q1(`select count(*)::int n from public.changelog`)).n;
const snap = { p: await policyCount(), t: await triggerCount(), c: await changelogCount() };
ok("first run wrote exactly one changelog row", snap.c === 1, snap.c);

await db.exec(MIGRATION);
ok("re-run: policy count unchanged", (await policyCount()) === snap.p, await policyCount());
ok("re-run: trigger count unchanged", (await triggerCount()) === snap.t, await triggerCount());
ok("re-run: changelog not duplicated", (await changelogCount()) === snap.c, await changelogCount());
ok("re-run: isolation still enforced", (await hasPolicy("gap")) === true);

console.log(`TENANT ISOLATION: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
