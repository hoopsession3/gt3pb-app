// DELETION RIGHTS — 0308, executed from its file.
//
// Two claims worth proving, because both are easy to write and easy to get subtly wrong:
//
//   1. discard_batch picks the outcome, not the caller. A batch nothing points at is DELETED; a
//      batch something points at is KEPT and marked, and the thing pointing at it still points at
//      it afterwards. Getting this backwards silently breaks 0261's traceability chain — the rows
//      would survive and the answer to "which batch was that" would not.
//
//   2. The guards go on tables that are NOT cascade targets, and the policies go on the ones that
//      are. A before-delete trigger fires during a cascade; an RLS policy does not. Guard a cascade
//      target and you have not protected the row, you have broken the parent. The event_economics
//      case below is the one that would have bitten: events are deleted from the console, and
//      event_economics cascades from them.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const raises = async (s) => { try { await db.exec(s); return null; } catch (e) { return String(e.message || e); } };

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create role anon; create role authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

  -- the two gates, switchable, so the refusal paths are testable rather than assumed
  create or replace function public.is_staff() returns boolean language sql stable as $$
    select coalesce(current_setting('test.staff', true), 'on') = 'on' $$;
  create or replace function public.is_admin() returns boolean language sql stable as $$
    select coalesce(current_setting('test.admin', true), 'on') = 'on' $$;

  create table public.changelog (id uuid primary key default gen_random_uuid(), title text,
    category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null,
    applied_at timestamptz, recorded_at timestamptz not null default now(),
    applied_by uuid, applied_count int not null default 1,
    evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null)
  returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note)
    values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1
    returning * into r; return r; end $$;

  create table public.events (id uuid primary key default gen_random_uuid(), title text);
  create table public.brew_batches (
    id uuid primary key default gen_random_uuid(),
    recipe_name text, batch_gal numeric, brew_started_at timestamptz,
    status text not null default 'planned',
    constraint brew_batches_status_check check (status = any (array['planned','brewing','ready','kegged','served','dumped'])));
  create table public.drop_orders      (id uuid primary key default gen_random_uuid(), batch_id uuid references public.brew_batches(id) on delete set null);
  create table public.delivery_orders  (id uuid primary key default gen_random_uuid(), batch_id uuid references public.brew_batches(id) on delete set null);
  create table public.inventory_ledger (id uuid primary key default gen_random_uuid(), qty numeric, batch_id uuid references public.brew_batches(id) on delete set null);

  -- guard candidates (no incoming cascade) and the cascade target that must stay unguarded
  create table public.invoices        (id uuid primary key default gen_random_uuid(), amount numeric);
  create table public.jug_ledger      (id uuid primary key default gen_random_uuid(), jugs_out int);
  create table public.event_sales     (id uuid primary key default gen_random_uuid(), gross numeric);
  create table public.event_economics (id uuid primary key default gen_random_uuid(),
    event_id uuid references public.events(id) on delete cascade, revenue numeric);
  create table public.budgets         (id uuid primary key default gen_random_uuid(), category text);
  alter table public.invoices enable row level security;
  alter table public.budgets  enable row level security;
  create policy invoices_all on public.invoices for all using (public.is_staff()) with check (public.is_staff());
  create policy budgets_all  on public.budgets  for all using (public.is_staff()) with check (public.is_staff());
