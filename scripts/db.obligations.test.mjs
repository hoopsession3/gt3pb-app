// THIRTEEN DEADLINES, ONE ANSWER — 0320, executed from its file.
//
// The claims worth proving about a view that unions eleven tables are not "it returns rows". They
// are:
//   1. the three deadlines that ALREADY have cron sweepers stay out, so nobody is told twice;
//   2. equipment service reads the LATEST maintenance row per asset, not one row per service ever
//      performed — the difference between "one tool is overdue" and "one tool is overdue five
//      times", which is exactly the kind of number that gets quoted in a commit message;
//   3. the severity boundaries land on the right side of today;
//   4. a row that is not actually outstanding — a paid invoice, a done to-do, a draft offer, a
//      retired asset — is not a deadline.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q = async (s) => (await db.query(s)).rows;
const q1 = async (s) => (await db.query(s)).rows[0];

// Fixture: the columns 0320 actually reads, in the shapes production has them. Anything wider is
// noise; anything narrower and the view would not compile, which is itself half the test.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create role anon; create role authenticated;
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

  create table public.profiles (id uuid primary key, display_name text, market text);
  create table public.assets (id uuid primary key default gen_random_uuid(), name text,
    market text, status text default 'active');
  create table public.asset_maintenance (id uuid primary key default gen_random_uuid(),
    asset_id uuid not null references public.assets(id) on delete cascade,
    kind text not null default 'service', performed_on date not null default current_date,
    summary text, next_due_on date, created_at timestamptz not null default now());
  create table public.compliance_rules (id uuid primary key default gen_random_uuid(),
    state text, county text, label text, kind text, critical boolean default false,
    active boolean default true, verified boolean default true, authority text,
    verified_on date, lead_days int, lead_basis text, check_note text, sort int default 100);
  create table public.academy_certifications (user_id uuid, cert_key text,
    awarded_at timestamptz not null default now(), expires_at timestamptz,
    primary key (user_id, cert_key));
  create table public.academy_assignments (id uuid primary key default gen_random_uuid(),
    user_id uuid, target_type text, target_key text, due_at timestamptz);
  create table public.offer_letters (id uuid primary key default gen_random_uuid(),
    candidate_name text, candidate_user_id uuid, title text, market text,
    status text default 'draft', expires_on date, sent_at timestamptz);
  create table public.business_accounts (id uuid primary key default gen_random_uuid(),
    company text, market text);
  create table public.invoices (id uuid primary key default gen_random_uuid(),
    business_id uuid references public.business_accounts(id), amount_cents int not null,
    terms text default 'net15', status text default 'open',
    issued_at timestamptz not null default now(), due_at date);
  create table public.operator_agreements (id uuid primary key default gen_random_uuid(),
    operator_name text, operator_user_id uuid, market text, status text default 'draft',
    version int default 1, ends_on date);
  create table public.goals (id uuid primary key default gen_random_uuid(), title text,
    unit text default '', target_value numeric default 1, current_value numeric default 0,
    due_date date, status text default 'active');
  create table public.initiatives (id uuid primary key default gen_random_uuid(), title text,
    summary text, target_date date, status text default 'active');
  create table public.os_workstreams (id uuid primary key default gen_random_uuid(), name text,
    status text default 'active', next_action text, due date, owner_user_id uuid);
  create table public.todos (id uuid primary key default gen_random_uuid(), title text,
    category text, due_on date, assignee uuid, done boolean not null default false);

  -- the freshness view 0320 defers to rather than re-deriving
  create or replace view public.v_compliance_freshness as
  select r.id, r.state, r.county, r.label, r.kind, r.critical, r.active, r.verified,
         r.authority, r.verified_on,
         case when not r.verified then 'UNVERIFIED — do not rely on it'
              when r.verified_on is null then 'no date — nobody recorded when this was confirmed'
              when current_date - r.verified_on > 365 then 'stale — over a year'
              when current_date - r.verified_on > 180 then 'ageing — over six months'
              else 'fresh' end as freshness
    from public.compliance_rules r where r.active;

  -- the three that must NOT appear, present so their absence is a choice and not an accident
  create table public.event_tasks (id uuid primary key default gen_random_uuid(), title text,
    due_at timestamptz, done boolean default false);
  create table public.brew_batches (id uuid primary key default gen_random_uuid(), needed_by timestamptz);
  create table public.reserve_claims (id uuid primary key default gen_random_uuid(), hold_expires_at timestamptz);
