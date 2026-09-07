// THE LAST FOUR WAYS OUT — 0310, executed from its file.
//
// The assertion that matters is the first one, because it is a bug I shipped: 0309's jug void
// subtracted the containers a delivery moved WITHOUT the zero clamp the delivery itself applies
// (OfficeOrders.bumpJugs → MAX(0, …)). On a balance the app had already floored, the reversal
// landed negative. My 0309 fixture proved the arithmetic and was silent about the invariant, which
// is the same failure as a fixture that does not match production, wearing a different hat.
//
// So this sets the balance to what the APP would have stored, not to what the maths implies, and
// asserts the void cannot go below it.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const U1 = "00000000-0000-0000-0000-0000000000b1";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const raises = async (s) => { try { await db.exec(s); return null; } catch (e) { return String(e.message || e); } };

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  insert into auth.users (id, email) values ('${U1}', 'Nino@Example.com ');
  create role anon; create role authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('test.uid', true), ''), '')::uuid $$;
  create or replace function public.is_staff() returns boolean language sql stable as $$
    select coalesce(current_setting('test.staff', true), 'on') = 'on' $$;
  create or replace function public.is_admin() returns boolean language sql stable as $$
    select coalesce(current_setting('test.admin', true), 'on') = 'on' $$;

  create table public.tenants (id uuid primary key default gen_random_uuid());
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text,
    category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null,
    applied_at timestamptz, recorded_at timestamptz not null default now(), applied_by uuid,
    applied_count int not null default 1, evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null)
  returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note)
    values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1
    returning * into r; return r; end $$;

  create table public.business_accounts (id uuid primary key default gen_random_uuid(),
    jug_balance int default 0, updated_at timestamptz default now());
  create table public.jug_ledger (id uuid primary key default gen_random_uuid(),
    business_id uuid references public.business_accounts(id), jugs_out int, jugs_in int,
    balance_after int, note text, voided_at timestamptz, voided_by uuid, void_reason text);

  create table public.delivery_waitlist (id uuid primary key default gen_random_uuid(),
    zip text, email text, created_at timestamptz default now());
  -- the 0141 guard this table actually carries in production
  create or replace function public.guard_customer_delete() returns trigger language plpgsql as $$
  begin
    if coalesce(current_setting('gt3.allow_hard_delete', true), '') = 'on' then return old; end if;
    raise exception 'Hard deletes are blocked on % — customer records are never lost.', tg_table_name;
  end $$;
  create trigger guard_delete_delivery_waitlist before delete on public.delivery_waitlist
    for each row execute function public.guard_customer_delete();

  create table public.primal_pillars (id uuid primary key default gen_random_uuid(),
    title text, sort int default 0, archived_at timestamptz);
  create table public.primal_modules (id uuid primary key default gen_random_uuid(),
    pillar_id uuid references public.primal_pillars(id), archived_at timestamptz);
  create table public.primal_lessons (id uuid primary key default gen_random_uuid(),
    module_id uuid references public.primal_modules(id), archived_at timestamptz);
  create table public.primal_progress (id uuid primary key default gen_random_uuid(),
    lesson_id uuid references public.primal_lessons(id));