`);

await db.exec(readFileSync(join(ROOT, "supabase/migrations/0308_a_mistake_is_not_a_record.sql"), "utf8"));
console.log("0308 executed against a real Postgres.\n");

// ── the status vocabulary ──────────────────────────────────────────────────────────────────────
ok("'discarded' is now an accepted status",
  null === await raises(`insert into public.brew_batches (recipe_name, batch_gal, status) values ('x', 5, 'discarded')`));
ok("'dumped' still means what it meant — a real pour-out is not a mistake",
  null === await raises(`insert into public.brew_batches (recipe_name, batch_gal, status) values ('y', 5, 'dumped')`));
ok("an invented status is still refused",
  /violates check constraint/i.test(await raises(`insert into public.brew_batches (recipe_name, batch_gal, status) values ('z', 5, 'oops')`) || ""));
await db.exec(`delete from public.brew_batches`);

// ── 1) nothing points at it → DELETED ──────────────────────────────────────────────────────────
const clean = (await db.query(
  `insert into public.brew_batches (recipe_name, batch_gal, status) values ('Accident', 5, 'brewing') returning id`)).rows[0].id;
ok("a batch nothing points at reads as safe to delete",
  (await q1(`select removable from public.v_batch_removable where id = '${clean}'`)).removable === "safe to delete",
  (await q1(`select removable from public.v_batch_removable where id = '${clean}'`)).removable);
ok("discard_batch DELETES it",
  (await q1(`select public.discard_batch('${clean}') as r`)).r === "deleted");
ok("and the row is actually gone",
  Number((await q1(`select count(*) as n from public.brew_batches where id = '${clean}'`)).n) === 0);

// ── 2) something points at it → KEPT, and the pointer survives ─────────────────────────────────
const held = (await db.query(
  `insert into public.brew_batches (recipe_name, batch_gal, status) values ('Real brew', 12, 'served') returning id`)).rows[0].id;
await db.exec(`insert into public.inventory_ledger (qty, batch_id) values (-3, '${held}')`);
ok("a batch with a stock movement reads as discard-only",
  (await q1(`select removable from public.v_batch_removable where id = '${held}'`)).removable === "discard only — something already points at it",
  (await q1(`select removable from public.v_batch_removable where id = '${held}'`)).removable);
ok("the view names WHAT is holding it, not just that something is",
  Number((await q1(`select ledger_rows from public.v_batch_removable where id = '${held}'`)).ledger_rows) === 1);
ok("discard_batch KEEPS it",
  (await q1(`select public.discard_batch('${held}', 'logged twice') as r`)).r === "discarded");
ok("the row survives, marked",
  (await q1(`select status from public.brew_batches where id = '${held}'`)).status === "discarded");
ok("the reason is kept — a discard without a why is a mystery later",
  (await q1(`select discard_reason from public.brew_batches where id = '${held}'`)).discard_reason === "logged twice");
// THE POINT OF THE WHOLE THING. A delete here would have set this to null and 0261's chain would
// have quietly lost a link, with every row still present and looking fine.
ok("and the stock movement still knows which batch it came from",
  (await q1(`select count(*) as n from public.inventory_ledger where batch_id = '${held}'`)).n == 1);
ok("a second discard is refused rather than silently re-stamping",
  (await q1(`select removable from public.v_batch_removable where id = '${held}'`)).removable === "already discarded");

// blank reason is stored as null, not as an empty string pretending to be an answer
const held2 = (await db.query(
  `insert into public.brew_batches (recipe_name, batch_gal, status) values ('Another', 4, 'ready') returning id`)).rows[0].id;
await db.exec(`insert into public.drop_orders (batch_id) values ('${held2}')`);
await db.exec(`select public.discard_batch('${held2}', '   ')`);
ok("a blank reason is stored as null, not as an empty string",
  (await q1(`select discard_reason is null as n from public.brew_batches where id = '${held2}'`)).n === true);
ok("a drop order also counts as something pointing at the batch",
  Number((await q1(`select drop_orders from public.v_batch_removable where id = '${held2}'`)).drop_orders) === 1);

// ── 3) the refusals ────────────────────────────────────────────────────────────────────────────
const gone = "00000000-0000-0000-0000-0000000000ff";
ok("removing a batch that is not there says so",
  /already gone/i.test(await raises(`select public.discard_batch('${gone}')`) || ""));
await db.exec(`set test.staff = 'off'`);
const notCrew = await raises(`select public.discard_batch('${held2}')`);
ok("a non-crew caller is refused", /only crew/i.test(notCrew || ""), notCrew);
await db.exec(`set test.staff = 'on'`);

// ── 4) the guards ──────────────────────────────────────────────────────────────────────────────
await db.exec(`insert into public.invoices (amount) values (250)`);
const inv = await raises(`delete from public.invoices`);
ok("an invoice cannot be hard-deleted", /blocked on invoices/i.test(inv || ""), inv);
ok("the refusal says what to do instead", /reversing entry or a status change/i.test(inv || ""));
ok("and the invoice is still there",
  Number((await q1(`select count(*) as n from public.invoices`)).n) === 1);
await db.exec(`select set_config('gt3.allow_hard_delete','on',false); delete from public.invoices;`);
ok("the deliberate escape hatch works — a guard nobody can get past is a guard someone drops",
  Number((await q1(`select count(*) as n from public.invoices`)).n) === 0);
await db.exec(`select set_config('gt3.allow_hard_delete','off',false)`);

await db.exec(`insert into public.jug_ledger (jugs_out) values (4); insert into public.event_sales (gross) values (900);`);
ok("the jug ledger is guarded too", /blocked on jug_ledger/i.test(await raises(`delete from public.jug_ledger`) || ""));
ok("so are event sales", /blocked on event_sales/i.test(await raises(`delete from public.event_sales`) || ""));

// THE ONE THAT WOULD HAVE BROKEN THE APP. event_economics cascades from events, and events ARE
// deleted from the console. A guard on the child would have made every event undeletable.
const ev = (await db.query(`insert into public.events (title) values ('Saturday') returning id`)).rows[0].id;
await db.exec(`insert into public.event_economics (event_id, revenue) values ('${ev}', 1200)`);
const cascade = await raises(`delete from public.events where id = '${ev}'`);
ok("deleting an event still works — its economics row is a cascade target and was left unguarded",
  cascade === null, cascade);
ok("and the economics row went with it",
  Number((await q1(`select count(*) as n from public.event_economics`)).n) === 0);

// ── 5) the restrictive policies ────────────────────────────────────────────────────────────────
const pol = await q1(`select count(*) as n from pg_policy where polname like '%\\_delete\\_admin\\_only'`);
ok("a restrictive delete policy landed on every table that exists here", Number(pol.n) === 5, pol.n);
ok("it is RESTRICTIVE, not permissive — it can only narrow, never widen",
  (await q1(`select bool_and(not polpermissive) as r from pg_policy where polname like '%\\_delete\\_admin\\_only'`)).r === true);
ok("and it applies to delete only, so reading and editing are untouched",
  (await q1(`select bool_and(polcmd = 'd') as r from pg_policy where polname like '%\\_delete\\_admin\\_only'`)).r === true);
ok("budgets got the policy but NOT the guard — a plan is not a record of money that moved",
  (await q1(`select delete_guarded from public.v_delete_rights where table_name = 'budgets'`)).delete_guarded === false);
ok("invoices got both",
  (await q1(`select delete_guarded from public.v_delete_rights where table_name = 'invoices'`)).delete_guarded === true);

// ── 6) the audit as a query ────────────────────────────────────────────────────────────────────
ok("v_delete_rights reports the gate on a table it can read",
  /is_staff/.test((await q1(`select policy_gate from public.v_delete_rights where table_name = 'invoices'`)).policy_gate));
// I first asserted this on event_sales and it failed, correctly: event_sales is in the restrictive
// list, so after 0308 it HAS a delete policy — the restrictive one. The assertion was wrong, not
// the migration. Worth leaving the note: a restrictive policy on a table with no permissive policy
// at all still shows up here, and reads as a gate even though nothing can pass it.
ok("a table 0308 does not touch still reports no delete policy",
  (await q1(`select policy_gate from public.v_delete_rights where table_name = 'events'`)).policy_gate === "no delete policy");
ok("and event_sales now reports the restrictive gate it gained",
  /is_admin/.test((await q1(`select policy_gate from public.v_delete_rights where table_name = 'event_sales'`)).policy_gate));
ok("brew_batches now registers a soft-delete column",
  (await q1(`select has_soft_delete from public.v_delete_rights where table_name = 'brew_batches'`)).has_soft_delete === true);

// ── 7) the ledger and the changelog ────────────────────────────────────────────────────────────
ok("0308 recorded itself by filename",
  (await q1(`select count(*) as n from public.schema_migrations where version = '0308_a_mistake_is_not_a_record'`)).n == 1);
ok("both changelog entries landed",
  Number((await q1(`select count(*) as n from public.changelog`)).n) === 2);
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0308_a_mistake_is_not_a_record.sql"), "utf8"));
ok("re-running the migration is safe — no duplicate changelog entries",
  Number((await q1(`select count(*) as n from public.changelog`)).n) === 2);

console.log(`\nDELETION RIGHTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