`);

await db.exec(readFileSync(join(ROOT, "supabase/migrations/0320_thirteen_deadlines_one_answer.sql"), "utf8"));
console.log("0320 executed against a real Postgres.\n");

// ── the distinct-on claim, first, because it is the one that produces a wrong NUMBER ───────────
// One tool, serviced three times, currently overdue. A naive union over asset_maintenance reports
// it three times — once per historical service — and the owner reads "3 overdue".
await db.exec(`
  insert into public.assets (id, name, market) values
    ('a0000000-0000-0000-0000-000000000001', 'Jockey box', 'greenville');
  insert into public.asset_maintenance (asset_id, kind, performed_on, next_due_on) values
    ('a0000000-0000-0000-0000-000000000001', 'service', current_date - 400, current_date - 300),
    ('a0000000-0000-0000-0000-000000000001', 'clean',   current_date - 200, current_date - 100),
    ('a0000000-0000-0000-0000-000000000001', 'inspect', current_date - 30,  current_date - 5);
`);
{
  const rows = await q(`select * from public.v_obligations where source='asset_maintenance'`);
  ok("0320: one overdue tool is ONE row, not one per service ever performed", rows.length === 1, rows.length);
  ok("0320: and it is the LATEST service that sets the date",
    rows[0]?.days_out === -5, rows[0]?.days_out);
  ok("0320: it names the asset, not the maintenance row", rows[0]?.title === "Jockey box", rows[0]?.title);
  ok("0320: overdue is overdue", rows[0]?.severity === "overdue", rows[0]?.severity);
}

// A retired asset is not a deadline; nobody services a tool that is gone.
await db.exec(`
  insert into public.assets (id, name, market, status) values
    ('a0000000-0000-0000-0000-000000000002', 'Old pump', 'greenville', 'retired');
  insert into public.asset_maintenance (asset_id, performed_on, next_due_on) values
    ('a0000000-0000-0000-0000-000000000002', current_date - 40, current_date - 10);
`);
ok("0320: a retired asset is not an outstanding obligation",
  (await q(`select * from public.v_obligations where source='asset_maintenance'`)).length === 1);

// ── the severity boundaries ────────────────────────────────────────────────────────────────────
await db.exec(`
  insert into public.todos (title, due_on, done) values
    ('Yesterday',       current_date - 1,  false),
    ('Today',           current_date,      false),
    ('In a fortnight',  current_date + 14, false),
    ('Just after',      current_date + 15, false),
    ('Already handled', current_date - 9,  true);
`);
{
  const byTitle = Object.fromEntries((await q(`select title, severity, days_out from public.v_obligations where source='todos'`))
    .map((r) => [r.title, r.severity]));
  ok("0320: yesterday is overdue", byTitle["Yesterday"] === "overdue", byTitle["Yesterday"]);
  ok("0320: TODAY is not overdue — a thing due today has not been missed yet",
    byTitle["Today"] === "soon", byTitle["Today"]);
  ok("0320: fourteen days out is still 'soon'", byTitle["In a fortnight"] === "soon", byTitle["In a fortnight"]);
  ok("0320: fifteen is 'upcoming'", byTitle["Just after"] === "upcoming", byTitle["Just after"]);
  ok("0320: a done to-do is not a deadline", byTitle["Already handled"] === undefined, byTitle["Already handled"]);
}

// ── the exclusions, which are the whole design argument ────────────────────────────────────────
await db.exec(`
  insert into public.event_tasks (title, due_at) values ('Swept by task_due_alerts', now() - interval '2 days');
  insert into public.brew_batches (needed_by) values (now() - interval '1 day');
  insert into public.reserve_claims (hold_expires_at) values (now() - interval '1 hour');
`);
{
  const sources = (await q(`select distinct source from public.v_obligations`)).map((r) => r.source);
  ok("0320: event_tasks stays out — task_due_alerts already sweeps it every 10 minutes",
    !sources.includes("event_tasks"), sources);
  ok("0320: brew_batches stays out — brew_due_alerts owns that ladder", !sources.includes("brew_batches"));
  ok("0320: reserve_claims stays out — release_expired_holds owns it", !sources.includes("reserve_claims"));
}

// ── only things actually outstanding ───────────────────────────────────────────────────────────
await db.exec(`
  insert into public.business_accounts (id, company, market) values
    ('b0000000-0000-0000-0000-000000000001', 'Acme', 'greenville');
  insert into public.invoices (business_id, amount_cents, status, due_at) values
    ('b0000000-0000-0000-0000-000000000001', 24500, 'open', current_date - 3),
    ('b0000000-0000-0000-0000-000000000001', 9900,  'paid', current_date - 3),
    ('b0000000-0000-0000-0000-000000000001', 1000,  'void', current_date - 3);
  insert into public.offer_letters (candidate_name, title, status, expires_on, sent_at) values
    ('Sent one',  'Server', 'sent',  current_date + 3, now()),
    ('Draft one', 'Server', 'draft', current_date + 3, null);
  insert into public.operator_agreements (operator_name, market, status, ends_on) values
    ('Live deal',  'atlanta', 'active', current_date + 20),
    ('Dead deal',  'atlanta', 'ended',  current_date + 20);