`);

await db.exec(readFileSync(join(ROOT, "supabase/migrations/0310_the_last_four_ways_out.sql"), "utf8"));
console.log("0310 executed against a real Postgres.\n");
await db.exec(`select set_config('test.uid','${U1}',false)`);

// ── 1) THE BUG THAT SHIPPED ────────────────────────────────────────────────────────────────────
const biz = (await db.query(`insert into public.business_accounts (jug_balance) values (0) returning id`)).rows[0].id;
// A delivery that moved 5 containers against an account the app had already floored at 0.
const j = (await db.query(`insert into public.jug_ledger (business_id, jugs_out, jugs_in, balance_after)
  values ('${biz}', 5, 0, 0) returning id`)).rows[0].id;
await db.exec(`select public.void_jug_entry('${j}', 'wrong crate')`);
const bal = Number((await q1(`select jug_balance as b from public.business_accounts where id='${biz}'`)).b);
ok("voiding cannot drive a container count negative — it stops where the delivery stops", bal === 0, bal);

// and the ordinary case still reverses properly
const biz2 = (await db.query(`insert into public.business_accounts (jug_balance) values (12) returning id`)).rows[0].id;
const j2 = (await db.query(`insert into public.jug_ledger (business_id, jugs_out, jugs_in) values ('${biz2}', 6, 2) returning id`)).rows[0].id;
await db.exec(`select public.void_jug_entry('${j2}', 'double-counted the swap')`);
ok("a normal reversal still puts back exactly what moved (12 − 4 = 8)",
  Number((await q1(`select jug_balance as b from public.business_accounts where id='${biz2}'`)).b) === 8);
ok("the reason is kept",
  (await q1(`select void_reason as r from public.jug_ledger where id='${j2}'`)).r === "double-counted the swap");
ok("a reason is still required", /Say why/i.test(await raises(`select public.void_jug_entry('${j2}','')`) || ""));

// ── 2) LEAVING THE WAITLIST ────────────────────────────────────────────────────────────────────
await db.exec(`insert into public.delivery_waitlist (zip, email) values
  ('30301','nino@example.com'), ('30301','  NINO@Example.com  '), ('29601','someone.else@example.com')`);
ok("the guard still blocks a plain delete",
  /Hard deletes are blocked/i.test(await raises(`delete from public.delivery_waitlist`) || ""));

await db.exec(`select set_config('test.staff','off',false)`);
const n = Number((await q1(`select public.leave_waitlist() as n`)).n);
// case and whitespace both normalised — the same person typed it two different ways
ok("no argument removes the caller's own address, however they typed it", n === 2, n);
ok("and leaves everybody else alone",
  Number((await q1(`select count(*) as c from public.delivery_waitlist`)).c) === 1);
const other = await raises(`select public.leave_waitlist('someone.else@example.com')`);
ok("a non-crew caller cannot remove somebody else's address",
  /only remove your own/i.test(other || ""), other);
await db.exec(`select set_config('test.staff','on',false)`);
ok("crew can, to honour a request from someone with no account",
  Number((await q1(`select public.leave_waitlist('someone.else@example.com') as n`)).n) === 1);
ok("the list is empty and the guard is back on",
  Number((await q1(`select count(*) as c from public.delivery_waitlist`)).c) === 0);
// the escape hatch must not leak past the function — set_config(..., true) is txn-local
await db.exec(`insert into public.delivery_waitlist (zip, email) values ('30301','after@example.com')`);
ok("the delete guard is not left open after the function runs",
  /Hard deletes are blocked/i.test(await raises(`delete from public.delivery_waitlist`) || ""));
ok("removing an address nobody is on returns zero rather than raising",
  Number((await q1(`select public.leave_waitlist('nobody@example.com') as n`)).n) === 0);

// ── 3) THE HONEST CONFIRM ──────────────────────────────────────────────────────────────────────
const pil = (await db.query(`insert into public.primal_pillars (title) values ('Move') returning id`)).rows[0].id;
const mod = (await db.query(`insert into public.primal_modules (pillar_id) values ('${pil}') returning id`)).rows[0].id;
const les = (await db.query(`insert into public.primal_lessons (module_id) values ('${mod}') returning id`)).rows[0].id;
await db.exec(`insert into public.primal_lessons (module_id, archived_at) values ('${mod}', now())`);
await db.exec(`insert into public.primal_progress (lesson_id) values ('${les}'), ('${les}')`);
const t = await q1(`select * from public.v_primal_tree where pillar_id='${pil}'`);
ok("the tree counts live modules", Number(t.live_modules) === 1, t.live_modules);
ok("counts LIVE lessons only — an archived one is already hidden", Number(t.live_lessons) === 1, t.live_lessons);
// the number that makes the confirm honest: people have history against this branch
ok("and counts how many people have progress against it", Number(t.progress_rows) === 2, t.progress_rows);

// ── 4) ledger + changelog ──────────────────────────────────────────────────────────────────────
ok("0310 recorded itself by filename",
  Number((await q1(`select count(*) as n from public.schema_migrations where version='0310_the_last_four_ways_out'`)).n) === 1);
ok("two changelog entries", Number((await q1(`select count(*) as n from public.changelog`)).n) === 2);
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0310_the_last_four_ways_out.sql"), "utf8"));
ok("re-running is safe", Number((await q1(`select count(*) as n from public.changelog`)).n) === 2);

console.log(`\nTHE LAST FOUR WAYS OUT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