`);
ok("0320: a paid or void invoice is not money owed",
  (await q(`select * from public.v_obligations where source='invoices'`)).length === 1);
ok("0320: and the one that counts carries the amount in the title",
  /\$245\.00/.test((await q1(`select title from public.v_obligations where source='invoices'`))?.title ?? ""),
  (await q1(`select title from public.v_obligations where source='invoices'`))?.title);
ok("0320: a draft offer is not awaiting an answer",
  (await q(`select * from public.v_obligations where source='offer_letters'`)).length === 1);
ok("0320: an ended agreement is not running out",
  (await q(`select * from public.v_obligations where source='operator_agreements'`)).length === 1);

// ── compliance defers to the freshness view rather than re-deriving staleness ───────────────────
await db.exec(`
  insert into public.compliance_rules (label, authority, verified, verified_on) values
    ('Temporary Food Service Permit', 'Fulton County', true,  current_date - 400),
    ('Retail Food Permit',            'DHEC',          true,  current_date - 10),
    ('Never confirmed',               'Somebody',      true,  null),
    ('Agent-drafted',                 'Unknown',       false, current_date - 5);
`);
{
  const rows = await q(`select title, severity from public.v_obligations where source='compliance_rules' order by title`);
  ok("0320: only rules the freshness view calls not-fresh appear", rows.length === 3, rows.map((r) => r.title));
  ok("0320: a rule confirmed 10 days ago is absent",
    !rows.some((r) => r.title === "Retail Food Permit"), rows.map((r) => r.title));
  ok("0320: one never confirmed is due today, not never",
    (await q1(`select severity from public.v_obligations where title='Never confirmed'`))?.severity === "soon");
}

// ── certifications, training, and the people columns ───────────────────────────────────────────
await db.exec(`
  insert into auth.users (id) values ('c0000000-0000-0000-0000-000000000001');
  insert into public.profiles (id, display_name, market) values
    ('c0000000-0000-0000-0000-000000000001', 'Sam', 'atlanta');
  insert into public.academy_certifications (user_id, cert_key, expires_at) values
    ('c0000000-0000-0000-0000-000000000001', 'food-safety', now() + interval '9 days');
  insert into public.academy_assignments (user_id, target_type, target_key, due_at) values
    ('c0000000-0000-0000-0000-000000000001', 'module', 'brand', now() + interval '3 days');
`);
{
  const c = await q1(`select * from public.v_obligations where source='academy_certifications'`);
  ok("0320: a certification names the person and the cert", /Sam — food-safety/.test(c?.title ?? ""), c?.title);
  ok("0320: and carries the person, so it can be routed to them", c?.owner_user_id === "c0000000-0000-0000-0000-000000000001");
  ok("0320: and their market, so a city can be filtered to", c?.market === "atlanta", c?.market);
  ok("0320: assigned training appears too",
    (await q(`select * from public.v_obligations where source='academy_assignments'`)).length === 1);
}

// ── the rollup the owner home reads ────────────────────────────────────────────────────────────
{
  const sum = await q(`select * from public.v_obligations_summary`);
  const total = sum.reduce((n, r) => n + Number(r.overdue) + Number(r.soon) + Number(r.upcoming), 0);
  const all = Number((await q1(`select count(*) n from public.v_obligations`))?.n);
  ok("0320: the summary accounts for every row and invents none", total === all, { total, all });
  ok("0320: it is ordered worst-first", Number(sum[0]?.overdue) >= Number(sum[sum.length - 1]?.overdue),
    sum.map((r) => [r.area, r.overdue]));
  ok("0320: every area has a name", sum.every((r) => !!r.area), sum.map((r) => r.area));
}

// ── the view contract ──────────────────────────────────────────────────────────────────────────
ok("0320: v_obligations is security_invoker — it rearranges facts, it does not grant new reach",
  (await q1(`select reloptions::text as o from pg_class where relname='v_obligations'`))?.o?.includes("security_invoker=on"),
  (await q1(`select reloptions::text as o from pg_class where relname='v_obligations'`))?.o);
ok("0320: so is the summary",
  (await q1(`select reloptions::text as o from pg_class where relname='v_obligations_summary'`))?.o?.includes("security_invoker=on"));
ok("0320 recorded itself by filename",
  Number((await q1(`select count(*) n from public.schema_migrations where version='0320_thirteen_deadlines_one_answer'`))?.n) === 1);
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0320_thirteen_deadlines_one_answer.sql"), "utf8"));
ok("0320 re-running is safe — no duplicate changelog row",
  Number((await q1(`select count(*) n from public.changelog`))?.n) === 1);

console.log(`\nOBLIGATIONS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
